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
// It ends in one of three outcome words, each with its own screen: ausgeführt
// (the bank confirmed), abgelehnt (the bank refused — nothing moved, the order
// may be corrected), or unklar (nobody can say yet — never offered for
// sending again, only for checking).
//
// Launch state comes from the provider (`transferPrefill`, `closeTransfer`);
// the shell mounts this while `transferOpen` is true.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, FormEvent, ReactNode } from 'react';
import type { TransferPrefill, TransferTemplate } from '@/lib/app-types';
import { isCardAccount } from '@/lib/balances';
import { bankAnswerLines, formatBankAnswer, refusalReference } from '@/lib/bank-answer';
import type { SerializedAccount, SerializedVop } from '@/lib/fints-types';
import type { EpcPayment } from '@/lib/girocode';
import { fmtAmountInput, fmtDate, fmtIban, fmtShortIban, isoDate, parseAmount } from '@/lib/format';
import { msgs, type Messages } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { sepaLength, sepaSanitize } from '@/lib/sepa-text';
import { findDuplicate, findSentTransfer, fundsWarning, spendable, type FundsWarning } from '@/lib/transfer-checks';
import { useFints, type TransferHandlers } from './FintsProvider';
import {
  AccountTypeIcon, AlertTriangleIcon, BoltIcon, ClockIcon, InfoIcon, QrIcon, RepeatIcon, StarIcon, UndoIcon,
} from './icons';
import { Money, formatMoney, useMoneyText } from './Money';
import { VopReport, vopDeviates, vopUnchecked } from './VopResult';
import { Alert, Button, Chip, Dialog, Field, Input, Overlay, Segmented, Select, Spinner, cx } from './ui';
import { GiroCodeDrop, imageFromTransfer, useFileDrop, useGiroCodeReader } from './transfer/GiroCodeDrop';
import { IbanHint, IbanInput, useBankLookup } from './transfer/IbanInput';
import { expectedLength, groupIban, ibanProblem, rawIban } from './transfer/iban';
import {
  MAX_NAME, MAX_PURPOSE, checkAmount, recentPayees, shortIbanText, wireAmount, type TransferDraft,
} from './transfer/model';
import { Panel } from './transfer/Panel';
import { RefusedMark, SuccessMark, SummaryList, SummaryRow, UnsureMark } from './transfer/parts';
import {
  BusyNote, CreditDate, FundsWarningText, REVIEW_WARNINGS_ID, ReviewStep, StepError,
} from './transfer/Review';
import { Stepper, TRANSFER_STEPS } from './transfer/Stepper';
import { ManageTemplates, SaveAsTemplate, TemplatesMenu } from './transfer/Templates';

/**
 * `awaiting` = the TAN overlay owns the screen; this sheet steps aside.
 * `vop` = the bank checked the payee name and voided its own challenge, so
 * nothing moves until the user decides whether to send it anyway.
 * `refused` = the bank refused the order, before or after the approval.
 */
type Step = 'form' | 'review' | 'vop' | 'awaiting' | 'done' | 'unknown' | 'refused';

type Draft = TransferDraft;

type FieldKey = 'account' | 'name' | 'iban' | 'amount' | 'purpose';
const FIELD_ORDER: FieldKey[] = ['account', 'name', 'iban', 'amount', 'purpose'];

type Source = { kind: NonNullable<TransferPrefill['source']>; label?: string };

// A refusal stops at "Freigabe": the bank cleared nothing, and "Fertig" was
// never reached.
const STEP_INDEX: Record<Step, number> = { form: 0, review: 1, vop: 2, awaiting: 2, refused: 2, done: 3, unknown: 3 };

/** The sheet's heading on a step. */
function stepTitle(tr: Messages, step: Step): string {
  if (step === 'awaiting') return tr.common.approval;
  if (step === 'unknown') return tr.common.statusUnclear;
  return tr.transfer.titles[step];
}

const SOURCE_ICON: Record<Source['kind'], ReactNode> = {
  girocode: <QrIcon size={14} />,
  template: <StarIcon size={14} />,
  repeat: <RepeatIcon size={14} />,
  refund: <UndoIcon size={14} />,
  recent: <ClockIcon size={14} />,
};

function sourceLabel(tr: Messages, s: Source): string {
  const words = tr.transfer.source;
  switch (s.kind) {
    case 'girocode': return words.girocode;
    case 'template': return s.label ? words.template(s.label) : words.templateUnnamed;
    case 'repeat': return words.repeat;
    case 'refund': return words.refund;
    case 'recent': return words.recent;
  }
}

/**
 * An announcement for the live region. State keeps how to say it, not the
 * words: they are worked out in the language on screen when it is shown.
 */
type Say = { say: (m: Messages) => string };

