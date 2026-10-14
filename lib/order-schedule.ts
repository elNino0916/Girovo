// When a terminierte Überweisung or a Dauerauftrag runs — the schedule a
// person chooses in the transfer sheet, checked against what the bank allows,
// and said back in plain words.
//
// The bank names its rules in the BPD (HICSES, HICDES — lib/fints-orders.ts
// reads them into the shapes below): how many days ahead an order may be
// placed at the least and the most, which rhythms a Dauerauftrag may run in
// and on which days. Without them (a bank that sends none, a device profile
// saved before the app could read them) the app falls back to rules that every
// bank this app has seen accepts — narrower than most banks allow, never
// wider. The bank checks the order again either way, and a refusal moves no
// money.
//
// Dates are local calendar days as yyyy-mm-dd keys, as everywhere in the app
// (lib/format.ts): what the bank receives is a date, not an instant.
//
// Pure apart from the texts (lib/i18n), for the transfer sheet, the routes and
// `node --test`.

import { addDaysKey, dayNumber, fmtDate, isTargetBusinessDay, isoDate, toLocalDate } from './format.ts';
import { intlLocale, msgs } from './i18n/index.ts';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Zeiteinheit of a Dauerauftrag: monthly or weekly. */
export type Unit = 'M' | 'W';

/**
 * Ausführungstag codes beyond the plain days of the month: the last day of
 * the month (Ultimo) and the one or two days before it.
 */
export const ULTIMO = 99;
export const ULTIMO_1 = 98;
export const ULTIMO_2 = 97;
const ULTIMO_CODES = [ULTIMO_2, ULTIMO_1, ULTIMO];

/** A terminierte Überweisung: once, on `date`. */
export type DatedSchedule = { kind: 'dated'; date: string };

/** A Dauerauftrag, as the bank keeps it (the Dauerauftragsdetails of HKCDE). */
export type StandingSchedule = {
  kind: 'standing';
  /** Erster Ausführungstermin. */
  first: string;
  unit: Unit;
  /** Turnus: every `interval` months or weeks. */
  interval: number;
  /** Ausführungstag: 1–30 (or an Ultimo code) for months, 1 = Monday … 7 = Sunday for weeks. */
  day: number;
  /** Letzter Ausführungstermin; absent or null: until further notice. */
  last?: string | null;
};

export type OrderSchedule = DatedSchedule | StandingSchedule;

/** What the bank allows for a terminierte Überweisung. */
export type DatedRules = {
  /**
   * The fewest days between today and the execution date (Minimale
   * Vorlaufzeit), in calendar days as the spec counts them. The app asks for
   * at least one: an order for today is a transfer, not one for later.
   */
  minDays: number;
  /** The most days ahead (Maximale Vorlaufzeit), in calendar days. */
  maxDays: number;
  /** Whether the figures came from the bank, or are the app's fallback (DEFAULT_*). */
  fromBank: boolean;
};

/** What the bank allows for a Dauerauftrag. */
export type StandingRules = DatedRules & {
  /** Turnus in months the bank allows, ascending; empty: no monthly orders. */
  months: number[];
  /** The days of the month it executes on (1–30, and Ultimo codes), ascending. */
  monthDays: number[];
  /** Turnus in weeks, ascending; empty: no weekly orders. */
  weeks: number[];
  /** The weekdays it executes on, 1 = Monday … 7 = Sunday. */
  weekDays: number[];
};

/**
 * The app's fallback when the bank's rules are not at hand: placed at least
 * one day ahead and at most a year, monthly in the four rhythms every
 * bank offers, on a day every month has. Never weekly — not every bank runs
 * weekly orders, and the bank's own parameters are the only way to know.
 */
export const DEFAULT_DATED_RULES: DatedRules = { minDays: 1, maxDays: 365, fromBank: false };
export const DEFAULT_STANDING_RULES: StandingRules = {
  minDays: 1,
  maxDays: 365,
  months: [1, 3, 6, 12],
  monthDays: Array.from({ length: 28 }, (_, i) => i + 1),
  weeks: [],
  weekDays: [],
  fromBank: false,
};

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A yyyy-mm-dd that names a real day ("2026-02-31" does not). */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY_KEY.exec(s);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

const daysInMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

/** The earliest execution date the rules allow, placed `today` — never today itself. */
export function earliestDate(rules: Pick<DatedRules, 'minDays'>, today: string): string {
  return addDaysKey(today, Math.max(1, rules.minDays));
}

