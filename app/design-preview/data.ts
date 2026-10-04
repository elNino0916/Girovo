// Mock bank data for the design preview — a believable year of one person's
// banking, generated rather than hand-typed, so every surface has something
// real-looking to render without a bank session.
//
// Three accounts, the way a FinTS login hands them over:
//   Girokonto   MT940-shaped (HKKAZ): local-midnight dates, three-digit GVC,
//               caps booking texts, CRED+ in its own field, one booking whose
//               SEPA tags the bank ran together into the purpose.
//   Tagesgeld   CAMT-shaped (HKCAZ): local-noon dates, ISO sub-family codes,
//               mixed-case texts.
//   Kreditkarte CAMT-shaped card account without an IBAN, settled monthly
//               from the Girokonto by Umbuchung.
//
// Determinism: every booking draws its randomness from a PRNG seeded with its
// own identity (series + date), never from a shared stream. The same day
// therefore always produces the same amounts, and adding a series never
// reshuffles the others. "Today" is the real today, read once per page load —
// the data always ends now, which is what the date semantics need to be
// exercised ("Heute", "Gestern", a booking dated next Monday).
//
// Statement blocks are derived from the same ledger the bookings come from, so
// opening + Σ bookings = closing holds to the cent and the Kontoverlauf can be
// verified — or, on request, deliberately broken.

import type { ChosenBank } from '@/components/FintsProvider';
import type { ActivityEntry, DateRange, InboxMessage, VaultData } from '@/lib/app-types';
import type { PopularBank } from '@/lib/banks';
import type {
  MetaResponse, SerializedAccount, SerializedBalance, SerializedTanMethod, SerializedTransaction, StatementBlock,
} from '@/lib/fints-types';
import { addDaysKey, dayNumber, isTargetBusinessDay, isoDate, nextTargetBusinessDay } from '@/lib/format';

// ---------------------------------------------------------------------------
// Randomness and identifiers

/** cyrb53 folded to 32 bits — a stable seed from any string. */
function hash(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 ^ h1) >>> 0;
}