const clip = (s: string | null | undefined, n: number) => [...String(s ?? '')].slice(0, n).join('');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** "13:12 Uhr" ("13:12"). */
const fmtTime = (tr: Messages, d: Date) => tr.transfer.clock(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
/** "13:12 Uhr" today, "03.10.2026, 18:40 Uhr" any other day. */
const fmtWhen = (tr: Messages, t: number) => {
  const d = new Date(t);
  return isoDate(d) === isoDate(new Date()) ? fmtTime(tr, d) : `${fmtDate(d)}, ${fmtTime(tr, d)}`;
};

// The bank receives name and purpose rewritten to the SEPA character set
// (ä → ae, € → EUR …), and its 70/140 limits count the rewritten text. The
// fields' own maxLength only caps what can be typed; the form's checks
// (formProblems, the purpose field's own error) say whether it fits once
// rewritten — the server refuses what does not, rather than cut it.

/**
 * What "Weiter zur Prüfung" refuses, field by field, in words. The sheet
 * keeps only which fields were flagged; the words are worked out where they
 * are shown, from the values as they stand — which have not changed since,
 * or the flag would be gone.
 */
function formProblems(tr: Messages, f: {
  account: SerializedAccount | undefined;
  name: string;
  raw: string;
  amount: string;
  purposeLen: number;
}): Partial<Record<FieldKey, string>> {
  const words = tr.transfer;
  const out: Partial<Record<FieldKey, string>> = {};
  if (!f.account) out.account = words.form.chooseAccount;
  const sentName = sepaSanitize(f.name);
  if (!f.name.trim()) out.name = words.nameMissing;
  else if (!sentName) out.name = words.form.nameUnsendable;
  else if (sentName.length > MAX_NAME) out.name = words.form.nameTooLong(sentName.length, MAX_NAME);
  const ip = ibanProblem(f.raw, f.account?.iban);
  if (ip) out.iban = ip;
  const a = checkAmount(f.amount);
  if (a.cents == null) out.amount = a.error ?? words.form.amountMissing;
  if (f.purposeLen > MAX_PURPOSE) out.purpose = words.form.purposeTooLong(f.purposeLen - MAX_PURPOSE);
  return out;
}

/** A typed amount shown back the way the field formats it on blur. */
function tidyAmount(text: string | null | undefined): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const n = parseAmount(s);
  return n != null && n > 0 ? fmtAmountInput(n) : s;
}

/**
 * "Jetzt nachsehen" on an unclear order: the account's Umsätze are read
 * again, then its Vorgemerkte where the account has them — each through the
 * provider's own loads, each perhaps with an approval of its own. A stage is
 * over when its list has landed (newer than the stage) or when the line falls
 * quiet without it (refused, failed, cancelled).
 */
type Check =
  | { stage: 'statements'; startedAt: number }
  // statements: null — the account has no Umsätze over FinTS to read (a
  // statement load for it settles at once, without going busy).
  | { stage: 'pending'; startedAt: number; statements: boolean | null }
  | { stage: 'done'; at: number; statements: boolean | null; pending: boolean | null };

