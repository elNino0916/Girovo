// Verification of Payee — "Namensabgleich" (FinTS 3.0, VOP V1.01, 27.06.2025).
//
// Since the EU Instant Payments Regulation, a bank must compare the payee name
// on a credit transfer against the name behind the IBAN and show the customer
// the result *before* the order is authorised. FinTS models that with two extra
// business transactions that travel alongside the payment order:
//
//   HKVPP v1 — Namensabgleich Prüfauftrag       → HIVPP (result + VOP-ID)
//   HKVPA v1 — Namensabgleich Ausführungsauftrag (confirms "execute anyway")
//
// Flow for PIN/TAN with a single signature (spec chapter E.8.1), which is the
// only shape this app produces:
//
//   1. HKCCS/HKIPZ + HKVPP + HKTAN go out together.
//   2. The bank answers with HIVPP (check result, explanatory text, VOP-ID) and
//      normally a HITAN challenge. The *return codes*, not the check result,
//      drive what happens next:
//        3091 — no HKVPA wanted; just answer the challenge (often a Match).
//        3076 — no SCA at all; the order is already through.
//        3945 — "Freigabe kann nicht erteilt werden": the HKTAN is void. The
//               order must be sent again, now with HKVPA + a fresh HKTAN, once
//               the customer has seen the result. Banks may send this even on a
//               Match, so it is handled on its own, not inferred from the code.
//        3090 — show the result to the customer.
//        9076 — orders without a Namensabgleich are no longer accepted.
//   3. On re-submission the pain.001 must be byte-identical to the one sent in
//      step 1 (9010 "Auftrag weicht vom Ursprungsauftrag ab"), so the built XML
//      is carried over rather than regenerated — see VopHold in session.ts.
//
// A bank may also answer the check request with 3040 ("Es liegen weitere
// Informationen vor") and deliver the result over several messages, releasing
// the VOP-ID only with the last: the spec's Aufsetzpunkt mechanism, aimed at
// large Sammler but used by banks for single orders too. VopPollInteraction
// unwinds that inside the same dialog by re-sending HKVPP on its own, and
// VopCollector merges the pieces.
//
// Segment layouts verified against the official catalogue as shipped in
// hbci4java's hbci-300.xml (VoPCheck1 / VoPCheckRes1 / VoPCheckPar1 / VoPAuth1).

import type { ClientResponse, FinTSConfig, Message, Segment } from 'lib-fints';
import {
  SegmentDefinition,
  AlphaNumeric,
  Binary,
  Numeric,
  YesNo,
  DataGroup,
  CustomerOrderInteraction,
  registerSegmentDefinition,
} from './fints-internals.js';
import { repairBankText } from './format';

// ---------------------------------------------------------------------------
// Segment definitions
// ---------------------------------------------------------------------------
class HKVPP extends SegmentDefinition {
  static Id = 'HKVPP';
  constructor() { super(HKVPP.Id); }
  version = 1;
  elements = [
    // Unterstützte Payment Status Reports — the pain.002 formats we accept.
    new DataGroup('supportedReports', [new AlphaNumeric('descriptor', 1, 99, 256)], 1, 1),
    new Binary('pollingId', 0, 1),
    new Numeric('maxEntries', 0, 1, 4),
    // The Aufsetzpunkt. Deliberately *not* called `continuationMark`, which is
    // the name that switches on lib-fints' own parted-response reassembly (as
    // HKVMK does): that resends the identical message and stitches one split
    // segment back together, whereas each HIVPP here is complete and the
    // Polling-ID has to travel with the resume. VopPollInteraction drives it.
    new AlphaNumeric('offset', 0, 1, 35),
  ];
}

