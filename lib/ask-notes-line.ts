// Girovo AI's notes as one line on the desktop's Übersicht (Girovo Next,
// components/overview/AiNoteLine.tsx): the most pressing note of the running
// month, and how many more there are. Its cross closes every note the line
// counts, kept in the vault as this device's own (aiNotesClosed), so the line
// comes back only with a note it has not shown before.
//
// Pure and node-test-safe: no path aliases.

/** The most closed note keys kept: the newest. Notes are about this month, so old keys only wait to go. */
export const CLOSED_MAX = 60;
/** A note key's longest form (a double debit's carries the payee's key). */
export const CLOSED_KEY_MAX = 300;

/** The closed note keys as they may be kept: strings, each once, the newest CLOSED_MAX; undefined for none. */
export function sanitizeClosedNotes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys = [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= CLOSED_KEY_MAX))];
  return keys.length ? keys.slice(-CLOSED_MAX) : undefined;
}

/** `closed` with `keys` added as the newest, the oldest let go past CLOSED_MAX. */
export function withClosedNotes(closed: readonly string[] | undefined, keys: readonly string[]): string[] {
  const added = keys.filter((k) => k.length > 0 && k.length <= CLOSED_KEY_MAX);
  const fresh = new Set(added);
  return [...(closed ?? []).filter((k) => !fresh.has(k)), ...fresh].slice(-CLOSED_MAX);
}

/**
 * What the line says: the first note not closed (the notes come most pressing
 * first, lib/ask-notes.ts), how many more are open, and every open key (what
 * its cross closes). Null when every note is closed or there is none.
 */
export function lineNote<T extends { key: string }>(
  notes: readonly T[],
  closed: readonly string[] | undefined,
): { note: T; more: number; keys: string[] } | null {
  const shut = new Set(closed ?? []);
  const open = notes.filter((n) => !shut.has(n.key));
  if (!open.length) return null;
  return { note: open[0], more: open.length - 1, keys: open.map((n) => n.key) };
}
