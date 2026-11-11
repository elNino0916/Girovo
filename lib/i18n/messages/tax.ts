// The Steuer-Jahresübersicht (lib/tax-year.ts, components/insights/TaxYear.tsx,
// its sheet in components/Statement.tsx): one year's bookings in the
// categories the user picks, for the tax return.

const nDe = (n: number) => n.toLocaleString('de-DE');
const nEn = (n: number) => n.toLocaleString('en-GB');

export const de = {
  /** The Analyse's entry to it. */
  tile: {
    title: 'Jahresübersicht für die Steuer',
    text: 'Ein Jahr Umsätze nach Kategorien für die Steuererklärung, als PDF, CSV oder ZIP mit Belegen.',
    open: 'Zusammenstellen …',
  },
  drawer: {
    title: 'Jahresübersicht für die Steuer',
    intro: 'Wähle Jahr und Kategorien. Eigene Kategorien wie „Spenden“ und aufgeteilte Umsätze machen sie genauer.',
    year: 'Jahr',
    accounts: 'Konten',
    categories: 'Kategorien',
    pickOne: 'Wähle mindestens eine Kategorie.',
    noAccount: 'Wähle mindestens ein Konto.',
    empty: (year: number) => `In ${year} gibt es in diesen Kategorien keine geladenen Umsätze.`,
    count: (n: number) => (n === 1 ? '1 Umsatz' : `${nDe(n)} Umsätze`),
    /** A group's figure while the year is not fully loaded: a floor, never the year's total. */
    atLeast: 'mind.',
    coverage: {
      complete: 'Ganzes Jahr geladen',
      running: 'Bis heute geladen',
      partial: (from: string, to: string) => `Nur ${from} bis ${to} geladen`,
      none: 'Nichts aus diesem Jahr geladen',
    },
    incomplete: (year: number) =>
      `Für ${year} fehlen Umsätze, die Summen können höher sein. Lade das ganze Jahr, bevor du sie weitergibst.`,
    load: 'Ganzes Jahr laden',
    loadHint: 'Kann eine Freigabe brauchen. Manche Banken liefern nur 90 Tage oder ein Jahr.',
    otherCurrency: (n: number) =>
      `${n === 1 ? '1 Umsatz' : `${nDe(n)} Umsätze`} in Fremdwährung nicht enthalten.`,
    pdf: 'Als PDF',
    csv: 'Als CSV',
    zip: 'Mit Belegen als ZIP',
    zipHint: (n: number) =>
      n === 0 ? 'Noch keine Belege an diesen Umsätzen.' : `${n === 1 ? '1 Beleg kommt' : `${nDe(n)} Belege kommen`} mit ins ZIP.`,
    savedCsv: 'Jahresübersicht als CSV gespeichert',
    savedZip: 'Jahresübersicht mit Belegen gespeichert',
    zipFailed: 'Die Belege ließen sich nicht lesen. Kein ZIP erstellt.',
    disclaimer: 'Keine Steuerberatung. Was absetzbar ist, entscheiden Steuerrecht und Finanzamt.',
  },
  /** The CSV's header row (German Excel's dialect either way). */
  csv: {
    header: ['Kategorie', 'Buchungstag', 'Wertstellung', 'Konto', 'Name', 'Verwendungszweck', 'Betrag', 'Gesamtbetrag (aufgeteilt)', 'Notiz', 'Belege'],
  },
  /** Offered file names, ASCII only: "Steuerjahr_2025.pdf", "Steuerjahr_2025_Belege.zip". */
  file: {
    base: 'Steuerjahr',
    receipts: 'Belege',
  },
  /** The printed sheet. */
  doc: {
    title: 'Jahresübersicht',
    file: 'Steuerjahr',
    subtitle: (year: number) => `Umsätze ${year} nach Kategorien`,
    year: 'Jahr',
    holder: 'Kontoinhaber',
    accounts: 'Konten',
    loaded: 'Enthaltene Tage',
    overview: 'Übersicht',
    category: 'Kategorie',
    bookings: 'Umsätze',
    sum: 'Summe',
    share: (total: string) => `Anteil von ${total}`,
    total: 'Summe der Kategorie',
    coverage: {
      complete: 'ganzes Jahr',
      running: 'bis zum Erstellungstag',
      partial: (from: string, to: string) => `nur ${from} bis ${to}`,
      none: 'keine Umsätze geladen',
    },
    incomplete:
      'Nicht jedes Konto deckt das ganze Jahr ab. Die Summen gelten nur für die genannten Tage und sind Mindestbeträge.',
    splitNote: 'Bei aufgeteilten Umsätzen zählt nur der Anteil dieser Kategorie.',
    basis:
      'Die Kategorien stammen vom Kontoinhaber oder automatisch von Girovo. Eine Zusammenstellung, keine steuerliche Bewertung.',
    generatedBy: (generator: string) =>
      `Erstellt mit ${generator} aus den Daten der Banken. Keine Bank hat dieses Dokument ausgestellt; maßgeblich sind ihre Kontoauszüge.`,
    end: (n: number) => `Ende der Jahresübersicht (${n === 1 ? '1 Umsatz' : `${nDe(n)} Umsätze`})`,
  },
};

