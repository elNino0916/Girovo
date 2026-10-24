// Gemini Nano's clean payee names on Android (mobile/server/categories.ts asks,
// through the GirovoNano plugin's batches): "PAYPAL *EBAY" → "eBay",
// "Deichmann-Schuhe GmbH & Co. Vertriebs KG Essen DE" → "Deichmann". The
// lists show the brand; the drawer keeps the bank's own text, and the search
// finds both (components/transactions/model.ts txText).
//
// Calibrated on the owner's Galaxy S26 Ultra (nano-v4-fast, temperature 0)
// on 80 hand-made names: 54 of 66 brands named exactly, against 44 for the
// rules; 3 of 14 people and offices given a brand anyway. Two guards follow
// from that: only card payments and direct debits are asked — the other side
// is a business by construction — and a brand must stand in the bank's own
// text, so a name Nano made up never reaches a list.
//
// Pure, so the tests run it on the desktop.

import { foldText } from './categorize.ts';
import { isFacilitatorName } from './merchant-match.ts';

// i18n-data-start — the prompt is the model's input, calibrated in German
/** Nano's instruction: the brand behind the name, or NONE. The calibration's own text. */
export const NAME_SYSTEM =
  'Du liest den Empfänger- oder Auftraggebernamen einer deutschen Kontobuchung und nennst die Marke des Unternehmens dahinter. '
  + 'Antworte nur mit dem Markennamen, ohne Rechtsform (GmbH, AG, Co. KG …), Ort, Land, Filial- oder Kassennummer und ohne den Zahlungsdienstleister (PayPal, SumUp, Adyen …), wenn ein Händler dahinter steht. '
  + 'Ist es eine Privatperson, eine Behörde, eine Praxis, ein Verein oder ein Laden ohne bekannte Marke, antworte NONE.';

/** Its examples, invented — the fixed head of every prompt. */
export const NAME_SHOTS =
  'Beispiele:\n'
  + 'Tchibo GmbH → Tchibo\n'
  + 'NORMA SAGT DANKE 1234 → NORMA\n'
  + 'PAYPAL *EBAY → eBay\n'
  + 'Deichmann-Schuhe GmbH & Co. Vertriebs KG Essen DE → Deichmann\n'
  + 'Peter Schneider → NONE\n'
  + 'Deutsche Post AG → Deutsche Post\n'
  + 'Gemeindekasse Musterdorf → NONE\n'
  + 'Pizzeria Da Mario → NONE\n';
// i18n-data-end

/** Raised with every change to the texts above: names cached under another version are asked again. */
export const NAME_PROMPT_VERSION = 1;

/** The name's own part of the prompt, after NAME_SHOTS — as the calibration sent it. */
export function nameText(name: string): string {
  return `\nName: ${String(name).trim()}\nMarke:`; // i18n-data
}

const bare = (s: string) => foldText(s).replace(/[^A-Z0-9]/g, '');

/**
 * Whether Nano is asked for the brand behind a name. Not for a payment
 * service itself ("PayPal Europe S.à r.l. et Cie S.C.A.", "Klarna"): every
 * purchase through it carries its name and its creditor ID, so all of them
 * share one key whose only brand is the service — and "PayPal" stood over
 * Coolblue and Spotify alike, where the shop behind each is in its own purpose
 * (lib/analytics.ts facilitatorShop). A shop's card descriptor with the
 * service in it ("PAYPAL *EBAY") is still asked.
 */
export function asksForBrand(name: string): boolean {
  return !!String(name).trim() && !isFacilitatorName(name);
}

/**
 * Nano's answer as a brand to show, or null: NONE, nothing usable, a brand
 * that is not in the bank's text, or one that only repeats it.
 */
export function parseNameAnswer(answer: string | null | undefined, rawName: string): string | null {
  const line = String(answer ?? '').trim().split('\n')[0].trim().replace(/^["'„“]+|["'“”.]+$/g, '').trim();
  if (!line || /^none\b/i.test(line) || line.length > 40) return null;
  const brand = bare(line);
  const raw = bare(rawName);
  // Made up, or a word the name does not have.
  if (brand.length < 2 || !raw.includes(brand)) return null;
  // Nothing to tidy: the bank already wrote just this.
  if (brand === raw) return null;
  return line;
}