class HIVPP extends SegmentDefinition {
  static Id = 'HIVPP';
  constructor() { super(HIVPP.Id); }
  version = 1;
  elements = [
    new Binary('vopId', 0, 1, 1024),
    // Timestamp (JJJJMMTT[:HHMMSS]). Read as text rather than through
    // lib-fints' TimeStampGroup, whose date element is mandatory and would
    // throw on a bank that sends the group half-filled.
    new DataGroup('vopIdValidTo', [
      new AlphaNumeric('date', 0, 1, 8),
      new AlphaNumeric('time', 0, 1, 6),
    ], 0, 1),
    new Binary('pollingId', 0, 1),
    new AlphaNumeric('reportDescriptor', 0, 1, 256),
    new Binary('report', 0, 1),
    // Ergebnis VOP-Prüfung Einzeltransaktion — the single-order alternative to
    // a pain.002, and what banks send for the orders this app builds.
    new DataGroup('result', [
      new AlphaNumeric('iban', 0, 1, 34),
      new AlphaNumeric('ibanAddOn', 0, 1, 140),
      new AlphaNumeric('differentName', 0, 1, 140),
      new AlphaNumeric('otherIdentifier', 0, 1, 256),
      new AlphaNumeric('result', 0, 1, 4),
      new AlphaNumeric('reason', 0, 1, 256),
    ], 0, 1),
    new AlphaNumeric('infoText', 0, 1, 65535),
    new Numeric('waitSeconds', 0, 1, 1),
  ];
}

/**
 * HIVPPS (BPD). Every element is declared optional even where the spec marks it
 * mandatory: this segment is parsed while the dialog is being initialised, and
 * lib-fints' decoder throws on a missing mandatory value — a bank that trims a
 * field would otherwise break the login rather than just the Namensabgleich.
 */
class HIVPPS extends SegmentDefinition {
  static Id = 'HIVPPS';
  constructor() { super(HIVPPS.Id); }
  version = 1;
  elements = [
    new Numeric('maxTrans', 0, 1, 3),
    new Numeric('minSigs', 0, 1, 1),
    new Numeric('secClass', 0, 1, 1),
    new DataGroup('params', [
      new Numeric('maxTransactionsOptIn', 0, 1, 7),
      new YesNo('infoTextStructured', 0, 1),
      new AlphaNumeric('reportDelivery', 0, 1, 1),
      new YesNo('bulkWithSingleOrderAllowed', 0, 1),
      new YesNo('entryCountAllowed', 0, 1),
      new AlphaNumeric('supportedReportFormats', 0, 1, 1024),
      // Segmentkennungen (HKCCS, HKIPZ, …) that require a Namensabgleich.
      new AlphaNumeric('vopRequiredSegments', 0, 999, 6),
    ], 0, 1),
  ];
}

class HKVPA extends SegmentDefinition {
  static Id = 'HKVPA';
  constructor() { super(HKVPA.Id); }
  version = 1;
  elements = [new Binary('vopId', 1, 1, 1024)];
}

registerSegmentDefinition(new HKVPP());
registerSegmentDefinition(new HIVPP());
registerSegmentDefinition(new HIVPPS());
registerSegmentDefinition(new HKVPA());

export const VOP_CHECK_SEG = HKVPP.Id;
export const VOP_AUTH_SEG = HKVPA.Id;

// ---------------------------------------------------------------------------
// Return codes that steer the flow (spec chapter E.8.1)
// ---------------------------------------------------------------------------
export const VOP_CODES = {
  /** Keine Namensabweichung. */
  noDeviation: 25,
  /** Ergebnis Namensabgleich prüfen. */
  reviewResult: 3090,
  /** VOP-Ausführungsauftrag nicht benötigt — answer the challenge, no HKVPA. */
  noAuthNeeded: 3091,
  /** Keine starke Authentifizierung notwendig. */
  noScaNeeded: 3076,
  /** Es liegen weitere Informationen vor — resume with the Aufsetzpunkt. */
  moreToCome: 3040,
  /** Es wurde keine Challenge erzeugt. */
  noChallenge: 3905,
  /** Namensabgleich ist noch in Bearbeitung. */
  stillRunning: 3093,
  /** Namensabgleich ist komplett. */
  complete: 3094,
  /** Freigabe kann nicht erteilt werden — resubmit with HKVPA + new HKTAN. */
  approvalVoided: 3945,
  /** Namensabgleich erforderlich — order rejected for lacking VoP. */
  required: 9076,
} as const;

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

