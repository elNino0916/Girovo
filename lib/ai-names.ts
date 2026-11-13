// Girovo AI: a booking's counterparty as a short, readable name for the
// lists ("Namen mit Girovo AI aufräumen"), asked of the desktop's model.
// Unlike the phone's brand question (lib/nano-names.ts), every name gets
// one: the brand where there is one, else the name itself tidied (no legal
// form, branch or terminal number, town; normal case, umlauts back). A
// payment service is replaced by the shop its purpose names.
//
// The answer is checked before it is shown: it must come from the name or the
// purpose (a brand's usual spelling aside), so the model cannot rename a
// person or invent a shop. Measured with scripts/eval-gemma-bookings.mjs on
// scripts/eval-names-set.mjs.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { foldText } from './categorize.ts';

// i18n-data-start — the model's input, German as calibrated
export const CLEAN_SYSTEM =
  'Du machst aus dem Empfängernamen einer deutschen Kontobuchung einen kurzen, gut lesbaren Namen für die Umsatzliste. '
  + 'Steht eine bekannte Marke dahinter, nenne nur die Marke in ihrer üblichen Schreibweise, ohne Zusätze wie Markt, Station, Filiale, Telecom, Bank, Energie, Deutschland, Distribution, Vertrieb oder International. '
  + 'Sonst nenne den Namen selbst, aufgeräumt: ohne Rechtsform (GmbH, AG, SE, e.V., mbB, Inh. …), ohne Filial-, Kassen- oder Terminalnummer, ohne Ort und Land, in normaler Groß- und Kleinschreibung und mit Umlauten statt ae, oe, ue, auch in Ortsnamen (KOELN → Köln). Eine Person steht als Vorname Nachname. '
  + 'Personen, Ämter, Kassen, Praxen, Vereine und kleine Läden behalten ihren eigenen Namen; mach daraus keine Marke. '
  + 'Ist der Empfänger ein Zahlungsdienst (PayPal, Klarna, SumUp, Google Payment, Adyen …) und nennt der Verwendungszweck den Händler, nenne den Händler. '
  + 'Erfinde nichts. Antworte nur mit dem Namen.';

/** Invented examples, none of them in the test set: the fixed head of every prompt. */
export const CLEAN_SHOTS =
  'Beispiele:\n'
  + 'Empfänger: GLOBUS SB-WARENHAUS 0231 KOBLENZ DE · Verwendungszweck: – → Globus\n'
  + 'Empfänger: PayPal (Europe) S.a r.l. et Cie, S.C.A. · Verwendungszweck: 1043 Nike Retail B.V. Bestellung → Nike\n'
  + 'Empfänger: SumUp *Baeckerei Wolf · Verwendungszweck: – → Bäckerei Wolf\n'
  + 'Empfänger: STADTKASSE MUENSTER · Verwendungszweck: Hundesteuer 2026 → Stadtkasse Münster\n'
  + 'Empfänger: PETER SCHUSTER · Verwendungszweck: Miete Garage → Peter Schuster\n'
  + 'Empfänger: BRAUN, JULIA · Verwendungszweck: Geburtstag → Julia Braun\n'
  + 'Empfänger: TOOM BAUMARKT GMBH 0412 · Verwendungszweck: – → toom\n'
  + 'Empfänger: N26 Bank SE · Verwendungszweck: Ueberweisung → N26\n'
  + 'Empfänger: AMTSGERICHT DUESSELDORF · Verwendungszweck: Kostenrechnung → Amtsgericht Düsseldorf\n'
  + 'Empfänger: Zahnarztpraxis Dr. Lehmann GbR · Verwendungszweck: – → Zahnarztpraxis Dr. Lehmann\n'
  + 'Empfänger: GALERIA WARENHAUS GMBH 112 ESSEN · Verwendungszweck: – → Galeria\n'
  + 'Empfänger: Hausverwaltung Wendt & Partner GmbH · Verwendungszweck: Hausgeld → Hausverwaltung Wendt & Partner\n';
// i18n-data-end

/** Raised with every change to the texts above: names cached under another version are asked again. */
export const CLEAN_PROMPT_VERSION = 2;

/** The booking's own part of the prompt, after CLEAN_SHOTS. */
export function cleanText(name: string, purpose?: string | null): string {
  const p = String(purpose ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return `\nEmpfänger: ${String(name).trim()} · Verwendungszweck: ${p || '–'} →`; // i18n-data
}

// i18n-data-start — brands and the short forms statements use for them
const ALIASES: Record<string, string[]> = {
  AMAZON: ['AMZN'], 'DEUTSCHE BAHN': ['DB'], MICROSOFT: ['MSFT'], 'MCDONALD S': ['MCDONALDS', 'MCD'], LUFTHANSA: ['DEUTSCHE LUFTHANSA', 'DLH'],
};
// i18n-data-end

/** Letters only, umlauts as their two-letter spelling: "Müller" and "MUELLER" are one. */
const plain = (s: string) => foldText(s).replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The model's answer as a name to show, or null: nothing usable, too long, or
 * a name whose words stand neither in the bank's name nor in the purpose.
 * A brand's usual spelling passes when its letters stand there joined ("DB"
 * stays "DB"; "Booking.com" from "WWW.BOOKING.COM").
 */
export function parseCleanAnswer(answer: string | null | undefined, rawName: string, purpose?: string | null): string | null {
  const line = String(answer ?? '').trim().split('\n')[0].replace(/^["'„“]+|["'“”.]+$/g, '').replace(/^(?:→|->)\s*/, '').trim();
  if (!line || line.length > 48 || /^none$/i.test(line)) return null;
  const source = ` ${plain(`${rawName} ${purpose ?? ''}`)} `;
  const joined = source.replace(/ /g, '');
  const words = plain(line).split(' ').filter(Boolean);
  if (!words.length) return null;
  const ok = words.every((w) => source.includes(` ${w} `) || source.includes(` ${w}`) || joined.includes(w));
  if (ok) return line;
  // A brand known by a short form on statements ("AMZN Mktp" is Amazon, "DB Fernverkehr" the Deutsche Bahn).
  const alias = ALIASES[plain(line)];
  return alias && alias.some((a) => source.includes(` ${a} `) || source.includes(` ${a}`)) ? line : null;
}
