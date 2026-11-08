import assert from 'node:assert/strict';
import test from 'node:test';
import { isNightlyVersion, numeralOf } from './edition.ts';

test('a release is not a nightly, every pre-release is', () => {
  assert.equal(isNightlyVersion('6.0.0'), false);
  assert.equal(isNightlyVersion('v6.0.1'), false);
  assert.equal(isNightlyVersion('6.0.0+build.5'), false);
  assert.equal(isNightlyVersion('6.0.0-nightly.202611071230.gef82cf6'), true);
  assert.equal(isNightlyVersion('6.0.0-preview.202611071208.gef82cf6'), true, 'the bridge');
  assert.equal(isNightlyVersion('6.0.0-preview.1'), true);
  assert.equal(isNightlyVersion('6.0.0-dev.57'), true, "CI's development builds");
  assert.equal(isNightlyVersion(''), false);
});

test('the numeral is the major and minor version, without a minor of 0', () => {
  assert.equal(numeralOf('6.1.0'), '6.1');
  assert.equal(numeralOf('6.1.4'), '6.1');
  assert.equal(numeralOf('6.0.3'), '6');
  assert.equal(numeralOf('7.0.0'), '7');
  assert.equal(numeralOf('12.3.4-nightly.1.gabc1234'), '12.3');
  assert.equal(numeralOf('nonsense'), null);
});
