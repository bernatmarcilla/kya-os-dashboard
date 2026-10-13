import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKyaOsTransport } from '@kya-os/mcp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DetachedProofLike } from '@kya-dash/shared';
import { loadIdentity } from './identity.js';
import { EventBus } from './events.js';
import { createDelegations } from './delegations.js';
import { createConsent } from './consent.js';
import { createAudit } from './audit.js';
import { createMcp } from './mcp.js';
import { createApi } from './api.js';

const PORT = Number(process.env['PORT'] ?? 3002);
const WEB = process.env['WEB_ORIGIN'] ?? 'http://localhost:5173';
const BASE = `http://localhost:${PORT}`;

const [server, rp, agent] = await Promise.all([
  loadIdentity('server'),
  loadIdentity('responsible-party'),
  loadIdentity('agent'),
]);
const bus = new EventBus();
const delegations = createDelegations(rp, `${BASE}/status`);
const consent = createConsent(bus, delegations, rp.did);
const audit = await createAudit(bus);
const mcp = createMcp({ server, rp, bus, delegations, consent, audit, consentBase: WEB });
const identities = { server: server.did, responsibleParty: rp.did, agent: agent.did };
const agentEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agent',
  'src',
  'index.ts',
);
let demo: ReturnType<typeof spawn> | undefined;
/** Spawn the scripted agent (interactive mode: it waits for the human in the dashboard). */
async function runDemo() {
  if (demo && demo.exitCode === null) return;
  demo = spawn('npx', ['tsx', agentEntry], { env: { ...process.env, SERVER_URL: BASE }, stdio: 'inherit' });
}
const api = createApi({ bus, consent, delegations, audit, identities, runDemo });

/** Sits under the KYA-OS transport: sees the signed result and publishes its proof to the dashboard. */
function tapProofs(inner: Transport, bus: EventBus, req: { callId?: string }): Transport {
  const tap: Transport = {
    start: () => inner.start(),
    close: () => inner.close(),
    send: (msg, opts) => {
      const meta = (msg as { result?: { _meta?: Record<string, unknown> } }).result?._meta;
      const proof = meta?.['org.kya-os/response-proof'] as DetachedProofLike | undefined;
      if (proof && req.callId) bus.emit({ type: 'tool.proved', id: req.callId, proof });
      return inner.send(msg, opts);
    },
    get onmessage() {
      return inner.onmessage;
    },
    set onmessage(f) {
      inner.onmessage = f;
    },
    get onclose() {
      return inner.onclose;
    },
    set onclose(f) {
      inner.onclose = f;
    },
    get onerror() {
      return inner.onerror;
    },
    set onerror(f) {
      inner.onerror = f;
    },
    get sessionId() {
      return inner.sessionId;
    },
  };
  return tap;
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url ?? '/', BASE);
    try {
      if (await api(req, res, url)) return;
      if (url.pathname === '/mcp' && req.method === 'POST') {
        const reqCtx: { callId?: string } = {};
        const s = mcp.createServer(reqCtx);
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => void t.close());
        // 1.20: wrappers need a KYA-OS transport, which signs each result on the way out.
        await s.connect(createKyaOsTransport(tapProofs(t, bus, reqCtx), mcp.kyaos));
        return await t.handleRequest(req, res);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
    } catch (e) {
      process.stderr.write(`[server] ${e instanceof Error ? e.stack : e}\n`);
      if (!res.headersSent) res.writeHead(500).end('{"error":"internal"}');
    }
  })
  .listen(PORT, () => {
    process.stderr.write(`[server] MCP http://localhost:${PORT}/mcp  API http://localhost:${PORT}/api\n`);
    process.stderr.write(
      `[server] server=${server.did}\n[server] RP    =${rp.did}\n[server] agent =${agent.did}\n`,
    );
  });
