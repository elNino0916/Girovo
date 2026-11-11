// Girovo AI, formerly "Frag deine Umsätze" (Android, Gemini Nano — components/insights/Ask.tsx; the desktop with its own model, `desktop`):
// a question about the loaded bookings, turned into a search by Gemini Nano
// and answered by Girovo on the phone (lib/nano-ask.ts).

import type { ReactNode } from 'react';

export const de = {
  title: 'Girovo AI',
  placeholder: 'Wie viel ging an Amazon?',
  ask: 'Fragen',
  /** Questions to start from, tapped to ask. */
  suggestions: ['Lebensmittel letzten Monat', 'Größte Ausgabe dieses Jahr', 'Essen gehen pro Monat'],
  reading: 'Gemini Nano liest die Frage …',
  failed: 'Gemini Nano hat gerade nicht geantwortet. Versuch es gleich noch einmal.',
  notUnderstood: 'Das hat Gemini Nano nicht verstanden. Frag etwa „Tanken im August“.',
  /** What the question was read as, before the answer. */
  understood: 'Gesucht',
  dir: { out: 'Ausgaben', in: 'Eingänge', all: 'Ausgaben und Eingänge' },
  period: {
    all: 'alle geladenen Umsätze',
    today: 'heute',
    days: (n: number) => `letzte ${n} Tage`,
    months: (n: number) => `letzte ${n} Monate`,
    since: (month: string) => `seit ${month}`,
  },
  /** In "Gesucht": what a ranking ranks, and what a comparison is set against. */
  rankBy: { category: 'nach Kategorie', payee: 'nach Empfänger' },
  versus: (period: string) => `gegenüber ${period}`,
  /** Above a ranking's rows. */
  rankTitle: {
    category: {
      sum: { out: 'Am meisten ausgegeben für', in: 'Am meisten bekommen als' },
      count: { out: 'Am häufigsten bezahlt für', in: 'Am häufigsten bekommen als' },
    },
    payee: {
      sum: { out: 'Am meisten ausgegeben bei', in: 'Am meisten bekommen von' },
      count: { out: 'Am häufigsten bezahlt an', in: 'Am häufigsten bekommen von' },
    },
  },
  /** A comparison's difference, after the amount. */
  more: 'mehr',
  less: 'weniger',
  same: 'Genau gleich viel',
  compareMissing: 'Für einen der Zeiträume sind keine Umsätze geladen.',
  /** On a phone without Gemini Nano v4: the tile says why, and where an update may help. */
  unsupported: {
    tag: 'Nicht unterstützt',
    tooOld: (model: string, min: number) => `Dafür braucht es Gemini Nano v${min}. Dieses Telefon hat ${model}.`,
    unnamed: (min: number) => `Dafür braucht es Gemini Nano v${min}. Welche Version dieses Telefon hat, ist unklar.`,
    loading: 'Android lädt Gemini Nano noch. Danach kannst du hier fragen.',
    systemUpdate: 'Gemini Nano braucht ein Systemupdate. Installiere die neuesten Updates.',
    aicore: 'Gemini Nano braucht ein Update von AICore.',
    none: 'Dieses Telefon bietet Gemini Nano nicht an.',
    hint: 'Oft hilft es, AICore und Private Compute Services im Play Store zu aktualisieren.',
    update: 'AICore aktualisieren',
  },
  /** The figure's name. */
  spent: 'Ausgegeben',
  received: 'Bekommen',
  times: (n: number) => (n === 1 ? '1-mal' : `${n}-mal`),
  together: (amount: ReactNode): ReactNode[] => ['zusammen ', amount],
  bookings: (n: number) => (n === 1 ? '1 Umsatz' : `${n} Umsätze`),
  largestOut: 'Größte Ausgabe',
  largestIn: 'Größter Eingang',
  last: (day: string) => `Zuletzt am ${day}`,
  /** Before an estimate in whole euros. */
  approx: 'ca.',
  perMonth: 'pro Monat',
  averageBasis: (n: number) => (n === 1 ? 'aus 1 vollen Monat' : `aus ${n} vollen Monaten`),
  noWholeMonth: 'Noch kein voller Monat geladen. Das ist die Summe.',
  none: 'Keine passenden Umsätze',
  noneHint: (range: string) => `Keiner der geladenen Umsätze (${range}) passt.`,
  outside: 'Für diesen Zeitraum sind keine Umsätze geladen.',
  partial: (day: string) => `Erst ab ${day} geladen. Es kann mehr gewesen sein.`,
  atLeast: 'mind.',
  show: 'Umsätze zeigen',
  /** The desktop reads the question with the app's own category model, not Gemini Nano. */
  desktop: {
    reading: 'Girovo liest die Frage …',
    notUnderstood: 'Das hat Girovo nicht verstanden. Frag etwa „Tanken im August“.',
  },
  /**
   * Girovo Next, "Fragen" (components/insights/AskThread.tsx): the conversation.
   * Until the on-device writer lands, Girovo says each answer with these
   * sentences; every figure in them is the app's own and opens its bookings.
   */
  thread: {
    title: 'Girovo AI',
    conversations: 'Gespräche',
    newConversation: 'Neues Gespräch',
    noConversations: 'Noch keine Gespräche.',
    placeholder: 'Frag etwas zu deinen Umsätzen',
    followUp: 'Weiter fragen',
    send: 'Fragen',
    empty: 'Frag etwas zu deinen Umsätzen. Girovo antwortet in ganzen Sätzen.',
    you: 'Du:',
    girovo: 'Girovo:',
    show: (n: number) => (n === 1 ? 'Umsatz zeigen' : `${n} Umsätze zeigen`),
    copy: 'Antwort kopieren',
    copied: 'Antwort kopiert',
    notLoaded: 'Die Umsätze werden noch geladen.',
    /** While Girovo works on an answer: what it is doing, so it never looks stuck. */
    thinking: {
      starting: 'Gemma startet',
      reading: 'Liest deine Frage',
      writing: 'Schreibt die Antwort',
      seconds: (n: number) => `${n} s`,
    },
    deleteConversation: 'Gespräch löschen',
    deleteAll: 'Alle Gespräche löschen',
    /** Small talk, or anything that is not about the bookings. */
    offTopic: 'Dazu kann Girovo nichts sagen. Frag etwas zu deinen Umsätzen, etwa „Was ging im Oktober an Rewe?“',
    /** The chips over the field: the next questions. */
    next: {
      /** Asked as it reads: the month by its name, so the question is read the same way a typed one is. */
      monthBefore: (month: string) => `Und im ${month}?`,
      perMonth: 'Pro Monat',
      largest: 'Größte Ausgabe',
    },
    say: {
      /** How a sentence opens on the period a question named (null: every loaded booking, no opening). */
      when: {
        month: (month: string) => `Im ${month}`,
        year: (year: string) => `Im Jahr ${year}`,
        days: (n: number) => `In den letzten ${n} Tagen`,
        months: (n: number) => `In den letzten ${n} Monaten`,
        since: (month: string) => `Seit ${month}`,
        today: 'Heute',
        range: (range: string) => `Im Zeitraum ${range}`,
      },
      outCategory: (when: string | null, topic: ReactNode, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du für ', topic, ' ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Für ', topic, ' hast du ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      outName: (when: string | null, topic: ReactNode, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du bei ', topic, ' ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Bei ', topic, ' hast du ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      out: (when: string | null, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Du hast ', amount, ' ausgegeben, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      inCategory: (when: string | null, topic: ReactNode, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du als ', topic, ' ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Als ', topic, ' hast du ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      inName: (when: string | null, topic: ReactNode, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du von ', topic, ' ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Von ', topic, ' hast du ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      in: (when: string | null, amount: ReactNode, count: ReactNode, n: number): ReactNode[] => (when
        ? [when, ' hast du ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']
        : ['Du hast ', amount, ' bekommen, bei ', count, n === 1 ? ' Umsatz.' : ' Umsätzen.']),
      both: (when: string | null, out: ReactNode, inn: ReactNode): ReactNode[] => (when
        ? [when, ' hast du ', out, ' ausgegeben und ', inn, ' bekommen.']
        : ['Ausgegeben hast du ', out, ', bekommen ', inn, '.']),
      count: (when: string | null, count: ReactNode, amount: ReactNode, topic: ReactNode | null): ReactNode[] => (when
        ? (topic ? [when, ' waren es bei ', topic, ' ', count, ', zusammen ', amount, '.'] : [when, ' waren es ', count, ', zusammen ', amount, '.'])
        : (topic ? ['Bei ', topic, ' waren es ', count, ', zusammen ', amount, '.'] : ['Es waren ', count, ', zusammen ', amount, '.'])),
      average: (amount: ReactNode, basis: string): ReactNode[] => ['Im Schnitt sind es etwa ', amount, ' im Monat, ', basis, '.'],
      largestOut: (name: string, amount: ReactNode, day: string): ReactNode[] => ['Die größte Ausgabe war ', name, ' mit ', amount, ' am ', day, '.'],
      largestIn: (name: string, amount: ReactNode, day: string): ReactNode[] => ['Der größte Eingang war ', name, ' mit ', amount, ' am ', day, '.'],
      last: (name: string, amount: ReactNode, day: string): ReactNode[] => ['Zuletzt am ', day, ': ', name, ' mit ', amount, '.'],
      compare: (a: string, aAmount: ReactNode, b: string, bAmount: ReactNode): ReactNode[] => [a, ': ', aAmount, '. ', b, ': ', bAmount, '.'],
      diff: (amount: ReactNode, more: boolean): ReactNode[] => ['Das sind ', amount, more ? ' mehr.' : ' weniger.'],
      same: 'Genau gleich viel.',
      rank: (title: string, name: string, amount: ReactNode): ReactNode[] => [title, ' ', name, ': ', amount, '.'],
    },
    /** Once, when the thread first opens. */
    intro: {
      title: 'Girovo AI',
      sentences: 'Du bekommst die Antwort in ganzen Sätzen.',
      figures: 'Jeden Betrag rechnet Girovo selbst aus deinen Umsätzen.',
      later: 'Später',
      go: 'Ausprobieren',
    },
  },
  /** Girovo Next: the month recap at the head of the Analyse (components/insights/MonthRecap.tsx). */
  recap: {
    title: (month: string) => `Dein ${month}`,
    /** When the Analyse below counts fewer accounts than the recap. */
    titleAll: (month: string) => `Dein ${month}, alle Konten`,
    spent: (amount: ReactNode, diff: ReactNode | null, more: boolean): ReactNode[] => (diff
      ? ['Du hast ', amount, ' ausgegeben, ', diff, more ? ' mehr als im Monat davor.' : ' weniger als im Monat davor.']
      : ['Du hast ', amount, ' ausgegeben.']),
    top: (name: string, amount: ReactNode): ReactNode[] => ['Am meisten ging an ', name, ': ', amount, '.'],
    more: 'Weiter fragen',
    show: (name: string) => `${name} zeigen`,
    hide: 'Rückblick ausblenden',
    /** The conversation "Weiter fragen" starts, as the sidebar names it. */
    conversation: (month: string) => `Rückblick ${month}`,
  },
  /**
   * Girovo Next: what Fragen does besides sums (lib/ask-intents.ts): Verträge &
   * Abos, the settings as they are, and changes, each asked first.
   */
  actions: {
    contracts: (n: number, monthly: ReactNode): ReactNode[] => (n === 1
      ? ['Du hast einen Vertrag oder ein Abo, ', monthly, ' im Monat.']
      : ['Du hast ', String(n), ' Verträge und Abos, zusammen ', monthly, ' im Monat.']),
    noContracts: 'Girovo hat in deinen Umsätzen noch keine Verträge oder Abos gefunden.',
    openContracts: 'Verträge & Abos öffnen',
    theme: { light: 'Hell', dark: 'Dunkel', system: 'Wie das System' },
    readTheme: (value: string) => `Darstellung: ${value}.`,
    readPrivacy: (hidden: boolean): string => (hidden ? 'Beträge sind ausgeblendet.' : 'Beträge sind sichtbar.'),
    readLanguage: (name: string) => `Sprache: ${name}.`,
    readIdle: (minutes: number) => `Girovo meldet dich nach ${minutes} Minuten ohne Eingabe ab.`,
    askTheme: { light: 'Soll Girovo das helle Design einschalten?', dark: 'Soll Girovo das dunkle Design einschalten?', system: 'Soll Girovo die Darstellung dem System überlassen?' },
    askPrivacy: (hide: boolean): string => (hide ? 'Soll Girovo alle Beträge ausblenden?' : 'Soll Girovo die Beträge wieder zeigen?'),
    askLanguage: (name: string) => `Soll Girovo auf ${name} umstellen?`,
    askRefresh: 'Soll Girovo alle Konten aktualisieren?',
    refreshNote: 'Kann eine Freigabe erfordern.',
    yes: 'Ja, bitte',
    no: 'Abbrechen',
    done: 'Erledigt.',
    /** What a change made, said after the yes. */
    doneTheme: { light: 'Erledigt, das helle Design ist an.', dark: 'Erledigt, das dunkle Design ist an.', system: 'Erledigt, die Darstellung folgt jetzt dem System.' },
    donePrivacy: (hidden: boolean): string => (hidden ? 'Erledigt, die Beträge sind ausgeblendet.' : 'Erledigt, die Beträge sind wieder sichtbar.'),
    doneLanguage: 'Erledigt, Girovo ist jetzt auf Deutsch.',
    refreshing: 'Girovo ruft alle Konten ab.',
    cancelled: 'Abgebrochen, nichts geändert.',
    already: 'Das ist schon so eingestellt.',
  },
};

export const en: typeof de = {
  title: 'Girovo AI',
  placeholder: 'How much went to Amazon?',
  ask: 'Ask',
  suggestions: ['Groceries last month', 'Largest expense this year', 'Eating out per month'],
  reading: 'Gemini Nano is reading the question …',
  failed: "Gemini Nano didn't answer just now. Try again in a moment.",
  notUnderstood: 'Gemini Nano didn’t understand that. Try something like “fuel in August”.',
  understood: 'Searched for',
  dir: { out: 'Spending', in: 'Income', all: 'Spending and income' },
  period: {
    all: 'all loaded transactions',
    today: 'today',
    days: (n) => `last ${n} days`,
    months: (n) => `last ${n} months`,
    since: (month) => `since ${month}`,
  },
  rankBy: { category: 'by category', payee: 'by payee' },
  versus: (period) => `against ${period}`,
  rankTitle: {
    category: {
      sum: { out: 'Most spent on', in: 'Most received as' },
      count: { out: 'Most often paid for', in: 'Most often received as' },
    },
    payee: {
      sum: { out: 'Most spent at', in: 'Most received from' },
      count: { out: 'Most often paid to', in: 'Most often received from' },
    },
  },
  more: 'more',
  less: 'less',
  same: 'Exactly the same',
  compareMissing: 'No transactions are loaded for one of the periods.',
  unsupported: {
    tag: 'Not supported',
    tooOld: (model, min) => `This needs Gemini Nano v${min}. This phone has ${model}.`,
    unnamed: (min) => `This needs Gemini Nano v${min}. It’s unclear which version this phone has.`,
    loading: 'Android is still downloading Gemini Nano. Then you can ask here.',
    systemUpdate: 'Gemini Nano needs a system update. Install the latest updates.',
    aicore: 'Gemini Nano needs an AICore update.',
    none: 'This phone doesn’t offer Gemini Nano.',
    hint: 'Updating AICore and Private Compute Services in the Play Store often helps.',
    update: 'Update AICore',
  },
  spent: 'Spent',
  received: 'Received',
  times: (n) => (n === 1 ? 'once' : `${n} times`),
  together: (amount) => [amount, ' in total'],
  bookings: (n) => (n === 1 ? '1 transaction' : `${n} transactions`),
  largestOut: 'Largest expense',
  largestIn: 'Largest payment in',
  last: (day) => `Last on ${day}`,
  approx: 'approx.',
  perMonth: 'a month',
  averageBasis: (n) => (n === 1 ? 'from 1 whole month' : `from ${n} whole months`),
  noWholeMonth: 'No whole month loaded yet. This is the total.',
  none: 'No matching transactions',
  noneHint: (range) => `None of the loaded transactions (${range}) match.`,
  outside: 'No transactions are loaded for this period.',
  partial: (day) => `Only loaded from ${day}. There may have been more.`,
  atLeast: 'at least',
  show: 'Show transactions',
  desktop: {
    reading: 'Girovo is reading the question …',
    notUnderstood: 'Girovo didn’t understand that. Try something like “fuel in August”.',
  },
  thread: {
    title: 'Girovo AI',
    conversations: 'Conversations',
    newConversation: 'New conversation',
    noConversations: 'No conversations yet.',
    placeholder: 'Ask about your transactions',
    followUp: 'Ask a follow-up',
    send: 'Ask',
    empty: 'Ask something about your transactions. Girovo answers in full sentences.',
    you: 'You:',
    girovo: 'Girovo:',
    show: (n) => (n === 1 ? 'Show transaction' : `Show ${n} transactions`),
    copy: 'Copy answer',
    copied: 'Answer copied',
    notLoaded: 'Your transactions are still loading.',
    thinking: {
      starting: 'Gemma is starting',
      reading: 'Reading your question',
      writing: 'Writing the answer',
      seconds: (n) => `${n} s`,
    },
    deleteConversation: 'Delete conversation',
    deleteAll: 'Delete all conversations',
    offTopic: 'Girovo can\u2019t help with that. Ask about your transactions, like \u201cWhat went to Rewe in October?\u201d',
    next: {
      monthBefore: (month) => `And in ${month}?`,
      perMonth: 'Per month',
      largest: 'Largest expense',
    },
    say: {
      when: {
        month: (month) => `In ${month}`,
        year: (year) => `In ${year}`,
        days: (n) => `In the last ${n} days`,
        months: (n) => `In the last ${n} months`,
        since: (month) => `Since ${month}`,
        today: 'Today',
        range: (range) => `Between ${range}`,
      },
      outCategory: (when, topic, amount, count, n) => [when ? `${when}, you` : 'You', ' spent ', amount, ' on ', topic, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      outName: (when, topic, amount, count, n) => [when ? `${when}, you` : 'You', ' spent ', amount, ' at ', topic, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      out: (when, amount, count, n) => [when ? `${when}, you` : 'You', ' spent ', amount, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      inCategory: (when, topic, amount, count, n) => [when ? `${when}, you` : 'You', ' received ', amount, ' as ', topic, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      inName: (when, topic, amount, count, n) => [when ? `${when}, you` : 'You', ' received ', amount, ' from ', topic, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      in: (when, amount, count, n) => [when ? `${when}, you` : 'You', ' received ', amount, ' across ', count, n === 1 ? ' transaction.' : ' transactions.'],
      both: (when, out, inn) => [when ? `${when}, you` : 'You', ' spent ', out, ' and received ', inn, '.'],
      count: (when, count, amount, topic) => (topic
        ? [when ? `${when}, at ` : 'At ', topic, ' it was ', count, ', ', amount, ' in total.']
        : [when ? `${when}, it was ` : 'It was ', count, ', ', amount, ' in total.']),
      average: (amount, basis) => ['On average that is about ', amount, ' a month, ', basis, '.'],
      largestOut: (name, amount, day) => ['The largest expense was ', name, ' at ', amount, ' on ', day, '.'],
      largestIn: (name, amount, day) => ['The largest payment in was ', name, ' at ', amount, ' on ', day, '.'],
      last: (name, amount, day) => ['Last on ', day, ': ', name, ' at ', amount, '.'],
      compare: (a, aAmount, b, bAmount) => [a, ': ', aAmount, '. ', b, ': ', bAmount, '.'],
      diff: (amount, more) => ['That is ', amount, more ? ' more.' : ' less.'],
      same: 'Exactly the same.',
      rank: (title, name, amount) => [title, ' ', name, ': ', amount, '.'],
    },
    intro: {
      title: 'Girovo AI',
      sentences: 'You get the answer in full sentences.',
      figures: 'Girovo works out every amount itself from your transactions.',
      later: 'Later',
      go: 'Try it',
    },
  },
  recap: {
    title: (month) => `Your ${month}`,
    titleAll: (month) => `Your ${month}, all accounts`,
    spent: (amount, diff, more) => (diff
      ? ['You spent ', amount, ', ', diff, more ? ' more than the month before.' : ' less than the month before.']
      : ['You spent ', amount, '.']),
    top: (name, amount) => ['Most went to ', name, ': ', amount, '.'],
    more: 'Ask a follow-up',
    show: (name) => `Show ${name}`,
    hide: 'Hide recap',
    conversation: (month) => `Recap ${month}`,
  },
  actions: {
    contracts: (n, monthly) => (n === 1
      ? ['You have one contract or subscription, ', monthly, ' a month.']
      : ['You have ', String(n), ' contracts and subscriptions, ', monthly, ' a month in total.']),
    noContracts: 'Girovo hasn\u2019t found any contracts or subscriptions in your transactions yet.',
    openContracts: 'Open contracts & subscriptions',
    theme: { light: 'Light', dark: 'Dark', system: 'Same as the system' },
    readTheme: (value) => `Appearance: ${value}.`,
    readPrivacy: (hidden) => (hidden ? 'Amounts are hidden.' : 'Amounts are visible.'),
    readLanguage: (name) => `Language: ${name}.`,
    readIdle: (minutes) => `Girovo logs you out after ${minutes} minutes without input.`,
    askTheme: { light: 'Should Girovo switch to the light theme?', dark: 'Should Girovo switch to the dark theme?', system: 'Should Girovo follow the system\u2019s appearance?' },
    askPrivacy: (hide) => (hide ? 'Should Girovo hide all amounts?' : 'Should Girovo show the amounts again?'),
    askLanguage: (name) => `Should Girovo switch to ${name}?`,
    askRefresh: 'Should Girovo refresh all accounts?',
    refreshNote: 'May need an approval.',
    yes: 'Yes, please',
    no: 'Cancel',
    done: 'Done.',
    doneTheme: { light: 'Done, the light theme is on.', dark: 'Done, the dark theme is on.', system: 'Done, the appearance now follows the system.' },
    donePrivacy: (hidden) => (hidden ? 'Done, amounts are hidden.' : 'Done, amounts are visible again.'),
    doneLanguage: 'Done, Girovo is now in English.',
    refreshing: 'Girovo is refreshing all accounts.',
    cancelled: 'Cancelled, nothing changed.',
    already: 'That\u2019s already set.',
  },
};
