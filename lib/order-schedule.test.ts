import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLocale } from './i18n/server.ts';
import {
  DEFAULT_STANDING_RULES, ULTIMO, dayOf, earliestDate, executions, fallsOnDay, latestDate, nextExecution, nextOnDay,
  readSchedule, rhythmLine, scheduleProblems, scheduleSentence,
  type StandingRules, type StandingSchedule,
} from './order-schedule.ts';

const TODAY = '2026-10-06';

const rules: StandingRules = {
  minDays: 2,
  maxDays: 365,
  months: [1, 2, 3, 6, 12],
  monthDays: [...Array.from({ length: 30 }, (_, i) => i + 1), ULTIMO],
  weeks: [1, 2],
  weekDays: [1, 2, 3, 4, 5],
  fromBank: true,
};

const monthly = (first: string, day: number, extra: Partial<StandingSchedule> = {}): StandingSchedule => ({
  kind: 'standing', first, unit: 'M', interval: 1, day, last: null, ...extra,
});

test('the window: calendar days ahead, never today itself', () => {
  assert.equal(earliestDate({ minDays: 2 }, TODAY), '2026-10-08');
  // A bank that allows 0 days still gets tomorrow: an order for today is a transfer.
  assert.equal(earliestDate({ minDays: 0 }, TODAY), '2026-10-07');
  assert.equal(latestDate({ maxDays: 360 }, TODAY), '2027-10-01');
});

test('an Ausführungstag: the 30th is the 28th of a short February, 99 the last day', () => {
  assert.ok(fallsOnDay('2027-02-28', 'M', 30));
  assert.ok(fallsOnDay('2026-10-31', 'M', ULTIMO));
  assert.ok(fallsOnDay('2026-11-30', 'M', ULTIMO));
  assert.ok(!fallsOnDay('2026-10-30', 'M', ULTIMO));
  assert.ok(fallsOnDay('2026-10-29', 'M', 97));
  assert.ok(fallsOnDay('2026-10-12', 'W', 1)); // a Monday
  assert.ok(!fallsOnDay('2026-10-13', 'W', 1));
});

test('the day a date stands for: the 31st is the Ultimo, a 30th stays 30', () => {
  assert.equal(dayOf('2026-10-31', 'M', rules.monthDays), ULTIMO);
  assert.equal(dayOf('2026-11-30', 'M', rules.monthDays), 30);
  assert.equal(dayOf('2026-11-30', 'M', [1, 15, ULTIMO]), ULTIMO);
  assert.equal(dayOf('2026-10-15', 'M', rules.monthDays), 15);
  assert.equal(dayOf('2026-10-14', 'W'), 3);
});

test('the next day on an Ausführungstag', () => {
  assert.equal(nextOnDay('2026-10-08', 'M', 1), '2026-11-01');
  assert.equal(nextOnDay('2026-10-08', 'M', 8), '2026-10-08');
  assert.equal(nextOnDay('2026-10-08', 'M', ULTIMO), '2026-10-31');
  assert.equal(nextOnDay('2026-10-08', 'W', 1), '2026-10-12');
});