/** The latest execution date the rules allow, placed `today`. */
export function latestDate(rules: Pick<DatedRules, 'maxDays'>, today: string): string {
  return addDaysKey(today, Math.max(1, rules.maxDays));
}

/** The day of the month an Ausführungstag means in a month: day 30 is the 28th in a short February, 99 the last. */
export function dayInMonth(day: number, year: number, month0: number): number {
  const last = daysInMonth(year, month0);
  if (day === ULTIMO) return last;
  if (day === ULTIMO_1) return last - 1;
  if (day === ULTIMO_2) return last - 2;
  return Math.min(day, last);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: string): number {
  const d = toLocalDate(key);
  return d ? ((d.getDay() + 6) % 7) + 1 : 0;
}

/** Whether `key` is a day this Ausführungstag executes on. */
export function fallsOnDay(key: string, unit: Unit, day: number): boolean {
  if (!isDayKey(key)) return false;
  if (unit === 'W') return isoWeekday(key) === day;
  const [y, m, d] = key.split('-').map(Number);
  return dayInMonth(day, y, m - 1) === d;
}

/**
 * The Ausführungstag a date stands for: its weekday, or its day of the month —
 * the last day of a month as the Ultimo only when the plain day is not
 * allowed (31 is no Ausführungstag; a "30" in a 30-day month stays 30).
 */
export function dayOf(key: string, unit: Unit, allowed?: readonly number[]): number {
  if (unit === 'W') return isoWeekday(key);
  const [y, m, d] = key.split('-').map(Number);
  const isLast = d === daysInMonth(y, m - 1);
  if (isLast && (d > 30 || (allowed && !allowed.includes(d))) && (!allowed || allowed.includes(ULTIMO))) return ULTIMO;
  return d;
}

/** The first day on or after `from` that this Ausführungstag executes on. */
export function nextOnDay(from: string, unit: Unit, day: number): string {
  let key = from;
  for (let i = 0; i < 400; i++) {
    if (fallsOnDay(key, unit, day)) return key;
    key = addDaysKey(key, 1);
  }
  return from;
}

/** The executions of a Dauerauftrag from its first on, at most `count`, never past its last. */
export function executions(s: StandingSchedule, count: number): string[] {
  const out: string[] = [];
  if (!isDayKey(s.first) || !(s.interval >= 1)) return out;
  const [y, m] = s.first.split('-').map(Number);
  for (let i = 0; out.length < count && i < count + 1; i++) {
    let key: string;
    if (i === 0) key = s.first;
    else if (s.unit === 'W') key = addDaysKey(s.first, 7 * s.interval * i);
    else {
      const month0 = m - 1 + s.interval * i;
      const year = y + Math.floor(month0 / 12);
      const mm = ((month0 % 12) + 12) % 12;
      key = isoDate(new Date(year, mm, dayInMonth(s.day, year, mm)));
    }
    if (s.last && key > s.last) break;
    out.push(key);
  }
  return out;
}

/** The next execution on or after `today`, or null once the last has passed. */
export function nextExecution(s: StandingSchedule, today: string): string | null {
  if (!isDayKey(s.first) || !(s.interval >= 1)) return null;
  if (s.first >= today) return s.first;
  // Enough steps to pass `today` from the first, with room to spare.
  const span = dayNumber(today) - dayNumber(s.first);
  const steps = s.unit === 'W' ? Math.ceil(span / (7 * s.interval)) + 2 : Math.ceil(span / (28 * s.interval)) + 2;
  return executions(s, steps).find((k) => k >= today) ?? null;
}

// ---------------------------------------------------------------------------
// Checking a schedule against the rules
// ---------------------------------------------------------------------------

export type ScheduleProblem =
  | 'dateMissing'
  | 'tooEarly'
  | 'tooLate'
  | 'rhythmNotAllowed'
  | 'dayNotAllowed'
  | 'firstNotOnDay'
  | 'lastBeforeFirst'
  | 'lastInvalid';

/**
 * What is wrong with a schedule, field by field — empty when the bank should
 * accept it. `today` is the local day the order is placed on.
 */
