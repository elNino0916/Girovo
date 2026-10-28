import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'lib-fints';
import { fintsProductVersion } from './product-version.ts';

/** The dialog's first segment as lib-fints writes it — throws where the bank's format would be broken. */
const hkvvb = (productVersion: string) => encode({
  header: { segId: 'HKVVB', segNr: 4, version: 3 },
  bpdVersion: 0, updVersion: 0, dialogLanguage: 0, productId: 'TESTPRODUCTID000000000000', productVersion,
} as Parameters<typeof encode>[0]);

test('with none set, the bank is told Girovo\'s own major.minor', () => {
  assert.equal(fintsProductVersion(undefined, '5.15.2'), '5.15');
  assert.equal(fintsProductVersion('', '10.2.1'), '10.2');
});

test('a set version wins where it fits, and is cut to major.minor where it does not', () => {
  assert.equal(fintsProductVersion('3.1', '5.15.2'), '3.1');
  assert.equal(fintsProductVersion('5.15.1', '5.15.2'), '5.15');
  assert.equal(fintsProductVersion('nightly-build', '5.15.2'), '5.15');
  assert.equal(fintsProductVersion(undefined, undefined), '1.0');
});

test('whatever is chosen can be written into the dialog\'s first message', () => {
  // The value that broke every login: too long for HKVVB.
  assert.throws(() => hkvvb('5.15.1'), /maximum length/);
  for (const [set, app] of [['5.15.1', '5.15.2'], [undefined, '5.15.2'], ['123456', '12345.67.8'], [undefined, undefined]] as const) {
    assert.doesNotThrow(() => hkvvb(fintsProductVersion(set, app)));
  }
});
