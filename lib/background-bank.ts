// The bank's side of "Neue Umsätze melden" (lib/background-check.ts): a kept
// login opened on its remembered device exactly as the login form's fast path
// opens it (app/api/connect: no synchronisation, no bank traffic), and the
// last days' Umsätze read as the Umsätze list reads them
// (app/api/transactions) — camt, MT940, or a Sparkasse card's DKKKU.
//
// A remembered device that does not open with the kept PIN — the PIN was
// changed, the device was set up under another product ID — is never taken
// to the bank: the login waits for the user instead.
//
// A PIN the bank turns down leaves the box (lib/background-check.ts). Where
// the bank said so with its own codes for the PIN, everything else on the
// desktop that keeps it or opens with it goes too — the login's Windows Hello
// file, its security keys and its remembered device, as app/api/forget-device
// does for a PIN refused in the app — and the PIN is noted as refused
// (lib/state-store.ts markPinRefused) for the copies nothing here reaches.

import { lookupBlz } from './banks';
import { refusalOf, type BankSide, type CheckedLogin } from './background-check';
import { fetchStatements } from './fints-statements';
import { IS_ANDROID } from './platform';
import { restorePlan } from './product-fallback';
import { removeSecurityKeys } from './security-key';
import { accountsFor, balanceFromStatements, bankAnswerText, serializeTransactions } from './serialize';
import { dropSession, FALLBACK_PRODUCT_ID, getSession, loginInUse, newSession, PRODUCT_ID, restoredClient } from './session';
import { forgetProfile, loadProfile, markPinRefused, profileState } from './state-store';
import { removeWindowsHello } from './windows-hello';

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
      // do not all send 9931/9942 — and is never tried again; which of the
      // two it was decides how far the deletion goes (refusalOf).
      if (!resp.success) return refusalOf(bankAnswerText(resp));
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

  async refused(login) {
    // The phone's job only reads the saved files (mobile/background/entry.ts)
    // and has no way to the PIN behind the fingerprint: there the app's next
    // login finds out, before or at its first read (lib/client-api.ts PIN_REFUSED_EVENT).
    if (IS_ANDROID) return;
    // Noted first: a copy of this PIN kept beside another login ("Weitere
    // Banken mit anmelden") cannot be deleted without that login's PIN, and
    // /api/connect knows it by this note instead.
    const noted = markPinRefused(login.blz, login.userId, login.pin);
    // The remembered device set up afresh under another PIN while this check
    // was on its way: Windows Hello and the security keys were deleted with
    // the old one then (lib/session.ts saveSessionProfile), and whatever is
    // there now keeps the new PIN. Nothing of it is this refusal's.
    const device = profileState(login.blz, login.userId, login.pin);
    if (device === 'locked') return;
    const name = { blz: login.blz, userId: login.userId };
    const kept = await Promise.allSettled([removeWindowsHello(name), removeSecurityKeys(name)]);
    // The device itself only where this PIN opens it; a damaged file is nobody's.
    const gone = device === 'opens' || device === 'expired' ? forgetProfile(login.blz, login.userId) : true;
    if (!noted || !gone || kept.some((k) => k.status === 'rejected')) {
      console.warn(`[background] a refused PIN could not be deleted everywhere (blz=${login.blz})`);
    }
  },
};
