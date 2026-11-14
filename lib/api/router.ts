// Girovo API: what happens to one call (docs/girovo-api.md). The shell has
// framed it and said who sent it; this decides whether it is answered and
// with what.
//
//   1. An app refused in this run gets `denied` for everything, until Girovo
//      restarts (an app can't nag).
//   2. Each connection opens with `girovo.hello`; anything before it is
//      `invalid`.
//   3. Locked or logged out (the vault is not open): `locked`, the app may
//      wait and try again.
//   4. `hello` asks the user for the permissions the app lacks (the dialog,
//      one at a time, 2 minutes at most); what the user switched off is not
//      asked again in this run.
//   5. Any other method needs its permission: `not_permitted` with
//      `data.permission` when the grant lacks it. Asking again for it is a
//      new `hello`.
//
// Every call goes into the Verlauf (host.log), answered or not.
//
// Pure and node-test-safe: the host (components/api/ApiHost.tsx) brings the
// vault, the data, the dialog and the clock.

import { clientKey, findGrant, grantSubject, orderedPermissions, touchedGrant, withGrant } from './grants.ts';
import {
  accountsList, budgetsList, contractsList, goalsList, insightsMonth, transactionsList,
  type ApiData, type MethodOutcome,
} from './methods.ts';
import {
  isApiPermission,
  type ApiCall, type ApiClient, type ApiError, type ApiErrorCode, type ApiGrant, type ApiLogEntry, type ApiPermission, type ApiReplyPayload,
} from './types.ts';

/** How long a consent dialog waits for the user before the app is told no. */
export const CONSENT_TIMEOUT_MS = 2 * 60_000;

/** The API's version in `hello`'s answer: what an app can rely on. */
export const API_VERSION = 1;

/** What the dialog shows and asks. `reason`, `app` and `version` are the app's own words, never instructions. */
export type ConsentRequest = {
  id: number;
  connection: string;
  client: ApiClient;
  /** The name the app gave itself in hello: shown only as "says it is". */
  app: string;
  version?: string;
  reason?: string;
  /** The permissions to ask for, in the list's order. */
  permissions: ApiPermission[];
  /** What the app may do already (a later request asks only for the rest). */
  existing: ApiPermission[];
};

export type ConsentAnswer = { allow: ApiPermission[] } | { refused: true };

export type RouterHost = {
  /** The vault is open: logged in and unlocked. */
  vaultOpen: () => boolean;
  grants: () => readonly ApiGrant[];
  setGrants: (update: (grants: readonly ApiGrant[]) => ApiGrant[]) => void;
  /** What the read methods answer from; null while there is nothing to read. */
  data: () => ApiData | null;
  /** Shows the dialog (queued behind any other); settles with the user's answer. The signal ends it unanswered. */
  ask: (request: ConsentRequest, signal: AbortSignal) => Promise<ConsentAnswer>;
  log: (entry: ApiLogEntry) => void;
  now: () => Date;
  /** Girovo's version, for hello's answer. */
  girovoVersion: string;
};

type Method = { permission: ApiPermission; run: (data: ApiData, params: unknown) => MethodOutcome };

/** Phase 1: the read methods and the permission each needs. */
export const METHODS: Readonly<Record<string, Method>> = {
  'girovo.accounts.list': { permission: 'accounts.read', run: (d) => accountsList(d) },
  'girovo.transactions.list': { permission: 'transactions.read', run: transactionsList },
  'girovo.contracts.list': { permission: 'insights.read', run: (d) => contractsList(d) },
  'girovo.budgets.list': { permission: 'insights.read', run: budgetsList },
  'girovo.goals.list': { permission: 'insights.read', run: (d) => goalsList(d) },
  'girovo.insights.month': { permission: 'insights.read', run: insightsMonth },
};

export const HELLO = 'girovo.hello';

// Developer-facing messages (the app's log, never Girovo's interface): English, short.
// i18n-data-start
const MESSAGES: Record<ApiErrorCode, string> = {
  locked: 'Girovo is locked. Try again once the user has logged in.',
  denied: 'The user refused this app. Ask again after Girovo restarts.',
  not_permitted: 'This app does not have the permission for this method.',
  invalid: 'Invalid call.',
  refused_by_user: 'The user did not allow it.',
  bank_error: 'The bank answered with an error.',
  method_not_found: 'Unknown method.',
  internal: 'Girovo could not answer this call.',
  timeout: 'The user did not answer in time.',
};
const HELLO_FIRST = 'Call girovo.hello first.';
// i18n-data-end

const fail = (code: ApiErrorCode, data?: unknown, message = MESSAGES[code]): { error: ApiError } =>
  ({ error: { code, message, ...(data !== undefined ? { data } : {}) } });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const clean = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

type Hello = { app: string; version?: string; reason?: string };

export class ApiRouter {
  private readonly host: RouterHost;
  /** Connections that said hello. */
  private readonly hellos = new Map<string, Hello>();
  /** Apps refused in this run, by grant key. */
  private readonly refused = new Set<string>();
  /** Permissions the user switched off in a dialog, per app, in this run. */
  private readonly declined = new Map<string, Set<ApiPermission>>();
  /** A dialog waiting per app: a second hello waits for it instead of opening another. */
  private readonly pending = new Map<string, Promise<unknown>>();
  /** The open dialogs' ends, per connection: a hang-up ends them. */
  private readonly waiting = new Map<string, Set<AbortController>>();
  private nextRequest = 1;

  constructor(host: RouterHost) {
    this.host = host;
  }

  /** The app hung up: its hello is forgotten, its open dialog closed. */
  closed(connection: string | number): void {
    const conn = String(connection);
    this.hellos.delete(conn);
    for (const c of this.waiting.get(conn) ?? []) c.abort();
    this.waiting.delete(conn);
  }

