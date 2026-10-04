'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { canReportBalance, isCardAccount } from '@/lib/balances';
import { buildBalanceHistory } from '@/lib/balance-history';
import { fmtDate, fmtIban, fmtRange, isFutureDate, isoDate, properName } from '@/lib/format';
import type { SerializedAccount, SerializedBalance } from '@/lib/fints-types';
import type { StatementInfo } from '@/lib/app-types';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { AlertTriangleIcon, InfoIcon, PencilIcon, RefreshIcon, UndoIcon } from '../icons';
import { Alert, Button, CopyButton, Field, IconButton, Input, Skeleton, cx } from '../ui';
import { fmtSince } from '../shell/session';
import { AccountGlyph, MAX_ALIAS, accountIdent, aliasFromDraft, bankName, vaultNote } from './AccountIdentity';
import { BalanceChart } from './BalanceChart';

/** The same words every other fetch control carries. */
const MAY_NEED_TAN = 'Kann eine Freigabe erfordern.';

/**
 * The bank's own balance at the end of a fetched range: the newest statement
 * block that states one. The same reading the printed Kontoauszug uses, so
 * the hero and the PDF never disagree about a past range.
 */
function closingOf(info: StatementInfo | undefined, fallbackCurrency: string): { balance: number; currency: string } | null {
  if (!info) return null;
  let best: StatementInfo['blocks'][number] | null = null;
  for (const b of info.blocks) {
    if (b.closingBalance == null) continue;
    if (!best || (b.closingDate ?? '') >= (best.closingDate ?? '')) best = b;
  }
  if (!best || best.closingBalance == null) return null;
  return { balance: best.closingBalance, currency: best.currency || fallbackCurrency };
}

/**
 * When a balance is "as of". An interim report's closing balance is dated to
 * the bank's next Buchungstag, so on a weekend it sits in the future. Say
 * which day it is rather than presenting a future date as the balance's as-of
 * date.
 */
function asOf(bal: SerializedBalance | undefined) {
  if (!bal?.date) return null;
  return isFutureDate(bal.date)
    ? {
        text: `Buchungstag ${fmtDate(bal.date)}`,
        title: 'Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.',
      }
    : { text: `Stand ${fmtDate(bal.date)}`, title: undefined };
}

