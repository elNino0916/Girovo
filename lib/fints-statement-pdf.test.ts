import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Message, decode, encode, type FinTSConfig, type Segment } from 'lib-fints';
import { PDF_STATEMENT_SEG, PdfStatementInteraction, readHiekp } from './fints-statement-pdf.ts';

const IBAN = 'DE02120300000000202051';
const BIC = 'BYLADEM1001';
const PDF = '%PDF-1.4\n1 0 obj << >> endobj\n%%EOF';
const bin = (s: string) => `@${s.length}@${s}`;

function fakeConfig(hispas?: { nationalAccountAllowed: boolean }): FinTSConfig {
  const account = {
    accountNumber: '1234567890', bank: { country: 280, bankId: '12030000' }, iban: IBAN, bic: BIC,
    allowedTransactions: [{ transId: 'HKEKP' }],
  };
  return {
    getBankAccount: () => account,
    isTransactionSupported: (id: string) => id === 'HKEKP',
    isAccountTransactionSupported: (_a: string, id: string) => id === 'HKEKP',
    getMaxSupportedTransactionVersion: () => 2,
    getTransactionParameters: (id: string) => (id === 'HKSPA' ? hispas : undefined),
  } as unknown as FinTSConfig;
}

test('HKEKP asks for one account by KTI, with the Aufsetzpunkt when there is one', () => {
  const [seg] = new PdfStatementInteraction('1234567890', { offset: 'A-17' }).createSegments(fakeConfig());
  const wire = encode({ ...seg, header: { ...seg.header, segNr: 3 } } as Segment);
  assert.equal(wire, `HKEKP:3:2+${IBAN}:${BIC}:1234567890::280:12030000++++A-17'`);
  // A bank that allows no national fields in a KTI gets IBAN and BIC alone (lib-fints' rule for HKEKA).
  const [short] = new PdfStatementInteraction('1234567890').createSegments(fakeConfig({ nationalAccountAllowed: false }));
  assert.equal(encode({ ...short, header: { ...short.header, segNr: 3 } } as Segment), `HKEKP:3:2+${IBAN}:${BIC}'`);
  assert.equal(PDF_STATEMENT_SEG, 'HKEKP');
});

test('HIEKP is read by what its elements are, whichever order a version puts them in', () => {
  // The document first, then the period, the day it was made, year and number, the account.
  const v2 = readHiekp(`${bin(PDF)}+20250101:20250131+20250201+2025+1+${IBAN}+${BIC}+NINO BECKER`);
  assert.ok(v2);
  assert.equal(new TextDecoder('latin1').decode(v2.document), PDF);
  assert.equal(v2.from?.getDate(), 1);
  assert.equal(v2.to?.getDate(), 31);
  assert.equal(v2.date?.getMonth(), 1);
  assert.equal(v2.year, 2025);
  assert.equal(v2.number, 1);
  assert.equal(v2.iban, IBAN);
  assert.equal(v2.format, '3');

  // The period first, and the PDF base64-wrapped in its binary field (a HIEKP v1 quirk).
  const b64 = Buffer.from(PDF, 'latin1').toString('base64');
  const v1 = readHiekp(`20241201:20241231+${bin(b64)}`);
  assert.ok(v1);
  assert.equal(new TextDecoder('latin1').decode(v1.document), PDF);
  assert.equal(v1.to?.getFullYear(), 2024);
  assert.equal(v1.year, undefined, 'nothing is guessed into a field');

  // A PDF holding the separators and the escape character is read by its length.
  const tricky = `${PDF}+'?:@`;
  assert.equal(new TextDecoder('latin1').decode(readHiekp(`${bin(tricky)}+20250101:20250131`)!.document), tricky);

  assert.equal(readHiekp('20250101:20250131+2025'), null, 'no document, no statement');
});

test('an answer turns into statements and the Aufsetzpunkt of 3040', () => {
  const i = new PdfStatementInteraction('1234567890');
  const message = new Message([
    decode("HIRMS:4:2:3+3040::Es liegen weitere Informationen vor:B-2'"),
    decode(`HIEKP:5:2:3+${bin(PDF)}+20250101:20250131++2025+1'`),
  ]);
  const response = { bankAnswers: [{ code: 3040, text: '', params: ['B-2'] }] } as never as Parameters<PdfStatementInteraction['handleResponse']>[1];
  i.handleResponse(message, response);
  assert.equal(response.statements.length, 1);
  assert.equal(response.statements[0].number, 1);
  assert.equal(response.nextOffset, 'B-2');
});