export function TransferSheet() {
  const {
    accounts, balances, transferPrefill, closeTransfer, submitTransfer, confirmVop, abandonVop,
    refreshAfterTransfer, loadPending, range, txByAccount, pendingCache, pendingInfo, statementInfo, activity,
    accountLabel, vault, touchTemplate, wait, busy, toast,
  } = useFints();
  const tr = useT();
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
  /** The fields "Weiter" found fault with, until each is edited (formProblems says what). */
  const [flagged, setFlagged] = useState<Partial<Record<FieldKey, boolean>>>({});

  const [step, setStep] = useState<Step>('form');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** abandonVop is still telling the server to drop the parked order. */
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The bank's answer on the done, unknown and refused steps (codes included; shown without). */
  const [bankAnswers, setBankAnswers] = useState<string>();
  const [vop, setVop] = useState<SerializedVop | null>(null);
  /** When the order went to the bank (epoch ms) — the time "Status unklar" names and searches from. */
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [confirm, setConfirm] = useState<null | 'discard' | 'vop'>(null);
  const [managing, setManaging] = useState(false);
  const [live, setLive] = useState<Say | null>(null);
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
    toast(msgs().transfer.noAccount, 'error');
    closeTransfer();
  }, [empty, toast, closeTransfer]);

  // ---- derived form state -------------------------------------------------
  const raw = rawIban(iban);
  const purposeLen = sepaLength(purpose);
  const problems = formProblems(tr, { account, name, raw, amount, purposeLen });
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const k of FIELD_ORDER) if (flagged[k]) errors[k] = problems[k];
  const ibanLiveProblem = raw && ibanTouched ? ibanProblem(raw, account?.iban) : null;
  const ibanError = errors.iban ?? ibanLiveProblem ?? undefined;
  const ibanOk = !!raw && !ibanProblem(raw, account?.iban);
  const bankLookup = useBankLookup(raw, ibanOk);

  const amountCheck = checkAmount(amount);
  const amountError = errors.amount ?? (amountTouched ? amountCheck.error ?? undefined : undefined);
  const funds = spendable(account ? balances[account.accountNumber] : null);
  // More than the account can spend, or into the Dispo — the same reading on
  // Erfassen (as the amount is typed) and on Prüfen.
  const formWarning = account && amountCheck.cents != null
    ? fundsWarning(balances[account.accountNumber], amountCheck.cents, {
      currency: account.currency, overdraft: !isCardAccount(account),
    })
    : null;

  const recents = useMemo(
    () => recentPayees(txByAccount, { exclude: account?.iban }),
    [txByAccount, account?.iban],
  );
  // Two recent payees of the same name get their IBAN's tail, or they would
  // be two identical chips.
  const sharedNames = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of recents) count.set(r.name, (count.get(r.name) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [recents]);
  // An Umbuchung to one of your own accounts shows as that account, not as
  // your own name — "Notgroschen" says which one, "Nino Becker" does not.
  const ownByIban = useMemo(
    () => new Map(accounts.filter((a) => a.iban).map((a) => [rawIban(a.iban), a] as const)),
    [accounts],
  );

  const snapshot = `${accountNumber}|${name}|${raw}|${amount}|${purpose}|${useInstant}`;
  const [initialSnapshot] = useState(snapshot);
  const dirty = step === 'review' || (step === 'form' && snapshot !== initialSnapshot);

  // ---- the review step's second looks -------------------------------------
  const draftAccount = draft ? eligible.find((a) => a.accountNumber === draft.accountNumber) ?? account : account;
  const sentOrders = vault?.sentOrders;
  // The check, not its words: the sentence is worded when it is read
  // (lib/transfer-checks.ts), in the language on screen.
  const duplicateCheck = useMemo(() => (draft
    ? findDuplicate({
      iban: draft.iban,
      cents: draft.cents,
      name: draft.name,
      activity,
      sent: sentOrders ?? [],
      pending: pendingCache,
      txByAccount,
      fmt: (v) => formatMoney(v),
    })
    : null), [draft, activity, sentOrders, pendingCache, txByAccount]);
  const duplicate = duplicateCheck?.sentence ?? null;
  const reviewWarning: FundsWarning | null = draft && draftAccount
    ? fundsWarning(balances[draft.accountNumber], draft.cents, {
      currency: draftAccount.currency, overdraft: !isCardAccount(draftAccount),
    })
    : null;
  // The commit names the risk it takes: a hint, never a block.
  const sendLabel = duplicate ? tr.transfer.actions.sendAnyway : tr.transfer.actions.sendNow;
  /** What the review step warns about, as the step's announcement says it — in the language `m` speaks. */
  const reviewNote = (m: Messages) => [
    duplicateCheck?.sentence,
    reviewWarning && (reviewWarning.kind === 'over'
      ? m.transfer.funds.over(reviewWarning.basis === 'available')
      : m.transfer.funds.overdraft(money(reviewWarning.balanceAfter, draftAccount?.currency ?? 'EUR')).join('')),
  ].filter(Boolean).join(' ');
  const reviewNoteRef = useRef(reviewNote);
  reviewNoteRef.current = reviewNote;

  // ---- step changes: move focus to the new heading, say where we are ----
  // The body scrolls back to its top (Panel's scrollKey), so a step's
  // warnings, which sit first, are what is in view.
  const prevStep = useRef<Step>(step);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    if (step === 'awaiting') return;
    titleRef.current?.focus({ preventScroll: true });
    // The warnings are part of the announcement: focus moves past them to the
    // heading, and a screen reader tabbing on to the buttons would never
    // hear them otherwise. They are the ones on screen as the step opens.
    const note = step === 'review' ? reviewNoteRef.current : null;
    setLive({
      say: (m) => {
        const said = note?.(m);
        return `${m.transfer.live.step(STEP_INDEX[step] + 1, TRANSFER_STEPS.length, stepTitle(m, step))}${said ? ` ${said}` : ''}`;
      },
    });
  }, [step]);

  // An error that arrives on a step already open (a retry refused, the line
  // busy) is brought into view. A smooth scroll asked for from script
  // overrides the CSS reduced-motion rule, so the preference is read here.
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

  // ---- "Jetzt nachsehen" --------------------------------------------------
  const checkAccount = draft ? accounts.find((a) => a.accountNumber === draft.accountNumber) ?? null : null;
  /** The current stage's load has started (busy, or an approval up) — so falling quiet means it is over. */
  const checkStarted = useRef(false);
  useEffect(() => {
    if (!check || check.stage === 'done' || !checkAccount) return;
    if (busy || wait.open) { checkStarted.current = true; return; }
    const acct = checkAccount.accountNumber;
    if (check.stage === 'statements') {
      const landed = (statementInfo[acct]?.loadedAt ?? 0) >= check.startedAt;
      if (!landed && !checkStarted.current) return;
      checkStarted.current = false;
      // A failed or cancelled first read ends the check: no second approval
      // is asked for after the user has just declined one. Nor is one when
      // the read brought the Vorgemerkte along (lib/fints-statements.ts).
      const pendingCame = landed && (pendingInfo[acct]?.readAt ?? 0) >= check.startedAt;
      if (landed && checkAccount.canPending && !pendingCame) {
        setCheck({ stage: 'pending', startedAt: Date.now(), statements: true });
        void loadPending(checkAccount);
      } else {
        setCheck({ stage: 'done', at: Date.now(), statements: landed, pending: pendingCame || null });
      }
      return;
    }
    const landed = (pendingInfo[acct]?.readAt ?? 0) >= check.startedAt;
    if (!landed && !checkStarted.current) return;
    checkStarted.current = false;
    setCheck({ stage: 'done', at: Date.now(), statements: check.statements, pending: landed });
  }, [check, checkAccount, busy, wait.open, statementInfo, pendingInfo, loadPending]);

  const checking = !!check && check.stage !== 'done';
  const sighting = check?.stage === 'done' && draft && sentAt != null
    ? findSentTransfer({
      iban: draft.iban,
      cents: draft.cents,
      since: new Date(sentAt),
      booked: check.statements ? txByAccount[draft.accountNumber] : null,
      pending: check.pending ? pendingCache[draft.accountNumber] : null,
    })
    : null;

  const lookAgain = () => {
    if (!checkAccount || busy) return;
    checkStarted.current = false;
    if (checkAccount.canStatements) {
      setCheck({ stage: 'statements', startedAt: Date.now() });
      refreshAfterTransfer(checkAccount);
    } else if (checkAccount.canPending) {
      setCheck({ stage: 'pending', startedAt: Date.now(), statements: null });
      void loadPending(checkAccount);
    } else {
      setCheck({ stage: 'done', at: Date.now(), statements: null, pending: null });
    }
  };

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
    setFlagged({});
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
    setLive({ say: (m) => m.transfer.live.girocode(p.name, p.amount != null ? formatMoney(p.amount) : null) });
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
    setLive({ say: (m) => m.transfer.live.template(t.label) });
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
    const next: Partial<Record<FieldKey, boolean>> = {};
    for (const k of FIELD_ORDER) if (problems[k]) next[k] = true;
    const a = checkAmount(amount);
    setFlagged(next);
    setIbanTouched(true);
    setAmountTouched(true);
    const first = FIELD_ORDER.find((k) => next[k]);
    if (first || !account || a.cents == null) {
      if (first) fieldRefs[first].current?.focus();
      const n = Object.keys(next).length;
      setLive({ say: (m) => m.transfer.live.checkFields(n) });
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
    setStep('review');
  };

  // ---- the order ------------------------------------------------------------
  const handlers: TransferHandlers = {
    onTanStarted: () => { setSubmitting(false); setStep('awaiting'); },
    onExecuted: (answers?: string) => {
      setSubmitting(false);
      setBankAnswers(answers);
      setStep('done');
    },
    onUnknown: (answers?: string) => {
      setSubmitting(false);
      setBankAnswers(answers);
      setCheck(null);
      setStep('unknown');
    },
    onRefused: (answers: string) => {
      setSubmitting(false);
      setBankAnswers(answers);
      setVop(null);
      setStep('refused');
    },
    onError: (message: string) => { setSubmitting(false); setError(message); },
    onVop: (result: SerializedVop) => { setSubmitting(false); setVop(result); setStep('vop'); },
  };

  const send = () => {
    if (!draft || submitting || settling) return;
    setError(null);
    setSubmitting(true);
    setSentAt(Date.now());
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
    setSentAt(Date.now());
    void confirmVop(handlers);
  };

  /** Tell the server to drop the parked order; nothing new is sent until it has. */
  const settleVop = () => {
    setSettling(true);
    void abandonVop().finally(() => setSettling(false));
    setVop(null);
  };

  /** Drop the parked order. The form keeps its values, so a flagged payee
   *  name — or IBAN — can simply be corrected and sent again. Focus goes to
   *  the form's heading, not to Name: on a No Match it may be the IBAN that
   *  is wrong. */
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

  /** Back to the form after a refusal, every value kept. */
  const changeDetails = () => {
    setBankAnswers(undefined);
    setError(null);
    setStep('form');
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

  const templatePayee = useMemo(() => (draft
    ? {
      name: draft.name,
      iban: draft.iban,
      amount: fmtAmountInput(draft.cents / 100),
      purpose: draft.purpose || undefined,
      instant: draft.instant || undefined,
    }
    : null), [draft]);

  // While the bank waits for approval the TAN overlay owns the screen. The
  // sheet stays mounted (the draft must survive) but renders nothing, then
  // comes back with the result.
  if (empty || step === 'awaiting') return null;

  const answerLines = bankAnswerLines(bankAnswers);
  // A definite refusal reads as the bank's reason alone, the way a login error
  // does (no "Dialog abgebrochen" beside it); an unclear outcome keeps every line.
  const refusalLines = step === 'refused' ? formatBankAnswer(bankAnswers).lines : [];
  // A range that ended before today cannot hold this transfer's booking; the
  // refresh then reads up to today instead, and the result step says so.
  const pastRange = range.to < isoDate(new Date());
  const result = step === 'done' || step === 'unknown' || step === 'refused';

  // The Namensabgleich's decision. Where the bank found another name, the
  // safe way out is the filled button and sending anyway the outline: take
  // over the name it holds, or go back and check the details. A Close Match
  // that differs only in umlauts, or no result at all, keeps sending as the
  // primary — nothing points elsewhere, and the copy says what was checked.
  const vopSuggestion = step === 'vop' && vop && draft && vop.verdict === 'CLOSE_MATCH' && vop.suggestedName
    // Compared as sent: "Müller" was checked as "Mueller", so a suggestion
    // that differs only in its umlauts changes nothing.
    && sepaSanitize(vop.suggestedName) !== sepaSanitize(draft.name)
    ? vop.suggestedName
    : null;
  const vopCheckFirst = !!vop && (vop.verdict === 'NO_MATCH' || (vop.verdict === 'CLOSE_MATCH' && !vop.suggestedName));

  const words = tr.transfer;
  const act = words.actions;

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
        title={stepTitle(tr, step)}
        onClose={requestClose}
        closeDisabled={submitting}
        headerExtra={<Stepper current={STEP_INDEX[step]} unsure={step === 'unknown'} refused={step === 'refused'} />}
        compactExtra
        scrollKey={step}
        onPaste={onPaste}
        {...drop.handlers}
        footer={
          step === 'form' ? (
            <FooterRow>
              <Button className="flex-1" onClick={requestClose}>{tr.common.cancel}</Button>
              <Button type="submit" form="transfer-form" variant="primary" className="flex-[2]">{act.toReview}</Button>
            </FooterRow>
          ) : step === 'review' ? (
            duplicate ? (
              // The same order may already have gone out: the safe answer is
              // the filled one, as at a name mismatch — look before sending.
              <StackRow>
                <Button
                  className="sm:flex-1"
                  busy={submitting || settling}
                  disabled={busy && !submitting}
                  aria-describedby={REVIEW_WARNINGS_ID}
                  onClick={send}
                >
                  {sendLabel}
                </Button>
                <Button variant="primary" className="sm:flex-1" disabled={submitting} onClick={() => { setError(null); setStep('form'); }}>
                  {act.check}
                </Button>
              </StackRow>
            ) : (
              <FooterRow>
                <Button className="flex-1" disabled={submitting} onClick={() => { setError(null); setStep('form'); }}>{act.back}</Button>
                <Button
                  variant="primary"
                  className="flex-[2]"
                  busy={submitting || settling}
                  disabled={busy && !submitting}
                  aria-describedby={reviewWarning ? REVIEW_WARNINGS_ID : undefined}
                  onClick={send}
                >
                  {sendLabel}
                </Button>
              </FooterRow>
            )
          ) : step === 'vop' && vop ? (
            vopSuggestion ? (
              <StackRow>
                <Button variant="quiet" className="sm:-ml-3" disabled={submitting} onClick={dropVop}>{act.back}</Button>
                <Button className="sm:flex-1" busy={submitting} disabled={busy && !submitting} onClick={sendDespiteVop}>
                  {act.sendAnyway}
                </Button>
                <Button variant="primary" className="sm:flex-1" disabled={submitting} onClick={() => adoptSuggested(vopSuggestion)}>
                  {act.adoptName}
                </Button>
              </StackRow>
            ) : vopCheckFirst ? (
              <StackRow>
                <Button className="sm:flex-1" busy={submitting} disabled={busy && !submitting} onClick={sendDespiteVop}>
                  {act.sendAnyway}
                </Button>
                <Button variant="primary" className="sm:flex-1" disabled={submitting} onClick={dropVop}>{act.check}</Button>
              </StackRow>
            ) : (
              <FooterRow>
                <Button className="flex-1" disabled={submitting} onClick={dropVop}>{act.back}</Button>
                <Button
                  variant="primary"
                  className="flex-[2]"
                  busy={submitting}
                  disabled={busy && !submitting}
                  onClick={sendDespiteVop}
                >
                  {vopDeviates(vop) ? act.sendAnyway
                    : vop.verdict === 'NOT_APPLICABLE' ? act.sendUnchecked
                      : vopUnchecked(vop) ? act.sendNoResult
                        : act.approve}
                </Button>
              </FooterRow>
            )
          ) : step === 'done' ? (
            <FooterRow>
              <Button className="flex-1" onClick={refreshStatements} disabled={busy}>{act.refresh}</Button>
              <Button variant="primary" className="flex-1" onClick={closeTransfer}>{tr.common.done}</Button>
            </FooterRow>
          ) : step === 'unknown' ? (
            sighting ? (
              <FooterRow>
                <Button variant="primary" className="flex-1" onClick={closeTransfer}>{tr.common.done}</Button>
              </FooterRow>
            ) : (
              <FooterRow>
                <Button className="flex-1" onClick={closeTransfer}>{tr.common.close}</Button>
                <Button
                  variant="primary"
                  className="flex-[2]"
                  busy={checking}
                  disabled={!checkAccount || (busy && !checking)}
                  onClick={lookAgain}
                >
                  {check?.stage === 'done' ? act.lookAgain : act.lookNow}
                </Button>
              </FooterRow>
            )
          ) : step === 'refused' ? (
            <FooterRow>
              <Button className="flex-1" onClick={closeTransfer}>{tr.common.close}</Button>
              <Button variant="primary" className="flex-[2]" onClick={changeDetails}>{act.change}</Button>
            </FooterRow>
          ) : null
        }
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">{live?.say(tr)}</p>

        {step === 'form' && (
          <form id="transfer-form" onSubmit={toReview} noValidate className="pt-1">
            <Field label={words.form.fromAccount} htmlFor="tf-account" error={errors.account}>
              <Select
                id="tf-account"
                ref={accountRef}
                value={accountNumber}
                onChange={(e) => { setAccountNumber(e.target.value); setFlagged((x) => ({ ...x, account: false })); }}
              >
                {eligible.map((a) => (
                  <option key={a.accountNumber} value={a.accountNumber}>
                    {accountOption(tr, a, accountLabel(a), narrow ? null : spendable(balances[a.accountNumber]), money)}
                  </option>
                ))}
              </Select>
            </Field>

            <section aria-labelledby="tf-payee" className="mt-7">
              <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                <h3 id="tf-payee" className="section-head">{words.recipient}</h3>
                <TemplatesMenu onPick={applyTemplate} onManage={() => setManaging(true)} />
              </div>

              {source && (
                // A source note is a static value, not a status: Strong Line
                // edge, Slate Ink label.
                <p className="mb-4">
                  <Chip icon={SOURCE_ICON[source.kind]}>{sourceLabel(tr, source)}</Chip>
                </p>
              )}

              {recents.length > 0 && (
                <div className="mb-4">
                  <p id="tf-recent" className="mb-2 text-[13px] font-semibold text-ink-3">{words.form.recent}</p>
                  <div
                    role="group"
                    aria-labelledby="tf-recent"
                    // Full-bleed on a phone: out to the body's edges — whose
                    // right padding gives way to the scrollbar (see Panel).
                    className={cx(
                      '-ml-5 flex gap-2 overflow-x-auto pb-1 pl-5 [scrollbar-width:none]',
                      '-mr-[max(0px,calc(1.25rem_-_var(--sbw,0px)))] pr-[max(0px,calc(1.25rem_-_var(--sbw,0px)))]',
                      'sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0',
                    )}
                  >
                    {recents.map((r) => {
                      const own = ownByIban.get(r.iban);
                      return (
                        <Chip
                          key={r.iban}
                          className="max-w-[260px]"
                          icon={own ? <AccountTypeIcon type={own.accountType} product={own.product} size={16} /> : undefined}
                          title={`${own ? `${words.form.ownAccount} · ` : ''}${r.name} · ${fmtIban(r.iban)}`}
                          selected={raw === r.iban && squash(name) === r.name}
                          onClick={() => {
                            fillPayee({ name: r.name, iban: r.iban }, null, false);
                            reader.reset();
                            requestAnimationFrame(() => amountRef.current?.focus());
                          }}
                        >
                          {own ? accountLabel(own) : r.name}
                          {!own && sharedNames.has(r.name) && (
                            <span className="iban ml-1.5 text-[12.5px] font-normal text-ink-3">{fmtShortIban(r.iban).tail}</span>
                          )}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              )}

              <GiroCodeDrop className="mb-5" scan={reader.scan} dragging={drop.dragging} onFile={(f) => void reader.readFile(f)} />

              <Field
                label={words.form.name}
                htmlFor="tf-name"
                error={errors.name}
                // The bank compares it with the account holder's name (the
                // Namensabgleich): saying so up front heads off a near miss.
                hint={errors.name ? undefined : words.form.nameHint}
              >
                <Input
                  id="tf-name"
                  ref={nameRef}
                  data-autofocus={!initial.name ? true : undefined}
                  maxLength={MAX_NAME}
                  value={name}
                  autoComplete="off"
                  onChange={(e) => { setName(e.target.value); setFlagged((x) => ({ ...x, name: false })); }}
                  placeholder={words.form.namePlaceholder}
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
                    setFlagged((x) => ({ ...x, iban: false }));
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
              <h3 id="tf-payment" className="section-head mb-3">{words.form.payment}</h3>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field
                  label={tr.common.booking.amount}
                  htmlFor="tf-amount"
                  error={amountError}
                  hint={amountError || !funds ? undefined : (
                    <span className="flex flex-col gap-1">
                      <span>
                        {funds.kind === 'available' ? words.form.available : tr.common.account.balance}{' '}
                        <Money value={funds.value} currency={account?.currency} className="font-semibold text-ink-2" />
                      </span>
                      {formWarning && (
                        <span className="flex items-start gap-1.5 text-ink-2">
                          <AlertTriangleIcon size={15} className="mt-0.5 shrink-0 text-emphasis" />
                          <span><FundsWarningText warning={formWarning} currency={account?.currency} /></span>
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
                      setFlagged((x) => ({ ...x, amount: false }));
                      setAmountTouched(false);
                    }}
                    onBlur={(e) => {
                      const text = e.currentTarget.value;
                      if (!text.trim()) return;
                      setAmountTouched(true);
                      const a = checkAmount(text);
                      if (a.cents != null) setAmount(fmtAmountInput(a.cents / 100));
                    }}
                    // No placeholder: a "0,00" in the field's own large
                    // figure style reads as a prefilled amount.
                    className="amount text-right text-[20px] font-semibold"
                    trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">€</span>}
                  />
                </Field>

                <div className="mb-4 flex flex-col gap-1.5">
                  <span className="text-[13px] leading-snug font-semibold text-ink-2" aria-hidden>{words.form.execution}</span>
                  <Segmented
                    aria-label={words.form.execution}
                    block
                    className="h-12 items-center"
                    value={useInstant ? 'instant' : 'standard'}
                    onChange={(v) => setInstant(v === 'instant')}
                    options={[
                      { value: 'standard', label: words.form.standard },
                      { value: 'instant', label: tr.common.booking.instant, icon: <BoltIcon size={16} />, disabled: !canInstant },
                    ]}
                  />
                  <p className="text-[13px] leading-snug text-ink-3">
                    {!canInstant
                      ? words.form.noInstant
                      : useInstant
                        ? words.form.instantHint
                        : <CreditDate short />}
                  </p>
                </div>
              </div>

              <Field
                label={tr.common.booking.purpose}
                htmlFor="tf-purpose"
                optional
                className="mb-1"
                // Counted the way the bank counts: after ä → ae and the like.
                // Too long is said at once, not only on "Weiter" — a
                // GiroCode can fill in a purpose that does not fit.
                error={errors.purpose ?? (purposeLen > MAX_PURPOSE ? words.form.purposeTooLong(purposeLen - MAX_PURPOSE) : undefined)}
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
                  `${words.form.charsLeft(MAX_PURPOSE - purposeLen)}${sepaSanitize(purpose) !== squash(purpose) ? ` ${words.form.countsWrittenOut}` : ''}`
                )}
              >
                <Input
                  id="tf-purpose"
                  ref={purposeRef}
                  maxLength={MAX_PURPOSE}
                  value={purpose}
                  autoComplete="off"
                  onChange={(e) => { setPurpose(e.target.value); setFlagged((x) => ({ ...x, purpose: false })); }}
                  placeholder={words.form.purposePlaceholder}
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
            warning={reviewWarning}
            duplicate={duplicate}
            primaryLabel={sendLabel}
            busyElsewhere={busy && !submitting}
            error={error}
            errorRef={errorRef}
          />
        )}

        {step === 'vop' && vop && draft && (
          <div className="pt-1">
            {error && <StepError message={error} errorRef={errorRef} />}
            <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
              {rich((vopUnchecked(vop) ? words.vopStep.introUnchecked : words.vopStep.intro)(
                <Money value={draft.cents / 100} masked={false} className="font-semibold text-ink" />,
              ))}
            </p>
            <VopReport vop={vop} iban={draft.iban} className="mb-4" />
            {vop.verdict === 'NO_MATCH' && (
              // In invoice fraud the name is right and the IBAN is not: the
              // way to tell is a channel the fraudster does not control.
              <p className="mb-3 flex items-start gap-2 text-[14.5px] leading-snug text-ink">
                <InfoIcon size={17} className="mt-px shrink-0 text-info" />
                <span>{words.vopStep.askPayee}</span>
              </p>
            )}
            {vopDeviates(vop) && (
              <p className="text-[13.5px] leading-snug text-ink-2">
                {words.vopStep.risk}
              </p>
            )}
            {busy && !submitting && <BusyNote />}
          </div>
        )}

        {step === 'done' && draft && (
          <div className="flex flex-col items-center pt-2 text-center">
            <SuccessMark />
            <p className="mt-5 text-[17px] leading-snug text-ink">
              <Money value={draft.cents / 100} className="text-[24px] font-bold text-headline" />
              <span className="mt-1 block break-words">{words.done.to(sepaSanitize(draft.name))}</span>
            </p>
            <p className="mt-2 text-[14px] text-ink-2">
              {draft.instant ? (
                <>
                  <BoltIcon size={15} className="mr-1 inline-block align-[-2px]" />
                  {words.done.instant}
                </>
              ) : (
                <CreditDate />
              )}
            </p>
            {answerLines.length > 0 && <BankAnswer lines={answerLines} className="mt-5" />}
            <p className="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-3">
              {words.done.appears}{' '}
              {pastRange ? words.done.pastRange(fmtDate(range.to), act.refresh) : words.done.refreshHint(act.refresh)}
            </p>
            {templatePayee && (
              <div className="mt-6 w-full border-t border-line pt-5 text-left">
                <SaveAsTemplate payee={templatePayee} />
              </div>
            )}
          </div>
        )}

        {step === 'unknown' && (
          <div className="flex flex-col items-center pt-2 text-center">
            <UnsureMark />
            <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-ink">
              {words.unknown.noConfirmation}
            </p>
            {!sighting && (
              <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">
                {words.unknown.beforeResend(act.lookNow)}
              </p>
            )}

            <div aria-live="polite" className="w-full text-left">
              {check?.stage === 'done' && draft && (
                <CheckResult
                  sighting={sighting}
                  statements={check.statements}
                  pending={check.pending}
                  at={check.at}
                  name={sepaSanitize(draft.name)}
                />
              )}
            </div>
            {checking && (
              <p className="mt-4 flex items-center gap-2 text-[13.5px] text-ink-2" role="status">
                <Spinner size={14} />
                {check?.stage === 'pending' ? words.unknown.loadingPending : words.unknown.loading}
              </p>
            )}
            {busy && !checking && <BusyNote />}

            {draft && (
              <SummaryList className="mt-5 w-full border-y border-line text-left">
                <SummaryRow label={tr.common.booking.amount}><Money value={draft.cents / 100} className="font-semibold" /></SummaryRow>
                <SummaryRow label={words.recipient}>{sepaSanitize(draft.name)}</SummaryRow>
                <SummaryRow label="IBAN"><span className="iban text-[14px]">{fmtIban(draft.iban)}</span></SummaryRow>
                <SummaryRow label={tr.common.booking.purpose}>
                  {sepaSanitize(draft.purpose) || <span className="text-ink-3">{words.review.none}</span>}
                </SummaryRow>
                {sentAt != null && <SummaryRow label={words.unknown.sent}><span className="tnum">{fmtWhen(tr, sentAt)}</span></SummaryRow>}
              </SummaryList>
            )}
            {answerLines.length > 0 && <BankAnswer lines={answerLines} className="mt-5" />}
          </div>
        )}

        {step === 'refused' && (
          <div className="flex flex-col items-center pt-2 text-center">
            <RefusedMark />
            <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-ink">
              {refusalLines.length > 0 ? words.refused.withReason : words.refused.plain}
            </p>
            {refusalLines.length > 0 && (
              <BankAnswer
                lines={refusalLines}
                label={null}
                reference={refusalReference(bankAnswers)}
                className="mt-3"
              />
            )}
            {draft && (
              <SummaryList className="mt-5 w-full border-y border-line text-left">
                <SummaryRow label={tr.common.booking.amount}><Money value={draft.cents / 100} className="font-semibold" /></SummaryRow>
                <SummaryRow label={words.recipient}>{sepaSanitize(draft.name)}</SummaryRow>
                <SummaryRow label="IBAN"><span className="iban text-[14px]">{fmtIban(draft.iban)}</span></SummaryRow>
              </SummaryList>
            )}
          </div>
        )}
      </Panel>

      {managing && <ManageTemplates onClose={() => setManaging(false)} />}
      {confirm === 'discard' && (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title={words.discard.title}
          description={words.discard.body}
          actions={(
            <>
              <Button data-autofocus onClick={() => setConfirm(null)}>{words.discard.keep}</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); closeTransfer(); }}>{words.discard.confirm}</Button>
            </>
          )}
        />
      )}
      {confirm === 'vop' && (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title={words.discardVop.title}
          description={words.discardVop.body}
          actions={(
            <>
              <Button data-autofocus onClick={() => setConfirm(null)}>{words.discardVop.keep}</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); closeAfterVop(); }}>{words.discardVop.confirm}</Button>
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

/**
 * Three actions, or two that each need their full label: stacked on a phone
 * with the primary on top (it goes last in the markup, as in a dialog), side
 * by side from 640px.
 */
function StackRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">{children}</div>;
}

/**
 * The bank's own words, codes stripped; under a refusal its code once, small, for a call to the bank.
 * `label`: left out, the usual caption; null, none.
 */
function BankAnswer({
  lines, label, reference, className,
}: { lines: string[]; label?: string | null; reference?: string; className?: string }) {
  const tr = useT();
  const caption = label === undefined ? tr.transfer.bankAnswer.label : label;
  return (
    <figure className={cx('w-full text-left', className)}>
      {caption && <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">{caption}</figcaption>}
      <ul className="rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words text-ink">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {reference && (
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          {rich(tr.transfer.bankAnswer.reference(<span className="tnum">{reference}</span>))}
        </p>
      )}
    </figure>
  );
}

/**
 * What "Jetzt nachsehen" found. Found means: do not send it again. Not found
 * is no reason to send it again either — a transfer can take a while to
 * appear — so the answer never invites it.
 */
function CheckResult({
  sighting, statements, pending, at, name,
}: {
  sighting: ReturnType<typeof findSentTransfer>;
  /** null: the account has no Umsätze over FinTS to read. */
  statements: boolean | null;
  /** null: the account has no Vorgemerkt list to read. */
  pending: boolean | null;
  at: number;
  name: string;
}) {
  const tr = useT();
  const words = tr.transfer.unknown;
  const checked = fmtTime(tr, new Date(at));
  if (sighting) {
    const tx = sighting.tx;
    return (
      <Alert tone="success" title={sighting.where === 'booked' ? words.foundBooked : words.foundPending} className="mt-5">
        {rich(words.found(
          <Money value={-tx.amount} className="font-semibold text-ink" />,
          name,
          sighting.where === 'booked' ? <span className="tnum">{fmtDate(tx.entryDate || tx.valueDate)}</span> : null,
        ))}
      </Alert>
    );
  }
  const failed = [
    statements === false && words.failedBooked,
    pending === false && words.failedPending,
  ].filter(Boolean) as string[];
  // Only what was actually read is named as searched.
  const searched = statements === true || pending === true;
  return (
    <Alert
      tone="warn"
      title={searched ? words.notVisible : words.notChecked}
      className="mt-5"
    >
      {failed.map((f) => <span key={f} className="block">{f}</span>)}
      {searched ? (
        <span className="block">
          {rich(words.notYet(words.searched(statements === true, pending === true), <span className="tnum">{checked}</span>))}
        </span>
      ) : statements === null && pending === null ? (
        // Nothing this app could read for the account — trying again would not change that.
        <span className="block">{words.nothingToRead}</span>
      ) : (
        <span className="block">{words.tryAgain}</span>
      )}
    </Alert>
  );
}

/** "Girokonto · DE78 ··· 5932 71 · Verfügbar 2.196,22 €" — one line, as a native option must be. */
function accountOption(
  tr: Messages,
  a: SerializedAccount,
  label: string,
  funds: ReturnType<typeof spendable>,
  money: (v: number, c?: string) => string,
): string {
  const parts = [label, shortIbanText(a.iban)];
  if (funds) parts.push(`${funds.kind === 'available' ? tr.transfer.form.available : tr.common.account.balance} ${money(funds.value, a.currency)}`);
  return parts.filter(Boolean).join(' · ');
}
