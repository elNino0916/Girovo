// Terminierte SEPA-Überweisungen and SEPA-Daueraufträge: placing one, reading
// the bank's list of them (the Bestand), deleting one.
//
// lib-fints knows the codes but none of the segments, so they are added here
// through the library's extension points, like the transfers in
// lib/fints-sepa.ts:
//
//   HKCSE v1 → HICSE   terminierte SEPA-Überweisung einreichen   (HICSES)
//   HKCSB v1/2 → HICSB Bestand terminierter SEPA-Überweisungen   (HICSBS)
//   HKCSL v1           terminierte SEPA-Überweisung löschen      (HICSLS)
//   HKCDE v1 → HICDE   SEPA-Dauerauftrag einrichten              (HICDES)
//   HKCDB v1/2 → HICDB SEPA-Dauerauftragsbestand abrufen         (HICDBS)
//   HKCDL v1/2         SEPA-Dauerauftrag löschen                 (HICDLS)
//
// Changing an order (HKCSA, HKCDN) is left out: the spec itself names
// deleting and placing it again as the way when a product does not offer it.
//
// Sources for every layout below:
//   - the specification, "FinTS 3.0 Messages – Multibankfähige
//     Geschäftsvorfälle", Rel. 2022 (15.04.2022), chapters C.10.2.2
//     (terminierte SEPA-Überweisung) and C.10.2.3 (SEPA-Dauerauftrag), and its
//     data dictionary: Dauerauftragdetails, Aussetzung, Parameter SEPA-
//     Dauerauftrag einrichten / löschen / -bestand, Parameter terminierte SEPA-
//     Überweisung einreichen, Parameter Bestand / Löschung terminierter
//     SEPA-Überweisungen, Unterstützte SEPA pain messages, Turnus in Monaten /
//     Wochen, Ausführungstage pro Monat / Woche, Minimale Vorlaufzeit;
//   - hbci4java's hbci-300.xml (TermUebSEPA*, DauerSEPA*, DEGs DauerDetails,
//     DauerDetails4, Aussetzung3, ParDauerSEPANew, ParDauerSEPADel,
//     ParTermUebSEPA*), the catalogue lib/fints-sepa.ts and lib/fints-vop.ts
//     were checked against, and its GV classes;
//   - cross-checked with libfintx (HKCDE/HKCDB/HKCDL/HKCSE/HKCSB/HKCSL), the
//     aqbanking job definitions, the DK FinTS 4.1 schemas of the same
//     transactions, and the parameter segments of seven banks as captured in
//     phpFinTS' test data (DKB, two Sparkassen, Atruvia/GLS, ING, Postbank).
//
// Read conservatively, and not yet tried against a real bank:
//   - The v2 of HKCDB/HICDB/HKCDL (a time inside the Dauerauftragdetails) is
//     hbci4java's; the 2022 specification shows v1 only. Both are read.
//   - HICSB v2 (SEPA-C-Code and a status instead of "löschbar") is the
//     specification's; no source showed a bank sending it.
//   - A deletion sends back the bank's own descriptor, pain message,
//     account and Dauerauftragdetails exactly as the Bestand delivered them —
//     the specification asks for "das gleiche pain message-Schema"; hbci4java
//     and libfintx rebuild the pain instead. Every bank sampled demands the
//     order data with a deletion ("Senden der Auftragsdaten erforderlich").
//   - The lead times are calendar days (the data dictionary says so for the
//     Dauerauftrag); the app never offers today itself (lib/order-schedule.ts).
//   - "00" in a list of rhythms or days means "all" (spec); the app then
//     offers the usual subset. A weekly rhythm only where the bank names
//     weekly turns at all (spec: "Wenn das DE nicht belegt ist, ist keine
//     wöchentliche Ausführung möglich").
//   - The pain.001 of a Dauerauftrag carries 1999-01-01 as ReqdExctnDt, as
//     hbci4java, libfintx and a working capture do: its dates travel in the
//     Dauerauftragdetails. A terminierte Überweisung carries its real date.
//   - The Aufsetzpunkt is followed by sending the request again with it, at
//     most MAX_LIST_ROUNDS times; a list cut short says so (`complete`).

