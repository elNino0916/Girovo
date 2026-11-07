import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dialog, FinTSClient, FinTSConfig, Message, type BankingInformation, type Segment } from 'lib-fints';
import { fetchStatements, type StatementsResponse } from './fints-statements.ts';
import { CARD_STATEMENT_SEG } from './fints-cards.ts';
import { PENDING_SEG, PendingInteraction } from './fints-pending.ts';
import { MAX_APPROVAL_ROUNDS } from './fints-continuation.ts';
import type { ClientResponseWithResult, FinTSClientEx } from './fints-types';

// A whole dialog with a bank that spreads its answer over several messages
// (3040 with an Aufsetzpunkt), driven through lib-fints' real Dialog the way
// app/api/transactions, app/api/pending and app/api/tan-poll drive it. Only
// the wire is faked: the bank below answers the message objects lib-fints
// builds, decoded the way lib-fints' HttpClient decodes a bank's answer.

const BLZ = '12030000';
const GIRO = '1234567890';
const CAMT_ACCOUNT = '2222222222';
const CARD = '4930123412341234';
const CAMT_052 = 'urn:iso:std:iso:20022:tech:xsd:camt.052.001.08';

function bankingInformation(): BankingInformation {
  const account = (accountNumber: string, transIds: string[]) => ({
    accountNumber, bank: { country: 280, bankId: BLZ }, iban: `DE0012030000${accountNumber}`, currency: 'EUR',
    holder1: 'NINO BECKER', isSepaAccount: true, allowedTransactions: transIds.map((transId) => ({ transId })),
  });
  return {
    systemId: 'SYS-1',
    bankMessages: [],
    bpd: {
      version: 1, bankId: BLZ, bankName: 'Testbank', countryCode: 280, url: 'https://bank.test/fints',
      maxTransactionsPerMessage: 1, supportedLanguages: [], supportedHbciVersions: [300],
      availableTanMethodIds: [940],
      supportedTanMethods: [{
        id: 940, name: 'App-Freigabe', version: 7, isDecoupled: true, activeTanMediaCount: 0, activeTanMedia: [],
        tanMediaRequirement: 0, tanMaxLength: 6, tanFormat: 'num', zkaMethod: 'Decoupled', zkaVersion: '1',
      }],
      allowedTransactions: [
        { transId: 'HKKAZ', tanRequired: true, versions: [7] },
        { transId: 'HKCAZ', tanRequired: true, versions: [1], params: { supportedCamtFormats: [CAMT_052] } },
        { transId: 'DKKKU', tanRequired: true, versions: [2] },
        { transId: 'HKVMK', tanRequired: true, versions: [1] },
        { transId: 'HKTAN', tanRequired: false, versions: [7] },
      ],
    },
    upd: {
      version: 1, usage: 0,
      bankAccounts: [account(GIRO, ['HKKAZ', 'HKVMK']), account(CAMT_ACCOUNT, ['HKCAZ']), account(CARD, ['DKKKU'])],
    },
  } as unknown as BankingInformation;
}

const bin = (s: string) => `@${s.length}@${s}`;
const HEAD = `HNHBK:1:3+000000000000+300+DLG-1+1'`;
const answer = (...segs: string[]) => [HEAD, ...segs].join('');
const OK = `HIRMG:2:2+0010::Nachricht entgegengenommen.'`;
const more = (mark: string) => `HIRMS:3:2:4+3040::Es liegen weitere Informationen vor:${mark}'`;
const done = `HIRMS:3:2:4+0020::Auftrag ausgeführt.'`;

/** One day's MT940 statement — each page of the answer below carries one. */
const mt940 = (mmdd: string, cents: string, ref: string) => [
  ':20:STARTUMSE', `:25:${BLZ}/${GIRO}`, ':28C:00000/001', `:60F:C26${mmdd}EUR100,00`,
  `:61:26${mmdd}${mmdd}DR${cents}NDDTNONREF`, `:86:105?00LASTSCHRIFT?20SVWZ+${ref}`, `:62F:C26${mmdd}EUR90,00`, '-',
].join('\r\n');

