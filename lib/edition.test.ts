import assert from 'node:assert/strict';
import test from 'node:test';
import { editionOf, isPreReleaseVersion, nameOf, numeralOf, plateOf } from './edition.ts';

test('a release is plain Girovo, a next. pre-release is Next, every other pre-release is a nightly', () => {
  assert.equal(editionOf('6.0.0'), 'release');
  assert.equal(editionOf('v6.0.1'), 'release');
  assert.equal(editionOf('6.0.0+build.5'), 'release');
  assert.equal(editionOf(''), 'release');
  assert.equal(editionOf('6.0.0-nightly.202611071230.gef82cf6'), 'nightly');
  assert.equal(editionOf('6.0.0-preview.202611071208.gef82cf6'), 'nightly', 'the bridge');
  assert.equal(editionOf('6.0.0-preview.1'), 'nightly');
  assert.equal(editionOf('6.0.0-dev.57'), 'nightly', "CI's development builds");
  assert.equal(editionOf('7.0.0-next.202611111200.gabcdef0'), 'next');
  assert.equal(editionOf(' v7.0.0-next.202611111200.gabcdef0+meta '), 'next');
  assert.equal(editionOf('7.0.0-nextgen.1'), 'nightly', 'only the word next and its dot');
  assert.equal(editionOf('7.0.0-dev.3-next.1'), 'nightly', 'next only at the start of the pre-release');
  assert.equal(editionOf('7.0.0+next.1'), 'release', 'build metadata is no pre-release');
});

test('Next and Nightly are both pre-releases, a release is not', () => {
  assert.equal(isPreReleaseVersion('7.0.0-next.202611111200.gabcdef0'), true);
  assert.equal(isPreReleaseVersion('6.2.0-nightly.202611111200.gabcdef0'), true);
  assert.equal(isPreReleaseVersion('6.0.0-dev.57'), true);
  assert.equal(isPreReleaseVersion('6.2.0'), false);
  assert.equal(isPreReleaseVersion('6.0.0+build.5'), false);
});

test('each edition has its name and plate', () => {
  assert.equal(nameOf('release'), 'Girovo');
  assert.equal(nameOf('nightly'), 'Girovo Nightly');
  assert.equal(nameOf('next'), 'Girovo Next');
  assert.equal(plateOf('release'), null);
  assert.deepEqual(plateOf('nightly'), { plate: '#f5a623', ink: '#0a2c5e' });
  assert.deepEqual(plateOf('next'), { plate: '#7b4fe0', ink: '#ffffff' });
});

test('the numeral is the major and minor version, without a minor of 0', () => {
  assert.equal(numeralOf('6.1.0'), '6.1');
  assert.equal(numeralOf('6.1.4'), '6.1');
  assert.equal(numeralOf('6.0.3'), '6');
  assert.equal(numeralOf('7.0.0'), '7');
  assert.equal(numeralOf('12.3.4-nightly.1.gabc1234'), '12.3');
  assert.equal(numeralOf('nonsense'), null);
});