import type { FinTSConfig, Message, Segment } from 'lib-fints';
import { randomBytes } from 'node:crypto';
import {
  SegmentDefinition,
  AlphaNumeric,
  Binary,
  DataGroup,
  Numeric,
  InternationalAccountGroup,
  CustomerOrderInteraction,
  registerSegmentDefinition,
} from './fints-internals.js';
import type {
  BankOrderKind, BankOrdersAnswer, BankOrdersRead, ClientResponseWithResult, OrderCaps, ReadBankOrder, SerializedBankOrder,
  TransferResult,
} from './fints-types';
import type { Session } from './session';
import { repairBankText } from './format.ts';
import { pickSepaDescriptor, SepaOrderInteraction, SepaTransferInteraction, type TransferOrder, type VopMode } from './fints-sepa.ts';
import {
  DEFAULT_DATED_RULES, DEFAULT_STANDING_RULES, ULTIMO, isDayKey,
  type DatedRules, type OrderSchedule, type StandingRules, type Unit,
} from './order-schedule.ts';
import { at, child, children, parseXml, textAt, type XmlNode } from './xml-tree.ts';

// ---------------------------------------------------------------------------
// Data element groups
// ---------------------------------------------------------------------------

/**
 * Dauerauftragdetails (DEG version 3; hbci4java DauerDetails / DauerDetails4).
 * The dates are written and read as the JJJJMMTT text itself: lib-fints' date
 * element goes through UTC and would move a German midnight to the day before.
 * `strict`: the mandatory elements of an order's own request; an answer is
 * read leniently, so one trimmed field never costs the whole list.
 */
const details = (minCount: number, strict: boolean) => new DataGroup('details', [
  new AlphaNumeric('firstDate', strict ? 1 : 0, 1, 8),
  new AlphaNumeric('unit', strict ? 1 : 0, 1, 1),
  new Numeric('interval', strict ? 1 : 0, 1, 2),
  new Numeric('day', strict ? 1 : 0, 1, 2),
  // Uhrzeit — DauerDetails4, segment version 2 only (hbci4java).
  new AlphaNumeric('execTime', 0, 1, 6, 2),
  new AlphaNumeric('lastDate', 0, 1, 8),
], minCount, 1);

/** Unterstützte SEPA pain messages: the formats the app can read, one URN each. */
const supportedFormats = () => new DataGroup('supportedFormats', [new AlphaNumeric('descriptor', 1, 99, 256)], 1, 1);

/** J/N read as text: lib-fints' own element throws on anything else, and an answer must not. */
const flag = (name: string, minVersion?: number, maxVersion?: number) => new AlphaNumeric(name, 0, 1, 1, minVersion, maxVersion);

/** The header every parameter segment shares — optional throughout, it is read during the dialog's start. */
const paramHeader = () => [
  new Numeric('maxTrans', 0, 1, 3),
  new Numeric('minSigs', 0, 1, 1),
  new Numeric('secClass', 0, 1, 1),
];

// ---------------------------------------------------------------------------
// Terminierte SEPA-Überweisung
// ---------------------------------------------------------------------------

class HKCSE extends SegmentDefinition {
  static Id = 'HKCSE';
  constructor() { super(HKCSE.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
  ];
}

class HICSE extends SegmentDefinition {
  static Id = 'HICSE';
  constructor() { super(HICSE.Id); }
  version = 1;
  elements = [new AlphaNumeric('orderId', 0, 1, 99)];
}

class HICSES extends SegmentDefinition {
  static Id = 'HICSES';
  constructor() { super(HICSES.Id); }
  version = 1;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [
      new Numeric('minDays', 0, 1, 4),
      new Numeric('maxDays', 0, 1, 4),
    ], 0, 1),
  ];
}

class HKCSB extends SegmentDefinition {
  static Id = 'HKCSB';
  constructor() { super(HKCSB.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    supportedFormats(),
    new AlphaNumeric('fromDate', 0, 1, 8),
    new AlphaNumeric('toDate', 0, 1, 8),
    new Numeric('maxEntries', 0, 1, 4),
    // The Aufsetzpunkt. Not named `continuationMark`, which would switch on
    // lib-fints' own reassembly — it only runs before an approval, never after
    // one, and could not say when a list was cut short. BankOrderListInteraction
    // follows it instead, the same way in both cases.
    new AlphaNumeric('offset', 0, 1, 35),
  ];
}

class HICSB extends SegmentDefinition {
  static Id = 'HICSB';
  constructor() { super(HICSB.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 0, 1),
    new AlphaNumeric('sepaDescriptor', 0, 1, 256),
    new Binary('sepaMessage', 0, 1),
    new AlphaNumeric('orderId', 0, 1, 99),
    flag('canDelete', undefined, 1),
    new AlphaNumeric('sepaCCode', 0, 1, 1, 2),
    flag('canChange'),
    new AlphaNumeric('status', 0, 1, 1, 2),
  ];
}

class HICSBS extends SegmentDefinition {
  static Id = 'HICSBS';
  constructor() { super(HICSBS.Id); }
  version = 2;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [
      flag('maxEntriesAllowed'),
      flag('rangeAllowed'),
      new AlphaNumeric('supportedFormats', 0, 9, 256, 2),
    ], 0, 1),
  ];
}

