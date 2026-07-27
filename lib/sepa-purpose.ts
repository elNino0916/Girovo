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

/** The tags a German bank puts in :86:, and what each one means. */
const TAGS: Record<string, string> = {
  EREF: 'End-to-End-Referenz',
  KREF: 'Kundenreferenz',
  MREF: 'Mandatsreferenz',
  CRED: 'Gläubiger-ID',
  DEBT: 'Originator-ID',
  COAM: 'Zinskompensationsbetrag',
  OAMT: 'Ursprungsbetrag',
  SVWZ: 'Verwendungszweck',
  ABWA: 'Abweichender Auftraggeber',
  ABWE: 'Abweichender Empfänger',
  IBAN: 'IBAN',
  BIC: 'BIC',
  RTRN: 'Rückgabegrund',
  ORCR: 'Ursprüngliche Gläubiger-ID',
  ORMR: 'Ursprüngliche Mandatsreferenz',
  DDAT: 'Fälligkeitsdatum',
  PURP: 'Zahlungsart',
};

// No word boundary before the tag: the tags follow the previous value with no
// separator at all ("...585130MREF+..."), so `\b` would never match.
const TAG_RE = new RegExp(`(${Object.keys(TAGS).join('|')})\\+`, 'g');

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
    if (mark.tag === 'SVWZ') texts.push(value);
    else fields.push({ tag: mark.tag, label: TAGS[mark.tag], value });
  });

  return { text: texts.filter(Boolean).join(' ').trim(), fields };
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
