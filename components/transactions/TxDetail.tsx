'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  CATEGORIES, categoryLabel, counterpartyKey, txBic, type CategoryId, type CategorySource,
} from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtDate, fmtDayHeader, fmtIban, ibanCountry, isFutureDate } from '@/lib/format';
import { AMOUNT_MASK } from '@/lib/mask';
import { BankText } from '../BankText';
import { useFints } from '../FintsProvider';
import {
  ArrowRightIcon, BoltIcon, CategoryIcon, ChevronIcon, ClockIcon, ReceiptIcon, RepeatIcon, TransferIcon, UndoIcon,
} from '../icons';
import { MASKED_LABEL, Money, usePrivacy } from '../Money';
import {
  Button, CopyButton, Disclosure, Drawer, Menu, MenuGroup, MenuItemCheckbox, MenuItemRadio, MenuSeparator, Tag, cx,
} from '../ui';
import { CounterpartyAvatar } from './Avatar';
import { counterpartyQuery, countryName, referenceRows, statusTags, transferSeeds, txText, type StatusTag } from './model';

const SOURCE_TEXT: Record<CategorySource, string> = {
  auto: 'Automatisch erkannt',
  rule: 'Deine Regel für alle Umsätze',
  manual: 'Von dir gewählt',
};

/** SEPA purpose tags whose value is an amount: Ursprungsbetrag, Zinskompensationsbetrag. */
const AMOUNT_TAGS = new Set(['OAMT', 'COAM']);

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
    activeAccount, categoryOf, setCategory, vaultStatus, openTransfer, showTransactions, printTransaction,
  } = useFints();
  const text = txText(tx);
  const credit = tx.amount > 0;
  const tags = statusTags(tx, pending);
  const refs = useMemo(() => referenceRows(tx), [tx]);
  // The values of the SEPA tags that are amounts by definition (OAMT, COAM).
  const amountRefs = useMemo(
    () => new Set(text.parsed.fields.filter((f) => AMOUNT_TAGS.has(f.tag)).map((f) => f.value)),
    [text],
  );
  const privacy = usePrivacy();
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
    <Drawer open onClose={onClose} title={pending ? 'Vorgemerkter Umsatz' : 'Umsatzdetails'} bodyClassName="px-4 pt-6 pb-8 sm:px-6">
      {/* Who and how much — the two things the row already said, large. */}
      <div className="flex flex-col items-center text-center">
        <CounterpartyAvatar tx={tx} name={text.name} credit={credit} pending={pending} size="lg" />
        <p className="mt-3 max-w-full text-[17px] leading-snug font-semibold break-words text-ink">{text.name}</p>
        <p className="mt-1">
          <span className="sr-only">{credit ? 'Gutschrift' : 'Belastung'}</span>
          <Money value={tx.amount} currency={tx.currency} signed tone="credit" className="text-[32px] leading-tight font-bold" />
        </p>
        <p className="mt-1 text-[14px] text-ink-2">
          {[text.bookingText, when ? fmtDayHeader(when) : ''].filter(Boolean).join(' · ')}
        </p>
        {tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Status">
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
              Erneut überweisen
            </Button>
          )}
          {seeds.refund && (
            <Button size="sm" variant="secondary" iconLeft={<UndoIcon size={16} />} onClick={() => startTransfer(seeds.refund!)}>
              Zurücküberweisen
            </Button>
          )}
          <Button
            size="sm"
            variant={seeds.repeat || seeds.refund ? 'tertiary' : 'secondary'}
            iconLeft={<ReceiptIcon size={16} />}
            onClick={() => printTransaction(tx, pending)}
          >
            Beleg (PDF)
          </Button>
        </div>
      </div>

      <Section title="Zahlung">
        <Row half label="Buchungstag">
          {pending
            // A Vormerkposten's dates are the bank's provisional ones; the tag
            // above already says "Vorgemerkt".
            ? 'Noch nicht gebucht'
            : (
              <>
                <span className="tnum">{fmtDate(tx.entryDate)}</span>
                {future && <span className="block text-[13.5px] text-ink-2">noch nicht gebucht</span>}
              </>
            )}
        </Row>
        {tx.valueDate && (
          <Row half label="Wertstellung"><span className="tnum">{fmtDate(tx.valueDate)}</span></Row>
        )}
        {text.purposeLines.length > 0 && (
          // The copy stays unmasked: copying is the user's own act, and the
          // clipboard is not on the shared screen.
          <Row label="Verwendungszweck" copy={{ text: text.purposeLines.join(' '), label: 'Verwendungszweck kopieren' }}>
            {/* Bank text is untrusted: plain text only, one line per line the bank wrote. */}
            {text.purposeLines.map((line, i) => (
              <span key={i} className="block break-words"><BankText text={line} /></span>
            ))}
          </Row>
        )}
      </Section>

      {(text.rawName || iban) && (
        <Section
          title={credit ? 'Auftraggeber' : 'Empfänger'}
          after={query && (
            // A link in the run of the text rather than a padded pill: its
            // words start on the same edge as the labels above it.
            <button
              type="button"
              className="group mt-1 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-[4px] text-[14px] font-bold text-accent"
              onClick={() => {
                onClose();
                showTransactions({ query });
              }}
            >
              <span className="min-w-0 truncate underline-offset-[3px] group-hover:underline">Alle Umsätze mit {text.name}</span>
              <ArrowRightIcon size={16} />
            </button>
          )}
        >
          {text.rawName && <Row label="Name"><span className="break-words">{text.rawName}</span></Row>}
          {address && <Row label={place?.street ? 'Anschrift' : 'Ort'}><span className="break-words">{address}</span></Row>}
          {/* What the bank's FinTS answer actually says, whenever the line
              above shows something tidier — the card terminal's descriptor
              unabridged, so nothing the app derived is the only record. */}
          {text.bankName && text.bankName !== text.rawName && (
            <Row label="Name laut Bank" copy={{ text: text.bankName, label: 'Name laut Bank kopieren' }}>
              <span className="break-words">{text.bankName}</span>
            </Row>
          )}
          {/* The account the money actually moved to or from belongs to the
              payment provider (a card processor or acquirer), not to the shop
              named above — said here, so the IBAN below is never mistaken for
              the shop's. */}
          {text.via && <Row label="Zahlungsdienstleister"><span className="break-words">{text.via}</span></Row>}
          {iban && (
            <Row label={text.via ? 'IBAN des Zahlungsdienstleisters' : 'IBAN'} copy={{ text: iban, label: 'IBAN kopieren' }}>
              <span className="iban text-[14px]">{fmtIban(iban)}</span>
            </Row>
          )}
          {bic && (
            <Row half label="BIC" copy={{ text: bic, label: 'BIC kopieren' }}>
              <span className="iban text-[14px]">{bic}</span>
            </Row>
          )}
          {country && <Row half label="Land">{country.name}</Row>}
        </Section>
      )}

      <CategorySection tx={tx} name={text.name} vaultSaves={vaultStatus === 'ready'} categoryOf={categoryOf} setCategory={setCategory} />

      {refs.length > 0 && (
        <div className="mt-6 border-t border-line pt-2">
          <Disclosure
            className="-mx-4"
            title={
              <span className="text-[15px] font-bold text-headline">
                Referenzen <span className="tnum font-semibold text-ink-3">({refs.length})</span>
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
                        ? <span role="img" aria-label={MASKED_LABEL}>{AMOUNT_MASK}</span>
                        : <BankText text={r.value} />}
                    </dd>
                  </div>
                  <CopyButton text={r.value} label={`${r.label} kopieren`} className="-mr-1" />
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

/**
 * How the app filed the booking, and where the user changes it. The source
 * line keeps a guess visibly a guess. "Für alle Umsätze von …" turns the
 * choice into a rule for the counterparty — set it before picking.
 */
function CategorySection({
  tx, name, vaultSaves, categoryOf, setCategory,
}: {
  tx: SerializedTransaction;
  name: string;
  vaultSaves: boolean;
  categoryOf: (tx: SerializedTransaction) => { id: CategoryId; source: CategorySource };
  setCategory: (tx: SerializedTransaction, id: CategoryId, opts?: { rule?: boolean }) => void;
}) {
  const current = categoryOf(tx);
  const canRule = counterpartyKey(tx) !== 'name:?';
  const [forAll, setForAll] = useState(current.source === 'rule');
  const [changed, setChanged] = useState<{ id: CategoryId; rule: boolean } | null>(null);

  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="mt-6 border-t border-line pt-5">
      <h3 id={titleId} className="text-[15px] font-bold text-headline">Kategorie</h3>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <CategoryIcon id={current.id} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-ink">{categoryLabel(current.id)}</p>
          <p className="text-[13px] leading-snug text-ink-3">
            {current.source === 'rule' ? `${SOURCE_TEXT.rule} von ${name}` : SOURCE_TEXT[current.source]}
          </p>
        </div>
        <Menu
          placement="bottom-end"
          label="Kategorie wählen"
          minWidth={280}
          trigger={(p, { open }) => (
            <Button {...p} size="sm" variant="secondary" aria-label={`Kategorie ändern, aktuell ${categoryLabel(current.id)}`}>
              Ändern
              <ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 transition-transform duration-150', open && 'rotate-180')} />
            </Button>
          )}
        >
          {canRule && (
            <>
              <MenuItemCheckbox checked={forAll} onSelect={() => setForAll((v) => !v)}>
                Für alle Umsätze von {name} übernehmen
              </MenuItemCheckbox>
              <MenuSeparator />
            </>
          )}
          {/* Every category, whichever way the money went: a shop's refund
              belongs to that shop's category and reduces it in the Analyse. */}
          <MenuGroup label="Kategorie">
            {CATEGORIES.map((c) => (
              <MenuItemRadio
                key={c.id}
                checked={current.id === c.id}
                icon={<CategoryIcon id={c.id} />}
                onSelect={() => {
                  const rule = canRule && forAll;
                  setCategory(tx, c.id, { rule });
                  setChanged({ id: c.id, rule });
                }}
              >
                {c.label}
              </MenuItemRadio>
            ))}
          </MenuGroup>
        </Menu>
      </div>
      <p className="sr-only" aria-live="polite">
        {changed
          ? `Kategorie ${categoryLabel(changed.id)} gespeichert${changed.rule ? ` für alle Umsätze von ${name}` : ''}.`
          : ''}
      </p>
      {changed && !vaultSaves && (
        <p className="mt-2 text-[13px] text-ink-3">Gilt nur für diese Sitzung — deine persönlichen Daten werden gerade nicht gespeichert.</p>
      )}
    </section>
  );
}
