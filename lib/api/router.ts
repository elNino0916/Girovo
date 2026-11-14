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
//   6. Phase 2: the write methods (./writes.ts) change things through the
//      host's actions, the provider's own setters; settings (./settings.ts)
//      only from the allowlist; bank.refresh and transfers.request
//      (./transfers.ts) go through Girovo's own screens and the user;
//      events.subscribe (./events.ts) per connection, ended with it.
//
// Every call goes into the Verlauf (host.log), answered or not; a transfer
// request's line says later how it ended (host.setLogOutcome).
//
// Pure and node-test-safe: the host (components/api/ApiHost.tsx) brings the
// vault, the data, the dialog and the clock.

import { EVENT_PERMISSION, dataEvents, eventMethod, eventTargets, isEventKind, type DataSnapshot, type Subscription } from './events.ts';
import { clientKey, findGrant, grantSubject, orderedPermissions, touchedGrant, withGrant } from './grants.ts';
import {
  accountsList, budgetsList, contractsList, goalsList, insightsMonth, transactionsList,
  type ApiData, type MethodOutcome,
} from './methods.ts';
import { NEVER_KEYS, isSettingKey, settingsGet, settingsSet, type SettingsHost } from './settings.ts';
import {
  TransferRequests, refreshAnswer, refreshTarget, transferAsk, transferView,
  type RefreshReport, type TransferAsk, type TransferRecord,
} from './transfers.ts';
import {
  categoriesCreate, categoriesSet, budgetsSet, contractsRename, goalsSet, notesSet, remindersSet, rulesAdd,
  type ApiActions,
} from './writes.ts';
import {
  isApiPermission,
  type ApiCall, type ApiClient, type ApiError, type ApiErrorCode, type ApiEventKind, type ApiGrant, type ApiLogEntry, type ApiPermission,
  type ApiReplyPayload, type TransferState,
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

  // Phase 2. Each optional: without it the methods that need it answer `internal`.
  /** The provider's setters for the write methods; null while there is no vault to write to. */
  actions?: () => ApiActions | null;
  /** The settings an app may read and change. */
  settings?: SettingsHost;
  /**
   * Reads new data from the bank as the app's own reads do (every account
   * that can be read, or the one key), the Freigabe in Girovo's window where
   * the bank asks for one; settles once done and the page shows the result.
   */
  refresh?: (key: string | null) => Promise<RefreshReport>;
  /** Opens Girovo's transfer sheet filled in for the request (queued behind a sheet already open), in front. */
  openTransfer?: (request: TransferRecord, ask: TransferAsk, client: ApiClient) => void;
  /** Sends a JSON-RPC notification to a connection (the shell's notify); nothing when the connection is gone. */
  notify?: (connection: string, method: string, params: unknown) => void;
  /** A transfer request's line in the Verlauf says how it ended. */
  setLogOutcome?: (request: string, outcome: TransferState) => void;
};

/** What a method works with. */
type Ctx = { data: ApiData; params: unknown; call: ApiCall; conn: string; key: string };
type Method = { permission: ApiPermission | null; run: (ctx: Ctx) => MethodOutcome | Promise<MethodOutcome> };

