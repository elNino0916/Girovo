'use client';

// The transfer sheet's "Termin": Sofort (a transfer, as it always was), an
// einem Datum (a terminierte Überweisung) or regelmäßig (a Dauerauftrag).
//
// Only what the account offers appears — the bank declares each in its BPD
// and the account's UPD allows it (SerializedAccount.dated / .standing); with
// neither, the choice is not there at all and the sheet is the plain transfer
// it was. The dates, rhythms and days on offer are the bank's own
// (lib/order-schedule.ts); without its rules, the narrower fallback every bank
// accepts, said in a note.
//
// The first execution and the Ausführungstag go together: a Dauerauftrag
// runs on its day, so the first date always falls on it. Picking a day moves
// the first date to that day (in the month already chosen, where the bank's
// lead time allows); picking a first date takes its day, where the bank runs
// orders on it — otherwise the field says why the two do not fit.

import { useState } from 'react';
import type { Ref } from 'react';
import type { SerializedAccount } from '@/lib/fints-types';
import { addDaysKey, fmtDate, isoDate, toLocalDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import {
  dayOf, dayOption, earliestDate, isBankDay, isDayKey, latestDate, nextOnDay, rhythmText, scheduleProblems,
  scheduleSentence, type DatedRules, type OrderSchedule, type ScheduleProblem, type StandingRules, type Unit,
} from '@/lib/order-schedule';
import { Field, Input, Segmented, Select } from '../ui';

export type When = 'now' | 'dated' | 'standing';
type ScheduleField = 'date' | 'rhythm' | 'day' | 'last';

/** "Monatlich" ("Monthly") — a rhythm as a select names it. */
const capitalised = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/**
 * The schedule part of the form: what is chosen, what the bank allows, and
 * what is wrong with it. Kept by the sheet, so the draft and the "discard?"
 * check see it.
 */
export function useScheduleForm(account: SerializedAccount | undefined) {
  const [chosen, setChosen] = useState<When>('now');
  const [date, setDate] = useState('');
  const [rhythm, setRhythm] = useState('');
  const [day, setDay] = useState(0);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [touched, setTouched] = useState<Partial<Record<ScheduleField, boolean>>>({});

  // Read at render: a sheet left open past midnight moves the window.
  const today = isoDate(new Date());
  const dated = account?.dated?.create ? account.dated : null;
  const standing = account?.standing?.create ? account.standing : null;
  const options: When[] = ['now', ...(dated ? ['dated' as const] : []), ...(standing ? ['standing' as const] : [])];
  // Another account without the chosen kind falls back to a transfer now.
  const when: When = options.includes(chosen) ? chosen : 'now';

  const unit: Unit = rhythm.startsWith('W') ? 'W' : 'M';
  const interval = Number(rhythm.slice(1)) || 1;
  const allowedDays = (r: StandingRules, u: Unit) => (u === 'M' ? r.monthDays : r.weekDays);

  /** The first date for `d`: in the month (or week) already chosen where the lead time allows, else the earliest. */
  const firstFor = (r: StandingRules, u: Unit, d: number, from: string) => {
    const earliest = earliestDate(r, today);
    let base = from && isDayKey(from) ? (u === 'M' ? `${from.slice(0, 8)}01` : addDaysKey(from, -6)) : earliest;
    if (base < earliest) base = earliest;
    return nextOnDay(base, u, d);
  };

  const choose = (w: When) => {
    if (w === 'dated' && dated && !date) setDate(earliestDate(dated.rules, today));
    if (w === 'standing' && standing && !rhythm) {
      const r = standing.rules;
      const u: Unit = r.months.length || !r.weeks.length ? 'M' : 'W';
      const n = u === 'M' ? (r.months.includes(1) ? 1 : r.months[0] ?? 1) : (r.weeks.includes(1) ? 1 : r.weeks[0] ?? 1);
      const earliest = earliestDate(r, today);
      const days = allowedDays(r, u);
      // The 1st of the month (or a Monday), as most standing orders run — the
      // first that the lead time allows; else the earliest day there is.
      const own = dayOf(earliest, u, days);
      const d = days.includes(1) ? 1 : days.includes(own) ? own : days.find((x) => x >= own) ?? days[0] ?? 1;
      setRhythm(`${u}${n}`);
      setDay(d);
      setFirst(nextOnDay(earliest, u, d));
    }
    setChosen(w);
  };

  const touch = (f: ScheduleField) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));

  const changeRhythm = (value: string) => {
    touch('rhythm');
    const u: Unit = value.startsWith('W') ? 'W' : 'M';
    setRhythm(value);
    if (u === unit || !standing) return;
    // Days of the month are not weekdays: the day goes with the unit.
    const days = allowedDays(standing.rules, u);
    const base = first && isDayKey(first) ? first : earliestDate(standing.rules, today);
    const own = dayOf(base, u, days);
    const d = days.includes(own) ? own : days[0] ?? 1;
    setDay(d);
    setFirst(firstFor(standing.rules, u, d, base));
  };

  const changeDay = (d: number) => {
    touch('day');
    setDay(d);
    if (standing) setFirst(firstFor(standing.rules, unit, d, first));
  };

  const changeFirst = (value: string) => {
    touch('date');
    setFirst(value);
    if (!standing || !isDayKey(value)) return;
    const days = allowedDays(standing.rules, unit);
    const own = dayOf(value, unit, days);
    if (days.includes(own)) setDay(own);
  };

  const schedule: OrderSchedule | null = when === 'dated'
    ? { kind: 'dated', date }
    : when === 'standing'
      ? { kind: 'standing', first, unit, interval, day, last: last || null }
      : null;
  const rules: DatedRules | StandingRules | null = when === 'dated' ? dated?.rules ?? null : when === 'standing' ? standing?.rules ?? null : null;
  const problems = schedule && rules ? scheduleProblems(schedule, rules, today) : {};

  return {
    when, options, choose, schedule, rules, problems, today,
    date, setDate: (v: string) => { touch('date'); setDate(v); },
    rhythm, changeRhythm, unit, day, changeDay, first, changeFirst,
    last, setLast: (v: string) => { touch('last'); setLast(v); },
    touched,
    /** Everything the form needs to know has not changed since it was opened. */
    snapshot: when === 'now' ? 'now' : JSON.stringify(schedule),
  };
}

