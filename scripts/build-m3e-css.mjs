// Writes the generated parts of app/material.css — Girovo's
// Material 3 Expressive layer — between their markers:
//
//   m3e:springs   the six springs of Compose's expressive motion scheme
//                 (androidx.compose.material3, ExpressiveMotionTokens) as CSS
//                 `linear()` easings, each with the time it takes to settle
//   m3e:loading   the loading indicator: the shapes of Compose's default
//                 sequence (LoadingIndicatorDefaults: soft burst, 9-sided
//                 cookie, pentagon, pill, sunny, 4-sided cookie, oval) as
//                 clip-path polygons with one point count, so CSS can morph
//                 each into the next
//
//   node scripts/build-m3e-css.mjs
//
// A spring is not a curve with a duration but a mass on a spring; the curve
// is that motion sampled from 0 to the moment it stays within 0.1 % of its
// target, and the duration is that moment. Spatial springs (position, size,
// shape) may overshoot; effects springs (colour, opacity) are critically
// damped and never do.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'app', 'material.css');

const round = (n, places) => Number(n.toFixed(places));

// ---------------------------------------------------------------------------
// Springs

const SPRINGS = {
  'spatial-fast': { damping: 0.6, stiffness: 800 },
  'spatial-default': { damping: 0.8, stiffness: 380 },
  'spatial-slow': { damping: 0.8, stiffness: 200 },
  'effects-fast': { damping: 1, stiffness: 3800 },
  'effects-default': { damping: 1, stiffness: 1600 },
  'effects-slow': { damping: 1, stiffness: 800 },
};

/** Position of a unit-mass spring released from 0 towards 1, at time t (s). */
function position({ damping, stiffness }, t) {
  const w0 = Math.sqrt(stiffness);
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t));
}

/** When the spring stays within `eps` of 1 from then on. */
function settleTime(spring, eps = 0.001) {
  const dt = 0.0005;
  let last = 0;
  for (let t = 0; t < 3; t += dt) if (Math.abs(1 - position(spring, t)) > eps) last = t;
  return last + dt;
}

function easing(spring, steps = 32) {
  const duration = settleTime(spring);
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(round(position(spring, (duration * i) / steps), 4));
  points[0] = 0;
  points[steps] = 1;
  return { curve: `linear(${points.join(', ')})`, ms: Math.round(duration * 1000) };
}

const springLines = Object.entries(SPRINGS).flatMap(([name, spring]) => {
  const { curve, ms } = easing(spring);
  return [`    --m3e-${name}: ${curve};`, `    --m3e-${name}-ms: ${ms}ms;`];
});

// ---------------------------------------------------------------------------
// Loading indicator shapes, as radial functions r(θ), each scaled to fit the
// unit circle. Every polygon starts at the top and runs clockwise through the
// same angles, so one morphs into the next without twisting.

const N = 72;
const TAU = Math.PI * 2;

const lobes = (k, depth) => (a) => 1 + depth * Math.cos(k * a);
function regular(k, rounding) {
  return (a) => {
    const seg = TAU / k;
    const local = ((((a + Math.PI / 2) % seg) + seg) % seg) - seg / 2;
    const flat = Math.cos(Math.PI / k) / Math.cos(local);
    return flat * (1 - rounding) + rounding;
  };
}
function ellipse(rx, ry, tilt) {
  return (a) => {
    const t = a - tilt;
    return (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t));
  };
}
/** A capsule along `tilt`: half-length `half` of the straight part, end radius `r`. */
function capsule(half, r, tilt) {
  const dist = (x, y) => {
    const u = x * Math.cos(tilt) + y * Math.sin(tilt);
    const v = -x * Math.sin(tilt) + y * Math.cos(tilt);
    const cu = Math.max(-half, Math.min(half, u));
    return Math.hypot(u - cu, v);
  };
  return (a) => {
    let lo = 0;
    let hi = half + r + 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (dist(mid * Math.cos(a), mid * Math.sin(a)) < r) lo = mid;
      else hi = mid;
    }
    return lo;
  };
}

const SHAPES = [
  ['soft-burst', lobes(10, 0.1)],
  ['cookie-9', lobes(9, 0.08)],
  ['pentagon', regular(5, 0.18)],
  ['pill', capsule(0.42, 0.5, -Math.PI / 4)],
  ['sunny', lobes(8, 0.07)],
  ['cookie-4', lobes(4, 0.12)],
  ['oval', ellipse(1, 0.68, -Math.PI / 4)],
];

/** 38dp of shape in a 48dp box (LoadingIndicatorTokens): radius 38/48/2 of the box. */
const RADIUS = (38 / 48) * 50;

function polygon(r) {
  const angles = Array.from({ length: N }, (_, i) => (TAU * i) / N - Math.PI / 2);
  const radii = angles.map(r);
  const max = Math.max(...radii);
  const points = angles.map((a, i) => {
    const d = (radii[i] / max) * RADIUS;
    return `${round(50 + d * Math.cos(a), 2)}% ${round(50 + d * Math.sin(a), 2)}%`;
  });
  return `polygon(${points.join(', ')})`;
}

// Compose morphs to the next shape every 650ms on the fast spatial spring.
const morph = easing(SPRINGS['spatial-fast']).curve;
const MORPH_MS = 650;
const total = MORPH_MS * SHAPES.length;
const frames = [...SHAPES, SHAPES[0]].map(([name, r], i) => {
  const at = round((i / SHAPES.length) * 100, 3);
  const timing = i < SHAPES.length ? ` animation-timing-function: ${morph};` : '';
  return `  ${at}% { clip-path: ${polygon(r)};${timing} } /* ${name} */`;
});
const loadingLines = [
  `@keyframes m3e-loading-morph {`,
  ...frames,
  `}`,
  `@keyframes m3e-loading-turn {`,
  `  to { rotate: 1turn; }`,
  `}`,
  `:root { --m3e-loading-morph-ms: ${total}ms; }`,
];

// ---------------------------------------------------------------------------

function between(css, name, lines) {
  const start = `/* ${name}:start — generated by scripts/build-m3e-css.mjs */`;
  const end = `/* ${name}:end */`;
  const from = css.indexOf(start);
  const to = css.indexOf(end);
  if (from < 0 || to < from) throw new Error(`app/material.css has no ${name} markers`);
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  return css.slice(0, from + start.length) + eol + lines.join(eol) + eol + css.slice(to);
}

let css = fs.readFileSync(CSS, 'utf8');
css = between(css, 'm3e:springs', springLines);
css = between(css, 'm3e:loading', loadingLines);
fs.writeFileSync(CSS, css);
console.log(`✓ app/material.css: ${Object.keys(SPRINGS).length} springs, ${SHAPES.length} loading shapes`);
