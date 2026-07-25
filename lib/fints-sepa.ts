// SEPA credit transfer support for lib-fints.
//
// lib-fints (1.4.8) implements read-only business transactions; the transfer
// segments are added here through the library's own extension points:
//
//   HKCCS v1 — SEPA Einzelüberweisung      (single credit transfer)
//   HKIPZ v1 — SEPA Echtzeitüberweisung    (instant credit transfer)
//
// Both segments have the identical wire format (verified against the official
// FinTS 3.0 segment catalogue as shipped in hbci4java's hbci-300.xml):
//   Kontoverbindung international + SEPA descriptor + pain.001 XML (binary).
// The instant nature is expressed solely by the segment code — the pain.001
// payload is the same as for a normal transfer.
//
// The bank decides via BPD/UPD whether an account may use HKCCS/HKIPZ, and the
// dialog layer automatically attaches the HKTAN handshake because HIPINS marks
// both transactions as TAN-required. Registering the definitions requires the
// (patched) export of registerSegmentDefinition — see patches/.

import type { FinTSConfig, Message, Segment } from 'lib-fints';
import {
  SegmentDefinition,
  AlphaNumeric,
  Binary,
  InternationalAccountGroup,
  CustomerOrderInteraction,
  registerSegmentDefinition,
} from './fints-internals.js';
import type { ClientResponseWithResult, TransferResult } from './fints-types';

class HKCCS extends SegmentDefinition {
  static Id = 'HKCCS';
  constructor() { super(HKCCS.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
  ];
}

class HKIPZ extends SegmentDefinition {
  static Id = 'HKIPZ';
  constructor() { super(HKIPZ.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
  ];
}

registerSegmentDefinition(new HKCCS());
registerSegmentDefinition(new HKIPZ());

export const TRANSFER_SEG = HKCCS.Id;
export const INSTANT_SEG = HKIPZ.Id;

// ---------------------------------------------------------------------------
// SEPA character set + helpers
// ---------------------------------------------------------------------------
const TRANSLIT: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e',
  'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o',
  'ó': 'o', 'ô': 'o', 'õ': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ý': 'y',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A', 'Ç': 'C', 'È': 'E', 'É': 'E',
  'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ñ': 'N', 'Ò': 'O',
  'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ý': 'Y',
  '&': '+', '€': 'EUR', '@': '(at)', '*': '.', '_': '-', '"': "'",
};

// Reduce any text to the SEPA/EPC allowed character set (pure ASCII), so the
// pain.001 byte length always equals its JS string length regardless of the
// transport encoding.
export function sepaSanitize(text: unknown, maxLength?: number): string {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (/[A-Za-z0-9\/\-?:().,'+ ]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else out += ' ';
  }
  out = out.replace(/\s+/g, ' ').trim();
  return maxLength ? out.slice(0, maxLength) : out;
}

export function validateIban(input: unknown): string | null {
  const iban = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  if (iban.startsWith('DE') && iban.length !== 22) return null;
  // ISO 13616 mod-97 check
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1 ? iban : null;
}

/** '' when empty (BIC is optional), the BIC when valid, null when malformed. */
export function validateBic(input: unknown): string | null {
  const bic = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!bic) return '';
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : null;
}

// Accepts "12,34", "12.34", "1.234,56", "1,234.56" → integer cents (or null).
export function parseAmount(input: unknown): number | null {
  let s = String(input ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.'); // German: 1.234,56
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, ''); // English: 1,234.56
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999) return null;
  return cents;
}

const centsToDecimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// pain.001 builder
// ---------------------------------------------------------------------------
const xmlEscape = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));

// Pick the SEPA descriptor the bank advertises in HISPAS; prefer the pain.001
// versions we can generate, newest German usage first.
export function pickSepaDescriptor(config: FinTSConfig): string {
  const params = config.getTransactionParameters<{ supportedSepaFormats?: string[] }>('HKSPA');
  const formats = params?.supportedSepaFormats || [];
  for (const wanted of ['pain.001.001.03', 'pain.001.003.03', 'pain.001.001.09']) {
    const hit = formats.find((f) => f.includes(wanted));
    if (hit) return hit;
  }
  return 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
}

function painVersionOf(descriptor: string): string {
  const m = /pain\.001\.(\d{3})\.(\d{2})/.exec(descriptor);
  return m ? `001.${m[1]}.${m[2]}` : '001.001.03';
}

export type Pain001Input = {
  descriptor: string;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amountCents: number;
  purpose?: string;
  endToEndId?: string;
};

/**
 * Builds a single-transaction pain.001 credit transfer document.
 * All text inputs must already be SEPA-sanitized (pure ASCII).
 */
