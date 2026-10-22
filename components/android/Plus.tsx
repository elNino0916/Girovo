'use client';

// Girovo Plus (lib/plus.ts, docs/plus-plan.md) on the phone: the Einstellungen
// row and the Plus screen. The Google Play build only — elsewhere the state is
// 'free', the row is not there and nothing asks for Plus.
//
// The screen says what Plus brings (several banks, the month-end forecast,
// "Frag deine Umsätze" where the phone can ask, the gold icon), Play's own prices with the trial Play offers this user, and
// once subscribed the thanks, the icon and Play's subscription page. A phone
// without Google Play billing is pointed to the GitHub version, which has
// everything for free.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { iconChoosable, type PlusOffer, type PlusPlan } from '@/lib/plus';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { BuildingIcon, ChartIcon, GeminiSparkIcon } from '../icons';
import { useAskable } from '../insights/Ask';
import { ActionItem } from '../settings/rows';
import { BrandPlate } from '../shell/BrandMark';
import { Button, Dialog, Switch } from '../ui';

/** The Einstellungen row: what Plus is, or that it is active. Only where Plus applies. */
export function PlusRow() {
  const { plus, openPlus } = useFints();
  const w = useT().plus;
  if (plus.state === 'free') return null;
  return (
    <ActionItem
      icon={<BrandPlate tone="plus" size={24} />}
      title={w.name}
      summary={w.row[plus.state]}
      onClick={openPlus}
    />
  );
}

/** One perk: a glyph on the tonal disc (the dialog's own ground is the inset, so not that), title and line. */
function Perk({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-tonal-ink">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-snug font-semibold text-ink">{title}</span>
        <span className="block text-[13.5px] leading-snug text-ink-2">{text}</span>
      </span>
    </li>
  );
}

/** The Plus screen, over whatever opened it. */
export function PlusScreen() {
  const { plus, plusOpen, closePlus } = useFints();
  const t = useT();
  const w = t.plus;
  const [busy, setBusy] = useState<PlusPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const askable = useAskable();
  const bridge = typeof window === 'undefined' ? undefined : window.girovoMobile?.plus;
  if (!plusOpen) return null;

  const buy = async (offer: PlusOffer) => {
    if (!bridge) return;
    setBusy(offer.plan);
    setFailed(false);
    // Play's own sheet takes over; the outcome arrives as the provider's state.
    const launched = await bridge.buy(offer.plan);
    setBusy(null);
    if (!launched) setFailed(true);
  };

  const offers = plus.offers ?? [];
  const trial = offers.find((o) => o.trialDays)?.trialDays ?? null;
  const active = plus.state === 'active';

  return (
    <Dialog
      open
      onClose={closePlus}
      title={w.name}
      icon={<BrandPlate tone="plus" size={48} />}
      actions={<Button variant="tertiary" data-autofocus={active || undefined} onClick={closePlus}>{t.common.close}</Button>}
    >
      <div className="flex flex-col gap-4">
        {active ? (
          <>
            <div className="text-center">
              <p className="text-[15px] leading-snug font-semibold text-ink">{w.thanks}</p>
              {plus.plan && <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{w.plan[plus.plan]}</p>}
            </div>
            {iconChoosable(plus.state) && (
              <Switch
                checked={plus.icon === 'plus'}
                onChange={(next) => void bridge?.setIcon(next ? 'plus' : 'standard')}
                label={w.goldIcon}
                description={w.goldIconHint}
              />
            )}
            <Button variant="secondary" className="self-start" onClick={() => void bridge?.manage()}>{w.manage}</Button>
          </>
        ) : (
          <>
            <p className="text-center text-[15px] leading-snug text-ink">{w.lead}</p>
            <ul className="flex flex-col gap-3">
              <Perk icon={<BuildingIcon size={18} />} title={w.perks.banks.title} text={w.perks.banks.text} />
              <Perk icon={<ChartIcon size={18} />} title={w.perks.forecast.title} text={w.perks.forecast.text} />
              {/* Only offered where Gemini Nano v4 can answer: nobody pays for what their phone can't do. */}
              {askable && <Perk icon={<GeminiSparkIcon size={18} />} title={w.perks.ask.title} text={w.perks.ask.text} />}
              {/* The icon itself, at the disc's size: the perk shows what you get. */}
              <Perk icon={<BrandPlate tone="plus" size={36} />} title={w.perks.icon.title} text={w.perks.icon.text} />
            </ul>

            {plus.state === 'unavailable' ? (
              <>
                <p className="text-[14px] leading-snug text-ink-2">{w.unavailable}</p>
                <Button variant="secondary" className="self-start" onClick={() => void bridge?.openGitHub()}>{w.github}</Button>
              </>
            ) : offers.length === 0 ? (
              <p className="text-[14px] leading-snug text-ink-2">{w.noOffers}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {trial && <p className="text-center text-[14px] leading-snug font-semibold text-ink">{w.trial(trial)}</p>}
                {offers.map((offer, i) => (
                  <Button
                    key={offer.plan}
                    variant={i === 0 ? 'primary' : 'secondary'}
                    block
                    busy={busy === offer.plan}
                    disabled={busy !== null && busy !== offer.plan}
                    onClick={() => void buy(offer)}
                  >
                    {offer.plan === 'monthly' ? w.monthly(offer.price) : w.yearly(offer.price)}
                  </Button>
                ))}
                <p className="text-center text-[12.5px] leading-snug text-ink-3">{w.terms}</p>
                {failed && <p role="status" className="text-center text-[13px] leading-snug text-red">{w.failed}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
