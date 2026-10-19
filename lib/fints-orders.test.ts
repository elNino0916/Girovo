import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Message, decode, encode, type FinTSConfig, type Segment } from 'lib-fints';
import {
  BankOrderDeleteInteraction, BankOrderListInteraction, DatedChangeInteraction, DatedTransferInteraction, MAX_LIST_ROUNDS,
  StandingChangeInteraction, StandingOrderInteraction, orderInteraction, orderSegId, dayKeyOf, digitList, datedRules, holdBankOrders, orderCaps, readListEntry, readPain001,
  standingRules,
} from './fints-orders.ts';
import { buildPain001 } from './fints-sepa.ts';
import { DEFAULT_DATED_RULES, DEFAULT_STANDING_RULES, ULTIMO } from './order-schedule.ts';
import type { HeldBankOrder } from './session.ts';

// ---------------------------------------------------------------------------
// A stand-in for lib-fints' configuration: one account, the transactions the
// BPD and its UPD declare, and the parameters the bank sent.

const DESCRIPTOR = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
const WIRE_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.03';
const OWN_IBAN = 'DE02120300000000202051';
const BIC = 'BYLADEM1001';
const KTI = `${OWN_IBAN}:${BIC}:1234567890::280:12030000`;

type FakeOpts = { bpd?: string[]; upd?: string[]; params?: Record<string, unknown>; iban?: string | null };

function fakeConfig(o: FakeOpts = {}): FinTSConfig {
  const bpd = o.bpd ?? ['HKCSE', 'HKCSB', 'HKCSL', 'HKCDE', 'HKCDB', 'HKCDL', 'HKSPA'];
  const upd = o.upd ?? bpd;
  const account = {
    accountNumber: '1234567890', bank: { country: 280, bankId: '12030000' }, iban: o.iban === undefined ? OWN_IBAN : o.iban,
    holder1: 'NINO BECKER', currency: 'EUR', allowedTransactions: upd.map((transId) => ({ transId })),
  };
  return {
    getBankAccount: () => account,
    isTransactionSupported: (id: string) => bpd.includes(id),
    isAccountTransactionSupported: (_a: string, id: string) => upd.includes(id),
    getMaxSupportedTransactionVersion: () => 1,
    getTransactionParameters: (id: string) => o.params?.[id],
  } as unknown as FinTSConfig;
}

/** A segment as it goes on the wire, numbered 3. */
function wire(seg: Segment): string {
  const s = { ...seg, header: { ...seg.header, segNr: 3 } } as Segment;
  return encode(s);
}

const bin = (s: string) => `@${s.length}@${s}`;
const quietly = <T>(fn: () => T): T => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};

const PAYEE = {
  creditorName: 'Hausverwaltung Kraemer GmbH', creditorIban: 'DE52512108001245126199', amountCents: 85000, purpose: 'Miete', debtorBic: BIC,
};
const PREBUILT = { descriptor: DESCRIPTOR, sepaMessage: '<pain/>' };

// ---------------------------------------------------------------------------
// The orders' own segments, byte for byte

test('HKCDE: account, descriptor, pain, then the Dauerauftragdetails', () => {
  const config = fakeConfig();
  const plain = new StandingOrderInteraction('1234567890', PAYEE, {
    kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 1, last: null,
  }, 'auto', PREBUILT);
  const segs = quietly(() => plain.createSegments(config));
  assert.equal(segs.length, 1); // no Namensabgleich without HKVPP/HKVPA in the BPD
  assert.equal(wire(segs[0]), `HKCDE:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>+20261101:M:1:1'`);

  const ending = new StandingOrderInteraction('1234567890', PAYEE, {
    kind: 'standing', first: '2026-10-31', unit: 'M', interval: 3, day: ULTIMO, last: '2027-12-31',
  }, 'auto', PREBUILT);
  assert.equal(wire(quietly(() => ending.createSegments(config))[0]), `HKCDE:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>+20261031:M:3:99:20271231'`);

  const weekly = new StandingOrderInteraction('1234567890', PAYEE, {
    kind: 'standing', first: '2026-10-12', unit: 'W', interval: 2, day: 1,
  }, 'auto', PREBUILT);
  assert.equal(wire(quietly(() => weekly.createSegments(config))[0]), `HKCDE:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>+20261012:W:2:1'`);
});

