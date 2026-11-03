// "Neue Umsätze melden" (6.0): Girovo looks at the user's banks while nobody
// has it open, and says what arrived. The desktop shell asks for a check
// every six hours while it runs (electron/background.cjs), the phone from a
// job of its own (BackgroundJob.java, mobile/background/); both end up here.
//
// A check needs the PIN without the user, which nothing else in Girovo keeps:
//
// - The PINs of the logins it was turned on for are kept in one sealed box,
//   with what each account's last check saw. Its key comes from a secret the
//   shell keeps with the system's protection — DPAPI or the keyring on the
//   desktop (electron/linked-unlock.cjs), an Android Keystore key on the phone
//   — and only from that: there is no gesture to wait for. The box lives
//   where the shell says (lib/background-store.ts).
// - Only logins with a remembered device are taken: a check opens it on this
//   device (no synchronisation) and reads the last two weeks' Umsätze, which
//   banks hand out without an approval within PSD2's exemption. A bank that
//   asks for one anyway pauses its login until the user logs in again
//   (touch); so does a remembered device that no longer opens with the kept
//   PIN — then nothing is sent to the bank at all.
// - A PIN the bank turns down is deleted at once — saved before the next
//   login is checked — and never tried again: a few wrong tries lock the
//   online banking. Any other answer from the bank ends that login's check
//   for this round, so one round never sends a PIN more than once after it
//   went wrong.
// - What is new is told by the booking's key (lib/categories.ts txKey),
//   counted, so two equal bookings on one day are two. The first check of an
//   account only learns what is there.
//
// Every change to the box is a compare-and-set (lib/background-store.ts): on
// the phone the page and the job are two runtimes, and a check must never
// bring back what the user just switched off or changed meanwhile.
//
// The bank's side (opening a login, reading Umsätze) comes in as `BankSide`,
// so `node --test` runs everything else (lib/background-check.test.ts); the
// real one is lib/background-bank.ts.

import crypto from 'node:crypto';
import { newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { txKey } from './categories.ts';
import { displayName, fmtSignedMoney } from './format.ts';
import type { SerializedTransaction } from './fints-types';
import { msgs } from './i18n/index.ts';
import type { SealedLogin } from './linked-unlock.ts';
import { sameLogin } from './linked-banks.ts';
import type { BackgroundStore } from './background-store.ts';

/** A login kept for the checks: its PIN, its bank's name, and whether it waits for the user. */
export type CheckedLogin = SealedLogin & {
  bank: string;
  /** 'approval': the bank asked for one; 'login': the remembered device no longer opens. */
  paused?: 'approval' | 'login';
  /** When the last check read from its bank. */
  checkedAt?: string;
};

type Box = {
  v: 1;
  /** Whether a notice shows amounts. */
  amounts: boolean;
  logins: CheckedLogin[];
  /** By login (blz|userId), by account: the keys of the bookings seen, one per booking. */
  seen: Record<string, Record<string, string[]>>;
};

/** What a check found worth saying, ready to show — one per bank and kind. */
export type Notice = {
  /** Stable per bank and kind, so a later notice replaces an earlier one. */
  key: string;
  kind: 'new' | 'approval' | 'login' | 'refused';
  title: string;
  text: string;
  /** The new bookings, one line each (kind 'new'). */
  lines: string[];
};

/** `on`: whether the checks are still on afterwards — the shell stops planning them when not. */
export type CheckResult = { checked: number; notices: Notice[]; on: boolean };

/** One account of an opened login. */
export type CheckedAccount = { accountNumber: string };

/** The bank's side of a check (lib/background-bank.ts). */
export type BankSide = {
  /** The login opened on its remembered device — no bank traffic — or 'login' when it does not open. */
  open(login: CheckedLogin): Promise<{ handle: string; accounts: CheckedAccount[] } | 'login'>;
  read(handle: string, accountNumber: string, from: Date): Promise<
    | { kind: 'ok'; transactions: SerializedTransaction[] }
    | { kind: 'approval' | 'refused' | 'failed' }
  >;
  close(handle: string): void;
  /** Whether the user is in this login right now (their own session reads it then). */
  busy(login: CheckedLogin): boolean;
};

export const SECRET_BYTES = 32;
/** How far back a check reads: within the exemption, and enough for a booking dated back a few days. */
export const WINDOW_DAYS = 14;
/** How long a seen key is remembered. */
const SEEN_DAYS = 45;
const SEEN_MAX = 600;
const LINES_MAX = 5;
const LOGINS_MAX = 8;
const PIN_MAX = 64;
const BOX_MAX_BYTES = 512 * 1024;
/** Tries of a compare-and-set before a change is given up for this round. */
const CAS_TRIES = 5;
const DOMAIN = 'girovo/background/v1';
const DAY_MS = 86_400_000;

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const loginKey = (l: Pick<SealedLogin, 'blz' | 'userId'>) => `${l.blz}|${l.userId}`;
const keyFor = (secret: Buffer) => crypto.createHash('sha256').update(DOMAIN).update(secret).digest();
const AAD = Buffer.from(DOMAIN, 'utf8');

/** The shell's secret from a request: exactly SECRET_BYTES in base64, else null. */
export function parseSecret(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const secret = Buffer.from(value, 'base64');
  return secret.length === SECRET_BYTES ? secret : null;
}

function readLogin(v: unknown): CheckedLogin | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  const [blz, userId, pin, bank] = [str('blz'), str('userId'), str('pin'), str('bank')];
  if (!/^\d{8}$/.test(blz) || !userId || userId.length > 64 || CONTROLS.test(userId)) return null;
  if (!pin || pin.length > PIN_MAX || CONTROLS.test(pin)) return null;
  const paused = r.paused === 'approval' || r.paused === 'login' ? r.paused : undefined;
  const checkedAt = typeof r.checkedAt === 'string' && !Number.isNaN(Date.parse(r.checkedAt)) ? r.checkedAt : undefined;
  return {
    blz, userId, pin, bank: bank.slice(0, 80) || blz,
    ...(paused ? { paused } : {}),
    ...(checkedAt ? { checkedAt } : {}),
  };
}