/** One day's MT942 Vormerkposten. */
const mt942 = (mmdd: string, cents: string, ref: string) => [
  ':20:STARTDISPE', `:25:${BLZ}/${GIRO}`, ':28C:00000/001', `:13D:26${mmdd}1032+0200`,
  `:61:26${mmdd}${mmdd}DR${cents}NDDTNONREF`, `:86:105?00LASTSCHRIFT?20SVWZ+${ref}`, `:90D:1EUR${cents}`, '-',
].join('\r\n');

/** One day's camt.052 document. */
const camt = (day: string, amount: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${CAMT_052}"><BkToCstmrAcctRpt><GrpHdr><MsgId>${day}</MsgId></GrpHdr>
<Rpt><Id>${day}</Id><Acct><Id><IBAN>DE0012030000${CAMT_ACCOUNT}</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-${day}</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">90.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-${day}</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-${day}</Dt></BookgDt><ValDt><Dt>2026-10-${day}</Dt></ValDt></Ntry>
</Rpt></BkToCstmrAcctRpt></Document>`;

/** One DIKKU card booking (hbci4java KreditkartenUmsatz). */
const card = (day: string, cents: string, shop: string) => `${CARD}:202610${day}:202610${day}::${cents}:EUR:D::${cents}:EUR:D:${shop}:BERLIN:::::::J`;

/** Page n's day in October 2026. */
const dd = (n: number) => String(n).padStart(2, '0');

/** The order's answer segment for one page, by the order's segment id. */
const PAGE: Record<string, (n: number) => string> = {
  HKKAZ: (n) => `HIKAZ:5:7:3+${bin(mt940(`10${dd(n)}`, `${n}0,00`, `Seite ${n}`))}'`,
  HKCAZ: (n) => `HICAZ:5:1:3+DE0012030000${CAMT_ACCOUNT}:BYLADEM1001+${CAMT_052}+${bin(camt(dd(n), `${n}0.00`))}'`,
  DKKKU: (n) => `DIKKU:5:2:3+${CARD}++D:153,64:EUR:20261008+++${bin(card(dd(n), `${n}0,00`, `SHOP ${n}`))}'`,
  HKVMK: (n) => `HIVMK:5:1:3+${bin(mt942(`10${dd(n)}`, `${n},50`, `Vormerk ${n}`))}'`,
};

type Bank = {
  /** One line per message the app sent: its order (with the Aufsetzpunkt) or TAN process. */
  sent: string[];
  /** The TAN process of the HKTAN beside each order message. */
  besideOrder: (string | undefined)[];
  sendMessage(message: Message): Promise<Message>;
};

type Script = {
  order: string;
  /** Pages in all; page n > 1 is asked for with the Aufsetzpunkt AUF-n. */
  pages: number;
  /** The bank wants an approval for the first request. */
  approval?: boolean;
  /** Pages after which the bank wants another approval before it sends the next. */
  approvalAfter?: number[];
  /** The page whose request the bank refuses (9050). */
  refuse?: number;
  /** Polls of a decoupled approval answered "still waiting" (3956) before it is given. */
  pendingPolls?: number;
  /** The approval is turned down (9942) instead of answered with the page. */
  refuseApproved?: boolean;
  /** From page 2 on, the bank names the same Aufsetzpunkt again and again. */
  repeatMark?: boolean;
};

const orderOf = (message: Message, segId: string) => message.segments.find((s) => s.header.segId === segId) as
  (Segment & { continuationMark?: string }) | undefined;

/**
 * A bank that answers `script.order` in `script.pages` pages. It holds the
 * TAN reference it handed out and only answers an approval that names it.
 */