test('executions: monthly on the Ultimo, quarterly, weekly, up to the last date', () => {
  assert.deepEqual(executions(monthly('2026-10-31', ULTIMO), 4), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  assert.deepEqual(executions(monthly('2026-11-01', 1, { interval: 3 }), 3), ['2026-11-01', '2027-02-01', '2027-05-01']);
  assert.deepEqual(
    executions({ kind: 'standing', first: '2026-10-12', unit: 'W', interval: 2, day: 1 }, 3),
    ['2026-10-12', '2026-10-26', '2026-11-09'],
  );
  assert.deepEqual(executions(monthly('2026-11-01', 1, { last: '2027-01-15' }), 12), ['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('the next execution from today', () => {
  assert.equal(nextExecution(monthly('2024-08-01', 1), TODAY), '2026-11-01');
  assert.equal(nextExecution(monthly('2026-12-15', 15), TODAY), '2026-12-15');
  assert.equal(nextExecution(monthly('2024-01-31', ULTIMO), TODAY), '2026-10-31');
  assert.equal(nextExecution(monthly('2024-01-01', 1, { last: '2026-06-30' }), TODAY), null);
});

test('scheduleProblems: a terminierte Überweisung inside and outside the window', () => {
  const dated = { minDays: 1, maxDays: 360, fromBank: true };
  assert.deepEqual(scheduleProblems({ kind: 'dated', date: '2026-10-15' }, dated, TODAY), {});
  assert.deepEqual(scheduleProblems({ kind: 'dated', date: TODAY }, dated, TODAY), { date: 'tooEarly' });
  assert.deepEqual(scheduleProblems({ kind: 'dated', date: '2027-10-15' }, dated, TODAY), { date: 'tooLate' });
  assert.deepEqual(scheduleProblems({ kind: 'dated', date: '' }, dated, TODAY), { date: 'dateMissing' });
  assert.deepEqual(scheduleProblems({ kind: 'dated', date: '2026-02-31' }, dated, TODAY), { date: 'dateMissing' });
});

test('scheduleProblems: a Dauerauftrag against the bank\'s rhythms and days', () => {
  assert.deepEqual(scheduleProblems(monthly('2026-11-01', 1), rules, TODAY), {});
  // The first execution must fall on the Ausführungstag (spec: "Erstmals ausführen am").
  assert.deepEqual(scheduleProblems(monthly('2026-11-02', 1), rules, TODAY), { date: 'firstNotOnDay' });
  assert.deepEqual(scheduleProblems(monthly('2026-11-01', 1, { interval: 4 }), rules, TODAY), { rhythm: 'rhythmNotAllowed' });
  assert.deepEqual(
    scheduleProblems(monthly('2026-11-01', 1), { ...rules, monthDays: [15, ULTIMO] }, TODAY),
    { day: 'dayNotAllowed' },
  );
  assert.deepEqual(scheduleProblems(monthly('2026-11-01', 1, { last: '2026-10-31' }), rules, TODAY), { last: 'lastBeforeFirst' });
  // Weekly where the bank names no weekly turns (the fallback never does).
  assert.deepEqual(
    scheduleProblems({ kind: 'standing', first: '2026-10-12', unit: 'W', interval: 1, day: 1 }, DEFAULT_STANDING_RULES, TODAY),
    { rhythm: 'rhythmNotAllowed', day: 'dayNotAllowed' },
  );
  assert.deepEqual(scheduleProblems(monthly('2026-10-07', 7), rules, TODAY), { date: 'tooEarly' });
});

test('readSchedule takes only a well-formed schedule off the wire', () => {
  assert.deepEqual(readSchedule({ kind: 'dated', date: '2026-10-15' }), { kind: 'dated', date: '2026-10-15' });
  assert.deepEqual(
    readSchedule({ kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 1, last: '' }),
    { kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 1, last: null },
  );
  for (const bad of [
    null, 'x', { kind: 'dated', date: '15.10.2026' }, { kind: 'later' },
    { kind: 'standing', first: '2026-11-01', unit: 'Y', interval: 1, day: 1 },
    { kind: 'standing', first: '2026-11-01', unit: 'M', interval: 13, day: 1 },
    { kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 31 },
    { kind: 'standing', first: '2026-11-01', unit: 'W', interval: 1, day: 8 },
    { kind: 'standing', first: '2026-11-01', unit: 'M', interval: 1, day: 1, last: 'soon' },
  ]) assert.equal(readSchedule(bad), null, JSON.stringify(bad));
});

test('the schedule in plain words, German', () => {
  assert.equal(scheduleSentence({ kind: 'dated', date: '2026-10-15' }), 'Ausführung am 15.10.2026');
  assert.equal(
    scheduleSentence(monthly('2026-11-01', 1)),
    'Erste Ausführung am 01.11.2026, dann monatlich am 1. – bis auf Weiteres',
  );
  assert.equal(
    scheduleSentence(monthly('2026-10-31', ULTIMO, { interval: 3, last: '2027-12-31' })),
    'Erste Ausführung am 31.10.2026, dann vierteljährlich am letzten Tag des Monats – bis 31.12.2027',
  );
  assert.equal(
    scheduleSentence({ kind: 'standing', first: '2026-10-12', unit: 'W', interval: 2, day: 1 }),
    'Erste Ausführung am 12.10.2026, dann alle 2 Wochen am Montag – bis auf Weiteres',
  );
  assert.equal(rhythmLine(monthly('2026-11-15', 15, { interval: 12 })), 'jährlich am 15.');
});

test('the schedule in plain words, English', () => {
  withLocale('en', () => {
    assert.equal(scheduleSentence({ kind: 'dated', date: '2026-10-15' }), 'Carried out on 15/10/2026');
    assert.equal(
      scheduleSentence(monthly('2026-11-01', 1)),
      'First on 01/11/2026, then monthly on the 1st – until further notice',
    );
    assert.equal(
      scheduleSentence(monthly('2026-11-22', 22, { interval: 6, last: '2028-05-22' })),
      'First on 22/11/2026, then every six months on the 22nd – until 22/05/2028',
    );
    assert.equal(
      scheduleSentence({ kind: 'standing', first: '2026-10-14', unit: 'W', interval: 1, day: 3 }),
      'First on 14/10/2026, then weekly on Wednesday – until further notice',
    );
    assert.equal(rhythmLine(monthly('2026-11-30', ULTIMO)), 'monthly on the last day of the month');
    assert.equal(rhythmLine(monthly('2026-11-13', 13)), 'monthly on the 13th');
  });
});
