import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createKyaOsMiddleware, createDidKeyResolver } from '@kya-os/mcp';
import { crypto, type Identity } from './identity.js';
import type { EventBus } from './events.js';
import type { Delegations } from './delegations.js';
import type { Consent } from './consent.js';
import type { Audit } from './audit.js';

interface CallCtx {
  id: string;
  tool: string;
  agentDid?: string;
}
const als = new AsyncLocalStorage<CallCtx>();

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

const TOOLS = {
  list_tasks: { scope: undefined, description: 'List tasks (public)' },
  add_task: { scope: 'tasks:write', description: 'Add a task (delegated, tasks:write)' },
  delete_task: { scope: 'tasks:delete', description: 'Delete a task (delegated, tasks:delete)' },
} as const;

export function createMcp(deps: {
  server: Identity;
  rp: Identity;
  bus: EventBus;
  delegations: Delegations;
  consent: Consent;
  audit: Audit;
  consentBase: string;
}) {
  const { server: id, rp, bus, delegations, consent, audit } = deps;
  const tasks: { id: number; title: string }[] = [{ id: 1, title: 'Try the KYA-OS demo' }];
  let nextId = 2;

  const kyaos = createKyaOsMiddleware(
    {
      identity: id,
      session: { sessionTtlMinutes: 60 },
      autoSession: true,
      grantStore: consent.grantStore,
      emitLegacyProofKey: false,
      audit: { record: audit.trail.record.bind(audit.trail) },
      delegation: {
        holderBinding: 'enforce',
        trustedRootIssuers: [rp.did], // pin the Responsible Party as the only root issuer (>= 1.17.0)
        statusListResolver: delegations.statusList,
        didResolver: createDidKeyResolver(),
      },
    },
    crypto,
  );

  const challengeFormatter =
    (tool: string, scope: string) => (c: { scopes: string[]; resumeToken: string }) => {
      const ctx = als.getStore();
      consent.request({
        resumeToken: c.resumeToken,
        tool,
        scopes: c.scopes,
        agentDid: ctx?.agentDid ?? 'unknown',
      });
      return [
        {
          type: 'text' as const,
          text: `Authorization required (scope ${scope}). Approve in the dashboard: ${deps.consentBase}/consents/${c.resumeToken}`,
        },
      ];
    };

  const handlers = {
    list_tasks: kyaos.wrapWithProof('list_tasks', async () => ({
      content: [{ type: 'text', text: JSON.stringify(tasks) }],
    })),
    add_task: kyaos.wrapWithDelegation(
      'add_task',
      {
        scopeId: 'tasks:write',
        consentUrl: `${deps.consentBase}/consents`,
        formatChallenge: challengeFormatter('add_task', 'tasks:write'),
      },
      kyaos.wrapWithProof('add_task', async (args) => {
        const t = { id: nextId++, title: String(args['title'] ?? 'untitled') };
        tasks.push(t);
        return { content: [{ type: 'text', text: `Added task ${t.id}: ${t.title}` }] };
      }),
    ),
    delete_task: kyaos.wrapWithDelegation(
      'delete_task',
      {
        scopeId: 'tasks:delete',
        consentUrl: `${deps.consentBase}/consents`,
        formatChallenge: challengeFormatter('delete_task', 'tasks:delete'),
      },
      kyaos.wrapWithProof('delete_task', async (args) => {
        const i = tasks.findIndex((t) => t.id === Number(args['id']));
        if (i < 0)
          return { content: [{ type: 'text', text: `No task ${String(args['id'])}` }], isError: true };
        const [t] = tasks.splice(i, 1);
        return { content: [{ type: 'text', text: `Deleted task ${t!.id}: ${t!.title}` }] };
      }),
    ),
  };

  function agentDidOf(args: Record<string, unknown>): string | undefined {
    try {
      const p =
        typeof args['_kyaos_proof'] === 'string' ? JSON.parse(args['_kyaos_proof']) : args['_kyaos_proof'];
      return (p as { meta?: { did?: string } })?.meta?.did;
    } catch {
      return undefined;
    }
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    sessionId: string | undefined,
    req: { callId?: string },
  ): Promise<ToolResult> {
    const callId = randomUUID();
    req.callId = callId; // lets the transport tap attribute the proof it sees on the way out
    const agentDid = agentDidOf(args);
    const { _kyaos_proof: _p, _kyaos_delegation: _d, ...shown } = args;
    bus.emit({ type: 'tool.called', id: callId, tool: name, agentDid, args: shown });
    const handler = handlers[name as keyof typeof handlers] as
      ((a: Record<string, unknown>, s?: string) => Promise<ToolResult>) | undefined;
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    const res = await als.run({ id: callId, tool: name, agentDid }, () => handler(args, sessionId));
    const text = res.content[0]?.text ?? '';
    if (text.startsWith('Authorization required')) {
      const c = consent.pending().find((p) => p.agentDid === agentDid && p.tool === name);
      bus.emit({
        type: 'tool.challenged',
        id: callId,
        tool: name,
        scopes: c?.scopes ?? [],
        resumeToken: c?.resumeToken ?? '',
      });
    } else if (res.isError) {
      bus.emit({ type: 'tool.denied', id: callId, tool: name, reason: text });
    } else {
      const used =
        name === 'list_tasks'
          ? undefined
          : delegations
              .list()
              .filter((d) => d.agentDid === agentDid && d.tool === name && d.status === 'active')
              .at(-1)?.id;
      bus.emit({ type: 'tool.succeeded', id: callId, tool: name, delegationId: used, result: text });
    }
    return res;
  }

  /** One server per HTTP request; `req.callId` is set by the tool call so the transport tap can name it. */
  function createServer(reqCtx: { callId?: string }) {
    const s = new Server({ name: 'kya-os-team-tasks', version: '0.1.0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        kyaos.kyaOsTool,
        {
          name: 'list_tasks',
          description: TOOLS.list_tasks.description,
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'add_task',
          description: TOOLS.add_task.description,
          inputSchema: {
            type: 'object' as const,
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
        {
          name: 'delete_task',
          description: TOOLS.delete_task.description,
          inputSchema: { type: 'object' as const, properties: { id: { type: 'number' } }, required: ['id'] },
        },
      ],
    }));
    s.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const { name, arguments: args = {} } = req.params;
      if (name === '_kyaos') return kyaos.handleKyaOs(args as Record<string, unknown>);
      return callTool(name, args as Record<string, unknown>, extra?.sessionId, reqCtx);
    });
    return s;
  }

  return { createServer, kyaos };
}