function fakeBank(script: Script): Bank {
  const sent: string[] = [];
  const besideOrder: (string | undefined)[] = [];
  let waiting: { ref: string; page: number } | null = null;
  let refs = 0;
  let pendingLeft = script.pendingPolls ?? 0;
  const approvals = new Set(script.approvalAfter ?? []);
  const pageAnswer = (n: number) => answer(
    OK,
    n < script.pages ? more(script.repeatMark && n >= 2 ? 'AUF-2' : `AUF-${n + 1}`) : done,
    PAGE[script.order](n),
  );
  const askApproval = (page: number) => {
    waiting = { ref: `REF-${++refs}`, page };
    return answer(
      `HIRMS:3:2:4+0030::Auftrag empfangen - Sicherheitsfreigabe erforderlich'`,
      `HITAN:4:7:5+4++${waiting.ref}+Bitte in der App freigeben'`,
    );
  };
  return {
    sent,
    besideOrder,
    async sendMessage(message: Message): Promise<Message> {
      // As lib-fints' HttpClient does: a request that cannot be encoded fails here.
      (message as Message & { encode(): string }).encode();
      const ids = message.segments.map((s) => s.header.segId);
      const hktan = orderOf(message, 'HKTAN') as (Segment & { tanProcess?: string; orderRef?: string }) | undefined;
      let text: string;
      if (ids.includes('HKIDN')) {
        sent.push('HKIDN');
        text = answer(OK, `HIRMS:3:2:3+3920::Zugelassene TAN-Verfahren:940'`);
      } else if (ids.includes('HKEND')) {
        sent.push('HKEND');
        text = answer(`HIRMG:2:2+0100::Dialog beendet.'`);
      } else if (orderOf(message, script.order)) {
        const mark = orderOf(message, script.order)!.continuationMark;
        sent.push(mark ? `${script.order}@${mark}` : script.order);
        besideOrder.push(hktan?.tanProcess);
        const page = mark ? Number(mark.replace('AUF-', '')) : 1;
        if (script.refuse === page) text = answer(`HIRMG:2:2+9050::Die Nachricht enthält Fehler.'`, `HIRMS:3:2:4+9210::Aufsetzpunkt unbekannt.'`);
        else if ((page === 1 && script.approval) || approvals.has(page - 1)) {
          approvals.delete(page - 1);
          text = askApproval(page);
        } else text = pageAnswer(page);
      } else {
        sent.push(`HKTAN:${hktan?.tanProcess}`);
        assert.ok(waiting, 'an approval the bank never asked for');
        assert.equal(hktan?.orderRef, waiting.ref);
        if (pendingLeft > 0) {
          pendingLeft--;
          text = answer(`HIRMS:3:2:4+3956::Starke Kundenauthentifizierung noch ausstehend.'`, `HITAN:4:7:5+S++${waiting.ref}'`);
        } else if (script.refuseApproved) {
          waiting = null;
          text = answer(`HIRMG:2:2+9050::Die Nachricht enthält Fehler.'`, `HIRMS:3:2:4+9942::Freigabe abgelehnt.'`);
        } else {
          const { page } = waiting;
          waiting = null;
          text = pageAnswer(page).replace(OK, `${OK}HITAN:4:7:5+S++REF-${refs}'`);
        }
      }
      // lib-fints' HttpClient: an order message's own answer segments arrive held back
      // (PARTED) for its reassembly of a parted answer; any other message's arrive decoded.
      const order = message as Message & { supportsPartedResponseSegments?: boolean; orderResponseSegId?: string };
      return Message.decode(text, order.supportsPartedResponseSegments ? order.orderResponseSegId : undefined);
    },
  };
}

/** A FinTSClient whose dialogs talk to `bank`, run with the interactions' log lines swallowed. */
async function withBank<T>(bank: Bank, fn: (client: FinTSClientEx) => Promise<T>): Promise<T> {
  const proto = Dialog.prototype as unknown as { getHttpClient: () => unknown };
  const real = proto.getHttpClient;
  const { log, warn } = console;
  proto.getHttpClient = () => bank;
  console.log = () => {};
  console.warn = () => {};
  try {
    const config = FinTSConfig.fromBankingInformation('PRODUCT', '1.0', bankingInformation(), 'user', 'pin', 940);
    return await fn(new FinTSClient(config) as unknown as FinTSClientEx);
  } finally {
    proto.getHttpClient = real;
    console.log = log;
    console.warn = warn;
  }
}

const amounts = (resp: StatementsResponse) => resp.statements.flatMap((s) => s.transactions.map((t) => t.amount));

// ---------------------------------------------------------------------------

test('without an approval, lib-fints follows the Aufsetzpunkt itself, and nothing is asked twice', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3 });
  const resp = await withBank(bank, (client) => fetchStatements(client, GIRO, new Date(2025, 0, 1)));
  assert.equal(resp.success, true);
  assert.equal(resp.requiresTan, false);
  assert.deepEqual(amounts(resp), [-10, -20, -30]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKKAZ@AUF-2', 'HKKAZ@AUF-3', 'HKEND']);
});

