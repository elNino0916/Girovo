// The llama-server the Gemma evals talk to, started headless on 127.0.0.1 as
// the desktop app does (src-tauri/src/gemma.rs). By default the app's own
// Gemma folder: llama-b12250 and gemma-4-E2B_q4_0-it.gguf. To compare another
// model, every eval takes
//
//   --model <file.gguf>     another GGUF (its own chat template, --jinja)
//   --server <llama-server> another llama.cpp build, for a model b12250 can't load
//   --mmproj <file.gguf>    the image part (eval-gemma-vision only)
//
// It also measures what a model costs: load time, the GPU memory it adds and
// the server's peak RAM while answering, and per call the median and p90.
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const GEMMA_DIR = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'de.elnino0916.sooskasse-fints', 'gemma');
export const GEMMA_MODEL = 'gemma-4-E2B_q4_0-it.gguf';

const find = (d, name) => {
  if (!fs.existsSync(d)) return null;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const f = find(p, name); if (f) return f; } else if (e.name === name) return p;
  }
  return null;
};

export function modelArgs(args, dir = null) {
  const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
  const d = dir ?? arg('dir') ?? GEMMA_DIR;
  const exe = arg('server') ?? find(path.join(d, 'llama-b12250'), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  const model = arg('model') ?? path.join(d, GEMMA_MODEL);
  if (!exe || !fs.existsSync(exe)) throw new Error(`no llama-server in ${d}`);
  if (!fs.existsSync(model)) throw new Error(`no model at ${model}`);
  return { exe, model, mmproj: arg('mmproj'), label: path.basename(model, '.gguf') };
}

const run = (cmd, argv) => new Promise((r) => execFile(cmd, argv, { windowsHide: true }, (err, out) => r(err ? '' : String(out))));
const gpuUsed = async () => Number((await run('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'])).split('\n')[0]) || null;
async function ramOf(pid) {
  if (process.platform !== 'win32') return null;
  const line = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const kb = /"([\d.,\s]+) K"/.exec(line)?.[1]?.replace(/[^\d]/g, '');
  return kb ? Math.round(Number(kb) / 1024) : null;
}

export async function startLlama({ exe, model, mmproj = null, ctx = 4096 }) {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const key = crypto.randomBytes(32).toString('hex');
  const base = `http://127.0.0.1:${port}`;
  const gpuBefore = await gpuUsed();
  const t0 = performance.now();
  const child = spawn(exe, ['-m', model, ...(mmproj ? ['--mmproj', mmproj] : []), '--host', '127.0.0.1', '--port', String(port), '--jinja', '-c', String(ctx), '-np', '1', '-ngl', '99', '--device', 'Vulkan0', '--no-webui'],
    { env: { ...process.env, LLAMA_API_KEY: key }, stdio: 'ignore', windowsHide: true });
  process.on('exit', () => child.kill());
  for (let i = 0; ; i++) {
    if (child.exitCode != null || i > 900) throw new Error(`llama-server did not start with ${path.basename(model)}`);
    try { if ((await fetch(`${base}/health`, { headers: { authorization: `Bearer ${key}` } })).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const loadMs = Math.round(performance.now() - t0);
  const peak = { gpu: 0, ram: 0 };
  const sample = async () => {
    const [g, m] = await Promise.all([gpuUsed(), ramOf(child.pid)]);
    if (g != null && gpuBefore != null) peak.gpu = Math.max(peak.gpu, g - gpuBefore);
    if (m != null) peak.ram = Math.max(peak.ram, m);
  };
  await sample();
  const timer = setInterval(sample, 3000);
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  return {
    base, headers, loadMs, child, label: path.basename(model, '.gguf'),
    // The app's request (gemma.rs chat_body): greedy, seed 0, no thinking.
    async chat(messages, { maxTokens, json = false, cache = true } = {}) {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ messages, temperature: 0, top_k: 1, seed: 0, max_tokens: maxTokens, ...(cache ? { cache_prompt: true } : {}), chat_template_kwargs: { enable_thinking: false }, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      });
      return String((await r.json()).choices?.[0]?.message?.content ?? '').trim();
    },
    async stop() {
      clearInterval(timer);
      await sample();
      child.kill();
      return { loadMs, gpuMB: peak.gpu || null, ramMB: peak.ram || null };
    },
  };
}

export const spread = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0);
  return { median: at(0.5), p90: at(0.9), n: s.length };
};

export const costLine = (label, cost, calls) => `${label}: load ${cost.loadMs} ms · +${cost.gpuMB ?? '?'} MB GPU · ${cost.ramMB ?? '?'} MB RAM (server peak)${calls ? ` · per call median ${calls.median} ms, p90 ${calls.p90} ms (${calls.n})` : ''}`;
