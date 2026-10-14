// The Android app's words for the device it runs on.
//
// The texts are written for the desktop app and the website, where "auf
// diesem Rechner" is right. On a phone it is "auf diesem Telefon" — the word
// the Android app's own texts use (android.ts) — and a press is a tap, not a
// click. One pass over every text when the Android build loads them
// (index.ts), instead of a second copy of each.
//
// Whole phrases where the grammar changes with the word: "diesen Rechner"
// (accusative) is "dieses Telefon", and "er" for it becomes "es".

import type { Locale } from '../locale.ts';

type Swap = readonly [RegExp, string];

const SWAPS: Record<Locale, readonly Swap[]> = {
  de: [
    // Gerät vergessen: "… unter der deine Bank diesen Rechner kennt. Bei der nächsten Anmeldung gilt er als neues Gerät".
    [/diesen Rechner kennt\. Bei der nächsten Anmeldung gilt er/g, 'dieses Telefon kennt. Bei der nächsten Anmeldung gilt es'],
    [/den Rechner weiter/g, 'das Telefon weiter'],
    [/nichts davon verlässt ihn/g, 'nichts davon verlässt es'],
    [/diesen Rechner/g, 'dieses Telefon'],
    [/dieses Rechners/g, 'dieses Telefons'],
    [/diesem Rechner/g, 'diesem Telefon'],
    [/\bklickst\b/g, 'tippst'],
  ],
  en: [
    [/this computer/g, 'this phone'],
    [/\bclick\b/g, 'tap'],
  ],
};

function swapText(text: string, swaps: readonly Swap[]): string {
  let out = text;
  for (const [from, to] of swaps) out = out.replace(from, to);
  return out;
}

function swapValue(value: unknown, swaps: readonly Swap[]): unknown {
  if (typeof value === 'string') return swapText(value, swaps);
  // A text with a value in it ("seit 12.03. · von diesem Rechner"), or one
  // that comes back in parts around a highlighted figure (rich()).
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown;
    return (...args: unknown[]) => swapValue(fn(...args), swaps);
  }
  if (Array.isArray(value)) return value.map((part) => swapValue(part, swaps));
  // Plain groups of texts only — a rendered element is left as it is.
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapValue(v, swaps)]));
  }
  return value;
}

/** Every text of `messages`, in the Android app's words. */
export function onPhone<T>(messages: T, locale: Locale): T {
  return swapValue(messages, SWAPS[locale]) as T;
}
