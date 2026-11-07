// A Depot's holdings: the read and the bank's total (the account hero,
// components/overview/AccountHero.tsx), the list and what the bank left out
// (components/Portfolio.tsx) — and the route's own refusal (app/api/portfolio).

export const de = {
  title: 'Depot',
  /** Under "Bestand noch nicht geladen", in the hero. */
  intro: 'Wertpapiere und Kurse, wie deine Bank sie meldet.',
  notRead: 'Bestand noch nicht geladen',
  read: 'Bestand laden',
  refresh: 'Bestand neu laden',
  loading: 'Bestand wird geladen …',
  /** The bank's total, above the list. */
  total: 'Depotwert',
  noTotal: 'Deine Bank hat keinen Gesamtwert genannt.',
  /** When the bank was asked; the time comes formatted ("14:05"). */
  asOf: (time: string) => `Stand ${time}`,
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
  pricesNote: 'Kurse vom letzten Stand deiner Bank, nicht in Echtzeit.',
  unreadable: 'Girovo konnte den Bestand von deiner Bank nicht lesen.',
  api: {
    failed: 'Der Bestand ließ sich nicht laden.',
  },
};

export const en: typeof de = {
  title: 'Securities account',
  intro: 'Securities and prices, as your bank reports them.',
  notRead: 'Holdings not loaded yet',
  read: 'Load holdings',
  refresh: 'Load holdings again',
  loading: 'Loading holdings…',
  total: 'Total value',
  noTotal: 'Your bank did not state a total value.',
  asOf: (time) => `As of ${time}`,
  holdings: (n) => (n === 1 ? '1 holding' : `${n} holdings`),
  empty: 'No securities in this account.',
  units: (n) => `${n} units`,
  price: (p) => `Price ${p}`,
  pricePercent: (p) => `Price ${p} %`,
  priceOn: (day) => `on ${day}`,
  sinceBuy: (pct) => `${pct} since purchase`,
  isin: 'ISIN',
  wkn: 'WKN',
  pricesNote: 'Prices as your bank last reported them, not real-time.',
  unreadable: 'Girovo couldn’t read the holdings from your bank.',
  api: {
    failed: 'The holdings could not be loaded.',
  },
};
