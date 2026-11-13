// Girovo Next, "Fragen": what a message wants besides a sum of bookings
// (components/insights/AskThread.tsx). Asked before the bookings are read:
//
// - contracts   "Welche Abos habe ich?": Verträge & Abos, listed
// - read        "Ist der dunkle Modus an?", "Welche Einstellungen habe ich?": the settings as they are
// - set         "Mach das helle Design an", "Beträge ausblenden", "Stell auf Englisch": a change, asked first
// - refresh     "Aktualisiere alle Konten": every balance read again, asked first (it can cost a Freigabe)
// - balance, balanceAt, monthEnd, contractCost, priceRises, salary, owed, goal: the app's own figures (lib/ask-facts.ts)
// - fileUnder, createGoal, budget, remindContract, prepareTransfer: things done for you, asked first (lib/ask-actions.ts)
//
// Rules only: the words are few and plain, and a change is never made on a
// model's guess. Every change waits for the user's "Ja" in the thread.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { actionOf, type ActionIntent, type OwnCategory } from './ask-actions.ts';
import { factOf, type FactIntent } from './ask-facts.ts';

export type { ActionIntent } from './ask-actions.ts';
export type { FactIntent } from './ask-facts.ts';

export type ThemeValue = 'light' | 'dark' | 'system';

export type AskIntent =
  | { kind: 'contracts' }
  | { kind: 'read'; setting: 'theme' | 'privacy' | 'language' | 'idle' | 'all' }
  | { kind: 'set'; setting: 'theme'; value: ThemeValue }
  | { kind: 'set'; setting: 'privacy'; value: boolean }
  | { kind: 'set'; setting: 'language'; value: 'de' | 'en' }
  | { kind: 'refresh' }
  | FactIntent
  | ActionIntent;

