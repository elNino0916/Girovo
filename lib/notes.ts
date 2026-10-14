// Notes on bookings: a line the user writes about one booking ("Geschenk für
// Mama", "Rechnung 2026-117, erstattet"), kept in the vault under the
// booking's txKey (lib/categories.ts) — the key that finds the same booking
// again after the statement is fetched anew.
//
// A note is the user's own, like everything in the vault. It is shown in the
// booking's drawer and marked on its row, the Umsätze search and the palette
// find it, and the CSV export carries it (a file the user saves for
// themselves). The printed Buchungsbeleg never does: a third party reads that.
// It goes nowhere else — no log line, no telemetry, no request but the
// encrypted vault's own.
//
// Sanitised the same way on both sides — by the client before it keeps one,
// by the vault on the way in and out — so what the user sees is what comes
// back after the next login: one line, controls gone, at most 280 characters;
// at most NOTE_LIMITS.count notes in at most NOTE_LIMITS.bytes of the vault,
// the newest kept.
//
// Pure and node-test-safe.

/** The longest note, in characters (code points). */
export const NOTE_MAX_CHARS = 280;

/**
 * Generous for a person, and well inside the vault's 512 KB beside
 * everything else it holds: about 2,000 notes of an ordinary length, or 700
 * that use all 280 characters.
 */
export const NOTE_LIMITS = {
  count: 5000,
  /** UTF-8 bytes the notes may take in the vault's JSON, keys included. */
  bytes: 256 * 1024,
  /** txKey() length — the vault's limit for every map key. */
  key: 200,
};

// C0/C1 controls and the Unicode line/paragraph separators (as lib/vault.ts):
// a note is one line, and a stray control breaks a CSV cell or a search.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * A note as it may be kept: one line, controls and runs of white space made a
 * single space, trimmed, clipped to NOTE_MAX_CHARS without cutting a
 * character in two. '' for anything that is not a string or says nothing.
 */
export function cleanNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > NOTE_MAX_CHARS ? chars.slice(0, NOTE_MAX_CHARS).join('').trimEnd() : s;
}

/** Whether `k` can key a note. Keys are never clipped — a shortened key is a different booking. */
const keyOk = (k: string) => k.length > 0 && k.length <= NOTE_LIMITS.key && k !== '__proto__' && !HAS_CONTROL.test(k);

/** UTF-8 bytes of a string. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** What one note costs in the vault's JSON: `"key":"text",`. */
const entryBytes = (key: string, text: string) => utf8Bytes(JSON.stringify(key)) + utf8Bytes(JSON.stringify(text)) + 2;

/**
 * The newest notes that fit: `entries` oldest first (the order the client
 * writes them in), at most NOTE_LIMITS.count of them, then as many of the
 * newest as fit NOTE_LIMITS.bytes.
 */
function capEntries(entries: [string, string][]): [string, string][] {
  const counted = entries.slice(-NOTE_LIMITS.count);
  let bytes = 0;
  let start = counted.length;
  while (start > 0) {
    const [k, t] = counted[start - 1];
    const cost = entryBytes(k, t);
    if (bytes + cost > NOTE_LIMITS.bytes) break;
    bytes += cost;
    start--;
  }
  return counted.slice(start);
}

/**
 * The notes as this version understands them, or {} for anything that is not
 * a map of them. Unusable keys are refused (never clipped), notes cleaned and
 * empty ones dropped; over the caps the oldest go — the client adds and
 * rewrites a note at the end, so the last entries are the newest.
 */
export function sanitizeNotes(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const entries: [string, string][] = [];
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!keyOk(k)) continue;
    const text = cleanNote(raw);
    if (text) entries.push([k, text]);
  }
  const out: Record<string, string> = {};
  for (const [k, t] of capEntries(entries)) out[k] = t;
  return out;
}

/**
 * `notes` with the note for `key` set to `text` (cleaned) — moved to the end,
 * as the newest — or removed when `text` says nothing. The same object when
 * nothing changes. `dropped`: how many of the oldest notes the caps took to
 * make room, so the user can be told.
 */
export function withNote(
  notes: Record<string, string>,
  key: string,
  text: string | null,
): { notes: Record<string, string>; dropped: number } {
  const clean = cleanNote(text ?? '');
  const has = Object.prototype.hasOwnProperty.call(notes, key);
  if (!keyOk(key)) return { notes, dropped: 0 };
  if (!clean) {
    if (!has) return { notes, dropped: 0 };
    const next = { ...notes };
    delete next[key];
    return { notes: next, dropped: 0 };
  }
  if (has && notes[key] === clean) return { notes, dropped: 0 };
  const entries = Object.entries(notes).filter(([k]) => k !== key);
  entries.push([key, clean]);
  const kept = capEntries(entries);
  const out: Record<string, string> = {};
  for (const [k, t] of kept) out[k] = t;
  return { notes: out, dropped: entries.length - kept.length };
}
