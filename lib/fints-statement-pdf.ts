// The bank's Kontoauszüge as PDF over HKEKP ("Kontoauszug im PDF-Format"),
// for the banks that offer their statements this way and not over HKEKA —
// some Sparkassen among them. lib-fints knows only HKEKA; this adds the other
// one and hands its answers over in the same shape (ElectronicStatement), so
// lib/bank-statements.ts and the store (lib/doc-store.ts keepStatements)
// treat both alike.
//
// The request (HKEKP, versions 1 and 2): the account as KTI, optionally a
// statement's number and year, a maximum count and the Aufsetzpunkt — the
// fields HKEKA has, without the format (it is always PDF). Built from the
// specification, hbci4java's and python-fints' definitions; NOT YET TRIED
// AGAINST A REAL BANK.
//
// The answer (HIEKP) is read by what its elements are rather than by where
// they stand: the versions order them differently (lib-fints' HIEKA warns
// that HIEKP v2 puts the document before the date, year and number, the
// reverse of HIEKA), and a wrong position does not fail — it silently files
// the advertisement as the document. So: the document is the binary element
// that is (or base64-wraps) a PDF; a group of two YYYYMMDD days is the period;
// a lone day the creation date; a four-digit year in range the year, and a
// smaller number the statement's number. Anything that cannot be told is left
// out, never guessed into a field.
//
// No receipt is sent (lib/bank-statements.ts says why).
//
// Registered on import from lib/serialize.ts, before any BPD is decoded. Only
// the request is registered: the bank's parameters (HIEKPS) stay undecoded,
// so no field this app gets wrong there can cost a login; whether the bank
// and the account offer HKEKP is read from HIPINS and the UPD as for every
// segment.

import type { ElectronicStatement, ElectronicStatementResponse, FinTSConfig, Message, Segment } from 'lib-fints';
import {
  AlphaNumeric, CustomerOrderInteraction, InternationalAccountGroup, Numeric, SegmentDefinition, internationalAccount,
  registerSegmentDefinition, splitBySeparator,
} from './fints-internals.js';

class HKEKP extends SegmentDefinition {
  static Id = 'HKEKP';
  constructor() { super(HKEKP.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new Numeric('statementNumber', 0, 1, 5),
    new Numeric('statementYear', 0, 1, 4),
    new Numeric('maxEntries', 0, 1, 4),
    // Not "continuationMark": that name turns on lib-fints' own reassembly (lib/fints-orders.ts).
    new AlphaNumeric('offset', 0, 1, 35),
  ];
}

registerSegmentDefinition(new HKEKP());

export const PDF_STATEMENT_SEG = HKEKP.Id;
const ANSWER_SEG = 'HIEKP';

// ---------------------------------------------------------------------------
// Reading HIEKP
// ---------------------------------------------------------------------------

/** One element's components: text unescaped, binary as its bytes. */
type Component = { text: string; binary: Uint8Array | null };

/** The FinTS escape character dropped: "?+" is "+", "??" is "?". */
const unescape = (s: string) => s.replace(/\?(.)/g, '$1');

function component(raw: string): Component {
  const m = /^@(\d+)@/.exec(raw);
  if (m) {
    const data = raw.slice(m[0].length, m[0].length + Number(m[1]));
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
    return { text: '', binary: bytes };
  }
  return { text: unescape(raw), binary: null };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const isPdf = (b: Uint8Array) => PDF_MAGIC.every((c, i) => b[i] === c);

/** A PDF a bank sent base64-encoded in a binary field (a known HIEKP v1 quirk), unwrapped — only when that provably is what it is. */
function unwrapBase64(bytes: Uint8Array): Uint8Array {
  if (isPdf(bytes)) return bytes;
  const text = new TextDecoder('latin1').decode(bytes);
  if (!/^[A-Za-z0-9+/\s]+={0,2}\s*$/.test(text)) return bytes;
  try {
    const decoded = new Uint8Array(Buffer.from(text, 'base64'));
    return isPdf(decoded) ? decoded : bytes;
  } catch {
    return bytes;
  }
}

/** "20250131" as a local date, or null. */
function day(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/**
 * One HIEKP's content (everything after its header) as a statement — or null
 * when it holds no document. See the top of this file for how each field is
 * told apart.
 */
export function readHiekp(raw: string): ElectronicStatement | null {
  const elements = splitBySeparator(raw, '+').map((el) => splitBySeparator(el, ':').map(component));
  const binaries = elements.flat().filter((c) => c.binary && c.binary.length).map((c) => unwrapBase64(c.binary!));
  const document = binaries.find(isPdf) ?? binaries.sort((a, b) => b.length - a.length)[0];
  if (!document) return null;

  let from: Date | undefined;
  let to: Date | undefined;
  let date: Date | undefined;
  let year: number | undefined;
  let number: number | undefined;
  let iban: string | undefined;
  for (const parts of elements) {
    const texts = parts.filter((c) => !c.binary).map((c) => c.text.trim());
    const days = texts.map(day);
    if (parts.length >= 2 && days.filter(Boolean).length >= 1 && texts.every((t, i) => !t || days[i])) {
      // A period: von:bis, either end may be left out.
      from ??= days[0] ?? undefined;
      to ??= days[1] ?? undefined;
      continue;
    }
    if (parts.length !== 1 || parts[0].binary) continue;
    const t = texts[0];
    if (!t) continue;
    const d = day(t);
    if (d) {
      date ??= d;
    } else if (/^\d{4}$/.test(t) && +t >= 1990 && +t <= 2100 && year === undefined) {
      year = +t;
    } else if (/^\d{1,5}$/.test(t) && number === undefined) {
      number = +t;
    } else if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) {
      iban ??= t;
    }
  }
  return { format: '3', document, from, to, date, year, number, iban };
}

// ---------------------------------------------------------------------------
// The interaction
// ---------------------------------------------------------------------------

export type PdfStatementOptions = { offset?: string; number?: number; year?: number; maxEntries?: number };

/** HKEKP for one account; its answers as lib-fints hands out HKEKA's (statements, nextOffset). */
export class PdfStatementInteraction extends CustomerOrderInteraction {
  readonly accountNumber: string;
  readonly options: PdfStatementOptions;

  constructor(accountNumber: string, options: PdfStatementOptions = {}) {
    super(HKEKP.Id, ANSWER_SEG);
    this.accountNumber = accountNumber;
    this.options = options;
  }

  createSegments(config: FinTSConfig): Segment[] {
    if (!config.isAccountTransactionSupported(this.accountNumber, HKEKP.Id)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${HKEKP.Id}'`);
    }
    const version = config.getMaxSupportedTransactionVersion(HKEKP.Id) ?? 1;
    const account = internationalAccount(config, config.getBankAccount(this.accountNumber));
    return [{
      header: { segId: HKEKP.Id, segNr: 0, version },
      account,
      statementNumber: this.options.number,
      statementYear: this.options.year,
      maxEntries: this.options.maxEntries,
      offset: this.options.offset,
    } as Segment];
  }

  handleResponse(response: Message, clientResponse: ElectronicStatementResponse): void {
    // Not registered, so lib-fints keeps every HIEKP as it came (Message.findAllUnknownSegments).
    const raw = response.findAllUnknownSegments(ANSWER_SEG) as unknown as { rawData?: string }[];
    clientResponse.statements = raw
      .map((seg) => readHiekp(String(seg.rawData ?? '')))
      .filter((st): st is ElectronicStatement => !!st);
    clientResponse.nextOffset = clientResponse.bankAnswers.find((a) => a.code === 3040)?.params?.find((p) => !!p?.trim())?.trim();
  }
}