/** The five outcomes the DK defines for a Namensabgleich. */
export type VopVerdict = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'NOT_APPLICABLE' | 'PENDING' | 'UNKNOWN';

const VERDICTS: Record<string, VopVerdict> = {
  RCVC: 'MATCH',
  RVMC: 'CLOSE_MATCH',
  RVNM: 'NO_MATCH',
  RVNA: 'NOT_APPLICABLE',
  PDNG: 'PENDING',
};

export type VopResult = {
  verdict: VopVerdict;
  /** Raw four-letter code as the bank sent it (RCVC, RVMC, …). */
  code: string | null;
  /** The name the bank holds for the IBAN — only sent on a Close Match. */
  suggestedName: string | null;
  /** Why the check could not be performed (Not Applicable). */
  reason: string | null;
  /** Payee IBAN the result refers to. */
  iban: string | null;
  /** Legally required explanatory text; must be shown to the customer. */
  infoText: string | null;
  vopId: string | null;
  validTo: string | null;
  /** Seconds the bank wants us to wait before asking again (polling only). */
  waitSeconds: number | null;
};

type HivppSegment = Segment & {
  vopId?: string;
  vopIdValidTo?: { date?: string; time?: string };
  pollingId?: string;
  reportDescriptor?: string;
  report?: string;
  result?: {
    iban?: string; ibanAddOn?: string; differentName?: string;
    otherIdentifier?: string; result?: string; reason?: string;
  };
  infoText?: string;
  waitSeconds?: number;
};

type VopParams = {
  supportedReportFormats?: string;
  vopRequiredSegments?: (string | undefined)[];
  /** S = schrittweise, V = vollständig (how pain.002 parts relate). */
  reportDelivery?: string;
  bulkWithSingleOrderAllowed?: boolean;
  entryCountAllowed?: boolean;
};

/**
 * pain.002 fallback. A bank may answer with a Payment Status Report instead of
 * the single-transaction DEG. The DK leaves the exact placement of the result
 * to Anlage 3 of the DFÜ-Abkommen and banks differ, so rather than bind to one
 * layout this pulls the pieces out by name: the verdict is whichever of the
 * five ISO codes appears, the suggested name the first <Nm> that is not the
 * name we sent ourselves. Good enough for the single-transaction orders this
 * app builds; a Sammler would need a real parse.
 */
function resultFromPain002(xml: string, sentName: string | null): Partial<VopResult> {
  const code = /\b(RCVC|RVMC|RVNM|RVNA|PDNG)\b/.exec(xml)?.[1] ?? null;
  const names = [...xml.matchAll(/<(?:\w+:)?Nm>([^<]*)<\/(?:\w+:)?Nm>/g)]
    .map((m) => cleanText(m[1]))
    .filter(Boolean) as string[];
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
  const suggested = names.find((n) => !sentName || norm(n) !== norm(sentName)) ?? null;
  const iban = /<(?:\w+:)?IBAN>([A-Z0-9]+)<\/(?:\w+:)?IBAN>/.exec(xml)?.[1] ?? null;
  return {
    code,
    suggestedName: suggested,
    iban,
    reason: cleanText(/<(?:\w+:)?AddtlInf>([^<]*)<\/(?:\w+:)?AddtlInf>/.exec(xml)?.[1]),
  };
}

/**
 * Gathers a Namensabgleich result that may arrive over several messages.
 *
 * A bank is free to answer the check request with "Es liegen weitere
 * Informationen vor" (3040) and hand the Payment Status Report over in pieces;
 * the VOP-ID — the thing HKVPA needs — is only sent with the final one. The
 * collector merges those answers and knows when the picture is complete, so the
 * rest of the app can treat one round trip and five the same way.
 *
 * HIVPPS says how the pieces relate: `S` (schrittweise) means each message adds
 * to the last, `V` (vollständig) means each one repeats everything so far.
 */
export class VopCollector {
  /** The payee name we submitted — used to spot the bank's name in a pain.002. */
  readonly sentName: string;
  private readonly incremental: boolean;
  private merged: HivppFields | null = null;
  private reportParts: string[] = [];