function sanitizeBox(v: unknown): Box {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const logins: CheckedLogin[] = [];
  for (const raw of Array.isArray(r.logins) ? r.logins : []) {
    const l = readLogin(raw);
    if (l && !logins.some((k) => sameLogin(k, l))) logins.push(l);
    if (logins.length === LOGINS_MAX) break;
  }
  const seen: Box['seen'] = {};
  const rawSeen = (r.seen && typeof r.seen === 'object' ? r.seen : {}) as Record<string, unknown>;
  for (const l of logins) {
    const byAccount = rawSeen[loginKey(l)];
    if (!byAccount || typeof byAccount !== 'object') continue;
    const out: Record<string, string[]> = {};
    for (const [acct, keys] of Object.entries(byAccount as Record<string, unknown>)) {
      if (acct.length > 64 || !Array.isArray(keys)) continue;
      out[acct] = keys.filter((k): k is string => typeof k === 'string' && k.length <= 300).slice(-SEEN_MAX);
    }
    seen[loginKey(l)] = out;
  }
  return { v: 1, amounts: r.amounts !== false, logins, seen };
}

/**
 * One check at a time in a runtime. Every other change goes through
 * compare-and-set (`change`), which keeps it right beside a running check —
 * in this runtime or the other one on the phone.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

/** The box opened from its text: null when there is none; 'stale' when it does not open with this secret. */
function openText(raw: string | null, secret: Buffer): Box | null | 'stale' {
  if (raw == null) return null;
  if (raw.length > BOX_MAX_BYTES) return 'stale';
  try {
    const box = parseBox(JSON.parse(raw));
    if (!box) return 'stale';
    return sanitizeBox(JSON.parse(openBox(keyFor(secret), box, AAD).toString('utf8')));
  } catch {
    return 'stale';
  }
}

const sealText = (secret: Buffer, box: Box): string =>
  JSON.stringify(sealBox(keyFor(secret), newSalt(), Buffer.from(JSON.stringify(box), 'utf8'), AAD));

