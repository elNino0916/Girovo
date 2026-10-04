// Release notes as written on GitHub (Markdown), reduced to what the update
// dialog shows: headings, lists and paragraphs, and inside them bold, italic,
// code and links. The result is plain data the dialog turns into React
// elements — nothing here ever becomes HTML, so a release text cannot put
// markup into the app. Anything this does not understand stays as its text.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export type NotesBlock =
  | { type: 'heading'; level: 2 | 3; children: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'paragraph'; children: Inline[] };

/** Only web links are links; javascript:, file: and the like stay text. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// One pass over the text, longest constructs first: code (nothing inside it
// is markup), links, bold, italic.
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`', //                                     1 code
    // 2 text, 3 url — which may hold one level of balanced parentheses
    '\\[([^\\]\\n]+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\)',
    '<(https://[^>\\s]+)>', //                              4 autolink
    '\\*\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*\\*', //            5 bold
    '__(?=\\S)([^_\\n]+?)(?<=\\S)__', //                    6 bold
    '(?<![\\w*])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?![\\w*])', // 7 italic
    '(?<![\\w_])_(?=\\S)([^_\\n]+?)(?<=\\S)_(?![\\w_])', //  8 italic
  ].join('|'),
  'g',
);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    pushText(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] != null) {
      out.push({ type: 'code', text: m[1] });
    } else if (m[2] != null) {
      const href = safeHref(m[3]);
      if (href) {
        out.push({ type: 'link', href, children: parseInline(m[2]) });
      } else {
        // Not a link we would open: its text, formatting kept.
        for (const child of parseInline(m[2])) {
          if (child.type === 'text') pushText(child.text);
          else out.push(child);
        }
      }
    } else if (m[4] != null) {
      const href = safeHref(m[4]);
      if (href) out.push({ type: 'link', href, children: [{ type: 'text', text: m[4] }] });
      else pushText(m[4]);
    } else if (m[5] != null || m[6] != null) {
      out.push({ type: 'strong', children: parseInline(m[5] ?? m[6]) });
    } else {
      out.push({ type: 'em', children: parseInline(m[7] ?? m[8]) });
    }
  }
  pushText(text.slice(at));
  return out;
}

/** The text of inline content, without its markup. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children))).join('');
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Blocks of `markdown`. `title` is the release's own name: a first heading
 * that only repeats it ("# Sooskasse-FinTS 4.1.0") is left out — the dialog
 * already says which version this is.
 */
export function parseReleaseNotes(markdown: string, title?: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
    if (list?.length) blocks.push({ type: 'list', items: list.map(parseInline) });
    list = null;
  };

  const text = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Images say nothing in a dialog; HTML tags are dropped, their text kept.
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, '');

  let fenced = false;
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fenced = !fenced;
      continue;
    }
    const line = fenced ? raw : raw.trim();
    if (fenced) {
      if (line.trim()) blocks.push({ type: 'paragraph', children: [{ type: 'code', text: line.trim() }] });
      continue;
    }
    if (!line || /^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      const children = parseInline(heading[2]);
      const first = blocks.length === 0;
      if (first && title && squash(inlineText(children)) === squash(title)) continue;
      if (first && title && /^sooskasse-?fints\s+v?\d/i.test(inlineText(children))) continue;
      blocks.push({ type: 'heading', level: heading[1].length <= 2 ? 2 : 3, children });
      continue;
    }
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph.length) {
        blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
        paragraph = [];
      }
      (list ??= []).push(item[1]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    const content = quote ? quote[1] : line;
    // A line under a list item, indented or not, continues that item.
    if (list?.length && !quote) list[list.length - 1] += ` ${content}`;
    else if (content) paragraph.push(content);
  }
  flush();
  return blocks;
}
