/** Prints the Claude Desktop config entry with absolute paths (the app does not inherit your shell PATH). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = {
  mcpServers: {
    'kya-team-tasks': {
      command: process.execPath,
      args: [
        path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(root, 'proxy', 'src', 'index.ts'),
      ],
      env: { SERVER_URL: 'http://localhost:3002', DASHBOARD_URL: 'http://localhost:5173' },
    },
  },
};
process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
