'use client';

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { facilitatorShop } from '@/lib/analytics';
import {
  CATEGORIES, categoryLabel, counterpartyKey, isCategoryId, txBic, type CategoryId, type CategorySource,
} from '@/lib/categories';
import { guessCategory } from '@/lib/categorize';
import type { SerializedTransaction } from '@/lib/fints-types';
import { displayName, fmtDate, fmtDayHeader, fmtIban, ibanCountry, isFutureDate, toLocalDate } from '@/lib/format';
import { intlLocale, msgs, type Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { AMOUNT_MASK } from '@/lib/mask';
import { BankText } from '../BankText';
import { useFints } from '../FintsProvider';
import {
  ArrowRightIcon, BoltIcon, CategoryIcon, ChevronIcon, ClockIcon, ReceiptIcon, RepeatIcon, TransferIcon, UndoIcon,
} from '../icons';
import { maskedLabel, Money, usePrivacy } from '../Money';
import {
  Button, CopyButton, Disclosure, Drawer, Menu, MenuGroup, MenuItem, MenuItemRadio, MenuSeparator, Tag, cx,
} from '../ui';
import { CounterpartyAvatar } from './Avatar';
import {
  cardFacts, counterpartyQuery, countryName, merchantFor, referenceRows, shortDay, statusTags, transferSeeds, txText,
  type StatusTag,
} from './model';

/** SEPA purpose tags whose value is an amount: Ursprungsbetrag, Zinskompensationsbetrag. */
const AMOUNT_TAGS = new Set(['OAMT', 'COAM']);

/** "1,1563" ("1.1563") — a rate as the bank wrote it, without the float's tail. */
const fmtRate = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 6 });

const TAG_ICON: Record<NonNullable<StatusTag['icon']>, ReactNode> = {
  clock: <ClockIcon size={13} />,
  bolt: <BoltIcon size={13} />,
  repeat: <RepeatIcon size={13} />,
};

/**
 * Umsatzdetails — everything one booking says, in the order a person asks:
 * how much and with whom, then the payment itself, the other account, how the
 * app filed it, and only last (collapsed) the identifiers the bank attached.
 *
 * The actions reuse existing flows only: a transfer is prefilled and still
 * goes through review, Namensabgleich and TAN; the receipt is the print
 * sheet; "Alle Umsätze mit …" is a search on what is already loaded.
 */