class HKCSL extends SegmentDefinition {
  static Id = 'HKCSL';
  constructor() { super(HKCSL.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 0, 1, 256),
    new Binary('sepaMessage', 0, 1),
    new AlphaNumeric('orderId', 1, 1, 99),
  ];
}

class HICSLS extends SegmentDefinition {
  static Id = 'HICSLS';
  constructor() { super(HICSLS.Id); }
  version = 1;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [flag('orderDataRequired')], 0, 1),
  ];
}

// ---------------------------------------------------------------------------
// SEPA-Dauerauftrag
// ---------------------------------------------------------------------------

class HKCDE extends SegmentDefinition {
  static Id = 'HKCDE';
  constructor() { super(HKCDE.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
    details(1, true),
  ];
}

class HICDE extends SegmentDefinition {
  static Id = 'HICDE';
  constructor() { super(HICDE.Id); }
  version = 1;
  elements = [new AlphaNumeric('orderId', 0, 1, 99)];
}

class HICDES extends SegmentDefinition {
  static Id = 'HICDES';
  constructor() { super(HICDES.Id); }
  version = 1;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [
      // "überflüssig und soll kundenproduktseitig nicht geprüft werden" (spec)
      new Numeric('maxPurposeLines', 0, 1, 2),
      new Numeric('minDays', 0, 1, 4),
      new Numeric('maxDays', 0, 1, 4),
      // Chains of two-digit values, read as text so the leading zeros stay.
      new AlphaNumeric('months', 0, 1, 24),
      new AlphaNumeric('monthDays', 0, 1, 64),
      new AlphaNumeric('weeks', 0, 1, 104),
      new AlphaNumeric('weekDays', 0, 1, 7),
    ], 0, 1),
  ];
}

class HKCDB extends SegmentDefinition {
  static Id = 'HKCDB';
  constructor() { super(HKCDB.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    supportedFormats(),
    new AlphaNumeric('orderId', 0, 1, 99),
    new Numeric('maxEntries', 0, 1, 4),
    // The Aufsetzpunkt — see HKCSB.
    new AlphaNumeric('offset', 0, 1, 35),
  ];
}

class HICDB extends SegmentDefinition {
  static Id = 'HICDB';
  constructor() { super(HICDB.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 0, 1),
    new AlphaNumeric('sepaDescriptor', 0, 1, 256),
    new Binary('sepaMessage', 0, 1),
    new AlphaNumeric('orderId', 0, 1, 99),
    details(0, false),
    // Aussetzung (DEG version 3): jährlich, von, bis, Anzahl, abweichender Betrag (Wert:Währung).
    new DataGroup('suspension', [
      flag('annual'),
      new AlphaNumeric('from', 0, 1, 8),
      new AlphaNumeric('to', 0, 1, 8),
      new Numeric('count', 0, 1, 2),
      new AlphaNumeric('amount', 0, 1, 15),
      new AlphaNumeric('currency', 0, 1, 3),
    ], 0, 1),
    flag('canChange'),
    flag('canSuspend'),
    flag('canDelete'),
  ];
}

class HICDBS extends SegmentDefinition {
  static Id = 'HICDBS';
  constructor() { super(HICDBS.Id); }
  version = 2;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [
      flag('maxEntriesAllowed'),
      new AlphaNumeric('purposeCodes', 0, 1, 4096, 2),
      new AlphaNumeric('supportedFormats', 0, 9, 256, 2),
    ], 0, 1),
  ];
}

class HKCDL extends SegmentDefinition {
  static Id = 'HKCDL';
  constructor() { super(HKCDL.Id); }
  version = 2;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 0, 1, 256),
    new Binary('sepaMessage', 0, 1),
    // Ausführungsdatum: a deletion that takes effect later. Never sent — it
    // takes effect at once.
    new AlphaNumeric('date', 0, 1, 8),
    new AlphaNumeric('orderId', 0, 1, 99),
    details(1, false),
  ];
}

class HICDLS extends SegmentDefinition {
  static Id = 'HICDLS';
  constructor() { super(HICDLS.Id); }
  version = 2;
  elements = [
    ...paramHeader(),
    new DataGroup('params', [
      new Numeric('minDays', 0, 1, 4),
      new Numeric('maxDays', 0, 1, 4),
      flag('canSchedule'),
      flag('orderDataRequired'),
      new AlphaNumeric('purposeCodes', 0, 1, 4096, 2),
      new AlphaNumeric('supportedFormats', 0, 9, 256, 2),
    ], 0, 1),
  ];
}

