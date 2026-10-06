// The structured Verwendungszweck.
//
// A SEPA booking's purpose field is not prose. German banks pack the whole
// structured remittance record into MT940 :86: as a run of four-letter tags
// followed by "+", concatenated without separators:
//
//   EREF+1051808585130MREF+5RRJ2259NXZLLCRED+LU96ZZZ0000000000000000058SVWZ+G2A.COM Limited
//
// Rendered as-is that is one unreadable paragraph, so this splits it back into
// the record it always was: the human-readable text (SVWZ) on one side, the
// identifiers on the other, each keeping its own meaning.
//
// The parser is deliberately conservative — a purpose with no tags in it is
// returned untouched rather than guessed at.

import { msgs } from './i18n/index.ts';

/** The tags a German bank puts in :86:. */
const TAGS = [
  'EREF', 'KREF', 'MREF', 'CRED', 'DEBT', 'COAM', 'OAMT', 'SVWZ', 'ABWA', 'ABWE', 'IBAN', 'BIC',
  'RTRN', 'ORCR', 'ORMR', 'DDAT', 'PURP',
] as const;

type Tag = (typeof TAGS)[number];

/** What a tag means, in the language speaking right now. */
function tagLabel(tag: Tag): string {
  const words = msgs();
  switch (tag) {
    case 'CRED': return words.common.booking.creditorId;
    case 'SVWZ': return words.common.booking.purpose;
    case 'IBAN':
    case 'BIC': return tag;
    default: return words.transfer.purposeTags[tag];
  }
}

// No word boundary before the tag: the tags follow the previous value with no
// separator at all ("...585130MREF+..."), so `\b` would never match.
const TAG_RE = new RegExp(`(${TAGS.join('|')})\\+`, 'g');

/** One identifier of the record. `label` is worded when it is read, so a parse kept across a change of language still names it in the new one. */
export type PurposeField = { tag: string; label: string; value: string };

export type ParsedPurpose = {
  /** The readable remittance text — SVWZ, plus anything ahead of the first tag. */
  text: string;
  /** Every other identifier the field carried, in the order the bank wrote it. */
  fields: PurposeField[];
};

export function parsePurpose(raw: string | null | undefined): ParsedPurpose {
  const s = String(raw ?? '').trim();
  if (!s) return { text: '', fields: [] };

  const marks: { tag: string; start: number; valueStart: number }[] = [];
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(s); m; m = TAG_RE.exec(s)) {
    marks.push({ tag: m[1], start: m.index, valueStart: m.index + m[0].length });
  }
  if (!marks.length) return { text: s, fields: [] };

  const fields: PurposeField[] = [];
  const texts = [s.slice(0, marks[0].start).trim()];

  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : s.length;
    const value = s.slice(mark.valueStart, end).trim();
    if (!value) return;
    const tag = mark.tag as Tag;
    if (tag === 'SVWZ') texts.push(value);
    else fields.push({ tag, get label() { return tagLabel(tag); }, value });
  });

  return { text: texts.filter(Boolean).join(' ').trim(), fields };
}

/**
 * The remittance text with its machine identifiers cut down to a stub.
 *
 * Splitting the tags off is not quite enough for a scannable list: banks
 * routinely leave a bare IBAN, a terminal id or an order number sitting inside
 * the prose itself, and twenty-odd characters that mean nothing at a glance eat
 * exactly the width the payee's name needs. A token long enough to be an
 * identifier and carrying a digit is shortened to its head — the full value is
 * one tap away in the detail drawer, where it can actually be read and copied.
 */
export function condenseRefs(text: string | null | undefined, max = 72): string {
  const out = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      const bare = word.replace(/[^A-Za-z0-9]/g, '');
      // Words a person wrote stay whole, however long: only a run that is both
      // identifier-length and part-numeric is machine output.
      if (bare.length < 12 || !/\d/.test(bare)) return word;
      return `${word.slice(0, 6)}…`;
    })
    .join(' ');
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/**
 * The purpose text split back into its lines.
 *
 * :86: subfields are concatenated, and banks pad the seams with runs of spaces
 * — those runs are the only record left of where one line ended and the next
 * began, so they are worth honouring instead of collapsing into a paragraph.
 */
export function purposeLines(text: string | null | undefined): string[] {
  return String(text ?? '')
    .split(/\r?\n|\s{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
}
