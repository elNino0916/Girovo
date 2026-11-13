// Aufteilen's requests, kept in the vault (VaultData.splitRequests): who was
// asked for how much, from which booking, on which day, and whether it came.
//
// "Alle anfordern" records one request per person (withRequests); a later
// split of the same booking replaces them. A request is settled by the
// bookings, never by hand: money in from that person on or after the day it
// was asked for, as much as everything still open from them up to that day,
// or exactly one open request's amount (settleRequests). The paying
// booking's key and day are kept with it, so a request stays paid once that
// booking has left the loaded Umsätze, and every device settles it the same.
//
// Girovo AI's "Wie viel schuldet mir Lea noch?" sums them (owedByPerson).
//
// Pure: no path aliases, `.ts` on sibling imports.

export type SplitRequest = {
  /** The shared booking's txKey (lib/categories.ts). */
  tx: string;
  /** The person, as typed in Aufteilen. */
  name: string;
  /** Their share in cents. */
  cents: number;
  /** yyyy-mm-dd: the day it was asked for. */
  on: string;
  /** Set once money from them came: the paying booking's day and txKey. */
  paid?: { on: string; by: string };
};

/** At most this many requests (the oldest go first), names this long, amounts this large (cents). */
export const SPLIT_REQUEST_LIMITS = { count: 300, name: 40, key: 200, cents: 100_000_000_00 } as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A name as plain lowercase words, the umlauts as a bank writes them: "Lea Müller" → ["lea", "mueller"]. */
function nameWords(s: string): string[] {
  return s.toLocaleLowerCase('de')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The same person whatever the case or spelling of the umlauts: what a request is told apart by. */
export const personKey = (name: string): string => nameWords(name).join(' ');

/** A request's id within the vault: its booking and its person. */
export const splitRequestId = (r: Pick<SplitRequest, 'tx' | 'name'>): string => `${r.tx}|${personKey(r.name)}`;

/**
 * Whether `full` names the person `asked` names: every word of `asked` is a
 * word of `full` ("Lea" in "LEA MUELLER" or "Mueller, Lea"), an initial
 * ("M.") the start of one. "Lea" is not "Leander".
 */
export function personMatches(full: string, asked: string): boolean {
  const have = nameWords(full);
  const want = nameWords(asked);
  if (!want.length || !have.length) return false;
  return want.every((w) => have.some((h) => (w.length === 1 ? h.startsWith(w) : h === w)));
}

/**
 * The requests as the vault may keep them: well formed, one per booking and
 * person (the last given wins), within the caps (the newest kept).
 * Whatever else an entry carries never reaches the file.
 */
export function sanitizeSplitRequests(input: unknown): SplitRequest[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, SplitRequest>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<SplitRequest>;
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, SPLIT_REQUEST_LIMITS.name) : '';
    if (typeof r.tx !== 'string' || !r.tx || r.tx.length > SPLIT_REQUEST_LIMITS.key || !personKey(name)) continue;
    if (typeof r.cents !== 'number' || !Number.isInteger(r.cents) || r.cents <= 0 || r.cents > SPLIT_REQUEST_LIMITS.cents) continue;
    if (typeof r.on !== 'string' || !DAY.test(r.on)) continue;
    const p = r.paid;
    const paid = p && typeof p === 'object' && typeof p.on === 'string' && DAY.test(p.on)
      && typeof p.by === 'string' && p.by.length > 0 && p.by.length <= SPLIT_REQUEST_LIMITS.key
      ? { on: p.on, by: p.by } : null;
    const clean: SplitRequest = { tx: r.tx, name, cents: r.cents, on: r.on, ...(paid ? { paid } : {}) };
    const id = splitRequestId(clean);
    byId.delete(id);
    byId.set(id, clean);
  }
  const out = [...byId.values()];
  if (out.length <= SPLIT_REQUEST_LIMITS.count) return out;
  const keep = new Set([...out].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).slice(0, SPLIT_REQUEST_LIMITS.count));
  return out.filter((r) => keep.has(r));
}

