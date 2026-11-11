// Girovo Next, "Fragen": what a message wants besides a sum of bookings
// (components/insights/AskThread.tsx). Asked before the bookings are read:
//
// - contracts   "Welche Abos habe ich?": Verträge & Abos, listed
// - read        "Ist der dunkle Modus an?", "Welche Einstellungen habe ich?": the settings as they are
// - set         "Mach das helle Design an", "Beträge ausblenden", "Stell auf Englisch": a change, asked first
// - refresh     "Aktualisiere alle Konten": every balance read again, asked first (it can cost a Freigabe)
//
// Rules only: the words are few and plain, and a change is never made on a
// model's guess. Every change waits for the user's "Ja" in the thread.
//
// Pure: no path aliases, `.ts` on sibling imports.

export type ThemeValue = 'light' | 'dark' | 'system';

export type AskIntent =
  | { kind: 'contracts' }
  | { kind: 'read'; setting: 'theme' | 'privacy' | 'language' | 'idle' | 'all' }
  | { kind: 'set'; setting: 'theme'; value: ThemeValue }
  | { kind: 'set'; setting: 'privacy'; value: boolean }
  | { kind: 'set'; setting: 'language'; value: 'de' | 'en' }
  | { kind: 'refresh' };

const fold = (s: string) => ` ${s.toLocaleLowerCase('de').replace(/[?!.,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

// i18n-data-start — the words people use, German and English
const CONTRACTS = / (?:abos?|abonnements?|vertr(?:ä|ae)ge?|daueraufträge|subscriptions?|contracts?|fixkosten|fixed costs|regelm(?:ä|ae)(?:ß|ss)ige zahlungen|recurring payments) /;
const QUESTION_WORD = / (?:welche[nmrs]?|was|wie viele?|liste|zeig|zeige|nenn|which|what|how many|list|show) /;
const SETTINGS = / (?:einstellungen|settings) /;
const ASK_STATE = /^ (?:ist|sind|is|are|was ist|welche[nmrs]?|wie (?:ist|lange)|what is|which) /;
const LIGHT = / (?:hell(?:e[nmrs]?)?|wei(?:ß|ss)(?:e[nmrs]?)?|white|light|tag) (?:modus|mode|design|thema|theme|darstellung|ansicht) | (?:light|white) mode /;
const DARK = / (?:dunkel|dunkle[nmrs]?|schwarz(?:e[nmrs]?)?|dark|nacht|night) (?:modus|mode|design|thema|theme|darstellung|ansicht) | dark ?mode /;
const SYSTEM_THEME = / (?:design|darstellung|theme|modus|mode) (?:wie (?:das|beim) system|automatisch|nach (?:dem )?system|system) | (?:wie das system|automatic theme) /;
const THEME_WORD = / (?:design|darstellung|theme|modus|mode|thema|dunkelmodus|darkmode) /;
const DO = / (?:mach|mache|schalt|schalte|stell|stelle|aktivier|aktiviere|wechsel|wechsle|änder|ändere|aender|setz|setze|enable|turn|switch|set|use|change|activate|ein|an|on|bitte|please) /;
const PRIVACY = / (?:betr(?:ä|ae)ge|summen|zahlen|amounts|balances) /;
const HIDE = / (?:ausblenden|verstecken|verbergen|verdecken|hide|blenden) /;
const SHOW = / (?:einblenden|zeig|zeige|zeigen|anzeigen|sichtbar|show|unhide) /;
const PRIVACY_STATE = / (?:ausgeblendet|versteckt|hidden|sichtbar|visible) /;
const LANGUAGE = / (?:sprache|language) /;
const ENGLISH = / (?:englisch|english|auf englisch|in english) /;
const GERMAN = / (?:deutsch|german|auf deutsch|in german) /;
const REFRESH = / (?:aktualisier\w*|abrufen|ruf\w* (?:\w+ ){0,3}ab|neu laden|lade? (?:\w+ ){0,3}neu|refresh\w*|reload\w*|update\w*|sync\w*) /;
const ACCOUNTS = / (?:konten|konto|salden|saldo|kontost(?:ä|ae)nde|accounts?|balances?|alles|alle|everything) /;
const IDLE = / (?:abmelden|abmeldung|automatisch abgemeldet|logout|log out|timeout|abgemeldet) /;
// i18n-data-end

/** What a message wants, when it is not (only) a question about the bookings' sums; null for those. */
export function intentOf(question: string): AskIntent | null {
  const q = fold(question);
  const asking = ASK_STATE.test(q) || / (?:an|aus|on|off) $/.test(q) && /^ (?:ist|is|sind|are) /.test(q);

  if (REFRESH.test(q) && ACCOUNTS.test(q)) return { kind: 'refresh' };
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
  if (LIGHT.test(q) && !asking) return { kind: 'set', setting: 'theme', value: 'light' };
  if (DARK.test(q) && !asking) return { kind: 'set', setting: 'theme', value: 'dark' };
  if (SYSTEM_THEME.test(q) && !asking) return { kind: 'set', setting: 'theme', value: 'system' };
  if (PRIVACY.test(q) && HIDE.test(q) && !asking) return { kind: 'set', setting: 'privacy', value: true };
  if (PRIVACY.test(q) && SHOW.test(q) && !asking && DO.test(q)) return { kind: 'set', setting: 'privacy', value: false };
  if ((LANGUAGE.test(q) || DO.test(q)) && ENGLISH.test(q) && !asking) return { kind: 'set', setting: 'language', value: 'en' };
  if ((LANGUAGE.test(q) || DO.test(q)) && GERMAN.test(q) && !asking) return { kind: 'set', setting: 'language', value: 'de' };
  return null;
}
