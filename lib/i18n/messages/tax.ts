// The Steuer-Jahresübersicht (lib/tax-year.ts, components/insights/TaxYear.tsx,
// its sheet in components/Statement.tsx): one year's bookings in the
// categories the user picks, for the tax return.

const nDe = (n: number) => n.toLocaleString('de-DE');
const nEn = (n: number) => n.toLocaleString('en-GB');

export const de = {
  /** The Analyse's entry to it. */
  tile: {
    title: 'Jahresübersicht für die Steuer',
    text: 'Die Umsätze eines Jahres aus den Kategorien, die deine Steuererklärung braucht – als PDF, als CSV oder mit deinen Belegen als ZIP.',
    open: 'Zusammenstellen …',
  },
  drawer: {
    title: 'Jahresübersicht für die Steuer',
    intro: 'Wähle Jahr und Kategorien. Eigene Kategorien wie „Spenden“ oder „Handwerker“ und aufgeteilte Umsätze machen sie genauer.',
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
      partial: (from: string, to: string) => `Nur ${from} – ${to} geladen`,
      none: 'Nichts aus diesem Jahr geladen',
    },
    incomplete: (year: number) =>
      `Für ${year} sind nicht alle Umsätze geladen. Die Summen sind deshalb Mindestbeträge – lade das ganze Jahr, bevor du sie weitergibst.`,
    load: 'Ganzes Jahr laden',
    loadHint: 'Kann eine Freigabe erfordern. Manche Banken liefern nur 90 Tage oder ein Jahr zurück.',
    otherCurrency: (n: number) =>
      `${n === 1 ? '1 Umsatz' : `${nDe(n)} Umsätze`} in einer anderen Währung als Euro ${n === 1 ? 'ist' : 'sind'} nicht enthalten.`,
    pdf: 'Als PDF',
    csv: 'Als CSV',
    zip: 'Mit Belegen als ZIP',
    zipHint: (n: number) =>
      n === 0 ? 'An diesen Umsätzen hängt noch kein Beleg.' : `${n === 1 ? '1 Beleg kommt' : `${nDe(n)} Belege kommen`} mit der CSV in das ZIP.`,
    savedCsv: 'Jahresübersicht als CSV gespeichert',
    savedZip: 'Jahresübersicht mit Belegen gespeichert',
    zipFailed: 'Die Belege konnten nicht gelesen werden – das ZIP wurde nicht erstellt.',
    disclaimer: 'Eine Zusammenstellung deiner Umsätze, keine Steuerberatung: Was absetzbar ist, entscheiden das Steuerrecht und dein Finanzamt.',
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
      partial: (from: string, to: string) => `nur ${from} – ${to}`,
      none: 'keine Umsätze geladen',
    },
    incomplete:
      'Nicht für jedes Konto lagen die Umsätze des ganzen Jahres vor. Die Summen umfassen nur die genannten Tage und sind deshalb Mindestbeträge.',
    splitNote: 'Bei aufgeteilten Umsätzen zählt nur der Anteil, den der Kontoinhaber dieser Kategorie zugeordnet hat.',
    basis:
      'Die Kategorien hat der Kontoinhaber selbst gewählt oder die App automatisch vergeben. Diese Übersicht ist eine Zusammenstellung, keine steuerliche Bewertung.',
    generatedBy: (generator: string) =>
      `Erstellt mit ${generator} aus den Umsätzen, die die Banken per FinTS übermittelt haben. Keine Bank hat dieses Dokument ausgestellt; maßgeblich sind ihre eigenen Kontoauszüge.`,
    end: (n: number) => `Ende der Jahresübersicht – ${n === 1 ? '1 Umsatz' : `${nDe(n)} Umsätze`}`,
  },
};

export const en: typeof de = {
  tile: {
    title: 'Annual summary for your taxes',
    text: 'A year’s transactions in the categories your tax return needs – as a PDF, as a CSV or with your receipts as a ZIP.',
    open: 'Put together …',
  },
  drawer: {
    title: 'Annual summary for your taxes',
    intro: 'Choose the year and the categories. Your own categories, such as “Donations” or “Tradespeople”, and split transactions make it more precise.',
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
      partial: (from, to) => `Only ${from} – ${to} loaded`,
      none: 'Nothing from this year loaded',
    },
    incomplete: (year) =>
      `Not every transaction of ${year} is loaded, so the totals are minimums – load the whole year before you pass them on.`,
    load: 'Load the whole year',
    loadHint: 'May need an approval. Some banks only go back 90 days or a year.',
    otherCurrency: (n) =>
      `${n === 1 ? '1 transaction' : `${nEn(n)} transactions`} in a currency other than euros ${n === 1 ? 'is' : 'are'} not included.`,
    pdf: 'As PDF',
    csv: 'As CSV',
    zip: 'With receipts as ZIP',
    zipHint: (n) =>
      n === 0 ? 'None of these transactions has a receipt yet.' : `${n === 1 ? '1 receipt goes' : `${nEn(n)} receipts go`} into the ZIP with the CSV.`,
    savedCsv: 'Annual summary saved as CSV',
    savedZip: 'Annual summary saved with receipts',
    zipFailed: 'The receipts could not be read – the ZIP was not created.',
    disclaimer: 'A compilation of your transactions, not tax advice: what is deductible is for tax law and your tax office to decide.',
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
      partial: (from, to) => `only ${from} – ${to}`,
      none: 'no transactions loaded',
    },
    incomplete:
      'Not every account’s transactions were available for the whole year. The totals cover only the days stated and are therefore minimums.',
    splitNote: 'For split transactions only the share the account holder assigned to this category counts.',
    basis:
      'The categories were chosen by the account holder or assigned automatically by the app. This summary is a compilation, not a tax assessment.',
    generatedBy: (generator) =>
      `Created with ${generator} from the transactions the banks transmitted via FinTS. No bank issued this document; their own statements are authoritative.`,
    end: (n) => `End of the annual summary – ${n === 1 ? '1 transaction' : `${nEn(n)} transactions`}`,
  },
};
