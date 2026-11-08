import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeLimitError, withinTime } from './time-limit.ts';

test('withinTime: an answer in time comes through', async () => {
  assert.equal(await withinTime(Promise.resolve(7), 1000), 7);
});

test('withinTime: an error in time stays that error', async () => {
  const boom = new Error('boom');
  await assert.rejects(withinTime(Promise.reject(boom), 1000), (err) => err === boom);
});

test('withinTime: a step that never answers ends in TimeLimitError', async () => {
  await assert.rejects(withinTime(new Promise(() => {}), 10), TimeLimitError);
});

test('withinTime: an answer after the limit changes nothing', async () => {
  let answer: (v: string) => void = () => {};
  const late = withinTime(new Promise<string>((resolve) => { answer = resolve; }), 5);
  await assert.rejects(late, TimeLimitError);
  answer('too late');
  await assert.rejects(late, TimeLimitError);
});