/**
 * One change to the box, made on what is there now: `apply` gets the box (or
 * null) and answers the new one, null to delete it, or 'keep'. Written only
 * if nobody changed the box meanwhile — else read again and made again.
 * Answers the box as it stands afterwards (null when there is none).
 */
async function change(
  store: BackgroundStore, secret: Buffer, apply: (box: Box | null) => Box | null | 'keep',
): Promise<Box | null> {
  for (let i = 0; i < CAS_TRIES; i++) {
    const raw = await store.read();
    const opened = openText(raw, secret);
    // A box this secret does not open can never be used again: it goes.
    const box = opened === 'stale' ? null : opened;
    const next = opened === 'stale' ? (() => { const n = apply(null); return n === 'keep' ? null : n; })() : apply(box);
    if (next === 'keep') return box;
    if (next && !next.logins.length) {
      if (await store.write(null, raw)) return null;
      continue;
    }
    if (await store.write(next ? sealText(secret, next) : null, raw)) return next;
  }
  // Someone keeps changing it: this round's change is given up, the next one tries again.
  const opened = openText(await store.read(), secret);
  return opened === 'stale' ? null : opened;
}

/** Whether the checks are on — the switch's state; needs no secret. */
export async function isOn(store: BackgroundStore): Promise<boolean> {
  return (await store.read()) != null;
}

/** The logins the checks are on for, without their PINs (the settings row); null when off or unreadable. */
export async function enrolled(store: BackgroundStore, secret: Buffer): Promise<{ amounts: boolean; logins: Array<Omit<CheckedLogin, 'pin'>> } | null> {
  const box = openText(await store.read(), secret);
  if (!box || box === 'stale') return null;
  return { amounts: box.amounts, logins: box.logins.map(({ pin: _pin, ...rest }) => rest) };
}

/**
 * Turns the checks on for `logins` — the ones with a remembered device, with
 * the PINs the bank took this session — replacing the logins kept before
 * (and keeping what each one's accounts were seen with). Returns how many.
 */
export async function enroll(store: BackgroundStore, secret: Buffer, logins: readonly CheckedLogin[], amounts: boolean): Promise<number> {
  const after = await change(store, secret, (prior) => {
    const kept = sanitizeBox({ logins: logins.map(({ paused: _p, ...l }) => l) }).logins.map((l) => {
      const before = prior?.logins.find((p) => sameLogin(p, l));
      return before?.checkedAt ? { ...l, checkedAt: before.checkedAt } : l;
    });
    const seen: Box['seen'] = {};
    for (const l of kept) if (prior?.seen[loginKey(l)]) seen[loginKey(l)] = prior.seen[loginKey(l)];
    return { v: 1, amounts, logins: kept, seen };
  });
  return after?.logins.length ?? 0;
}

/** Turns the checks off: every kept PIN goes, whatever else is happening. Needs no secret. */
export async function disable(store: BackgroundStore): Promise<void> {
  await store.write(null);
}

/** One login's PIN goes (its bank refused it in the app, or the bank was removed); the rest stay. */
export async function forget(store: BackgroundStore, secret: Buffer, login: Pick<SealedLogin, 'blz' | 'userId'>): Promise<void> {
  await change(store, secret, (box) => {
    if (!box || !box.logins.some((l) => sameLogin(l, login))) return 'keep';
    const seen = { ...box.seen };
    delete seen[loginKey(login)];
    return { ...box, logins: box.logins.filter((l) => !sameLogin(l, login)), seen };
  });
}

/**
 * The user logged in and the bank took the PIN: a kept login takes that PIN
 * (it may have been changed) and checks resume. With `account` and `keys`,
 * the bookings the app just showed count as seen — no notice for them later.
 */