/** mulberry32, seeded per booking. */
function rng(key: string): () => number {
  let a = hash(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (v: number) => Math.round(v * 100) / 100;
const between = (r: () => number, lo: number, hi: number) => cents(lo + r() * (hi - lo));
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const digits = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');

/** A valid IBAN for a country and BBAN: the ISO 13616 check digits, computed. */
export function makeIban(country: string, bban: string): string {
  const s = `${bban}${country}00`.toUpperCase();
  let rem = 0;
  for (const ch of s) {
    const v = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return `${country}${String(98 - rem).padStart(2, '0')}${bban}`;
}

// ---------------------------------------------------------------------------
// Days

const pad2 = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => isoDate(new Date(y, m, d));
/** A yyyy-mm-dd as the JSON of lib-fints' MT940 Date: local midnight. */
const mt940Date = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
};
/** … and of its CAMT Date for a date-only value: local noon. */
const camtDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};
const deDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const rollForward = (day: string) => isoDate(nextTargetBusinessDay(day));
function lastBusinessDayOfMonth(y: number, m: number): string {
  let d = key(y, m + 1, 0);
  while (!isTargetBusinessDay(d)) d = addDaysKey(d, -1);
  return d;
}
const monthEnd = (y: number, m: number) => key(y, m + 1, 0);

// ---------------------------------------------------------------------------
// The cast

export const HOLDER = 'NINO BECKER';
const BLZ = '57069999';
const BIC = 'GENODED1MST';

export const MOCK_BANK: ChosenBank = {
  blz: BLZ,
  name: 'Volksbank Musterstadt eG',
  brand: 'vrbank',
  bic: BIC,
  location: 'Musterstadt',
};

export const ACCT = {
  giro: '0105593271',
  tagesgeld: '0105593280',
  karte: '4930XXXXXXXX1234',
} as const;

const GIRO_IBAN = makeIban('DE', `${BLZ}${ACCT.giro}`);
const TG_IBAN = makeIban('DE', `${BLZ}${ACCT.tagesgeld}`);

export const MOCK_ACCOUNTS: SerializedAccount[] = [
  {
    accountNumber: ACCT.giro, iban: GIRO_IBAN, bic: BIC, currency: 'EUR', accountType: 'CheckingAccount',
    holder: HOLDER, product: 'GiroKomfort', limit: 2000,
    canStatements: true, canBalance: true, canTransfer: true, canInstant: true, canPending: true,
  },
  {
    accountNumber: ACCT.tagesgeld, iban: TG_IBAN, bic: BIC, currency: 'EUR', accountType: 'SavingsAccount',
    holder: HOLDER, product: 'Tagesgeld', limit: null,
    canStatements: true, canBalance: true, canTransfer: true, canInstant: false, canPending: false,
  },
  {
    accountNumber: ACCT.karte, iban: null, bic: null, currency: 'EUR', accountType: 'CreditCardAccount',
    holder: HOLDER, product: 'Visa Classic', limit: 2500,
    canStatements: true, canBalance: true, canTransfer: false, canInstant: false, canPending: false,
  },
];

const LIMIT: Record<string, number | null> = { [ACCT.giro]: 2000, [ACCT.tagesgeld]: null, [ACCT.karte]: 2500 };

/** Counterparties with accounts of their own. IBANs are computed, so they all validate. */
const PARTY = {
  employer: { name: 'RHEINTAL SOFTWARE GMBH', iban: makeIban('DE', '370400440532013000'), bic: 'COBADEFFXXX' },
  landlord: { name: 'HAUSVERWALTUNG KRAEMER GMBH', iban: makeIban('DE', '512108001245126199'), bic: 'SOLADES1GIE' },
  stadtwerke: {
    name: 'STADTWERKE MUSTERSTADT GMBH', iban: makeIban('DE', '500105175407324931'), bic: 'INGDDEFFXXX',
    cred: 'DE98ZZZ09999999999', mref: 'SWM-4021889120',
  },
  netflix: {
    name: 'NETFLIX INTERNATIONAL B.V.', iban: makeIban('NL', 'ABNA0417164300'), bic: 'ABNANL2A',
    cred: 'NL57ZZZ342486780000', mref: 'NF-71920388412',
  },
  spotify: {
    name: 'SPOTIFY AB', iban: makeIban('SE', '50000000058398257466'), bic: 'ESSESESS',
    cred: 'SE53ZZZ5567037485', mref: 'SP-1180072254',
  },
  telekom: {
    name: 'TELEKOM DEUTSCHLAND GMBH', iban: makeIban('DE', '700100800024671803'), bic: 'PBNKDEFFXXX',
    cred: 'DE93ZZZ00000078611', mref: 'TDG-611344012201',
  },
  allianz: {
    name: 'ALLIANZ VERSICHERUNGS-AG', iban: makeIban('DE', '700800000310000600'), bic: 'DRESDEFF700',
    cred: 'DE34ZZZ00000014567', mref: 'AS-8841-2207',
  },
  huk: {
    name: 'HUK-COBURG ALLGEMEINE VERS. AG', iban: makeIban('DE', '783500000040077474'), bic: 'BYLADEM1COB',
    cred: 'DE21ZZZ00000098765', mref: 'KFZ-MZNB482-01',
  },
  rundfunk: {
    name: 'RUNDFUNK ARD, ZDF, DRADIO', iban: makeIban('DE', '370501980000222222'), bic: 'COLSDE33XXX',
    cred: 'DE16ZZZ00000107211', mref: 'RB-482117336',
  },
  amazon: {
    name: 'AMAZON PAYMENTS EUROPE S.C.A.', iban: makeIban('DE', '300308801908262006'), bic: 'TUBDDEDDXXX',
    cred: 'DE24ZZZ00000561652', mref: 'AMZ-5KX9QW2T1MB8',
  },
  paypal: {
    name: 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', iban: makeIban('LU', '751000135104200E'), bic: 'PPLXLUL2',
    cred: 'LU96ZZZ0000000000000000058', mref: '5RRJ2259NXZLLC',
  },
  lea: { name: 'LEA BECKER', iban: makeIban('DE', '500105170648489890'), bic: 'INGDDEFFXXX' },
  max: { name: 'MAX MUSTERMANN', iban: makeIban('DE', '100100100006820101'), bic: 'PBNKDEFFXXX' },
} as const;

// ---------------------------------------------------------------------------
// Booking builders

type Ledger = { account: string; day: string; tx: SerializedTransaction }[];

type Mt940Input = {
  day: string;
  valueDay?: string;
  amount: number;
  name: string;
  iban?: string;
  bic?: string;
  gvc: string;
  text: string;
  /** The SVWZ text. */
  purpose: string;
  cred?: string;
  mref?: string;
  eref?: string;
  /** The bank ran EREF+/MREF+/CRED+/SVWZ+ together: the parser keeps it all in `purpose`. */
  rawTags?: boolean;
};

const statementNo = (day: string) => `${day.slice(5, 7)}${day.slice(2, 4)}/001`;

function mt940(p: Mt940Input): SerializedTransaction {
  const raw = p.rawTags
    ? `${p.eref ? `EREF+${p.eref}` : ''}${p.mref ? `MREF+${p.mref}` : ''}${p.cred ? `CRED+${p.cred}` : ''}SVWZ+${p.purpose}`
    : p.purpose;
  const r = rng(`ref|${p.day}|${p.name}|${p.amount}`);
  return {
    valueDate: mt940Date(p.valueDay ?? p.day),
    entryDate: mt940Date(p.day),
    amount: p.amount,
    currency: 'EUR',
    purpose: raw,
    bookingText: p.text,
    remoteName: p.name,
    remoteIban: p.iban ?? '',
    remoteBic: p.bic ?? '',
    ...(p.cred && !p.rawTags ? { creditorId: p.cred } : {}),
    e2eReference: p.rawTags ? (p.eref ? raw.slice(5) : '') : (p.eref ?? ''),
    mandateReference: p.rawTags ? '' : (p.mref ?? ''),
    customerReference: 'NONREF',
    bankReference: `${p.day.replace(/-/g, '').slice(2)}${digits(r, 8)}`,
    transactionCode: p.gvc,
    primeNotesNr: String(9000 + Math.floor(r() * 900)),
    textKeyExtension: '000',
    additionalInformation: '',
    statementNumber: statementNo(p.day),
  };
}

type CamtInput = {
  day: string;
  valueDay?: string;
  amount: number;
  name: string;
  iban?: string;
  bic?: string;
  /** ISO 20022 sub-family, e.g. 'CCRD', 'BOOK', 'INTR'. */
  code: string;
  text: string;
  purpose: string;
  eref?: string;
};

function camt(p: CamtInput): SerializedTransaction {
  const r = rng(`camt|${p.day}|${p.name}|${p.amount}`);
  return {
    valueDate: camtDate(p.valueDay ?? p.day),
    entryDate: camtDate(p.day),
    amount: p.amount,
    currency: 'EUR',
    purpose: p.purpose,
    bookingText: p.text,
    remoteName: p.name,
    remoteIban: p.iban ?? '',
    remoteBic: p.bic ?? '',
    e2eReference: p.eref ?? 'NOTPROVIDED',
    mandateReference: '',
    customerReference: p.eref ?? 'NOTPROVIDED',
    bankReference: `2${digits(r, 15)}`,
    transactionCode: p.code,
    primeNotesNr: '',
    textKeyExtension: '',
    additionalInformation: p.text,
    statementNumber: `${p.day.slice(0, 4)}${p.day.slice(5, 7)}`,
  };
}

// ---------------------------------------------------------------------------
// The year

const GROCERS = [
  { name: 'REWE MARKT GMBH-ZWNL', label: 'REWE Markt GmbH', w: 0.34, lo: 14, hi: 92 },
  { name: 'ALDI SUED SAGT DANKE', label: 'ALDI SUED', w: 0.24, lo: 9, hi: 58 },
  { name: 'EDEKA CENTER MUELLER', label: 'EDEKA Mueller', w: 0.2, lo: 6, hi: 44 },
  { name: 'DM-DROGERIE MARKT SAGT DANKE', label: 'dm-drogerie markt', w: 0.22, lo: 4, hi: 31 },
] as const;

const FUEL = [
  { name: 'ARAL STATION 4711', label: 'ARAL Station 4711' },
  { name: 'SHELL DEUTSCHLAND GMBH', label: 'Shell 1294' },
  { name: 'JET TANKSTELLE 3302', label: 'JET Tankstelle' },
] as const;

const FOOD = [
  { name: 'PIZZERIA DA MARIO', lo: 18, hi: 62 },
  { name: 'VAPIANO MUSTERSTADT', lo: 14, hi: 41 },
  { name: 'CAFE EXTRABLATT', lo: 8, hi: 27 },
  { name: 'MCDONALDS 1182', lo: 7, hi: 19 },
  { name: 'BACKWERK 0412', lo: 4, hi: 12 },
  { name: 'SUSHI YANA', lo: 21, hi: 58 },
] as const;

const CARD_TRAVEL = [
  { name: 'Lufthansa', purpose: 'Lufthansa 2201234567890 Frankfurt', lo: 160, hi: 420 },
  { name: 'Booking.com', purpose: 'Booking.com Amsterdam NL', lo: 88, hi: 260 },
  { name: 'DB Vertrieb GmbH', purpose: 'DB Fernverkehr Online-Ticket', lo: 24, hi: 119 },
  { name: 'Uber *Trip', purpose: 'Uber *Trip help.uber.com NL', lo: 9, hi: 34 },
  { name: 'Steamgames.com 4259522985', purpose: 'Steam Purchase Bellevue US', lo: 5, hi: 60 },
  { name: 'Thalia Buecher GmbH', purpose: 'Thalia.de Online-Shop', lo: 9, hi: 46 },
] as const;

type Generated = {
  today: string;
  /** accountNumber → every booking, oldest first (forward-dated included). */
  ledgers: Record<string, Ledger>;
  /** accountNumber → balance at the start of the generated window (before its first day). */
  start: Record<string, number>;
  windowFrom: string;
  pending: Record<string, SerializedTransaction[]>;
};

function generate(today: string): Generated {
  const [ty, tm] = today.split('-').map(Number);
  const tMonth = tm - 1;
  /** The window opens on the first of the month thirteen months back. */
  const windowFrom = key(ty, tMonth - 13, 1);
  const giro: Ledger = [];
  const tg: Ledger = [];
  const cc: Ledger = [];
  const g = (day: string, tx: SerializedTransaction) => { if (day >= windowFrom) giro.push({ account: ACCT.giro, day, tx }); };
  const t = (day: string, tx: SerializedTransaction) => { if (day >= windowFrom) tg.push({ account: ACCT.tagesgeld, day, tx }); };
  const c = (day: string, tx: SerializedTransaction) => { if (day >= windowFrom) cc.push({ account: ACCT.karte, day, tx }); };
  /** Due on or before today — and, for the one deliberate exception, a day ahead. */
  const due = (day: string) => day <= today;

  const months: { y: number; m: number; idx: number }[] = [];
  for (let i = -13; i <= 0; i++) {
    const d = new Date(ty, tMonth + i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), idx: i });
  }
  const mm = (y: number, m: number) => `${pad2(m + 1)}/${y}`;

  // Netflix's newest booking carries the new price — the "Betrag gestiegen" case.
  const netflixDays = months.map(({ y, m }) => rollForward(key(y, m, 12))).filter(due);
  const netflixLatest = netflixDays[netflixDays.length - 1];

  for (const { y, m, idx } of months) {
    const tag = `${y}-${pad2(m + 1)}`;

    // Gehalt — last business day, a few euros of overtime either way.
    const payday = lastBusinessDayOfMonth(y, m);
    if (due(payday)) {
      const r = rng(`gehalt|${tag}`);
      const amount = cents(3184.27 + (r() - 0.35) * 46);
      g(payday, mt940({
        day: payday, amount, ...PARTY.employer, gvc: '153', text: 'LOHN/GEHALT',
        purpose: `LOHN/GEHALT ${mm(y, m)} PERSONALNR. 44821`, eref: `GEH${tag.replace('-', '')}44821`,
      }));
    }

    // Miete — Dauerauftrag on the first, executed on the next business day.
    const rent = rollForward(key(y, m, 1));
    if (due(rent)) {
      g(rent, mt940({
        day: rent, amount: -1090, ...PARTY.landlord, gvc: '117', text: 'DAUERAUFTRAG',
        purpose: `MIETE WHG 3.OG LINKS INKL. NEBENKOSTEN ${mm(y, m)}`,
      }));
    }

    // Sparrate — Dauerauftrag to the own Tagesgeld, mirrored there.
    const save = rollForward(key(y, m, 2));
    if (due(save)) {
      g(save, mt940({
        day: save, amount: -650, name: HOLDER, iban: TG_IBAN, bic: BIC, gvc: '117', text: 'DAUERAUFTRAG',
        purpose: 'SPARRATE TAGESGELD',
      }));
      t(save, camt({
        day: save, amount: 650, name: 'Nino Becker', iban: GIRO_IBAN, bic: BIC, code: 'STDO', text: 'Dauerauftrag',
        purpose: 'Sparrate Tagesgeld',
      }));
    }

    // Telekom — direct debit on the 4th, one month with roaming on top.
    const phone = rollForward(key(y, m, 4));
    if (due(phone)) {
      const amount = idx === -5 ? -47.33 : -39.95;
      g(phone, mt940({
        day: phone, amount, ...PARTY.telekom, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `KD-NR. 6113 4401 22 RG ${mm(y, m)} MOBILFUNK`, eref: `TDG${tag.replace('-', '')}61134401`,
      }));
    }

    // Netflix on the 12th.
    const nf = rollForward(key(y, m, 12));
    if (due(nf)) {
      g(nf, mt940({
        day: nf, amount: nf === netflixLatest ? -15.99 : -13.99, ...PARTY.netflix, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `NETFLIX.COM MITGLIEDSCHAFT ${mm(y, m)}`, eref: `NF${tag.replace('-', '')}7192`,
      }));
    }

    // Stadtwerke Abschlag on the 15th.
    const sw = rollForward(key(y, m, 15));
    if (due(sw)) {
      g(sw, mt940({
        day: sw, amount: -148, ...PARTY.stadtwerke, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `ABSCHLAG STROM/GAS VK 4021889120 ${mm(y, m)}`, eref: `SWM${tag.replace('-', '')}4021889120`,
      }));
    }
    // … and its yearly statement came back with money to return — the refund.
    if (idx === -7) {
      const back = rollForward(key(y, m, 20));
      if (due(back)) {
        g(back, mt940({
          day: back, amount: 86.4, ...PARTY.stadtwerke, gvc: '166', text: 'GUTSCHRIFT',
          purpose: `GUTHABEN JAHRESABRECHNUNG ${y - 1} VK 4021889120`,
        }));
      }
    }

    // Spotify on the 21st.
    const sp = rollForward(key(y, m, 21));
    if (due(sp)) {
      g(sp, mt940({
        day: sp, amount: -11.99, ...PARTY.spotify, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `SPOTIFY P2C8F1A9D2 PREMIUM ${mm(y, m)}`, eref: `SP${tag.replace('-', '')}1180`,
      }));
    }

    // Hausrat + Haftpflicht, quarterly on the first of Jan/Apr/Jul/Oct.
    if (m % 3 === 0) {
      const ins = rollForward(key(y, m, 1));
      if (due(ins)) {
        g(ins, mt940({
          day: ins, amount: -38.61, ...PARTY.allianz, gvc: '105', text: 'BASISLASTSCHRIFT',
          purpose: `HAUSRAT + PRIVATHAFTPFLICHT VS-NR. AS-8841-2207 BEITRAG ${pad2(m + 1)}-${pad2(m + 3)}/${y}`,
        }));
      }
    }

    // Kfz-Versicherung, yearly — in the month before this one, so both years
    // sit inside the thirteen-month window.
    if (idx === -1 || idx === -13) {
      const kfz = rollForward(key(y, m, 1));
      if (due(kfz)) {
        g(kfz, mt940({
          day: kfz, amount: -486.3, ...PARTY.huk, gvc: '105', text: 'BASISLASTSCHRIFT',
          purpose: `KFZ-HAFTPFLICHT + TEILKASKO MZ-NB 482 BEITRAG ${pad2(m + 1)}/${y}-${pad2(m === 0 ? 12 : m)}/${m === 0 ? y : y + 1}`,
        }));
      }
    }

    // Rundfunkbeitrag, yearly in advance.
    if (idx === -7) {
      const rb = rollForward(key(y, m, 15));
      if (due(rb)) {
        g(rb, mt940({
          day: rb, amount: -220.32, ...PARTY.rundfunk, gvc: '105', text: 'BASISLASTSCHRIFT',
          purpose: `RUNDFUNKBEITRAG BEITRAGSNR. 482 117 336 ${pad2(m + 1)}.${y}-${pad2(m === 0 ? 12 : m)}.${m === 0 ? y : y + 1}`,
        }));
      }
    }

    // Kontoführung, at the month's end.
    const fee = lastBusinessDayOfMonth(y, m);
    if (due(fee)) {
      g(fee, mt940({
        day: fee, amount: -6.9, name: '', gvc: '805', text: 'ENTGELTABSCHLUSS',
        purpose: `ENTGELTE VOM 01.${pad2(m + 1)}.${y} BIS ${deDate(monthEnd(y, m))} KONTOFUEHRUNG 6,90`,
      }));
    }

    // Tagesgeld interest, quarterly.
    if (m % 3 === 2) {
      const intr = monthEnd(y, m);
      if (due(intr)) {
        const r = rng(`zins|${tag}`);
        t(intr, camt({
          day: intr, amount: cents(28 + r() * 9), name: '', code: 'INTR', text: 'Zinsgutschrift',
          purpose: `Zinsen ${pad2(m - 1)}–${pad2(m + 1)}/${y} 1,75 % p. a.`,
        }));
      }
    }

    // Umbuchungen back from the Tagesgeld before a big bill.
    if (idx === -2 || idx === -9) {
      const back = rollForward(key(y, m, 26));
      if (due(back)) {
        const amount = idx === -2 ? 1000 : 600;
        t(back, camt({
          day: back, amount: -amount, name: 'Nino Becker', iban: GIRO_IBAN, bic: BIC, code: 'BOOK', text: 'Umbuchung',
          purpose: 'Umbuchung auf Girokonto',
        }));
        g(back, mt940({
          day: back, amount, name: HOLDER, iban: TG_IBAN, bic: BIC, gvc: '166', text: 'UMBUCHUNG',
          purpose: 'UMBUCHUNG AUF GIROKONTO',
        }));
      }
    }

    // A private transfer to Lea most months, and money back from Max now and then.
    {
      const r = rng(`lea|${tag}`);
      const day = rollForward(key(y, m, 5 + Math.floor(r() * 18)));
      if (due(day) && r() < 0.8) {
        g(day, mt940({
          day, amount: -pick(r, [40, 50, 50, 75]), ...PARTY.lea, gvc: '116', text: 'ONLINE-UEBERWEISUNG',
          purpose: pick(r, ['TASCHENGELD', 'GEBURTSTAGSGESCHENK', 'ANTEIL KONZERTKARTEN', 'TASCHENGELD']),
        }));
      }
      if (idx === -3 || idx === -10) {
        const back = rollForward(key(y, m, 8));
        if (due(back)) {
          g(back, mt940({
            day: back, amount: 150, ...PARTY.max, gvc: '166', text: 'GUTSCHRIFT UEBERWEISUNG',
            purpose: 'RUECKZAHLUNG URLAUBSKASSE',
          }));
        }
      }
    }
  }

  // Weekly rhythm: groceries, fuel, eating out, online shopping, cash.
  for (let day = windowFrom; day < today; day = addDaysKey(day, 1)) {
    const r = rng(`day|${day}`);
    const dow = new Date(dayNumber(day) * 86_400_000).getUTCDay();
    if (dow === 0) continue; // shops are shut on Sundays
    // Card payments reach the statement a business day later, valued on the
    // day of purchase — the "Wert" the list shows when the two differ.
    const booked = isoDate(nextTargetBusinessDay(addDaysKey(day, 1)));
    if (booked > today) continue;
    const clock = () => `${pad2(9 + Math.floor(r() * 11))}:${pad2(Math.floor(r() * 60))}:${pad2(Math.floor(r() * 60))}`;
    const card = (name: string, label: string, amount: number) => g(booked, mt940({
      day: booked, valueDay: day, amount: -amount, name, gvc: '106', text: 'KARTENZAHLUNG',
      purpose: `${label}//MUSTERSTADT/DE ${day}T${clock()} KFN 1 VJ 2912`,
    }));

    if (r() < (dow === 6 ? 0.75 : 0.36)) {
      let w = r();
      const shop = GROCERS.find((s) => (w -= s.w) < 0) ?? GROCERS[0];
      card(shop.name, shop.label, between(r, shop.lo, shop.hi));
    }
    if (r() < 0.095) {
      const f = pick(r, FUEL);
      card(f.name, f.label, between(r, 52, 78));
    }
    if (r() < (dow >= 5 ? 0.32 : 0.12)) {
      const f = pick(r, FOOD);
      card(f.name, f.name, between(r, f.lo, f.hi));
    }
    if (r() < 0.07) {
      const id = `${digits(r, 3)}-${digits(r, 7)}-${digits(r, 7)}`;
      g(booked, mt940({
        day: booked, amount: -between(r, 11, 89), ...PARTY.amazon, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `${id} AMAZON.DE ${digits(r, 4)}${String.fromCharCode(65 + Math.floor(r() * 26))}${digits(r, 6)}`,
        eref: `${id}`,
      }));
    }
    if (r() < 0.04) {
      // The bank ran the SEPA tags together — the parser leaves them in the purpose.
      const shop = pick(r, ['ZALANDO SE', 'TCHIBO GMBH', 'IKEA DEUTSCHLAND', 'THOMANN GMBH']);
      g(booked, mt940({
        day: booked, amount: -between(r, 19, 129), ...PARTY.paypal, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: `PP.${digits(r, 4)}.PP . ${shop}, Ihr Einkauf bei ${shop}`,
        eref: `10${digits(r, 11)} PP.${digits(r, 4)}.PP PAYPAL`, rawTags: true,
      }));
    }
    if (r() < 0.05) {
      // Visa Debit through the Sparkassen card processor, as a real statement
      // has it: the counterparty is the processor (its umlaut already broken by
      // the bank's SWIFT conversion), the booking text says nothing about a
      // card, and the purpose is the card system's own record — including the
      // "Einsatzentgelt" that used to file these under Bankentgelte.
      const usd = r() < 0.4;
      const base = cents(between(r, 4, 39));
      const de = (n: number) => n.toFixed(2).replace('.', ',');
      const at = `${day}T${clock().slice(0, 5)}`;
      // The shop rides along as the "abweichender Empfänger" (ABWE+) — what
      // the Sparkasse app shows as the receiver.
      const shop = usd
        ? pick(r, ['STEAM PURCHASE', 'OPENAI *CHATGPT SUBSCR', 'TEMU.COM'])
        : pick(r, ['AMAZON EU S.A R.L.', 'DM DROGERIE MARKT', 'DB VERTRIEB GMBH', 'LIEFERANDO.DE']);
      g(booked, {
        ...mt940({
          day: booked, valueDay: day, amount: -cents(base + (usd ? 0.15 : 1)), name: 'Landesbank Hessen-ThA.ringen',
          iban: 'DE41500500000001234567', gvc: '005', text: 'LASTSCHRIFT',
          purpose: usd
            ? `${at} Debitk.0 2030-12 Original ${de(base * 1.1563)} USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR Zahl.System VISA Debit`
            : `${at} Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit`,
        }),
        ultimateName: shop,
      });
    }
    if (r() < 0.05) {
      // A girocard payment at a café whose terminal runs through Adyen: the
      // acquirer holds the account, the terminal's descriptor names the shop
      // — street, town (its umlaut dropped by SWIFT) and country included.
      g(booked, {
        ...mt940({
          day: booked, valueDay: day, amount: -between(r, 3.2, 8.9), name: 'Adyen N.V.',
          iban: 'NL50ADYB2017400157', gvc: '106', text: 'KARTENZAHLUNG',
          purpose: `${day}T${clock().slice(0, 5)} Debitk.0 2030-12`,
        }),
        ultimateName: 'LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE',
      });
    }
    if (r() < 0.045) {
      const amount = pick(r, [50, 100, 100, 150, 200]);
      g(booked, mt940({
        day: booked, valueDay: day, amount: -amount, name: 'VOLKSBANK MUSTERSTADT EG', gvc: '083', text: 'BARGELDAUSZAHLUNG',
        purpose: `GA NR00004471 BLZ${BLZ} 0 ${day.slice(8, 10)}.${day.slice(5, 7)}/${clock().slice(0, 5).replace(':', '.')}`,
      }));
    }
    // Credit card: travel and online now and then, iCloud monthly.
    if (r() < 0.06) {
      const p = pick(r, CARD_TRAVEL);
      c(booked, camt({ day: booked, valueDay: day, amount: -between(r, p.lo, p.hi), name: p.name, code: 'CCRD', text: 'Kartenumsatz', purpose: p.purpose }));
    }
  }
  for (const { y, m } of months) {
    const day = key(y, m, 6);
    const booked = isoDate(nextTargetBusinessDay(addDaysKey(day, 1)));
    if (booked <= today && day >= windowFrom) {
      c(booked, camt({ day: booked, valueDay: day, amount: -2.99, name: 'Apple.com/bill', code: 'CCRD', text: 'Kartenumsatz', purpose: 'Apple.com/bill iCloud+ 50 GB Cork IE' }));
    }
  }

  // Kreditkartenabrechnung — last month's card total, moved over on the 10th.
  // After the card bookings exist; only card turnover counts, not the
  // previous settlement credits on the card account.
  for (const { y, m, idx } of months) {
    if (idx === -13) continue;
    const settle = rollForward(key(y, m, 10));
    if (!due(settle)) continue;
    const prev = new Date(y, m - 1, 1);
    const from = key(prev.getFullYear(), prev.getMonth(), 1);
    const to = monthEnd(prev.getFullYear(), prev.getMonth());
    const total = -cents(cc
      .filter((b) => b.day >= from && b.day <= to && b.tx.transactionCode === 'CCRD')
      .reduce((s, b) => s + b.tx.amount, 0));
    if (total <= 0) continue;
    g(settle, mt940({
      day: settle, amount: -total, name: 'VOLKSBANK MUSTERSTADT EG', gvc: '116', text: 'UMBUCHUNG',
      purpose: `KREDITKARTENABRECHNUNG VISA 4930 XXXX XXXX 1234 VOM ${deDate(to)}`,
    }));
    c(settle, camt({
      day: settle, amount: total, name: 'Volksbank Musterstadt eG', code: 'BOOK', text: 'Umbuchung',
      purpose: `Ausgleich Kartenkonto per ${deDate(to)}`,
    }));
  }

  // A refund from Amazon — the credit side of a shop.
  {
    const back = rollForward(addDaysKey(today, -23));
    g(back, mt940({
      day: back, amount: 34.99, ...PARTY.amazon, gvc: '166', text: 'GUTSCHRIFT',
      purpose: '302-8841923-5521307 ERSTATTUNG AMAZON.DE RUECKSENDUNG', eref: '302-8841923-5521307',
    }));
  }

  // The bank already lists a booking dated for the next business day: the
  // statement fetched today knows it, the closing balance does not.
  {
    const ahead = isoDate(nextTargetBusinessDay(addDaysKey(today, 1)));
    g(ahead, mt940({
      day: ahead, valueDay: today, amount: -64.18, name: FUEL[0].name, gvc: '106', text: 'KARTENZAHLUNG',
      purpose: `${FUEL[0].label}//MUSTERSTADT/DE ${today}T08:12:40 KFN 1 VJ 2912`,
    }));
  }

  const byDay = (a: Ledger[number], b: Ledger[number]) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  giro.sort(byDay);
  tg.sort(byDay);
  cc.sort(byDay);

  // Starting balances are chosen so that today's figures look like a real
  // person's: the Girokonto dips into the Dispo once before a payday inside
  // the last 90 days (the Kontoverlauf's below-zero tint), the Tagesgeld holds
  // a cushion, the card starts settled.
  const dipFloor = -137.42;
  const ninetyAgo = addDaysKey(today, -90);
  let run = 0;
  let minRecent = Infinity;
  let idx = 0;
  for (let day = windowFrom; day <= today; day = addDaysKey(day, 1)) {
    while (idx < giro.length && giro[idx].day <= day) run += giro[idx++].tx.amount;
    if (day >= ninetyAgo && run < minRecent) minRecent = run;
  }
  const tgSum = tg.filter((b) => b.day <= today).reduce((s, b) => s + b.tx.amount, 0);

  const pendingDay = today;
  const pending: Record<string, SerializedTransaction[]> = {
    [ACCT.giro]: [
      mt940({
        day: pendingDay, amount: -23.48, name: GROCERS[0].name, gvc: '106', text: 'KARTENZAHLUNG',
        purpose: `${GROCERS[0].label}//MUSTERSTADT/DE ${today}T10:41:07 KFN 1 VJ 2912`,
      }),
      mt940({
        day: pendingDay, amount: -49.9, ...PARTY.amazon, gvc: '105', text: 'BASISLASTSCHRIFT',
        purpose: '302-1180443-9921776 AMAZON.DE BESTELLUNG', eref: '302-1180443-9921776',
      }),
    ],
    [ACCT.tagesgeld]: [],
    [ACCT.karte]: [],
  };

  return {
    today,
    ledgers: { [ACCT.giro]: giro, [ACCT.tagesgeld]: tg, [ACCT.karte]: cc },
    start: {
      [ACCT.giro]: cents(dipFloor - minRecent),
      [ACCT.tagesgeld]: cents(8416.73 - tgSum),
      [ACCT.karte]: 0,
    },
    windowFrom,
    pending,
  };
}