/** One line of the figures beside the balance: label left, amount right-aligned. */
function Figure({ label, labelClassName, title, children }: {
  label: ReactNode; labelClassName?: string; title?: string; children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6" title={title}>
      <dt className={cx('text-[14px] leading-snug', labelClassName ?? 'text-ink-2')}>{label}</dt>
      <dd className="text-[15px] leading-snug font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Shaped like the hero, for the moment before there is an account to show. */
function HeroSkeleton() {
  return (
    <section aria-busy="true" aria-label="Kontostand wird geladen" className="panel min-w-0 overflow-clip">
      <div className="px-5 pt-6 pb-6 sm:px-8 sm:pt-7">
        <Skeleton className="h-3.5 w-36 rounded-[4px]" />
        <Skeleton className="mt-4 h-11 w-64 max-w-full rounded-[6px]" />
        <Skeleton className="mt-3 h-3 w-28 rounded-[4px]" />
        <Skeleton className="mt-8 h-[152px] w-full rounded-[8px]" />
      </div>
    </section>
  );
}

/**
 * The balance, given the room a balance deserves — and what qualifies it.
 *
 * The figure leads, set at display size in the headline navy with the cents
 * stepped down, the way a bank's start page states it, under a label that
 * names the account it belongs to. Right under it, the day it is true for;
 * beside it the handful of figures that change what the balance means (how
 * much is actually available, the overdraft line, what is already reserved).
 * Then the verified Kontoverlauf, and finally the account line: whose
 * account, which IBAN, which BIC.
 *
 * Where there is no figure, the hero says why in its place — not fetched yet,
 * or failed with the bank's own reason — and offers the read that gets it.
 * A failure is never shown as "not fetched yet".
 *
 * A credit card speaks its own language: a Kartensaldo against a
 * Kreditrahmen, in ink rather than red — a card's balance is negative by
 * nature, so red would raise an alarm after every purchase.
 *
 * No buttons for the account's actions: Überweisen, Geld anfordern and
 * Kontoauszug are the stage's Schnellzugriffe right above, and act on this
 * same account. With a single account the list above stays away, and its
 * "Umbenennen" moves into the account line here.
 *
 * Past ranges: a statement fetched for a range that ended before today says
 * nothing about the balance *now*. Its closing figure is shown as "Saldo am
 * {Ende}" and is never labelled "Kontostand"; the current balance appears
 * only if a fetch up to today, or a balance enquiry, supplied it.
 */
export function AccountHero() {
  const {
    activeAccount: a, accounts, balances, statementInfo, txByAccount, pendingCache, pendingInfo, loadingAccount,
    balanceLoading, txErrors, balanceErrors, busy, privacy, togglePrivacy, isLoadedForAppliedRange, refreshAccount,
    loadBalance, accountLabel,
  } = useFints();

  const figureRef = useRef<HTMLDivElement>(null);
  const acct = a?.accountNumber ?? '';
  const info = acct ? statementInfo[acct] : undefined;
  const txs = acct ? txByAccount[acct] : undefined;

  // Exactly this account's booked items from the one fetch the blocks came
  // from — pending items are not part of any statement and would break the
  // proof (lib/balance-history.ts).
  const history = useMemo(
    () => (info && txs ? buildBalanceHistory({ txs, blocks: info.blocks, range: { from: info.from, to: info.to } }) : null),
    [info, txs],
  );

  // No account at all (the bank listed none): the list says so; nothing to hold a place for.
  if (!a) return accounts.length ? <HeroSkeleton /> : null;

  const bal = balances[acct];
  const statementLoading = loadingAccount === acct;
  const figureLoading = statementLoading || balanceLoading === acct;
  const failure = txErrors[acct] ?? balanceErrors[acct];
  const card = isCardAccount(a);
  const today = isoDate(new Date());
  const past = !!info && info.to < today;
  const closing = past ? closingOf(info, a.currency) : null;
  const currency = bal?.currency ?? closing?.currency ?? a.currency ?? 'EUR';
  const dated = asOf(bal);
  const label = accountLabel(a);
  const nowLabel = card ? 'Kartensaldo' : 'Kontostand';

  // What the big figure is: today's balance when known; for a past range
  // without one, that range's closing balance under its own name.
  const main: { label: string; value: number; currency: string } | null = bal
    ? { label: nowLabel, value: bal.balance, currency: bal.currency }
    : closing && info
      ? { label: `Saldo am ${fmtDate(info.to)}`, value: closing.balance, currency: closing.currency }
      : null;
  const negative = !!main && Math.round(main.value * 100) < 0;
  // Navy, or red for an overdrawn account. A card's negative balance is its
  // normal state: ink. With amounts hidden always navy — a colour would give
  // away what the dots hide.
  const figureColour = privacy || !negative ? 'text-headline' : card ? 'text-ink' : undefined;

  /**
   * Fetches the figure the cheapest way that gets it: the statement while
   * the Umsätze are not loaded (one read brings both), the balance enquiry
   * once they are, or when the account has none to load. The button that
   * asked gives way to the fetch, so focus waits on the figure's place for
   * whatever arrives there — never dropped to <body>.
   */
  const fetchFigure = (via: 'auto' | 'balance' = 'auto') => {
    if (busy) return;
    figureRef.current?.focus({ preventScroll: true });
    if (via === 'auto' && a.canStatements && !(a.canBalance && isLoadedForAppliedRange(acct))) refreshAccount(a);
    else void loadBalance(a);
  };

  // Vorgemerkt: only once fetched (it can take a TAN, so it is never assumed
  // to be empty), only when something IS reserved — an amber "0,00 €" would
  // flag a state that needs no attention — and in the balance's currency only.
  const pending = (pendingCache[acct] ?? []).filter((t) => (t.currency || currency) === currency);
  const pendingSum = pending.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;

  const figures: ReactNode[] = [];
  if (bal?.availableAmount != null) {
    figures.push(
      <Figure key="avail" label="Verfügbar">
        <Money value={bal.availableAmount} currency={bal.currency} tone="auto" />
      </Figure>,
    );
  }
  if (bal?.creditLimit != null && Math.round(bal.creditLimit * 100) !== 0) {
    figures.push(
      // A card's limit is a Kreditrahmen; a Dispositionsrahmen is a Girokonto's overdraft.
      <Figure key="limit" label={card ? 'Kreditrahmen' : 'Dispositionsrahmen'}>
        <Money value={Math.abs(bal.creditLimit)} currency={bal.currency} tone="plain" />
      </Figure>,
    );
  }
  if (pending.length > 0) {
    // The list is only as fresh as its last fetch; one older than the
    // bookings beside it says so (the provider has already dropped what those
    // show as booked).
    const fetched = pendingInfo[acct];
    const stand = fetched
      ? ` · Stand ${fmtSince(fetched.loadedAt)}${fetched.behindStatement ? ', vor dem letzten Umsatzabruf' : ''}`
      : '';
    figures.push(
      <Figure
        key="pending"
        label="Vorgemerkt"
        labelClassName="font-semibold text-amber"
        title={`${pending.length === 1 ? '1 vorgemerkter Umsatz' : `${pending.length} vorgemerkte Umsätze`}${stand}`}
      >
        <Money value={pendingSum} currency={currency} tone="plain" />
      </Figure>,
    );
  }
  if (bal && closing && info) {
    figures.push(
      <Figure key="closing" label={`Saldo am ${fmtDate(info.to)}`} title="Endsaldo des geladenen Zeitraums laut deiner Bank">
        <Money value={closing.balance} currency={closing.currency} tone={card ? 'plain' : 'auto'} />
      </Figure>,
    );
  }

  return (
    <HeroFrame label={label}>
      {/* A size container: whether the figures fit BESIDE the balance depends
          on the tile's own width (a two-column dashboard at 1100px gives it
          less room than a single column at 900px), not on the window's. */}
      <div className="@container px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-7">
        {/* The figure, and beside it (under it when narrow) what qualifies it. */}
        <div className="grid gap-x-10 gap-y-5 @min-[640px]:grid-cols-[minmax(0,1fr)_auto] @min-[640px]:items-end">
          <div ref={figureRef} tabIndex={-1} aria-busy={figureLoading || undefined} className="min-w-0 outline-none">
            {/* Which figure, and whose: two Girokonten must not look alike up here. */}
            <p className="text-[14px] leading-snug font-semibold text-ink-2">
              {main?.label ?? nowLabel}
              <span className="font-normal text-ink-3"> · {label}</span>
            </p>

            {main ? (
              <>
                <p className={cx('mt-1.5 leading-none font-bold tracking-[-0.015em]', figureColour)}>
                  <Money
                    value={main.value}
                    currency={main.currency}
                    tone={card ? 'plain' : 'auto'}
                    split
                    className="text-[40px] @min-[520px]:text-[52px]"
                    centsClassName="text-[0.5em] font-semibold"
                  />
                </p>
                {bal ? (
                  <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
                    <span title={dated?.title}>
                      {dated?.text}
                      {dated?.title && <span className="sr-only">. {dated.title}</span>}
                    </span>
                    {/* Hidden amounts outlast a restart: whoever comes back to a
                        page of dots learns why here, and the way back. */}
                    {privacy && (
                      <>
                        {' · Beträge ausgeblendet '}
                        <button
                          type="button"
                          aria-label="Beträge anzeigen"
                          onClick={togglePrivacy}
                          className="ml-1 font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          Anzeigen
                        </button>
                      </>
                    )}
                  </p>
                ) : a.canBalance ? (
                  // A past range's closing figure stands in for a balance the
                  // app does not know — the enquiry can still add it.
                  <FetchAction
                    lead={balanceErrors[acct]
                      ? `Der Zeitraum endet vor heute. Abruf des aktuellen ${nowLabel}s fehlgeschlagen: ${balanceErrors[acct].message}`
                      : 'Der Zeitraum endet vor heute.'}
                    label={balanceErrors[acct] ? 'Erneut versuchen' : `Aktuellen ${nowLabel} abrufen`}
                    busy={busy}
                    loading={balanceLoading === acct}
                    run={() => fetchFigure('balance')}
                  />
                ) : (
                  <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
                    Zeitraum endet vor heute – den aktuellen {nowLabel} zeigt ein Abruf bis heute.
                  </p>
                )}
              </>
            ) : figureLoading ? (
              <>
                <span className="mt-2 block">
                  <Skeleton className="h-10 w-56 max-w-full rounded-[6px] @min-[520px]:h-12" />
                  <span className="sr-only">Kontostand wird abgerufen</span>
                </span>
                <p className="mt-2 text-[13px] leading-snug text-ink-3">Saldo wird abgerufen …</p>
              </>
            ) : failure ? (
              <FigureNote
                problem
                title="Abruf fehlgeschlagen"
                action={{ label: 'Erneut versuchen', run: () => fetchFigure() }}
                busy={busy}
              >
                {failure.message}
              </FigureNote>
            ) : canReportBalance(a) ? (
              <FigureNote title="Noch kein Saldo abgerufen" action={{ label: 'Saldo abrufen', run: () => fetchFigure() }} busy={busy} />
            ) : (
              <FigureNote title="Kein Saldo abrufbar">
                Deine Bank meldet für dieses Konto über diesen Zugang keinen Saldo.
              </FigureNote>
            )}
          </div>

          {figures.length > 0 && (
            <dl
              className={cx(
                'grid max-w-[440px] gap-y-2 border-t border-line pt-4',
                '@min-[640px]:max-w-none @min-[640px]:min-w-[264px] @min-[640px]:border-t-0 @min-[640px]:border-l @min-[640px]:py-1 @min-[640px]:pl-6',
              )}
            >
              {figures}
            </dl>
          )}
        </div>

        <BalanceSection history={history} loading={statementLoading && !info} currency={currency} figure={!!main} />
      </div>

      <AccountLine account={a} label={label} renamable={accounts.length === 1} />
    </HeroFrame>
  );
}

function HeroFrame({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel min-w-0 overflow-clip" aria-labelledby={id}>
      <h2 id={id} className="sr-only">Konto {label}</h2>
      {children}
    </section>
  );
}

/**
 * In the figure's place: why there is none — and, when a read can change
 * that, the read, with the note every fetch control carries. Not a live
 * region: the toast has already announced a failure once.
 */
function FigureNote({
  title, problem, action, busy, children,
}: {
  title: string;
  problem?: boolean;
  action?: { label: string; run: () => void };
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mt-2">
      <p className="flex items-center gap-2 text-[22px] leading-[1.25] font-bold text-ink">
        {problem && <AlertTriangleIcon size={22} className="shrink-0 text-red" />}
        {title}
      </p>
      {/* The reason as the bank (or the app) put it. */}
      {children && <p className="mt-1 max-w-[60ch] text-[14px] leading-snug text-ink-2">{children}</p>}
      {action && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button size="sm" variant="secondary" iconLeft={<RefreshIcon size={16} />} disabled={busy} onClick={action.run}>
            {action.label}
          </Button>
          <span className="text-[13px] leading-snug text-ink-3">{MAY_NEED_TAN}</span>
        </div>
      )}
    </div>
  );
}

/** The date line's place under a past range's figure: what it is, and the read that adds today's. */
function FetchAction({ lead, label, busy, loading, run }: {
  lead: string; label: string; busy: boolean; loading: boolean; run: () => void;
}) {
  return (
    <div className="mt-2 text-[13px] leading-snug text-ink-3">
      <p>{lead}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <Button
          variant="tertiary"
          size="xs"
          className="-ml-3"
          iconLeft={<RefreshIcon size={15} />}
          busy={loading}
          disabled={busy}
          onClick={run}
        >
          {label}
        </Button>
        <span>{MAY_NEED_TAN}</span>
      </p>
    </div>
  );
}

/**
 * The account line: what the account is called, whose it is, and the
 * identifiers to hand to somebody else — each copyable. For the only account
 * (no list above it) it is also where the account is renamed.
 */
function AccountLine({ account, label, renamable }: { account: SerializedAccount; label: string; renamable: boolean }) {
  const { vaultStatus } = useFints();
  const [renaming, setRenaming] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const noteId = useId();

  // Focus goes back to the button that started renaming — never lost to <body>.
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (!renaming && wasRenaming.current) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  // The explanation answers a click; once the vault is readable it is moot.
  useEffect(() => {
    if (vaultStatus === 'ready') setNoteOpen(false);
  }, [vaultStatus]);

  const startRenaming = () => {
    if (vaultStatus !== 'ready') setNoteOpen(true);
    else setRenaming(true);
  };

  const iban = fmtIban(account.iban);
  const ident = accountIdent(account);
  const holder = properName(account.holder);

  return (
    <div className="border-t border-line bg-inset px-5 py-4 sm:px-8">
      {renaming && renamable ? (
        <RenameForm account={account} onClose={() => setRenaming(false)} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <AccountGlyph account={account} size={36} className="hidden sm:grid" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] leading-snug font-semibold">{label}</span>
              {holder && <span className="block truncate text-[13px] leading-snug text-ink-3">{holder}</span>}
            </span>
            {renamable && (
              <Button
                ref={renameButton}
                variant="tertiary"
                size="xs"
                iconLeft={<PencilIcon size={16} />}
                aria-describedby={noteOpen ? noteId : undefined}
                onClick={startRenaming}
              >
                Umbenennen
              </Button>
            )}
          </span>

          <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
            {iban ? (
              <span className="flex min-w-0 items-center gap-1">
                <span className="sr-only">IBAN </span>
                <span className="iban overflow-x-auto text-[13.5px] text-ink [scrollbar-width:none]">{iban}</span>
                <CopyButton text={iban.replace(/\s+/g, '')} label="IBAN kopieren" />
              </span>
            ) : ident.tail ? (
              // No IBAN (a credit card, a Depot): the number the bank reports,
              // grouped like a card prints it, the recognisable end set heavier.
              <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-3">
                <span aria-hidden className="shrink-0">{ident.kind === 'card' ? 'Karte' : 'Konto'}</span>
                <span aria-hidden className="iban flex min-w-0 text-[13.5px] text-ink-2">
                  {ident.head && <span className="min-w-0 truncate">{ident.head}&nbsp;</span>}
                  <span className="id-tail shrink-0">{ident.tail}</span>
                </span>
                <span className="sr-only">{ident.spoken}</span>
              </span>
            ) : null}
            {account.bic && (
              <span className="text-[13px] text-ink-3">
                BIC <span className="iban text-ink-2">{account.bic}</span>
              </span>
            )}
          </span>
        </div>
      )}

      {noteOpen && !renaming && (
        <Alert tone="info" role="status" className="mt-3" onDismiss={() => setNoteOpen(false)}>
          <span id={noteId}>{vaultNote(vaultStatus)}</span>
        </Alert>
      )}
    </div>
  );
}

