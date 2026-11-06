// "Neue Umsätze melden" (6.0, lib/background-check.ts): the notices a check
// leaves, the switch and its dialog in Einstellungen, the route's answers.

export const de = {
  // The notices — on the desktop Windows' or the desktop's own, on the phone Android's.
  newTitle: (n: number, bank: string) => `${n === 1 ? 'Ein neuer Umsatz' : `${n} neue Umsätze`} bei ${bank}`,
  /** A booking without a name to show. */
  someone: 'Umsatz',
  more: (n: number) => `und ${n} weitere`,
  approvalTitle: (bank: string) => `${bank} möchte eine Freigabe`,
  approvalText: 'Melde dich einmal in Girovo an – danach sieht Girovo dort wieder nach neuen Umsätzen.',
  loginTitle: (bank: string) => `Girovo sieht bei ${bank} gerade nicht nach`,
  loginText: 'Das gemerkte Gerät öffnet sich nicht mehr. Melde dich einmal in Girovo an.',
  refusedTitle: (bank: string) => `${bank} hat die PIN abgelehnt`,
  refusedText: (bank: string) => `Die gespeicherte PIN ist gelöscht, Girovo sieht bei ${bank} nicht mehr nach. Schalte es nach der nächsten Anmeldung wieder ein.`,
  // The payment alerts (lib/payment-alerts.ts).
  dearerTitle: (name: string) => `${name} ist teurer geworden`,
  dearerText: (now: string, was: string, bank: string) => `${now} statt ${was} · ${bank}`,
  dearerTextHidden: (bank: string) => `Abgebucht wurde mehr als sonst · ${bank}`,
  incomeTitle: (n: number, bank: string) => (n === 1 ? `Geld eingegangen bei ${bank}` : `${n} Eingänge bei ${bank}`),
  lowTitle: (limit: string) => `Kontostand unter ${limit}`,
  lowTitleHidden: 'Kontostand unter deiner Grenze',
  lowText: (account: string, bank: string, balance: string) => `${account} bei ${bank}: ${balance}`,
  lowTextHidden: (account: string, bank: string) => `${account} bei ${bank}`,
  /** An account without a name of its own, by its number's end. */
  accountEnding: (tail: string) => `Konto …${tail}`,
  /** The Android notification channel, as the system's settings list it. */
  channel: 'Neue Umsätze',

  // Einstellungen
  title: 'Neue Umsätze melden',
  hint: 'Alle sechs Stunden sieht Girovo bei deinen Banken nach und meldet, was neu ist.',
  /** On, with banks that wait for the user. */
  hintPaused: (banks: string) => `Bei ${banks} wartet Girovo, bis du dich einmal anmeldest.`,
  askTitle: 'Neue Umsätze melden?',
  askText:
    'Girovo meldet sich dafür alle sechs Stunden ohne dich bei deinen Banken an – mit dem gemerkten Gerät und deiner PIN. Die PIN liegt dafür verschlüsselt auf diesem Gerät, geschützt vom System, aber ohne Finger oder Gesicht davor. Fragt eine Bank nach einer Freigabe, wartet Girovo dort, bis du dich wieder anmeldest. Lehnt sie die PIN ab, wird sie sofort gelöscht.',
  /** The desktop only: what the app does to be able to look. */
  askDesktop: 'Schließt du das Fenster, läuft Girovo im Infobereich weiter. Unter Windows startet es mit, unsichtbar.',
  amounts: 'Beträge in den Mitteilungen zeigen',
  turnOn: 'Einschalten',
  notNow: 'Nicht jetzt',
  nowOn: (n: number) => (n === 1 ? 'Girovo meldet jetzt neue Umsätze dieser Bank.' : `Girovo meldet jetzt neue Umsätze von ${n} Banken.`),
  nowOff: 'Girovo meldet keine neuen Umsätze mehr. Die gespeicherten PINs sind gelöscht.',
  /** Logins without a remembered device are left out: a check could not open them without an approval. */
  noDevice: (banks: string) => `${banks}: Gerät nicht gemerkt – dort sieht Girovo nicht nach.`,
  noneTaken: 'Merke dir zuerst dieses Gerät bei deiner Bank – sonst kann Girovo dort nicht ohne dich nachsehen.',
  /** Android 13 and later: the notifications were not allowed. */
  noPermission: 'Mitteilungen sind für Girovo aus. Erlaube sie in den Android-Einstellungen und schalte es dann ein.',
  failed: 'Das hat nicht geklappt. Versuche es noch einmal.',
  /** In the dialogs of "Gerät vergessen" and "Gespeicherte Daten löschen", while it is on. */
  goesToo: 'Die PINs für „Neue Umsätze melden“ werden dabei auch gelöscht.',
  /** The desktop: the window was closed while it is on — once. */
  stillRunning: 'Girovo läuft im Infobereich weiter und meldet neue Umsätze.',
  /** The desktop's tray menu. */
  trayOpen: 'Girovo öffnen',
  trayCheck: 'Jetzt nach neuen Umsätzen sehen',
  trayQuit: 'Beenden',

  // Einstellungen → Was Girovo meldet (components/settings/BackgroundAlerts.tsx)
  alerts: {
    title: 'Was Girovo meldet',
    /** The row's summary: what is on, in a list. */
    parts: { every: 'neue Umsätze', dearer: 'teurere Verträge', income: 'Eingänge', low: 'Kontostand' },
    nothing: 'Nur, wenn eine Bank auf dich wartet',
    intro: 'Jeder Umsatz wird einmal gemeldet, mit der Mitteilung, die am besten passt.',
    every: 'Jeden neuen Umsatz',
    dearer: 'Teurere Verträge und Abos',
    dearerHint: 'Wenn ein Vertrag aus „Verträge & Abos“ mehr abbucht als sonst. Den gewohnten Preis kennt Girovo aus den Umsätzen, die du in der App lädst.',
    income: 'Gehalt und regelmäßige Eingänge',
    incomeHint: 'Lohn, Rente und was sonst regelmäßig eingeht.',
    low: 'Kontostand unter …',
    lowHint: 'Girovo meldet sich einmal, wenn der Kontostand darunter fällt, und wieder, sobald er erst darüber und dann wieder darunter war. Leer: keine Meldung.',
    lowFor: (account: string) => `Grenze für ${account}`,
    invalid: 'Gib einen Betrag ein, zum Beispiel 100,00.',
    saved: 'Gespeichert. Das gilt ab der nächsten Prüfung.',
    failed: 'Die Einstellungen ließen sich nicht lesen. Versuche es noch einmal.',
  },

  // app/api/background
  api: {
    unavailable: 'Neue Umsätze melden gibt es hier nicht.',
    noSecret: 'Die PINs lassen sich hier nicht geschützt aufbewahren.',
    unknownAction: 'Unbekannte Aktion.',
  },
};