for (const def of [
  new HKCSE(), new HICSE(), new HICSES(), new HKCSB(), new HICSB(), new HICSBS(), new HKCSL(), new HICSLS(),
  new HKCDE(), new HICDE(), new HICDES(), new HKCDB(), new HICDB(), new HICDBS(), new HKCDL(), new HICDLS(),
]) registerSegmentDefinition(def);

export const DATED_SEG = HKCSE.Id;
export const STANDING_SEG = HKCDE.Id;

/** Each kind's segments: place, list, delete — and what answers a list. */
export const ORDER_SEGS: Record<BankOrderKind, { create: string; list: string; listAnswer: string; remove: string }> = {
  dated: { create: HKCSE.Id, list: HKCSB.Id, listAnswer: HICSB.Id, remove: HKCSL.Id },
  standing: { create: HKCDE.Id, list: HKCDB.Id, listAnswer: HICDB.Id, remove: HKCDL.Id },
};

// ---------------------------------------------------------------------------
// The bank's rules (BPD)
// ---------------------------------------------------------------------------

type DatedParams = { minDays?: number; maxDays?: number };
type StandingParams = DatedParams & { months?: string; monthDays?: string; weeks?: string; weekDays?: string };

/** What "all" means where the bank's list says "00": the usual choices, never more. */
const ALL_MONTHS = [1, 2, 3, 6, 12];
const ALL_MONTH_DAYS = [...Array.from({ length: 30 }, (_, i) => i + 1), ULTIMO];
const ALL_WEEKS = [1, 2];
/** "0 (täglich)": the working days — a bank does not book on the weekend. */
const ALL_WEEK_DAYS = [1, 2, 3, 4, 5];

/**
 * A chain of `width`-digit values ("0102030612", "12345"): the numbers, or
 * 'all' for the spec's 00 / 0, or null when the element is empty.
 */
export function digitList(raw: string | undefined | null, width: 1 | 2): number[] | 'all' | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^0+$/.test(s)) return 'all';
  const out: number[] = [];
  for (let i = 0; i + width <= s.length; i += width) {
    const n = Number(s.slice(i, i + width));
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

const leadDays = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : fallback);

/** A terminierte Überweisung's rules from HICSES, or the fallback without them. */
export function datedRules(params: DatedParams | undefined | null): DatedRules {
  if (!params) return DEFAULT_DATED_RULES;
  const maxDays = leadDays(params.maxDays, DEFAULT_DATED_RULES.maxDays);
  return {
    minDays: leadDays(params.minDays, DEFAULT_DATED_RULES.minDays),
    maxDays: maxDays > 0 ? maxDays : DEFAULT_DATED_RULES.maxDays,
    fromBank: true,
  };
}

/** A Dauerauftrag's rules from HICDES, or the fallback without them. */
export function standingRules(params: StandingParams | undefined | null): StandingRules {
  if (!params) return DEFAULT_STANDING_RULES;
  const months = digitList(params.months, 2);
  const monthDays = digitList(params.monthDays, 2);
  const weeks = digitList(params.weeks, 2);
  const weekDays = digitList(params.weekDays, 1);
  const weekly = weeks === 'all' ? ALL_WEEKS : (weeks ?? []).filter((n) => n <= 52);
  const maxDays = leadDays(params.maxDays, DEFAULT_STANDING_RULES.maxDays);
  return {
    minDays: leadDays(params.minDays, DEFAULT_STANDING_RULES.minDays),
    maxDays: maxDays > 0 ? maxDays : DEFAULT_STANDING_RULES.maxDays,
    months: months === 'all' ? ALL_MONTHS : months ? months.filter((n) => n <= 12) : DEFAULT_STANDING_RULES.months,
    monthDays: monthDays === 'all'
      ? ALL_MONTH_DAYS
      : monthDays ? monthDays.filter((d) => d <= 30 || (d >= 97 && d <= 99)) : DEFAULT_STANDING_RULES.monthDays,
    weeks: weekly,
    weekDays: !weekly.length ? [] : weekDays === 'all' || !weekDays ? ALL_WEEK_DAYS : weekDays.filter((d) => d <= 7),
    fromBank: true,
  };
}

/**
 * What an account can do with each kind, and the bank's rules for it. A
 * capability needs both: the BPD declares the segment, and the account's UPD
 * allows it — as for a transfer. Deleting needs the list too, which is where
 * an order to delete comes from. Null for a kind the account offers nothing of.
 */
