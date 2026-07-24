// Sooskasse-FinTS — backend
// Speaks the FinTS 3.0 PIN/TAN protocol via `lib-fints`, including the
// *decoupled* TAN flow (S-pushTAN, SecureGo plus, …) where the user approves
// the operation inside their banking app, and SEPA credit transfers
// (Einzel- & Echtzeitüberweisung) via the custom segments in fints-sepa.mjs.
//
// Security model: credentials (PIN) live only in server memory for the lifetime
// of a session and are never written to disk or logged. Run this locally.

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FinTSConfig, FinTSClient, Dialog } from 'lib-fints';
// TanMediaInteraction (HKTAB) isn't re-exported from the package entry point,
// so import it by relative path — a path specifier bypasses the "exports" gate.
import { TanMediaInteraction } from './node_modules/lib-fints/dist/interactions/tanMediaInteraction.js';
import { searchBanks, lookupBlz, bankCount, POPULAR_BANKS } from './banks.mjs';
import {
  SepaTransferInteraction, TRANSFER_SEG, INSTANT_SEG,
  validateIban, validateBic, parseAmount, sepaSanitize,
} from './fints-sepa.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Product registration
//
// FinTS requires a product registration ID issued by the ZKA
// (https://www.hbci-zka.de/register/prod_register.htm). Without a valid,
// registered ID the bank rejects the dialog with 9078 ("Software nicht als
// FinTS-Produkt registriert").
//
// The ID is read (in order of priority) from:
//   1. the FINTS_PRODUCT_ID environment variable, or
//   2. config.json in this folder  { "productId": "...", "productVersion": "..." }
// ---------------------------------------------------------------------------
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch { /* config.json is optional */ }

const PLACEHOLDER_ID = 'MEINEBANKINGAPP0001';
const PRODUCT_ID = process.env.FINTS_PRODUCT_ID || fileConfig.productId || PLACEHOLDER_ID;
const PRODUCT_VERSION = process.env.FINTS_PRODUCT_VERSION || fileConfig.productVersion || '1.0';
const DEBUG = !!(process.env.FINTS_DEBUG || fileConfig.debug);

// Log the bank's return codes for a response — this is what we need to see the
// exact decoupled-TAN handshake a bank uses.
function logResp(label, s, resp) {
  const codes = (resp.bankAnswers || []).map((a) => `${a.code}:${a.text}`).join(' | ');
  const ended = s?.client?.currentDialog?.hasEnded;
  console.log(`[${label}] requiresTan=${resp.requiresTan} success=${resp.success} hasEnded=${ended} tanRef=${resp.tanReference || '-'}`);
  console.log(`         codes: ${codes || '(none)'}`);
}

// ---------------------------------------------------------------------------
// In-memory session store. Each session owns one FinTSClient plus a record of
// the currently pending TAN-gated operation (so polling knows how to continue).
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle timeout

function newSession(client, meta) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { id, client, meta, pending: null, lastSeen: Date.now() });
  return id;
}
function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  s.lastSeen = Date.now();
  return s;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Serialisers — map lib-fints objects to plain JSON for the frontend.
// ---------------------------------------------------------------------------
function serializeTanMethod(m) {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    isDecoupled: m.isDecoupled,
    activeTanMedia: m.activeTanMedia || [],
    tanMediaRequirement: m.tanMediaRequirement,
    decoupled: m.decoupled
      ? {
          waitBeforeFirst: m.decoupled.waitingSecondsBeforeFirstStatusRequest,
          waitBetween: m.decoupled.waitingSecondsBetweenStatusRequests,
          maxStatusRequests: m.decoupled.maxStatusRequests,
        }
      : null,
  };
}

function accountsFor(s) {
  const cfg = s.client.config;
  const accts = cfg.bankingInformation?.upd?.bankAccounts || [];
  const bankSupports = (segId) => cfg.isTransactionSupported(segId);
  const acctSupports = (a, segId) => !!a.allowedTransactions?.find((t) => t.transId === segId);
  return accts.map((a) => ({
    accountNumber: a.accountNumber,
    iban: a.iban || null,
    bic: lookupBlz(a.bank?.bankId)?.bic || null,
    currency: a.currency || 'EUR',
    accountType: a.accountType,
    holder: [a.holder1, a.holder2].filter(Boolean).join(', '),
    product: a.product || null,
    limit: a.limit?.value ?? null,
    canStatements: acctSupports(a, 'HKKAZ') || acctSupports(a, 'HKCAZ'),
    canBalance: acctSupports(a, 'HKSAL'),
    canTransfer: bankSupports(TRANSFER_SEG) && acctSupports(a, TRANSFER_SEG) && !!a.iban,
    canInstant: bankSupports(INSTANT_SEG) && acctSupports(a, INSTANT_SEG) && !!a.iban,
  }));
}

