// A Depot's holdings: the read and the bank's total (the account hero,
// components/overview/AccountHero.tsx), the list and what the bank left out
// (components/Portfolio.tsx) — and the route's own refusal (app/api/portfolio).

export const de = {
  title: 'Depot',
  /** Under "Bestand noch nicht abgerufen", in the hero. */
  intro: 'Wertpapiere, Stückzahlen und Kurse, so wie deine Bank sie meldet.',
  notRead: 'Bestand noch nicht abgerufen',
  read: 'Bestand abrufen',
  refresh: 'Bestand neu abrufen',
  loading: 'Bestand wird abgerufen …',
  /** The bank's total, above the list. */
  total: 'Depotwert',
  noTotal: 'Deine Bank hat keinen Gesamtwert genannt.',
  /** When the bank was asked; the time comes formatted ("14:05"). */
  asOf: (time: string) => `Abgerufen um ${time}`,
  holdings: (n: number) => (n === 1 ? '1 Position' : `${n} Positionen`),
  empty: 'Keine Wertpapiere im Depot.',
  /** A holding's line under its name; the figures come formatted. */
  units: (n: string) => `${n} Stück`,
  price: (p: string) => `Kurs ${p}`,
  /** A bond's price, as a percentage of its nominal value. */
  pricePercent: (p: string) => `Kurs ${p} %`,
  priceOn: (day: string) => `vom ${day}`,
  /** The change since it was bought, signed and formatted ("+12,4 %"). */
  sinceBuy: (pct: string) => `${pct} seit Kauf`,
  isin: 'ISIN',
  wkn: 'WKN',
  pricesNote: 'Kurse und Werte, wie deine Bank sie zuletzt gemeldet hat – keine Echtzeitkurse.',
  unreadable: 'Deine Bank hat geantwortet, aber den Bestand konnte die App nicht lesen.',
  api: {
    failed: 'Bestandsabfrage fehlgeschlagen.',
  },
};

export const en: typeof de = {
  title: 'Securities account',
  intro: 'Securities, quantities and prices, as your bank reports them.',
  notRead: 'Holdings not loaded yet',
  read: 'Load holdings',
  refresh: 'Load holdings again',
  loading: 'Loading holdings…',
  total: 'Total value',
  noTotal: 'Your bank did not state a total value.',
  asOf: (time) => `Loaded at ${time}`,
  holdings: (n) => (n === 1 ? '1 holding' : `${n} holdings`),
  empty: 'No securities in this account.',
  units: (n) => `${n} units`,
  price: (p) => `Price ${p}`,
  pricePercent: (p) => `Price ${p} %`,
  priceOn: (day) => `on ${day}`,
  sinceBuy: (pct) => `${pct} since purchase`,
  isin: 'ISIN',
  wkn: 'WKN',
  pricesNote: 'Prices and values as your bank last reported them – not real-time prices.',
  unreadable: 'Your bank answered, but the app could not read the holdings.',
  api: {
    failed: 'Holdings enquiry failed.',
  },
};
