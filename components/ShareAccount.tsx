'use client';

// "Geld anfordern": a GiroCode (EPC069-12 QR) for one of your own accounts.
//
// Someone who owes you money scans it with their own banking app and gets a
// transfer to you prefilled — name, IBAN, optionally amount and purpose. It
// is not a payment request in any scheme sense (not Wero, not Request-to-Pay):
// nothing is sent anywhere, the code is computed here (lib/qr.ts) and the
// payer still checks and approves the transfer in their own app.
//
// The name goes in exactly as the bank stores the account holder, because the
// payer's bank compares it against that very record (Namensabgleich); an
// edited name is allowed, and the sheet says what it may cause.
//
// With "Beträge ausblenden" on, a code that carries an amount is covered until
// asked for: the caption can hide the figure, a scannable code on a shared
// screen cannot.

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { buildEpcPayload } from '@/lib/girocode';
import { copyText } from '@/lib/clipboard';
import { downloadBlob } from '@/lib/download';
import { fmtAmountInput, fmtIban, fmtShortIban, parseAmount } from '@/lib/format';
import { qrMatrix, qrPngBlob, qrSvgPath, type QrMatrix } from '@/lib/qr';
import { useFints } from './FintsProvider';
import { AlertTriangleIcon, CheckIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon, ImageIcon, InfoIcon, QrIcon } from './icons';
import { Money, useMoneyText, usePrivacy } from './Money';
import { Alert, Button, CopyButton, Field, Input, Overlay, Select, cx } from './ui';
import { Panel } from './transfer/Panel';

const MAX_NAME = 70;
const MAX_PURPOSE = 140;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

type Code =
  | { ok: true; matrix: QrMatrix; path: { d: string; size: number } }
  | { ok: false; message: string };

/**
 * The code as a PNG on the clipboard — the quickest way into a messenger or an
 * e-mail. The blob is handed over as a promise, so the click's user
 * activation still covers the write while the image renders. False when the
 * browser (or the desktop shell's policy) does not allow it.
 */
