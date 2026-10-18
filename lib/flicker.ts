// chipTAN optisch: the bank's HHD_UC challenge as the flicker graphic a TAN
// generator reads off the screen.
//
// The challenge names a start code and up to three data elements (account,
// amount, …). They are re-encoded for the generator — BCD where an element is
// digits only, ASCII otherwise — prefixed with their lengths, and closed with
// a Luhn digit and an XOR nibble: the ZKA's "HHD-Erweiterung für chipTAN
// optisch" (HHD 1.4, with 1.3 as its fallback), as hbci4java implements it.
// The screen then shows the code half a byte at a time — a clock bar and four
// data bars, low nibble first — after a fixed sync pattern (flickerFrames).
//
// Pure, for the route handlers (which render the code) and the overlay (which
// draws it), and for `node --test`.

export type HhdVersion = '1.4' | '1.3';

export type ParsedFlicker = {
  version: HhdVersion;
  /** The start code, as the challenge spells it. */
  startCode: string;
  /** HHD 1.4's control bytes after the start code's length (usually one, 0x01). */
  controlBytes: number[];
  /** The data elements that are there, in order: up to three; an empty one is "". */
  elements: string[];
};

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0');

/** A run of decimal digits, read whole, or null. */
function decimal(s: string): number | null {
  return /^\d+$/.test(s) ? Number.parseInt(s, 10) : null;
}

function hexByte(s: string): number | null {
  return /^[0-9A-Fa-f]{2}$/.test(s) ? Number.parseInt(s, 16) : null;
}

function parseAs(code: string, version: HhdVersion): ParsedFlicker | null {
  const lcLen = version === '1.4' ? 3 : 2;
  const total = decimal(code.slice(0, lcLen));
  let s = code.slice(lcLen);
  // The length must be what follows, exactly: that is what tells the versions apart.
  if (total === null || total !== s.length) return null;

  // The start code: its length byte (hex) carries a flag for control bytes in HHD 1.4.
  const lc = hexByte(s.slice(0, 2));
  if (lc === null) return null;
  s = s.slice(2);
  const controlBytes: number[] = [];
  if (version === '1.4' && (lc & 0x80)) {
    for (let i = 0; i < 10; i++) {
      const b = hexByte(s.slice(0, 2));
      if (b === null) return null;
      controlBytes.push(b);
      s = s.slice(2);
      if (!(b & 0x80)) break;
    }
  }
  const startLen = lc & 0x3f;
  if (s.length < startLen) return null;
  const startCode = s.slice(0, startLen);
  s = s.slice(startLen);

  // Up to three data elements, each with a two-digit decimal length.
  const elements: string[] = [];
  while (s.length && elements.length < 3) {
    const len = decimal(s.slice(0, 2));
    if (len === null || s.length < 2 + len) return null;
    elements.push(s.slice(2, 2 + len));
    s = s.slice(2 + len);
  }
  if (s.length) return null;
  if (!startCode) return null;
  return { version, startCode, controlBytes, elements };
}

/**
 * The challenge read as HHD 1.4, else as 1.3; null when it is neither (not a
 * flicker code at all). As it came first — an ASCII element may hold a space —
 * then without the spaces some banks put between the parts.
 */
export function parseFlicker(raw: string): ParsedFlicker | null {
  for (const code of [raw.trim(), raw.replace(/\s+/g, '')]) {
    if (!code) continue;
    const p = parseAs(code, '1.4') ?? parseAs(code, '1.3');
    if (p) return p;
  }
  return null;
}

/** BCD when the element is digits only (an empty one is not), ASCII otherwise. */
const isBcd = (data: string) => /^\d+$/.test(data);

function renderData(data: string): string {
  if (isBcd(data)) return data.length % 2 ? `${data}F` : data;
  let out = '';
  for (let i = 0; i < data.length; i++) out += hex(data.charCodeAt(i) & 0xff, 2);
  return out;
}

function renderLength(data: string, version: HhdVersion): string {
  const bytes = renderData(data).length / 2;
  if (isBcd(data)) return hex(bytes, 2);
  // ASCII is flagged: bit 6 of the length in HHD 1.4, a leading 1 in 1.3.
  return version === '1.4' ? hex(bytes + 0x40, 2) : `1${hex(bytes, 1)}`;
}

/** The Luhn digit over control bytes, start code and data — each byte's second nibble weighted 2. */
function luhn(p: ParsedFlicker): string {
  let s = p.controlBytes.map((b) => hex(b, 2)).join('') + renderData(p.startCode);
  for (const e of p.elements) s += renderData(e);
  let sum = 0;
  for (let i = 0; i + 1 < s.length; i += 2) {
    sum += Number.parseInt(s[i], 16);
    const doubled = Number.parseInt(s[i + 1], 16) * 2;
    sum += Math.floor(doubled / 10) + (doubled % 10);
  }
  const mod = sum % 10;
  return mod === 0 ? '0' : hex(10 - mod, 1);
}

/** The XOR of every nibble of the payload. */
function xor(payload: string): string {
  let x = 0;
  for (const ch of payload) x ^= Number.parseInt(ch, 16);
  return hex(x, 1);
}

/** The code the graphic shows, as hex — length, start code, data, Luhn, XOR. */
export function renderParsed(p: ParsedFlicker): string {
  let startLen = renderLength(p.startCode, p.version);
  if (p.version === '1.4' && p.controlBytes.length) startLen = hex(Number.parseInt(startLen, 16) + 0x80, 2);
  let body = startLen + p.controlBytes.map((b) => hex(b, 2)).join('') + renderData(p.startCode);
  for (const e of p.elements) body += renderLength(e, p.version) + renderData(e);
  // The length counts the checksum byte too.
  const payload = hex((body.length + 2) / 2, 2) + body;
  return payload + luhn(p) + xor(payload);
}

/** The flicker code for a challenge, or null when the challenge is not one. */
export function renderFlicker(raw: string): string | null {
  const p = parseFlicker(raw);
  return p ? renderParsed(p) : null;
}

/**
 * The frames of the graphic: per frame the five bars, clock first, then the
 * data bits 1, 2, 4, 8 — true is light. Each half byte is shown twice, with
 * the clock on and then off; a byte's low nibble comes first. The sync
 * pattern 0FFF leads, and the sequence repeats.
 */
export function flickerFrames(code: string): boolean[][] {
  const s = `0FFF${code}`;
  const frames: boolean[][] = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    for (const ch of [s[i + 1], s[i]]) {
      const v = Number.parseInt(ch, 16);
      const bits = [!!(v & 1), !!(v & 2), !!(v & 4), !!(v & 8)];
      frames.push([true, ...bits], [false, ...bits]);
    }
  }
  return frames;
}