const fold = (s: string) => ` ${s.toLocaleLowerCase('de').replace(/[?!.,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

// i18n-data-start — the words people use, German and English
const CONTRACTS = / (?:abos?|abonnements?|vertr(?:ä|ae)ge?|daueraufträge|subscriptions?|contracts?|fixkosten|fixed costs|regelm(?:ä|ae)(?:ß|ss)ige zahlungen|recurring payments) /;
const QUESTION_WORD = / (?:welche[nmrs]?|was|wie viele?|liste|zeig|zeige|nenn|which|what|how many|list|show) /;
const SETTINGS = / (?:einstellungen|settings) /;
const ASK_STATE = /^ (?:ist|sind|is|are|was ist|welche[nmrs]?|wie (?:ist|lange)|what is|which) /;
const LIGHT = / (?:hell(?:e[nmrs]?)?|wei(?:ß|ss)(?:e[nmrs]?)?|white|light|tag) (?:modus|mode|design|thema|theme|darstellung|ansicht) | (?:light|white) mode | (?:hellmodus|tagmodus|lightmode) | (?:design|darstellung|theme|ansicht) (?:\S+ ){0,2}(?:hell|heller|wei(?:ß|ss)|light|white) /;
/** "auf hell", "auf dunkel": a theme only with a verb for changing or a word for the look ("auf Schwarz gesetzt" is a bet). */
const ON_LIGHT = / auf (?:hell|light|wei(?:ß|ss)) /;
const ON_DARK = / auf (?:dunkel|dark|schwarz) /;
const DARK = / (?:dunkel|dunkle[nmrs]?|schwarz(?:e[nmrs]?)?|dark|nacht|night) (?:modus|mode|design|thema|theme|darstellung|ansicht) | dark ?mode | (?:dunkelmodus|nachtmodus) | (?:design|darstellung|theme|ansicht) (?:\S+ ){0,2}(?:dunkel|dunkler|schwarz|dark|black) /;
const SYSTEM_THEME = / (?:design|darstellung|theme|modus|mode) (?:wie (?:das|beim) system|automatisch|nach (?:dem )?system|system) | (?:wie das system|automatic theme) /;
const THEME_WORD = / (?:design|darstellung|theme|modus|mode|thema|dunkelmodus|darkmode) /;
const DO = / (?:mach|mache|schalt|schalte|stell|stelle|aktivier|aktiviere|wechsel|wechsle|änder|ändere|aender|setz|setze|umstellen|umschalten|stell\w* (?:\S+ ){0,3}um|enable|turn|switch|set|use|change|activate|ein|an|on|bitte|please) /;
const PRIVACY = / (?:betr(?:ä|ae|a)ge|summen|zahlen|amounts|balances) /;
const HIDE = / (?:ausblenden|verstecken|verbergen|verdecken|hide|blende\w*) /;
const SHOW = / (?:einblenden|zeig|zeige|zeigen|anzeigen|sichtbar|show|unhide) /;
const PRIVACY_STATE = / (?:ausgeblendet|versteckt|hidden|sichtbar|visible) /;
const LANGUAGE = / (?:sprache|language) /;
const ENGLISH = / (?:englisch|english|auf englisch|in english) /;
const GERMAN = / (?:deutsch|german|auf deutsch|in german) /;
const REFRESH = / (?:aktualisier\w*|abrufen|ruf\w* (?:\w+ ){0,3}ab|neu laden|lade? (?:\w+ ){0,3}neu|refresh\w*|reload\w*|update\w*|sync\w*) /;
const ACCOUNTS = / (?:konten|konto|salden|saldo|kontost(?:ä|ae)nde?|kontostand|accounts?|balances?|alles|alle|everything) /;
/** "Umsätze neu laden": the bookings fetched again, said with the verb first or last ("seit dem letzten Update" is none). */
const BOOKINGS = / (?:ums(?:ä|ae)tze|buchungen|transactions) /;
const REFRESH_VERB = /^ (?:bitte |kannst du |please )?(?:aktualisier\w*|lade?|ruf\w*|refresh\w*|reload\w*) | (?:neu laden|aktualisieren|abrufen|refresh|reload)(?: bitte| please)? $/;
const IDLE = / (?:abmelden|abmeldung|automatisch abgemeldet|logout|log out|timeout|abgemeldet) /;
// i18n-data-end

/**
 * What a message wants, when it is not (only) a question about the bookings' sums; null for those.
 * `contracts`: the live contracts' names (lib/ask-facts.ts factOf); `today` for a past balance's day;
 * `own`: the user's own categories, for a payee filed or a budget set under one of them.
 */
export function intentOf(question: string, contracts: readonly string[] = [], today?: string, own: readonly OwnCategory[] = []): AskIntent | null {
  const q = fold(question);
  // Something to do, before anything is read as a question: a category rule, a Sparziel, a budget, a reminder, a transfer.
  const action = actionOf(question, own, today);
  if (action) return action;
  const asking = ASK_STATE.test(q) || / (?:an|aus|on|off) $/.test(q) && /^ (?:ist|is|sind|are) /.test(q);

  if (REFRESH.test(q) && ACCOUNTS.test(q)) return { kind: 'refresh' };
  if (BOOKINGS.test(q) && REFRESH_VERB.test(q)) return { kind: 'refresh' };
  // Balances, the forecast, Verträge & Abos' figures, the salary, Aufteilen, Sparziele.
  const fact = factOf(question, contracts, today);
  if (fact) return fact;
  if (CONTRACTS.test(q) && (QUESTION_WORD.test(q) || / (?:habe|hab|have|zahle|pay) /.test(q))) return { kind: 'contracts' };

  // Reading a setting: "Ist der dunkle Modus an?", "Welche Sprache ist eingestellt?", "Welche Einstellungen habe ich?"
  if (asking || SETTINGS.test(q)) {
    if (SETTINGS.test(q) && !THEME_WORD.test(q) && !LANGUAGE.test(q) && !PRIVACY.test(q)) return { kind: 'read', setting: 'all' };
    if (asking && (THEME_WORD.test(q) || LIGHT.test(q) || DARK.test(q))) return { kind: 'read', setting: 'theme' };
    if (asking && PRIVACY.test(q) && (PRIVACY_STATE.test(q) || HIDE.test(q) || SHOW.test(q))) return { kind: 'read', setting: 'privacy' };
    if (asking && LANGUAGE.test(q)) return { kind: 'read', setting: 'language' };
    if (asking && IDLE.test(q)) return { kind: 'read', setting: 'idle' };
  }

  // Changing one: a wish, not a question about it.
  const changing = DO.test(q) || THEME_WORD.test(q);
  if ((LIGHT.test(q) || ON_LIGHT.test(q) && changing) && !asking) return { kind: 'set', setting: 'theme', value: 'light' };
  if ((DARK.test(q) || ON_DARK.test(q) && changing) && !asking) return { kind: 'set', setting: 'theme', value: 'dark' };
  if (SYSTEM_THEME.test(q) && !asking) return { kind: 'set', setting: 'theme', value: 'system' };
  if (PRIVACY.test(q) && HIDE.test(q) && !asking) return { kind: 'set', setting: 'privacy', value: true };
  if (PRIVACY.test(q) && SHOW.test(q) && !asking && (DO.test(q) || / (?:wieder|again) /.test(q) && !/ (?:von|vom|bei|beim|für|fuer|an|from|at|for) /.test(q))) return { kind: 'set', setting: 'privacy', value: false };
  if ((LANGUAGE.test(q) || DO.test(q)) && ENGLISH.test(q) && !asking) return { kind: 'set', setting: 'language', value: 'en' };
  if ((LANGUAGE.test(q) || DO.test(q)) && GERMAN.test(q) && !asking) return { kind: 'set', setting: 'language', value: 'de' };
  return null;
}
