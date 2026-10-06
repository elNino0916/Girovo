// Every text of the interface, by area, in each language.
//
// One file per area, German and English side by side: a text is added to
// both at once, and English is typed against German, so a key that one
// language lacks — or a placeholder it forgot — fails the type check instead
// of showing up blank. See lib/i18n/README.md for how to write them.

import * as auth from './auth.ts';
import * as categories from './categories.ts';
import * as common from './common.ts';
import * as format from './format.ts';
import * as insights from './insights.ts';
import * as provider from './provider.ts';
import * as session from './session.ts';
import * as shell from './shell.ts';
import * as transactions from './transactions.ts';
import * as transfer from './transfer.ts';
import type { Locale } from '../locale.ts';

const de = {
  common: common.de,
  format: format.de,
  categories: categories.de,
  session: session.de,
  auth: auth.de,
  transfer: transfer.de,
  transactions: transactions.de,
  insights: insights.de,
  shell: shell.de,
  provider: provider.de,
};

export type Messages = typeof de;

const en: Messages = {
  common: common.en,
  format: format.en,
  categories: categories.en,
  session: session.en,
  auth: auth.en,
  transfer: transfer.en,
  transactions: transactions.en,
  insights: insights.en,
  shell: shell.en,
  provider: provider.en,
};

export const MESSAGES: Record<Locale, Messages> = { de, en };