function serializeBalance(b) {
  if (!b) return null;
  return {
    balance: b.balance,
    currency: b.currency,
    date: b.date,
    availableAmount: b.availableAmount ?? null,
    creditLimit: b.creditLimit ?? null,
    notedBalance: b.notedBalance ?? null,
  };
}

// The account statement already carries the current balance (closingBalance),
// so one statement query yields both Umsätze and Kontostand — avoiding a
// second SCA approval for a separate balance request.
function balanceFromStatements(statements) {
  const withBalance = (statements || []).filter((s) => s.closingBalance);
  const last = withBalance[withBalance.length - 1];
  if (!last) return null;
  const cb = last.closingBalance;
  const av = last.availableBalance;
  return {
    balance: cb.value,
    currency: cb.currency,
    date: cb.date,
    availableAmount: av ? av.value : null,
  };
}

function serializeTransactions(statements) {
  const txs = [];
  for (const st of statements || []) {
    for (const t of st.transactions || []) {
      txs.push({
        valueDate: t.valueDate,
        entryDate: t.entryDate,
        amount: t.amount, // already signed: debit negative, credit positive
        currency: st.closingBalance?.currency || 'EUR',
        purpose: t.purpose || '',
        bookingText: t.bookingText || '',
        remoteName: t.remoteName || '',
        remoteIban: t.remoteAccountNumber || '',
        remoteBic: t.remoteIdentifier || t.remoteBankId || '',
        e2eReference: t.e2eReference || '',
        mandateReference: t.mandateReference || '',
        customerReference: t.customerReference || '',
        bankReference: t.bankReference || '',
        transactionCode: t.transactionCode || '',
        primeNotesNr: t.primeNotesNr || '',
        textKeyExtension: t.textKeyExtension || '',
        additionalInformation: t.additionalInformation || '',
        statementNumber: st.number || '',
      });
    }
  }
  // newest first
  txs.sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate));
  return txs;
}

function tanPayload(resp) {
  return {
    needsTan: true,
    decoupled: true,
    tanChallenge: resp.tanChallenge || null,
    tanMediaName: resp.tanMediaName || null,
  };
}

function bankAnswerText(resp) {
  return (resp.bankAnswers || [])
    .map((a) => `${a.code}: ${a.text}`)
    .join(' | ');
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function friendlyError(err) {
  const msg = err?.message || String(err);
  const code = err?.cause?.code || '';
  if (msg === 'fetch failed' || ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) {
    return 'Bank nicht erreichbar. Prüfe deine Internetverbindung und die FinTS-URL.';
  }
  return msg;
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[error]', err?.message || err, err?.cause?.code || '');
    res.status(500).json({ error: friendlyError(err) });
  });

// App metadata (product-ID status, DB size) for the frontend.
app.get('/api/meta', (req, res) => {
  res.json({
    productRegistered: PRODUCT_ID !== PLACEHOLDER_ID,
    bankCount,
  });
});

// Curated quick-pick banks for the login screen.
app.get('/api/banks', (req, res) => {
  res.json(POPULAR_BANKS);
});

// Which real logo files exist (public/logos/<brand>.svg|png) — the frontend
// falls back to a monogram chip for brands without one.
app.get('/api/logos', (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(path.join(__dirname, 'public', 'logos'))
      .filter((f) => /\.(svg|png)$/i.test(f));
  } catch { /* no logos directory */ }
  res.json(files);
});

// BLZ / name / city search over the full institute database.
app.get('/api/bank-search', (req, res) => {
  const q = String(req.query.q || '');
  res.json(searchBanks(q, 25));
});

