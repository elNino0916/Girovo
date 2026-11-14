// A tiny client for the Girovo API (docs/girovo-api.md), to try it by hand:
//
//   node scripts/girovo-api-client.mjs                        → girovo.hello
//   node scripts/girovo-api-client.mjs girovo.accounts.list   → hello, then that method
//   node scripts/girovo-api-client.mjs girovo.transactions.list '{"limit":5}'
//
// It connects to the pipe (Windows, \\.\pipe\girovo-api-<your SID>) or the
// socket (Linux, $XDG_RUNTIME_DIR/girovo-api.sock), sends girovo.hello asking
// for accounts.read, prints every answer as it comes and ends after the last
// one. GIROVO_API_ADDRESS sets another address. Girovo must be running with
// Einstellungen → Girovo API switched on; a first hello waits for the dialog.

import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function address() {
  if (process.env.GIROVO_API_ADDRESS) return process.env.GIROVO_API_ADDRESS;
  if (process.platform === 'win32') {
    // "DOMAIN\user","S-1-5-21-…"
    const line = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).trim();
    const sid = line.split(',').pop().replace(/"/g, '');
    return `\\\\.\\pipe\\girovo-api-${sid}`;
  }
  const dir = process.env.XDG_RUNTIME_DIR || path.join(os.homedir(), '.config', 'Girovo');
  return path.join(dir, 'girovo-api.sock');
}

const [method, paramsText] = process.argv.slice(2);
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'girovo.hello',
    params: { app: 'girovo-api-client', version: '1', permissions: ['accounts.read'], reason: 'Ein Test aus scripts/girovo-api-client.mjs' },
  },
];
if (method) requests.push({ jsonrpc: '2.0', id: 2, method, params: paramsText ? JSON.parse(paramsText) : {} });

const where = address();
console.error(`→ ${where}`);
const socket = net.connect(where);
let buffer = '';
let waiting = requests.length;
socket.setEncoding('utf8');
socket.on('connect', () => {
  // The first answer before the next request: nothing is answered before hello.
  socket.write(JSON.stringify(requests.shift()) + '\n');
});
socket.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!line.trim()) continue;
    console.log(JSON.stringify(JSON.parse(line), null, 2));
    waiting -= 1;
    if (requests.length) socket.write(JSON.stringify(requests.shift()) + '\n');
    else if (waiting <= 0) socket.end();
  }
});
socket.on('error', (err) => {
  console.error(`Keine Verbindung: ${err.message}`);
  process.exitCode = 1;
});
socket.on('close', () => {
  if (waiting > 0 && !process.exitCode) {
    console.error('Girovo hat die Verbindung beendet.');
    process.exitCode = 1;
  }
});
