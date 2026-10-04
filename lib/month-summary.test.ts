import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSpan, dayOneMonthBack } from './month-summary.ts';

test('a day keeps its number one month back', () => {
  assert.equal(dayOneMonthBack('2026-10-04'), '2026-09-04');
  assert.equal(dayOneMonthBack('2026-01-15'), '2025-12-15');
});

test('a day the earlier month does not have becomes its last', () => {
  assert.equal(dayOneMonthBack('2026-03-30'), '2026-02-28');
  assert.equal(dayOneMonthBack('2028-03-31'), '2028-02-29');
  assert.equal(dayOneMonthBack('2026-10-31'), '2026-09-30');
});

test('as an end, the last day of a month stays the last day', () => {
  assert.equal(dayOneMonthBack('2026-09-30', { end: true }), '2026-08-31');
  assert.equal(dayOneMonthBack('2026-02-28', { end: true }), '2026-01-31');
  // Not the last day: the same number.
  assert.equal(dayOneMonthBack('2026-03-28', { end: true }), '2026-02-28');
});

test('not a day: nothing', () => {
  assert.equal(dayOneMonthBack('2026-10'), '');
  assert.equal(dayOneMonthBack(''), '');
});

test('the first days of a month are set against the same days of the month before', () => {
  assert.deepEqual(comparisonSpan({ from: '2026-10-01', to: '2026-10-04' }), {
    from: '2026-09-01', to: '2026-09-04', wholeMonth: false,
  });
});

test('a whole month is set against the whole month before', () => {
  assert.deepEqual(comparisonSpan({ from: '2026-03-01', to: '2026-03-31' }), {
    from: '2026-02-01', to: '2026-02-28', wholeMonth: true,
  });
  assert.deepEqual(comparisonSpan({ from: '2026-10-01', to: '2026-10-31' }), {
    from: '2026-09-01', to: '2026-09-30', wholeMonth: true,
  });
});

test('a span that already covers every day the earlier month has is that whole month', () => {
  // 1–30 March: February has 28 days, all of them inside.
  assert.equal(comparisonSpan({ from: '2026-03-01', to: '2026-03-30' })?.wholeMonth, true);
});

test('a span that starts later in the month starts later the month before', () => {
  assert.deepEqual(comparisonSpan({ from: '2026-10-03', to: '2026-10-04' }), {
    from: '2026-09-03', to: '2026-09-04', wholeMonth: false,
  });
});

test('only spans inside one month have a comparison', () => {
  assert.equal(comparisonSpan({ from: '2026-09-28', to: '2026-10-04' }), null);
  assert.equal(comparisonSpan({ from: '2026-10-05', to: '2026-10-04' }), null);
  assert.equal(comparisonSpan({ from: 'gestern', to: '2026-10-04' }), null);
});
