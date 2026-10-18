// Material You on the phone: the wallpaper's tonal palettes (GirovoDevice,
// Android 12+) turned into Material 3's colour roles, as CSS custom
// properties (--md-*) in place of Girovo's own (app/material.css maps
// Girovo's tokens onto them on every platform).
//
// Only surfaces, ink and the interactive colour follow the wallpaper. The
// colours that mean something — a credit, a negative balance, vorgemerkt,
// the emphasis mark — keep Girovo's values on every phone (globals.css never
// maps them), so a wallpaper can never make an overdraft look like a credit.
//
// Android 14 and later publish the roles themselves (system_<role>_light,
// system_<role>_dark): those are used as they are, so the app is drawn in the
// very colours of the phone's own apps — whatever scheme variant and contrast
// level the phone has chosen.
//
// Android 12 and 13 publish only the tonal palettes, thirteen tones each
// (100, 99, 95, 90 … 10, 0), and the roles are made here with Material 3's
// baseline mapping. Its surface roles also use tones in between (98, 96, 94,
// 92, 87, 24, 22, 17, 12, 6, 4). Material's tone is CIELAB's L*, so those are
// made exactly: the lightness is the tone itself, the colour (a*, b*) is taken
// between the two neighbours Android gave.

import type { DynamicPalette, DynamicRoles } from '../native';

type Palette = DynamicPalette[keyof DynamicPalette];
type Lab = [number, number, number];

// D65 white, sRGB primaries.
const WHITE = [0.95047, 1, 1.08883];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labToHex([L, A, B]: Lab): string {
  const fy = (L + 16) / 116;
  const x = fInv(fy + A / 500) * WHITE[0];
  const y = fInv(fy) * WHITE[1];
  const z = fInv(fy - B / 200) * WHITE[2];
  const rgb = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ].map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Tone `t` of a palette: Android's own where it has one, else made at that lightness. */
export function tone(palette: Palette, t: number): string {
  if (palette[String(t)]) return palette[String(t)];
  const known = Object.keys(palette).map(Number).sort((a, b) => a - b);
  const below = [...known].reverse().find((k) => k < t) ?? known[0];
  const above = known.find((k) => k > t) ?? known[known.length - 1];
  const a = hexToLab(palette[String(below)]);
  const b = hexToLab(palette[String(above)]);
  const at = below === above ? 0 : (t - below) / (above - below);
  return labToHex([t, a[1] + (b[1] - a[1]) * at, a[2] + (b[2] - a[2]) * at]);
}

/** Material 3's colour roles and the tone each takes, light and dark (the baseline scheme). */
const ROLES: Record<string, [keyof DynamicPalette, number, number]> = {
  primary: ['primary', 40, 80],
  'on-primary': ['primary', 100, 20],
  'primary-container': ['primary', 90, 30],
  'on-primary-container': ['primary', 10, 90],
  'inverse-primary': ['primary', 80, 40],
  secondary: ['secondary', 40, 80],
  'on-secondary': ['secondary', 100, 20],
  'secondary-container': ['secondary', 90, 30],
  'on-secondary-container': ['secondary', 10, 90],
  tertiary: ['tertiary', 40, 80],
  'on-tertiary': ['tertiary', 100, 20],
  'tertiary-container': ['tertiary', 90, 30],
  'on-tertiary-container': ['tertiary', 10, 90],
  surface: ['neutral', 98, 6],
  'surface-dim': ['neutral', 87, 6],
  'surface-bright': ['neutral', 98, 24],
  'surface-container-lowest': ['neutral', 100, 4],
  'surface-container-low': ['neutral', 96, 10],
  'surface-container': ['neutral', 94, 12],
  'surface-container-high': ['neutral', 92, 17],
  'surface-container-highest': ['neutral', 90, 22],
  'on-surface': ['neutral', 10, 90],
  'on-surface-variant': ['neutralVariant', 30, 80],
  outline: ['neutralVariant', 50, 60],
  'outline-variant': ['neutralVariant', 80, 30],
  'inverse-surface': ['neutral', 20, 90],
  'inverse-on-surface': ['neutral', 95, 20],
  scrim: ['neutral', 0, 0],
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The roles as CSS declarations for one theme: Android's published colour
 * where it gave one (`published`, Android 14+), else made from the palettes.
 */
export function schemeCss(palette: DynamicPalette, dark: boolean, published: Record<string, string> = {}): string {
  return Object.entries(ROLES)
    .map(([role, [which, light, night]]) => {
      const given = published[role];
      return `--md-${role}: ${given && HEX.test(given) ? given : tone(palette[which], dark ? night : light)};`;
    })
    .join(' ');
}

/** A stylesheet for both themes, scoped to the Android page. */
export function materialYouCss(palette: DynamicPalette, roles?: DynamicRoles): string {
  return [
    `:root[data-platform='android'] { ${schemeCss(palette, false, roles?.light)} }`,
    `:root[data-platform='android'][data-theme='dark'] { ${schemeCss(palette, true, roles?.dark)} }`,
  ].join('\n');
}
