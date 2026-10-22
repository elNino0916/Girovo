// The booking categories (lib/categories.ts), as lists, filters and the
// analysis name them.

import type { BuiltinCategoryId } from '../../categories';

export const de: Record<BuiltinCategoryId, string> = {
  income: 'Einkommen',
  otherIn: 'Sonstige Eingänge',
  transfer: 'Umbuchung',
  housing: 'Wohnen & Energie',
  groceries: 'Lebensmittel & Drogerie',
  mobility: 'Mobilität',
  shopping: 'Shopping',
  dining: 'Essen & Trinken',
  leisure: 'Freizeit',
  media: 'Abos & Medien',
  health: 'Gesundheit',
  insurance: 'Versicherungen',
  taxes: 'Steuern & Abgaben',
  cash: 'Bargeld',
  fees: 'Bankentgelte & Zinsen',
  savings: 'Sparen & Anlegen',
  other: 'Sonstiges',
};

export const en: typeof de = {
  income: 'Income',
  otherIn: 'Other income',
  // Money between the user’s own accounts; "Transfer" alone would read as any payment out.
  transfer: 'Internal transfer',
  housing: 'Housing & energy',
  groceries: 'Groceries & toiletries',
  mobility: 'Transport',
  shopping: 'Shopping',
  dining: 'Eating out',
  leisure: 'Leisure',
  media: 'Subscriptions & media',
  health: 'Health',
  insurance: 'Insurance',
  taxes: 'Taxes & charges',
  cash: 'Cash',
  fees: 'Bank fees & interest',
  savings: 'Saving & investing',
  other: 'Other',
};