// Step 1: connect + first synchronisation (fetches BPD incl. available TAN methods).
app.post('/api/connect', wrap(async (req, res) => {
  const { blz, userId, pin, customUrl } = req.body || {};

  const bankId = String(blz || '').trim();
  if (!/^\d{8}$/.test(bankId)) return res.status(400).json({ error: 'Bitte eine gültige 8-stellige Bankleitzahl angeben.' });
  const dbEntry = lookupBlz(bankId);
  const url = (customUrl || '').trim() || dbEntry?.url;
  if (!url) return res.status(400).json({ error: 'Für diese BLZ ist keine FinTS-URL bekannt. Bitte URL manuell angeben.' });
  if (!/^https:\/\//.test(url)) return res.status(400).json({ error: 'Die FinTS-URL muss mit https:// beginnen.' });
  if (!userId || !pin) return res.status(400).json({ error: 'Bitte Anmeldename und PIN angeben.' });

  const trySync = async (bankUrl) => {
    const config = FinTSConfig.forFirstTimeUse(
      PRODUCT_ID, PRODUCT_VERSION, bankUrl, bankId, userId, pin,
    );
    config.debugEnabled = DEBUG;
    const client = new FinTSClient(config);
    const sync = await client.synchronize();
    return { client, sync };
  };

  // Transport-level failures (dead host, HTTP error page) — as opposed to a
  // FinTS-level rejection, which means the URL is fine but the login isn't.
  const isTransportError = (err) =>
    err?.message === 'fetch failed' ||
    ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(err?.cause?.code) ||
    /request failed with status code/i.test(err?.message || '') ||
    /error decoding/i.test(err?.message || '');

  let client, sync;
  try {
    ({ client, sync } = await trySync(url));
  } catch (err) {
    // The institute DB carries an alternate URL for some banks — if the
    // primary endpoint is unreachable, try that before giving up.
    if (!customUrl && dbEntry?.urlAlt && isTransportError(err)) {
      console.log(`[connect] ${url} failed (${err?.cause?.code || err.message}) — trying alternate ${dbEntry.urlAlt}`);
      ({ client, sync } = await trySync(dbEntry.urlAlt));
    } else {
      throw err;
    }
  }
  logResp('connect', { client }, sync);
  console.log(`[connect] blz=${bankId} upd=${!!client.config.bankingInformation?.upd} accounts=${client.config.bankingInformation?.upd?.bankAccounts?.length ?? 0} tanMethods=${client.config.availableTanMethods?.length ?? 0}`);
  if (!sync.success && (!client.config.availableTanMethods || client.config.availableTanMethods.length === 0)) {
    return res.status(400).json({ error: bankAnswerText(sync) || 'Synchronisation fehlgeschlagen. Prüfe BLZ, Anmeldename und PIN.' });
  }

  const bankName = client.config.bankingInformation?.bpd?.bankName || dbEntry?.name || `BLZ ${bankId}`;
  const meta = { blz: bankId, bankName, brand: dbEntry?.brand || 'generic', bic: dbEntry?.bic || null };
  const sessionId = newSession(client, meta);
  res.json({
    sessionId,
    bank: meta,
    tanMethods: client.config.availableTanMethods.map(serializeTanMethod),
    bankMessages: sync.bankingInformation?.bankMessages || [],
  });
}));

// Step 2: select TAN method (+ media) and run the authenticated sync that
// pulls the account list (UPD). This usually triggers the decoupled approval.
app.post('/api/select-tan', wrap(async (req, res) => {
  const { sessionId, tanMethodId, tanMediaName } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });

  const method = s.client.selectTanMethod(Number(tanMethodId));

  // Banks with tanMediaRequirement=Required (e.g. Sparkasse pushTAN) need the
  // exact device name. Discover it via HKTAB, unless the caller already picked.
  if (tanMediaName) {
    method.activeTanMedia = Array.from(new Set([...(method.activeTanMedia || []), tanMediaName]));
    s.client.selectTanMedia(tanMediaName);
  } else if (method.tanMediaRequirement >= 2 && (!method.activeTanMedia || method.activeTanMedia.length === 0)) {
    // The bank wants a device name we don't have. Try to look it up via HKTAB…
    const names = await fetchTanMediaNames(s.client);
    console.log(`[select-tan] HKTAB media names: ${JSON.stringify(names)}`);
    if (names.length === 1) {
      method.activeTanMedia = names;
      s.client.selectTanMedia(names[0]);
    } else if (names.length > 1) {
      method.activeTanMedia = names;
      return res.json({ chooseTanMedia: names }); // let the user pick
    } else {
      // …HKTAB isn't available here (Sparkasse rejects the list as non-PSD2).
      // Fall back to omitting the device name: with a single registered device
      // the bank uses it automatically. Downgrading Required→Optional makes
      // lib-fints send the HKTAN without the (still unknown) Bezeichnung.
      console.log('[select-tan] HKTAB unavailable — omitting device name (single-device fallback)');
      method.tanMediaRequirement = 1;
    }
  }

  const sync = await s.client.synchronize();
  logResp('select-tan', s, sync);

  if (sync.requiresTan) {
    s.pending = { type: 'sync', tanReference: sync.tanReference };
    return res.json(tanPayload(sync));
  }
  if (!sync.success) {
    return res.status(400).json({ error: bankAnswerText(sync) || 'Anmeldung fehlgeschlagen.' });
  }

  return res.json({ needsTan: false, accounts: accountsFor(s) });
}));

