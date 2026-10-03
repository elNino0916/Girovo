import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_LAYER_HEIGHT, anchorPosition } from './anchor.ts';

const rect = (top: number, left: number, w = 80, h = 32) => ({ top, bottom: top + h, left, right: left + w });

test('opens below its trigger and lines up with the chosen edge', () => {
  const base = { width: 240, height: 200, viewportWidth: 1280, viewportHeight: 860 };
  assert.deepEqual(anchorPosition({ ...base, anchor: rect(100, 400), placement: 'bottom-start' }), { top: 138, left: 400, maxHeight: 714 });
  assert.deepEqual(anchorPosition({ ...base, anchor: rect(100, 400), placement: 'bottom-end' }), { top: 138, left: 240, maxHeight: 714 });
});

test('flips above when the room below is short, and keeps 8px from the edges', () => {
  const p = anchorPosition({ anchor: rect(700, 1190), width: 360, height: 750, viewportWidth: 1280, viewportHeight: 860, placement: 'bottom-end' });
  // Too tall for either side: the larger one (above) wins and it scrolls.
  assert.deepEqual(p, { top: 8, left: 910, maxHeight: 686 });
  // Never past the right edge, however far right the trigger sits.
  assert.equal(anchorPosition({ anchor: rect(100, 1250), width: 300, height: 100, viewportWidth: 1280, viewportHeight: 860, placement: 'bottom-start' }).left, 972);
});

test('a layer flipped into the top-right corner stops below the OS caption buttons', () => {
  // The Umsatzdetails drawer at 1280×860 in the desktop shell: Kategorie
  // "Ändern" near the drawer's foot, 16 categories (measured in Electron).
  const drawer = {
    anchor: { top: 715, bottom: 747, left: 1170, right: 1241 },
    width: 360, height: 750, viewportWidth: 1280, viewportHeight: 862, placement: 'bottom-end' as const,
  };
  const caption = { width: 137, height: 60 };
  const p = anchorPosition({ ...drawer, caption });
  assert.equal(p.left, 881);
  assert.equal(p.top, 68);
  assert.equal(p.maxHeight, 715 - 6 - 68);
  // Without the shell nothing changes.
  assert.equal(anchorPosition(drawer).top, 8);
  assert.equal(anchorPosition({ ...drawer, caption: { width: 0, height: 0 } }).top, 8);
});

test('the caption floor applies only to layers that reach the buttons’ columns', () => {
  const caption = { width: 137, height: 60 };
  // Ends at x 1000, well left of the buttons (x ≥ 1143): the 8px margin is enough.
  const clear = anchorPosition({
    anchor: { top: 715, bottom: 747, left: 920, right: 1000 }, width: 360, height: 750,
    viewportWidth: 1280, viewportHeight: 862, placement: 'bottom-end', caption,
  });
  assert.equal(clear.top, 8);
  // A short layer flipped up stays beside its trigger, far below the band.
  const short = anchorPosition({
    anchor: { top: 715, bottom: 747, left: 1170, right: 1241 }, width: 220, height: 160,
    viewportWidth: 1280, viewportHeight: 862, placement: 'top-end', caption,
  });
  assert.deepEqual(short, { top: 549, left: 1021, maxHeight: 641 });
  // Opening downward is unaffected.
  const down = anchorPosition({
    anchor: { top: 80, bottom: 112, left: 1170, right: 1241 }, width: 220, height: 160,
    viewportWidth: 1280, viewportHeight: 862, placement: 'bottom-end', caption,
  });
  assert.equal(down.top, 118);
});

test('a cramped window still leaves a usable height', () => {
  const p = anchorPosition({ anchor: rect(60, 100, 80, 400), width: 200, height: 600, viewportWidth: 900, viewportHeight: 520, placement: 'bottom-start' });
  assert.equal(p.maxHeight, MIN_LAYER_HEIGHT);
});