// ---------------------------------------------------------------------------
// Statements

export type MockStatement = {
  txs: SerializedTransaction[];
  blocks: StatementBlock[];
  /** The balance as of the range's end — the provider only takes it when that end is today. */
  balance: SerializedBalance | null;
};

export type MockData = {
  today: string;
  windowFrom: string;
  bank: ChosenBank;
  userId: string;
  accounts: SerializedAccount[];
  /** What a statement request for `range` would answer. `broken` falsifies one block's closing. */
  statement(accountNumber: string, range: DateRange, opts?: { broken?: boolean; empty?: boolean }): MockStatement;
  /** Today's balance of an account. */
  balance(accountNumber: string, opts?: { empty?: boolean }): SerializedBalance;
  pending: Record<string, SerializedTransaction[]>;
  messages(receivedAt: string): InboxMessage[];
  tanMethods: SerializedTanMethod[];
  popularBanks: PopularBank[];
  logoFiles: Record<string, string>;
  meta: MetaResponse;
  vault: VaultData;
  activity(now: number): ActivityEntry[];
};

function buildMockData(today: string): MockData {
  const gen = generate(today);

  /** Balance at the end of `day`, as the ledger has it. */
  const balanceAt = (acct: string, day: string): number => {
    let v = gen.start[acct] ?? 0;
    for (const b of gen.ledgers[acct] ?? []) {
      if (b.day > day) break;
      v += b.tx.amount;
    }
    return cents(v);
  };

  const dateOf = (acct: string) => (acct === ACCT.giro ? mt940Date : camtDate);

  const balance = (acct: string, opts: { empty?: boolean } = {}): SerializedBalance => {
    const value = opts.empty ? (acct === ACCT.giro ? 1250 : acct === ACCT.karte ? 0 : 5000) : balanceAt(acct, today);
    const limit = LIMIT[acct];
    const noted = acct === ACCT.giro && !opts.empty ? gen.pending[acct].reduce((s, t) => s + t.amount, 0) : 0;
    return {
      balance: value,
      currency: 'EUR',
      date: dateOf(acct)(today),
      availableAmount: cents(value + (limit ?? 0) + noted),
      creditLimit: limit,
    };
  };

  const statement = (acct: string, range: DateRange, opts: { broken?: boolean; empty?: boolean } = {}): MockStatement => {
    const { from, to } = range;
    const toDate = dateOf(acct);
    if (opts.empty) {
      const b = balance(acct, { empty: true });
      return {
        txs: [],
        blocks: [{
          openingBalance: b.balance, openingDate: toDate(addDaysKey(from, -1)),
          closingBalance: b.balance, closingDate: toDate(to), currency: 'EUR', count: 0,
        }],
        balance: to >= today ? b : null,
      };
    }
    const reachesToday = to >= today;
    const rows = (gen.ledgers[acct] ?? []).filter((b) => b.day >= from && (b.day <= to || (reachesToday && b.day > today)));

    // One block per calendar month the range touches, as banks cut their
    // Kontoauszüge; the last one also lists what is already dated ahead.
    const blocks: StatementBlock[] = [];
    let segStart = from;
    while (segStart <= to) {
      const [y, m] = segStart.split('-').map(Number);
      const end = monthEnd(y, m - 1);
      const segEnd = end < to ? end : to;
      const last = segEnd === to;
      const count = rows.filter((b) => b.day >= segStart && (b.day <= segEnd || (last && b.day > to))).length;
      blocks.push({
        openingBalance: balanceAt(acct, addDaysKey(segStart, -1)),
        openingDate: toDate(addDaysKey(segStart, -1)),
        closingBalance: balanceAt(acct, segEnd),
        closingDate: toDate(segEnd),
        currency: 'EUR',
        count,
      });
      segStart = addDaysKey(segEnd, 1);
    }
    if (opts.broken && blocks.length) {
      // Ten cents the bookings do not account for: the chain still joins up,
      // the arithmetic does not — exactly what the verifier must refuse.
      const k = Math.max(0, Math.floor((blocks.length - 1) / 2));
      blocks[k] = { ...blocks[k], closingBalance: cents((blocks[k].closingBalance ?? 0) + 0.1) };
      if (blocks[k + 1]) blocks[k + 1] = { ...blocks[k + 1], openingBalance: blocks[k].closingBalance };
    }

    // Newest first, the way serializeTransactions hands them over.
    const txs = rows.map((b) => b.tx).reverse();
    return { txs, blocks, balance: reachesToday ? balance(acct) : null };
  };

  return {
    today,
    windowFrom: gen.windowFrom,
    bank: MOCK_BANK,
    userId: 'nino.becker',
    accounts: MOCK_ACCOUNTS,
    statement,
    balance,
    pending: gen.pending,
    messages: (receivedAt) => [
      {
        id: 'msg-conditions',
        subject: 'Neue Sonderbedingungen für das Online-Banking ab 01.12.2026',
        text: [
          'Liebe Kundin, lieber Kunde,',
          '',
          'zum 01.12.2026 passen wir die Sonderbedingungen für das Online-Banking an. '
            + 'Anlass sind die neuen Vorgaben zur Empfängerüberprüfung (Verification of Payee), '
            + 'die seit Oktober 2025 für alle Überweisungen im Euroraum gelten.',
          '',
          'Was sich für Sie ändert:',
          '- Bei jeder Überweisung gleichen wir den Namen des Empfängers mit dem Namen ab, der zur IBAN hinterlegt ist.',
          '- Weicht der Name ab, informieren wir Sie vor der Freigabe. Sie entscheiden, ob der Auftrag trotzdem ausgeführt wird.',
          '- Echtzeitüberweisungen kosten weiterhin nicht mehr als eine Standardüberweisung.',
          '',
          'Die vollständigen Bedingungen finden Sie im Online-Banking unter Service > Bedingungen und Verzeichnisse. '
            + 'Wenn Sie bis zum Inkrafttreten nicht widersprechen, gilt Ihre Zustimmung als erteilt. '
            + 'Sie können den Vertrag bis dahin auch fristlos und kostenfrei kündigen.',
          '',
          'Mit freundlichen Grüßen',
          'Ihre Volksbank Musterstadt eG',
        ].join('\n'),
        receivedAt,
        read: false,
      },
      {
        id: 'msg-maintenance',
        subject: 'Wartungsarbeiten am Sonntag zwischen 01:00 und 05:00 Uhr',
        text: 'In der Nacht auf Sonntag führen wir Wartungsarbeiten durch. Zwischen 01:00 und 05:00 Uhr '
          + 'kann der Zugang über FinTS kurzzeitig nicht verfügbar sein.',
        receivedAt,
        read: false,
      },
    ],
    tanMethods: [
      {
        id: 944, name: 'SecureGo plus', version: 7, isDecoupled: true,
        activeTanMedia: ['iPhone von Nino', 'iPad Air'], tanMediaRequirement: 2,
        decoupled: { waitBeforeFirst: 2, waitBetween: 2, maxStatusRequests: 60 },
      },
      {
        id: 972, name: 'Smart-TAN photo', version: 7, isDecoupled: false,
        activeTanMedia: [], tanMediaRequirement: 0, decoupled: null,
      },
      {
        id: 982, name: 'Smart-TAN plus manuell', version: 7, isDecoupled: false,
        activeTanMedia: [], tanMediaRequirement: 0, decoupled: null,
      },
    ],
    popularBanks: POPULAR,
    logoFiles: LOGO_FILES,
    // The real list's size (banks-data.json): 2,721 Bankleitzahlen. Never an invented figure.
    meta: { productRegistered: true, bankCount: 2721, merchantLogos: false },
    vault: {
      version: 1,
      templates: [
        {
          id: 'tpl-lea', label: 'Taschengeld Lea', name: 'Lea Becker', iban: PARTY.lea.iban,
          amount: '50,00', purpose: 'Taschengeld', instant: true,
          createdAt: `${addDaysKey(today, -120)}T09:00:00.000Z`, lastUsedAt: `${addDaysKey(today, -12)}T18:20:00.000Z`,
        },
        {
          id: 'tpl-garage', label: 'Garage Kraemer', name: 'Hausverwaltung Kraemer GmbH', iban: PARTY.landlord.iban,
          amount: '65,00', purpose: 'Stellplatz 14 Tiefgarage',
          createdAt: `${addDaysKey(today, -200)}T09:00:00.000Z`,
        },
      ],
      aliases: { [ACCT.tagesgeld]: 'Notgroschen' },
      categoryRules: {},
      txCategories: {},
      dismissedRecurring: [],
      // An order from an earlier session whose outcome stayed unclear — the
      // duplicate check finds it after the logout ('transfer-duplicate-earlier').
      sentOrders: [
        {
          at: new Date(`${addDaysKey(today, -1)}T18:40:00`).toISOString(), accountNumber: ACCT.giro,
          iban: PARTY.max.iban, cents: 7500, outcome: 'unknown',
        },
      ],
      updatedAt: `${addDaysKey(today, -12)}T18:20:00.000Z`,
    },
    activity: (now) => [
      {
        id: 'act-lea', at: new Date(now - 26 * 60_000).toISOString(), kind: 'transfer', outcome: 'executed',
        accountNumber: ACCT.giro, name: 'Lea Becker', iban: PARTY.lea.iban, amount: 50, instant: true,
        message: 'Auftrag ausgeführt.',
      },
    ],
  };
}

