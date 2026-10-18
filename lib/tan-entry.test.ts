import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTan, isPlausibleTan, TAN_MAX } from './tan-entry.ts';

test('a TAN read off in groups loses its spaces', () => {
  assert.equal(cleanTan(' 123 456 '), '123456');
  assert.equal(cleanTan('12 3456'), '123456');
});

test('digits, and letters where the method allows them', () => {
  assert.ok(isPlausibleTan('123456'));
  assert.ok(isPlausibleTan('123456', true));
  assert.ok(isPlausibleTan('A7K2Q9'));
  assert.ok(!isPlausibleTan('A7K2Q9', true));
});

test('never empty, never too long, never FinTS syntax', () => {
  assert.ok(!isPlausibleTan(''));
  assert.ok(!isPlausibleTan('1'.repeat(TAN_MAX + 1)));
  for (const c of ["'", '+', ':', '?', '@']) assert.ok(!isPlausibleTan(`12${c}34`), c);
  assert.ok(!isPlausibleTan('12\n34'));
});
