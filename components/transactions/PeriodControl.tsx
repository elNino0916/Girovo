'use client';

import { useState } from 'react';
import type { DateRange, StatementInfo } from '@/lib/app-types';
import { fmtRange, isoDate, presetRange, type RangePreset } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { CalendarIcon, ChevronIcon } from '../icons';
import {
  Alert, Button, DialogActions, Field, Input, Menu, MenuGroup, MenuItem, MenuItemRadio, MenuSeparator, Popover, cx,
} from '../ui';

/** The presets, in menu order; their names are in lib/i18n/messages/transactions.ts (period.presets). */
const PRESETS: RangePreset[] = ['30d', '90d', 'thisMonth', 'lastMonth', 'thisYear', '365d'];

// PSD2 lets a bank skip the approval for the last 90 days of bookings;
// reaching further back is what usually costs one. So the hint
// (period.mayNeedApproval) is shown wherever a choice reaches further back
// than what is loaded — honestly hedged, because some banks ask anyway and
// some never do.

/**
 * Which period the Umsätze list asks the bank for: presets in a menu, and a
 * custom range in a small popover behind "Eigener Zeitraum …". Both apply
 * through `applyRange`, which re-reads the active account — so the control is
 * shut while another bank operation runs.
 *
 * What is shown as selected is what was actually loaded (`loaded`), never
 * the control's own state.
 */
export function PeriodControl({
  loaded, applyRange, busy,
}: {
  loaded: StatementInfo | undefined;
  applyRange: (r: DateRange) => void;
  busy: boolean;
}) {
  const t = useT();
  const words = t.transactions.period;
  const [customOpen, setCustomOpen] = useState(false);
  const today = isoDate(new Date());
  const active = loaded ? PRESETS.find((id) => {
    const r = presetRange(id);
    return r.from === loaded.from && r.to === loaded.to;
  }) : undefined;
  const reachesBack = (from: string) => !loaded || from < loaded.from;
  const label = active ? words.presets[active].short : words.title;
  const describe = loaded ? words.is(active ? words.presets[active].label : fmtRange(loaded.from, loaded.to)) : words.choose;

  return (
    <Popover
      open={customOpen}
      onOpenChange={setCustomOpen}
      label={words.custom}
      placement="bottom-end"
      trigger={(pop) => (
        <Menu
          label={words.title}
          placement="bottom-end"
          minWidth={264}
          // A menu opening on the same button means the popover is done.
          onOpenChange={(open) => { if (open) setCustomOpen(false); }}
          trigger={(menu, { open }) => {
            // One button anchors both layers: its ref is handed to each.
            const ref = (el: HTMLElement | null) => { menu.ref(el); pop.ref(el); };
            return (
              <Button
                {...menu}
                ref={ref}
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={describe}
                title={busy ? words.busy : undefined}
                iconLeft={<CalendarIcon size={16} />}
                iconRight={<ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 transition-transform duration-150', open && 'rotate-180')} />}
                className="max-sm:px-3"
              >
                {/* On a phone the dates under the title already say it. */}
                <span className="hidden sm:inline">{label}</span>
              </Button>
            );
          }}
        >
          <MenuGroup label={words.load}>
            {PRESETS.map((id) => {
              const r = presetRange(id);
              return (
                <MenuItemRadio
                  key={id}
                  checked={active === id}
                  description={
                    <>
                      <span className="tnum block">{fmtRange(r.from, r.to)}</span>
                      {reachesBack(r.from) && <span className="block">{words.mayNeedApproval}</span>}
                    </>
                  }
                  onSelect={() => { if (active !== id) applyRange(r); }}
                >
                  {words.presets[id].label}
                </MenuItemRadio>
              );
            })}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            icon={<CalendarIcon />}
            description={!active && loaded ? fmtRange(loaded.from, loaded.to) : undefined}
            onSelect={() => setCustomOpen(true)}
          >
            {words.customMenu}
          </MenuItem>
        </Menu>
      )}
    >
      {(close) => (
        <CustomRange
          initial={loaded ?? presetRange('90d')}
          loadedFrom={loaded?.from}
          today={today}
          busy={busy}
          onApply={(r) => {
            applyRange(r);
            close();
          }}
          onCancel={close}
        />
      )}
    </Popover>
  );
}

function CustomRange({
  initial, loadedFrom, today, busy, onApply, onCancel,
}: {
  initial: DateRange;
  loadedFrom: string | undefined;
  today: string;
  busy: boolean;
  onApply: (r: DateRange) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const words = t.transactions.period;
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to > today ? today : initial.to);

  // Validated as typed, but only once both ends are real dates: a half-typed
  // year is not an error yet.
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const fromError = complete && from > to ? words.startAfterEnd : from > today ? words.startInFuture : undefined;
  const toError = to > today ? words.endInFuture : undefined;
  const valid = complete && !fromError && !toError;
  // Re-applying what is already loaded would only cost a bank round-trip.
  const unchanged = !!loadedFrom && from === initial.from && to === initial.to;

  return (
    <form
      className="w-[min(304px,calc(100vw-48px))]"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onApply({ from, to });
      }}
    >
      <p className="section-head mb-3">{words.custom}</p>
      <Field label={words.from} error={fromError} className="mb-3">
        <Input type="date" value={from} max={to && to < today ? to : today} onChange={(e) => setFrom(e.target.value)} data-autofocus />
      </Field>
      <Field label={words.to} error={toError} className="mb-3">
        <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {valid && loadedFrom && from < loadedFrom && (
        <Alert tone="info" className="mt-1" role="status">
          {words.longerHistory}
        </Alert>
      )}
      <DialogActions className="mt-4">
        <Button size="sm" variant="secondary" onClick={onCancel}>{t.common.cancel}</Button>
        <Button size="sm" variant="primary" type="submit" disabled={!valid || busy || unchanged}>{words.apply}</Button>
      </DialogActions>
    </form>
  );
}
