/**
 * KYA-OS signing proxy: an MCP server on stdio (what Claude Desktop launches) that forwards to the
 * Team Tasks server over HTTP and adds the holder-of-key proof the host app cannot produce itself.
 *
 *   Claude Desktop --stdio--> this proxy --HTTP + _kyaos_proof--> Team Tasks MCP server
 *
 * stdout carries the MCP protocol, so everything we log goes to stderr.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NodeCryptoProvider, generateDidKeyFromBase64, generateRequestProof, logger } from '@kya-os/mcp';

logger.configure({ level: 'error' });

const SERVER_URL = process.env['SERVER_URL'] ?? 'http://localhost:3002';
const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173';
/** How long a call waits for the human to approve in the dashboard before giving up (0 = don't wait). */
const WAIT_MS = Number(process.env['WAIT_FOR_APPROVAL_MS'] ?? 45_000);

const log = (s: string) => process.stderr.write(`[proxy] ${s}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const crypto = new NodeCryptoProvider();

interface Identity {
  did: string;
  kid: string;
  privateKey: string;
  publicKey: string;
}

/** Each proxy install is its own agent: its key is generated once and kept in `.kya-os/`. */
async function loadAgentIdentity(): Promise<Identity> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.kya-os');
  const file = path.join(dir, 'claude-agent.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as Identity;
  const kp = await crypto.generateKeyPair();
  const did = generateDidKeyFromBase64(kp.publicKey);
  const identity = {
    did,
    kid: `${did}#${did.replace('did:key:', '')}`,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

const agent = await loadAgentIdentity();
const { server: serverDid } = (await (await fetch(`${SERVER_URL}/api/identities`)).json()) as {
  server: string;
};
log(`agent ${agent.did} -> ${SERVER_URL} (audience ${serverDid})`);

let rpcId = 0;
async function rpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${SERVER_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = (await res.json()) as { result?: any; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** Sign the call as the agent (fresh nonce, bound to the tool, the arguments and this server). */
async function signedCall(tool: string, args: Record<string, unknown>) {
  const proof = await generateRequestProof({
    identity: agent,
    crypto,
    toolName: tool,
    args,
    audience: serverDid,
    sessionId: 'kyaos_agent_local',
  });
  return rpc('tools/call', { name: tool, arguments: { ...args, _kyaos_proof: proof } });
}

const text = (r: any): string => r?.content?.[0]?.text ?? '';
const isChallenge = (r: any) => text(r).startsWith('Authorization required');

/** Poll the dashboard API until the pending consent is answered, or the wait runs out. */
async function waitForConsent(token: string): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    const pending = (await (await fetch(`${SERVER_URL}/api/consents`)).json()) as { resumeToken: string }[];
    if (!pending.some((p) => p.resumeToken === token)) return true;
  }
  return false;
}

const pendingMessage = (tool: string, scope: string) =>
  `This action needs the user's approval first. The user must open the dashboard at ${DASHBOARD_URL} and approve ` +
  `the pending request for "${tool}" (scope ${scope}). Tell the user that, and retry the call once they confirm.`;

async function callWithConsent(tool: string, args: Record<string, unknown>) {
  let result = await signedCall(tool, args);
  if (!isChallenge(result)) return result;

  const scope = /\(scope ([^)]+)\)/.exec(text(result))?.[1] ?? 'unknown';
  const token = /\/consents\/([\w-]+)/.exec(text(result))?.[1];
  log(`${tool} needs approval (scope ${scope}); waiting up to ${WAIT_MS / 1000}s`);
  if (token && WAIT_MS > 0 && (await waitForConsent(token))) result = await signedCall(tool, args);
  if (!isChallenge(result)) return result;
  return { content: [{ type: 'text', text: pendingMessage(tool, scope) }], isError: true };
}

const server = new Server({ name: 'kya-os-proxy', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await rpc('tools/list', {});
  return { tools: tools.filter((t: { name: string }) => t.name !== '_kyaos') }; // protocol plumbing, not for the model
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  return callWithConsent(name, args as Record<string, unknown>);
});

await server.connect(new StdioServerTransport());
log('ready on stdio');
