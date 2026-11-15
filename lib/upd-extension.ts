// The HIUPD "Erweiterung, kontobezogen" (FinTS 3.0 Formals E.3.1): JSON a
// bank may add to each account in the user parameters. From Version 01.00
// it can carry the account's balance in AcctBal, "analog HISAL"; then the
// spec asks clients not to send a separate balance request. Version 00.00
// is only {"umsltzt": …}. lib-fints reads the field but drops it; Girovo's
// patch (patches/lib-fints+1.5.3.patch) keeps it as `extension`.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { BankingInformation } from 'lib-fints';
import type { SerializedBalance } from './fints-types';

/**
 * The banking information as a remembered device profile keeps it: without
 * the accounts' extensions, which may carry their balances. A profile is
 * kept even with "Letzte Salden behalten" off, and a login restored from it
 * must not show a figure from back then as the account list's.
 */
export function withoutExtensions(info: BankingInformation): BankingInformation {
  const accounts = info?.upd?.bankAccounts;
  if (!accounts?.some((a) => (a as { extension?: string }).extension != null)) return info;
  return {
    ...info,
    upd: {
      ...info.upd!,
      bankAccounts: accounts.map((a) => {
        const { extension: _gone, ...rest } = a as typeof a & { extension?: string };
        return rest;
      }),
    },
  };
}

/** "1476,98" (the spec's form) or "1476.98" → 1476.98; null for anything else. */
function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  // With a comma, dots are thousands; without one, a dot is the decimal point.
  const s = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * jjjjmmtt and hhmmss (UTC+01:00, as the spec says for every Date and Time)
 * → the moment as an ISO string; null for a date that is not one.
 */
function moment(date: unknown, time: unknown): string | null {
  const d = String(date ?? '').trim();
  if (!/^\d{8}$/.test(d)) return null;
  const t = String(time ?? '').trim().padStart(6, '0');
  const hhmmss = /^\d{6}$/.test(t) ? t : '000000';
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}+01:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A signed figure from {DebCrd, Val}: "D" is owed. */
function signed(o: unknown): number | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const v = amount(r.Val);
  if (v == null) return null;
  return String(r.DebCrd ?? '').toUpperCase() === 'D' ? -Math.abs(v) : Math.abs(v);
}

/**
 * The balance a bank put into the account's UPD extension, as Girovo's
 * balance answer would carry it; null without one (no extension, Version
 * 00.00, no AcctBal, unreadable JSON). Never throws.
 */
export function balanceFromUpdExtension(raw: string | null | undefined, fallbackCurrency = 'EUR'): SerializedBalance | null {
  if (!raw || typeof raw !== 'string' || raw.length > 4096) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  if (typeof root.Ver !== 'string') return null;
  const bal = root.AcctBal;
  if (!bal || typeof bal !== 'object') return null;
  const b = bal as Record<string, unknown>;
  const booked = b.CurValBal as Record<string, unknown> | undefined;
  const value = signed(booked);
  if (value == null) return null;
  const date = moment(booked?.Date, booked?.Time);
  if (!date) return null;
  const currency = typeof b.Cur === 'string' && /^[A-Z]{3}$/.test(b.Cur) ? b.Cur : fallbackCurrency;
  const available = amount(b.AvailFunds);
  const limit = amount(b.OverDraftLim ?? b.OverdraftLim);
  const pending = signed(b.InclPendTransBal);
  return {
    balance: value,
    currency,
    date,
    availableAmount: available,
    creditLimit: limit,
    notedBalance: pending,
  };
}
