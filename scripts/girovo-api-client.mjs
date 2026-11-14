// A tiny client for the Girovo API (docs/girovo-api.md), to try it by hand:
//
//   node scripts/girovo-api-client.mjs                        → girovo.hello
//   node scripts/girovo-api-client.mjs girovo.accounts.list   → hello, then that method
//   node scripts/girovo-api-client.mjs girovo.transactions.list '{"limit":5}'
//   node scripts/girovo-api-client.mjs --method girovo.events.subscribe --params '{"kinds":["bookings"]}' --listen
//
// After hello it sends each --method with the --params that follow it (JSON,
// {} when left out), one after the other, each once the answer before it
// came. --permissions a,b,c sets what hello asks for (accounts.read when left
// out). --listen stays connected after the last answer and prints Girovo's
// notifications as they arrive, until Ctrl+C or Girovo ends the connection;
// without it the client ends after the last answer, printing any
// notification that came before.
//
// It connects to the pipe (Windows, \\.\pipe\girovo-api-<your SID>) or the
// socket (Linux, $XDG_RUNTIME_DIR/girovo-api.sock). GIROVO_API_ADDRESS sets
// another address. Girovo must be running with Einstellungen → Girovo API
// switched on; a first hello waits for the dialog.

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

function fail(message) {
  console.error(message);
  process.exit(2);
}

function json(text, flag) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${flag}: kein JSON: ${text}`);
  }
}

/** The command line: positional method and params as before, or --method/--params pairs. */
function options(args) {
  const calls = [];
  let permissions = ['accounts.read'];
  let listen = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => (i + 1 < args.length ? args[++i] : fail(`${arg} braucht einen Wert`));
    if (arg === '--method') calls.push({ method: value(), params: {} });
    else if (arg === '--params') {
      if (!calls.length) fail('--params gehört hinter ein --method');
      calls[calls.length - 1].params = json(value(), '--params');
    } else if (arg === '--permissions') permissions = value().split(',').map((p) => p.trim()).filter(Boolean);
    else if (arg === '--listen') listen = true;
    else if (arg.startsWith('--')) fail(`Unbekannte Option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length) calls.unshift({ method: positional[0], params: positional[1] ? json(positional[1], 'params') : {} });
  return { calls, permissions, listen };
}

const { calls, permissions, listen } = options(process.argv.slice(2));
let nextId = 1;
const requests = [
  {
    jsonrpc: '2.0',
    id: nextId++,
    method: 'girovo.hello',
    params: { app: 'girovo-api-client', version: '1', permissions, reason: 'Ein Test aus scripts/girovo-api-client.mjs' },
  },
  ...calls.map(({ method, params }) => ({ jsonrpc: '2.0', id: nextId++, method, params })),
];

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
    const message = JSON.parse(line);
    // A notification has no id: it answers nothing, so the requests wait on.
    if (!('id' in message)) {
      console.log(`← ${message.method} ${new Date().toLocaleTimeString()}`);
      console.log(JSON.stringify(message.params ?? null, null, 2));
      continue;
    }
    console.log(JSON.stringify(message, null, 2));
    waiting -= 1;
    if (requests.length) socket.write(JSON.stringify(requests.shift()) + '\n');
    else if (waiting <= 0) {
      if (listen) console.error('Wartet auf Mitteilungen von Girovo (Strg+C beendet) …');
      else socket.end();
    }
  }
});
socket.on('error', (err) => {
  console.error(`Keine Verbindung: ${err.message}`);
  process.exitCode = 1;
});
socket.on('close', () => {
  if ((waiting > 0 || listen) && !process.exitCode) {
    console.error('Girovo hat die Verbindung beendet.');
    if (waiting > 0) process.exitCode = 1;
  }
});
process.on('SIGINT', () => {
  socket.end();
  process.exit(0);
});