/** Renaming the only account, in place of its name. Escape or "Abbrechen" leaves it as it was. */
function RenameForm({ account, onClose }: { account: SerializedAccount; onClose: () => void }) {
  const { vault, renameAccount, toast } = useFints();
  const saved = vault?.aliases?.[account.accountNumber] ?? null;
  const [draft, setDraft] = useState(saved ?? '');
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const custom = !!draft.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    // Typing the bank's own name back in is the same as having no alias.
    const next = aliasFromDraft(account, draft);
    if (next !== saved) {
      renameAccount(account.accountNumber, next);
      toast('Kontoname gespeichert.', 'success');
    }
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    // Escape belongs to this field, not to whatever layer sits above the page.
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <form onSubmit={save} noValidate aria-label="Konto umbenennen">
      <Field
        label="Kontoname"
        htmlFor={fieldId}
        className="max-w-[400px]"
        hint="Er wird verschlüsselt auf diesem Rechner gespeichert, deine Bank erfährt davon nichts. Ein leeres Feld zeigt wieder den Namen deiner Bank."
      >
        {/* Always rendered (only hidden while there is nothing to reset):
            adding it on the first keystroke would wrap the input in a new
            element and drop the caret. */}
        <Input
          ref={input}
          value={draft}
          maxLength={MAX_ALIAS}
          placeholder={bankName(account)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          trailing={
            <IconButton
              aria-label={`Auf „${bankName(account)}“ zurücksetzen`}
              disabled={!custom}
              className={custom ? undefined : 'invisible'}
              onClick={() => {
                setDraft('');
                input.current?.focus();
              }}
            >
              <UndoIcon size={17} />
            </IconButton>
          }
        />
      </Field>
      {/* After the field, where Tab arrives — the primary action last. */}
      <div className="mt-3 flex justify-end gap-2 sm:justify-start">
        <Button variant="tertiary" size="sm" onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" size="sm" type="submit">Speichern</Button>
      </div>
    </form>
  );
}

