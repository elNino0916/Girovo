// "Frag deine Umsätze" (Android, Gemini Nano — components/insights/Ask.tsx; the desktop with its own model, `desktop`):
// a question about the loaded bookings, turned into a search by Gemini Nano
// and answered by Girovo on the phone (lib/nano-ask.ts).

import type { ReactNode } from 'react';

export const de = {
  title: 'Frag deine Umsätze',
  placeholder: 'Wie viel ging an Amazon?',
  ask: 'Fragen',
  /** Questions to start from, tapped to ask. */
  suggestions: ['Lebensmittel letzten Monat', 'Größte Ausgabe dieses Jahr', 'Essen gehen pro Monat'],
  reading: 'Gemini Nano liest die Frage …',
  failed: 'Gemini Nano hat gerade nicht geantwortet. Versuch es gleich noch einmal.',
  notUnderstood: 'Das hat Gemini Nano nicht verstanden. Frag etwa „Tanken im August“.',
  /** What the question was read as, before the answer. */
  understood: 'Gesucht',
  dir: { out: 'Ausgaben', in: 'Eingänge', all: 'Ausgaben und Eingänge' },
  period: {
    all: 'alle geladenen Umsätze',
    today: 'heute',
    days: (n: number) => `letzte ${n} Tage`,
    months: (n: number) => `letzte ${n} Monate`,
    since: (month: string) => `seit ${month}`,
  },
  /** In "Gesucht": what a ranking ranks, and what a comparison is set against. */
  rankBy: { category: 'nach Kategorie', payee: 'nach Empfänger' },
  versus: (period: string) => `gegenüber ${period}`,
  /** Above a ranking's rows. */
  rankTitle: {
    category: {
      sum: { out: 'Am meisten ausgegeben für', in: 'Am meisten bekommen als' },
      count: { out: 'Am häufigsten bezahlt für', in: 'Am häufigsten bekommen als' },
    },
    payee: {
      sum: { out: 'Am meisten ausgegeben bei', in: 'Am meisten bekommen von' },
      count: { out: 'Am häufigsten bezahlt an', in: 'Am häufigsten bekommen von' },
    },
  },
  /** A comparison's difference, after the amount. */
  more: 'mehr',
  less: 'weniger',
  same: 'Genau gleich viel',
  compareMissing: 'Für einen der Zeiträume sind keine Umsätze geladen.',
  /** On a phone without Gemini Nano v4: the tile says why, and where an update may help. */
  unsupported: {
    tag: 'Nicht unterstützt',
    tooOld: (model: string, min: number) => `Dafür braucht es Gemini Nano v${min}. Dieses Telefon hat ${model}.`,
    unnamed: (min: number) => `Dafür braucht es Gemini Nano v${min}. Welche Version dieses Telefon hat, ist unklar.`,
    loading: 'Android lädt Gemini Nano noch. Danach kannst du hier fragen.',
    systemUpdate: 'Gemini Nano braucht ein Systemupdate. Installiere die neuesten Updates.',
    aicore: 'Gemini Nano braucht ein Update von AICore.',
    none: 'Dieses Telefon bietet Gemini Nano nicht an.',
    hint: 'Oft hilft es, AICore und Private Compute Services im Play Store zu aktualisieren.',
    update: 'AICore aktualisieren',
  },
  /** The figure's name. */
  spent: 'Ausgegeben',
  received: 'Bekommen',
  times: (n: number) => (n === 1 ? '1-mal' : `${n}-mal`),
  together: (amount: ReactNode): ReactNode[] => ['zusammen ', amount],
  bookings: (n: number) => (n === 1 ? '1 Umsatz' : `${n} Umsätze`),
  largestOut: 'Größte Ausgabe',
  largestIn: 'Größter Eingang',
  last: (day: string) => `Zuletzt am ${day}`,
  /** Before an estimate in whole euros. */
  approx: 'ca.',
  perMonth: 'pro Monat',
  averageBasis: (n: number) => (n === 1 ? 'aus 1 vollen Monat' : `aus ${n} vollen Monaten`),
  noWholeMonth: 'Noch kein voller Monat geladen. Das ist die Summe.',
  none: 'Keine passenden Umsätze',
  noneHint: (range: string) => `Keiner der geladenen Umsätze (${range}) passt.`,
  outside: 'Für diesen Zeitraum sind keine Umsätze geladen.',
  partial: (day: string) => `Erst ab ${day} geladen. Es kann mehr gewesen sein.`,
  atLeast: 'mind.',
  show: 'Umsätze zeigen',
  /** The desktop reads the question with the app's own category model, not Gemini Nano. */
  desktop: {
    reading: 'Girovo liest die Frage …',
    notUnderstood: 'Das hat Girovo nicht verstanden. Frag etwa „Tanken im August“.',
  },
};