test('HKCDE: its pain says 1999-01-01 — the dates travel beside it', () => {
  const i = new StandingOrderInteraction('1234567890', PAYEE, {
    kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 1,
  });
  quietly(() => i.createSegments(fakeConfig()));
  assert.match(i.sepaMessage!, /<ReqdExctnDt>1999-01-01<\/ReqdExctnDt>/);
});

test('HKCSE: the transfer\'s layout, with the real date in the pain', () => {
  const config = fakeConfig();
  const prebuilt = new DatedTransferInteraction('1234567890', PAYEE, '2026-11-15', 'auto', PREBUILT);
  assert.equal(wire(quietly(() => prebuilt.createSegments(config))[0]), `HKCSE:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>'`);
  const built = new DatedTransferInteraction('1234567890', PAYEE, '2026-11-15');
  quietly(() => built.createSegments(config));
  assert.match(built.sepaMessage!, /<ReqdExctnDt>2026-11-15<\/ReqdExctnDt>/);
});

test('HKCDN: as HKCDE, with the Auftragsidentifikation before the new Dauerauftragdetails', () => {
  const config = fakeConfig({ bpd: ['HKCDE', 'HKCDB', 'HKCDN', 'HKSPA'] });
  const i = new StandingChangeInteraction('1234567890', PAYEE, {
    kind: 'standing', first: '2026-12-01', unit: 'M', interval: 1, day: 1, last: null,
  }, 'DA-0001', 'auto', PREBUILT);
  assert.equal(wire(quietly(() => i.createSegments(config))[0]), `HKCDN:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>+DA-0001+20261201:M:1:1'`);
  // The one way in builds it from a change, for the transfer route and the Namensabgleich's re-submission alike.
  const via = orderInteraction('1234567890', PAYEE, {
    instant: false, schedule: { kind: 'standing', first: '2026-12-01', unit: 'M', interval: 1, day: 1 }, change: { orderId: 'DA-0001' },
  });
  assert.ok(via instanceof StandingChangeInteraction);
  assert.equal(orderSegId(false, { kind: 'standing', first: '2026-12-01', unit: 'M', interval: 1, day: 1 }, true), 'HKCDN');
});

test('HKCSA: the new day in the pain, the Auftragsidentifikation after it', () => {
  const config = fakeConfig({ bpd: ['HKCSE', 'HKCSB', 'HKCSA', 'HKSPA'] });
  const prebuilt = new DatedChangeInteraction('1234567890', PAYEE, '2026-12-15', 'TU-0417', 'auto', PREBUILT);
  assert.equal(wire(quietly(() => prebuilt.createSegments(config))[0]), `HKCSA:3:1+${KTI}+${WIRE_DESCRIPTOR}+@7@<pain/>+TU-0417'`);
  const built = new DatedChangeInteraction('1234567890', PAYEE, '2026-12-15', 'TU-0417');
  quietly(() => built.createSegments(config));
  assert.match(built.sepaMessage!, /<ReqdExctnDt>2026-12-15<\/ReqdExctnDt>/);
  assert.equal(orderSegId(false, { kind: 'dated', date: '2026-12-15' }, true), 'HKCSA');
});

test('the Namensabgleich rides along where HIVPPS lists the order\'s segment', () => {
  const schedule = { kind: 'standing' as const, first: '2026-11-01', unit: 'M' as const, interval: 1, day: 1 };
  const listed = fakeConfig({
    bpd: ['HKCDE', 'HKVPP', 'HKVPA'], params: { HKVPP: { vopRequiredSegments: ['HKCCS', 'HKCDE'] } },
  });
  const withCheck = quietly(() => new StandingOrderInteraction('1234567890', PAYEE, schedule, 'auto', PREBUILT).createSegments(listed));
  assert.deepEqual(withCheck.map((s) => s.header.segId), ['HKCDE', 'HKVPP']);
  const notListed = fakeConfig({
    bpd: ['HKCDE', 'HKVPP', 'HKVPA'], params: { HKVPP: { vopRequiredSegments: ['HKCCS', 'HKIPZ'] } },
  });
  const without = quietly(() => new StandingOrderInteraction('1234567890', PAYEE, schedule, 'auto', PREBUILT).createSegments(notListed));
  assert.deepEqual(without.map((s) => s.header.segId), ['HKCDE']);
  // The confirmation after the user's decision carries HKVPA, and the very same pain.
  const confirm = quietly(() => new StandingOrderInteraction('1234567890', PAYEE, schedule, { vopId: 'V1' }, PREBUILT).createSegments(listed));
  assert.deepEqual(confirm.map((s) => s.header.segId), ['HKCDE', 'HKVPA']);
  assert.equal((confirm[0] as unknown as { sepaMessage: string }).sepaMessage, '<pain/>');
});

