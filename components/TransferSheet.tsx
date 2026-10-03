'use client';

// The transfer sheet: Erfassen · Prüfen · Freigabe · Fertig.
//
// Everything that makes filling in a transfer quicker — a recent payee, a
// saved template, a GiroCode off an invoice, a "Erneut überweisen" from a
// booking — only ever PREFILLS the form. The order itself always goes the
// one way it always went: the review step shows exactly what will be sent,
// the bank's Namensabgleich gets its own decision screen, and the approval
// happens in the banking app. Nothing here can skip a step.
//
// Launch state comes from the provider (`transferPrefill`, `closeTransfer`);
// the shell mounts this while `transferOpen` is true.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, ReactNode } from 'react';
import type { TransferPrefill, TransferTemplate } from '@/lib/app-types';
import type { SerializedAccount, SerializedVop } from '@/lib/fints-types';
import type { EpcPayment } from '@/lib/girocode';
import { fmtAmountInput, fmtDate, fmtIban, isoDate, parseAmount } from '@/lib/format';
import { sepaLength, sepaSanitize } from '@/lib/sepa-text';
import { useFints, type TransferHandlers } from './FintsProvider';
import {
  AccountTypeIcon, AlertTriangleIcon, BoltIcon, ClockIcon, QrIcon, RepeatIcon, StarIcon, UndoIcon,
} from './icons';
import { Money, formatMoney, useMoneyText } from './Money';
import { VopReport, vopNeedsAttention } from './VopResult';
import { Alert, Button, Chip, Dialog, Field, Input, Overlay, Segmented, Select, Tag, cx } from './ui';
import { GiroCodeDrop, imageFromTransfer, useFileDrop, useGiroCodeReader } from './transfer/GiroCodeDrop';
import { IbanHint, IbanInput, useBankLookup } from './transfer/IbanInput';
import { expectedLength, groupIban, ibanProblem, rawIban } from './transfer/iban';
import {
  MAX_NAME, MAX_PURPOSE, bankAnswerLines, checkAmount, findDuplicate, recentPayees, sameTemplate, shortIbanText,
  spendable, wireAmount, type TransferDraft,
} from './transfer/model';
import { Panel } from './transfer/Panel';
import { SuccessMark, SummaryList, SummaryRow, UnsureMark } from './transfer/parts';
import { BusyNote, CreditDate, ReviewStep, TemplateSaver } from './transfer/Review';
import { Stepper, TRANSFER_STEPS } from './transfer/Stepper';
import { ManageTemplates, TemplatesMenu } from './transfer/Templates';

/**
 * `awaiting` = the TAN overlay owns the screen; this sheet steps aside.
 * `vop` = the bank checked the payee name and voided its own challenge, so
 * nothing moves until the user decides whether to send it anyway.
 */
type Step = 'form' | 'review' | 'vop' | 'awaiting' | 'done' | 'unknown';

type Draft = TransferDraft;

type FieldKey = 'account' | 'name' | 'iban' | 'amount' | 'purpose';
const FIELD_ORDER: FieldKey[] = ['account', 'name', 'iban', 'amount', 'purpose'];

type Source = { kind: NonNullable<TransferPrefill['source']>; label?: string };

const STEP_INDEX: Record<Step, number> = { form: 0, review: 1, vop: 2, awaiting: 2, done: 3, unknown: 3 };

const TITLES: Record<Step, string> = {
  form: 'Überweisung',
  review: 'Überweisung prüfen',
  vop: 'Empfänger prüfen',
  awaiting: 'Freigabe',
  done: 'Überweisung ausgeführt',
  unknown: 'Status unklar',
};

const SOURCE_ICON: Record<Source['kind'], ReactNode> = {
  girocode: <QrIcon size={14} />,
  template: <StarIcon size={14} />,
  repeat: <RepeatIcon size={14} />,
  refund: <UndoIcon size={14} />,
  recent: <ClockIcon size={14} />,
};

function sourceLabel(s: Source): string {
  switch (s.kind) {
    case 'girocode': return 'Aus GiroCode übernommen';
    case 'template': return s.label ? `Vorlage: ${s.label}` : 'Aus Vorlage übernommen';
    case 'repeat': return 'Erneut überweisen';
    case 'refund': return 'Rückzahlung';
    case 'recent': return 'Letzter Empfänger';
  }
}

const clip = (s: string | null | undefined, n: number) => [...String(s ?? '')].slice(0, n).join('');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// The bank receives name and purpose rewritten to the SEPA character set
// (ä → ae, € → EUR …), and its 70/140 limits count the rewritten text. The
// fields' own maxLength only caps what can be typed; these say whether it
// fits once rewritten — the server refuses what does not, rather than cut it.
const purposeTooLong = (n: number) =>
  `Für die Bank ${n - MAX_PURPOSE === 1 ? 'ein Zeichen' : `${n - MAX_PURPOSE} Zeichen`} zu lang: `
  + 'Umlaute und Sonderzeichen werden ausgeschrieben (ä → ae, € → EUR).';