export const en: typeof de = {
  newTitle: (n, bank) => `${n === 1 ? 'A new transaction' : `${n} new transactions`} at ${bank}`,
  someone: 'Transaction',
  more: (n) => `and ${n} more`,
  approvalTitle: (bank) => `${bank} wants an approval`,
  approvalText: 'Log in to Girovo once – then Girovo looks for new transactions there again.',
  loginTitle: (bank) => `Girovo isn’t looking at ${bank} right now`,
  loginText: 'The remembered device no longer opens. Log in to Girovo once.',
  refusedTitle: (bank) => `${bank} refused the PIN`,
  refusedText: (bank) => `The saved PIN has been deleted and Girovo no longer looks at ${bank}. Turn it on again after your next login.`,
  dearerTitle: (name) => `${name} got more expensive`,
  dearerText: (now, was, bank) => `${now} instead of ${was} · ${bank}`,
  dearerTextHidden: (bank) => `More was collected than usual · ${bank}`,
  incomeTitle: (n, bank) => (n === 1 ? `Money came in at ${bank}` : `${n} payments came in at ${bank}`),
  lowTitle: (limit) => `Balance below ${limit}`,
  lowTitleHidden: 'Balance below your limit',
  lowText: (account, bank, balance) => `${account} at ${bank}: ${balance}`,
  lowTextHidden: (account, bank) => `${account} at ${bank}`,
  accountEnding: (tail) => `Account …${tail}`,
  channel: 'New transactions',

  title: 'Report new transactions',
  hint: 'Every six hours Girovo looks at your banks and tells you what’s new.',
  hintPaused: (banks) => `At ${banks}, Girovo waits until you log in once.`,
  askTitle: 'Report new transactions?',
  askText:
    'For this, Girovo logs in to your banks every six hours without you – with the remembered device and your PIN. The PIN is kept encrypted on this device for that, protected by the system but with no finger or face in front of it. If a bank asks for an approval, Girovo waits there until you log in again. If it refuses the PIN, the PIN is deleted at once.',
  askDesktop: 'When you close the window, Girovo keeps running in the notification area. On Windows it starts with the system, invisibly.',
  amounts: 'Show amounts in the notifications',
  turnOn: 'Turn on',
  notNow: 'Not now',
  nowOn: (n) => (n === 1 ? 'Girovo now reports new transactions at this bank.' : `Girovo now reports new transactions at ${n} banks.`),
  nowOff: 'Girovo no longer reports new transactions. The saved PINs have been deleted.',
  noDevice: (banks) => `${banks}: device not remembered – Girovo doesn’t look there.`,
  noneTaken: 'Remember this device at your bank first – otherwise Girovo can’t look there without you.',
  noPermission: 'Notifications are off for Girovo. Allow them in Android’s settings, then turn this on.',
  failed: 'That didn’t work. Please try again.',
  goesToo: 'This also deletes the PINs for “Report new transactions”.',
  stillRunning: 'Girovo keeps running in the notification area and reports new transactions.',
  trayOpen: 'Open Girovo',
  trayCheck: 'Look for new transactions now',
  trayQuit: 'Quit',

  alerts: {
    title: 'What Girovo reports',
    parts: { every: 'new transactions', dearer: 'pricier contracts', income: 'incoming money', low: 'balance' },
    nothing: 'Only when a bank is waiting for you',
    intro: 'Each transaction is reported once, with the notification that fits it best.',
    every: 'Every new transaction',
    dearer: 'Pricier contracts and subscriptions',
    dearerHint: 'When a contract from “Contracts & subscriptions” collects more than usual. Girovo knows the usual price from the transactions you load in the app.',
    income: 'Salary and regular income',
    incomeHint: 'Wages, pension and whatever else comes in regularly.',
    low: 'Balance below …',
    lowHint: 'Girovo tells you once when the balance falls below it, and again once it has been above and then below again. Empty: no notification.',
    lowFor: (account) => `Limit for ${account}`,
    invalid: 'Enter an amount, for example 100.00.',
    saved: 'Saved. This applies from the next check.',
    failed: 'The settings couldn’t be read. Please try again.',
  },

  api: {
    unavailable: 'Reporting new transactions isn’t available here.',
    noSecret: 'The PINs can’t be kept protected here.',
    unknownAction: 'Unknown action.',
  },
};
