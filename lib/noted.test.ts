import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectNoted, countPendingInBooked, normalizeMt94x, parseMt942, parseNotedCamt } from './noted.ts';

// ---------------------------------------------------------------------------
// MT942, as Sparkassen send it in HIKAZ beside the MT940

const MT942_LINES = [
  ':20:STARTDISPE',
  ':25:12345678/0012345678',
  ':28C:00000/001',
  ':34F:EURD0,',
  ':34F:EURC0,',
  ':13D:2610051032+0200',
  ':61:2610051005DR12,34NDDTNONREF',
  ':86:105?00SEPA-BASISLASTSCHRIFT?109310?20EREF+NF-2026-10-05?21MREF+M-778?22SVWZ+Netflix Abo?30COBADEFFXXX?31DE02120300000000202051?32Netflix International B.V.',
  ':61:2610051005CR50,00NMSCNONREF',
  ':86:166?00GUTSCHRIFT?20SVWZ+Rueckzahlung?31DE89370400440532013000?32Max Mustermann',
  ':90D:1EUR12,34',
  ':90C:1EUR50,00',
  '-',
];
const MT942 = MT942_LINES.join('\r\n');

function assertSparkasseMt942(statements: ReturnType<typeof parseMt942>) {
  assert.equal(statements.length, 1);
  const [st] = statements;
  // MT942 has no :60F:/:62F: — and none is made up.
  assert.equal(st.openingBalance, undefined);
  assert.equal(st.closingBalance, undefined);
  assert.equal(st.transactions.length, 2);
  const [debit, credit] = st.transactions;
  assert.equal(debit.amount, -12.34);
  assert.equal(debit.remoteName, 'Netflix International B.V.');
  assert.equal(debit.remoteAccountNumber, 'DE02120300000000202051');
  assert.equal(debit.e2eReference, 'NF-2026-10-05');
  assert.equal(debit.purpose, 'Netflix Abo');
  assert.equal(credit.amount, 50);
  assert.equal(credit.remoteName, 'Max Mustermann');
}

test('MT942 with CRLF: entries, signs and parties; no balances', () => {
  assertSparkasseMt942(parseMt942([MT942]));
});

test('MT942 with LF alone still names the payee', () => {
  assertSparkasseMt942(parseMt942([MT942_LINES.join('\n')]));
});

test('MT942 framed with @@ and a "-" glued to :20:', () => {
  assertSparkasseMt942(parseMt942([MT942_LINES.join('@@')]));
  assertSparkasseMt942(parseMt942([`-${MT942}`]));
});

test('a "-" terminator after the last :86: does not end up in the name', () => {
  const lines = MT942_LINES.filter((l) => !l.startsWith(':90'));
  const [st] = parseMt942([lines.join('\r\n')]);
  assert.equal(st.transactions[1].remoteName, 'Max Mustermann');
});

test('MT942 parts of a parted answer read as one stream', () => {
  const cut = MT942.indexOf(':61:2610051005CR');
  assertSparkasseMt942(parseMt942([MT942.slice(0, cut), MT942.slice(cut)]));
});

test('an MT942 without entries, or none at all, is an empty list', () => {
  const quiet = [':20:STARTDISPE', ':25:12345678/0012345678', ':28C:00000/001', ':13D:2610051032+0200', ':90D:0EUR0,', ':90C:0EUR0,', '-'];
  const statements = parseMt942([quiet.join('\r\n')]);
  assert.equal(statements.flatMap((s) => s.transactions).length, 0);
  assert.deepEqual(parseMt942([]), []);
  assert.deepEqual(parseMt942(['\r\n']), []);
});

test('normalizeMt94x leaves a clean MT940 as it is', () => {
  const clean = [':20:STARTUMSE', ':25:12345678/0012345678', ':28C:00000/001', ':60F:C261004EUR100,00', ':62F:C261005EUR100,00'].join('\r\n');
  assert.equal(normalizeMt94x(clean), clean);
});

// ---------------------------------------------------------------------------
// camt.052, as Sparkassen send it in HICAZ beside the booked documents

const entry = (o: { status: string; amount: string; cd: 'DBIT' | 'CRDT'; booked?: string; value?: string; name: string; iban: string; e2e: string }) => `
      <Ntry>
        <Amt Ccy="EUR">${o.amount}</Amt>
        <CdtDbtInd>${o.cd}</CdtDbtInd>
        ${o.status}
        ${o.booked ? `<BookgDt><Dt>${o.booked}</Dt></BookgDt>` : ''}
        ${o.value ? `<ValDt><Dt>${o.value}</Dt></ValDt>` : ''}
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RDDT</Cd><SubFmlyCd>ESDD</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>${o.e2e}</EndToEndId><MndtId>M-1</MndtId></Refs>
          <RltdPties>
            <Cdtr><Pty><Nm>${o.name}</Nm></Pty></Cdtr>
            <CdtrAcct><Id><IBAN>${o.iban}</IBAN></Id></CdtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Abschlag Oktober</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
        <AddtlNtryInf>SEPA Lastschrift</AddtlNtryInf>
      </Ntry>`;

