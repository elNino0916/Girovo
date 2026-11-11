// Girovo Plus (lib/plus.ts, components/android/Plus.tsx): the Google Play
// build's supporter subscription — more than one bank, the month-end forecast,
// and the gold icon.

export const de = {
  name: 'Girovo Plus',
  /** The Einstellungen row's line, by state. */
  row: {
    active: 'Aktiv, danke!',
    inactive: 'Mehrere Banken und mehr',
    unavailable: 'Auf diesem Telefon nicht verfügbar',
  },
  lead: 'Unterstütze Girovo und hol dir mehr aus deinen Konten.',
  perks: {
    banks: { title: 'Mehrere Banken', text: 'Alle deine Banken in einer Übersicht. Ohne Plus nur die erste.' },
    forecast: { title: 'Kontostand am Monatsende', text: 'Wohin sich dein Konto bis zum Monatsende bewegt, mit Warnung vor dem Dispo.' },
    ask: { title: 'Frag deine Umsätze', text: 'Gemini Nano beantwortet auf dem Telefon Fragen zu deinen Umsätzen.' },
    split: { title: 'Aufteilen', text: 'Eine Rechnung teilen und jeden Anteil mit einem GiroCode anfordern.' },
    goals: { title: 'Sparziele', text: 'Ein Ziel fürs Sparkonto und wie viel du dafür im Monat brauchst.' },
    icon: { title: 'Goldenes App-Symbol', text: 'Auf Wunsch das G€ in Gold.' },
  },
  monthly: (price: string) => `${price} pro Monat`,
  yearly: (price: string) => `${price} pro Jahr`,
  trial: (days: number) => (days === 1 ? '1 Tag kostenlos testen' : `${days} Tage kostenlos testen`),
  terms: 'Jederzeit in Google Play kündbar.',
  noOffers: 'Girovo Plus ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
  failed: 'Google Play hat den Kauf nicht geöffnet.',
  thanks: 'Danke, dass du Girovo unterstützt!',
  plan: { monthly: 'Monatlich', yearly: 'Jährlich' },
  manage: 'Abo verwalten',
  goldIcon: 'Goldenes App-Symbol',
  goldIconHint: 'Das Symbol kann vom Startbildschirm verschwinden. Girovo ist dann im App-Menü.',
  unavailable: 'Käufe über Google Play gehen auf diesem Telefon gerade nicht. Die Version von GitHub hat alles kostenlos.',
  github: 'Girovo von GitHub',
  /** A bank beside the first, without Plus (Übersicht). */
  bankLocked: 'Mit Girovo Plus',
  bankUnlock: 'Plus',
  /** The forecast's place without Plus. */
  forecastTeaser: 'Wohin sich dein Kontostand bis zum Monatsende bewegt.',
  /** "Frag deine Umsätze" without Plus, on a phone that could answer. */
  askTeaser: 'Stell Fragen zu deinen Umsätzen. Gemini Nano beantwortet sie auf dem Telefon.',
  /** The weekly reminder toast, in the Play build without Plus. */
  reminder: 'Gefällt dir Girovo? Unterstütze es mit Girovo Plus: mehrere Banken und mehr.',
  reminderAction: 'Ansehen',
  /**
   * The owner key (scripts/owner-key.mjs): Plus on the developer's own phone
   * without a purchase. Reached only by tapping the Plus screen's plate seven times.
   */
  owner: {
    title: 'Entwicklerschlüssel',
    lead: 'Schaltet Girovo Plus auf diesem Telefon ohne Kauf frei. Der Schlüssel passt nur zu dieser Installation.',
    installId: 'Installations-ID',
    key: 'Schlüssel',
    unlock: 'Freischalten',
    invalid: 'Dieser Schlüssel passt nicht zu dieser Installation.',
    active: 'Auf diesem Telefon mit dem Entwicklerschlüssel freigeschaltet.',
    remove: 'Schlüssel entfernen',
  },
};

export const en: typeof de = {
  name: 'Girovo Plus',
  row: {
    active: 'Active, thank you!',
    inactive: 'Several banks and more',
    unavailable: 'Not available on this phone',
  },
  lead: 'Support Girovo and get more out of your accounts.',
  perks: {
    banks: { title: 'Several banks', text: 'All your banks in one overview. Without Plus, only the first.' },
    forecast: { title: 'Balance at month end', text: 'Where your account is heading by the end of the month, with a warning before the overdraft.' },
    ask: { title: 'Ask your transactions', text: 'Gemini Nano answers questions about your transactions on the phone.' },
    split: { title: 'Split', text: 'Share a bill and request each share with a GiroCode.' },
    goals: { title: 'Savings goals', text: 'A goal for your savings account and how much you need each month.' },
    icon: { title: 'Gold app icon', text: 'The G€ in gold, if you like.' },
  },
  monthly: (price) => `${price} a month`,
  yearly: (price) => `${price} a year`,
  trial: (days) => (days === 1 ? 'Try 1 day free' : `Try ${days} days free`),
  terms: 'Cancel anytime in Google Play.',
  noOffers: "Girovo Plus can't be reached right now. Try again in a moment.",
  failed: "Google Play didn't open the purchase.",
  thanks: 'Thank you for supporting Girovo!',
  plan: { monthly: 'Monthly', yearly: 'Yearly' },
  manage: 'Manage subscription',
  goldIcon: 'Gold app icon',
  goldIconHint: 'The icon may disappear from your home screen. Girovo is then in the app drawer.',
  unavailable: 'Purchases through Google Play don’t work on this phone right now. The version from GitHub has everything for free.',
  github: 'Girovo from GitHub',
  bankLocked: 'With Girovo Plus',
  bankUnlock: 'Plus',
  forecastTeaser: 'Where your balance is heading by the end of the month.',
  askTeaser: 'Ask about your transactions. Gemini Nano answers on the phone.',
  reminder: 'Enjoying Girovo? Support it with Girovo Plus: several banks and more.',
  reminderAction: 'See',
  owner: {
    title: 'Developer key',
    lead: 'Unlocks Girovo Plus on this phone without a purchase. The key fits only this installation.',
    installId: 'Installation ID',
    key: 'Key',
    unlock: 'Unlock',
    invalid: "This key doesn't fit this installation.",
    active: 'Unlocked on this phone with the developer key.',
    remove: 'Remove key',
  },
};