export function orderCaps(config: FinTSConfig, accountNumber: string): {
  dated: (OrderCaps & { rules: DatedRules }) | null;
  standing: (OrderCaps & { rules: StandingRules }) | null;
} {
  let account;
  try {
    account = config.getBankAccount(accountNumber);
  } catch {
    return { dated: null, standing: null };
  }
  const can = (segId: string) => config.isTransactionSupported(segId)
    && !!account.allowedTransactions?.find((t) => t.transId === segId);
  const caps = (kind: BankOrderKind): OrderCaps | null => {
    const s = ORDER_SEGS[kind];
    const list = can(s.list);
    const c = { create: !!account.iban && can(s.create), list, remove: list && can(s.remove) };
    return c.create || c.list ? c : null;
  };
  const dated = caps('dated');
  const standing = caps('standing');
  return {
    dated: dated && { ...dated, rules: datedRules(config.getTransactionParameters<DatedParams>(HKCSE.Id)) },
    standing: standing && { ...standing, rules: standingRules(config.getTransactionParameters<StandingParams>(HKCDE.Id)) },
  };
}

// ---------------------------------------------------------------------------
// Placing one
// ---------------------------------------------------------------------------

/** yyyy-mm-dd → JJJJMMTT. */
const finTsDate = (key: string) => key.replace(/-/g, '');

/** JJJJMMTT → yyyy-mm-dd, a virtual 30th of February moved to the month's last day; null if it is no date. */
export function dayKeyOf(raw: string | undefined | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const last = new Date(y, mo, 0).getDate();
  const d = Math.min(+m[3], last);
  if (d < 1) return null;
  const key = `${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`;
  return isDayKey(key) ? key : null;
}

/** The answer's Auftragsidentifikation as a transfer's result (HICSE / HICDE). */
function orderIdResult(response: Message, segId: string): TransferResult | null {
  const seg = response.findSegment<Segment & { orderId?: string }>(segId);
  const id = seg?.orderId?.trim();
  return id ? { orderId: id, cancellationCode: null, orderStatus: null } : null;
}

// No parameter properties in this module: `node --test` loads it with type
// stripping only.

/** HKCSE: the pain names the day itself. */
export class DatedTransferInteraction extends SepaOrderInteraction {
  readonly date: string;

  constructor(
    accountNumber: string,
    transfer: TransferOrder,
    date: string,
    vopMode: VopMode = 'auto',
    prebuilt?: { descriptor: string; sepaMessage: string },
  ) {
    super(HKCSE.Id, HICSE.Id, accountNumber, transfer, vopMode, prebuilt);
    this.date = date;
  }

  protected executionDate(): string {
    return this.date;
  }

  handleResponse(response: Message, clientResponse: ClientResponseWithResult): void {
    clientResponse.transferResult = orderIdResult(response, HICSE.Id) ?? undefined;
  }
}

/** HKCDE: the pain as for a transfer now, the schedule in the Dauerauftragdetails beside it. */
export class StandingOrderInteraction extends SepaOrderInteraction {
  readonly schedule: Extract<OrderSchedule, { kind: 'standing' }>;

  constructor(
    accountNumber: string,
    transfer: TransferOrder,
    schedule: Extract<OrderSchedule, { kind: 'standing' }>,
    vopMode: VopMode = 'auto',
    prebuilt?: { descriptor: string; sepaMessage: string },
  ) {
    super(HKCDE.Id, HICDE.Id, accountNumber, transfer, vopMode, prebuilt);
    this.schedule = schedule;
  }

  protected orderElements(): Record<string, unknown> {
    return { details: standingDetails(this.schedule) };
  }

  handleResponse(response: Message, clientResponse: ClientResponseWithResult): void {
    clientResponse.transferResult = orderIdResult(response, HICDE.Id) ?? undefined;
  }
}

/** The Dauerauftragdetails for a schedule, as HKCDE carries them. */
export function standingDetails(s: Extract<OrderSchedule, { kind: 'standing' }>) {
  return {
    firstDate: finTsDate(s.first),
    unit: s.unit,
    interval: s.interval,
    day: s.day,
    lastDate: s.last ? finTsDate(s.last) : undefined,
  };
}

/** The segment an order goes out as. */
export function orderSegId(instant: boolean, schedule?: OrderSchedule | null): string {
  if (schedule?.kind === 'dated') return HKCSE.Id;
  if (schedule?.kind === 'standing') return HKCDE.Id;
  return instant ? 'HKIPZ' : 'HKCCS';
}

/**
 * The interaction for an order: a transfer (now, or Echtzeit), a terminierte
 * Überweisung or a Dauerauftrag. One way in for the transfer route and the
 * Namensabgleich's re-submission, so a confirmed order is rebuilt exactly as
 * it was first sent.
 */
export function orderInteraction(
  accountNumber: string,
  transfer: TransferOrder,
  opts: { instant: boolean; schedule?: OrderSchedule | null },
  vopMode: VopMode = 'auto',
  prebuilt?: { descriptor: string; sepaMessage: string },
): SepaOrderInteraction {
  const s = opts.schedule;
  if (s?.kind === 'dated') return new DatedTransferInteraction(accountNumber, transfer, s.date, vopMode, prebuilt);
  if (s?.kind === 'standing') return new StandingOrderInteraction(accountNumber, transfer, s, vopMode, prebuilt);
  return new SepaTransferInteraction(accountNumber, transfer, opts.instant, vopMode, prebuilt);
}