const camt = (version: '02' | '08', entries: string, balances = '') => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.${version}">
  <BkToCstmrAcctRpt>
    <GrpHdr><MsgId>camt52_20261005</MsgId><CreDtTm>2026-10-05T10:32:00+02:00</CreDtTm></GrpHdr>
    <Rpt>
      <Id>camt052_PDNG</Id>
      <ElctrncSeqNb>1</ElctrncSeqNb>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
      ${balances}
      ${entries}
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;

/** What lib-fints hands over: the bank's UTF-8 bytes read as latin1. */
const wire = (xml: string) => Buffer.from(xml, 'utf8').toString('latin1');

const STADTWERKE = { amount: '120.00', cd: 'DBIT' as const, name: 'Stadtwerke Würzburg', iban: 'DE02120300000000202051', e2e: 'ABS-2026-10' };

test('camt.052.001.08 pending report: no balances, no Buchungstag, <Sts><Cd>', () => {
  const doc = camt('08', entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>', value: '2026-10-07' }));
  const { statements, failed } = parseNotedCamt([wire(doc)]);
  assert.equal(failed, 0);
  assert.equal(statements.length, 1);
  const [tx] = statements[0].transactions;
  assert.equal(tx.amount, -120);
  assert.equal(tx.remoteName, 'Stadtwerke Würzburg'); // read again as UTF-8
  assert.equal(tx.e2eReference, 'ABS-2026-10');
  // Dated by the Valuta the bank names, not the moment of parsing.
  assert.equal(tx.entryDate.getTime(), tx.valueDate.getTime());
  assert.equal(tx.valueDate.getFullYear(), 2026);
  assert.equal(tx.valueDate.getMonth(), 9);
  assert.equal(tx.valueDate.getDate(), 7);
  assert.equal(statements[0].closingBalance, undefined);
});

test('camt.052.001.02 pending report: <Sts>PDNG</Sts>', () => {
  const doc = camt('02', entry({ ...STADTWERKE, status: '<Sts>PDNG</Sts>', value: '2026-10-07' }));
  const { statements } = parseNotedCamt([doc]);
  assert.equal(statements[0].transactions.length, 1);
});

test('a Buchungstag the bank does name is kept', () => {
  const doc = camt('08', entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>', booked: '2026-10-06', value: '2026-10-07' }));
  const [tx] = parseNotedCamt([doc]).statements[0].transactions;
  assert.equal(tx.entryDate.getDate(), 6);
  assert.equal(tx.valueDate.getDate(), 7);
});

test('an entry the pending report itself calls booked is left out', () => {
  const doc = camt('08', [
    entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>', value: '2026-10-07' }),
    entry({ ...STADTWERKE, e2e: 'OLD-1', status: '<Sts><Cd>BOOK</Cd></Sts>', booked: '2026-10-01', value: '2026-10-01' }),
  ].join(''));
  const txs = parseNotedCamt([doc]).statements[0].transactions;
  assert.deepEqual(txs.map((t) => t.e2eReference), ['ABS-2026-10']);
});

test('a report with balances reads too', () => {
  const bal = '<Bal><Tp><CdOrPrtry><Cd>ITBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-05</Dt></Dt></Bal>';
  const doc = camt('08', entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>', value: '2026-10-07' }), bal);
  assert.equal(parseNotedCamt([doc]).statements[0].transactions.length, 1);
});

test('an unreadable document costs only itself', () => {
  const good = camt('08', entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>', value: '2026-10-07' }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { statements, failed } = parseNotedCamt(['<Document><broken>', good]);
    assert.equal(failed, 1);
    assert.equal(statements.flatMap((s) => s.transactions).length, 1);
  } finally {
    console.warn = warn;
  }
});

test('a report without entries is an empty list', () => {
  const { statements, failed } = parseNotedCamt([camt('08', '')]);
  assert.equal(failed, 0);
  assert.equal(statements.flatMap((s) => s.transactions).length, 0);
});

test('PDNG entries inside booked documents are counted for the log', () => {
  assert.equal(countPendingInBooked([
    camt('08', entry({ ...STADTWERKE, status: '<Sts><Cd>PDNG</Cd></Sts>' })),
    camt('02', entry({ ...STADTWERKE, status: '<Sts>PDNG</Sts>' }) + entry({ ...STADTWERKE, status: '<Sts>BOOK</Sts>' })),
  ]), 2);
});

// ---------------------------------------------------------------------------
// The field itself

test('collectNoted: absent, empty and repeated parts', () => {
  assert.equal(collectNoted([]), undefined);
  assert.equal(collectNoted([{}, { notedTransactions: undefined }]), undefined);
  // Sent, but empty (@0@): HIKAZ decodes '', HICAZ [''].
  assert.deepEqual(collectNoted([{ notedTransactions: '' }]), []);
  assert.deepEqual(collectNoted([{ notedTransactions: [''] }]), []);
  assert.deepEqual(collectNoted([{ notedTransactions: ['<a/>'] }, { notedTransactions: ['<a/>', '<b/>'] }]), ['<a/>', '<b/>']);
  assert.deepEqual(collectNoted([{}, { notedTransactions: ':20:X' }]), [':20:X']);
});
