// Telemetry client SDK — zero dependencies, works in browsers and Node 18+.
//
//   import { createTelemetry } from "https://<your-telemetry-host>/sdk/telemetry.js";
//   const telemetry = createTelemetry({ endpoint: "https://<your-telemetry-host>", key: "tlm_..." });
//   telemetry.track("signup", { plan: "pro" });
//
// Events are queued and sent in batches. Failed sends are retried with backoff;
// the queue is bounded so a dead endpoint can never exhaust memory.

/**
 * @typedef {Object} TelemetryOptions
 * @property {string} endpoint        Base URL of the telemetry server (or the full /v1/events URL).
 * @property {string} key             Ingest key for the app (tlm_...).
 * @property {string} [release]       App version, e.g. "1.4.2".
 * @property {string} [environment]   e.g. "production", "staging".
 * @property {string} [userId]        Initial user id; see identify().
 * @property {boolean} [anonymousId=true] Browsers: until identify() is called, send a persistent
 *                                    random id ("anon:<uuid>", kept in localStorage) as userId.
 * @property {string} [client]        Name of your app/client, e.g. "WebShop iOS". The server otherwise
 *                                    derives client, OS and device from the User-Agent header.
 * @property {string} [clientVersion] Version of that client.
 * @property {string} [sessionId]     Defaults to a random id (per tab in browsers, per process in Node).
 * @property {number} [flushInterval=5000]  Milliseconds between automatic flushes.
 * @property {number} [maxBatchSize=100]    Events per request.
 * @property {number} [maxQueueSize=2000]   Oldest events are dropped beyond this.
 * @property {boolean} [captureErrors=false] Report uncaught errors (and unhandled rejections in browsers).
 * @property {boolean} [debug=false]  Log SDK activity to the console.
 * @property {boolean} [disabled=false] Turn every call into a no-op (e.g. in tests).
 */

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
const isNode = !isBrowser && typeof process !== "undefined" && !!process.versions?.node;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function browserAnonymousId() {
  try {
    const KEY = "tlm_anon";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `anon:${randomId()}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

/** Node sends a bare "node" User-Agent, so describe the runtime explicitly. */
function nodeClientContext() {
  const os = { win32: "Windows", darwin: "macOS", linux: "Linux", freebsd: "FreeBSD" }[process.platform] ?? process.platform;
  return { client: "Node.js", clientVersion: process.versions.node, os, device: "server" };
}

function browserSessionId() {
  try {
    const KEY = "tlm_session";
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/** @param {unknown} err */
function serializeError(err) {
  if (err instanceof Error) {
    const out = { name: err.name || "Error", message: err.message, stack: err.stack };
    if (err.cause !== undefined) {
      out.cause = err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : String(err.cause);
    }
    return out;
  }
  if (typeof err === "object" && err !== null) {
    let message;
    try {
      message = JSON.stringify(err);
    } catch {
      message = String(err);
    }
    return { name: "NonError", message };
  }
  return { name: "NonError", message: String(err) };
}

/** @param {TelemetryOptions} options */
export function createTelemetry(options) {
  if (!options || !options.endpoint || !options.key) {
    throw new Error("createTelemetry: `endpoint` and `key` are required");
  }
  const url = /\/v1\/events\/?$/.test(options.endpoint)
    ? options.endpoint
    : options.endpoint.replace(/\/+$/, "") + "/v1/events";
  const flushInterval = options.flushInterval ?? 5000;
  const maxBatchSize = Math.min(options.maxBatchSize ?? 100, 1000);
  const maxQueueSize = options.maxQueueSize ?? 2000;
  const debug = !!options.debug;
  const disabled = !!options.disabled;

  const context = {
    ...(isNode ? nodeClientContext() : {}),
    release: options.release,
    environment: options.environment,
    sessionId: options.sessionId ?? (isBrowser ? browserSessionId() : randomId()),
  };
  if (options.client) context.client = options.client;
  if (options.clientVersion) context.clientVersion = options.clientVersion;
  const anonymousId = isBrowser && options.anonymousId !== false ? browserAnonymousId() : undefined;
  let userId = options.userId ?? anonymousId;

  /** @type {Record<string, unknown>[]} */
  let queue = [];
  let inflight = null;
  let backoffUntil = 0;
  let failures = 0;
  let closed = false;

  const log = (...args) => debug && console.debug("[telemetry]", ...args);

  function enqueue(event) {
    if (disabled || closed) return;
    event.timestamp = Date.now();
    if (userId !== undefined && event.userId === undefined) event.userId = userId;
    queue.push(event);
    if (queue.length > maxQueueSize) queue.splice(0, queue.length - maxQueueSize);
    if (queue.length >= maxBatchSize) void flush();
  }

  async function sendBatch(batch, keepalive) {
    const body = JSON.stringify({ context, events: batch });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.key}` },
      body,
      // keepalive lets the request outlive the page, but browsers cap it at 64 KB.
      keepalive: keepalive && body.length < 60_000,
    });
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const err = new Error(`telemetry server responded ${res.status}`);
      err.retryAfter = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
      throw err;
    }
    if (!res.ok) {
      // 4xx other than 429 won't succeed on retry: drop the batch.
      let detail = "";
      try {
        detail = JSON.stringify(await res.json());
      } catch {}
      console.warn(`[telemetry] batch rejected (${res.status}) ${detail}`);
      return;
    }
    log(`sent ${batch.length} events`);
  }

  /** Sends everything queued. Resolves once the queue is drained or a send fails. */
  async function flush({ keepalive = false } = {}) {
    if (inflight) return inflight;
    if (Date.now() < backoffUntil && !keepalive) return;
    inflight = (async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, maxBatchSize);
        try {
          await sendBatch(batch, keepalive);
          failures = 0;
        } catch (err) {
          queue = batch.concat(queue).slice(-maxQueueSize);
          failures++;
          const delay = Math.max(err?.retryAfter ?? 0, Math.min(60_000, 1000 * 2 ** failures));
          backoffUntil = Date.now() + delay;
          log(`send failed, retrying in ${delay}ms:`, err?.message ?? err);
          break;
        }
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const timer = setInterval(() => void flush(), flushInterval);
  if (typeof timer === "object" && timer && typeof timer.unref === "function") timer.unref();

  const cleanups = [];
  if (isBrowser) {
    const onHide = () => document.visibilityState === "hidden" && void flush({ keepalive: true });
    const onPageHide = () => void flush({ keepalive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    cleanups.push(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    });
  } else if (isNode) {
    const onBeforeExit = () => void flush();
    process.on("beforeExit", onBeforeExit);
    cleanups.push(() => process.off("beforeExit", onBeforeExit));
  }

  const api = {
    /** Custom product/analytics event. */
    track(name, properties) {
      enqueue({ type: "event", name: String(name), properties });
    },
    /** Structured log line. level: debug | info | warn | error | fatal */
    log(level, message, properties) {
      enqueue({ type: "log", level, message: String(message), properties });
    },
    /** Report a caught error. Accepts Error objects or anything else. */
    captureError(error, properties) {
      const e = serializeError(error);
      const props = e.cause ? { ...properties, cause: e.cause } : properties;
      enqueue({ type: "error", name: e.name, message: e.message, stack: e.stack, properties: props });
    },
    /** Numeric measurement, e.g. latency or queue depth. */
    metric(name, value, properties) {
      enqueue({ type: "metric", name: String(name), value: Number(value), properties });
    },
    /** Attach a user id to subsequent events (pass undefined to go back to the anonymous id). */
    identify(id) {
      userId = id === undefined || id === null ? anonymousId : String(id);
    },
    /** Update release / environment / sessionId for subsequent batches. */
    setContext(partial) {
      Object.assign(context, partial);
    },
    flush: () => flush(),
    /** Flush and stop timers/listeners. Await this before a Node process exits. */
    async shutdown() {
      clearInterval(timer);
      for (const c of cleanups) c();
      backoffUntil = 0;
      await flush();
      closed = true;
    },
  };

  if (options.captureErrors && !disabled) {
    if (isBrowser) {
      const onError = (ev) => api.captureError(ev.error ?? new Error(ev.message), { source: "window.onerror", url: location.href });
      const onRejection = (ev) => api.captureError(ev.reason, { source: "unhandledrejection", url: location.href });
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
      cleanups.push(() => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
      });
    } else if (isNode) {
      // The *Monitor event observes crashes without changing Node's default exit behavior.
      const onCrash = (err) => {
        api.captureError(err, { source: "uncaughtException", fatal: true });
        void flush();
      };
      process.on("uncaughtExceptionMonitor", onCrash);
      cleanups.push(() => process.off("uncaughtExceptionMonitor", onCrash));
    }
  }

  return api;
}