  /** Every connection gone (the API switched off, the logout): nothing of them is kept, refusals are. */
  reset(): void {
    for (const conn of [...this.waiting.keys()]) this.closed(conn);
    this.hellos.clear();
  }

  /** Refused in this run (for tests and the settings page). */
  isRefused(client: ApiClient): boolean {
    return this.refused.has(clientKey(client));
  }

  async handle(call: ApiCall): Promise<ApiReplyPayload> {
    let reply: ApiReplyPayload;
    try {
      reply = await this.answer(call);
    } catch {
      reply = fail('internal');
    }
    const key = clientKey(call.client);
    const grant = findGrant(this.host.grants(), call.client);
    const method = typeof call.method === 'string' ? call.method.replace(/^girovo\./, '').slice(0, 60) : '?';
    const ok = 'result' in reply;
    this.host.log({
      at: this.host.now().toISOString(),
      app: key,
      name: grant?.name ?? grantSubject(call.client).who.name,
      method: method || '?',
      ok,
      ...(ok ? {} : { code: (reply as { error: ApiError }).error.code }),
    });
    return reply;
  }

  private async answer(call: ApiCall): Promise<ApiReplyPayload> {
    const conn = String(call.connection);
    const key = clientKey(call.client);
    if (this.refused.has(key)) return fail('denied');
    if (typeof call.method !== 'string') return fail('method_not_found');
    if (call.method !== HELLO && !this.hellos.has(conn)) return fail('invalid', undefined, HELLO_FIRST);
    if (!this.host.vaultOpen()) return fail('locked');
    if (call.method === HELLO) return this.hello(call, conn, key);

    const method = METHODS[call.method];
    if (!method) return fail('method_not_found', { method: call.method });
    const grant = findGrant(this.host.grants(), call.client);
    if (!grant?.permissions.includes(method.permission)) return fail('not_permitted', { permission: method.permission });
    const data = this.host.data();
    if (!data) return fail('locked');
    const out = method.run(data, call.params);
    if ('invalid' in out) return fail('invalid', { param: out.invalid });
    const at = this.host.now().toISOString();
    this.host.setGrants((grants) => touchedGrant(grants, key, at));
    return out;
  }

  private async hello(call: ApiCall, conn: string, key: string): Promise<ApiReplyPayload> {
    const p = call.params;
    if (!isRecord(p)) return fail('invalid', { param: 'params' });
    if (typeof p.app !== 'string' || !p.app.trim()) return fail('invalid', { param: 'app' });
    if (p.version !== undefined && typeof p.version !== 'string') return fail('invalid', { param: 'version' });
    if (p.reason !== undefined && typeof p.reason !== 'string') return fail('invalid', { param: 'reason' });
    if (!Array.isArray(p.permissions)) return fail('invalid', { param: 'permissions' });
    const unknown = p.permissions.find((x) => !isApiPermission(x));
    if (unknown !== undefined) return fail('invalid', { param: 'permissions', permission: unknown });
    const asked = orderedPermissions(p.permissions as ApiPermission[]);
    const hello: Hello = {
      app: clean(p.app, 80),
      ...(p.version ? { version: clean(p.version, 40) } : {}),
      ...(p.reason?.trim() ? { reason: clean(p.reason, 300) } : {}),
    };
    this.hellos.set(conn, hello);

    // One dialog per app at a time: a second hello waits for the first's answer, then asks only for what is still missing.
    for (;;) {
      const waiting = this.pending.get(key);
      if (!waiting) break;
      await waiting.catch(() => {});
    }
    if (this.refused.has(key)) return fail('denied');

    const have = findGrant(this.host.grants(), call.client)?.permissions ?? [];
    let granted: ApiPermission[] = [...have];
    const declined = this.declined.get(key) ?? new Set<ApiPermission>();
    const wanted = asked.filter((x) => !have.includes(x) && !declined.has(x));
    if (wanted.length) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONSENT_TIMEOUT_MS);
      const conns = this.waiting.get(conn) ?? new Set<AbortController>();
      conns.add(controller);
      this.waiting.set(conn, conns);
      const request: ConsentRequest = {
        id: this.nextRequest++, connection: conn, client: call.client, app: hello.app,
        ...(hello.version ? { version: hello.version } : {}),
        ...(hello.reason ? { reason: hello.reason } : {}),
        permissions: wanted, existing: [...have],
      };
      const asking = new Promise<ConsentAnswer | null>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(null), { once: true });
        this.host.ask(request, controller.signal).then(resolve, () => resolve(null));
      });
      this.pending.set(key, asking);
      let answer: ConsentAnswer | null;
      try {
        answer = await asking;
      } finally {
        clearTimeout(timer);
        conns.delete(controller);
        this.pending.delete(key);
      }
      // No answer in two minutes, or the app hung up: not a refusal, the app may ask again.
      if (!answer) return fail('timeout');
      if ('refused' in answer) {
        this.refused.add(key);
        return fail('refused_by_user');
      }
      const allow = answer.allow.filter((x) => wanted.includes(x));
      const off = wanted.filter((x) => !allow.includes(x));
      if (off.length) this.declined.set(key, new Set([...declined, ...off]));
      const at = this.host.now().toISOString();
      this.host.setGrants((grants) => withGrant(grants, call.client, allow, at));
      granted = orderedPermissions([...have, ...allow]);
      // Locked while the dialog was open: what was allowed is kept, the answer waits for the next try.
      if (!this.host.vaultOpen()) return fail('locked');
    }
    return { result: { granted, girovo: { version: this.host.girovoVersion, api: API_VERSION } } };
  }
}