export function scheduleProblems(
  s: OrderSchedule,
  rules: DatedRules | StandingRules,
  today: string,
): Partial<Record<'date' | 'rhythm' | 'day' | 'last', ScheduleProblem>> {
  const out: Partial<Record<'date' | 'rhythm' | 'day' | 'last', ScheduleProblem>> = {};
  const date = s.kind === 'dated' ? s.date : s.first;
  if (!isDayKey(date)) out.date = 'dateMissing';
  else if (date < earliestDate(rules, today)) out.date = 'tooEarly';
  else if (date > latestDate(rules, today)) out.date = 'tooLate';
  if (s.kind === 'dated') return out;

  const r = rules as StandingRules;
  const intervals = s.unit === 'M' ? r.months : r.weeks;
  const days = s.unit === 'M' ? r.monthDays : r.weekDays;
  if (!intervals?.includes(s.interval)) out.rhythm = 'rhythmNotAllowed';
  if (!days?.includes(s.day)) out.day = 'dayNotAllowed';
  else if (!out.date && !fallsOnDay(s.first, s.unit, s.day)) out.date = 'firstNotOnDay';
  if (s.last != null && s.last !== '') {
    if (!isDayKey(s.last)) out.last = 'lastInvalid';
    else if (isDayKey(s.first) && s.last < s.first) out.last = 'lastBeforeFirst';
  }
  return out;
}

/** Whether the bank should accept the schedule (scheduleProblems is empty). */
export const scheduleOk = (s: OrderSchedule, rules: DatedRules | StandingRules, today: string) =>
  Object.keys(scheduleProblems(s, rules, today)).length === 0;

/**
 * A schedule as it came over the wire (the transfer route's body), or null
 * when it is not one. Shape only — the rules are checked by scheduleProblems.
 */
export function readSchedule(input: unknown): OrderSchedule | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  if (v.kind === 'dated') return isDayKey(v.date) ? { kind: 'dated', date: v.date } : null;
  if (v.kind !== 'standing') return null;
  const unit = v.unit === 'M' || v.unit === 'W' ? v.unit : null;
  const interval = Number(v.interval);
  const day = Number(v.day);
  if (!unit || !isDayKey(v.first) || !Number.isInteger(interval) || !Number.isInteger(day)) return null;
  if (interval < 1 || interval > (unit === 'M' ? 12 : 52)) return null;
  if (unit === 'W' ? day < 1 || day > 7 : !((day >= 1 && day <= 30) || ULTIMO_CODES.includes(day))) return null;
  const last = v.last == null || v.last === '' ? null : v.last;
  if (last !== null && !isDayKey(last)) return null;
  return { kind: 'standing', first: v.first, unit, interval, day, last };
}

// ---------------------------------------------------------------------------
// Plain words
// ---------------------------------------------------------------------------

/** "Montag" ("Monday") for an ISO weekday. */
export function weekdayName(day: number): string {
  // 2024-01-01 was a Monday.
  const d = new Date(2024, 0, day);
  return new Intl.DateTimeFormat(intlLocale(), { weekday: 'long' }).format(d);
}

/** "monatlich", "alle 2 Monate", "vierteljährlich", "wöchentlich" ("monthly", "every 2 months", …). */
export function rhythmText(unit: Unit, interval: number): string {
  return msgs().orders.schedule.rhythm(unit, interval);
}

/** "am 1.", "am letzten Tag des Monats", "am Montag" ("on the 1st", …). */
export function dayText(unit: Unit, day: number): string {
  const words = msgs().orders.schedule;
  return unit === 'W' ? words.onWeekday(weekdayName(day)) : words.onMonthDay(day);
}

/** The Ausführungstag as a select option names it: "1.", "Monatsletzter", "Montag". */
export function dayOption(unit: Unit, day: number): string {
  const words = msgs().orders.schedule;
  return unit === 'W' ? weekdayName(day) : words.monthDayOption(day);
}

/**
 * The schedule in one sentence, as the review step and the approval state it:
 * "Ausführung am 15.10.2026" — "Erste Ausführung am 01.11.2026, dann monatlich
 * am 1. – bis auf Weiteres".
 */
export function scheduleSentence(s: OrderSchedule): string {
  const words = msgs().orders.schedule;
  if (s.kind === 'dated') return words.dated(fmtDate(toLocalDate(s.date)));
  return words.standing(
    fmtDate(toLocalDate(s.first)),
    rhythmText(s.unit, s.interval),
    dayText(s.unit, s.day),
    s.last ? fmtDate(toLocalDate(s.last)) : null,
  );
}

/** A Dauerauftrag in a list row: "monatlich am 1." ("monthly on the 1st"). */
export function rhythmLine(s: StandingSchedule): string {
  return msgs().orders.schedule.rhythmLine(rhythmText(s.unit, s.interval), dayText(s.unit, s.day));
}

/** Whether a day is a TARGET2 business day — a terminierte Überweisung on another day runs on the next one. */
export const isBankDay = (key: string) => isTargetBusinessDay(key);
