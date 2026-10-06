// What a logout says, and what it must not lose without a word.
//
// "Vorgänge dieser Sitzung" (components/Inbox.tsx) is the session's own log
// of the transfers it sent. A logout clears it with everything else the
// session holds, so before one the app looks there for orders whose outcome
// is not known ("Status unklar") — the one thing in it a user could act on
// wrongly afterwards, by sending the money again.
//
// The notices are written when they are shown (msgs(), in the language on
// screen); the bank's answers in the log stay in its own words.

import type { ActivityEntry } from './app-types';
import { msgs } from './i18n/index.ts';

/** The session log's transfers whose outcome is not known, newest first (as the log keeps them). */
export function unclearTransfers(log: readonly ActivityEntry[]): ActivityEntry[] {
  return log.filter((e) => e.kind === 'transfer' && e.outcome === 'unknown');
}

/** "an Lea Becker", "an Lea Becker und Max Mustermann", "an A, B und C" ("to A, B and C") — each payee once. */
export function payeeList(names: readonly string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return '';
  return msgs().provider.logout.payees(unique.slice(0, -1), unique[unique.length - 1]);
}

/**
 * The notice after the user logged out (`user`), or called off the login's
 * own approval (`cancelled`). The PIN clause only once the server has
 * confirmed it dropped the session: the session object held the PIN, and
 * with it gone the app has nothing left to use it with. Nothing more is
 * claimed — the bank is not told, and memory is not wiped byte by byte.
 */
export function logoutNotice(kind: 'user' | 'cancelled', sessionDropped: boolean): string {
  const said = msgs().provider.logout;
  const notice = kind === 'cancelled' ? said.loginCancelled : said.byUser;
  return sessionDropped ? `${notice} ${said.pinDropped}` : notice;
}

/** The notice after the automatic logout, naming the transfers whose status is unclear (`count` of them). */
export function idleLogoutNotice(payees: readonly string[], count = payees.length): string {
  const said = msgs().provider.logout;
  if (count <= 0) return said.idle;
  const to = payeeList(payees);
  return `${said.idle} ${count === 1 ? said.unclearOne(to) : said.unclearMany(count, to)}`;
}

/**
 * The bank's answer to an order without the line that only repeats the
 * outcome tag beside it ("Auftrag ausgeführt." under "Ausgeführt"). What
 * else the bank said stays, word for word.
 */
export function answerBeyondOutcome(entry: Pick<ActivityEntry, 'outcome' | 'message'>): string {
  const lines = String(entry.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (entry.outcome !== 'executed') return lines.join('\n');
  // The bank's own words — data, never translated.
  return lines.filter((l) => !/^(der )?auftrag (wurde )?ausgeführt\.?$/i.test(l)).join('\n'); // i18n-data
}