async function copyPng(blob: Promise<Blob>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export function ShareAccount() {
  const { accounts, sharePrefill, closeShare, accountLabel, toast } = useFints();
  const money = useMoneyText();
  const privacy = usePrivacy();
  const eligible = useMemo(() => accounts.filter((a) => !!a.iban), [accounts]);

  const [initial] = useState(() => {
    const p = sharePrefill ?? {};
    const acct = (p.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || eligible[0]?.accountNumber
      || '';
    const n = p.amount ? parseAmount(p.amount) : null;
    return {
      accountNumber: acct,
      amount: n != null && n > 0 ? fmtAmountInput(n) : (p.amount ?? ''),
      purpose: [...(p.purpose ?? '')].slice(0, MAX_PURPOSE).join(''),
    };
  });

  const [accountNumber, setAccountNumber] = useState(initial.accountNumber);
  const account = eligible.find((a) => a.accountNumber === accountNumber) ?? eligible[0];
  const holder = account?.holder ?? '';
  // The name follows the chosen account until the user writes their own.
  const [customName, setCustomName] = useState<string | null>(null);
  const name = customName ?? holder;
  const [amount, setAmount] = useState(initial.amount);
  const [amountTouched, setAmountTouched] = useState(!!initial.amount);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<'account' | 'image' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Shown on request while amounts are hidden (see the header). */
  const [revealed, setRevealed] = useState(false);

  const nameEdited = customName != null && squash(customName) !== squash(holder);

  // ---- the amount: optional, but when given it must be a real one --------
  const amountState = useMemo(() => {
    if (!amount.trim()) return { value: null as number | null, error: null as string | null };
    const n = parseAmount(amount);
    if (n == null) return { value: null, error: 'Bitte gib einen gültigen Betrag an, zum Beispiel 25,00 – oder lass das Feld leer.' };
    if (Math.round(n * 100) <= 0) return { value: null, error: 'Der Betrag muss größer als 0,00 € sein – oder lass das Feld leer.' };
    return { value: n, error: null };
  }, [amount]);
  const amountError = amountTouched ? amountState.error : null;

  // ---- the code ------------------------------------------------------------
  const code: Code | null = useMemo(() => {
    if (!account?.iban) return null;
    // An amount still being typed wrong produces no code at all, rather than
    // a code that silently leaves the amount out.
    if (amountState.error) return { ok: false, message: amountState.error };
    try {
      const payload = buildEpcPayload({
        name, iban: account.iban, bic: account.bic, amount: amountState.value, purpose,
      });
      const matrix = qrMatrix(payload);
      return { ok: true, matrix, path: qrSvgPath(matrix) };
    } catch (e) {
      return { ok: false, message: (e as Error).message || 'Der GiroCode konnte nicht erstellt werden.' };
    }
  }, [account?.iban, account?.bic, name, amountState, purpose]);

  if (!account) return null;

  const iban = account.iban ?? '';
  const short = fmtShortIban(iban);
  const accountText = [
    squash(name) || holder,
    `IBAN: ${fmtIban(iban)}`,
    account.bic ? `BIC: ${account.bic}` : null,
  ].filter(Boolean).join('\n');

  const flashCopied = (what: 'account' | 'image') => {
    setCopied(what);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1800);
  };

  const copyAccount = async () => {
    const ok = await copyText(accountText);
    if (!ok) { toast('Kopieren war nicht möglich.', 'error'); return; }
    flashCopied('account');
  };

  const copyImage = async () => {
    if (!code?.ok) return;
    if (await copyPng(qrPngBlob(code.matrix, 8))) flashCopied('image');
    else toast('Das Bild ließ sich nicht kopieren. Speichere es stattdessen als PNG.', 'error');
  };

  const savePng = async () => {
    if (!code?.ok) return;
    setSaving(true);
    try {
      const blob = await qrPngBlob(code.matrix, 8);
      const tail = iban.replace(/\s+/g, '').slice(-6);
      const amt = amountState.value != null ? `_${fmtAmountInput(amountState.value).replace(/\./g, '').replace(',', '-')}` : '';
      downloadBlob(`GiroCode_${tail}${amt}.png`, blob);
    } catch (e) {
      toast((e as Error).message || 'Das Bild konnte nicht gespeichert werden.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const summaryAmount = amountState.value != null
    ? money(amountState.value, account.currency)
    : 'Betrag frei wählbar';
  const covered = privacy && amountState.value != null && !revealed;

  return (
    <Overlay open onClose={closeShare} labelledBy="share-title" describedBy="share-desc">
      <Panel
        size="lg"
        titleId="share-title"
        title="Geld anfordern"
        onClose={closeShare}
        bodyClassName="pt-0 pb-6"
        headerExtra={(
          <p id="share-desc" className="-mt-2 text-[15px] leading-snug text-ink-2">
            Ein GiroCode für dein Konto. Die zahlende Person scannt ihn mit ihrer Banking-App und bekommt die Überweisung
            an dich fertig ausgefüllt.
          </p>
        )}
        footer={(
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              iconLeft={copied === 'account' ? <CheckIcon size={17} strokeWidth={2.2} /> : <CopyIcon size={17} />}
              onClick={() => void copyAccount()}
            >
              {copied === 'account' ? 'Kopiert' : 'Kontodaten kopieren'}
            </Button>
            <Button
              iconLeft={copied === 'image' ? <CheckIcon size={17} strokeWidth={2.2} /> : <ImageIcon size={17} />}
              disabled={!code?.ok}
              onClick={() => void copyImage()}
            >
              {copied === 'image' ? 'Kopiert' : 'Bild kopieren'}
            </Button>
            <Button
              variant="primary"
              iconLeft={<DownloadIcon size={17} />}
              busy={saving}
              disabled={!code?.ok}
              onClick={() => void savePng()}
            >
              Als PNG speichern
            </Button>
            <span className="sr-only" aria-live="polite">
              {copied === 'account' ? 'Kontodaten kopiert' : copied === 'image' ? 'GiroCode als Bild kopiert' : ''}
            </span>
          </div>
        )}
      >
        <div className="grid gap-x-8 gap-y-6 pt-2 sm:grid-cols-[minmax(0,1fr)_248px]">
          {/* The code first on a phone: with the account's defaults it is
              already useful before anything is typed. */}
          <section aria-label="GiroCode" className="flex flex-col items-center sm:sticky sm:top-0 sm:order-2 sm:self-start">
            {code?.ok && covered ? (
              <div className="grid size-[240px] place-items-center rounded-[var(--radius-card)] bg-inset px-6 text-center">
                <span className="flex flex-col items-center gap-2.5 text-[13.5px] leading-snug text-ink-2">
                  <EyeOffIcon size={28} className="text-ink-3" />
                  Beträge sind ausgeblendet – der Code enthält den Betrag und ließe sich vom Bildschirm scannen.
                  <Button size="sm" iconLeft={<EyeIcon size={16} />} onClick={() => setRevealed(true)}>Code anzeigen</Button>
                </span>
              </div>
            ) : code?.ok ? (
              // White in both themes, black modules, quiet zone included in
              // the path: an inverted or tinted code is one a scanner may refuse.
              <div className="rounded-[var(--radius-card)] bg-white p-2 shadow-[var(--shadow-tile)] ring-1 ring-line">
                <svg
                  viewBox={`0 0 ${code.path.size} ${code.path.size}`}
                  width="224"
                  height="224"
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={`GiroCode: Überweisung an ${squash(name)}, ${summaryAmount}`}
                  className="block"
                >
                  <path d={code.path.d} fill="#000" />
                </svg>
              </div>
            ) : (
              <div className="grid size-[240px] place-items-center rounded-[var(--radius-card)] border-[1.5px] border-dashed border-line-strong bg-inset px-6 text-center">
                <span className="flex flex-col items-center gap-2 text-[13.5px] leading-snug text-ink-3">
                  <QrIcon size={28} />
                  {amountState.error ? 'Bitte prüfe den Betrag.' : 'Kein GiroCode – bitte prüfe die Angaben.'}
                </span>
              </div>
            )}
            <div className="mt-3 w-full max-w-[248px] text-center">
              <p className="truncate text-[15px] font-semibold text-ink" title={squash(name)}>{squash(name) || '–'}</p>
              <p className="mt-0.5 text-[15px] text-ink-2">
                {amountState.value != null
                  ? <Money value={amountState.value} currency={account.currency} className="font-semibold text-ink" />
                  : 'Betrag frei wählbar'}
              </p>
              {purpose.trim() && <p className="mt-0.5 line-clamp-2 text-[13px] break-words text-ink-3">{squash(purpose)}</p>}
            </div>
            {code && !code.ok && !amountState.error && (
              <Alert className="mt-3 w-full">{code.message}</Alert>
            )}
            <Explainer className="mt-5 hidden max-w-[248px] text-[13px] sm:flex" />
          </section>

          <div className="min-w-0 sm:order-1">
            {eligible.length > 1 && (
              <Field label="Konto" htmlFor="share-account">
                <Select id="share-account" value={account.accountNumber} onChange={(e) => setAccountNumber(e.target.value)}>
                  {eligible.map((a) => {
                    const s = fmtShortIban(a.iban);
                    return (
                      <option key={a.accountNumber} value={a.accountNumber}>
                        {accountLabel(a)} · {s.head ? `${s.head} ${s.tail}` : s.tail}
                      </option>
                    );
                  })}
                </Select>
              </Field>
            )}

            <Field
              label="Dein Name"
              htmlFor="share-name"
              hint={nameEdited ? (
                <span className="flex flex-col items-start gap-1.5">
                  <span className="flex items-start gap-1.5 text-ink-2">
                    <AlertTriangleIcon size={15} className="mt-0.5 shrink-0 text-emphasis" />
                    <span>
                      Weicht vom Kontoinhaber „{holder}“ ab. Die Bank der zahlenden Person meldet dann womöglich
                      „Name stimmt nicht überein“.
                    </span>
                  </span>
                  <Button variant="tertiary" size="xs" className="-ml-3" onClick={() => setCustomName(null)}>
                    Kontoinhaber übernehmen
                  </Button>
                </span>
              ) : 'So, wie deine Bank den Kontoinhaber führt.'}
            >
              <Input
                id="share-name"
                value={name}
                maxLength={MAX_NAME}
                autoComplete="off"
                onChange={(e) => setCustomName(e.target.value)}
              />
            </Field>

            <Field label="Betrag" htmlFor="share-amount" optional error={amountError ?? undefined} hint={amountError ? undefined : 'Leer lassen, wenn die zahlende Person den Betrag selbst eingibt.'}>
              <Input
                id="share-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountTouched(false); }}
                onBlur={(e) => {
                  const text = e.currentTarget.value;
                  if (!text.trim()) return;
                  setAmountTouched(true);
                  const n = parseAmount(text);
                  if (n != null && n > 0) setAmount(fmtAmountInput(n));
                }}
                className="amount text-right text-[20px] font-semibold"
                trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">€</span>}
              />
            </Field>

            <Field
              label="Verwendungszweck"
              htmlFor="share-purpose"
              optional
              trailing={<span aria-hidden className="tnum text-[12.5px] text-ink-3">{purpose.length}/{MAX_PURPOSE}</span>}
            >
              <Input
                id="share-purpose"
                value={purpose}
                maxLength={MAX_PURPOSE}
                autoComplete="off"
                placeholder="z. B. Anteil Konzertkarten"
                onChange={(e) => setPurpose(e.target.value)}
              />
            </Field>

            <dl className="mt-6 divide-y divide-line border-y border-line">
              {eligible.length === 1 && (
                <div className="flex min-h-12 flex-col justify-center py-2 sm:flex-row sm:items-center sm:justify-start sm:gap-3">
                  <dt className="shrink-0 text-[13px] font-semibold text-ink-3 sm:w-12">Konto</dt>
                  <dd className="min-w-0 truncate text-[15px] text-ink">{accountLabel(account)}</dd>
                </div>
              )}
              <DataRow label="IBAN" copy={iban.replace(/\s+/g, '')} copyLabel="IBAN kopieren">
                <span className="iban text-[14.5px] text-ink">
                  {short.head && fmtIban(iban).slice(0, -short.tail.length)}
                  <span className="font-semibold">{short.tail}</span>
                </span>
              </DataRow>
              {account.bic && (
                <DataRow label="BIC" copy={account.bic} copyLabel="BIC kopieren">
                  <span className="num text-[14.5px] tracking-[0.04em] text-ink">{account.bic}</span>
                </DataRow>
              )}
            </dl>

            <Explainer className="mt-4 flex text-[13.5px] sm:hidden" />
          </div>
        </div>
      </Panel>
    </Overlay>
  );
}

/** Label and value side by side; on a phone the label goes above, so an IBAN keeps its whole width. */
function DataRow({
  label, copy, copyLabel, children,
}: { label: string; copy: string; copyLabel: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2">
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
        <dt className="shrink-0 text-[13px] font-semibold text-ink-3 sm:w-12">{label}</dt>
        <dd className="min-w-0 overflow-x-auto [scrollbar-width:none]">{children}</dd>
      </div>
      <CopyButton text={copy} label={copyLabel} />
    </div>
  );
}

function Explainer({ className }: { className?: string }) {
  return (
    <p className={cx('items-start gap-2 leading-relaxed text-ink-3', className)}>
      <InfoIcon size={16} className="mt-0.5 shrink-0" />
      <span>
        Lesbar mit Banking-Apps, die GiroCodes scannen können. Der Code enthält nur Name, IBAN, BIC, Betrag und
        Verwendungszweck; die zahlende Person prüft und gibt die Überweisung in ihrer eigenen App frei.
      </span>
    </p>
  );
}
