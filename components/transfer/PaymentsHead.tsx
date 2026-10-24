'use client';

// The head of Zahlungen, the place for paying (DESIGN.md, Navigation): the
// two things people come here to do, then the people they pay. Überweisen is
// the filled button — on a phone there is no floating one any more, this is
// where it lives — Geld anfordern the tonal one beside it, and on Android
// "GiroCode scannen" for an invoice on paper. Below them the user's own
// templates, then whoever this session's Umsätze show them paying, newest
// first (recentPayees): a press opens the transfer with name and IBAN filled
// in, and the transfer's review, Namensabgleich and Freigabe run as always.
// The regular payments (Verträge & Abos, the bank's orders) follow on the
// page (components/Contracts.tsx).

import { useMemo, useRef } from 'react';
import type { TransferPrefill, TransferTemplate } from '@/lib/app-types';
import { initials } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { DocScanIcon, QrIcon, ScanIcon, StarIcon, TransferIcon } from '../icons';
import { useShellActions } from '../shell/actions';
import { Button } from '../ui';
import { recentPayees, shortIbanText, sortTemplates } from './model';

/** Payees listed under "Zuletzt bezahlt", at most. */
const RECENT = 5;

export function PaymentsHead() {
  const { txByAccount, vault, openTransfer, accounts } = useFints();
  const invoiceInput = useRef<HTMLInputElement>(null);
  const actions = useShellActions();
  const t = useT();
  const words = t.shell.payments;

  const templates = useMemo(() => sortTemplates(vault?.templates ?? []).slice(0, RECENT), [vault?.templates]);
  const recent = useMemo(() => {
    const compact = (iban: string) => iban.replace(/\s+/g, '').toUpperCase();
    // A payee with a template is listed once, under Vorlagen; the user's own
    // accounts are no payees (an Umbuchung is not "bezahlt").
    const skip = new Set([
      ...templates.map((x) => compact(x.iban)),
      ...accounts.flatMap((a) => (a.iban ? [compact(a.iban)] : [])),
    ]);
    return recentPayees(txByAccount, { limit: RECENT + skip.size }).filter((p) => !skip.has(p.iban)).slice(0, RECENT);
  }, [txByAccount, templates, accounts]);

  if (!actions.canTransfer && !actions.canShare) return null;

  const fromTemplate = (x: TransferTemplate): TransferPrefill => ({
    name: x.name, iban: x.iban, amount: x.amount, purpose: x.purpose, instant: x.instant, source: 'template',
  });

  return (
    <section aria-label={t.common.nav.contracts} className="panel">
      {/* The two reasons to come here, side by side and the same width —
          stacked once the system's large text no longer fits both labels
          (each at least as wide as its own label, so the row wraps). */}
      <div className="flex flex-wrap gap-2 px-4 pt-1 pb-2 sm:px-5">
        {actions.canTransfer && (
          <Button variant="primary" className="min-w-fit flex-1" iconLeft={<TransferIcon size={20} strokeWidth={2} />} onClick={actions.transfer}>
            {t.shell.transfer}
          </Button>
        )}
        {actions.canShare && (
          <Button variant="secondary" className="min-w-fit flex-1" iconLeft={<QrIcon size={20} />} onClick={actions.share}>
            {t.shell.requestMoney}
          </Button>
        )}
      </div>
      {/* Android: an invoice on paper, read by the camera into the transfer. */}
      {IS_ANDROID && actions.canTransfer && (
        <ul className="pt-1">
          <PayeeRow
            name={t.transfer.giro.scan}
            detail={words.scanHint}
            glyph={<ScanIcon size={20} />}
            label={t.transfer.giro.scan}
            onClick={() => openTransfer({ girocode: { scan: true } })}
          />
          {/* An invoice without a GiroCode: photographed, and its text read on the phone. */}
          <PayeeRow
            name={t.transfer.giro.scanInvoice}
            detail={words.scanInvoiceHint}
            glyph={<DocScanIcon size={20} />}
            label={t.transfer.giro.scanInvoice}
            onClick={() => openTransfer({ girocode: { docScan: true } })}
          />
        </ul>
      )}

      {/* The desktop: an invoice as a PDF or a picture, with its GiroCode or
          without — read into the transfer, the page beside the form. */}
      {!IS_ANDROID && actions.canTransfer && (
        <ul className="pt-1">
          <PayeeRow
            name={words.openInvoice}
            detail={words.openInvoiceHint}
            glyph={<DocScanIcon size={20} />}
            label={words.openInvoice}
            onClick={() => invoiceInput.current?.click()}
          />
          <input
            ref={invoiceInput}
            type="file"
            accept="image/*,application/pdf"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) openTransfer({ girocode: { file } });
            }}
          />
        </ul>
      )}

      {actions.canTransfer && templates.length > 0 && (
        <PayeeGroup title={words.templates}>
          {templates.map((x) => (
            <PayeeRow
              key={x.id}
              name={x.label || x.name}
              detail={x.label && x.label !== x.name ? `${x.name} · ${shortIbanText(x.iban)}` : shortIbanText(x.iban)}
              glyph={<StarIcon size={20} />}
              label={words.payAgain(x.label || x.name)}
              onClick={() => openTransfer(fromTemplate(x))}
            />
          ))}
        </PayeeGroup>
      )}

      {actions.canTransfer && recent.length > 0 && (
        <PayeeGroup title={words.recent}>
          {recent.map((p) => (
            <PayeeRow
              key={p.iban}
              name={p.name}
              detail={shortIbanText(p.iban)}
              glyph={initials(p.name)}
              label={words.payAgain(p.name)}
              onClick={() => openTransfer({ name: p.name, iban: p.iban, source: 'recent' })}
            />
          ))}
        </PayeeGroup>
      )}
    </section>
  );
}

function PayeeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h2 className="px-4 pt-2 pb-1 text-[14px] leading-5 font-medium text-ink-2 sm:px-5">{title}</h2>
      <ul>{children}</ul>
    </div>
  );
}

function PayeeRow({ name, detail, glyph, label, onClick }: {
  name: string; detail: string; glyph: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="row-focus flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--inset)_55%,var(--surface))] sm:px-5"
      >
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-inset text-[14px] font-semibold text-ink-2">
          {glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{name}</span>
          <span className="block truncate text-[13px] leading-snug text-ink-3">{detail}</span>
        </span>
      </button>
    </li>
  );
}