export async function touch(
  store: BackgroundStore, secret: Buffer, login: SealedLogin, account?: string, keys?: readonly string[],
): Promise<boolean> {
  let kept = false;
  await change(store, secret, (box) => {
    const at = box ? box.logins.findIndex((l) => sameLogin(l, login)) : -1;
    if (!box || at < 0) return 'keep';
    kept = true;
    const { paused: _p, ...rest } = box.logins[at];
    const logins = [...box.logins];
    logins[at] = { ...rest, pin: login.pin };
    const seen = { ...box.seen };
    if (account && keys?.length && account.length <= 64) {
      const lk = loginKey(login);
      // An account never checked yet starts from what the app has shown.
      seen[lk] = { ...seen[lk], [account]: mergeSeen(seen[lk]?.[account] ?? [], [...keys]) };
    }
    return { ...box, logins, seen };
  });
  return kept;
}

const countOf = (keys: readonly string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};
const dayOf = (key: string) => key.slice(0, 10);

/** Seen keys: each as often as either list has it, the last SEEN_DAYS, at most SEEN_MAX. */
export function mergeSeen(prior: readonly string[], current: readonly string[], now = Date.now()): string[] {
  const a = countOf(prior);
  const b = countOf(current);
  const cutoff = new Date(now - SEEN_DAYS * DAY_MS).toISOString().slice(0, 10);
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayOf(k)) && dayOf(k) < cutoff) continue;
    const n = Math.max(a.get(k) ?? 0, b.get(k) ?? 0);
    for (let i = 0; i < n; i++) out.push(k);
  }
  out.sort((x, y) => (dayOf(x) < dayOf(y) ? -1 : dayOf(x) > dayOf(y) ? 1 : 0));
  return out.slice(-SEEN_MAX);
}

/** The bookings in `current` that `seen` does not have (counted: the second of two equal ones is new). */
export function newBookings(seen: readonly string[], current: readonly SerializedTransaction[]): SerializedTransaction[] {
  const left = countOf(seen);
  const out: SerializedTransaction[] = [];
  // Oldest first, so of two equal bookings the earlier counts as the one seen.
  const ordered = [...current].sort((x, y) => String(x.entryDate || x.valueDate).localeCompare(String(y.entryDate || y.valueDate)));
  for (const t of ordered) {
    const k = txKey(t);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else out.push(t);
  }
  return out;
}

/** One booking as a notice's line: the amount (unless amounts are off) and who. */
function lineOf(t: SerializedTransaction, amounts: boolean): string {
  const who = displayName(t.remoteName) || displayName(t.purpose).slice(0, 60) || msgs().background.someone;
  return amounts ? `${fmtSignedMoney(t.amount, t.currency || 'EUR')} · ${who}` : who;
}

function noticeFor(kind: Notice['kind'], login: CheckedLogin, lines: string[] = [], count = 0): Notice {
  const said = msgs().background;
  const key = `${login.blz}|${login.userId}|${kind}`;
  switch (kind) {
    case 'new':
      return { key, kind, title: said.newTitle(count, login.bank), text: lines.slice(0, 2).join('\n'), lines };
    case 'approval':
      return { key, kind, title: said.approvalTitle(login.bank), text: said.approvalText, lines };
    case 'login':
      return { key, kind, title: said.loginTitle(login.bank), text: said.loginText, lines };
    default:
      return { key, kind, title: said.refusedTitle(login.bank), text: said.refusedText(login.bank), lines };
  }
}

/** What one login's check came to, made on the box as it is then (see `change`). */
type Outcome =
  | { kind: 'pause'; why: 'approval' | 'login'; seen?: Record<string, string[]> }
  | { kind: 'refused' }
  | { kind: 'read'; seen: Record<string, string[]>; checkedAt?: string };

function settle(box: Box | null, login: CheckedLogin, outcome: Outcome, now: number): Box | 'keep' {
  const at = box ? box.logins.findIndex((l) => sameLogin(l, login)) : -1;
  // Switched off, or this login forgotten, meanwhile: nothing comes back.
  if (!box || at < 0) return 'keep';
  const current = box.logins[at];
  const lk = loginKey(login);
  const logins = [...box.logins];
  const seen = { ...box.seen };
  const mergeIn = (read?: Record<string, string[]>) => {
    if (!read) return;
    const merged = { ...seen[lk] };
    for (const [acct, keys] of Object.entries(read)) merged[acct] = mergeSeen(merged[acct] ?? [], keys, now);
    seen[lk] = merged;
  };
  if (outcome.kind === 'refused') {
    // The user typed a new PIN meanwhile (touch): that one was never tried.
    if (current.pin !== login.pin) return 'keep';
    delete seen[lk];
    return { ...box, logins: logins.filter((_, i) => i !== at), seen };
  }
  mergeIn(outcome.seen);
  if (outcome.kind === 'pause') {
    if (current.pin === login.pin) logins[at] = { ...current, paused: outcome.why };
  } else if (outcome.checkedAt) {
    logins[at] = { ...current, checkedAt: outcome.checkedAt };
  }
  return { ...box, logins, seen };
}