const LOGO_FILES: Record<string, string> = {
  apobank: 'apobank.png', comdirect: 'comdirect.svg', commerzbank: 'commerzbank.svg', consorsbank: 'consorsbank.png',
  degussa: 'degussa.png', deutschebank: 'deutschebank.svg', dkb: 'dkb.svg', hypovereinsbank: 'hypovereinsbank.svg',
  ing: 'ing.png', norisbank: 'norisbank.png', oldenburgische: 'oldenburgische.png', postbank: 'postbank.svg',
  sparda: 'sparda.png', sparkasse: 'sparkasse.svg', targobank: 'targobank.png', triodos: 'triodos.png', vrbank: 'vrbank.svg',
};

/** The login quick picks, as /api/banks would list them (lib/banks.ts reads the disk; this cannot). */
const POPULAR: PopularBank[] = [
  { key: 'sparkasse', name: 'Sparkasse', brand: 'sparkasse', search: 'Sparkasse' },
  { key: 'vrbank', name: 'Volksbank / VR-Bank', brand: 'vrbank', search: 'Volksbank' },
  { key: 'ing', name: 'ING', brand: 'ing', blz: '50010517', bic: 'INGDDEFFXXX', fullName: 'ING-DiBa' },
  { key: 'dkb', name: 'DKB', brand: 'dkb', blz: '12030000', bic: 'BYLADEM1001', fullName: 'Deutsche Kreditbank Berlin' },
  { key: 'commerzbank', name: 'Commerzbank', brand: 'commerzbank', search: 'Commerzbank' },
  { key: 'deutschebank', name: 'Deutsche Bank', brand: 'deutschebank', search: 'Deutsche Bank' },
  { key: 'postbank', name: 'Postbank', brand: 'postbank', search: 'Postbank' },
  { key: 'comdirect', name: 'comdirect', brand: 'comdirect', search: 'comdirect' },
  { key: 'hypovereinsbank', name: 'HypoVereinsbank', brand: 'hypovereinsbank', blz: '70020270', bic: 'HYVEDEMMXXX', fullName: 'UniCredit Bank - HypoVereinsbank' },
  { key: 'targobank', name: 'Targobank', brand: 'targobank', blz: '30020900', bic: 'CMCIDEDDXXX', fullName: 'TARGOBANK' },
  { key: 'consorsbank', name: 'Consorsbank', brand: 'consorsbank', blz: '76030080', bic: 'CSDBDE71XXX', fullName: 'BNP Paribas S.A. Niederlassung Deutschland' },
  { key: 'norisbank', name: 'norisbank', brand: 'norisbank', blz: '10077777', bic: 'NORSDE51XXX', fullName: 'norisbank' },
  { key: 'sparda', name: 'Sparda-Bank', brand: 'sparda', search: 'Sparda' },
  { key: 'psd', name: 'PSD Bank', brand: 'psd', search: 'PSD' },
  { key: 'apobank', name: 'apoBank', brand: 'apobank', blz: '30060601', bic: 'DAAEDEDDXXX', fullName: 'Deutsche Apotheker- und Ärztebank' },
  { key: 'gls', name: 'GLS Bank', brand: 'gls', blz: '43060967', bic: 'GENODEM1GLS', fullName: 'GLS Gemeinschaftsbank' },
];

let cache: MockData | null = null;

/**
 * The data set for today. Built on first use in the browser (the harness only
 * renders after mount) and rebuilt when the day changes under a long-open tab.
 */
export function getMockData(): MockData {
  const today = isoDate(new Date());
  if (!cache || cache.today !== today) cache = buildMockData(today);
  return cache;
}

/** IBANs the harness can type into the transfer form. */
export const MOCK_PAYEES = {
  lea: { name: 'Lea Becker', iban: PARTY.lea.iban },
  max: { name: 'Max Mustermann', iban: PARTY.max.iban },
  /** One letter short — the bank's Namensabgleich answers Close Match. */
  closeMatch: { name: 'Max Musterman', iban: PARTY.max.iban },
} as const;
