'use client';

// The payment alerts of "Neue Umsätze melden" (6.0, lib/payment-alerts.ts):
//
//   BackgroundAlertsRow  Einstellungen → Sicherheit, under the switch while it
//                        is on: what the notices are about, and its dialog —
//                        every new booking, dearer contracts, incoming money,
//                        a limit per account, amounts in the notices or not
//   AlertWatch           nothing to see: hands the checks Verträge & Abos'
//                        contracts and regular incomes while the user is in
//
// The choices live in the checks' sealed box on this device, beside the
// PINs, not in the vault: the check reads them without the user.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SerializedAccount } from '@/lib/fints-types';
import { dayKey, fmtAmountInput, parseAmount } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import type { Messages } from '@/lib/i18n';
import { DEFAULT_PREFS, watchOf, type AlertPrefs, type AlertsView } from '@/lib/payment-alerts';
import { useFints } from '../FintsProvider';
import { AlertTriangleIcon, BellIcon, FilterIcon } from '../icons';
import { useRecurringModel } from '../insights/recurring-model';
import { currencyMark } from '../Money';
import { Button, Checkbox, Dialog, Input, Spinner } from '../ui';
import { ActionItem } from './rows';

/** The accounts a limit can be set for: every one whose Umsätze the checks read. */
function useLimitAccounts(): SerializedAccount[] {
  const { accounts } = useFints();
  return useMemo(() => accounts.filter((a) => a.canStatements), [accounts]);
}

/** "Neue Umsätze, teurere Verträge, Kontostand": what is on, as the row says it. */
function summaryOf(view: AlertsView, words: Messages['background']['alerts']): string {
  const parts = [
    view.prefs.every && words.parts.every,
    view.prefs.dearer && words.parts.dearer,
    view.prefs.income && words.parts.income,
    Object.values(view.accounts).some((a) => a.checked && a.cents !== null) && words.parts.low,
  ].filter((p): p is string => !!p);
  if (!parts.length) return words.nothing;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function BackgroundAlertsRow() {
  const t = useT();
  const { bank, backgroundChecks, backgroundAlerts } = useFints();
  const limitAccounts = useLimitAccounts();
  const keys = useMemo(() => limitAccounts.map((a) => a.accountNumber), [limitAccounts]);
  const keysId = keys.join('|');
  const [view, setView] = useState<AlertsView | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (backgroundChecks !== true) {
      setView(null);
      return;
    }
    let current = true;
    void backgroundAlerts(keysId ? keysId.split('|') : []).then((v) => {
      if (current) setView(v);
    });
    return () => {
      current = false;
    };
  }, [backgroundChecks, keysId, backgroundAlerts]);

  if (backgroundChecks !== true || !bank) return null;
  const words = t.background.alerts;
  return (
    <>
      <ActionItem
        setting="alerts"
        icon={<FilterIcon />}
        title={words.title}
        summary={view ? summaryOf(view, words) : undefined}
        onClick={() => setOpen(true)}
      />
      {open && (
        <AlertsDialog
          accounts={limitAccounts}
          initial={view}
          onClose={(next) => {
            setOpen(false);
            if (next) setView(next);
          }}
        />
      )}
    </>
  );
}

