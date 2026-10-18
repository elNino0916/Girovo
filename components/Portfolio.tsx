'use client';

// The Depot tile: what a securities account holds (HKWPD) — in the place of
// the Umsätze, which a Depot has none of over FinTS. Each holding with its
// quantity, the bank's last price and its value; where the bank says what a
// unit cost, the change since. The bank's own total is the hero's figure;
// it is never summed up from the holdings (one missing value would make it
// wrong).
//
// Prices are the bank's as of its last report, not live, and the tile says
// so. "Beträge ausblenden" masks the values, the prices and the quantities
// alike: any of them gives the others away.
//
// Until the first read the tile is its heading alone: the hero above offers
// the read, says it is under way or why it failed, and when it was made —
// asked three times on one screen, it would read as three different things.

import { useId } from 'react';
import type { SerializedHolding } from '@/lib/fints-types';
import { fmtDate } from '@/lib/format';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { AMOUNT_MASK } from '@/lib/mask';
import { useFints } from './FintsProvider';
import { RefreshIcon, TrendUpIcon } from './icons';
import { Money, maskedLabel, usePrivacy } from './Money';
import { EmptyState, IconButton, Spinner, cx } from './ui';

const number = (v: number, digits = 4) =>
  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(v);

export function Portfolio() {
  const { activeAccount: a, portfolios, portfolioLoading, loadPortfolio, busy } = useFints();
  const t = useT();
  const words = t.depot;
  const titleId = useId();
  if (!a) return null;
  const p = portfolios[a.accountNumber];
  const loading = portfolioLoading === a.accountNumber;
  const read = () => void loadPortfolio(a);

  let body: React.ReactNode = null;
  if (p && !p.holdings.length) {
    body = <EmptyState icon={<TrendUpIcon size={22} />} title={words.empty} />;
  } else if (p) {
    body = (
      <>
        {/* The total is the hero's (components/overview/AccountHero.tsx DepotHero): not said twice. */}
        <ul className="divide-y divide-line border-t border-line">
          {p.holdings.map((h, i) => <HoldingRow key={`${h.isin ?? h.wkn ?? h.name}-${i}`} h={h} />)}
        </ul>
        <p className="px-4 py-3 text-[12.5px] leading-snug text-ink-3 sm:px-5">{words.pricesNote}</p>
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} aria-busy={loading || undefined} className="panel overflow-clip">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="section-head">{words.title}</h2>
          {/* When it was read is the hero's to say. */}
          {p && <p className="tnum mt-0.5 truncate text-[13.5px] text-ink-3">{words.holdings(p.holdings.length)}</p>}
        </div>
        {p && (
          <IconButton
            size="md"
            className="-mt-0.5 -mr-1.5"
            aria-label={`${words.refresh}. ${t.common.mayNeedApproval}`}
            disabled={busy}
            onClick={read}
          >
            {loading ? <Spinner size={16} /> : <RefreshIcon size={18} />}
          </IconButton>
        )}
      </div>
      {body}
    </section>
  );
}

/** One holding: name and identifiers, quantity and price, value and its change since the purchase. */
function HoldingRow({ h }: { h: SerializedHolding }) {
  const words = useT().depot;
  const privacy = usePrivacy();
  const hidden = (text: string) => (privacy ? AMOUNT_MASK : text);
  const price = h.price == null ? null
    : h.pricePercent ? words.pricePercent(hidden(number(h.price * 100, 3)))
      : words.price(hidden(new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: h.currency }).format(h.price)));
  // The change since the purchase, only where both prices are per unit in the same terms.
  const change = h.acquisitionPrice && h.price != null && !h.pricePercent ? h.price / h.acquisitionPrice - 1 : null;
  const id = h.isin ? `${words.isin} ${h.isin}` : h.wkn ? `${words.wkn} ${h.wkn}` : null;

  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink">{h.name}</p>
        <p className="tnum mt-0.5 text-[13px] leading-snug text-ink-3">
          {[
            id,
            h.quantity != null ? words.units(hidden(number(h.quantity))) : null,
            price ? `${price}${h.priceDate ? ` ${words.priceOn(fmtDate(h.priceDate))}` : ''}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {h.value != null && <Money value={h.value} currency={h.currency} className="text-[15px] font-semibold" />}
        {change != null && (
          <p className={cx('tnum text-[12.5px] leading-snug', change >= 0 ? 'text-green' : 'text-red')}>
            {privacy ? (
              <span role="img" aria-label={maskedLabel()}>{AMOUNT_MASK}</span>
            ) : words.sinceBuy(new Intl.NumberFormat(intlLocale(), {
              style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
            }).format(change).replace('-', '−'))}
          </p>
        )}
      </div>
    </li>
  );
}