export const en: typeof de = {
  title: 'Ask your transactions',
  placeholder: 'How much went to Amazon?',
  ask: 'Ask',
  suggestions: ['Groceries last month', 'Largest expense this year', 'Eating out per month'],
  reading: 'Gemini Nano is reading the question …',
  failed: "Gemini Nano didn't answer just now. Try again in a moment.",
  notUnderstood: 'Gemini Nano didn’t understand that. Try something like “fuel in August”.',
  understood: 'Searched for',
  dir: { out: 'Spending', in: 'Income', all: 'Spending and income' },
  period: {
    all: 'all loaded transactions',
    today: 'today',
    days: (n) => `last ${n} days`,
    months: (n) => `last ${n} months`,
    since: (month) => `since ${month}`,
  },
  rankBy: { category: 'by category', payee: 'by payee' },
  versus: (period) => `against ${period}`,
  rankTitle: {
    category: {
      sum: { out: 'Most spent on', in: 'Most received as' },
      count: { out: 'Most often paid for', in: 'Most often received as' },
    },
    payee: {
      sum: { out: 'Most spent at', in: 'Most received from' },
      count: { out: 'Most often paid to', in: 'Most often received from' },
    },
  },
  more: 'more',
  less: 'less',
  same: 'Exactly the same',
  compareMissing: 'No transactions are loaded for one of the periods.',
  unsupported: {
    tag: 'Not supported',
    tooOld: (model, min) => `This needs Gemini Nano v${min}. This phone has ${model}.`,
    unnamed: (min) => `This needs Gemini Nano v${min}. It’s unclear which version this phone has.`,
    loading: 'Android is still downloading Gemini Nano. Then you can ask here.',
    systemUpdate: 'Gemini Nano needs a system update. Install the latest updates.',
    aicore: 'Gemini Nano needs an AICore update.',
    none: 'This phone doesn’t offer Gemini Nano.',
    hint: 'Updating AICore and Private Compute Services in the Play Store often helps.',
    update: 'Update AICore',
  },
  spent: 'Spent',
  received: 'Received',
  times: (n) => (n === 1 ? 'once' : `${n} times`),
  together: (amount) => [amount, ' in total'],
  bookings: (n) => (n === 1 ? '1 transaction' : `${n} transactions`),
  largestOut: 'Largest expense',
  largestIn: 'Largest payment in',
  last: (day) => `Last on ${day}`,
  approx: 'approx.',
  perMonth: 'a month',
  averageBasis: (n) => (n === 1 ? 'from 1 whole month' : `from ${n} whole months`),
  noWholeMonth: 'No whole month loaded yet. This is the total.',
  none: 'No matching transactions',
  noneHint: (range) => `None of the loaded transactions (${range}) match.`,
  outside: 'No transactions are loaded for this period.',
  partial: (day) => `Only loaded from ${day}. There may have been more.`,
  atLeast: 'at least',
  show: 'Show transactions',
  desktop: {
    reading: 'Girovo is reading the question …',
    notUnderstood: 'Girovo didn’t understand that. Try something like “fuel in August”.',
  },
};