function AlertsDialog({ accounts, initial, onClose }: {
  accounts: SerializedAccount[];
  initial: AlertsView | null;
  onClose: (saved: AlertsView | null) => void;
}) {
  const t = useT();
  const { backgroundAlerts, accountLabel, bankOf, banks, toast } = useFints();
  const words = t.background.alerts;
  const auto = useId();
  const keys = useMemo(() => accounts.map((a) => a.accountNumber), [accounts]);
  const [view, setView] = useState<AlertsView | null>(initial);
  const [prefs, setPrefs] = useState<AlertPrefs>(initial?.prefs ?? DEFAULT_PREFS);
  const [amounts, setAmounts] = useState(initial?.amounts ?? true);
  const [values, setValues] = useState<Record<string, string>>(() => valuesOf(initial));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const fieldRefs = useRef(new Map<string, HTMLInputElement>());

  // Read afresh on open: another window or the phone's job may have changed it.
  useEffect(() => {
    let current = true;
    void backgroundAlerts(keys).then((v) => {
      if (!current) return;
      if (!v) {
        setFailed(true);
        return;
      }
      setView(v);
      if (dirty.current) return;
      setPrefs(v.prefs);
      setAmounts(v.amounts);
      setValues(valuesOf(v));
    });
    return () => {
      current = false;
    };
  }, [backgroundAlerts, keys]);

  // Only accounts at a login the checks look at: a limit elsewhere would never be said.
  const listed = accounts.filter((a) => view?.accounts[a.accountNumber]?.checked);
  const severalBanks = banks.length > 1;
  const nameOf = (a: SerializedAccount) => {
    const label = accountLabel(a);
    const bankName = severalBanks ? bankOf(a)?.bank.name : null;
    return bankName ? `${label} · ${bankName}` : label;
  };
  const change = <K extends keyof AlertPrefs>(k: K, on: boolean) => {
    dirty.current = true;
    setPrefs((p) => ({ ...p, [k]: on }));
  };

  const save = async () => {
    if (!view || busy) return;
    const bad: Record<string, boolean> = {};
    const limits: Array<{ account: string; cents: number | null; label: string }> = [];
    for (const a of listed) {
      const key = a.accountNumber;
      const text = (values[key] ?? '').trim();
      const euros = text ? parseAmount(text) : null;
      if (text && euros === null) {
        bad[key] = true;
        continue;
      }
      const cents = euros === null ? null : Math.round(euros * 100);
      if (cents !== (view.accounts[key]?.cents ?? null)) limits.push({ account: key, cents, label: accountLabel(a) });
    }
    if (Object.keys(bad).length) {
      setErrors(bad);
      const first = listed.find((a) => bad[a.accountNumber]);
      if (first) fieldRefs.current.get(first.accountNumber)?.focus();
      return;
    }
    setBusy(true);
    try {
      const next = await backgroundAlerts(keys, { ...prefs, amounts, limits });
      if (!next) {
        toast(t.background.failed, 'error');
        return;
      }
      toast(words.saved, 'success');
      onClose(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : () => onClose(null)}
      title={words.title}
      icon={<BellIcon size={20} />}
      description={words.intro}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={() => onClose(null)} disabled={busy}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} disabled={!view} onClick={() => void save()}>{t.common.save}</Button>
        </>
      }
    >
      {!view ? (
        failed ? (
          <p className="flex items-start gap-2 text-[14px] leading-relaxed text-red">
            <AlertTriangleIcon size={18} className="mt-0.5 shrink-0" />
            {words.failed}
          </p>
        ) : (
          <div className="grid place-items-center py-6"><Spinner size={32} /></div>
        )
      ) : (
        <>
          <div className="space-y-2">
            <Checkbox label={words.every} checked={prefs.every} disabled={busy} onChange={(e) => change('every', e.target.checked)} />
            <Checkbox
              label={words.dearer}
              description={words.dearerHint}
              checked={prefs.dearer}
              disabled={busy}
              onChange={(e) => change('dearer', e.target.checked)}
            />
            <Checkbox
              label={words.income}
              description={words.incomeHint}
              checked={prefs.income}
              disabled={busy}
              onChange={(e) => change('income', e.target.checked)}
            />
          </div>

          {listed.length > 0 && (
            <fieldset className="mt-5 border-t border-line pt-4">
              <legend className="sr-only">{words.low}</legend>
              <p aria-hidden className="text-[15px] leading-snug font-medium text-ink">{words.low}</p>
              <p id={`${auto}-low`} className="mt-1 text-[13px] leading-snug text-ink-2">{words.lowHint}</p>
              <ul className="mt-2">
                {listed.map((a) => {
                  const key = a.accountNumber;
                  const fieldId = `${auto}-${key}`;
                  const error = errors[key];
                  return (
                    <li key={key} className="border-b border-line py-2 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <label htmlFor={fieldId} className="min-w-0 flex-1 text-[15px] leading-snug text-ink">{nameOf(a)}</label>
                        <div className="w-[9.5rem] shrink-0">
                          <Input
                            ref={(el) => {
                              if (el) fieldRefs.current.set(key, el);
                              else fieldRefs.current.delete(key);
                            }}
                            id={fieldId}
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={words.lowFor(nameOf(a))}
                            aria-describedby={`${auto}-low${error ? ` ${fieldId}-error` : ''}`}
                            invalid={!!error}
                            disabled={busy}
                            value={values[key] ?? ''}
                            onChange={(e) => {
                              const text = e.target.value;
                              dirty.current = true;
                              setValues((v) => ({ ...v, [key]: text }));
                              if (error) setErrors((prev) => ({ ...prev, [key]: false }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void save();
                              }
                            }}
                            className="amount text-right text-[17px] font-medium"
                            trailing={<span aria-hidden className="pr-2.5 text-[15px] font-medium text-ink-3">{currencyMark(a.currency || 'EUR')}</span>}
                          />
                        </div>
                      </div>
                      {error && (
                        <p id={`${fieldId}-error`} className="mt-1.5 flex items-start justify-end gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
                          <AlertTriangleIcon size={16} className="mt-px shrink-0" />
                          {words.invalid}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <div className="mt-4 border-t border-line pt-3">
            <Checkbox
              label={t.background.amounts}
              checked={amounts}
              disabled={busy}
              onChange={(e) => {
                dirty.current = true;
                setAmounts(e.target.checked);
              }}
            />
          </div>
        </>
      )}
    </Dialog>
  );
}

/** The limit fields' text from a view: "100,00", or empty for none. */
function valuesOf(view: AlertsView | null): Record<string, string> {
  if (!view) return {};
  return Object.fromEntries(
    Object.entries(view.accounts).map(([key, a]) => [key, a.cents === null ? '' : fmtAmountInput(a.cents / 100)]),
  );
}

/** How long Verträge & Abos must hold still before its list goes to the checks. */
const WATCH_SETTLE_MS = 4000;

/**
 * Hands the checks Verträge & Abos' contracts and regular incomes while the
 * user is in: what a contract usually costs is known only from the history
 * loaded here (lib/payment-alerts.ts). Mounted only while the checks are on —
 * the detection it reads is not free. Sent again only when the list changed.
 */
export function AlertWatch() {
  const { sendAlertWatch, vault, vaultStatus } = useFints();
  const model = useRecurringModel();
  const sent = useRef('');
  const ready = !model.loading && !!model.basis;
  const kept = vault?.contractReminders;
  // The vault's cancellation reminders, whole: an empty list clears what the check kept of them.
  const reminders = useMemo(
    () => (vaultStatus === 'ready' ? Object.entries(kept ?? {}).map(([id, r]) => ({ id, by: r.by, lead: r.lead, name: r.name })) : null),
    [vaultStatus, kept],
  );
  const payload = useMemo(() => {
    const w = ready
      ? watchOf([...model.income, ...model.expense], [...model.ended, ...model.dismissed], dayKey(new Date()))
      : { contracts: [], income: [], drop: [] };
    // Nothing to say yet: an empty list would drop nothing anyway.
    if (!reminders && !(w.contracts.length || w.income.length || w.drop.length)) return null;
    return { ...w, ...(reminders ? { reminders } : {}) };
  }, [ready, model.income, model.expense, model.ended, model.dismissed, reminders]);

  useEffect(() => {
    if (!payload) return;
    // The day each entry was named changes daily; what matters is the list.
    const id = JSON.stringify({ ...payload, contracts: payload.contracts.map(({ at: _a, ...c }) => c), income: payload.income.map((i) => i.key) });
    if (id === sent.current) return;
    const timer = setTimeout(() => {
      void sendAlertWatch(payload).then((ok) => {
        if (ok) sent.current = id;
      });
    }, WATCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [payload, sendAlertWatch]);

  return null;
}
