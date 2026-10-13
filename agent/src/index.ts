import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeCryptoProvider, generateRequestProof, logger } from '@kya-os/mcp';

logger.configure({ level: 'error' });

const BASE = process.env['SERVER_URL'] ?? 'http://localhost:3002';
/** --auto plays the human too (approve/revoke via the dashboard API) so the demo runs headless. */
const AUTO = process.argv.includes('--auto');
const crypto = new NodeCryptoProvider();

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.kya-os', 'agent.json');
if (!fs.existsSync(file)) throw new Error('Start the server once first: it creates .kya-os/agent.json');
const agent = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
  did: string;
  kid: string;
  privateKey: string;
  publicKey: string;
};

const identities = (await (await fetch(`${BASE}/api/identities`)).json()) as { server: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rpcId = 0;

async function call(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const proof = await generateRequestProof({
    identity: agent,
    crypto,
    toolName: tool,
    args,
    audience: identities.server,
    sessionId: 'kyaos_agent_local',
  });
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name: tool, arguments: { ...args, _kyaos_proof: proof } },
    }),
  });
  const body = (await res.json()) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  if (body.error) throw new Error(body.error.message);
  return { text: body.result!.content[0]?.text ?? '', isError: !!body.result!.isError };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const post = async (p: string) => (await fetch(`${BASE}${p}`, { method: 'POST' })).json();

/** Call; if challenged, wait for the human (or auto-approve) then retry once. */
async function callWithConsent(tool: string, args: Record<string, unknown>) {
  let r = await call(tool, args);
  if (!r.text.startsWith('Authorization required')) return r;
  log(`  ← challenged: ${r.text}`);
  const token = r.text.split('/consents/')[1]?.trim();
  if (AUTO && token) {
    await post(`/api/consents/${token}/approve`);
    log('  (auto) human approved');
  } else {
    log('  … waiting for approval in the dashboard');
    for (let i = 0; i < 300; i++) {
      await sleep(1000);
      const pending = (await (await fetch(`${BASE}/api/consents`)).json()) as { resumeToken: string }[];
      if (!pending.some((p) => p.resumeToken === token)) break;
    }
  }
  r = await call(tool, args);
  return r;
}

log(`agent ${agent.did}\n`);
log('1. list_tasks (public)');
log(`  → ${(await call('list_tasks')).text}`);

log('2. add_task (needs tasks:write)');
log(`  → ${(await callWithConsent('add_task', { title: 'Ship the demo' })).text}`);

log('3. delete_task (needs tasks:delete — separate consent)');
log(`  → ${(await callWithConsent('delete_task', { id: 1 })).text}`);

log('4. revoke tasks:write, then add_task again');
if (AUTO) {
  const ds = (await (await fetch(`${BASE}/api/delegations`)).json()) as { id: string; scopes: string[] }[];
  await post(`/api/delegations/${ds.find((d) => d.scopes.includes('tasks:write'))!.id}/revoke`);
  log('  (auto) human revoked tasks:write');
} else {
  log('  … revoke tasks:write in the dashboard');
  for (;;) {
    await sleep(1000);
    const ds = (await (await fetch(`${BASE}/api/delegations`)).json()) as {
      scopes: string[];
      status: string;
    }[];
    if (ds.some((d) => d.scopes.includes('tasks:write') && d.status === 'revoked')) break;
  }
}
const after = await call('add_task', { title: 'Should be denied' });
log(
  `  → ${after.isError ? 'DENIED' : after.text.startsWith('Authorization') ? 'RE-CHALLENGED' : 'ALLOWED (bug!)'}: ${after.text}`,
);

if (AUTO) log(`\ncheckpoint: ${JSON.stringify(await post('/api/audit/checkpoint'))}`);
