// Girovo API: events.subscribe and the notifications it brings
// (docs/girovo-api.md). A connection subscribes to kinds; each kind is
// covered by one permission and goes only to an app that still has it (a
// permission taken back in Einstellungen stops its events at once). A
// subscription ends with its connection.
//
//   bookings.new      girovo.bookings.new { account, count, bookings[] }: bookings that
//                     came in for an account already loaded (after a fetch, a refresh)
//   balances.changed  girovo.balances.changed { account, balance, available }: an
//                     account's balance read anew with another figure, or for the first time
//   transfer.updated  girovo.transfer.updated { request, state, text?, changed? }: a request of
//                     the app's own settled (the asking connection hears it without subscribing)
//
// An account first loaded after the API went on is a starting point, not news:
// its bookings are not reported as new (the app reads them with transactions.list).
//
// Pure and node-test-safe.

import { findGrant } from './grants.ts';
import { accountId, accountsList, bookingById, bookingIds, type ApiData } from './methods.ts';
import {
  API_EVENT_KINDS,
  type ApiClient, type ApiEventKind, type ApiGrant, type ApiPermission,
} from './types.ts';

export const EVENT_PERMISSION: Readonly<Record<ApiEventKind, ApiPermission>> = {
  'bookings.new': 'transactions.read',
  'balances.changed': 'accounts.read',
  'transfer.updated': 'transfers.request',
};

export const isEventKind = (v: unknown): v is ApiEventKind => typeof v === 'string' && (API_EVENT_KINDS as readonly string[]).includes(v);

/** The notification's JSON-RPC method for a kind. */
export const eventMethod = (kind: ApiEventKind): string => `girovo.${kind}`;

export type Subscription = { connection: string; client: ApiClient; kinds: ReadonlySet<ApiEventKind> };

/**
 * The connections a notification of `kind` goes to: subscribed to it, and
 * their app still holds its permission. `app`: only connections of that app
 * (grant key), for a transfer request's own news.
 */
export function eventTargets(
  subs: Iterable<Subscription>, grants: readonly ApiGrant[], kind: ApiEventKind, only?: (client: ApiClient) => boolean,
): string[] {
  const out: string[] = [];
  for (const s of subs) {
    if (!s.kinds.has(kind)) continue;
    if (only && !only(s.client)) continue;
    if (!findGrant(grants, s.client)?.permissions.includes(EVENT_PERMISSION[kind])) continue;
    out.push(s.connection);
  }
  return out;
}

/** What the events compare from one render of the data to the next. */
export type DataSnapshot = {
  bookings: Map<string, Set<string>>;
  /** Per account key: its balance as a string (cents, currency, day), '' while not read. */
  balances: Map<string, string>;
};

const balanceSig = (b: ApiData['accounts'][number]['balance']) =>
  (b ? `${Math.round(b.balance * 100)}|${b.currency}|${String(b.date ?? '')}|${b.availableAmount ?? ''}` : '');

export function snapshotOf(data: ApiData): DataSnapshot {
  return {
    bookings: bookingIds(data),
    balances: new Map(data.accounts.map((a) => [a.key, balanceSig(a.balance)])),
  };
}

/** The most bookings one notification carries; `count` says how many came. */
export const EVENT_BOOKINGS_MAX = 100;

export type DataEvent = { kind: 'bookings.new' | 'balances.changed'; params: Record<string, unknown> };

/** What changed between two snapshots, as notifications. */
export function dataEvents(prev: DataSnapshot, next: DataSnapshot, data: ApiData): DataEvent[] {
  const out: DataEvent[] = [];
  for (const [key, ids] of next.bookings) {
    const had = prev.bookings.get(key);
    if (!had) continue;
    const added = [...ids].filter((id) => !had.has(id));
    if (!added.length) continue;
    out.push({
      kind: 'bookings.new',
      params: {
        account: accountId(key),
        count: added.length,
        bookings: added.slice(0, EVENT_BOOKINGS_MAX).map((id) => bookingById(data, id)).filter(Boolean),
      },
    });
  }
  let listed: { id: string; balance: unknown; available: unknown }[] | null = null;
  for (const [key, sig] of next.balances) {
    const had = prev.balances.get(key);
    if (had === undefined || had === sig || !sig) continue;
    listed ??= ((accountsList(data) as { result: { accounts: { id: string; balance: unknown; available: unknown }[] } }).result.accounts);
    const item = listed.find((x) => x.id === accountId(key));
    if (item) out.push({ kind: 'balances.changed', params: { account: item.id, balance: item.balance, available: item.available } });
  }
  return out;
}
