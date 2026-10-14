// A small, strict XML reader for the SEPA documents a bank hands back.
//
// The Bestand answers of Daueraufträge and Terminüberweisungen
// (lib/fints-orders.ts) carry each order as the pain.001 the bank keeps —
// generated XML, but from someone else's machine. Picking values out of it
// with regular expressions would mistake a `<Nm>` inside a comment or a CDATA
// block for a name, and an escaped `&lt;` for a tag. This reads it as XML
// instead: a real tokenizer (elements, attributes, text, the five predefined
// entities and character references, CDATA, comments, processing
// instructions), strict nesting, and a tree to walk by local name.
//
// Deliberately less than a full parser: a DOCTYPE is refused rather than
// read, so no entity a document declares itself can expand (the "billion
// laughs" and external-entity tricks have nothing to work with), and
// namespaces are reduced to local names — a pain.001 uses one default
// namespace, and the values the app reads are named the same in every
// version. lib-fints parses camt with fast-xml-parser, but only as its own
// dependency: this app does not import it directly (a transitive package can
// vanish with any update), and pain needs far less.
//
// Pure and dependency-free, for the server and `node --test`.

export type XmlNode = {
  /** The local name, without a namespace prefix ("Nm" for "ns2:Nm"). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The element's own character data, entities resolved, untrimmed. */
  text: string;
};

export class XmlError extends Error {
  constructor(message: string, at: number) {
    super(`${message} (at ${at})`);
    this.name = 'XmlError';
  }
}

/** What a bank answer may reasonably carry; anything larger is not a pain message. */
const MAX_LENGTH = 4 * 1024 * 1024;
/** Nesting deeper than any SEPA document goes — a guard against a malicious stack. */
const MAX_DEPTH = 64;

const NAME = /[A-Za-z_:][A-Za-z0-9_.:·À-῿⁰-￯-]*/y;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const localName = (qname: string) => qname.slice(qname.indexOf(':') + 1);

/** `&lt;`, `&#228;`, `&#xE4;` → their characters. Anything else is an error. */
function decodeEntities(s: string, at: number): string {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]*);?/g, (whole, ref: string) => {
    if (!whole.endsWith(';')) throw new XmlError('Unterminated entity reference', at);
    if (ref in ENTITIES) return ENTITIES[ref];
    const m = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(ref);
    if (m) {
      const code = m[1] ? parseInt(m[1], 16) : parseInt(m[2], 10);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    throw new XmlError(`Unknown entity &${ref};`, at);
  });
}

/**
 * The document's root element. Throws XmlError on anything that is not
 * well-formed (mismatched tags, a stray `<`, two roots, a DOCTYPE).
 */
export function parseXml(input: string): XmlNode {
  if (typeof input !== 'string') throw new XmlError('Not a string', 0);
  if (input.length > MAX_LENGTH) throw new XmlError('Document too large', 0);
  // A byte-order mark is not part of the document.
  const xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;

  const fail = (msg: string): never => { throw new XmlError(msg, i); };
  const skipSpace = () => { while (i < xml.length && /\s/.test(xml[i])) i++; };
  const readName = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(xml);
    if (!m) fail('Name expected');
    i += m![0].length;
    return m![0];
  };

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > i) {
      const raw = xml.slice(i, textEnd);
      if (stack.length) stack[stack.length - 1].text += decodeEntities(raw, i);
      else if (raw.trim()) fail('Text outside the root element');
      i = textEnd;
      continue;
    }
    // At a '<'.
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) fail('Unterminated comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) fail('Unterminated CDATA section');
      if (!stack.length) fail('CDATA outside the root element');
      stack[stack.length - 1].text += xml.slice(i + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) fail('Unterminated processing instruction');
      i = end + 2;
    } else if (xml.startsWith('<!', i)) {
      // A DOCTYPE (or anything else declared): never read, see the header.
      fail('Declarations are not accepted');
    } else if (xml[i + 1] === '/') {
      i += 2;
      const name = localName(readName());
      skipSpace();
      if (xml[i] !== '>') fail('">" expected');
      i++;
      const open = stack.pop();
      if (!open || open.name !== name) fail(`Unexpected </${name}>`);
      if (!stack.length) root = open!;
    } else {
      i++;
      const node: XmlNode = { name: localName(readName()), attrs: {}, children: [], text: '' };
      for (;;) {
        const before = i;
        skipSpace();
        if (xml[i] === '>' || xml.startsWith('/>', i)) break;
        if (i === before) fail('Whitespace expected between attributes');
        const attr = readName();
        skipSpace();
        if (xml[i] !== '=') fail('"=" expected');
        i++;
        skipSpace();
        const quote = xml[i];
        if (quote !== '"' && quote !== "'") fail('Quoted attribute value expected');
        const end = xml.indexOf(quote, i + 1);
        if (end < 0) fail('Unterminated attribute value');
        const value = xml.slice(i + 1, end);
        if (value.includes('<')) fail('"<" in an attribute value');
        node.attrs[localName(attr)] = decodeEntities(value, i);
        i = end + 1;
      }
      if (stack.length) stack[stack.length - 1].children.push(node);
      else if (root) fail('More than one root element');
      const selfClosing = xml[i] === '/';
      i += selfClosing ? 2 : 1;
      if (selfClosing) {
        if (!stack.length) root = node;
      } else {
        if (stack.length >= MAX_DEPTH) fail('Nested too deeply');
        stack.push(node);
      }
    }
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1].name}> is not closed`, i);
  if (!root) throw new XmlError('No root element', i);
  return root;
}

/** The first child element called `name` (local name), if any. */
export function child(node: XmlNode | null | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Every child element called `name`. */
export function children(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Down a path of child names: `at(doc, 'CstmrCdtTrfInitn', 'GrpHdr', 'MsgId')`. */
export function at(node: XmlNode | null | undefined, ...names: string[]): XmlNode | undefined {
  let n: XmlNode | undefined = node ?? undefined;
  for (const name of names) {
    n = child(n, name);
    if (!n) return undefined;
  }
  return n;
}

/** The trimmed text at a path, or null when the element is missing or empty. */
export function textAt(node: XmlNode | null | undefined, ...names: string[]): string | null {
  const n = at(node, ...names);
  const t = n?.text.trim();
  return t ? t : null;
}