  /** Carried into the next HKVPP when the bank asks for another round. */
  pollingId: string | null = null;
  offset: string | null = null;
  polls = 0;

  constructor(sentName: string, reportDelivery?: string) {
    this.sentName = sentName;
    this.incremental = (reportDelivery || 'S').toUpperCase() !== 'V';
  }

  /** True once nothing is missing — i.e. the bank has released the VOP-ID. */
  get complete(): boolean {
    return !!this.merged?.vopId;
  }

  /** Whether any HIVPP has been seen at all. */
  get seen(): boolean {
    return this.merged !== null;
  }

  /** Seconds the bank asked us to wait before the next check request. */
  get waitSeconds(): number {
    return this.merged?.waitSeconds ?? 0;
  }

  /** Folds one bank response into the picture. Returns true if it held a HIVPP. */
  absorb(response: Message): boolean {
    this.offset = continuationMarkOf(response) ?? this.offset;

    const fields = readHivpp(response);
    if (!fields) return false;

    if (fields.report) {
      if (this.incremental) this.reportParts.push(fields.report);
      else this.reportParts = [fields.report];
    }
    this.pollingId = fields.pollingId || this.pollingId;
    // Later messages win, but never by blanking something already delivered.
    this.merged = this.merged ? mergeFields(this.merged, fields) : fields;
    return true;
  }

  /** The merged view, or null while the bank has said nothing at all. */
  get result(): VopResult | null {
    const f = this.merged;
    if (!f) return null;

    const degCode = f.deg?.result?.trim().toUpperCase() || null;
    let core: Partial<VopResult> = {
      code: degCode,
      suggestedName: cleanText(f.deg?.differentName),
      reason: null,
      iban: f.deg?.iban?.trim() || null,
    };
    // Banks that normally use the DEG may still answer with a pain.002.
    const report = this.reportParts.join('');
    if (!degCode && report) {
      try {
        core = { ...core, ...resultFromPain002(report, this.sentName) };
      } catch (err) {
        console.warn('[vop] pain.002 parsing failed:', (err as Error)?.message || err);
      }
    }

    // The result code is a protocol token, not something to read: banks often
    // repeat it in front of the prose, so it is lifted out of every text field
    // and only the sentence is kept. Where the DEG left the code empty, the
    // prefix is what tells us the verdict.
    const reason = splitLeadingCode(cleanText(f.deg?.reason) ?? core.reason ?? null);
    const info = splitLeadingCode(cleanText(f.infoText));
    const name = splitLeadingCode(core.suggestedName ?? null);
    const code = core.code || reason.code || info.code || name.code;

    return {
      verdict: (code && VERDICTS[code]) || 'UNKNOWN',
      code: code ?? null,
      suggestedName: name.text,
      reason: reason.text,
      iban: core.iban ?? null,
      infoText: info.text,
      vopId: f.vopId || null,
      validTo: formatValidTo(f.validTo),
      waitSeconds: f.waitSeconds,
    };
  }
}

/** Trim and un-mangle a text the bank sent; empty becomes null. */
const cleanText = (text: string | undefined | null): string | null =>
  (text ? repairBankText(text).trim() : '') || null;

/**
 * Peels a leading result code off a bank text.
 *
 * "RCVC Der von Ihnen eingegebene Name …" is one string as far as FinTS is
 * concerned, but the code belongs on the verdict chip, not in the sentence.
 */
function splitLeadingCode(text: string | null): { code: string | null; text: string | null } {
  if (!text) return { code: null, text: null };
  const m = /^(RCVC|RVMC|RVNM|RVNA|PDNG)\b[\s:.,;–-]*/i.exec(text);
  if (!m) return { code: null, text };
  const rest = text.slice(m[0].length).trim();
  return { code: m[1].toUpperCase(), text: rest || null };
}

type HivppFields = {
  vopId: string | null;
  validTo: { date?: string; time?: string } | undefined;
  pollingId: string | null;
  report: string | null;
  deg: HivppSegment['result'] | null;
  infoText: string | null;
  waitSeconds: number | null;
};