test('an account the UPD does not allow it for is refused before anything is sent', () => {
  const config = fakeConfig({ upd: ['HKCSB'] });
  assert.throws(() => new DatedTransferInteraction('1234567890', PAYEE, '2026-11-15', 'auto', PREBUILT).createSegments(config));
});

test('HKCDB / HKCSB: one supported format, and the Aufsetzpunkt as the last element', () => {
  const config = fakeConfig();
  const first = new BankOrderListInteraction('1234567890', 'standing', BIC);
  assert.equal(wire(first.createSegments(config)[0]), `HKCDB:3:1+${KTI}+${WIRE_DESCRIPTOR}'`);
  const next = new BankOrderListInteraction('1234567890', 'standing', BIC, 'A?123');
  assert.equal(wire(next.createSegments(config)[0]), `HKCDB:3:1+${KTI}+${WIRE_DESCRIPTOR}+++A??123'`);
  const dated = new BankOrderListInteraction('1234567890', 'dated', BIC, 'X9');
  assert.equal(wire(dated.createSegments(config)[0]), `HKCSB:3:1+${KTI}+${WIRE_DESCRIPTOR}++++X9'`);
});

test('the list asks for a format the bank names (HISPAS), pain.001.001.03 first', () => {
  const config = fakeConfig({
    params: { HKSPA: { supportedSepaFormats: ['urn:iso:std:iso:20022:tech:xsd:pain.001.001.09', 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03'] } },
  });
  const seg = new BankOrderListInteraction('1234567890', 'standing', BIC).createSegments(config)[0];
  assert.deepEqual((seg as unknown as { supportedFormats: string[] }).supportedFormats, ['urn:iso:std:iso:20022:tech:xsd:pain.001.003.03']);
});

// ---------------------------------------------------------------------------
// pain.001: building and reading

test('buildPain001: ReqdExctnDt flat in .03, inside <Dt> in .09, 1999-01-01 unless a date is given', () => {
  const base = {
    debtorName: 'NINO BECKER', debtorIban: OWN_IBAN, creditorName: 'Lea Becker', creditorIban: 'DE89370400440532013000', amountCents: 5000,
  };
  assert.match(buildPain001({ ...base, descriptor: DESCRIPTOR }), /<ReqdExctnDt>1999-01-01<\/ReqdExctnDt>/);
  assert.match(buildPain001({ ...base, descriptor: DESCRIPTOR, executionDate: '2026-11-15' }), /<ReqdExctnDt>2026-11-15<\/ReqdExctnDt>/);
  assert.match(
    buildPain001({ ...base, descriptor: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09', executionDate: '2026-11-15' }),
    /<ReqdExctnDt><Dt>2026-11-15<\/Dt><\/ReqdExctnDt>/,
  );
  assert.throws(() => buildPain001({ ...base, descriptor: DESCRIPTOR, executionDate: '15.11.2026' }));
});

const pain = (opts: { v09?: boolean; date?: string; txs?: string[]; encoding?: string } = {}) => {
  const ns = `urn:iso:std:iso:20022:tech:xsd:pain.001.${opts.v09 ? '001.09' : '001.03'}`;
  const date = opts.v09 ? `<ReqdExctnDt><Dt>${opts.date ?? '2026-11-15'}</Dt></ReqdExctnDt>` : `<ReqdExctnDt>${opts.date ?? '2026-11-15'}</ReqdExctnDt>`;
  const txs = opts.txs ?? [tx('Hausverwaltung Kraemer GmbH', 'DE52512108001245126199', '850.00', 'Miete Wohnung 3. OG')];
  return `<?xml version="1.0" encoding="${opts.encoding ?? 'UTF-8'}"?><Document xmlns="${ns}"><CstmrCdtTrfInitn><GrpHdr><MsgId>M1</MsgId></GrpHdr>`
    + `<PmtInf><PmtInfId>P1</PmtInfId><PmtMtd>TRF</PmtMtd>${date}<Dbtr><Nm>NINO BECKER</Nm></Dbtr>`
    + `<DbtrAcct><Id><IBAN>${OWN_IBAN}</IBAN></Id></DbtrAcct>${txs.join('')}</PmtInf></CstmrCdtTrfInitn></Document>`;
};
function tx(name: string, iban: string, amount: string, purpose?: string, bic?: string) {
  return `<CdtTrfTxInf><PmtId><EndToEndId>NOTPROVIDED</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amount}</InstdAmt></Amt>`
    + (bic ? `<CdtrAgt><FinInstnId><BIC>${bic}</BIC></FinInstnId></CdtrAgt>` : '')
    + `<Cdtr><Nm>${name}</Nm></Cdtr><CdtrAcct><Id><IBAN>${iban}</IBAN></Id></CdtrAcct>`
    + (purpose ? `<RmtInf><Ustrd>${purpose}</Ustrd></RmtInf>` : '') + '</CdtTrfTxInf>';
}

test('readPain001: the payee, IBAN, amount and purpose; the date in either version', () => {
  const r = readPain001(pain());
  assert.equal(r.executionDate, '2026-11-15');
  assert.deepEqual(r.payments, [{
    name: 'Hausverwaltung Kraemer GmbH', iban: 'DE52512108001245126199', bic: null, cents: 85000, currency: 'EUR', purpose: 'Miete Wohnung 3. OG',
  }]);
  assert.equal(readPain001(pain({ v09: true, date: '2027-01-04' })).executionDate, '2027-01-04');
  assert.equal(readPain001(pain({ date: '1999-01-01' })).executionDate, '1999-01-01');
  const two = readPain001(pain({ txs: [tx('A', 'DE89370400440532013000', '1.5'), tx('B &amp; C', 'DE89370400440532013000', '12')] }));
  assert.deepEqual(two.payments.map((p) => [p.name, p.cents]), [['A', 150], ['B & C', 1200]]);
});

test('readPain001: UTF-8 as the bank sent it (read by lib-fints as ISO 8859-1) comes out with its umlauts', () => {
  const utf8 = pain({ txs: [tx('Jürgen Müller', 'DE89370400440532013000', '10.00', 'Gebühr für März')] });
  const asReceived = Buffer.from(utf8, 'utf8').toString('latin1');
  const p = readPain001(asReceived).payments[0];
  assert.equal(p.name, 'Jürgen Müller');
  assert.equal(p.purpose, 'Gebühr für März');
});

test('readPain001 refuses what is no credit transfer', () => {
  assert.throws(() => readPain001('<Document><CstmrDrctDbtInitn/></Document>'));
  assert.throws(() => readPain001(pain({ txs: [tx('A', '', '1.00')] })));
  assert.throws(() => readPain001(pain({ txs: [tx('A', 'DE89370400440532013000', '1,00')] })));
  assert.throws(() => readPain001('<Document'));
});

// ---------------------------------------------------------------------------
// The bank's parameters

const paramsOf = (text: string) => (decode(text) as unknown as { params?: Record<string, unknown> }).params;
const DAYS_1_30_99 = '010203040506070809101112131415161718192021222324252627282930' + '99';

test('HICDES as banks send it: DKB / Sparkasse, Atruvia, ING, Postbank', () => {
  const dkb = standingRules(paramsOf(`HICDES:91:1:4+3+1+1+4:0:9999:0102030612:${DAYS_1_30_99}'`) as never);
  assert.deepEqual(dkb.months, [1, 2, 3, 6, 12]);
  assert.equal(dkb.monthDays.length, 31);
  assert.ok(dkb.monthDays.includes(ULTIMO));
  assert.deepEqual([dkb.weeks, dkb.weekDays], [[], []]); // no weekly turns named: none offered
  assert.deepEqual([dkb.minDays, dkb.maxDays, dkb.fromBank], [0, 9999, true]);

  const atruvia = standingRules(paramsOf(`HICDES:40:1:4+1+1+1+4:1:3650:0102030612:${DAYS_1_30_99}:01:12345'`) as never);
  assert.deepEqual([atruvia.weeks, atruvia.weekDays], [[1], [1, 2, 3, 4, 5]]);

  // "00" is "all": the usual choices, never more.
  const ing = standingRules(paramsOf("HICDES:50:1:4+1+1+1+4:1:360:00:00::0'") as never);
  assert.deepEqual(ing.months, [1, 2, 3, 6, 12]);
  assert.equal(ing.monthDays.length, 31);
  assert.deepEqual(ing.weeks, []);

  const postbank = standingRules(paramsOf("HICDES:60:1:4+1+1+1+4:1:180:00:00:00:12345'") as never);
  assert.deepEqual([postbank.weeks, postbank.weekDays], [[1, 2], [1, 2, 3, 4, 5]]);
});

test('without parameters: the fallback, said as such', () => {
  assert.equal(standingRules(undefined), DEFAULT_STANDING_RULES);
  assert.equal(datedRules(undefined), DEFAULT_DATED_RULES);
  assert.equal(DEFAULT_STANDING_RULES.fromBank, false);
  // A segment with an empty parameter group: lead times fall back, lists too.
  assert.deepEqual(standingRules({}).months, DEFAULT_STANDING_RULES.months);
});

test('HICSES, HICSBS, HICSLS, HICDBS v2 and HICDLS v1 decode', () => {
  assert.deepEqual(datedRules(paramsOf("HICSES:70:1:4+1+1+1+1:360'") as never), { minDays: 1, maxDays: 360, fromBank: true });
  assert.deepEqual(datedRules(paramsOf("HICSES:70:1:4+1+1+0+0:180'") as never), { minDays: 0, maxDays: 180, fromBank: true });
  assert.deepEqual(paramsOf("HICSBS:71:1:4+1+1+1+N:J'"), { maxEntriesAllowed: 'N', rangeAllowed: 'J' });
  assert.deepEqual(paramsOf("HICSLS:72:1:4+1+1+1+J'"), { orderDataRequired: 'J' });
  assert.deepEqual(
    paramsOf("HICDBS:73:2:4+1+1+1+N::urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.001.001.09'"),
    { maxEntriesAllowed: 'N', purposeCodes: undefined, supportedFormats: ['urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'] },
  );
  assert.deepEqual(paramsOf("HICDLS:74:1:4+1+1+1+0:9999:J:J'"), { minDays: 0, maxDays: 9999, canSchedule: 'J', orderDataRequired: 'J' });
});

test('digitList: two-digit chains, "00" for all, empty for none', () => {
  assert.deepEqual(digitList('0102030612', 2), [1, 2, 3, 6, 12]);
  assert.equal(digitList('00', 2), 'all');
  assert.equal(digitList('0', 1), 'all');
  assert.equal(digitList('', 2), null);
  assert.deepEqual(digitList('12345', 1), [1, 2, 3, 4, 5]);
});

test('orderCaps: the BPD and the account\'s UPD both, deleting only with the list', () => {
  const all = orderCaps(fakeConfig(), '1234567890');
  assert.deepEqual([all.dated?.create, all.dated?.list, all.dated?.remove], [true, true, true]);
  assert.equal(all.standing?.rules, DEFAULT_STANDING_RULES); // no HICDES read: the fallback
  const updOnly = orderCaps(fakeConfig({ bpd: ['HKSPA'], upd: ['HKCDE', 'HKCDB'] }), '1234567890');
  assert.deepEqual([updOnly.dated, updOnly.standing], [null, null]);
  const noList = orderCaps(fakeConfig({ upd: ['HKCDE', 'HKCDL'] }), '1234567890');
  assert.deepEqual([noList.standing?.create, noList.standing?.list, noList.standing?.remove], [true, false, false]);
  assert.equal(noList.dated, null);
  const noIban = orderCaps(fakeConfig({ iban: null }), '1234567890');
  assert.equal(noIban.standing?.create, false);
  // Changing needs the segment, the account's grant and the list, like deleting.
  assert.equal(all.standing?.change, false, 'HKCDN not in the BPD');
  const changing = orderCaps(fakeConfig({ bpd: ['HKCDE', 'HKCDB', 'HKCDN', 'HKCSE', 'HKCSB', 'HKCSA', 'HKSPA'] }), '1234567890');
  assert.deepEqual([changing.standing?.change, changing.dated?.change], [true, true]);
  const unlisted = orderCaps(fakeConfig({ bpd: ['HKCDE', 'HKCDN', 'HKSPA'] }), '1234567890');
  assert.equal(unlisted.standing?.change, false);
});

// ---------------------------------------------------------------------------
// The Bestand

const hicdb = (body: string, version = 1) => `HICDB:5:${version}:3+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${body}'`;

test('HICDB: the payment from its pain, the schedule from the Dauerauftragdetails', () => {
  const seg = decode(hicdb(`${bin(pain({ date: '1999-01-01' }))}+DA-0001+20240801:M:1:1++J+J+J`));
  const entry = readListEntry('standing', seg as never)!;
  assert.deepEqual(entry.order, {
    kind: 'standing', orderId: 'DA-0001', name: 'Hausverwaltung Kraemer GmbH', iban: 'DE52512108001245126199', bic: null,
    amount: 850, currency: 'EUR', purpose: 'Miete Wohnung 3. OG',
    schedule: { kind: 'standing', first: '2024-08-01', unit: 'M', interval: 1, day: 1, last: null },
    more: 0, deletable: true, changeable: true,
  });
  assert.equal(entry.raw.sepaDescriptor, DESCRIPTOR);
});

test('HICDB v2: a time inside the details (hbci4java) is read past; the last date stays the last', () => {
  const seg = decode(hicdb(`${bin(pain({ date: '1999-01-01' }))}+DA-2+20240801:M:3:99:120000:20271231`, 2));
  const s = readListEntry('standing', seg as never)!.order.schedule;
  assert.deepEqual(s, { kind: 'standing', first: '2024-08-01', unit: 'M', interval: 3, day: 99, last: '2027-12-31' });
});

test('HICDB: an order the bank marks as not deletable, and one without readable pain', () => {
  const locked = decode(hicdb(`${bin(pain())}+DA-3+20240801:M:1:1++N+N+N`));
  assert.equal(readListEntry('standing', locked as never)!.order.deletable, false);
  const broken = decode(hicdb(`${bin('<Document><nope/></Document>')}+DA-4+20240801:M:1:1`));
  assert.equal(readListEntry('standing', broken as never), null);
});

test('HICSB: the date from the pain; deletable only with its Auftragsidentifikation', () => {
  const withId = decode(`HICSB:5:1:3+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(pain({ date: '2026-11-15' }))}+TU-0417+J+N'`);
  const e = readListEntry('dated', withId as never)!;
  assert.deepEqual([e.order.schedule, e.order.deletable, e.order.orderId], [{ kind: 'dated', date: '2026-11-15' }, true, 'TU-0417']);
  assert.equal(e.order.changeable, false, 'the bank marks it "nicht änderbar"');
  const noId = decode(`HICSB:5:1:3+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(pain())}'`);
  assert.equal(readListEntry('dated', noId as never)!.order.deletable, false);
  // Version 2 has no "löschbar" (spec): a status and a SEPA-C-Code instead.
  const v2 = decode(`HICSB:5:2:3+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(pain())}+TU-1+1+J+2'`) as unknown as Record<string, unknown>;
  assert.deepEqual([v2.sepaCCode, v2.canChange, v2.status, v2.canDelete], ['1', 'J', '2', undefined]);
});

test('dayKeyOf: JJJJMMTT, a virtual 30 February moved to the month\'s last day', () => {
  assert.equal(dayKeyOf('20261101'), '2026-11-01');
  assert.equal(dayKeyOf('20260230'), '2026-02-28');
  assert.equal(dayKeyOf('2026110'), null);
  assert.equal(dayKeyOf('20261301'), null);
});

/** A bank answer: return codes and the list's segments. */
function answer(codes: string, segs: string[]): Message {
  return new Message([decode(`HIRMS:4:2:3+${codes}'`), ...segs.map((s) => decode(s))]);
}

function listInDialog(kind: 'standing' | 'dated' = 'standing') {
  const queued: BankOrderListInteraction[] = [];
  const i = new BankOrderListInteraction('1234567890', kind, BIC);
  i.dialog = {
    hasEnded: false, config: { bankingInformation: {} },
    addCustomerInteraction: (next: BankOrderListInteraction) => { queued.push(next); },
  } as never;
  return { i, queued };
}

test('a list over several answers: the Aufsetzpunkt is followed, and every round adds to one read', () => {
  const { i, queued } = listInDialog();
  const r1 = quietly(() => i.handleClientResponse(answer('3040::Es liegen weitere Informationen vor:A123', [
    hicdb(`${bin(pain())}+DA-1+20240801:M:1:1`),
  ])));
  assert.equal(queued.length, 1);
  assert.equal(r1.bankOrders?.orders.length, 1);
  const next = queued[0];
  next.dialog = i.dialog;
  assert.match(wire(next.createSegments(fakeConfig())[0]), /\+\+\+A123'$/);
  const r2 = quietly(() => next.handleClientResponse(answer('0020::Auftrag ausgeführt', [
    hicdb(`${bin(pain())}+DA-2+20240815:M:1:15`),
    'HICDB:6:9:3+broken',
  ])));
  assert.equal(queued.length, 1);
  assert.equal(r2.bankOrders, r1.bankOrders);
  assert.deepEqual(r2.bankOrders?.orders.map((o) => o.order.orderId), ['DA-1', 'DA-2']);
  assert.equal(r2.bankOrders?.unreadable, 1); // a version the app cannot read is counted, not dropped
  assert.equal(r2.bankOrders?.complete, true);
});

test('a list the bank cuts short without a way on says so', () => {
  const { i, queued } = listInDialog('dated');
  const r = quietly(() => i.handleClientResponse(answer('3040::Es liegen weitere Informationen vor', [])));
  assert.equal(queued.length, 0);
  assert.equal(r.bankOrders?.complete, false);
  assert.ok(MAX_LIST_ROUNDS >= 2);
});

// ---------------------------------------------------------------------------
// Deleting: the bank's own data sent back

function held(kind: 'standing' | 'dated', text: string): HeldBankOrder {
  return { ...readListEntry(kind, decode(text) as never)!, accountNumber: '1234567890', kind };
}

test('HKCDL: the bank\'s account, descriptor and pain, no date, the order id, the details as listed', () => {
  const painText = pain({ date: '1999-01-01' });
  const order = held('standing', hicdb(`${bin(painText)}+DA-0001+20240801:M:1:1:20271231++J+J+J`));
  const seg = new BankOrderDeleteInteraction('1234567890', order, BIC).createSegments(fakeConfig())[0];
  assert.equal(
    wire(seg),
    `HKCDL:3:1+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(painText)}++DA-0001+20240801:M:1:1:20271231'`,
  );
});

test('HKCSL: the bank\'s pain and the Auftragsidentifikation', () => {
  const painText = pain({ date: '2026-11-15' });
  const order = held('dated', `HICSB:5:1:3+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(painText)}+TU-0417+J+N'`);
  const seg = new BankOrderDeleteInteraction('1234567890', order, BIC).createSegments(fakeConfig())[0];
  assert.equal(wire(seg), `HKCSL:3:1+${OWN_IBAN}:${BIC}+${WIRE_DESCRIPTOR}+${bin(painText)}+TU-0417'`);
});

test('an order the bank does not let go is not sent', () => {
  const order = held('standing', hicdb(`${bin(pain())}+DA-3+20240801:M:1:1++N+N+N`));
  assert.throws(() => new BankOrderDeleteInteraction('1234567890', order, BIC).createSegments(fakeConfig()));
});

test('holdBankOrders: fresh handles, the last read of the same account and kind replaced', () => {
  const session = { bankOrders: new Map<string, HeldBankOrder>() };
  const read = () => ({ orders: [held('standing', hicdb(`${bin(pain())}+DA-1+20240801:M:1:1`))], complete: true, unreadable: 0 });
  const first = quietly(() => holdBankOrders(session, '1234567890', 'standing', read(), true));
  const second = quietly(() => holdBankOrders(session, '1234567890', 'standing', read(), true));
  assert.equal(session.bankOrders.size, 1);
  assert.notEqual(first.orders[0].ref, second.orders[0].ref);
  assert.ok(!session.bankOrders.has(first.orders[0].ref));
  // The browser never sees the raw pain.
  assert.ok(!('raw' in second.orders[0]));
  const notRemovable = quietly(() => holdBankOrders(session, '1234567890', 'standing', read(), false));
  assert.equal(notRemovable.orders[0].deletable, false);
});
