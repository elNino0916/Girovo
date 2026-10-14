import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialYouCss, schemeCss, tone } from './material-you.ts';

// A neutral palette as Android 17 hands it out (system_neutral1_*), keyed by tone.
const NEUTRAL = {
  '100': '#ffffff', '99': '#fefbff', '95': '#f1f0f6', '90': '#e3e2e7', '80': '#c7c6cb', '70': '#abaab0',
  '60': '#919095', '50': '#77767b', '40': '#5e5e63', '30': '#46464b', '20': '#2f3035', '10': '#1a1b20', '0': '#000000',
};

/** CIELAB L* of a colour, the measure Material's tone is. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

test('a tone Android gave is used as given', () => {
  assert.equal(tone(NEUTRAL, 90), '#e3e2e7');
  assert.equal(tone(NEUTRAL, 10), '#1a1b20');
});

test('a tone in between lands at its own lightness', () => {
  for (const t of [98, 96, 94, 92, 87, 24, 22, 17, 12, 6, 4]) {
    assert.ok(Math.abs(lightness(tone(NEUTRAL, t)) - t) < 0.8, `tone ${t} came out at L* ${lightness(tone(NEUTRAL, t)).toFixed(1)}`);
  }
});

test('surfaces step the way Material orders them, by day and by night', () => {
  const palette = { primary: NEUTRAL, secondary: NEUTRAL, tertiary: NEUTRAL, neutral: NEUTRAL, neutralVariant: NEUTRAL };
  const value = (css: string, role: string) => css.match(new RegExp(`--md-${role}: (#[0-9a-f]{6});`))![1];
  const day = schemeCss(palette, false);
  const night = schemeCss(palette, true);
  const order = ['surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest'];
  const dayL = order.map((r) => lightness(value(day, r)));
  const nightL = order.map((r) => lightness(value(night, r)));
  assert.deepEqual([...dayL].sort((a, b) => b - a), dayL); // lighter to darker by day
  assert.deepEqual([...nightL].sort((a, b) => a - b), nightL); // darker to lighter at night
  assert.match(materialYouCss(palette), /\[data-theme='dark'\]/);
});

test('a role Android published (14+) is used as published, the rest is made', () => {
  const palette = { primary: NEUTRAL, secondary: NEUTRAL, tertiary: NEUTRAL, neutral: NEUTRAL, neutralVariant: NEUTRAL };
  const css = materialYouCss(palette, { light: { primary: '#123456', 'surface-container-high': '#abcdef' }, dark: { primary: '#fedcba' } });
  const [day, night] = css.split(/\r?\n/);
  assert.match(day, /--md-primary: #123456;/);
  assert.match(day, /--md-surface-container-high: #abcdef;/);
  assert.match(day, /--md-surface: #[0-9a-f]{6};/);
  assert.match(night, /--md-primary: #fedcba;/);
  // Something that is no colour is not passed into the stylesheet.
  assert.doesNotMatch(materialYouCss(palette, { light: { primary: 'red; } body { x' }, dark: {} }), /body/);
});
