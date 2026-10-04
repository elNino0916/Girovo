// "Beträge ausblenden" for the bank's own free text.
//
// <Money> masks every amount the app formats itself, and there the figure never
// reaches the DOM. A bank's text is another matter: a Verwendungszweck reads
// "Kontofuehrung 6,90" or "Original 39,86 USD 1 Euro=1,1563 USD", right next to
// the masked booking amount it gives away. This masks what looks like an amount
// in such text. Callers apply it at render time, never to a cached string, so
// switching the mode off brings the text back unchanged.
//
// It is a best effort, and deliberately so:
//
//   - German decimals:           6,90 · 1.090,00 · 1 090,00 · −12,50
//   - whole euros:               149,- · 149,–
//   - any number by a currency:  850 EUR · EUR 850 · 39.86 USD · 12,50€ · 1 Euro · 1,1563 USD
//
// It never touches a date (01.09.2026, 18.09.), a time (15.55), an ISO
// timestamp, or an identifier glued to letters (NR00004471, BLZ57069999, an
// IBAN). A bare whole number stays as it is: "Miete 850" cannot be told apart
// from a house number or a contract number. So the promise that a hidden value
// is absent from the DOM belongs to <Money> alone; free text is masked as well
// as text can be read.

/** What a masked amount shows: the same five dots as <Money>. */
export const AMOUNT_MASK = '•••••';

// ISO codes of the currencies a German account sees in practice, plus the
// words and symbols banks write instead. Matched only as whole words.
const CURRENCY = String.raw`(?:EURO|Euro|euro|EUR|USD|GBP|CHF|JPY|CNY|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|CAD|AUD|NZD|HKD|SGD|ZAR|INR|BRL|MXN|AED|THB|ISK|US\$|€|\$|£|¥)`;

/** A sign that belongs to the amount (and would give away its direction). */
const SIGN = String.raw`[+\-−–]?`;

/**
 * Where an amount may start: not glued to a letter or a digit (an identifier,
 * the middle of a number), and not right after "digit + dot/comma" (the next
 * part of a date or of a longer number).
 */
const LEAD = String.raw`(?<![\p{L}\d])(?<!\d[.,])`;

/** A number as it may stand next to a currency: grouped or not, any decimal mark. */
const NUM = String.raw`(?:\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)(?:,[-–]{1,2})?`;

const AMOUNT_RE = new RegExp(
  [
    // "EUR 850", "USD 39.86", "€12,50"
    String.raw`(?<![\p{L}\d])(?<c1>${CURRENCY})(?<s1>\s?)(?<n1>${SIGN}${NUM})(?!\d)`,
    // "850 EUR", "39,86 USD", "12,50€", "1 Euro"
    String.raw`${LEAD}(?<n2>${SIGN}${NUM})(?<s2>\s?)(?<c2>${CURRENCY})(?![\p{L}])`,
    // "6,90", "1.090,00", "1 090,00" — German decimals need no currency.
    String.raw`${LEAD}${SIGN}(?:\d{1,3}(?:[.\s]\d{3})+|\d+),\d{2}(?!\d)`,
    // "149,-", "149,–"
    String.raw`${LEAD}${SIGN}(?:\d{1,3}(?:\.\d{3})+|\d+),[-–]{1,2}(?![-–\d])`,
  ].join('|'),
  'gu',
);

/** A run of text, or (`amount: true`) a figure to be shown masked. */
export type TextPart = { text: string; amount: boolean };

/**
 * `text` cut into plain runs and the amounts in it, in order — so a renderer
 * can draw each mask as an element of its own (and name it for a screen
 * reader). A currency next to a figure stays plain text ("••••• USD"); the
 * sign belongs to the figure.
 */
export function amountParts(text: string | null | undefined): TextPart[] {
  const s = String(text ?? '');
  const parts: TextPart[] = [];
  const plain = (t: string) => {
    if (!t) return;
    const prev = parts[parts.length - 1];
    if (prev && !prev.amount) prev.text += t;
    else parts.push({ text: t, amount: false });
  };
  let at = 0;
  if (/\d/.test(s)) {
    for (const m of s.matchAll(AMOUNT_RE)) {
      const g = m.groups ?? {};
      plain(s.slice(at, m.index));
      if (g.n1 != null) {
        plain(g.c1 + g.s1);
        parts.push({ text: g.n1, amount: true });
      } else if (g.n2 != null) {
        parts.push({ text: g.n2, amount: true });
        plain(g.s2 + g.c2);
      } else {
        parts.push({ text: m[0], amount: true });
      }
      at = m.index + m[0].length;
    }
  }
  plain(s.slice(at));
  return parts;
}

/** `text` with every amount-shaped figure replaced by "•••••". */
export function maskAmounts(text: string | null | undefined): string {
  return amountParts(text).map((p) => (p.amount ? AMOUNT_MASK : p.text)).join('');
}
