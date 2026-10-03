// Fuzzy matching for the command palette's actions and accounts.
//
// Deliberately small and predictable: people type the start of a word
// ("über", "kontoa", "dunk"), an abbreviation ("ka" for Kontoauszug) or a
// word that is not in the label at all ("pdf", "theme"). Each of those gets a
// score band, so the obvious hit is always first and a stray subsequence
// match never outranks a real prefix. Umlauts match either way ("uber",
// "ueber" and "über" all find Überweisen).

/** Lower case, umlauts and ß spelled out, accents dropped, punctuation to spaces. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The same, but with umlauts reduced to their base letter — "über" → "uber". */
function foldBare(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Every character of `q` in order inside `text`; tighter runs score higher. 0 when not all are there. */
function subsequence(text: string, q: string): number {
  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = text.indexOf(ch, ti);
    if (at < 0) return 0;
    if (last >= 0) gaps += at - last - 1;
    last = at;
    ti = at + 1;
  }
  return Math.max(1, 30 - gaps);
}

function scoreOne(text: string, q: string, loose: boolean): number {
  if (!text || !q) return 0;
  if (text === q) return 120;
  if (text.startsWith(q)) return 100;
  const words = text.split(' ');
  if (words.some((w) => w.startsWith(q))) return 85;
  // Initials: "kap" → "Kontoauszug als PDF".
  const initials = words.map((w) => w[0]).join('');
  if (q.length >= 2 && initials.startsWith(q.replace(/ /g, ''))) return 75;
  if (text.includes(q)) return 60;
  // Scattered letters only count against a label, and only from three
  // characters on: "ka" scattered through a keyword list matches everything.
  return loose && q.length >= 3 ? subsequence(text, q) : 0;
}

/**
 * How well `query` matches an item with this label and these extra search
 * words; 0 means no match. Multi-word queries need every word to match
 * somewhere (label or keywords), and score by their weakest word.
 */
export function fuzzyScore(label: string, query: string, keywords: readonly string[] = []): number {
  const q = fold(query);
  if (!q) return 1;
  const variants = (f: string) => {
    const a = fold(f);
    const b = foldBare(f);
    return a === b ? [a] : [a, b];
  };
  // The label itself counts more than a keyword that happens to match.
  const fields = [
    ...variants(label).map((text) => ({ text, weight: 1 })),
    ...keywords.flatMap(variants).map((text) => ({ text, weight: 0.8 })),
  ];
  const best = (part: string) => {
    let top = 0;
    for (const f of fields) top = Math.max(top, scoreOne(f.text, part, f.weight === 1) * f.weight);
    return top;
  };
  const whole = best(q);
  const parts = q.split(' ').filter(Boolean);
  if (parts.length < 2) return whole;
  const each = parts.map(best);
  return Math.max(whole, each.every((s) => s > 0) ? Math.min(...each) - 5 : 0);
}