/** Kontoverlauf — or, when the bank's figures do not prove one, the reason why not. */
function BalanceSection({
  history, loading, currency, figure,
}: {
  history: ReturnType<typeof buildBalanceHistory> | null;
  loading: boolean;
  currency: string;
  /** A balance is shown above — which stays the bank's own, whatever the history. */
  figure: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-6 border-t border-line pt-5">
        <Skeleton className="h-3.5 w-28 rounded-[4px]" />
        <Skeleton className="mt-3 h-[152px] w-full rounded-[8px] sm:h-[188px]" />
      </div>
    );
  }
  if (!history) return null;

  if (!history.verified || history.points.length < 2) {
    const reason = history.verified ? 'Der geladene Zeitraum ist zu kurz.' : history.reason;
    return (
      <p className="mt-6 flex border-t border-line pt-5 items-start gap-2 text-[13px] leading-snug text-ink-3">
        <InfoIcon size={16} className="mt-px shrink-0" />
        <span>
          <span className="font-semibold text-ink-2">Kein Kontoverlauf.</span> {reason}
          {/* A history that does not add up says nothing against the figure above. */}
          {!history.verified && figure && ' Der Saldo oben ist der, den deine Bank gemeldet hat.'}
        </span>
      </p>
    );
  }

  return (
    <figure className="mt-6 border-t border-line pt-5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-[14px] font-semibold text-ink">Kontoverlauf</span>
        <span className="tnum text-[13px] text-ink-3">{fmtRange(history.from, history.to)}</span>
      </figcaption>
      <BalanceChart points={history.points} currency={history.currency || currency} />
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
        Tagesendsaldo nach Buchungstag, aus den Umsätzen und Salden deiner Bank nachgerechnet.
      </p>
    </figure>
  );
}
