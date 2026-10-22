// Every text of the interface, by area, in each language.
//
// One file per area, German and English side by side: a text is added to
// both at once, and English is typed against German, so a key that one
// language lacks — or a placeholder it forgot — fails the type check instead
// of showing up blank. See lib/i18n/README.md for how to write them.

import * as android from './android.ts';
import * as ask from './ask.ts';
import * as auth from './auth.ts';
import * as backup from './backup.ts';
import * as budgets from './budgets.ts';
import * as banks from './banks.ts';
import * as categories from './categories.ts';
import * as common from './common.ts';
import * as depot from './depot.ts';
import * as docs from './docs.ts';
import * as format from './format.ts';
import * as history from './history.ts';
import * as insights from './insights.ts';
import * as orders from './orders.ts';
import * as provider from './provider.ts';
import * as session from './session.ts';
import * as settings from './settings.ts';
import * as shell from './shell.ts';
import * as tax from './tax.ts';
import * as transactions from './transactions.ts';
import * as transfer from './transfer.ts';
import type { Locale } from '../locale.ts';
import { IS_ANDROID } from '../../platform.ts';
import { onPhone } from './phone.ts';

const de = {
  common: common.de,
  format: format.de,
  categories: categories.de,
  session: session.de,
  settings: settings.de,
  auth: auth.de,
  transfer: transfer.de,
  orders: orders.de,
  transactions: transactions.de,
  insights: insights.de,
  budgets: budgets.de,
  shell: shell.de,
  provider: provider.de,
  banks: banks.de,
  history: history.de,
  android: android.de,
  depot: depot.de,
  docs: docs.de,
  tax: tax.de,
  backup: backup.de,
  ask: ask.de,
};

export type Messages = typeof de;

const en: Messages = {
  common: common.en,
  format: format.en,
  categories: categories.en,
  session: session.en,
  settings: settings.en,
  auth: auth.en,
  transfer: transfer.en,
  orders: orders.en,
  transactions: transactions.en,
  insights: insights.en,
  budgets: budgets.en,
  shell: shell.en,
  provider: provider.en,
  banks: banks.en,
  history: history.en,
  android: android.en,
  depot: depot.en,
  docs: docs.en,
  tax: tax.en,
  backup: backup.en,
  ask: ask.en,
};

// The Android app says "Telefon" where the desktop says "Rechner" (phone.ts).
export const MESSAGES: Record<Locale, Messages> = IS_ANDROID
  ? { de: onPhone(de, 'de'), en: onPhone(en, 'en') }
  : { de, en };
