// fetch() for the background check (mobile/background/entry.ts): every request
// goes to the bank through BackgroundJob.java's HTTPS stack, answered whole.
// lib/bank-fetch.ts wraps it like any global fetch. Imported first, before
// lib-fints and the rest, so the first request already takes this way.

import { Buffer } from 'buffer';
import { bg } from './bridge';

type Answer = { status?: number; statusText?: string; headers?: Record<string, string>; body?: string; error?: string; code?: string };

async function bodyBase64(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return Buffer.from(body, 'utf8').toString('base64');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('base64');
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('base64');
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer()).toString('base64');
  return Buffer.from(String(body), 'utf8').toString('base64');
}

const NULL_BODY = new Set([101, 204, 205, 304]);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const asRequest = input instanceof Request ? input : null;
  const url = asRequest ? asRequest.url : String(input);
  if (!/^https:\/\//i.test(url)) throw Object.assign(new TypeError('fetch failed: only https leaves the app'), { code: 'ERR_TLS_REQUIRED' });
  const headers: Record<string, string> = {};
  asRequest?.headers.forEach((v, k) => (headers[k] = v));
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
  const method = (init?.method ?? asRequest?.method ?? 'GET').toUpperCase();
  const raw = init?.body ?? (asRequest && method !== 'GET' && method !== 'HEAD' ? await asRequest.arrayBuffer() : undefined);
  const answer = JSON.parse(bg().http(JSON.stringify({ url, method, headers, body: await bodyBase64(raw) }))) as Answer;
  if (answer.error || typeof answer.status !== 'number') {
    throw Object.assign(new TypeError(`fetch failed: ${answer.error || 'no answer'}`), { code: answer.code || 'EUNKNOWN' });
  }
  const status = answer.status >= 200 && answer.status <= 599 ? answer.status : 502;
  const body = NULL_BODY.has(status) ? null : Buffer.from(answer.body ?? '', 'base64');
  return new Response(body, { status, statusText: answer.statusText ?? '', headers: answer.headers ?? {} });
};