// Fetch the registered TAN-media names (Gerätebezeichnungen) via HKTAB.
// HKTAB is SCA-exempt, but only if the dialog init carries no HKTAN — so we
// run it with the TAN method temporarily deselected. Otherwise lib-fints adds
// an HKTAN with the placeholder media name 'default' and the bank rejects it
// (9955 "Gerätebezeichnung ist unbekannt").
async function fetchTanMediaNames(client) {
  const cfg = client.config;
  const savedMethodId = cfg.tanMethodId;
  const savedMediaName = cfg.tanMediaName;
  try {
    cfg.tanMethodId = undefined;
    cfg.tanMediaName = undefined;
    const dialog = new Dialog(cfg, false);
    dialog.addCustomerInteraction(new TanMediaInteraction());
    const responses = await dialog.start();
    const resp = responses.get('HKTAB');
    return resp && resp.tanMediaList ? resp.tanMediaList : [];
  } finally {
    cfg.tanMethodId = savedMethodId;
    cfg.tanMediaName = savedMediaName;
  }
}

// Poll the pending decoupled operation. Called repeatedly by the frontend
// while the user approves in their banking app. Returns the final data once
// the bank confirms the approval.
app.post('/api/tan-poll', wrap(async (req, res) => {
  const { sessionId } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });
  if (!s.pending) return res.status(400).json({ error: 'Kein offener Vorgang.' });

  const { type, tanReference, accountNumber, segId } = s.pending;
  let resp;
  try {
    switch (type) {
      case 'sync':
        resp = await s.client.synchronizeWithTan(tanReference);
        break;
      case 'balance':
        resp = await s.client.getAccountBalanceWithTan(tanReference);
        break;
      case 'statements':
        resp = await s.client.getAccountStatementsWithTan(tanReference);
        break;
      case 'transfer':
        resp = await s.client.continueCustomerInteractionWithTan([segId], tanReference);
        break;
      default:
        return res.status(400).json({ error: 'Unbekannter Vorgang.' });
    }
  } catch (err) {
    // lib-fints throws this when the bank ended the FinTS dialog between status
    // polls (some banks, e.g. Sparkasse decoupled, close the dialog on each
    // still-pending status response). The library cannot resume such a dialog.
    if (/already ended/i.test(err?.message || '')) {
      console.log(`[tan-poll] dialog ended between polls (type=${type}). hasEnded=${s.client?.currentDialog?.hasEnded}`);
      s.pending = null;
      return res.json({ status: 'dialog_ended', type, accountNumber });
    }
    throw err;
  }

  logResp('tan-poll', s, resp);

  if (resp.requiresTan) {
    // Not approved yet — keep the same reference and ask the client to poll again.
    s.pending.tanReference = resp.tanReference || tanReference;
    return res.json({ status: 'pending' });
  }

  if (!resp.success) {
    s.pending = null;
    return res.status(400).json({ error: bankAnswerText(resp) || 'Freigabe fehlgeschlagen oder abgelehnt.' });
  }

  // Approved — deliver the result for whatever was pending.
  s.pending = null;
  if (type === 'sync') return res.json({ status: 'done', kind: 'accounts', accounts: accountsFor(s) });
  if (type === 'balance') return res.json({ status: 'done', kind: 'balance', accountNumber, balance: serializeBalance(resp.balance) });
  if (type === 'statements') return res.json({ status: 'done', kind: 'statements', accountNumber, transactions: serializeTransactions(resp.statements), balance: balanceFromStatements(resp.statements) });
  if (type === 'transfer') {
    return res.json({
      status: 'done', kind: 'transfer', accountNumber,
      transferResult: resp.transferResult || null,
      bankAnswers: bankAnswerText(resp),
    });
  }
}));

// Frontend gave up on a pending approval (user pressed cancel). The bank-side
// dialog can't be aborted, but clearing the pending record lets the session
// start a fresh operation.
app.post('/api/cancel-pending', (req, res) => {
  const s = getSession(req.body?.sessionId);
  if (s) s.pending = null;
  res.json({ ok: true });
});

