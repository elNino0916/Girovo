// What a logout says, and what it must not lose without a word.
//
// "Vorgänge dieser Sitzung" (components/Inbox.tsx) is the session's own log
// of the transfers it sent. A logout clears it with everything else the
// session holds, so before one the app looks there for orders whose outcome
// is not known ("Status unklar") — the one thing in it a user could act on
// wrongly afterwards, by sending the money again.

import type { ActivityEntry } from './app-types';

/** The session log's transfers whose outcome is not known, newest first (as the log keeps them). */
export function unclearTransfers(log: readonly ActivityEntry[]): ActivityEntry[] {
  return log.filter((e) => e.kind === 'transfer' && e.outcome === 'unknown');
}

/** "an Lea Becker", "an Lea Becker und Max Mustermann", "an A, B und C" — each payee once. */
export function payeeList(names: readonly string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return '';
  if (unique.length === 1) return `an ${unique[0]}`;
  return `an ${unique.slice(0, -1).join(', ')} und ${unique[unique.length - 1]}`;
}

/**
 * The notice after the user logged out (`user`), or called off the login's
 * own approval (`cancelled`). The PIN clause only once the server has
 * confirmed it dropped the session: the session object held the PIN, and
 * with it gone the app has nothing left to use it with. Nothing more is
 * claimed — the bank is not told, and memory is not wiped byte by byte.
 */
export function logoutNotice(kind: 'user' | 'cancelled', sessionDropped: boolean): string {
  const said = kind === 'cancelled' ? 'Anmeldung abgebrochen.' : 'Du hast dich abgemeldet.';
  return sessionDropped ? `${said} Die App hat deine PIN verworfen.` : said;
}

/** The notice after the automatic logout, naming the transfers whose status is unclear (`count` of them). */
export function idleLogoutNotice(payees: readonly string[], count = payees.length): string {
  const base = 'Du wurdest aus Sicherheitsgründen abgemeldet.';
  if (count <= 0) return base;
  const to = payeeList(payees);
  if (count === 1) {
    return `${base} Der Status deiner Überweisung${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.`;
  }
  return `${base} Der Status von ${count} Überweisungen${to ? ` ${to}` : ''} ist unklar – prüfe deine Umsätze, bevor du eine davon noch einmal sendest.`;
}

/**
 * The bank's answer to an order without the line that only repeats the
 * outcome tag beside it ("Auftrag ausgeführt." under "Ausgeführt"). What
 * else the bank said stays, word for word.
 */
export function answerBeyondOutcome(entry: Pick<ActivityEntry, 'outcome' | 'message'>): string {
  const lines = String(entry.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (entry.outcome !== 'executed') return lines.join('\n');
  return lines.filter((l) => !/^(der )?auftrag (wurde )?ausgeführt\.?$/i.test(l)).join('\n');
}