/** Phase 1: the read methods and the permission each needs. */
export const METHODS: Readonly<Record<string, Method>> = {
  'girovo.accounts.list': { permission: 'accounts.read', run: ({ data }) => accountsList(data) },
  'girovo.transactions.list': { permission: 'transactions.read', run: ({ data, params }) => transactionsList(data, params) },
  'girovo.contracts.list': { permission: 'insights.read', run: ({ data }) => contractsList(data) },
  'girovo.budgets.list': { permission: 'insights.read', run: ({ data, params }) => budgetsList(data, params) },
  'girovo.goals.list': { permission: 'insights.read', run: ({ data }) => goalsList(data) },
  'girovo.insights.month': { permission: 'insights.read', run: ({ data, params }) => insightsMonth(data, params) },
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
/** Why a change was not permitted (data.reason), for the app's developer. */
const REASONS: Record<string, string> = {
  never: 'This setting can only be changed in Girovo itself.',
  deletes_data: 'Turning this off deletes saved data. The user can do it in Girovo.',
  consent: 'Only the user can agree to this, in Girovo.',
  plus: 'Savings goals need Girovo Plus in this version.',
  busy: 'Too many transfer requests are waiting for the user.',
};
// i18n-data-end

const fail = (code: ApiErrorCode, data?: unknown, message = MESSAGES[code]): { error: ApiError } =>
  ({ error: { code, message, ...(data !== undefined ? { data } : {}) } });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const clean = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

type Hello = { app: string; version?: string; reason?: string };

const thisMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

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
  /** events.subscribe, per connection. */
  private readonly subs = new Map<string, Subscription>();
  /** transfers.request, for the page's life. */
  readonly transfers = new TransferRequests();
  /** One bank.refresh at a time: the next waits for it. */
  private refreshing: Promise<unknown> = Promise.resolve();
  /** The data as the events last saw it. */
  private snapshot: DataSnapshot | null = null;
  /** Every method with its permission, bound to this router. */
  private readonly methods: Readonly<Record<string, Method>>;

  constructor(host: RouterHost) {
    this.host = host;
    const write = (fn: (data: ApiData, actions: ApiActions, params: unknown) => MethodOutcome): Method['run'] => ({ data, params }) => {
      const actions = this.host.actions?.();
      return actions ? fn(data, actions, params) : { fail: 'locked' };
    };
    this.methods = {
      ...METHODS,
      'girovo.categories.set': { permission: 'categories.write', run: write(categoriesSet) },
      'girovo.rules.add': { permission: 'categories.write', run: write(rulesAdd) },
      'girovo.categories.create': { permission: 'categories.write', run: write(categoriesCreate) },
      'girovo.notes.set': { permission: 'notes.write', run: write(notesSet) },
      'girovo.budgets.set': { permission: 'budgets.write', run: write(budgetsSet) },
      'girovo.goals.set': { permission: 'budgets.write', run: write((d, a, p) => goalsSet(d, a, p, thisMonth(this.host.now()))) },
      'girovo.reminders.set': { permission: 'budgets.write', run: write(remindersSet) },
      'girovo.contracts.rename': { permission: 'budgets.write', run: write(contractsRename) },
      'girovo.settings.get': {
        permission: 'settings.read',
        run: ({ data }) => (this.host.settings ? settingsGet(data, this.host.settings) : { fail: 'internal' }),
      },
      'girovo.settings.set': {
        permission: 'settings.write',
        run: ({ data, params }) => (this.host.settings ? settingsSet(data, this.host.settings, params) : { fail: 'internal' }),
      },
      'girovo.bank.refresh': { permission: 'bank.refresh', run: (ctx) => this.refresh(ctx) },
      'girovo.transfers.request': { permission: 'transfers.request', run: (ctx) => this.requestTransfer(ctx) },
      'girovo.transfers.status': {
        permission: 'transfers.request',
        run: ({ params, key }) => {
          const id = params && typeof params === 'object' ? (params as { request?: unknown }).request : undefined;
          const r = this.transfers.get(id, key);
          return r ? { result: transferView(r) } : { invalid: 'request' };
        },
      },
      'girovo.events.subscribe': { permission: null, run: (ctx) => this.subscribe(ctx, true) },
      'girovo.events.unsubscribe': { permission: null, run: (ctx) => this.subscribe(ctx, false) },
    };
  }

  /** The app hung up: its hello is forgotten, its open dialog closed, its subscriptions ended. */
  closed(connection: string | number): void {
    const conn = String(connection);
    this.hellos.delete(conn);
    this.subs.delete(conn);
    for (const c of this.waiting.get(conn) ?? []) c.abort();
    this.waiting.delete(conn);
  }

  /** Every connection gone (the API switched off, the logout): nothing of them is kept, refusals are. */
  reset(): void {
    for (const conn of [...this.waiting.keys()]) this.closed(conn);
    this.hellos.clear();
    this.subs.clear();
    this.snapshot = null;
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
    const setting = method === 'settings.set' ? (call.params as { key?: unknown } | null)?.key : undefined;
    const known = isSettingKey(setting) || (NEVER_KEYS as readonly unknown[]).includes(setting);
    const request = method === 'transfers.request' && ok ? (reply as { result: { request?: string } }).result.request : undefined;
    this.host.log({
      at: this.host.now().toISOString(),
      app: key,
      name: grant?.name ?? grantSubject(call.client).who.name,
      method: method || '?',
      ok,
      ...(ok ? {} : { code: (reply as { error: ApiError }).error.code }),
      ...(known ? { detail: setting as string } : {}),
      ...(request ? { request, outcome: 'pending' as const } : {}),
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

    const method = Object.hasOwn(this.methods, call.method) ? this.methods[call.method] : undefined;
    if (!method) return fail('method_not_found', { method: call.method });
    const grant = findGrant(this.host.grants(), call.client);
    if (method.permission && !grant?.permissions.includes(method.permission)) return fail('not_permitted', { permission: method.permission });
    const data = this.host.data();
    if (!data) return fail('locked');
    const out = await method.run({ data, params: call.params, call, conn, key });
    const at = this.host.now().toISOString();
    this.host.setGrants((grants) => touchedGrant(grants, key, at));
    if ('invalid' in out) return fail('invalid', { param: out.invalid, ...(out.data ?? {}) });
    if ('fail' in out) {
      const reason = (out.data as { reason?: string } | undefined)?.reason;
      return fail(out.fail, out.data, out.message ?? (reason ? REASONS[reason] : undefined) ?? MESSAGES[out.fail]);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // bank.refresh
  // -------------------------------------------------------------------------

  private async refresh({ data, params }: Ctx): Promise<MethodOutcome> {
    const target = refreshTarget(data, params);
    if ('invalid' in target) return target;
    const run = this.host.refresh;
    if (!run) return { fail: 'internal' };
    // One at a time: a second waits for the first, then reads on its own.
    const turn = this.refreshing.then(async (): Promise<MethodOutcome> => {
      const before = this.host.data() ?? data;
      const report = await run(target.key);
      const after = this.host.data();
      if (!after) return { fail: 'locked' };
      return refreshAnswer(before, after, report);
    });
    this.refreshing = turn.catch(() => {});
    return turn;
  }

  // -------------------------------------------------------------------------
  // transfers.request
  // -------------------------------------------------------------------------

  private requestTransfer({ data, params, call, conn, key }: Ctx): MethodOutcome {
    const checked = transferAsk(data, params);
    if ('invalid' in checked) return checked;
    if (!this.host.openTransfer) return { fail: 'internal' };
    const record = this.transfers.create(key, conn, this.host.now().toISOString());
    if (!record) return { fail: 'not_permitted', data: { reason: 'busy' } };
    this.host.openTransfer(record, checked.ask, call.client);
    return { result: transferView(record) };
  }

  /**
   * The user acted on a request (components/TransferSheet.tsx through
   * ApiHost): its state is final, the Verlauf says so, and the app hears it
   * on the connection that asked and on any of its own subscribed to
   * transfer.updated.
   */
  settleTransfer(id: string, state: Exclude<TransferState, 'pending'>, extra: { text?: string; changed?: boolean } = {}): TransferRecord | null {
    const record = this.transfers.settle(id, state, this.host.now().toISOString(), extra);
    if (!record) return null;
    this.host.setLogOutcome?.(id, state);
    const targets = new Set(eventTargets(this.subs.values(), this.host.grants(), 'transfer.updated', (c) => clientKey(c) === record.app));
    if (this.hellos.has(record.connection)) targets.add(record.connection);
    const view = transferView(record);
    for (const conn of targets) this.host.notify?.(conn, eventMethod('transfer.updated'), view);
    return record;
  }

  /** Every request still waiting ends as refused (the logout, the API switched off). */
  settlePending(): void {
    for (const r of this.transfers.pending()) this.settleTransfer(r.id, 'refused');
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------

  private subscribe({ params, call, conn }: Ctx, on: boolean): MethodOutcome {
    const raw = params && typeof params === 'object' && !Array.isArray(params) ? (params as { kinds?: unknown }).kinds : undefined;
    const current = new Set(this.subs.get(conn)?.kinds ?? []);
    if (!on && raw === undefined) current.clear();
    else {
      if (!Array.isArray(raw) || (on && !raw.length) || raw.length > 10) return { invalid: 'kinds' };
      const bad = raw.find((k) => !isEventKind(k));
      if (bad !== undefined) return { invalid: 'kinds', data: { kind: bad } };
      const kinds = raw as ApiEventKind[];
      if (on) {
        // Only what the app may read: each kind is covered by one permission.
        const grant = findGrant(this.host.grants(), call.client);
        const missing = kinds.find((k) => !grant?.permissions.includes(EVENT_PERMISSION[k]));
        if (missing) return { fail: 'not_permitted', data: { permission: EVENT_PERMISSION[missing], kind: missing } };
        for (const k of kinds) current.add(k);
      } else for (const k of kinds) current.delete(k);
    }
    if (current.size) this.subs.set(conn, { connection: conn, client: call.client, kinds: current });
    else this.subs.delete(conn);
    return { result: { subscribed: [...current] } };
  }

  /** Whether any connection listens to anything. */
  hasSubscribers(): boolean {
    return this.subs.size > 0;
  }

  /**
   * The page's data changed (ApiHost calls this with every new snapshot): new
   * bookings and changed balances go to the connections subscribed to them
   * whose app may read them. The first snapshot is only a starting point.
   */
  dataChanged(next: DataSnapshot, data: ApiData): void {
    const prev = this.snapshot;
    this.snapshot = next;
    if (!prev || !this.subs.size || !this.host.notify) return;
    const grants = this.host.grants();
    for (const event of dataEvents(prev, next, data)) {
      for (const conn of eventTargets(this.subs.values(), grants, event.kind)) this.host.notify(conn, eventMethod(event.kind), event.params);
    }
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
