// The bank's side of "Neue Umsätze melden" (lib/background-check.ts): a kept
// login opened on its remembered device exactly as the login form's fast path
// opens it (app/api/connect: no synchronisation, no bank traffic), and the
// last days' Umsätze read as the Umsätze list reads them
// (app/api/transactions) — camt, MT940, or a Sparkasse card's DKKKU.
//
// A remembered device that does not open with the kept PIN — the PIN was
// changed, the device was set up under another product ID — is never taken
// to the bank: the login waits for the user instead.

import { lookupBlz } from './banks';
import type { BankSide, CheckedLogin } from './background-check';
import { isCredentialAnswer } from './bank-answer';
import { fetchStatements } from './fints-statements';
import { restorePlan } from './product-fallback';
import { accountsFor, balanceFromStatements, bankAnswerText, serializeTransactions } from './serialize';
import { dropSession, FALLBACK_PRODUCT_ID, getSession, loginInUse, newSession, PRODUCT_ID, restoredClient } from './session';
import { loadProfile } from './state-store';

export const bankSide: BankSide = {
  async open(login: CheckedLogin) {
    const saved = loadProfile(login.blz, login.userId, login.pin);
    const plan = restorePlan(saved, PRODUCT_ID, FALLBACK_PRODUCT_ID);
    if (!saved || plan.kind === 'fresh') return 'login';
    let handle: string;
    try {
      const client = restoredClient(saved, plan.productId, login.userId, login.pin);
      const entry = lookupBlz(login.blz);
      handle = newSession(client, {
        blz: login.blz,
        bankName: client.config.bankingInformation?.bpd?.bankName || login.bank,
        brand: entry?.brand || 'generic',
        bic: entry?.bic || null,
      });
    } catch (err) {
      console.warn('[background] remembered device unreadable:', (err as Error)?.message || err);
      return 'login';
    }
    const s = getSession(handle)!;
    // Every account the Umsätze list could show; a Depot has none.
    const accounts = accountsFor(s).filter((a) => a.canStatements).map((a) => ({ accountNumber: a.accountNumber }));
    return { handle, accounts };
  },

  async read(handle, accountNumber, from) {
    const s = getSession(handle);
    if (!s) return { kind: 'failed' };
    try {
      const resp = await fetchStatements(s.client, accountNumber, from);
      if (resp.requiresTan) return { kind: 'approval' };
      // Every answer that reads as the credentials turned down counts — banks
      // do not all send 9931/9942 — and is never tried again.
      if (!resp.success) return isCredentialAnswer(bankAnswerText(resp)) ? { kind: 'refused' } : { kind: 'failed' };
      // The bank took the PIN: for this session's own sake, like a read in the app.
      s.pinAccepted = true;
      // The statement's own closing balance, for an account's limit (lib/payment-alerts.ts): no second request.
      const balance = balanceFromStatements(resp.statements);
      return {
        kind: 'ok',
        transactions: serializeTransactions(resp.statements),
        balance: balance ? { value: balance.balance, currency: balance.currency || 'EUR' } : null,
      };
    } catch (err) {
      // Not reached, or an answer lib-fints could not read: nothing about the PIN.
      console.warn('[background] read failed:', (err as Error)?.message || err);
      return { kind: 'failed' };
    }
  },

  close(handle) {
    dropSession(handle);
  },

  busy(login) {
    // On the phone the job's runtime has no sessions of its own to look at:
    // the app in front, or waiting for an approval, counts as in use.
    const appInFront = (globalThis as typeof globalThis & { __girovoAppInFront?: () => boolean }).__girovoAppInFront;
    return loginInUse(login.blz, login.userId) || appInFront?.() === true;
  },
};
