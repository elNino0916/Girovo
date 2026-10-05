import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message, StatementResponse } from 'lib-fints';
import { NotedStatementInteractionCAMT, NotedStatementInteractionMT940, type StatementsResponse } from './fints-statements.ts';

/** A bank answer with the given HIKAZ/HICAZ segments — all the interactions read of it. */
const answer = (segId: string, segs: object[]) => ({
  findAllSegments: (id: string) => (id === segId ? segs : []),
}) as unknown as Message;

const response = () => ({ success: true, requiresTan: false, bankAnswers: [], bankingInformationUpdated: false }) as unknown as StatementResponse;

/** Runs `fn` with the interactions' log lines swallowed. */
function quietly(fn: () => void) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { fn(); } finally { console.log = log; console.warn = warn; }
}

const MT940 = [
  ':20:STARTUMSE', ':25:12345678/0012345678', ':28C:00000/001', ':60F:C261004EUR100,00',
  ':61:2610051005DR10,00NDDTNONREF', ':86:105?00LASTSCHRIFT?20SVWZ+Miete?32Vermieter', ':62F:C261005EUR90,00', '-',
].join('\r\n');
const MT942 = [
  ':20:STARTDISPE', ':25:12345678/0012345678', ':28C:00000/001', ':13D:2610051032+0200',
  ':61:2610051005DR12,34NDDTNONREF', ':86:105?00LASTSCHRIFT?20SVWZ+Abo?32Netflix', ':90D:1EUR12,34', '-',
].join('\r\n');

test('MT940: the noted part becomes notedStatements, the booked part stays as lib-fints read it', () => {
  const r = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionMT940('0012345678').handleResponse(
    answer('HIKAZ', [{ bookedTransactions: MT940, notedTransactions: MT942 }]), r,
  ));
  assert.equal(r.statements.length, 1);
  assert.equal(r.statements[0].closingBalance.value, 90);
  assert.deepEqual(r.statements[0].transactions.map((t) => t.amount), [-10]);
  assert.deepEqual(r.notedStatements?.flatMap((s) => s.transactions.map((t) => t.amount)), [-12.34]);
});

test('MT940: no noted part, no notedStatements', () => {
  const r = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionMT940('0012345678').handleResponse(answer('HIKAZ', [{ bookedTransactions: MT940 }]), r));
  assert.equal(r.statements[0].transactions.length, 1);
  assert.equal(r.notedStatements, undefined);
});

test('MT940: an unreadable noted part costs neither the Umsätze nor reads as "nothing vorgemerkt"', () => {
  const r = response() as StatementsResponse;
  // An entry without its customer reference makes lib-fints' parser throw.
  const broken = MT942.replace('NDDTNONREF', 'NDDT//123');
  quietly(() => new NotedStatementInteractionMT940('0012345678').handleResponse(
    answer('HIKAZ', [{ bookedTransactions: MT940, notedTransactions: broken }]), r,
  ));
  assert.equal(r.statements[0].transactions.length, 1);
  // null — not undefined, which would say the bank sent none.
  assert.equal(r.notedStatements, null);
});

const BOOKED_CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt><GrpHdr><MsgId>1</MsgId></GrpHdr>
<Rpt><Id>1</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-04</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">90.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-05</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-05</Dt></BookgDt><ValDt><Dt>2026-10-05</Dt></ValDt></Ntry>
</Rpt></BkToCstmrAcctRpt></Document>`;
const NOTED_CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt><GrpHdr><MsgId>2</MsgId></GrpHdr>
<Rpt><Id>2</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
<Ntry><Amt Ccy="EUR">12.34</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>PDNG</Cd></Sts><ValDt><Dt>2026-10-06</Dt></ValDt></Ntry>
</Rpt></BkToCstmrAcctRpt></Document>`;

test('camt: a pending report without balances does not wipe the booked statements', () => {
  const r = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionCAMT('0012345678').handleResponse(
    answer('HICAZ', [{ bookedTransactions: [BOOKED_CAMT], notedTransactions: [NOTED_CAMT] }]), r,
  ));
  assert.equal(r.statements.length, 1);
  assert.equal(r.statements[0].closingBalance.value, 90);
  assert.deepEqual(r.statements[0].transactions.map((t) => t.amount), [-10]);
  assert.deepEqual(r.notedStatements?.flatMap((s) => s.transactions.map((t) => t.amount)), [-12.34]);
});

test('camt: sent empty is an empty list; an unreadable document makes the list unreadable', () => {
  const empty = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionCAMT('0012345678').handleResponse(
    answer('HICAZ', [{ bookedTransactions: [BOOKED_CAMT], notedTransactions: [''] }]), empty,
  ));
  assert.deepEqual(empty.notedStatements, []);

  const broken = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionCAMT('0012345678').handleResponse(
    answer('HICAZ', [{ bookedTransactions: [BOOKED_CAMT], notedTransactions: ['<Document><x>'] }]), broken,
  ));
  assert.equal(broken.statements.length, 1);
  assert.equal(broken.notedStatements, null);

  // One readable document beside an unreadable one is part of the list, not the list.
  const partly = response() as StatementsResponse;
  quietly(() => new NotedStatementInteractionCAMT('0012345678').handleResponse(
    answer('HICAZ', [
      { bookedTransactions: [BOOKED_CAMT], notedTransactions: [NOTED_CAMT] },
      { bookedTransactions: [BOOKED_CAMT], notedTransactions: ['<Document><x>'] },
    ]), partly,
  ));
  assert.equal(partly.notedStatements, null);
});