test('MT940 (HKKAZ): after the approval every page arrives, not only the first', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3, approval: true });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, GIRO, new Date(2025, 0, 1));
    assert.equal(first.requiresTan, true);
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30]);
  // The approval brings page 1; page 2 is asked for as without an approval, and
  // lib-fints' own reassembly takes it from there. The dialog ends after the last.
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKTAN:S', 'HKKAZ@AUF-2', 'HKKAZ@AUF-3', 'HKEND']);
  // Every order message as the bank's BPD asks for it: with HKTAN process 4 beside it.
  assert.deepEqual(bank.besideOrder, ['4', '4', '4']);
});

test('camt (HKCAZ): after the approval every page arrives', async () => {
  const bank = fakeBank({ order: 'HKCAZ', pages: 3, approval: true });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, CAMT_ACCOUNT, new Date(2025, 0, 1));
    assert.equal(first.requiresTan, true);
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKCAZ', 'HKTAN:S', 'HKCAZ@AUF-2', 'HKCAZ@AUF-3', 'HKEND']);
});

test('a card (DKKKU): after the approval every page arrives, as app/api/tan-poll continues it', async () => {
  const bank = fakeBank({ order: 'DKKKU', pages: 2, approval: true });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, CARD, new Date(2025, 0, 1));
    assert.equal(first.requiresTan, true);
    return (await client.continueCustomerInteractionWithTan([CARD_STATEMENT_SEG], first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20]);
  assert.deepEqual(resp.statements[0].transactions.map((t) => t.remoteName), ['SHOP 1', 'SHOP 2']);
  // The card's balance, from the first page as without an approval.
  assert.equal(resp.statements[0].closingBalance.value, -153.64);
  assert.deepEqual(bank.sent, ['HKIDN', 'DKKKU', 'HKTAN:S', 'DKKKU@AUF-2', 'HKEND']);
});

test('Vormerkposten (HKVMK): after the approval every page arrives', async () => {
  const bank = fakeBank({ order: 'HKVMK', pages: 3, approval: true });
  const resp = await withBank(bank, async (client) => {
    const first = await client.startCustomerOrderInteraction(new PendingInteraction(GIRO));
    assert.equal(first.requiresTan, true);
    return client.continueCustomerInteractionWithTan([PENDING_SEG], first.tanReference!);
  });
  assert.equal(resp.success, true);
  assert.deepEqual(resp.pendingStatements?.flatMap((s) => s.transactions.map((t) => t.amount)), [-1.5, -2.5, -3.5]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKVMK', 'HKTAN:S', 'HKVMK@AUF-2', 'HKVMK@AUF-3', 'HKEND']);
});

test('a bank that wants another approval for the next page: the poll waits for it, then the rest arrives with what came before', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 4, approval: true, approvalAfter: [1] });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, GIRO, new Date(2025, 0, 1));
    const second = (await client.getAccountStatementsWithTan(first.tanReference!)) as ClientResponseWithResult;
    // The request for page 2 waits for its own approval, as app/api/tan-poll keeps polling.
    assert.equal(second.requiresTan, true);
    assert.equal(second.tanReference, 'REF-2');
    return (await client.getAccountStatementsWithTan(second.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30, -40]);
  assert.deepEqual(bank.sent, [
    'HKIDN', 'HKKAZ', 'HKTAN:S', 'HKKAZ@AUF-2', 'HKTAN:S', 'HKKAZ@AUF-3', 'HKKAZ@AUF-4', 'HKEND',
  ]);
});

test('a refused follow-up keeps the pages already there, as a refused page does without an approval', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3, approval: true, refuse: 2 });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, GIRO, new Date(2025, 0, 1));
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKTAN:S', 'HKKAZ@AUF-2', 'HKEND']);

  // Without an approval the same refusal costs the same page and no more.
  const plain = fakeBank({ order: 'HKKAZ', pages: 3, refuse: 2 });
  const plainResp = await withBank(plain, (client) => fetchStatements(client, GIRO, new Date(2025, 0, 1)));
  assert.deepEqual(amounts(plainResp), [-10]);
  assert.deepEqual(plain.sent, ['HKIDN', 'HKKAZ', 'HKKAZ@AUF-2', 'HKEND']);
});