/**
 * The requests after Aufteilen asked for `people`' shares of booking `tx` on
 * `on`: the booking's earlier requests replaced, a person asked again for
 * the same amount keeping what was already paid.
 */
export function withRequests(
  list: readonly SplitRequest[], tx: string, people: readonly { name: string; cents: number }[], on: string,
): SplitRequest[] {
  const before = new Map(list.filter((r) => r.tx === tx).map((r) => [splitRequestId(r), r]));
  const added = people.map((p): SplitRequest => {
    const r: SplitRequest = { tx, name: p.name.trim(), cents: Math.round(p.cents), on };
    const old = before.get(splitRequestId(r));
    return old?.paid && old.cents === r.cents ? { ...r, on: old.on, paid: old.paid } : r;
  });
  return sanitizeSplitRequests([...list.filter((r) => r.tx !== tx), ...added]);
}

/** Money in, as the settling sees it: its key, day, amount in cents and the names it came under. */
export type Incoming = { key: string; day: string; cents: number; names: readonly string[] };

/**
 * The requests with what the bookings paid marked paid: each booking in from
 * a person, on or after the day of their open requests, settles all of them
 * when it covers their sum, else the oldest one it equals; nothing for less.
 * A booking settles once. The same array back when nothing changed.
 */
export function settleRequests(list: readonly SplitRequest[], incoming: readonly Incoming[]): readonly SplitRequest[] {
  if (!list.some((r) => !r.paid)) return list;
  const used = new Set(list.flatMap((r) => (r.paid ? [r.paid.by] : [])));
  const out = [...list];
  let changed = false;
  const order = incoming
    .filter((b) => b.cents > 0 && DAY.test(b.day) && !used.has(b.key))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const b of order) {
    const open = out
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.paid && r.on <= b.day && b.names.some((n) => personMatches(n, r.name)))
      .sort((x, y) => (x.r.on < y.r.on ? -1 : x.r.on > y.r.on ? 1 : 0));
    if (!open.length) continue;
    const sum = open.reduce((s, { r }) => s + r.cents, 0);
    const exact = open.find(({ r }) => r.cents === b.cents);
    const settle = b.cents >= sum ? open : exact ? [exact] : [];
    for (const { r, i } of settle) out[i] = { ...r, paid: { on: b.day, by: b.key } };
    if (settle.length) changed = true;
  }
  return changed ? out : list;
}

export type PersonOwed = {
  /** The name as last typed. */
  name: string;
  /** Their open requests, the oldest first, and the sum. */
  open: SplitRequest[];
  openCents: number;
  /** Their paid requests, the newest payment first, and the sum. */
  paid: SplitRequest[];
  paidCents: number;
};

/**
 * What each person still owes and has paid, the one owing most first; only
 * the people `asked` names ("lea" finds "Lea Müller"), or everyone for null.
 */
export function owedByPerson(list: readonly SplitRequest[], asked: string | null): PersonOwed[] {
  const people = new Map<string, PersonOwed>();
  const latest = new Map<string, string>();
  for (const r of list) {
    if (asked && !personMatches(r.name, asked)) continue;
    const key = personKey(r.name);
    const p = people.get(key) ?? { name: r.name, open: [], openCents: 0, paid: [], paidCents: 0 };
    if (r.paid) {
      p.paid.push(r);
      p.paidCents += r.cents;
    } else {
      p.open.push(r);
      p.openCents += r.cents;
    }
    if (r.on >= (latest.get(key) ?? '')) {
      latest.set(key, r.on);
      p.name = r.name;
    }
    people.set(key, p);
  }
  for (const p of people.values()) {
    p.open.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
    p.paid.sort((a, b) => (a.paid!.on < b.paid!.on ? 1 : a.paid!.on > b.paid!.on ? -1 : 0));
  }
  return [...people.values()].sort((a, b) => b.openCents - a.openCents || b.paidCents - a.paidCents || a.name.localeCompare(b.name, 'de'));
}
