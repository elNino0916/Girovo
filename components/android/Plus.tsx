'use client';

// Girovo Plus (lib/plus.ts, docs/plus-plan.md) on the phone: the Einstellungen
// row and the Plus screen. The Google Play build only — elsewhere the state is
// 'free', the row is not there and nothing asks for Plus.
//
// The screen says what Plus brings (several banks, the month-end forecast,
// "Frag deine Umsätze" where the phone can ask, the gold icon), Play's own prices with the trial Play offers this user, and
// once subscribed the thanks, the icon and Play's subscription page. A phone
// without Google Play billing is pointed to the GitHub version, which has
// everything for free. Seven taps on the screen's plate open the owner key
// (scripts/owner-key.mjs), the developer's own way in.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { iconChoosable, type PlusOffer, type PlusPlan } from '@/lib/plus';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { BuildingIcon, ChartIcon, GeminiSparkIcon } from '../icons';
import { useAskable } from '../insights/Ask';
import { ActionItem } from '../settings/rows';
import { BrandPlate } from '../shell/BrandMark';
import { Button, CopyButton, Dialog, Field, Input, Switch } from '../ui';

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

/**
 * The owner key (scripts/owner-key.mjs): Plus on the developer's own phone
 * without a purchase. Only seven taps on the Plus screen's plate lead here —
 * it is nothing to offer, and a key fits no installation but the one it was
 * made for.
 */
function OwnerKey() {
  const { plus } = useFints();
  const w = useT().plus.owner;
  const bridge = window.girovoMobile?.plus;
  const [info, setInfo] = useState<{ installId: string; owner: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge?.ownerInfo().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [bridge, plus.owner]);

  const unlock = async () => {
    if (!bridge || !key.trim()) return;
    setBusy(true);
    const now = await bridge.setOwnerKey(key.trim());
    setBusy(false);
    setInvalid(now === null);
    if (now) setKey('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[15px] leading-snug font-semibold text-ink">{w.title}</p>
        <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{w.lead}</p>
      </div>
      {info && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-snug text-ink-2">{w.installId}</span>
            <span className="block text-[17px] leading-snug font-medium text-ink tabular-nums">{info.installId}</span>
          </span>
          <CopyButton text={info.installId} />
        </div>
      )}
      {plus.owner ? (
        <>
          <p role="status" className="text-[14px] leading-snug text-ink">{w.active}</p>
          <Button variant="secondary" className="self-start" onClick={() => void bridge?.clearOwnerKey()}>{w.remove}</Button>
        </>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          {/* The refusal is said here, not through the field's error: M3E's form
              field misses an error text that arrives after it was first drawn. */}
          <Field label={w.key}>
            <Input
              value={key}
              invalid={invalid}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setKey(e.target.value);
                setInvalid(false);
              }}
            />
          </Field>
          {invalid && <p role="alert" className="-mt-1 mb-1 text-[13px] leading-snug text-red">{w.invalid}</p>}
          <Button type="submit" variant="primary" className="self-start" busy={busy} disabled={!key.trim()}>{w.unlock}</Button>
        </form>
      )}
    </div>
  );
}

/** Seven taps within this long of each other open the owner key. */
const TAP_GAP_MS = 1500;

/** The Plus screen, over whatever opened it. */
export function PlusScreen() {
  const { plus, plusOpen, closePlus } = useFints();
  const t = useT();
  const w = t.plus;
  const [busy, setBusy] = useState<PlusPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [ownerView, setOwnerView] = useState(false);
  const taps = useRef({ count: 0, at: 0 });
  const askable = useAskable();
  const bridge = typeof window === 'undefined' ? undefined : window.girovoMobile?.plus;
  if (!plusOpen) return null;

  const close = () => {
    setOwnerView(false);
    closePlus();
  };
  const tapPlate = () => {
    const now = Date.now();
    const tap = taps.current;
    tap.count = now - tap.at < TAP_GAP_MS ? tap.count + 1 : 1;
    tap.at = now;
    if (tap.count >= 7) {
      tap.count = 0;
      setOwnerView(true);
    }
  };

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
      onClose={close}
      title={w.name}
      // Nothing to press for anyone else: seven taps are the owner's way to the key.
      icon={<span onClick={tapPlate}><BrandPlate tone="plus" size={48} /></span>}
      actions={<Button variant="tertiary" data-autofocus={active || undefined} onClick={close}>{t.common.close}</Button>}
    >
      <div className="flex flex-col gap-4">
        {ownerView ? (
          <OwnerKey />
        ) : active ? (
          <>
            <div className="text-center">
              <p className="text-[15px] leading-snug font-semibold text-ink">{plus.owner && !plus.plan ? w.owner.title : w.thanks}</p>
              {plus.plan ? (
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{w.plan[plus.plan]}</p>
              ) : plus.owner ? (
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{w.owner.active}</p>
              ) : null}
            </div>
            {iconChoosable(plus.state) && (
              <Switch
                checked={plus.icon === 'plus'}
                onChange={(next) => void bridge?.setIcon(next ? 'plus' : 'standard')}
                label={w.goldIcon}
                description={w.goldIconHint}
              />
            )}
            {/* Play's subscription page, wherever Play has one: not for the owner key alone. */}
            {(plus.plan || !plus.owner) && (
              <Button variant="secondary" className="self-start" onClick={() => void bridge?.manage()}>{w.manage}</Button>
            )}
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
