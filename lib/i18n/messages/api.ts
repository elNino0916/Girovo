// Girovo API (Girovo Next, desktop; docs/girovo-api.md): the dialog an app's
// request opens (components/api/ApiConsent.tsx) and Einstellungen → Girovo API
// (components/api/ApiSettings.tsx).

import type { ApiErrorCode, ApiPermission } from '../../api/types';

const permissionsDe: Record<ApiPermission, string> = {
  'accounts.read': 'Konten und Salden lesen',
  'transactions.read': 'Umsätze lesen',
  'insights.read': 'Analyse, Verträge, Budgets und Sparziele lesen',
  ask: 'Girovo AI fragen',
  'categories.write': 'Kategorien ändern',
  'notes.write': 'Notizen schreiben',
  'budgets.write': 'Budgets und Sparziele ändern',
  'settings.read': 'Einstellungen lesen',
  'settings.write': 'Einstellungen ändern',
  'bank.refresh': 'Neue Umsätze von der Bank holen',
  'transfers.request': 'Überweisungen vorschlagen',
};

const permissionsEn: Record<ApiPermission, string> = {
  'accounts.read': 'Read accounts and balances',
  'transactions.read': 'Read transactions',
  'insights.read': 'Read analysis, contracts, budgets and savings goals',
  ask: 'Ask Girovo AI',
  'categories.write': 'Change categories',
  'notes.write': 'Write notes',
  'budgets.write': 'Change budgets and savings goals',
  'settings.read': 'Read settings',
  'settings.write': 'Change settings',
  'bank.refresh': 'Get new transactions from the bank',
  'transfers.request': 'Suggest transfers',
};

export const de = {
  permissions: permissionsDe,
  /** One line under a permission that needs more than its name. */
  permissionHints: {
    'bank.refresh': 'Braucht die Bank eine Freigabe, fragt dich Girovo.',
    'transfers.request': 'Du prüfst und sendest jede Überweisung selbst in Girovo.',
  } as Partial<Record<ApiPermission, string>>,

  /** The dialog, like Windows' UAC. */
  consent: {
    title: 'Darf diese App auf Girovo zugreifen?',
    titleMore: 'Darf diese App mehr tun?',
    publisher: (name: string) => `Herausgeber: ${name}`,
    publisherUnknown: 'Herausgeber: unbekannt',
    verified: 'Bestätigter Herausgeber',
    viaMcp: 'über Girovo MCP',
    /** The name the app gave itself, where it is not the one Girovo found. */
    saysItIs: (name: string) => `Nennt sich „${name}“`,
    unknownWarning: 'Girovo kann nicht prüfen, von wem diese App stammt. Lass sie nur zu, wenn du ihr vertraust.',
    reasonLabel: 'Die App schreibt',
    asks: 'Sie möchte',
    asksMore: 'Sie möchte zusätzlich',
    allow: 'Zulassen',
    refuse: 'Ablehnen',
    /** The app's icon, for a screen reader. */
    icon: (name: string) => `Symbol von ${name}`,
  },

  /** Einstellungen → Girovo API. */
  page: {
    use: 'Girovo API zulassen',
    hint: 'Apps auf diesem Rechner können deine Konten lesen, wenn du es erlaubst.',
    local: 'Webseiten und andere Geräte erreichen Girovo darüber nicht.',
    apps: 'Apps',
    noApps: 'Noch keine App zugelassen.',
    revoke: 'Zugriff entziehen',
    lastUsed: (when: string) => `zuletzt ${when}`,
    neverUsed: 'noch nicht verwendet',
    unknownPublisher: 'Herausgeber unbekannt',
    log: 'Verlauf',
    noLog: 'Noch keine Anfragen.',
    developers: 'Für Entwickler',
    docs: 'Dokumentation',
    docsLater: 'Kommt bald auf girovo.de.',
    /** What a call did, in the Verlauf. */
    methods: {
      hello: 'Hat sich angemeldet',
      'accounts.list': 'Konten gelesen',
      'transactions.list': 'Umsätze gelesen',
      'contracts.list': 'Verträge gelesen',
      'budgets.list': 'Budgets gelesen',
      'goals.list': 'Sparziele gelesen',
      'insights.month': 'Analyse gelesen',
    } as Record<string, string>,
    /** Why a call was not answered. */
    outcomes: {
      locked: 'Girovo war gesperrt',
      denied: 'Abgelehnt',
      not_permitted: 'Nicht erlaubt',
      invalid: 'Ungültig',
      refused_by_user: 'Von dir abgelehnt',
      bank_error: 'Fehler der Bank',
      method_not_found: 'Unbekannt',
      internal: 'Fehler in Girovo',
      timeout: 'Keine Antwort von dir',
    } satisfies Record<ApiErrorCode, string>,
  },

  /** Einstellungen' list. */
  summaryOff: 'Aus',
  summaryOn: (apps: number) => (apps ? `An · ${apps === 1 ? 'eine App' : `${apps} Apps`}` : 'An'),
};

export const en: typeof de = {
  permissions: permissionsEn,
  permissionHints: {
    'bank.refresh': 'If the bank needs an approval, Girovo asks you.',
    'transfers.request': 'You check and send every transfer yourself in Girovo.',
  },

  consent: {
    title: 'Allow this app to access Girovo?',
    titleMore: 'Allow this app to do more?',
    publisher: (name: string) => `Publisher: ${name}`,
    publisherUnknown: 'Publisher: unknown',
    verified: 'Verified publisher',
    viaMcp: 'through Girovo MCP',
    saysItIs: (name: string) => `Calls itself “${name}”`,
    unknownWarning: 'Girovo cannot check who made this app. Only allow it if you trust it.',
    reasonLabel: 'The app says',
    asks: 'It would like to',
    asksMore: 'It would also like to',
    allow: 'Allow',
    refuse: 'Refuse',
    icon: (name: string) => `Icon of ${name}`,
  },

  page: {
    use: 'Allow Girovo API',
    hint: 'Apps on this computer can read your accounts if you allow it.',
    local: "Websites and other devices can't reach Girovo this way.",
    apps: 'Apps',
    noApps: 'No app allowed yet.',
    revoke: 'Remove access',
    lastUsed: (when: string) => `last used ${when}`,
    neverUsed: 'not used yet',
    unknownPublisher: 'Unknown publisher',
    log: 'History',
    noLog: 'No requests yet.',
    developers: 'For developers',
    docs: 'Documentation',
    docsLater: 'Coming soon on girovo.de.',
    methods: {
      hello: 'Signed in',
      'accounts.list': 'Read accounts',
      'transactions.list': 'Read transactions',
      'contracts.list': 'Read contracts',
      'budgets.list': 'Read budgets',
      'goals.list': 'Read savings goals',
      'insights.month': 'Read analysis',
    },
    outcomes: {
      locked: 'Girovo was locked',
      denied: 'Refused',
      not_permitted: 'Not allowed',
      invalid: 'Invalid',
      refused_by_user: 'Refused by you',
      bank_error: 'Bank error',
      method_not_found: 'Unknown',
      internal: 'Error in Girovo',
      timeout: 'You did not answer',
    },
  },

  summaryOff: 'Off',
  summaryOn: (apps: number) => (apps ? `On · ${apps === 1 ? 'one app' : `${apps} apps`}` : 'On'),
};
