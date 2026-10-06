// Finds interface text written straight into the code instead of
// lib/i18n/messages — German, since German is what the code was written in.
//
// Used by lib/i18n/guard.test.ts for the whole tree and by
// scripts/i18n-check.mjs for a list of files. It looks at string literals and
// JSX text, never at comments, and flags what reads as German: an umlaut or ß,
// or one of the small words no German sentence goes without.
//
// German that is data, not interface — a bank's booking texts the code
// recognises, the category model's descriptions, a search synonym — is marked
// as such in the source:
//
//   'KARTENZAHLUNG',  // i18n-data
//   // i18n-data-next-line
//   // i18n-data-start  …  // i18n-data-end
//
// Pure and dependency-free, like lib/categories.ts.

export type Finding = { line: number; text: string };

/** What German interface text looks like to a scanner. */
// i18n-data-start — the markers themselves
const GERMAN = new RegExp(
  '[äöüÄÖÜß]|\\b(?:der|die|das|dem|den|des|und|oder|nicht|ist|sind|war|ein|eine|einen|einem|einer|du|dein|deine|deinen|deinem|deiner|'
  + 'dich|dir|mit|für|auf|noch|nur|wird|werden|wurde|kann|kein|keine|keinen|bitte|Bitte|zum|zur|vom|beim|bei|aus|nach|'
  + 'Abbrechen|Schließen|Speichern|Löschen|Weiter|Zurück|Fehler|Betrag|Konto|Konten|Umsätze|Überweisung)\\b',
);
// i18n-data-end

/** Text that is code, not language: an identifier, a path, a class list, a format string. */
const CODE_LIKE = /^[\w$.\-/:#%@*+=?&|[\]()]*$/;

type Region = { kind: 'code' | 'string' | 'comment'; text: string; line: number };

/**
 * Splits a source into code, string literals and comments. Template literals
 * count as strings as a whole, placeholders included — good enough to find
 * prose, which is all this is for.
 */
function regions(src: string): Region[] {
  const out: Region[] = [];
  let i = 0;
  let line = 1;
  let start = 0;
  let startLine = 1;
  const push = (kind: Region['kind'], end: number) => {
    if (end > start) out.push({ kind, text: src.slice(start, end), line: startLine });
    start = end;
    startLine = line;
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      push('code', i);
      while (i < src.length && src[i] !== '\n') i++;
      push('comment', i);
      continue;
    }
    if (c === '/' && next === '*') {
      push('code', i);
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      push('comment', i);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      push('code', i);
      const quote = c;
      i++;
      let closed = false;
      while (i < src.length) {
        if (src[i] === quote) {
          closed = true;
          break;
        }
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') {
          // A quote that runs to the end of a line was an apostrophe in JSX
          // text or a regex, not a string; the line break stays for the count.
          if (quote !== '`') break;
          line++;
        }
        i++;
      }
      if (closed) i++;
      push('string', i);
      continue;
    }
    if (c === '\n') line++;
    i++;
  }
  push('code', src.length);
  return out;
}

/** The lines marked as data: `i18n-data` on the line, the line after `i18n-data-next-line`, or a start/end block. */
function dataLines(src: string): Set<number> {
  const lines = src.split('\n');
  const out = new Set<number>();
  let block = false;
  lines.forEach((l, idx) => {
    const n = idx + 1;
    if (/i18n-data-start/.test(l)) block = true;
    if (block || /i18n-data(?!-)/.test(l)) out.add(n);
    if (/i18n-data-next-line/.test(l)) out.add(n + 1);
    if (/i18n-data-end/.test(l)) block = false;
  });
  return out;
}

/** German interface text in a source file, with the line it starts on. */
export function scanSource(src: string): Finding[] {
  const found: Finding[] = [];
  for (const { line, text } of literals(src)) {
    if (CODE_LIKE.test(text) || !GERMAN.test(text)) continue;
    found.push({ line, text: clip(text) });
  }
  return found;
}

/**
 * The literals of a source that are exactly one of `known` — the German
 * texts of lib/i18n/messages. Finds what the markers cannot: a single word
 * ("Gutschrift") left behind next to its own entry in the messages.
 */
export function scanKnown(src: string, known: ReadonlySet<string>): Finding[] {
  const found: Finding[] = [];
  for (const { line, text } of literals(src)) if (known.has(text)) found.push({ line, text: clip(text) });
  return found;
}

const clip = (t: string) => (t.length > 90 ? `${t.slice(0, 89)}…` : t);

/**
 * Every string literal and every run of JSX text in a source, cleaned up —
 * placeholders out, white space folded — with the line it starts on. Lines
 * marked as data are left out.
 */
function* literals(src: string): Generator<{ line: number; text: string }> {
  const skip = dataLines(src);
  // A template's placeholders are code: "${dir}" is a variable, not the German "dir".
  const clean = (text: string) => text.replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  for (const r of regions(src)) {
    if (r.kind === 'string') {
      const text = clean(r.text.slice(1, -1));
      if (text.length >= 2 && !skip.has(r.line)) yield { line: r.line, text };
    } else if (r.kind === 'code') {
      // JSX text: what sits between a tag's end or an expression's end and the
      // next tag or expression ("{n} Umsätze").
      const re = /([>}])([^<>{}]+)(?=[<{])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.text))) {
        // After an expression, only what reads as prose: code between two
        // blocks ("} async function writable(dir) {") has its brackets.
        if (m[1] === '}' && /[();=]/.test(m[2])) continue;
        const before = r.text.slice(0, m.index);
        const line = r.line + (before.match(/\n/g)?.length ?? 0) + (m[2].match(/^\s*\n/) ? 1 : 0);
        const text = clean(m[2]);
        if (text.length >= 2 && !skip.has(line)) yield { line, text };
      }
    }
  }
}