test('a bank that keeps asking for approvals is followed a bounded number of times', async () => {
  const pages = MAX_APPROVAL_ROUNDS + 3;
  const bank = fakeBank({ order: 'HKKAZ', pages, approval: true, approvalAfter: Array.from({ length: pages }, (_, i) => i + 1) });
  const resp = await withBank(bank, async (client) => {
    let r = (await fetchStatements(client, GIRO, new Date(2025, 0, 1))) as ClientResponseWithResult;
    for (let polls = 0; r.requiresTan && polls < pages + 2; polls++) {
      r = await client.getAccountStatementsWithTan(r.tanReference!);
    }
    return r as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.equal(resp.requiresTan, false);
  // The first approved page and one more for each round followed; the answer stands there.
  assert.equal(amounts(resp).length, MAX_APPROVAL_ROUNDS + 1);
  assert.equal(bank.sent.filter((m) => m === 'HKTAN:S').length, MAX_APPROVAL_ROUNDS + 1);
  assert.equal(bank.sent.at(-1), 'HKEND');
});

// A TAN asked for part-way through lib-fints' own page loop (patches/lib-fints+1.5.3.patch,
// Dialog.handlePartedMessages): without the patch the TAN request was dropped there and
// the pages so far stood as the whole answer.

test('a TAN asked for part-way, with no approval before: it is asked for, and then every page arrives in order', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3, approvalAfter: [1] });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, GIRO, new Date(2025, 0, 1));
    // Page 1 came without an approval; the request for page 2 wants one, and that is what the app sees.
    assert.equal(first.requiresTan, true);
    assert.equal(first.tanReference, 'REF-1');
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKKAZ@AUF-2', 'HKTAN:S', 'HKKAZ@AUF-3', 'HKEND']);
});

test('camt: a TAN asked for after two pages keeps both, and the rest follows the approval', async () => {
  const bank = fakeBank({ order: 'HKCAZ', pages: 4, approvalAfter: [2] });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, CAMT_ACCOUNT, new Date(2025, 0, 1));
    assert.equal(first.requiresTan, true);
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30, -40]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKCAZ', 'HKCAZ@AUF-2', 'HKCAZ@AUF-3', 'HKTAN:S', 'HKCAZ@AUF-4', 'HKEND']);
});

test('a decoupled approval polled while still waiting: the pages before it are kept until it is given', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3, approvalAfter: [1], pendingPolls: 2 });
  const resp = await withBank(bank, async (client) => {
    let r = (await fetchStatements(client, GIRO, new Date(2025, 0, 1))) as ClientResponseWithResult;
    let waits = 0;
    for (; r.requiresTan && waits < 5; waits++) r = await client.getAccountStatementsWithTan(r.tanReference!);
    assert.equal(waits, 3, 'two "still waiting", then the approval');
    return r as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20, -30]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKKAZ@AUF-2', 'HKTAN:S', 'HKTAN:S', 'HKTAN:S', 'HKKAZ@AUF-3', 'HKEND']);
});

test('the approval part-way turned down: the pages before it stand', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 3, approvalAfter: [1], refuseApproved: true });
  const resp = await withBank(bank, async (client) => {
    const first = await fetchStatements(client, GIRO, new Date(2025, 0, 1));
    assert.equal(first.requiresTan, true);
    return (await client.getAccountStatementsWithTan(first.tanReference!)) as StatementsResponse;
  });
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10]);
});

test('a bank that names the same Aufsetzpunkt again is not followed in circles', async () => {
  const bank = fakeBank({ order: 'HKKAZ', pages: 6, repeatMark: true });
  const resp = await withBank(bank, (client) => fetchStatements(client, GIRO, new Date(2025, 0, 1)));
  assert.equal(resp.success, true);
  assert.deepEqual(amounts(resp), [-10, -20]);
  assert.deepEqual(bank.sent, ['HKIDN', 'HKKAZ', 'HKKAZ@AUF-2', 'HKEND']);
});
