// Documents kept on this machine (lib/doc-store.ts): the bank's own
// Kontoauszüge, fetched over FinTS (HKEKA), and the receipts the user
// attaches to a booking. What both sides know about one — the server keeps
// it in the sealed index, the browser lists and opens it — and the rules
// that hold on either side.
//
// Pure: for the routes, the provider and `node --test`.

import { msgs } from './i18n/index.ts';

/** One kept document, as the index describes it; the content is a file of its own. */
export type KeptDoc = {
  /** Random, 32 hex digits; names the document's file. */
  id: string;
  kind: 'statement' | 'receipt';
  mime: DocMime;
  /** The name it is saved or shared under. */
  name: string;
  /** Bytes of the document itself. */
  size: number;
  /** When it was kept (ISO). */
  addedAt: string;
  /** A statement's account; a receipt's, once it is matched or attached. */
  accountNumber: string | null;
  // A statement, as the bank numbered and dated it.
  number?: number | null;
  year?: number | null;
  from?: string | null;
  to?: string | null;
  date?: string | null;
  // A receipt.
  /** The booking it belongs to (txKey, lib/categories.ts); null while it waits for one. */
  tx?: string | null;
  /**
   * A receipt for an order that has not been booked yet — an invoice paid
   * from its GiroCode: the booking that matches it (lib/receipts.ts) takes
   * it once it arrives.
   */
  awaiting?: AwaitedBooking | null;
};

/** /api/docs: the list (`locked`: the store does not open with this PIN), one document with its bytes (base64), one changed. */
export type DocsListResponse = { docs: KeptDoc[]; locked: boolean };
export type DocGetResponse = { doc: KeptDoc; data: string };
export type DocResponse = { doc: KeptDoc };

/** The booking a receipt waits for: the order as it was sent. */
export type AwaitedBooking = { iban: string; cents: number; sentAt: string };

export const DOC_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'] as const;
export type DocMime = (typeof DOC_MIMES)[number];

/** What one login may keep: a phone holds its files in memory while the app runs. */
export const DOC_LIMITS = {
  /** One document. */
  bytes: 8 * 1024 * 1024,
  /** All of a login's documents together. */
  total: 48 * 1024 * 1024,
  count: 500,
};

/** A request carrying one document: base64 of it, plus the rest of the body. */
export const DOC_REQUEST_MAX_BYTES = Math.ceil((DOC_LIMITS.bytes * 4) / 3) + 64 * 1024;

const isMime = (v: unknown): v is DocMime => typeof v === 'string' && (DOC_MIMES as readonly string[]).includes(v);

/** The type a file says it is, if it is one the store keeps (an image whose type the picker left out counts by its name). */
export function docMime(type: string | null | undefined, name?: string | null): DocMime | null {
  const t = String(type ?? '').toLowerCase().trim();
  if (t === 'image/jpg') return 'image/jpeg';
  if (isMime(t)) return t;
  const ext = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

/** What the bytes are by their first ones, for a receipt: the name or type a picker gives may be wrong. */
export function sniffMime(bytes: Uint8Array): DocMime | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const isImage = (mime: DocMime) => mime.startsWith('image/');

/** Bytes as base64, in the browser as in Node — in slices, so a large file does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const EXT: Record<DocMime, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/plain': 'txt',
};

/**
 * A file name that is safe on every system: the user's or the bank's, without
 * path parts and characters a file system refuses, and with the extension
 * the content has.
 */
export function safeDocName(name: string | null | undefined, mime: DocMime, fallback: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\u0000-\u001f<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || fallback}.${EXT[mime]}`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const day = (v: unknown): string | null => (typeof v === 'string' && ISO_DAY.test(v) ? v.slice(0, 10) : null);
const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

function sanitizeAwaited(v: unknown): AwaitedBooking | null {
  const a = v as Partial<AwaitedBooking> | null;
  if (!a || typeof a !== 'object') return null;
  const iban = typeof a.iban === 'string' ? a.iban.replace(/\s+/g, '').toUpperCase() : '';
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) || !Number.isInteger(a.cents) || a.cents! <= 0) return null;
  if (typeof a.sentAt !== 'string' || Number.isNaN(Date.parse(a.sentAt))) return null;
  return { iban, cents: a.cents!, sentAt: new Date(a.sentAt).toISOString() };
}

/** One index entry as it can be trusted, or null: the index is read back from disk. */
export function sanitizeDoc(v: unknown): KeptDoc | null {
  const d = v as Partial<KeptDoc> | null;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.id !== 'string' || !/^[0-9a-f]{32}$/.test(d.id)) return null;
  if (d.kind !== 'statement' && d.kind !== 'receipt') return null;
  if (!isMime(d.mime) || !Number.isInteger(d.size) || d.size! < 0 || d.size! > DOC_LIMITS.bytes) return null;
  if (typeof d.addedAt !== 'string' || Number.isNaN(Date.parse(d.addedAt))) return null;
  const doc: KeptDoc = {
    id: d.id,
    kind: d.kind,
    mime: d.mime,
    name: safeDocName(d.name, d.mime, msgs().docs.fileName[d.kind]),
    size: d.size!,
    addedAt: d.addedAt,
    accountNumber: typeof d.accountNumber === 'string' && d.accountNumber ? d.accountNumber.slice(0, 40) : null,
  };
  if (d.kind === 'statement') {
    doc.number = int(d.number);
    doc.year = int(d.year);
    doc.from = day(d.from);
    doc.to = day(d.to);
    doc.date = day(d.date);
  } else {
    doc.tx = typeof d.tx === 'string' && d.tx ? d.tx.slice(0, 400) : null;
    doc.awaiting = doc.tx ? null : sanitizeAwaited(d.awaiting);
  }
  return doc;
}

/** "Kontoauszug 7/2026", or by its period, or by the day it came. */
export function statementTitle(d: KeptDoc, words: { numbered: (n: number, y: number) => string; dated: (day: string) => string; plain: string }): string {
  if (d.number != null && d.year != null) return words.numbered(d.number, d.year);
  const at = d.date ?? d.to ?? d.addedAt.slice(0, 10);
  return at ? words.dated(at) : words.plain;
}

/** Newest first: by the bank's year and number, else by the days the statement covers, else by when it came. */
export function byStatementOrder(a: KeptDoc, b: KeptDoc): number {
  if (a.year != null && b.year != null && a.year !== b.year) return b.year - a.year;
  if (a.number != null && b.number != null && a.year === b.year && a.number !== b.number) return b.number - a.number;
  const at = (d: KeptDoc) => d.to ?? d.date ?? d.addedAt;
  return at(b).localeCompare(at(a));
}