export function buildPain001({ descriptor, debtorName, debtorIban, debtorBic, creditorName, creditorIban, creditorBic, amountCents, purpose, endToEndId }: Pain001Input): string {
  const painVersion = painVersionOf(descriptor);
  const ns = `urn:iso:std:iso:20022:tech:xsd:pain.${painVersion.slice(4)}`;
  const isV09 = painVersion === '001.001.09';
  const bicTag = isV09 ? 'BICFI' : 'BIC';

  const now = new Date();
  const stamp = now.toISOString().slice(0, 19);
  const msgId = `MSG${now.getTime()}${Math.floor(Math.random() * 900 + 100)}`;
  const amount = centsToDecimal(amountCents);
  const e2e = endToEndId ? sepaSanitize(endToEndId, 35) : 'NOTPROVIDED';

  // FinTS/DK convention: 1999-01-01 = execute immediately
  const executionDate = isV09
    ? '<ReqdExctnDt><Dt>1999-01-01</Dt></ReqdExctnDt>'
    : '<ReqdExctnDt>1999-01-01</ReqdExctnDt>';

  const debtorAgent = debtorBic
    ? `<DbtrAgt><FinInstnId><${bicTag}>${xmlEscape(debtorBic)}</${bicTag}></FinInstnId></DbtrAgt>`
    : `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;
  const creditorAgent = creditorBic
    ? `<CdtrAgt><FinInstnId><${bicTag}>${xmlEscape(creditorBic)}</${bicTag}></FinInstnId></CdtrAgt>`
    : '';
  const remittance = purpose ? `<RmtInf><Ustrd>${xmlEscape(purpose)}</Ustrd></RmtInf>` : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Document xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ns} pain.${painVersion.slice(4)}.xsd">` +
    `<CstmrCdtTrfInitn>` +
    `<GrpHdr>` +
    `<MsgId>${msgId}</MsgId>` +
    `<CreDtTm>${stamp}</CreDtTm>` +
    `<NbOfTxs>1</NbOfTxs>` +
    `<CtrlSum>${amount}</CtrlSum>` +
    `<InitgPty><Nm>${xmlEscape(debtorName)}</Nm></InitgPty>` +
    `</GrpHdr>` +
    `<PmtInf>` +
    `<PmtInfId>${msgId}P1</PmtInfId>` +
    `<PmtMtd>TRF</PmtMtd>` +
    `<BtchBookg>false</BtchBookg>` +
    `<NbOfTxs>1</NbOfTxs>` +
    `<CtrlSum>${amount}</CtrlSum>` +
    `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>` +
    executionDate +
    `<Dbtr><Nm>${xmlEscape(debtorName)}</Nm></Dbtr>` +
    `<DbtrAcct><Id><IBAN>${xmlEscape(debtorIban)}</IBAN></Id></DbtrAcct>` +
    debtorAgent +
    `<ChrgBr>SLEV</ChrgBr>` +
    `<CdtTrfTxInf>` +
    `<PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>` +
    `<Amt><InstdAmt Ccy="EUR">${amount}</InstdAmt></Amt>` +
    creditorAgent +
    `<Cdtr><Nm>${xmlEscape(creditorName)}</Nm></Cdtr>` +
    `<CdtrAcct><Id><IBAN>${xmlEscape(creditorIban)}</IBAN></Id></CdtrAcct>` +
    remittance +
    `</CdtTrfTxInf>` +
    `</PmtInf>` +
    `</CstmrCdtTrfInitn>` +
    `</Document>`
  );
}

export type TransferOrder = {
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amountCents: number;
  purpose?: string;
  debtorBic?: string;
};

// ---------------------------------------------------------------------------
// The customer interaction driving HKCCS / HKIPZ
// ---------------------------------------------------------------------------
export class SepaTransferInteraction extends CustomerOrderInteraction {
  accountNumber: string;
  transfer: TransferOrder;
  instant: boolean;

  /**
   * @param accountNumber debtor account (must exist in the UPD)
   * @param transfer the order to send
   * @param instant  true → HKIPZ (Echtzeitüberweisung), false → HKCCS
   */
  constructor(accountNumber: string, transfer: TransferOrder, instant: boolean) {
    super(instant ? HKIPZ.Id : HKCCS.Id, instant ? 'HIIPZ' : 'HICCS');
    this.accountNumber = accountNumber;
    this.transfer = transfer;
    this.instant = instant;
  }

  createSegments(config: FinTSConfig): Segment[] {
    const account = config.getBankAccount(this.accountNumber);
    if (!config.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }
    if (!account.iban) {
      throw Error(`Account ${this.accountNumber} has no IBAN in the UPD — cannot build a SEPA transfer`);
    }
    const version = config.getMaxSupportedTransactionVersion(this.segId) ?? 1;
    const descriptor = pickSepaDescriptor(config);

    const debtorName = sepaSanitize([account.holder1, account.holder2].filter(Boolean).join(' '), 70) || 'Auftraggeber';
    const sepaMessage = buildPain001({
      descriptor,
      debtorName,
      debtorIban: account.iban,
      debtorBic: this.transfer.debtorBic || undefined,
      creditorName: this.transfer.creditorName,
      creditorIban: this.transfer.creditorIban,
      creditorBic: this.transfer.creditorBic || undefined,
      amountCents: this.transfer.amountCents,
      purpose: this.transfer.purpose,
    });

    return [
      {
        header: { segId: this.segId, segNr: 0, version },
        account: { ...account, bic: this.transfer.debtorBic || undefined },
        sepaDescriptor: descriptor,
        sepaMessage,
      } as Segment,
    ];
  }

  handleResponse(response: Message, clientResponse: ClientResponseWithResult): void {
    // HICCS carries no payload; HIIPZ (instant) optionally reports
    // orderId + status. Both arrive as "unknown" segments — parse manually.
    const seg = response.findAllUnknownSegments(this.responseSegId)[0];
    if (seg && typeof seg.rawData === 'string') {
      const [orderId, cancellationCode, orderStatus] = seg.rawData.split('+');
      const result: TransferResult = {
        orderId: orderId || null,
        cancellationCode: cancellationCode || null,
        orderStatus: orderStatus || null,
      };
      clientResponse.transferResult = result;
    }
  }
}