export function TxDetail({
  tx, pending, onClose,
}: {
  tx: SerializedTransaction;
  pending: boolean;
  onClose: () => void;
}) {
  const {
    activeAccount, categoryOf, openTransfer, showTransactions, printTransaction,
  } = useFints();
  // `tr`, not `t`: in this file `t` is a booking.
  const tr = useT();
  const words = tr.transactions.detail;
  const text = txText(tx);
  const credit = tx.amount > 0;
  const tags = statusTags(tx, pending);
  // Labels in words: built again when the language changes.
  const refs = useMemo(() => referenceRows(tx), [tx, tr]);
  // The values of the SEPA tags that are amounts by definition (OAMT, COAM).
  const amountRefs = useMemo(
    () => new Set(text.parsed.fields.filter((f) => AMOUNT_TAGS.has(f.tag)).map((f) => f.value)),
    [text],
  );
  const privacy = usePrivacy();
  const card = useMemo(() => cardFacts(tx), [tx, tr]);
  // The bank's own name for the counterparty, and — when the header shows a
  // shop the app worked out (from a card terminal's descriptor, or from what
  // a payment service wrote into the purpose) — that shop, labelled as such.
  const bankName = text.bankName || text.rawName;
  const recognised = facilitatorShop(tx) ? text.name : text.rawName !== bankName ? text.rawName : null;
  // The category as it stands now — refiling a credit as "Einkommen" in the
  // section below takes "Zurücküberweisen" away at once.
  const seeds = transferSeeds(tx, !!activeAccount?.canTransfer, categoryOf(tx).id);
  const query = counterpartyQuery(tx);
  const iban = String(tx.remoteIban ?? '').replace(/\s+/g, '');
  const bic = txBic(tx);
  // Where the terminal stood beats the IBAN's country: behind a card
  // processor the IBAN is the processor's, wherever the shop was.
  // The shop's country belongs with its address, not under the provider's
  // IBAN — there it would read as that account's country.
  const place = text.place;
  const address = place ? [place.street, place.city, place.country ? countryName(place.country) : ''].filter(Boolean).join(', ') : '';
  // Behind a payment provider the IBAN's country is the provider's, not the shop's.
  const country = place || text.via ? null : ibanCountry(iban);
  const future = !pending && isFutureDate(tx.entryDate);
  const when = tx.entryDate || tx.valueDate;

  // A transfer replaces the drawer rather than stacking on it. Opened on the
  // next tick, once the drawer has handed focus back to the row, so the
  // transfer sheet in turn returns focus there when it closes.
  const startTransfer = (seed: NonNullable<typeof seeds.repeat>) => {
    onClose();
    setTimeout(() => openTransfer(seed), 0);
  };

  return (
    <Drawer open onClose={onClose} title={pending ? words.pendingTitle : words.title} bodyClassName="px-4 pt-6 pb-8 sm:px-6">
      {/* Who and how much — the two things the row already said, large. */}
      <div className="flex flex-col items-center text-center">
        <CounterpartyAvatar tx={tx} name={text.name} credit={credit} pending={pending} size="lg" />
        <p className="mt-3 max-w-full text-[17px] leading-snug font-semibold break-words text-ink">{text.name}</p>
        <p className="mt-1">
          <span className="sr-only">{credit ? tr.common.booking.credit : tr.common.booking.debit}</span>
          <Money value={tx.amount} currency={tx.currency} signed tone="credit" className="text-[32px] leading-tight font-bold" />
        </p>
        <p className="mt-1 text-[14px] text-ink-2">
          {/* A card payment says when the card was used — the Buchungstag
              below can be a day or two later, even still ahead. */}
          {[
            text.bookingText,
            card?.usedAt
              ? words.paidOn(shortDay(card.usedAt.day), card.usedAt.time)
              : when ? fmtDayHeader(when) : '',
          ].filter(Boolean).join(' · ')}
        </p>
        {tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label={words.status}>
            {tags.map((t) => (
              <li key={t.label}>
                <Tag tone={t.tone} icon={t.icon ? TAG_ICON[t.icon] : undefined}>{t.label}</Tag>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {seeds.repeat && (
            <Button size="sm" variant="secondary" iconLeft={<TransferIcon size={16} />} onClick={() => startTransfer(seeds.repeat!)}>
              {words.repeat}
            </Button>
          )}
          {seeds.refund && (
            <Button size="sm" variant="secondary" iconLeft={<UndoIcon size={16} />} onClick={() => startTransfer(seeds.refund!)}>
              {words.refund}
            </Button>
          )}
          <Button
            size="sm"
            variant={seeds.repeat || seeds.refund ? 'tertiary' : 'secondary'}
            iconLeft={<ReceiptIcon size={16} />}
            onClick={() => printTransaction(tx, pending)}
          >
            {words.receipt}
          </Button>
        </div>
      </div>

      <Section title={words.payment}>
        <Row half label={tr.transactions.entryDate}>
          {pending
            // A Vormerkposten's dates are the bank's provisional ones; the tag
            // above already says "Vorgemerkt".
            ? tr.transactions.notBooked
            : (
              <>
                <span className="tnum">{fmtDate(tx.entryDate)}</span>
                {future && <span className="block text-[13.5px] text-ink-2">{tr.transactions.state.ahead}</span>}
              </>
            )}
        </Row>
        {tx.valueDate && (
          <Row half label={tr.transactions.valueDate}><span className="tnum">{fmtDate(tx.valueDate)}</span></Row>
        )}
        {/* The card system's record, said in words: when, which card, what
            it cost abroad. Amounts through <Money>, so "Beträge ausblenden"
            masks them like every other. */}
        {card?.usedAt && (
          <Row half label={words.paidAt}>
            <span className="tnum">{fmtDate(toLocalDate(card.usedAt.day))}{card.usedAt.time && `, ${tr.transactions.clock(card.usedAt.time)}`}</span>
          </Row>
        )}
        {card?.card && <Row half label={words.card}>{card.card}</Row>}
        {card?.original && (
          <Row label={words.original}>
            <Money value={card.original.amount} currency={card.original.currency} tone="plain" />
            {card.original.rate != null && (
              <span className="tnum text-ink-2"> · {words.rate(fmtRate(card.original.rate), card.original.currency)}</span>
            )}
          </Row>
        )}
        {card?.fee != null && (
          <Row label={words.fee}>
            <Money value={card.fee} currency="EUR" tone="plain" />
            {card.feeIncluded && <span className="text-ink-2"> · {words.feeIncluded}</span>}
          </Row>
        )}
        {text.purposeLines.length > 0 && (
          // The copy stays unmasked: copying is the user's own act, and the
          // clipboard is not on the shared screen.
          <Row
            label={tr.common.booking.purpose}
            copy={{ text: text.purposeLines.join(' '), label: words.copy(tr.common.booking.purpose) }}
          >
            {/* Bank text is untrusted: plain text only, one line per line the bank wrote. */}
            {text.purposeLines.map((line, i) => (
              <span key={i} className="block break-words"><BankText text={line} /></span>
            ))}
          </Row>
        )}
      </Section>

      {(bankName || iban) && (
        <Section
          title={credit ? words.payer : words.recipient}
          after={query && (
            // A link in the run of the text rather than a padded pill: its
            // words start on the same edge as the labels above it.
            <button
              type="button"
              className="group mt-1 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-[4px] text-[14px] font-semibold text-accent"
              onClick={() => {
                onClose();
                showTransactions({ query });
              }}
            >
              <span className="min-w-0 truncate underline-offset-[3px] group-hover:underline">{words.allWith(text.name)}</span>
              <ArrowRightIcon size={16} />
            </button>
          )}
        >
          {/* What the bank's FinTS answer says, first and always under the
              same label — the card terminal's descriptor unabridged, so
              nothing the app derived is ever the only record. A shop the app
              worked out from it sits below, called what it is. */}
          {bankName && (
            <Row label={words.bankName} copy={{ text: bankName, label: words.copy(words.bankName) }}>
              <span className="break-words">{bankName}</span>
            </Row>
          )}
          {recognised && <Row label={words.shop}><span className="break-words">{recognised}</span></Row>}
          {address && <Row label={place?.street ? words.address : words.place}><span className="break-words">{address}</span></Row>}
          {/* The account the money actually moved to or from belongs to the
              payment provider (a card processor or acquirer), not to the shop
              named above — said here, so the IBAN below is never mistaken for
              the shop's. */}
          {text.via && <Row label={words.provider}><span className="break-words">{text.via}</span></Row>}
          {iban && (
            <Row label={text.via ? words.providerIban : 'IBAN'} copy={{ text: iban, label: tr.common.account.copyIban }}>
              <span className="iban text-[14px]">{fmtIban(iban)}</span>
            </Row>
          )}
          {bic && (
            <Row half label="BIC" copy={{ text: bic, label: words.copy('BIC') }}>
              <span className="iban text-[14px]">{bic}</span>
            </Row>
          )}
          {country && <Row half label={words.country}>{country.name}</Row>}
        </Section>
      )}

      <CategorySection tx={tx} name={text.name} />

      {refs.length > 0 && (
        <div className="mt-6 border-t border-line pt-2">
          <Disclosure
            className="-mx-4"
            title={
              <span className="text-[15px] font-bold text-headline">
                {tr.transactions.refs.title} <span className="tnum font-semibold text-ink-3">({refs.length})</span>
              </span>
            }
          >
            <dl className="px-4 pb-2">
              {refs.map((r, i) => (
                <div key={`${r.label}-${i}`} className="flex items-start gap-2 border-b border-line py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <dt className="text-[13px] font-semibold text-ink-3">{r.label}</dt>
                    <dd className="num mt-0.5 text-[13.5px] break-all text-ink">
                      {/* An Ursprungsbetrag is an amount whatever its shape; the rest
                          (the original purpose above all) is masked like prose. */}
                      {privacy && amountRefs.has(r.value)
                        ? <span role="img" aria-label={maskedLabel()}>{AMOUNT_MASK}</span>
                        : <BankText text={r.value} />}
                    </dd>
                  </div>
                  <CopyButton text={r.value} label={words.copy(r.label)} className="-mr-1" />
                </div>
              ))}
            </dl>
          </Disclosure>
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children, after }: { title: string; children: ReactNode; after?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 border-t border-line pt-5">
      <h3 id={id} className="text-[15px] font-bold text-headline">{title}</h3>
      <dl className="mt-1 grid grid-cols-2 gap-x-4">{children}</dl>
      {after}
    </section>
  );
}

/**
 * One labelled value: label above, value below. Long values (a purpose, an
 * IBAN) take the full width; short facts (two dates, BIC and country) pair up.
 */
function Row({
  label, children, copy, half,
}: { label: string; children: ReactNode; copy?: { text: string; label: string }; half?: boolean }) {
  return (
    <div className={cx('flex min-w-0 items-start gap-2 py-2', half ? 'col-span-1' : 'col-span-2')}>
      <div className="min-w-0 flex-1">
        <dt className="text-[13px] font-semibold text-ink-3">{label}</dt>
        <dd className="mt-0.5 text-[15px] leading-snug text-ink">{children}</dd>
      </div>
      {copy && <CopyButton text={copy.text} label={copy.label} className="-mr-1" />}
    </div>
  );
}

/** The category groups of the menu, the booking's own direction first. */
function menuGroups(credit: boolean, tr: Messages): { label: string; ids: CategoryId[] }[] {
  const { common: { booking }, transactions: { categorize: words } } = tr;
  const spend = CATEGORIES.filter((c) => !c.neutral && c.direction !== 'in').map((c) => c.id);
  const income = CATEGORIES.filter((c) => c.direction === 'in').map((c) => c.id);
  const own = CATEGORIES.filter((c) => c.neutral).map((c) => c.id);
  return credit
    ? [
        // Interest received is a credit in "Bankentgelte & Zinsen".
        { label: booking.incoming, ids: [...income, 'fees'] },
        // A shop's refund belongs to that shop's category and reduces it in the Analyse.
        { label: words.refundGroup, ids: spend.filter((id) => id !== 'fees') },
        { label: words.ownGroup, ids: own },
      ]
    : [
        { label: booking.spending, ids: spend },
        { label: booking.incoming, ids: income },
        { label: words.ownGroup, ids: own },
      ];
}

/** What just happened in the section — said beside the category, and to a screen reader. */
type Step =
  | { kind: 'picked'; id: CategoryId }
  | { kind: 'ruled'; id: CategoryId }
  | { kind: 'undone'; id: CategoryId; byRule: boolean }
  | { kind: 'unruled' };

/**
 * How the app filed the booking, and where the user changes it. The source
 * line keeps a guess visibly a guess. A pick files this one booking; only
 * then does the section offer to do the same for the counterparty's other
 * bookings — the choice first, its reach second, the way people correct
 * things. A choice for one booking can be undone ("Automatisch (…)"), a rule
 * removed, and every rule is listed below.
 */
function CategorySection({ tx, name }: { tx: SerializedTransaction; name: string }) {
  const {
    categoryOf, setCategory, removeCategoryRule, vault, vaultStatus, ownIbans, merchants, txByAccount,
  } = useFints();
  const tr = useT();
  const words = tr.transactions.categorize;
  const current = categoryOf(tx);
  const who = counterpartyKey(tx);
  const canRule = who !== 'name:?';
  const rules = vault?.categoryRules;
  const ruled = canRule && rules && isCategoryId(rules[who]) ? rules[who] : null;
  // What the booking falls back to without a choice for it alone: the rule,
  // else the automatic guess.
  const fallback: { id: CategoryId; source: CategorySource } = ruled
    ? { id: ruled, source: 'rule' }
    : { id: guessCategory(tx, { ownIbans, merchantLabel: merchantFor(merchants, tx)?.label ?? null }), source: 'auto' };
  // The counterparty's other loaded bookings — what "für alle" reaches today.
  const others = useMemo(() => {
    if (!canRule) return 0;
    let n = 0;
    for (const list of Object.values(txByAccount)) for (const t of list) if (t !== tx && counterpartyKey(t) === who) n++;
    return n;
  }, [canRule, txByAccount, tx, who]);
  const [step, setStep] = useState<Step | null>(null);
  const vaultSaves = vaultStatus === 'ready';
  const titleId = useId();
  // The control that stays: where focus goes when the one that held it
  // (the offer, "Regel entfernen") goes away.
  const changeRef = useRef<HTMLElement | null>(null);
  const refocus = () => setTimeout(() => changeRef.current?.focus(), 0);

  const pick = (id: CategoryId) => {
    if (id === current.id && current.source === 'manual') return;
    setCategory(tx, id);
    setStep({ kind: 'picked', id });
  };
  const applyToAll = (id: CategoryId) => {
    setCategory(tx, id, { rule: true });
    setStep({ kind: 'ruled', id });
    refocus();
  };
  const undo = () => {
    setCategory(tx, null);
    setStep({ kind: 'undone', id: fallback.id, byRule: fallback.source === 'rule' });
  };
  const unrule = () => {
    removeCategoryRule(who);
    setStep({ kind: 'unruled' });
    refocus();
  };

  // The offer to reach further — only after a pick a rule does not already make.
  const offer = canRule && step?.kind === 'picked' && current.source === 'manual' && ruled !== step.id ? step.id : null;
  const status = !step
    ? ''
    : step.kind === 'picked'
      ? words.filedAs(categoryLabel(step.id))
      : step.kind === 'ruled'
        ? words.ruled(name, categoryLabel(step.id))
        : step.kind === 'undone'
          ? words.undone(categoryLabel(step.id), step.byRule)
          : words.unruled(name);

  return (
    <section aria-labelledby={titleId} className="mt-6 border-t border-line pt-5">
      <h3 id={titleId} className="text-[15px] font-bold text-headline">{tr.transactions.category}</h3>
      <div className="mt-3 flex items-center gap-3">
        {/* A glyph, not a control: inset grey, so the one blue here is "Ändern". */}
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-inset text-ink-2">
          <CategoryIcon id={current.id} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-ink">{categoryLabel(current.id)}</p>
          <p className="text-[13px] leading-snug text-ink-3">
            {current.source === 'rule' ? words.ruleWith(name) : words.source[current.source]}
          </p>
        </div>
        <Menu
          placement="bottom-end"
          label={tr.transactions.chooseCategory}
          minWidth={280}
          trigger={(p, { open }) => (
            <Button
              {...p}
              ref={(el) => { p.ref(el); changeRef.current = el; }}
              size="sm"
              variant="secondary"
              aria-label={words.changeLabel(categoryLabel(current.id))}
            >
              {words.change}
              <ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 transition-transform duration-150', open && 'rotate-180')} />
            </Button>
          )}
        >
          {current.source === 'manual' && (
            <>
              <MenuItem
                icon={<UndoIcon size={18} />}
                description={fallback.source === 'rule' ? words.yourRuleFor(name) : words.howAppFiles}
                onSelect={undo}
              >
                {words.undoItem(fallback.source === 'rule', categoryLabel(fallback.id))}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {menuGroups(tx.amount > 0, tr).map((g) => (
            <MenuGroup key={g.label} label={g.label}>
              {g.ids.map((id) => (
                <MenuItemRadio key={id} checked={current.id === id} icon={<CategoryIcon id={id} />} onSelect={() => pick(id)}>
                  {categoryLabel(id)}
                </MenuItemRadio>
              ))}
            </MenuGroup>
          ))}
        </Menu>
      </div>

      {current.source === 'rule' && (
        <Button size="xs" variant="tertiary" className="mt-2 -ml-3" onClick={unrule}>
          {words.removeRule(name)}
        </Button>
      )}

      {offer && (
        // Choice first, reach second: the pick is saved; this only widens it.
        <div className="mt-3 rounded-[8px] bg-inset px-4 py-3">
          <p className="text-[14px] leading-snug text-ink">
            {others > 0
              ? words.offerOthers(others, name, categoryLabel(offer))
              : words.offerFuture(name, categoryLabel(offer))}
          </p>
          {others > 0 && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{words.alsoFuture}</p>}
          <Button size="xs" variant="secondary" className="mt-2.5" onClick={() => applyToAll(offer)}>
            {others > 0 ? words.applyAll : words.saveRule}
          </Button>
        </div>
      )}

      {step && step.kind !== 'picked' && <p className="mt-2 text-[13px] leading-snug text-ink-2">{status}</p>}
      <p className="sr-only" aria-live="polite">{status}</p>
      {step && !vaultSaves && (
        <p className="mt-2 text-[13px] text-ink-3">{words.sessionOnly}</p>
      )}

      {rules && (
        <RuleList
          rules={rules}
          onRemove={(key) => {
            removeCategoryRule(key);
            refocus();
          }}
        />
      )}
    </section>
  );
}

/** A rule's counterparty in words: the name its loaded bookings show, else the key itself, readable. */
function ruleName(key: string, names: ReadonlyMap<string, string>): string {
  const known = names.get(key);
  if (known) return known;
  const colon = key.indexOf(':');
  const kind = key.slice(0, colon);
  const value = key.slice(colon + 1);
  if (kind === 'iban') return fmtIban(value);
  if (kind === 'cred') return `${msgs().common.booking.creditorId} ${value}`;
  return displayName(value) || value;
}

/**
 * Every "für alle Umsätze von …" the user has set, with the way out — here,
 * where rules are made, rather than in a settings screen nobody finds.
 */
function RuleList({ rules, onRemove }: { rules: Record<string, CategoryId>; onRemove: (key: string) => void }) {
  const { txByAccount, pendingCache } = useFints();
  const tr = useT();
  const words = tr.transactions.categorize;
  const [open, setOpen] = useState(false);
  const entries = Object.entries(rules).filter(([, id]) => isCategoryId(id));
  // Names only while the list is open: finding them walks every loaded booking.
  // A name the bank left out is said in words, so the language is a dependency.
  const names = useMemo(() => {
    const out = new Map<string, string>();
    if (!open) return out;
    for (const list of [...Object.values(txByAccount), ...Object.values(pendingCache)]) {
      for (const t of list) {
        const key = counterpartyKey(t);
        if (rules[key] && !out.has(key)) out.set(key, txText(t).name);
      }
    }
    return out;
  }, [open, rules, txByAccount, pendingCache, tr]);
  if (!entries.length) return null;
  return (
    <Disclosure
      className="-mx-4 mt-3"
      open={open}
      onToggle={() => setOpen((o) => !o)}
      title={
        <span className="text-[14px] font-semibold text-ink-2">
          {words.rules} <span className="tnum text-ink-3">({entries.length})</span>
        </span>
      }
    >
      {open && (
        <ul className="px-4 pb-1">
          {entries
            .map(([key, id]) => ({ key, id, name: ruleName(key, names) }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            .map((r) => (
              <li key={r.key} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{r.name}</span>
                  <span className="flex items-center gap-1 text-[13px] text-ink-3">
                    <CategoryIcon id={r.id} size={14} /> {categoryLabel(r.id)}
                  </span>
                </span>
                <Button size="xs" variant="tertiary" aria-label={words.removeRule(r.name)} onClick={() => onRemove(r.key)}>
                  {words.remove}
                </Button>
              </li>
            ))}
        </ul>
      )}
    </Disclosure>
  );
}