const mergeFields = (a: HivppFields, b: HivppFields): HivppFields => ({
  vopId: b.vopId || a.vopId,
  validTo: b.validTo || a.validTo,
  pollingId: b.pollingId || a.pollingId,
  report: b.report || a.report,
  deg: b.deg || a.deg,
  infoText: b.infoText || a.infoText,
  waitSeconds: b.waitSeconds ?? a.waitSeconds,
});

function readHivpp(response: Message): HivppFields | null {
  const seg = response.findSegment<HivppSegment>(HIVPP.Id);
  if (!seg) return null;
  return {
    vopId: seg.vopId || null,
    validTo: seg.vopIdValidTo,
    pollingId: seg.pollingId || null,
    report: seg.report || null,
    deg: seg.result || null,
    infoText: seg.infoText || null,
    waitSeconds: typeof seg.waitSeconds === 'number' ? seg.waitSeconds : null,
  };
}

/**
 * The Aufsetzpunkt the bank sends as the parameter of return code 3040. Banks
 * differ on whether they pad the parameter list, so this takes the first one
 * that actually holds something rather than assuming position 0.
 */
function continuationMarkOf(response: Message): string | null {
  const answer = response.getBankAnswers().find((a) => a.code === VOP_CODES.moreToCome);
  return answer?.params?.find((p) => !!p && p.trim() !== '')?.trim() || null;
}

/**
 * Whether the bank wants another check request before anything can be approved.
 * Both the "more to come" marker and a still-running check point that way, but
 * without an Aufsetzpunkt or Polling-ID there is nothing to resume from, so a
 * bare repeat would just loop.
 */
export function shouldPollAgain(response: Message, collector: VopCollector): boolean {
  if (collector.complete || collector.polls >= MAX_VOP_POLLS) return false;
  if (!collector.offset && !collector.pollingId) return false;
  return response.hasReturnCode(VOP_CODES.moreToCome)
    || response.hasReturnCode(VOP_CODES.stillRunning);
}

/**
 * How many extra check requests to send before giving up. The bank's "Wartezeit
 * vor nächster Abfrage" is not honoured — lib-fints drives the message loop
 * synchronously, so there is nowhere to sleep — which is fine at this scale: a
 * single transaction resolves in a round trip or two, and anything longer is
 * reported back to the user as still running rather than hammered at.
 */
export const MAX_VOP_POLLS = 4;

/** FinTS `JJJJMMTT` + `HHMMSS` → ISO-ish `2026-07-26 14:30`, or null. */
function formatValidTo(ts: { date?: string; time?: string } | undefined): string | null {
  const d = ts?.date?.trim();
  if (!d || !/^\d{8}$/.test(d)) return null;
  const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const t = ts?.time?.trim();
  return /^\d{6}$/.test(t || '') ? `${day} ${t!.slice(0, 2)}:${t!.slice(2, 4)}` : day;
}

// ---------------------------------------------------------------------------
// BPD interrogation
// ---------------------------------------------------------------------------
const vopParams = (config: FinTSConfig): VopParams | undefined =>
  config.getTransactionParameters<VopParams>(HKVPP.Id);

/**
 * Whether a Namensabgleich must accompany `orderSegId`.
 *
 * The bank advertises the payment transactions it checks in HIVPPS ("VOP-
 * pflichtiger Zahlungsverkehrsauftrag"). When both HKVPP and HKVPA are in the
 * BPD but the list is unreadable (an older parameter version, a bank that omits
 * it), we still run the check: the spec leaves it to the bank whether to reject
 * an unlisted transaction sent with HKVPP or to execute it as though no HKVPP
 * had been sent — both are survivable, whereas skipping a required check is not.
 */
export function isVopRequired(config: FinTSConfig, orderSegId: string): boolean {
  if (!config.isTransactionSupported(HKVPP.Id) || !config.isTransactionSupported(HKVPA.Id)) {
    return false;
  }
  const listed = (vopParams(config)?.vopRequiredSegments || []).filter(Boolean) as string[];
  return listed.length === 0 || listed.includes(orderSegId);
}