export type ScheduleForm = ReturnType<typeof useScheduleForm>;

/** The sentence for one of scheduleProblems' findings. */
export function problemText(form: ScheduleForm, p: ScheduleProblem, t: ReturnType<typeof useT>): string {
  const words = t.orders.form.problems;
  const rules = form.rules;
  switch (p) {
    case 'dateMissing': return words.dateMissing;
    case 'tooEarly': return words.tooEarly(fmtDate(toLocalDate(earliestDate(rules ?? { minDays: 1 }, form.today))));
    case 'tooLate': return words.tooLate(fmtDate(toLocalDate(latestDate(rules ?? { maxDays: 365 }, form.today))));
    case 'rhythmNotAllowed': return words.rhythmNotAllowed;
    case 'dayNotAllowed': return words.dayNotAllowed;
    case 'firstNotOnDay': return words.firstNotOnDay(dayOption(form.unit, form.day));
    case 'lastBeforeFirst': return words.lastBeforeFirst;
    case 'lastInvalid': return words.lastInvalid;
  }
}

/**
 * The "Termin" choice and, below it, the date or the Dauerauftrag's fields.
 * `showErrors`: "Weiter" was pressed — every problem shows, not only those
 * of fields already touched.
 */
export function ScheduleFields({
  form, showErrors, dateRef,
}: { form: ScheduleForm; showErrors: boolean; dateRef: Ref<HTMLInputElement> }) {
  const t = useT();
  const words = t.orders.form;
  if (form.options.length < 2) return null;

  const err = (f: ScheduleField, p: ScheduleProblem | undefined) =>
    (p && (showErrors || form.touched[f]) ? problemText(form, p, t) : undefined);
  const rules = form.rules;
  const earliest = rules ? earliestDate(rules, form.today) : undefined;
  const latest = rules ? latestDate(rules, form.today) : undefined;
  const span = earliest && latest ? words.window(fmtDate(toLocalDate(earliest)), fmtDate(toLocalDate(latest))) : undefined;
  const standingRules = form.when === 'standing' ? (rules as StandingRules | null) : null;
  const ok = Object.keys(form.problems).length === 0;

  return (
    <div className="mb-1">
      <div className="mb-4 flex flex-col gap-1.5">
        <span className="text-[13px] leading-snug font-semibold text-ink-2" aria-hidden>{words.when}</span>
        <Segmented
          aria-label={words.when}
          block
          // Tighter segments on a phone, so "An einem Datum" fits beside the others at 360px.
          className="h-12 items-center [&>button]:px-3 sm:[&>button]:px-4"
          value={form.when}
          onChange={(v) => form.choose(v)}
          options={form.options.map((w) => ({ value: w, label: words[w] }))}
        />
      </div>

      {form.when === 'dated' && (
        <Field
          label={words.date}
          htmlFor="tf-date"
          error={err('date', form.problems.date)}
          hint={err('date', form.problems.date) ? undefined : (
            <>
              {span}
              {isDayKey(form.date) && !isBankDay(form.date) && <span className="block">{words.notBankDay}</span>}
            </>
          )}
        >
          <Input
            id="tf-date"
            ref={dateRef}
            type="date"
            min={earliest}
            max={latest}
            value={form.date}
            onChange={(e) => form.setDate(e.target.value)}
            className="tnum"
          />
        </Field>
      )}

      {form.when === 'standing' && standingRules && (
        <>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={words.rhythm} htmlFor="tf-rhythm" error={err('rhythm', form.problems.rhythm)}>
              <Select id="tf-rhythm" value={form.rhythm} onChange={(e) => form.changeRhythm(e.target.value)}>
                {standingRules.months.map((n) => (
                  <option key={`M${n}`} value={`M${n}`}>{capitalised(rhythmText('M', n))}</option>
                ))}
                {standingRules.weeks.map((n) => (
                  <option key={`W${n}`} value={`W${n}`}>{capitalised(rhythmText('W', n))}</option>
                ))}
              </Select>
            </Field>
            <Field label={words.day} htmlFor="tf-day" error={err('day', form.problems.day)}>
              <Select id="tf-day" value={String(form.day)} onChange={(e) => form.changeDay(Number(e.target.value))}>
                {(form.unit === 'M' ? standingRules.monthDays : standingRules.weekDays).map((d) => (
                  <option key={d} value={d}>{dayOption(form.unit, d)}</option>
                ))}
                {/* A day the first date stands for but the bank does not run on: shown, so the field says why. */}
                {!(form.unit === 'M' ? standingRules.monthDays : standingRules.weekDays).includes(form.day) && (
                  <option value={form.day} disabled>{dayOption(form.unit, form.day)}</option>
                )}
              </Select>
            </Field>
            <Field
              label={words.first}
              htmlFor="tf-first"
              error={err('date', form.problems.date)}
              hint={err('date', form.problems.date) ? undefined : span}
            >
              <Input
                id="tf-first"
                ref={dateRef}
                type="date"
                min={earliest}
                max={latest}
                value={form.first}
                onChange={(e) => form.changeFirst(e.target.value)}
                className="tnum"
              />
            </Field>
            <Field
              label={words.last}
              htmlFor="tf-last"
              optional
              error={err('last', form.problems.last)}
              hint={err('last', form.problems.last) ? undefined : words.lastHint}
            >
              <Input
                id="tf-last"
                type="date"
                min={isDayKey(form.first) ? form.first : earliest}
                value={form.last}
                onChange={(e) => form.setLast(e.target.value)}
                className="tnum"
              />
            </Field>
          </div>
          {/* The schedule in words, as the review step and the bank's app will say it. */}
          {ok && form.schedule && (
            <p className="tnum mb-4 rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-snug text-ink">
              {scheduleSentence(form.schedule)}
            </p>
          )}
        </>
      )}

      {form.when !== 'now' && rules && !rules.fromBank && (
        <p className="mb-4 text-[13px] leading-snug text-ink-3">{words.defaults}</p>
      )}
    </div>
  );
}