// ---------------------------------------------------------------------------
// Reading the pain.001 the bank keeps
// ---------------------------------------------------------------------------

export type PainPayment = {
  name: string;
  iban: string;
  bic: string | null;
  cents: number;
  currency: string;
  purpose: string;
};

export type PainRead = {
  /** ReqdExctnDt as yyyy-mm-dd; null when absent or not a date. */
  executionDate: string | null;
  payments: PainPayment[];
};

/** "1234.5" → 123450 cents; null for anything that is not a SEPA amount. */
function centsOf(text: string | null): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * The pain message as text. It arrives as the bytes the bank sent (lib-fints
 * reads a message as ISO 8859-1); a pain.001 is UTF-8 unless its declaration
 * says otherwise, so its umlauts are decoded here.
 */
export function painText(raw: string): string {
  const declared = /^﻿?<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1]?.toLowerCase();
  if (declared && declared !== 'utf-8' && declared !== 'utf8') return raw;
  // Pure ASCII stays as it is, and so does text that is not valid UTF-8.
  if (!/[\u0080-ÿ]/.test(raw)) return raw;
  const text = Buffer.from(raw, 'latin1').toString('utf8');
  return text.includes('�') ? raw : text;
}

const clean = (s: string | null | undefined) => repairBankText(String(s ?? '')).replace(/\s+/g, ' ').trim();

/** The ReqdExctnDt of a payment information block: the bare date (pain .03) or inside <Dt> (pain .09). */
function executionDateOf(pmtInf: XmlNode | undefined): string | null {
  const node = child(pmtInf, 'ReqdExctnDt');
  if (!node) return null;
  const raw = textAt(node, 'Dt') ?? (node.children.length ? null : node.text.trim());
  const key = raw?.slice(0, 10) ?? '';
  return isDayKey(key) ? key : null;
}

/**
 * The payments of a pain.001 credit transfer (CstmrCdtTrfInitn), read by
 * local name — the same in .001.03, .003.03 and .001.09. Throws on a document
 * that is not one.
 */
export function readPain001(xml: string): PainRead {
  const doc = parseXml(painText(xml));
  const init = child(doc, 'CstmrCdtTrfInitn');
  if (!init) throw new Error('pain.001: no CstmrCdtTrfInitn');
  const blocks = children(init, 'PmtInf');
  if (!blocks.length) throw new Error('pain.001: no PmtInf');
  const payments: PainPayment[] = [];
  for (const pmt of blocks) {
    for (const tx of children(pmt, 'CdtTrfTxInf')) {
      const amt = at(tx, 'Amt', 'InstdAmt');
      const cents = centsOf(amt?.text ?? null);
      const iban = textAt(tx, 'CdtrAcct', 'Id', 'IBAN')?.replace(/\s+/g, '').toUpperCase() ?? '';
      if (cents == null || !iban) throw new Error('pain.001: a payment without amount or IBAN');
      payments.push({
        name: clean(textAt(tx, 'Cdtr', 'Nm')),
        iban,
        bic: textAt(tx, 'CdtrAgt', 'FinInstnId', 'BICFI') ?? textAt(tx, 'CdtrAgt', 'FinInstnId', 'BIC'),
        cents,
        currency: amt?.attrs.Ccy || 'EUR',
        purpose: clean(children(child(tx, 'RmtInf'), 'Ustrd').map((n) => n.text).join(' ')),
      });
    }
  }
  if (!payments.length) throw new Error('pain.001: no CdtTrfTxInf');
  return { executionDate: executionDateOf(blocks[0]), payments };
}