/**
 * The pain.002 formats to name in HKVPP. The BPD carries them in a single
 * 1024-character field, which fits several descriptors — hence the scan rather
 * than a plain read.
 */
export function pickReportDescriptors(config: FinTSConfig): string[] {
  const raw = vopParams(config)?.supportedReportFormats || '';
  const found = raw.match(/urn:[^\s,;]+/g);
  if (found?.length) return found.slice(0, 99);
  if (raw.trim()) return [raw.trim()];
  return ['urn:iso:std:iso:20022:tech:xsd:pain.002.001.10'];
}

// ---------------------------------------------------------------------------
// Segment builders — used by SepaTransferInteraction
// ---------------------------------------------------------------------------
/**
 * HKVPP. On the first pass it just names the report formats we can read; on a
 * resume it also carries the Polling-ID and the Aufsetzpunkt the bank handed
 * back, which is what makes it a continuation rather than a new check.
 */
export function vopCheckSegment(config: FinTSConfig, resume?: VopCollector): Segment {
  const version = config.getMaxSupportedTransactionVersion(HKVPP.Id) ?? 1;
  return {
    header: { segId: HKVPP.Id, segNr: 0, version },
    supportedReports: pickReportDescriptors(config),
    pollingId: resume?.pollingId || undefined,
    offset: resume?.offset || undefined,
  } as Segment;
}

export function vopAuthSegment(config: FinTSConfig, vopId: string): Segment {
  const version = config.getMaxSupportedTransactionVersion(HKVPA.Id) ?? 1;
  return { header: { segId: HKVPA.Id, segNr: 0, version }, vopId } as Segment;
}

/** Reads HIVPPS' "Art der Lieferung Payment Status Report" (S or V). */
export function reportDelivery(config: FinTSConfig): string | undefined {
  return vopParams(config)?.reportDelivery;
}

/**
 * A bare check request, sent on its own to collect the rest of a result the
 * bank is delivering piecemeal ("Dazu wird der HKVPP alleine solange erneut
 * eingereicht, bis eine abschließende Antwort vorliegt").
 *
 * It rides inside the dialog the order opened — queued behind the current
 * interaction, so lib-fints sends it as the next message — and folds every
 * answer into the same collector, re-queueing itself while the bank has more
 * to give. HKVPP is not TAN-pflichtig, so no challenge is attached.
 */
export class VopPollInteraction extends CustomerOrderInteraction {
  constructor(private readonly collector: VopCollector) {
    super(HKVPP.Id, HIVPP.Id);
  }

  createSegments(config: FinTSConfig): Segment[] {
    this.collector.polls++;
    console.log(`[vop] check request ${this.collector.polls}/${MAX_VOP_POLLS} (offset=${this.collector.offset ? 'yes' : 'no'}, pollingId=${this.collector.pollingId ? 'yes' : 'no'})`);
    return [vopCheckSegment(config, this.collector)];
  }

  handleClientResponse(response: Message): ClientResponse {
    const clientResponse = super.handleClientResponse(response);
    this.collector.absorb(response);
    queueVopPoll(this, response, this.collector);
    return clientResponse;
  }

  handleResponse(): void {
    // Everything of interest is in HIVPP, which absorb() has already taken.
  }
}

/**
 * Queues another check request on `interaction`'s dialog when the bank has said
 * there is more to come. Shared by the order and the poll itself, so a result
 * spread over several messages unwinds without either side knowing how many.
 */
export function queueVopPoll(
  interaction: { dialog?: { hasEnded: boolean; addCustomerInteraction(i: CustomerOrderInteraction, afterCurrent?: boolean): void } },
  response: Message,
  collector: VopCollector,
): void {
  if (!shouldPollAgain(response, collector)) return;
  const dialog = interaction.dialog;
  if (!dialog || dialog.hasEnded) return;
  if (collector.waitSeconds > 0) {
    console.log(`[vop] bank asked for a ${collector.waitSeconds}s pause before the next check request — continuing immediately`);
  }
  dialog.addCustomerInteraction(new VopPollInteraction(collector), true);
}