// Fetch current balance (Kontostand) for one account.
app.post('/api/balance', wrap(async (req, res) => {
  const { sessionId, accountNumber } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });

  const resp = await s.client.getAccountBalance(accountNumber);
  if (resp.requiresTan) {
    s.pending = { type: 'balance', tanReference: resp.tanReference, accountNumber };
    return res.json({ ...tanPayload(resp), accountNumber });
  }
  if (!resp.success) return res.status(400).json({ error: bankAnswerText(resp) || 'Kontostand konnte nicht geladen werden.' });
  res.json({ needsTan: false, accountNumber, balance: serializeBalance(resp.balance) });
}));

// Fetch transactions (Umsätze) for one account, optional date range.
app.post('/api/transactions', wrap(async (req, res) => {
  const { sessionId, accountNumber, from, to } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  const resp = await s.client.getAccountStatements(accountNumber, fromDate, toDate);
  logResp('transactions', s, resp);
  if (resp.requiresTan) {
    s.pending = { type: 'statements', tanReference: resp.tanReference, accountNumber };
    return res.json({ ...tanPayload(resp), accountNumber });
  }
  if (!resp.success) return res.status(400).json({ error: bankAnswerText(resp) || 'Umsätze konnten nicht geladen werden.' });
  res.json({ needsTan: false, accountNumber, transactions: serializeTransactions(resp.statements), balance: balanceFromStatements(resp.statements) });
}));

// ---------------------------------------------------------------------------
// SEPA-Überweisung (Einzel / Echtzeit). Requires TAN approval; the money
// leaves the account once the user confirms in their banking app.
// ---------------------------------------------------------------------------
app.post('/api/transfer', wrap(async (req, res) => {
  const { sessionId, accountNumber, recipientName, iban, bic, amount, purpose, instant } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });

  // -- validate ------------------------------------------------------------
  const name = sepaSanitize(recipientName, 70);
  if (!name) return res.status(400).json({ error: 'Bitte den Namen des Empfängers angeben.' });
  const cleanIban = validateIban(iban);
  if (!cleanIban) return res.status(400).json({ error: 'Die IBAN ist ungültig (Prüfsumme oder Format).' });
  const cleanBic = validateBic(bic);
  if (cleanBic === null) return res.status(400).json({ error: 'Die BIC ist ungültig.' });
  const amountCents = parseAmount(amount);
  if (amountCents === null) return res.status(400).json({ error: 'Der Betrag ist ungültig.' });
  const cleanPurpose = sepaSanitize(purpose, 140);

  const account = (s.client.config.bankingInformation?.upd?.bankAccounts || [])
    .find((a) => a.accountNumber === accountNumber);
  if (!account) return res.status(400).json({ error: 'Unbekanntes Konto.' });
  if (cleanIban === account.iban) return res.status(400).json({ error: 'Empfänger-IBAN und Auftraggeber-IBAN sind identisch.' });

  const useInstant = !!instant;
  const segId = useInstant ? INSTANT_SEG : TRANSFER_SEG;

  const interaction = new SepaTransferInteraction(accountNumber, {
    creditorName: name,
    creditorIban: cleanIban,
    creditorBic: cleanBic || undefined,
    amountCents,
    purpose: cleanPurpose,
    debtorBic: lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined,
  }, useInstant);

  console.log(`[transfer] ${useInstant ? 'HKIPZ' : 'HKCCS'} acct=${accountNumber} → ${cleanIban} ${(amountCents / 100).toFixed(2)} EUR`);
  const resp = await s.client.startCustomerOrderInteraction(interaction);
  logResp('transfer', s, resp);

  if (resp.requiresTan) {
    s.pending = { type: 'transfer', tanReference: resp.tanReference, accountNumber, segId };
    return res.json({ ...tanPayload(resp), accountNumber });
  }
  if (!resp.success) {
    return res.status(400).json({ error: bankAnswerText(resp) || 'Die Bank hat die Überweisung abgelehnt.' });
  }
  // Executed without SCA (rare, e.g. exemption) — report right away.
  res.json({
    needsTan: false, accountNumber,
    transferResult: resp.transferResult || null,
    bankAnswers: bankAnswerText(resp),
  });
}));

// Drop a session (logout).
app.post('/api/logout', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Sooskasse-FinTS  →  http://localhost:${PORT}`);
  console.log(`  Product ID: ${PRODUCT_ID} · ${bankCount} Banken in der Datenbank\n`);
  if (PRODUCT_ID === PLACEHOLDER_ID) {
    console.log('  ⚠  Using a placeholder FinTS product ID — the bank will reject this with 9078.');
    console.log('     Put your registered ID into config.json (productId).\n');
  }
});