/**
 * One check of every kept login that is not paused and not in use: new
 * bookings as notices, a bank that wants an approval or a device that no
 * longer opens paused (said once), a refused PIN deleted — each saved before
 * the next login is checked.
 */
export function runCheck(store: BackgroundStore, secret: Buffer, bank: BankSide, now = Date.now()): Promise<CheckResult> {
  return serialized(async () => {
    const start = openText(await store.read(), secret);
    // A box this secret does not open (the shell's secret is new) can never
    // be used: it goes, and the switch reads as off.
    if (start === 'stale') {
      await store.write(null);
      return { checked: 0, notices: [], on: false };
    }
    if (!start) return { checked: 0, notices: [], on: false };
    const notices: Notice[] = [];
    let checked = 0;
    let on = true;
    for (const login of start.logins) {
      if (login.paused || bank.busy(login)) continue;
      const opened = await bank.open(login).catch(() => null);
      if (!opened) continue;
      let outcome: Outcome;
      const fresh: SerializedTransaction[] = [];
      if (opened === 'login') {
        outcome = { kind: 'pause', why: 'login' };
        notices.push(noticeFor('login', login));
      } else {
        checked++;
        const seenNow = start.seen[loginKey(login)] ?? {};
        const read: Record<string, string[]> = {};
        let stop: 'approval' | 'refused' | 'failed' | null = null;
        const last = login.checkedAt ? Date.parse(login.checkedAt) : NaN;
        const from = new Date(Math.max(now - WINDOW_DAYS * DAY_MS, Number.isNaN(last) ? 0 : last - 3 * DAY_MS));
        try {
          for (const account of opened.accounts) {
            const got = await bank.read(opened.handle, account.accountNumber, from).catch(() => ({ kind: 'failed' as const }));
            // Whatever the bank said instead of Umsätze ends this login's
            // round: never one more dialog with a PIN that may be wrong.
            if (got.kind !== 'ok') {
              stop = got.kind;
              break;
            }
            const prior = seenNow[account.accountNumber];
            // The first check of an account only learns what is there.
            if (prior) fresh.push(...newBookings(prior, got.transactions));
            read[account.accountNumber] = got.transactions.map(txKey);
          }
        } finally {
          bank.close(opened.handle);
        }
        const anyRead = Object.keys(read).length > 0;
        if (stop === 'refused') {
          outcome = { kind: 'refused' };
          notices.push(noticeFor('refused', login));
        } else if (stop === 'approval') {
          outcome = { kind: 'pause', why: 'approval', seen: read };
          notices.push(noticeFor('approval', login));
        } else {
          // A round where the bank answered nothing does not count as read:
          // the next one reaches back as far as this one would have.
          outcome = { kind: 'read', seen: read, ...(anyRead ? { checkedAt: new Date(now).toISOString() } : {}) };
        }
        if (fresh.length) {
          const newest = [...fresh].sort((x, y) => String(y.entryDate || y.valueDate).localeCompare(String(x.entryDate || x.valueDate)));
          const lines = newest.slice(0, LINES_MAX).map((t) => lineOf(t, start.amounts));
          if (newest.length > LINES_MAX) lines.push(msgs().background.more(newest.length - LINES_MAX));
          notices.push(noticeFor('new', login, lines, fresh.length));
        }
      }
      const after = await change(store, secret, (box) => settle(box, login, outcome, now));
      if (!after) {
        on = false;
        break;
      }
    }
    return { checked, notices, on };
  });
}
