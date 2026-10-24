import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress, monthPlan, monthsUntil, sanitizeGoals, validGoal } from './savings-goal.ts';
import { sanitizeVault } from './vault.ts';

const goal = { accountNumber: '598000', name: 'Urlaub Portugal', target: 200000, by: '2027-06' };
const OCT_24 = new Date(2026, 9, 24);

test('months left count the current month and the goal’s own', () => {
  assert.equal(monthsUntil('2027-06', OCT_24), 9);
  assert.equal(monthsUntil('2026-10', OCT_24), 1);
  assert.equal(monthsUntil('2026-09', OCT_24), 0);
  assert.equal(monthsUntil('nonsense', OCT_24), 0);
});

test('progress: share, what is missing and what that means per month', () => {
  const p = goalProgress(goal, 121989, OCT_24);
  assert.equal(p.missing, 78011);
  assert.ok(Math.abs(p.share - 0.609945) < 1e-6);
  assert.equal(p.reached, false);
  assert.equal(p.monthsLeft, 9);
  assert.equal(p.perMonth, 8668);
});

test('a reached goal asks for nothing; a share never runs past 1 or below 0', () => {
  const done = goalProgress(goal, 250000, OCT_24);
  assert.equal(done.reached, true);
  assert.equal(done.missing, 0);
  assert.equal(done.share, 1);
  assert.equal(done.perMonth, 0);
  assert.equal(goalProgress(goal, -5000, OCT_24).share, 0);
});

test('without a date there is no plan per month; past the date nothing more per month', () => {
  const { by: _by, ...open } = goal;
  assert.equal(goalProgress(open, 1000, OCT_24).perMonth, null);
  assert.equal(goalProgress({ ...goal, by: '2026-01' }, 1000, OCT_24).perMonth, 0);
});

test('the vault keeps goals, one per account, and nothing else they carry', () => {
  const goals = sanitizeGoals([
    { ...goal, name: '  Urlaub  ', pin: '1234' },
    { accountNumber: '598000', name: 'Neues Ziel', target: 50000 },
    { accountNumber: '1', name: '', target: 5 },
    'nonsense',
  ]);
  assert.deepEqual(goals, [{ accountNumber: '598000', name: 'Neues Ziel', target: 50000 }]);
  const vault = sanitizeVault({ version: 1, goals: [goal] });
  assert.deepEqual(vault?.goals, [goal]);
  // A vault without goals carries no key for them.
  assert.equal('goals' in (sanitizeVault({ version: 1 }) ?? {}), false);
});

test('the month plan runs from the month the goal was set to its date', () => {
  assert.deepEqual(monthPlan({ ...goal, since: '2026-02' }, OCT_24), { months: 17, current: 9 });
  // Set this month: the plan starts now.
  assert.deepEqual(monthPlan(goal, OCT_24), { months: 9, current: 1 });
  // Past the date: the last month, never beyond.
  assert.deepEqual(monthPlan({ ...goal, since: '2026-02', by: '2026-05' }, OCT_24), { months: 4, current: 4 });
  const { by: _by, ...open } = goal;
  assert.equal(monthPlan(open, OCT_24), null);
});

test('only well-formed goals are kept', () => {
  assert.equal(validGoal(goal), true);
  assert.equal(validGoal({ ...goal, name: '  ' }), false);
  assert.equal(validGoal({ ...goal, target: 0 }), false);
  assert.equal(validGoal({ ...goal, by: '06/2027' }), false);
});
