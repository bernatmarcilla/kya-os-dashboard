/** Plays the host app (Claude Desktop): launches the proxy over stdio and drives it. Needs the server running. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = process.env['SERVER_URL'] ?? 'http://localhost:3002';
const client = new Client({ name: 'smoke-host', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve(here, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(here, 'index.ts'),
    ],
    env: { ...process.env, WAIT_FOR_APPROVAL_MS: '20000' } as Record<string, string>,
    stderr: 'inherit',
  }),
);
const show = (label: string, r: any) =>
  console.log(`${label}\n  -> ${r.isError ? '[error] ' : ''}${r.content?.[0]?.text}`);

console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
show('1. list_tasks (public)', await client.callTool({ name: 'list_tasks', arguments: {} }));

// The human approves from the dashboard while add_task is waiting; here a timer plays the human.
setTimeout(async () => {
  const pending = (await (await fetch(`${SERVER}/api/consents`)).json()) as { resumeToken: string }[];
  for (const c of pending) await fetch(`${SERVER}/api/consents/${c.resumeToken}/approve`, { method: 'POST' });
  console.log('   (human approved in the dashboard)');
}, 3000);
show(
  '2. add_task (waits for approval, then retries)',
  await client.callTool({ name: 'add_task', arguments: { title: 'From the proxy' } }),
);
await client.close();