/** The descriptor of a pain message the bank sent without one: its own namespace. */
function descriptorOf(xml: string): string | null {
  try {
    const ns = parseXml(painText(xml)).attrs.xmlns;
    return ns && /pain\.001/.test(ns) ? ns : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The Bestand
// ---------------------------------------------------------------------------

type DetailsFields = { firstDate?: string; unit?: string; interval?: number; day?: number; execTime?: string; lastDate?: string };

type ListSegment = Segment & {
  account?: Record<string, unknown>;
  sepaDescriptor?: string;
  sepaMessage?: string;
  orderId?: string;
  details?: DetailsFields;
  canDelete?: string;
};

/** A Dauerauftrag's schedule from its Dauerauftragdetails; null when they do not add up to one. */
export function scheduleOfDetails(d: DetailsFields | undefined): OrderSchedule | null {
  const first = dayKeyOf(d?.firstDate);
  const unit = d?.unit?.trim().toUpperCase();
  const interval = d?.interval;
  const day = d?.day;
  if (!first || (unit !== 'M' && unit !== 'W') || !Number.isInteger(interval) || !Number.isInteger(day)) return null;
  if (!(interval! >= 1) || !(day! >= 1)) return null;
  return { kind: 'standing', first, unit: unit as Unit, interval: interval!, day: day!, last: dayKeyOf(d?.lastDate) };
}

/**
 * One list entry, or null when its pain message cannot be read. `deletable`
 * needs what a deletion sends back: the pain message, and for a terminierte
 * Überweisung the Auftragsidentifikation the spec makes mandatory there.
 */
export function readListEntry(kind: BankOrderKind, seg: ListSegment): ReadBankOrder | null {
  const pain = seg.sepaMessage;
  if (!pain) return null;
  let read: PainRead;
  try {
    read = readPain001(pain);
  } catch {
    return null;
  }
  const first = read.payments[0];
  const orderId = seg.orderId?.trim() || null;
  const schedule: OrderSchedule | null = kind === 'standing'
    ? scheduleOfDetails(seg.details)
    : read.executionDate ? { kind: 'dated', date: read.executionDate } : null;
  const descriptor = seg.sepaDescriptor?.trim() || descriptorOf(pain);
  const refused = seg.canDelete?.trim().toUpperCase() === 'N';
  const deletable = !refused && !!descriptor && (kind === 'standing' ? !!seg.details : !!orderId);
  const fields: Record<string, unknown> = { account: seg.account, orderId: seg.orderId, details: seg.details };
  return {
    order: {
      kind,
      orderId,
      name: first.name,
      iban: first.iban,
      bic: first.bic,
      amount: first.cents / 100,
      currency: first.currency,
      purpose: first.purpose,
      schedule,
      more: read.payments.length - 1,
      deletable,
    },
    raw: { sepaDescriptor: descriptor ?? '', sepaMessage: pain, fields },
  };
}

/** How many times the Aufsetzpunkt is followed before the list counts as cut short. */
export const MAX_LIST_ROUNDS = 10;

/** The Aufsetzpunkt of return code 3040, if the bank gave one. */
function offsetOf(response: Message): string | null {
  const answer = response.getBankAnswers().find((a) => a.code === 3040);
  return answer?.params?.find((p) => !!p && p.trim() !== '')?.trim() || null;
}

/**
 * HKCDB / HKCSB: the bank's list of one kind of orders for an account. Every
 * answer that carries entries adds them to the one read all the rounds share;
 * where the bank has more (3040 with an Aufsetzpunkt), the same request goes
 * out again with it, inside the same dialog, until the bank is done or
 * MAX_LIST_ROUNDS have passed. That works the same before and after an
 * approval. The read is on every answer (`bankOrders`), so whichever the
 * caller ends up holding has it all.
 */
export class BankOrderListInteraction extends CustomerOrderInteraction {
  readonly accountNumber: string;
  readonly kind: BankOrderKind;
  readonly debtorBic: string | undefined;
  readonly read: BankOrdersRead;
  private readonly offset: string | null;
  private readonly round: number;

  constructor(
    accountNumber: string,
    kind: BankOrderKind,
    debtorBic?: string,
    offset: string | null = null,
    shared?: BankOrdersRead,
    round = 1,
  ) {
    super(ORDER_SEGS[kind].list, ORDER_SEGS[kind].listAnswer);
    this.accountNumber = accountNumber;
    this.kind = kind;
    this.debtorBic = debtorBic;
    this.offset = offset;
    this.round = round;
    this.read = shared ?? { orders: [], complete: true, unreadable: 0 };
  }

  createSegments(config: FinTSConfig): Segment[] {
    const account = config.getBankAccount(this.accountNumber);
    if (!config.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }
    const version = config.getMaxSupportedTransactionVersion(this.segId) ?? 1;
    return [{
      header: { segId: this.segId, segNr: 0, version },
      account: { ...account, bic: this.debtorBic || undefined },
      // One format, as the spec asks: one the bank lists, and one this app reads.
      supportedFormats: [pickSepaDescriptor(config, this.segId)],
      offset: this.offset || undefined,
    } as Segment];
  }

  handleClientResponse(response: Message): ClientResponseWithResult {
    const clientResponse = super.handleClientResponse(response) as ClientResponseWithResult;
    clientResponse.bankOrders = this.read;
    if (!clientResponse.success || clientResponse.requiresTan || !response.hasReturnCode(3040)) return clientResponse;
    const offset = offsetOf(response);
    const dialog = this.dialog as { hasEnded?: boolean; addCustomerInteraction?: (i: CustomerOrderInteraction, after?: boolean) => void } | undefined;
    if (!offset || this.round >= MAX_LIST_ROUNDS || !dialog?.addCustomerInteraction || dialog.hasEnded) {
      this.read.complete = false;
      return clientResponse;
    }
    console.log(`[orders] ${this.segId}: more to come, round ${this.round + 1}`);
    dialog.addCustomerInteraction(
      new BankOrderListInteraction(this.accountNumber, this.kind, this.debtorBic, offset, this.read, this.round + 1),
      true,
    );
    return clientResponse;
  }

  handleResponse(response: Message): void {
    for (const seg of response.findAllSegments<ListSegment>(this.responseSegId)) {
      const entry = readListEntry(this.kind, seg);
      if (entry) this.read.orders.push(entry);
      else this.read.unreadable++;
    }
    // An entry the definition could not take arrives as an unknown segment: counted, never dropped silently.
    this.read.unreadable += response.findAllUnknownSegments(this.responseSegId).length;
  }
}

// ---------------------------------------------------------------------------
// Deleting one
// ---------------------------------------------------------------------------

/**
 * HKCDL / HKCSL for an order of the last Bestand read: the bank's own
 * descriptor, pain message, account and Dauerauftragdetails, sent back as the
 * Bestand delivered them, with its Auftragsidentifikation. Nothing comes back
 * but the return codes.
 */
export class BankOrderDeleteInteraction extends CustomerOrderInteraction {
  readonly accountNumber: string;
  readonly entry: ReadBankOrder;
  readonly debtorBic: string | undefined;

  constructor(accountNumber: string, entry: ReadBankOrder, debtorBic?: string) {
    super(ORDER_SEGS[entry.order.kind].remove, '');
    this.accountNumber = accountNumber;
    this.entry = entry;
    this.debtorBic = debtorBic;
  }

  createSegments(config: FinTSConfig): Segment[] {
    const kind = this.entry.order.kind;
    if (!config.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }
    if (!this.entry.order.deletable) throw Error(`${this.segId}: this order cannot be deleted`);
    const version = config.getMaxSupportedTransactionVersion(this.segId) ?? 1;
    const own = config.getBankAccount(this.accountNumber);
    const fields = this.entry.raw.fields as { account?: Record<string, unknown>; orderId?: string; details?: DetailsFields };
    // The account as the Bestand named it — the pain's DbtrAcct and DbtrAgt
    // match it — or, where it named none, as this app names it.
    const account = fields.account?.iban ? fields.account : { ...own, bic: this.debtorBic || undefined };
    const segment: Record<string, unknown> = {
      header: { segId: this.segId, segNr: 0, version },
      account,
      sepaDescriptor: this.entry.raw.sepaDescriptor,
      sepaMessage: this.entry.raw.sepaMessage,
      orderId: fields.orderId?.trim() || undefined,
    };
    if (kind === 'standing') segment.details = fields.details;
    return [segment as Segment];
  }

  handleResponse(): void {
    // HKCDL and HKCSL have no answer segment: the return codes say it all.
  }
}

// ---------------------------------------------------------------------------
// Handles for the browser
// ---------------------------------------------------------------------------

/** A fresh handle for one entry of one read: never reused, never derived from the order. */
export const newOrderRef = () => randomBytes(12).toString('hex');

/** An entry as the browser sees it: everything but the raw data, under a handle. */
export function serializeBankOrder(entry: ReadBankOrder, ref: string, canRemove: boolean): SerializedBankOrder {
  return { ...entry.order, ref, deletable: canRemove && entry.order.deletable };
}

/**
 * Keeps a fresh read in the session — replacing the last one of the same
 * account and kind, so a handle from an older list names nothing — and
 * answers it for the browser. Counts only in the log: no payee, no amount.
 */
export function holdBankOrders(
  s: Pick<Session, 'bankOrders'>,
  accountNumber: string,
  kind: BankOrderKind,
  read: BankOrdersRead,
  canRemove: boolean,
): BankOrdersAnswer {
  for (const [ref, held] of s.bankOrders) {
    if (held.accountNumber === accountNumber && held.kind === kind) s.bankOrders.delete(ref);
  }
  const orders = read.orders.map((entry) => {
    const ref = newOrderRef();
    s.bankOrders.set(ref, { ...entry, accountNumber, kind });
    return serializeBankOrder(entry, ref, canRemove);
  });
  console.log(`[orders] ${ORDER_SEGS[kind].list} orders=${orders.length} unreadable=${read.unreadable} complete=${read.complete}`);
  return { orderKind: kind, orders, complete: read.complete, unreadable: read.unreadable };
}