const nameTooLong = (n: number) =>
  `Für die Bank ist der Name ${n} Zeichen lang, höchstens ${MAX_NAME} gehen: `
  + 'Umlaute und Sonderzeichen werden ausgeschrieben (ä → ae).';

/** A typed amount shown back the way the field formats it on blur. */
function tidyAmount(text: string | null | undefined): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const n = parseAmount(s);
  return n != null && n > 0 ? fmtAmountInput(n) : s;
}

export function TransferSheet() {
  const {
    accounts, balances, transferPrefill, closeTransfer, submitTransfer, confirmVop, abandonVop,
    refreshAfterTransfer, range, txByAccount, activity, accountLabel, vault, vaultStatus, saveTemplate,
    touchTemplate, wait, busy, toast,
  } = useFints();
  const money = useMoneyText();
  const narrow = useNarrow();
  const eligible = useMemo(() => accounts.filter((a) => a.canTransfer), [accounts]);

  // What opened the sheet, for focus to return to. The overlay would capture
  // it itself, but it unmounts while the TAN dialog owns the screen and comes
  // back from inside that dialog — whose controls are gone a moment later.
  const [opener] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  // The prefill is read once: the sheet is mounted per launch, and a launcher
  // cannot replace a draft that is already open (openTransfer refuses).
  const [initial] = useState(() => {
    const p = transferPrefill ?? {};
    const acct = (p.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || eligible[0]?.accountNumber
      || '';
    return {
      accountNumber: acct,
      name: clip(squash(p.name ?? ''), MAX_NAME),
      iban: groupIban(rawIban(p.iban).slice(0, 34)),
      amount: tidyAmount(p.amount),
      purpose: clip(p.purpose, MAX_PURPOSE),
      instant: !!p.instant,
      source: p.source ? ({ kind: p.source } as Source) : null,
    };
  });

  const [accountNumber, setAccountNumber] = useState(initial.accountNumber);
  const [name, setName] = useState(initial.name);
  const [iban, setIban] = useState(initial.iban);
  const [amount, setAmount] = useState(initial.amount);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [instant, setInstant] = useState(initial.instant);
  const [source, setSource] = useState<Source | null>(initial.source);

  // "No red while typing": the IBAN is judged once it reaches its country's
  // length or the field is left; the amount once it is left. Submitting
  // judges everything.
  const [ibanTouched, setIbanTouched] = useState(!!initial.iban);
  const [amountTouched, setAmountTouched] = useState(!!initial.amount);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const [step, setStep] = useState<Step>('form');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** abandonVop is still telling the server to drop the parked order. */
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankAnswers, setBankAnswers] = useState<string>();
  const [vop, setVop] = useState<SerializedVop | null>(null);
  const [confirm, setConfirm] = useState<null | 'discard' | 'vop'>(null);
  const [managing, setManaging] = useState(false);
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplLabel, setTplLabel] = useState('');
  const [savedTpl, setSavedTpl] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  const account = eligible.find((a) => a.accountNumber === accountNumber);
  const canInstant = !!account?.canInstant;
  const useInstant = instant && canInstant;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ibanRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const purposeRef = useRef<HTMLInputElement>(null);
  const fieldRefs = { account: accountRef, name: nameRef, iban: ibanRef, amount: amountRef, purpose: purposeRef };

  // ---- guard: nothing to send from --------------------------------------
  const empty = eligible.length === 0;
  useEffect(() => {
    if (!empty) return;
    toast('Kein Konto unterstützt Überweisungen über FinTS.', 'error');
    closeTransfer();
  }, [empty, toast, closeTransfer]);

  // ---- derived form state -------------------------------------------------
  const raw = rawIban(iban);
  const ibanLiveProblem = raw && ibanTouched ? ibanProblem(raw, account?.iban) : null;
  const ibanError = errors.iban ?? ibanLiveProblem ?? undefined;
  const ibanOk = !!raw && !ibanProblem(raw, account?.iban);
  const bankLookup = useBankLookup(raw, ibanOk);

  const amountCheck = checkAmount(amount);
  const amountError = errors.amount ?? (amountTouched ? amountCheck.error ?? undefined : undefined);
  const purposeLen = sepaLength(purpose);
  const funds = spendable(account ? balances[account.accountNumber] : null);
  // The order is in euros; a balance in another currency can't be compared with it.
  const over = amountCheck.cents != null && funds != null && (account?.currency || 'EUR') === 'EUR'
    && amountCheck.cents > Math.round(funds.value * 100);

  const recents = useMemo(
    () => recentPayees(txByAccount, { exclude: account?.iban }),
    [txByAccount, account?.iban],
  );
  // An Umbuchung to one of your own accounts shows as that account, not as
  // your own name — "Notgroschen" says which one, "Nino Becker" does not.
  const ownByIban = useMemo(
    () => new Map(accounts.filter((a) => a.iban).map((a) => [rawIban(a.iban), a] as const)),
    [accounts],
  );

  const snapshot = `${accountNumber}|${name}|${raw}|${amount}|${purpose}|${useInstant}`;
  const [initialSnapshot] = useState(snapshot);
  const dirty = step === 'review' || (step === 'form' && snapshot !== initialSnapshot);

  // ---- step changes: move focus to the new heading, say where we are ----
  const prevStep = useRef<Step>(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    if (step === 'awaiting') return;
    titleRef.current?.focus({ preventScroll: true });
    setLive(`Schritt ${STEP_INDEX[step] + 1} von ${TRANSFER_STEPS.length}: ${TITLES[step]}`);
  }, [step]);

  // The bank's refusal lands under the summary, just above the buttons — on
  // a short window that is below the fold, so it is brought into view. A
  // smooth scroll asked for from script overrides the CSS reduced-motion
  // rule, so the preference is read here.
  useEffect(() => {
    if (!error) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [error]);

  // ---- a TAN wait that ends without telling us how ------------------------
  // Every way out of the approval normally calls one of the handlers. Should
  // the overlay close without one (an error the user dismissed), the order's
  // fate is unknown — say so, rather than leave an invisible sheet that
  // would block every later transfer.
  const sawWait = useRef(false);
  useEffect(() => {
    if (step !== 'awaiting') { sawWait.current = false; return; }
    if (wait.open) { sawWait.current = true; return; }
    if (!sawWait.current) return;
    const t = setTimeout(() => setStep((s) => (s === 'awaiting' ? 'unknown' : s)), 400);
    return () => clearTimeout(t);
  }, [step, wait.open]);

  // ---- filling the form ---------------------------------------------------
  const fillPayee = useCallback((
    next: { name: string; iban: string; amount?: string; purpose?: string; instant?: boolean },
    from: Source | null,
    whole: boolean,
  ) => {
    const r = rawIban(next.iban).slice(0, 34);
    setName(clip(squash(next.name), MAX_NAME));
    setIban(groupIban(r));
    setIbanTouched(!!r);
    if (whole) {
      // A template or a code describes the whole payment: what it leaves
      // out is cleared, so no amount from an earlier attempt rides along.
      setAmount(tidyAmount(next.amount));
      setAmountTouched(!!next.amount);
      setPurpose(clip(next.purpose, MAX_PURPOSE));
      if (next.instant !== undefined) setInstant(next.instant);
    }
    setErrors({});
    setSource(from);
  }, []);

  const fromGiroCode = useCallback((p: EpcPayment) => {
    fillPayee({
      name: p.name,
      iban: p.iban,
      amount: p.amount != null ? fmtAmountInput(p.amount) : '',
      // A structured creditor reference has no field of its own in this
      // form; banks accept it as the remittance text.
      purpose: p.purpose ?? p.reference ?? '',
    }, { kind: 'girocode' }, true);
    setLive(`GiroCode übernommen: ${p.name}${p.amount != null ? `, ${formatMoney(p.amount)}` : ''}.`);
    // Straight on to what the code could not say.
    requestAnimationFrame(() => (p.amount == null ? amountRef : nameRef).current?.focus());
  }, [fillPayee]);

  const reader = useGiroCodeReader(fromGiroCode);
  const drop = useFileDrop(step === 'form', (f) => void reader.readFile(f));

  const applyTemplate = (t: TransferTemplate) => {
    fillPayee(
      { name: t.name, iban: t.iban, amount: t.amount, purpose: t.purpose, instant: !!t.instant },
      { kind: 'template', label: t.label },
      true,
    );
    touchTemplate(t.id);
    reader.reset();
    setLive(`Vorlage „${t.label}“ übernommen.`);
  };

  // Strg+V anywhere in the form: an image (a screenshot of an invoice) or a
  // GiroCode's raw text. Ordinary text pastes into fields pass through.
  const onPaste = (e: ClipboardEvent) => {
    if (step !== 'form' || e.defaultPrevented) return;
    const text = e.clipboardData.getData('text/plain');
    // Copying from a web page can put an image AND text on the clipboard;
    // pasted into a field, the text is what was meant.
    const inField = e.target instanceof Element && !!e.target.closest('input, textarea, [contenteditable="true"]');
    const image = inField && text.trim() ? null : imageFromTransfer(e.clipboardData);
    if (image) {
      e.preventDefault();
      void reader.readFile(image);
      return;
    }
    if (text && reader.readText(text)) e.preventDefault();
  };

  // ---- Erfassen → Prüfen --------------------------------------------------
  const toReview = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<FieldKey, string>> = {};
    if (!account) next.account = 'Bitte wähle das Konto, von dem du überweist.';
    const sentName = sepaSanitize(name);
    if (!name.trim()) next.name = 'Bitte gib den Namen des Empfängers an.';
    else if (!sentName) next.name = 'Der Name besteht nur aus Zeichen, die eine Überweisung nicht übertragen kann.';
    else if (sentName.length > MAX_NAME) next.name = nameTooLong(sentName.length);
    const ip = ibanProblem(raw, account?.iban);
    if (ip) next.iban = ip;
    const a = checkAmount(amount);
    if (a.cents == null) next.amount = a.error ?? 'Bitte gib den Betrag an.';
    if (purposeLen > MAX_PURPOSE) next.purpose = purposeTooLong(purposeLen);
    setErrors(next);
    setIbanTouched(true);
    setAmountTouched(true);
    const first = FIELD_ORDER.find((k) => next[k]);
    if (first || !account || a.cents == null) {
      if (first) fieldRefs[first].current?.focus();
      const n = Object.keys(next).length;
      setLive(n === 1 ? 'Bitte prüfe das markierte Feld.' : `Bitte prüfe die ${n} markierten Felder.`);
      return;
    }
    setAmount(fmtAmountInput(a.cents / 100));
    setDraft({
      accountNumber: account.accountNumber,
      name: squash(name),
      iban: raw,
      cents: a.cents,
      purpose: squash(purpose),
      instant: useInstant,
    });
    setError(null);
    if (!tplLabel) setTplLabel(clip(squash(name), 60));
    setStep('review');
  };

  // ---- the order ------------------------------------------------------------
  // What onExecuted needs, read when it finally fires — after an approval
  // that may take minutes, long after the render that sent the order.
  const later = useRef({ saveTemplate, vaultStatus });
  later.current = { saveTemplate, vaultStatus };
  const templateIntent = useRef<{ label: string; draft: Draft } | null>(null);

  const existingTemplate = useMemo(() => (draft
    ? (vault?.templates ?? []).find((t) => sameTemplate(t, {
      name: draft.name, iban: draft.iban, amount: fmtAmountInput(draft.cents / 100), purpose: draft.purpose,
    })) ?? null
    : null), [draft, vault?.templates]);

  const handlers: TransferHandlers = {
    onTanStarted: () => { setSubmitting(false); setStep('awaiting'); },
    onExecuted: (answers?: string) => {
      setSubmitting(false);
      setBankAnswers(answers);
      setStep('done');
      // Saved only now: a template should be a payee the bank has accepted,
      // not a name the Namensabgleich just flagged.
      const intent = templateIntent.current;
      templateIntent.current = null;
      const l = later.current;
      if (intent && l.vaultStatus === 'ready') {
        l.saveTemplate({
          label: intent.label,
          name: intent.draft.name,
          iban: intent.draft.iban,
          amount: fmtAmountInput(intent.draft.cents / 100),
          purpose: intent.draft.purpose || undefined,
          instant: intent.draft.instant || undefined,
        });
        setSavedTpl(intent.label);
      }
    },
    onUnknown: () => { setSubmitting(false); setStep('unknown'); },
    onError: (message: string) => { setSubmitting(false); setError(message); },
    onVop: (result: SerializedVop) => { setSubmitting(false); setVop(result); setStep('vop'); },
  };

  const send = () => {
    if (!draft || submitting || settling) return;
    setError(null);
    setSubmitting(true);
    templateIntent.current = saveTpl && vaultStatus === 'ready' && !existingTemplate
      ? { label: clip(squash(tplLabel) || draft.name, 60), draft }
      : null;
    void submitTransfer(
      {
        accountNumber: draft.accountNumber,
        recipientName: draft.name,
        iban: draft.iban,
        amount: wireAmount(draft.cents),
        purpose: draft.purpose,
        instant: draft.instant,
      },
      handlers,
    );
  };

  /** Send it anyway — the bank's payee-name check has been seen and accepted. */
  const sendDespiteVop = () => {
    if (submitting || settling) return;
    setError(null);
    setSubmitting(true);
    void confirmVop(handlers);
  };

  /** Tell the server to drop the parked order; nothing new is sent until it has. */
  const settleVop = () => {
    setSettling(true);
    void abandonVop().finally(() => setSettling(false));
    setVop(null);
  };

  /** Drop the parked order. The form keeps its values, so a flagged payee
   *  name can simply be corrected and sent again. */
  const dropVop = () => {
    settleVop();
    setError(null);
    setStep('form');
  };

  /** Take the name the bank holds and check again — a new order, a new Namensabgleich. */
  const adoptSuggested = (suggested: string) => {
    const next = clip(squash(suggested), MAX_NAME);
    settleVop();
    setName(next);
    setSource(null);
    setDraft((d) => (d ? { ...d, name: next } : d));
    setError(null);
    setStep('review');
  };

  const closeAfterVop = () => {
    void abandonVop();
    closeTransfer();
  };

  /** Re-read the account the money left, up to today, so the new booking can
   *  show. Explicit: it is a bank call and may need its own approval. */
  const refreshStatements = () => {
    const acct = accounts.find((a) => a.accountNumber === draft?.accountNumber);
    closeTransfer();
    if (acct) refreshAfterTransfer(acct);
  };

  const requestClose = () => {
    if (submitting) return;
    if (step === 'vop') { setConfirm('vop'); return; }
    if (dirty) { setConfirm('discard'); return; }
    closeTransfer();
  };

  // While the bank waits for approval the TAN overlay owns the screen. The
  // sheet stays mounted (the draft must survive) but renders nothing, then
  // comes back with the result.
  if (empty || step === 'awaiting') return null;

  const answerLines = bankAnswerLines(bankAnswers);
  const draftAccount = draft ? eligible.find((a) => a.accountNumber === draft.accountNumber) ?? account : account;
  // A range that ended before today cannot hold this transfer's booking; the
  // refresh then reads up to today instead, and the result step says so.
  const pastRange = range.to < isoDate(new Date());
  const result = step === 'done' || step === 'unknown';

  return (
    <Overlay
      open
      onClose={submitting ? undefined : requestClose}
      labelledBy="transfer-title"
      returnFocus={opener}
      // Coming back from the TAN dialog, the sheet opens on its result: the
      // heading says what happened, so that is where focus starts.
      initialFocus={result ? titleRef : undefined}
    >
      <Panel
        titleId="transfer-title"
        titleRef={titleRef}
        title={TITLES[step]}
        onClose={requestClose}
        closeDisabled={submitting}
        headerExtra={<Stepper current={STEP_INDEX[step]} unsure={step === 'unknown'} />}
        onPaste={onPaste}
        {...drop.handlers}
        footer={
          step === 'form' ? (
            <FooterRow>
              <Button className="flex-1" onClick={requestClose}>Abbrechen</Button>
              <Button type="submit" form="transfer-form" variant="primary" className="flex-[2]">Weiter zur Prüfung</Button>
            </FooterRow>
          ) : step === 'review' ? (
            <FooterRow>
              <Button className="flex-1" disabled={submitting} onClick={() => { setError(null); setStep('form'); }}>Zurück</Button>
              <Button
                variant="primary"
                className="flex-[2]"
                busy={submitting || settling}
                disabled={busy && !submitting}
                onClick={send}
              >
                Jetzt überweisen
              </Button>
            </FooterRow>
          ) : step === 'vop' && vop ? (
            <FooterRow>
              <Button className="flex-1" disabled={submitting} onClick={dropVop}>Zurück</Button>
              <Button
                variant="primary"
                className="flex-[2]"
                busy={submitting}
                disabled={busy && !submitting}
                onClick={sendDespiteVop}
              >
                {vopNeedsAttention(vop) ? 'Trotzdem überweisen' : 'Überweisung freigeben'}
              </Button>
            </FooterRow>
          ) : step === 'done' || step === 'unknown' ? (
            <FooterRow>
              <Button className="flex-1" onClick={refreshStatements} disabled={busy}>Umsätze aktualisieren</Button>
              <Button variant="primary" className="flex-1" onClick={closeTransfer}>
                {step === 'done' ? 'Fertig' : 'Schließen'}
              </Button>
            </FooterRow>
          ) : null
        }
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">{live}</p>

        {step === 'form' && (
          <form id="transfer-form" onSubmit={toReview} noValidate className="pt-1">
            <Field label="Von Konto" htmlFor="tf-account" error={errors.account}>
              <Select
                id="tf-account"
                ref={accountRef}
                value={accountNumber}
                onChange={(e) => { setAccountNumber(e.target.value); setErrors((x) => ({ ...x, account: undefined })); }}
              >
                {eligible.map((a) => (
                  <option key={a.accountNumber} value={a.accountNumber}>
                    {accountOption(a, accountLabel(a), narrow ? null : spendable(balances[a.accountNumber]), money)}
                  </option>
                ))}
              </Select>
            </Field>

            <section aria-labelledby="tf-payee" className="mt-7">
              <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                <h3 id="tf-payee" className="text-[16px] font-bold text-ink">Empfänger</h3>
                <TemplatesMenu onPick={applyTemplate} onManage={() => setManaging(true)} />
              </div>

              {source && (
                <p className="mb-4">
                  <Tag tone="info" icon={SOURCE_ICON[source.kind]}>{sourceLabel(source)}</Tag>
                </p>
              )}

              {recents.length > 0 && (
                <div className="mb-4">
                  <p id="tf-recent" className="mb-2 text-[13px] font-semibold text-ink-3">Letzte Empfänger</p>
                  <div
                    role="group"
                    aria-labelledby="tf-recent"
                    className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
                  >
                    {recents.map((r) => {
                      const own = ownByIban.get(r.iban);
                      return (
                        <Chip
                          key={r.iban}
                          className="max-w-[230px]"
                          icon={own ? <AccountTypeIcon type={own.accountType} product={own.product} size={16} /> : undefined}
                          title={`${own ? 'Eigenes Konto · ' : ''}${r.name} · ${fmtIban(r.iban)}`}
                          selected={raw === r.iban && squash(name) === r.name}
                          onClick={() => {
                            fillPayee({ name: r.name, iban: r.iban }, null, false);
                            reader.reset();
                            requestAnimationFrame(() => amountRef.current?.focus());
                          }}
                        >
                          {own ? accountLabel(own) : r.name}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              )}

              <GiroCodeDrop className="mb-5" scan={reader.scan} dragging={drop.dragging} onFile={(f) => void reader.readFile(f)} />

              <Field label="Name" htmlFor="tf-name" error={errors.name}>
                <Input
                  id="tf-name"
                  ref={nameRef}
                  data-autofocus={!initial.name ? true : undefined}
                  maxLength={MAX_NAME}
                  value={name}
                  autoComplete="off"
                  onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }}
                  placeholder="Vor- und Nachname oder Firma"
                />
              </Field>

              <Field
                label="IBAN"
                htmlFor="tf-iban"
                error={ibanError}
                hint={ibanError ? undefined : <IbanHint raw={raw} ok={ibanOk} lookup={bankLookup} />}
                className="mb-0"
              >
                <IbanInput
                  id="tf-iban"
                  inputRef={ibanRef}
                  data-autofocus={initial.name && !initial.iban ? true : undefined}
                  value={iban}
                  onValueChange={(v) => {
                    setIban(v);
                    setErrors((x) => ({ ...x, iban: undefined }));
                    const r = rawIban(v);
                    const len = expectedLength(r);
                    setIbanTouched(len != null && r.length >= len);
                  }}
                  onBlur={() => { if (raw) setIbanTouched(true); }}
                  placeholder="DE00 0000 0000 0000 0000 00"
                />
              </Field>
            </section>

            <section aria-labelledby="tf-payment" className="mt-7">
              <h3 id="tf-payment" className="mb-3 text-[16px] font-bold text-ink">Zahlung</h3>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field
                  label="Betrag"
                  htmlFor="tf-amount"
                  error={amountError}
                  hint={amountError || !funds ? undefined : (
                    <span className="flex flex-col gap-1">
                      <span>
                        {funds.kind === 'available' ? 'Verfügbar' : 'Kontostand'}{' '}
                        <Money value={funds.value} currency={account?.currency} className="font-semibold text-ink-2" />
                      </span>
                      {over && (
                        <span className="flex items-start gap-1.5 text-ink-2">
                          <AlertTriangleIcon size={15} className="mt-0.5 text-emphasis" />
                          <span>
                            Mehr als {funds.kind === 'available' ? 'verfügbar' : 'dein Kontostand'} – die Bank kann den Auftrag ablehnen.
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                >
                  <Input
                    id="tf-amount"
                    ref={amountRef}
                    data-autofocus={initial.name && initial.iban && !initial.amount ? true : undefined}
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setErrors((x) => ({ ...x, amount: undefined }));
                      setAmountTouched(false);
                    }}
                    onBlur={(e) => {
                      const text = e.currentTarget.value;
                      if (!text.trim()) return;
                      setAmountTouched(true);
                      const a = checkAmount(text);
                      if (a.cents != null) setAmount(fmtAmountInput(a.cents / 100));
                    }}
                    placeholder="0,00"
                    className="amount text-right text-[20px] font-semibold"
                    trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">€</span>}
                  />
                </Field>

                <div className="mb-4 flex flex-col gap-1.5">
                  <span className="text-[13px] leading-snug font-semibold text-ink-2" aria-hidden>Ausführung</span>
                  <Segmented
                    aria-label="Ausführung"
                    block
                    className="h-12 items-center"
                    value={useInstant ? 'instant' : 'standard'}
                    onChange={(v) => setInstant(v === 'instant')}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'instant', label: 'Echtzeit', icon: <BoltIcon size={16} />, disabled: !canInstant },
                    ]}
                  />
                  <p className="text-[13px] leading-snug text-ink-3">
                    {!canInstant
                      ? 'Echtzeit bietet deine Bank für dieses Konto nicht über FinTS an.'
                      : useInstant
                        ? 'In Sekunden beim Empfänger, rund um die Uhr.'
                        : <CreditDate short />}
                  </p>
                </div>
              </div>

              <Field
                label="Verwendungszweck"
                htmlFor="tf-purpose"
                optional
                className="mb-1"
                // Counted the way the bank counts: after ä → ae and the like.
                // Too long is said at once, not only on "Weiter" — a
                // GiroCode can fill in a purpose that does not fit.
                error={errors.purpose ?? (purposeLen > MAX_PURPOSE ? purposeTooLong(purposeLen) : undefined)}
                trailing={(
                  <span
                    aria-hidden
                    className={cx(
                      'tnum text-[12.5px]',
                      purposeLen > MAX_PURPOSE ? 'font-semibold text-red'
                        : purposeLen >= MAX_PURPOSE ? 'font-semibold text-ink-2' : 'text-ink-3',
                    )}
                  >
                    {purposeLen}/{MAX_PURPOSE}
                  </span>
                )}
                hint={purposeLen > MAX_PURPOSE || purposeLen < MAX_PURPOSE - 10 ? undefined : (
                  `Noch ${MAX_PURPOSE - purposeLen} Zeichen.${sepaSanitize(purpose) !== squash(purpose) ? ' Umlaute und Sonderzeichen zählen ausgeschrieben (ä → ae).' : ''}`
                )}
              >
                <Input
                  id="tf-purpose"
                  ref={purposeRef}
                  maxLength={MAX_PURPOSE}
                  value={purpose}
                  autoComplete="off"
                  onChange={(e) => { setPurpose(e.target.value); setErrors((x) => ({ ...x, purpose: undefined })); }}
                  placeholder="z. B. Rechnung 2026-118"
                />
              </Field>
            </section>
          </form>
        )}

        {step === 'review' && draft && draftAccount && (
          <ReviewStep
            draft={draft}
            account={draftAccount}
            accountName={accountLabel(draftAccount)}
            bank={bankLookup?.status === 'found' && raw === draft.iban ? bankLookup.bank : null}
            funds={spendable(balances[draft.accountNumber])}
            duplicate={findDuplicate({
              iban: draft.iban, cents: draft.cents, name: draft.name, txByAccount, activity, fmt: (v) => formatMoney(v),
            })?.sentence ?? null}
            saveSlot={(
              <TemplateSaver
                status={vaultStatus}
                existing={existingTemplate?.label ?? null}
                checked={saveTpl}
                onChecked={setSaveTpl}
                label={tplLabel}
                onLabel={setTplLabel}
              />
            )}
            busyElsewhere={busy && !submitting}
            error={error}
            errorRef={errorRef}
          />
        )}

        {step === 'vop' && vop && draft && (
          <div className="pt-1">
            <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
              Die Bank hat den Empfängernamen mit dem Namen zur IBAN abgeglichen. Prüfe das Ergebnis, bevor du{' '}
              <Money value={draft.cents / 100} masked={false} className="font-semibold text-ink" /> freigibst.
            </p>
            <VopReport vop={vop} className="mb-4" />
            {vop.verdict === 'CLOSE_MATCH' && vop.suggestedName
              // Compared as sent: "Müller" was checked as "Mueller", so a
              // suggestion that differs only in its umlauts changes nothing.
              && sepaSanitize(vop.suggestedName) !== sepaSanitize(draft.name) && (
              <Button
                variant="tertiary"
                size="sm"
                className="-ml-4 mb-3"
                disabled={submitting}
                onClick={() => adoptSuggested(vop.suggestedName!)}
              >
                „{vop.suggestedName}“ übernehmen und neu prüfen
              </Button>
            )}
            {vopNeedsAttention(vop) && (
              <p className="text-[13.5px] leading-snug text-ink-2">
                Gibst du die Überweisung trotz Abweichung frei, trägst du das Risiko, dass das Geld beim falschen Empfänger ankommt.
              </p>
            )}
            {busy && !submitting && <BusyNote />}
            {error && <div ref={errorRef} className="scroll-mb-6"><Alert>{error}</Alert></div>}
          </div>
        )}

        {step === 'done' && draft && (
          <div className="flex flex-col items-center pt-2 text-center">
            <SuccessMark />
            <p className="mt-5 text-[17px] leading-snug text-ink">
              <Money value={draft.cents / 100} masked={false} className="text-[24px] font-bold text-headline" />
              <span className="mt-1 block break-words">an {sepaSanitize(draft.name)}</span>
            </p>
            <p className="mt-2 text-[14px] text-ink-2">
              {draft.instant ? (
                <>
                  <BoltIcon size={15} className="mr-1 inline-block align-[-2px]" />
                  Echtzeitüberweisung – in Sekunden beim Empfänger.
                </>
              ) : (
                <CreditDate />
              )}
            </p>
            {savedTpl && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] text-ink-2">
                <StarIcon size={15} className="text-accent" />
                Als Vorlage „{savedTpl}“ gespeichert.
              </p>
            )}
            {answerLines.length > 0 && (
              <figure className="mt-5 w-full text-left">
                <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">Antwort deiner Bank</figcaption>
                <ul className="rounded-[10px] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words text-ink">
                  {answerLines.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </figure>
            )}
            <p className="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-3">
              Die Buchung erscheint in deinen Umsätzen, sobald die Bank sie meldet.{' '}
              {pastRange ? (
                <>
                  Dein gewählter Zeitraum endet am {fmtDate(range.to)} – „Umsätze aktualisieren“ lädt die Umsätze bis heute.
                  Das kann eine Freigabe erfordern.
                </>
              ) : (
                <>„Umsätze aktualisieren“ ruft sie neu ab – das kann eine Freigabe erfordern.</>
              )}
            </p>
          </div>
        )}

        {step === 'unknown' && (
          <div className="flex flex-col items-center pt-2 text-center">
            <UnsureMark />
            <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-ink">
              Für diese Überweisung liegt keine Bestätigung vor. Sie kann trotzdem bei deiner Bank angekommen sein und
              ausgeführt werden.
            </p>
            <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">
              Bevor du sie erneut sendest: Prüfe deine Umsätze und die vorgemerkten Umsätze oder schau in deiner
              Banking-App nach.
            </p>
            {draft && (
              <SummaryList className="mt-5 w-full border-y border-line text-left">
                <SummaryRow label="Betrag"><Money value={draft.cents / 100} masked={false} className="font-semibold" /></SummaryRow>
                <SummaryRow label="Empfänger">{sepaSanitize(draft.name)}</SummaryRow>
                <SummaryRow label="IBAN"><span className="iban text-[14px]">{fmtIban(draft.iban)}</span></SummaryRow>
              </SummaryList>
            )}
            {pastRange && (
              <p className="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-3">
                Dein gewählter Zeitraum endet am {fmtDate(range.to)} – „Umsätze aktualisieren“ lädt die Umsätze bis heute.
                Das kann eine Freigabe erfordern.
              </p>
            )}
          </div>
        )}
      </Panel>

      {managing && <ManageTemplates onClose={() => setManaging(false)} />}
      {confirm === 'discard' && (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title="Eingaben verwerfen?"
          description="Die Überweisung wurde noch nicht gesendet. Was du eingegeben hast, geht verloren."
          actions={(
            <>
              <Button data-autofocus onClick={() => setConfirm(null)}>Weiter bearbeiten</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); closeTransfer(); }}>Verwerfen</Button>
            </>
          )}
        />
      )}
      {confirm === 'vop' && (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title="Überweisung abbrechen?"
          description="Der Auftrag liegt geprüft bei deiner Bank, ist aber nicht freigegeben. Beim Abbrechen wird er verworfen – es wird kein Geld überwiesen."
          actions={(
            <>
              <Button data-autofocus onClick={() => setConfirm(null)}>Weiter prüfen</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); closeAfterVop(); }}>Abbrechen</Button>
            </>
          )}
        />
      )}
    </Overlay>
  );
}

// ---------------------------------------------------------------------------

/**
 * Below 640px. A native <option> is one unstyled line, and on a phone the
 * full "Konto · IBAN · Verfügbar" no longer fits — there the figure moves to
 * the hint under the amount, where it is shown anyway.
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}

function FooterRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-3">{children}</div>;
}

/** "Girokonto · DE78 ··· 5932 71 · Verfügbar 2.196,22 €" — one line, as a native option must be. */
function accountOption(
  a: SerializedAccount,
  label: string,
  funds: ReturnType<typeof spendable>,
  money: (v: number, c?: string) => string,
): string {
  const parts = [label, shortIbanText(a.iban)];
  if (funds) parts.push(`${funds.kind === 'available' ? 'Verfügbar' : 'Kontostand'} ${money(funds.value, a.currency)}`);
  return parts.filter(Boolean).join(' · ');
}