export const en: typeof de = {
  tile: {
    title: 'Annual summary for your taxes',
    text: 'A year of transactions by category for your tax return, as PDF, CSV or ZIP with receipts.',
    open: 'Put together …',
  },
  drawer: {
    title: 'Annual summary for your taxes',
    intro: 'Choose the year and categories. Your own categories, like “Donations”, and split transactions make it more precise.',
    year: 'Year',
    accounts: 'Accounts',
    categories: 'Categories',
    pickOne: 'Choose at least one category.',
    noAccount: 'Choose at least one account.',
    empty: (year) => `There are no loaded transactions in these categories in ${year}.`,
    count: (n) => (n === 1 ? '1 transaction' : `${nEn(n)} transactions`),
    atLeast: 'at least',
    coverage: {
      complete: 'Whole year loaded',
      running: 'Loaded up to today',
      partial: (from, to) => `Only ${from} to ${to} loaded`,
      none: 'Nothing from this year loaded',
    },
    incomplete: (year) =>
      `Transactions for ${year} are missing, so the totals may be higher. Load the whole year before you pass them on.`,
    load: 'Load the whole year',
    loadHint: 'May need an approval. Some banks only go back 90 days or a year.',
    otherCurrency: (n) =>
      `${n === 1 ? '1 transaction' : `${nEn(n)} transactions`} in a foreign currency not included.`,
    pdf: 'As PDF',
    csv: 'As CSV',
    zip: 'With receipts as ZIP',
    zipHint: (n) =>
      n === 0 ? 'No receipts on these transactions yet.' : `${n === 1 ? '1 receipt goes' : `${nEn(n)} receipts go`} into the ZIP.`,
    savedCsv: 'Annual summary saved as CSV',
    savedZip: 'Annual summary saved with receipts',
    zipFailed: 'The receipts couldn’t be read. No ZIP created.',
    disclaimer: 'Not tax advice. What is deductible is up to tax law and your tax office.',
  },
  csv: {
    header: ['Category', 'Booking date', 'Value date', 'Account', 'Name', 'Purpose', 'Amount', 'Total amount (split)', 'Note', 'Receipts'],
  },
  file: {
    base: 'Tax_year',
    receipts: 'Receipts',
  },
  doc: {
    title: 'Annual summary',
    file: 'Tax_year',
    subtitle: (year) => `Transactions ${year} by category`,
    year: 'Year',
    holder: 'Account holder',
    accounts: 'Accounts',
    loaded: 'Days included',
    overview: 'Overview',
    category: 'Category',
    bookings: 'Transactions',
    sum: 'Total',
    share: (total) => `Share of ${total}`,
    total: 'Category total',
    coverage: {
      complete: 'whole year',
      running: 'up to the day of creation',
      partial: (from, to) => `only ${from} to ${to}`,
      none: 'no transactions loaded',
    },
    incomplete:
      'Not every account covers the whole year. The totals cover only the days stated and are minimums.',
    splitNote: 'For split transactions, only this category’s share counts.',
    basis:
      'The categories come from the account holder or automatically from Girovo. A compilation, not a tax assessment.',
    generatedBy: (generator) =>
      `Created with ${generator} from the banks’ data. No bank issued this document; their account statements are authoritative.`,
    end: (n) => `End of the annual summary (${n === 1 ? '1 transaction' : `${nEn(n)} transactions`})`,
  },
};
