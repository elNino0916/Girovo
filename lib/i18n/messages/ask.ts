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
      starting: 'Girovo AI startet',
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
  /**
   * Girovo Next: the chips under an answer that say how Girovo read the
   * question (components/insights/ask/ReadingChips.tsx, labels in lib/ask-chips.ts).
   * Each one opens a menu that changes that part, and the answer follows.
   */
  chips: {
    title: 'Verstanden als',
    /** A chip's name for a screen reader: what it changes, then what it says now. */
    aria: (change: string, value: string) => `${change}, ${value}`,
    change: {
      topic: 'Thema ändern',
      dir: 'Ausgaben oder Eingänge ändern',
      period: 'Zeitraum ändern',
      against: 'Vergleich ändern',
      rankBy: 'Nach Ort oder Kategorie ordnen',
      metric: 'Nach Betrag oder Häufigkeit ordnen',
    },
    allCategories: 'alle Kategorien',
    removeName: (name: string) => `„${name}“ entfernen`,
    period: {
      thisMonth: 'diesen Monat',
      lastMonth: 'letzten Monat',
      thisYear: 'dieses Jahr',
      lastYear: 'letztes Jahr',
      all: 'alles',
    },
    rankBy: { payee: 'nach Ort', category: 'nach Kategorie' },
    metric: { sum: 'nach Betrag', count: 'nach Häufigkeit' },
  },

  /**
   * Girovo Next: "Was ist das für eine Zahlung?", one booking explained
   * (components/insights/ask/ExplainAnswer.tsx, lib/ask-explain.ts). The first
   * suggestion in a booking's "Frag zu diesem Umsatz"; typed, it is understood too.
   */
  explain: {
    question: 'Was ist das für eine Zahlung?',
    /** The conversation it starts, as Gespräche name it. */
    title: (name: string) => `${name}, erklärt`,
    /** Asked with no booking to go by. */
    noBooking: 'Öffne zuerst einen Umsatz und frag dort.',
    /** Who it is and what kind of booking, in one line (lib/categorize.ts BookingKind; sepa: a Lastschrift with its mandate). */
    kind: {
      lastschrift: (name: string, credit: boolean) => (credit ? `Eine Lastschrift von ${name}.` : `${name} hat das per Lastschrift abgebucht.`),
      sepa: (name: string, credit: boolean) => (credit ? `Eine SEPA-Lastschrift von ${name}.` : `${name} hat das per SEPA-Lastschrift abgebucht.`),
      karte: (name: string, credit: boolean) => (credit ? `Eine Erstattung von ${name} auf deine Karte.` : `Eine Kartenzahlung bei ${name}.`),
      ueberweisung: (name: string, credit: boolean) => (credit ? `Eine Überweisung von ${name}.` : `Eine Überweisung an ${name}.`),
      echtzeit: (name: string, credit: boolean) => (credit ? `Eine Echtzeitüberweisung von ${name}.` : `Eine Echtzeitüberweisung an ${name}.`),
      dauerauftrag: (name: string, credit: boolean) => (credit ? `Ein Dauerauftrag von ${name}.` : `Ein Dauerauftrag an ${name}.`),
      gutschrift: (name: string, credit: boolean) => (credit ? `Eine Gutschrift von ${name}.` : `Eine Zahlung an ${name}.`),
      gehalt: (name: string, credit: boolean) => (credit ? `Gehalt oder Rente von ${name}.` : `Eine Zahlung an ${name}.`),
      bargeld: (_name: string, credit: boolean): string => (credit ? 'Eine Bareinzahlung.' : 'Bargeld vom Geldautomaten.'),
      entgelt: (_name: string, credit: boolean): string => (credit ? 'Deine Bank hat ein Entgelt erstattet.' : 'Ein Entgelt deiner Bank.'),
      zinsen: (_name: string, credit: boolean): string => (credit ? 'Zinsen von deiner Bank.' : 'Zinsen, die deine Bank berechnet hat.'),
      ruecklastschrift: (name: string, credit: boolean) => (credit ? `Eine Lastschrift von ${name} ging zurück, das Geld ist wieder da.` : `Eine Rücklastschrift mit ${name}.`),
      sonstige: (name: string, credit: boolean) => (credit ? `Geld von ${name}.` : `Eine Zahlung an ${name}.`),
    },
    /** The purpose, tidied; the bank's own text stays in the booking's details. */
    purpose: (text: string) => `Verwendungszweck: „${text}“`,
    /** It belongs to a contract in Verträge & Abos; the rhythm as Verträge & Abos says it ("monatlich", "alle 4 Wochen"). */
    repeats: (cadence: string) => `Kommt ${cadence}, steht bei deinen Verträgen & Abos.`,
    /** A Lastschrift or a Dauerauftrag that no contract holds. */
    noContract: 'Girovo kennt das noch nicht als Vertrag oder Abo.',
    mandate: 'Mandatsreferenz',
    creditorId: 'Gläubiger-ID',
    open: 'Umsatz öffnen',
  },

  /**
   * Girovo Next, Girovo AI: answers that are lists (components/insights/ask/ListAnswer.tsx).
   * A ranking says in one line how many places or categories and the first;
   * every one follows as a row. `when` opens the line (null: every loaded booking);
   * `often`: ranked by how often, else by money.
   */
  list: {
    rank: {
      dining: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} warst du` : 'Du warst'} nur bei ${first} essen.`
        : `${when ? `${when} warst du` : 'Du warst'} in ${n} Restaurants, ${often ? 'am häufigsten bei' : 'das meiste ging an'} ${first}.`),
      shops: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} hast du` : 'Du hast'} nur bei ${first} eingekauft.`
        : `${when ? `${when} hast du` : 'Du hast'} in ${n} Läden eingekauft, ${often ? 'am häufigsten bei' : 'das meiste ging an'} ${first}.`),
      payeeOut: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} hast du` : 'Du hast'} nur an ${first} gezahlt.`
        : `${when ? `${when} hast du` : 'Du hast'} an ${n} Empfänger gezahlt, ${often ? 'am häufigsten' : 'das meiste'} an ${first}.`),
      payeeIn: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} hast du` : 'Du hast'} nur von ${first} Geld bekommen.`
        : `${when ? `${when} hast du` : 'Du hast'} von ${n} Absendern Geld bekommen, ${often ? 'am häufigsten' : 'das meiste'} von ${first}.`),
      categoryOut: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} hast du` : 'Du hast'} nur für ${first} ausgegeben.`
        : `${when ? `${when} hast du` : 'Du hast'} in ${n} Kategorien ausgegeben, ${often ? 'am häufigsten' : 'das meiste'} für ${first}.`),
      categoryIn: (when: string | null, n: number, first: string, often: boolean) => (n === 1
        ? `${when ? `${when} hast du` : 'Du hast'} nur als ${first} Geld bekommen.`
        : `${when ? `${when} hast du` : 'Du hast'} Geld aus ${n} Kategorien bekommen, ${often ? 'am häufigsten' : 'das meiste'} als ${first}.`),
    },
    /** Under a long ranking: the rest, in place. */
    showAll: (n: number) => `Alle ${n} zeigen`,
    showLess: 'Weniger zeigen',
    /** "Zeig alle Zahlungen an Amazon": one line over the newest bookings. `count` is "23 Umsätze". */
    withName: (when: string | null, count: ReactNode, topic: ReactNode, amount: ReactNode | null): ReactNode[] => [
      when ? `${when} hattest du ` : 'Du hast ', count, ' mit ', topic, ...(amount ? [', zusammen ', amount] : []), '.',
    ],
    withCategory: (when: string | null, count: ReactNode, topic: ReactNode, amount: ReactNode | null, income: boolean): ReactNode[] => [
      when ? `${when} hattest du ` : 'Du hast ', count, income ? ' als ' : ' für ', topic, ...(amount ? [', zusammen ', amount] : []), '.',
    ],
    plain: (when: string | null, count: ReactNode, amount: ReactNode | null): ReactNode[] => [
      when ? `${when} hattest du ` : 'Du hast ', count, ...(amount ? [', zusammen ', amount] : []), '.',
    ],
    /** Over the rows when there are more bookings than rows. */
    newest: (n: number) => `Die ${n} neuesten`,
  },

  /**
   * Girovo Next: answers from the app's own figures (lib/ask-facts.ts,
   * components/insights/ask/FactAnswers.tsx): the balances, the month-end
   * forecast, Verträge & Abos, the salary, Aufteilen and Sparziele.
   */
  facts: {
    noAccounts: 'Noch sind keine Konten geladen.',
    balanceOne: (account: string, amount: ReactNode): ReactNode[] => ['Auf ', account, ' hast du ', amount, '.'],
    balanceTotal: (amount: ReactNode, n: number): ReactNode[] => ['Auf deinen ', String(n), ' Konten hast du zusammen ', amount, '.'],
    balanceOpen: 'Noch sind nicht alle Kontostände da.',
    balanceWithout: (names: string) => `Nicht mitgezählt: ${names}.`,
    balanceKept: 'Manche Stände sind nicht von heute.',
    openAccounts: 'Konten öffnen',
    monthEnd: (month: string, amount: ReactNode, account: string | null): ReactNode[] => (account
      ? ['Ende ', month, ' hast du auf ', account, ' voraussichtlich etwa ', amount, '.']
      : ['Ende ', month, ' hast du voraussichtlich etwa ', amount, '.']),
    monthEndFine: 'Es reicht also bis zum Monatsende.',
    monthEndZero: (day: string) => `Am ${day} könnte das Konto ins Minus gehen.`,
    /** It dips below zero, then money comes in before the month ends. */
    monthEndDip: (day: string) => `Am ${day} könnte das Konto kurz ins Minus gehen, bevor wieder Geld kommt.`,
    monthEndLimit: (day: string) => `Am ${day} könnte der Dispo nicht reichen.`,
    noForecast: 'Für eine Prognose fehlt noch der heutige Kontostand.',
    staleForecast: 'Der Kontostand ist nicht von heute. Aktualisiere zuerst dein Konto.',
    noGiro: 'Für eine Prognose braucht Girovo ein Girokonto.',
    forecastPlus: 'Die Prognose gibt es mit Girovo Plus.',
    openForecast: 'Prognose ansehen',
    contractYear: (name: string, year: ReactNode, month: ReactNode): ReactNode[] => [name, ' kostet dich ', year, ' im Jahr, also ', month, ' im Monat.'],
    contractRose: (month: string, delta: ReactNode): ReactNode[] => ['Seit ', month, ' zahlst du ', delta, ' mehr.'],
    contractMore: (names: string) => `Dazu passt auch: ${names}.`,
    contractNone: (name: string) => `„${name}“ ist nicht unter deinen Verträgen & Abos.`,
    contractsYear: (year: ReactNode, n: number): ReactNode[] => (n === 1
      ? ['Dein Vertrag kostet dich ', year, ' im Jahr.']
      : ['Deine ', String(n), ' Verträge und Abos kosten dich zusammen ', year, ' im Jahr.']),
    risesNone: 'Keins deiner Abos ist im letzten Jahr teurer geworden.',
    riseOne: (name: string, month: string, delta: ReactNode, year: ReactNode): ReactNode[] => [name, ' kostet seit ', month, ' ', delta, ' mehr, das sind ', year, ' im Jahr.'],
    risesMany: (n: number, year: ReactNode): ReactNode[] => [String(n), ' Verträge sind teurer geworden, zusammen ', year, ' mehr im Jahr.'],
    riseSince: (month: string) => `seit ${month}`,
    salaryNext: (name: string, day: string | null, amount: ReactNode, approx: boolean): ReactNode[] => [
      'Dein Gehalt von ', name, day ? ` kommt voraussichtlich am ${day}, ` : ' kommt voraussichtlich heute, ', approx ? 'etwa ' : '', amount, '.',
    ],
    salaryLate: (name: string, day: string) => `Das Gehalt von ${name} war am ${day} erwartet und ist noch nicht da.`,
    salaryDue: (name: string, day: string) => `Das Gehalt von ${name} war am ${day} erwartet und kommt bald.`,
    noSalary: 'Girovo hat in deinen Umsätzen noch kein regelmäßiges Gehalt gefunden.',
    owedNoRecord: 'Girovo merkt sich nicht, was du mit Aufteilen anforderst.',
    owedLast: (name: string, amount: ReactNode, day: string): ReactNode[] => ['Zuletzt kamen von „', name, '“ ', amount, ' am ', day, '.'],
    owedNothing: (name: string) => `Von „${name}“ kam in den geladenen Umsätzen kein Geld.`,
    owedShow: (name: string) => `Umsätze von ${name} zeigen`,
    goalPlus: 'Sparziele gibt es mit Girovo Plus.',
    noGoals: 'Du hast noch kein Sparziel. Leg eins bei einem Sparkonto an.',
    goalNotFound: (name: string) => `Ein Sparziel „${name}“ gibt es nicht.`,
    goalProgress: (name: string, have: ReactNode, target: ReactNode, percent: number): ReactNode[] => ['Für „', name, '“ hast du ', have, ' von ', target, ', also ', `${percent} %.`],
    goalMissing: (missing: ReactNode): ReactNode[] => ['Es fehlen noch ', missing, '.'],
    goalPerMonth: (amount: ReactNode, month: string): ReactNode[] => ['Bis ', month, ' sind das ', amount, ' im Monat.'],
    goalReached: (name: string) => `Dein Ziel „${name}“ ist erreicht.`,
    goalNoBalance: (name: string) => `Für „${name}“ fehlt noch der Kontostand.`,
    openGoal: 'Sparkonto öffnen',
    openGoals: 'Sparziele ansehen',
    /** "Kontostand am 1. Oktober": rebuilt from today's balance and the bookings since. */
    balanceAtOne: (account: string, day: string, amount: ReactNode): ReactNode[] => ['Am ', day, ' hattest du auf ', account, ' ', amount, '.'],
    balanceAtTotal: (day: string, amount: ReactNode, n: number): ReactNode[] => ['Am ', day, ' hattest du auf deinen ', String(n), ' Konten zusammen ', amount, '.'],
    balanceAtTooFar: (from: string | null) => (from
      ? `So weit zurück sieht Girovo nicht. Deine Umsätze beginnen am ${from}.`
      : 'So weit zurück sieht Girovo nicht.'),
    balanceAtSome: 'Bei manchen Konten reichen die Umsätze nicht so weit zurück.',
    /** "Wie viel schuldet mir Lea noch?": what Aufteilen asked for and what came. */
    owedOpenOne: (name: string, amount: ReactNode): ReactNode[] => [name, ' schuldet dir noch ', amount, '.'],
    owedOpenAll: (amount: ReactNode, n: number): ReactNode[] => (n === 1
      ? ['Eine Person schuldet dir noch ', amount, '.']
      : [String(n), ' Personen schulden dir zusammen noch ', amount, '.']),
    owedPaidOne: (name: string, amount: ReactNode): ReactNode[] => [name, ' hat dir schon ', amount, ' gezahlt.'],
    owedPaidAll: (amount: ReactNode): ReactNode[] => ['Zurückgezahlt sind schon ', amount, '.'],
    owedAllPaid: (name: string) => `${name} hat alles bezahlt.`,
    owedNobody: 'Niemand schuldet dir noch etwas.',
    owedNoRequests: 'Mit Aufteilen hast du noch nichts angefordert.',
    owedNoneFor: (name: string) => `Von „${name}“ hast du mit Aufteilen nichts angefordert.`,
    /** A request's row: the booking it came from, "seit 10. November". */
    owedSince: (day: string) => `seit ${day}`,
    owedOpenCount: (n: number) => `${n} offen`,
    owedRequest: 'Aufteilen',
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
      starting: 'Girovo AI is starting',
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
  chips: {
    title: 'Read as',
    aria: (change, value) => `${change}, ${value}`,
    change: {
      topic: 'Change topic',
      dir: 'Change spending or income',
      period: 'Change period',
      against: 'Change comparison',
      rankBy: 'Order by place or category',
      metric: 'Order by amount or frequency',
    },
    allCategories: 'all categories',
    removeName: (name) => `Remove \u201c${name}\u201d`,
    period: {
      thisMonth: 'this month',
      lastMonth: 'last month',
      thisYear: 'this year',
      lastYear: 'last year',
      all: 'everything',
    },
    rankBy: { payee: 'by place', category: 'by category' },
    metric: { sum: 'by amount', count: 'by frequency' },
  },
  explain: {
    question: 'What is this payment?',
    title: (name) => `${name}, explained`,
    noBooking: 'Open a transaction first and ask there.',
    kind: {
      lastschrift: (name, credit) => (credit ? `A direct debit from ${name}.` : `${name} collected this by direct debit.`),
      sepa: (name, credit) => (credit ? `A SEPA direct debit from ${name}.` : `${name} collected this by SEPA direct debit.`),
      karte: (name, credit) => (credit ? `A refund from ${name} to your card.` : `A card payment at ${name}.`),
      ueberweisung: (name, credit) => (credit ? `A transfer from ${name}.` : `A transfer to ${name}.`),
      echtzeit: (name, credit) => (credit ? `An instant transfer from ${name}.` : `An instant transfer to ${name}.`),
      dauerauftrag: (name, credit) => (credit ? `A standing order from ${name}.` : `A standing order to ${name}.`),
      gutschrift: (name, credit) => (credit ? `A credit from ${name}.` : `A payment to ${name}.`),
      gehalt: (name, credit) => (credit ? `Salary or pension from ${name}.` : `A payment to ${name}.`),
      bargeld: (_name, credit) => (credit ? 'A cash deposit.' : 'Cash from a cash machine.'),
      entgelt: (_name, credit) => (credit ? 'Your bank refunded a fee.' : 'A fee from your bank.'),
      zinsen: (_name, credit) => (credit ? 'Interest from your bank.' : 'Interest your bank charged.'),
      ruecklastschrift: (name, credit) => (credit ? `A direct debit from ${name} came back, the money is back.` : `A returned direct debit with ${name}.`),
      sonstige: (name, credit) => (credit ? `Money from ${name}.` : `A payment to ${name}.`),
    },
    purpose: (text) => `Payment reference: \u201c${text}\u201d`,
    repeats: (cadence) => `Comes ${cadence}, listed in your contracts & subscriptions.`,
    noContract: 'Girovo doesn\u2019t know this as a contract or subscription yet.',
    mandate: 'Mandate reference',
    creditorId: 'Creditor ID',
    open: 'Open transaction',
  },
  list: {
    rank: {
      dining: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only ate at ${first}.`
        : `${when ? `${when}, you` : 'You'} ate at ${n} restaurants, ${often ? 'most often at' : 'the most went to'} ${first}.`),
      shops: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only shopped at ${first}.`
        : `${when ? `${when}, you` : 'You'} shopped at ${n} stores, ${often ? 'most often at' : 'the most went to'} ${first}.`),
      payeeOut: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only paid ${first}.`
        : `${when ? `${when}, you` : 'You'} paid ${n} payees, ${often ? 'most often' : 'the most went to'} ${first}.`),
      payeeIn: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only got money from ${first}.`
        : `${when ? `${when}, you` : 'You'} got money from ${n} senders, ${often ? 'most often' : 'the most'} from ${first}.`),
      categoryOut: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only spent on ${first}.`
        : `${when ? `${when}, you` : 'You'} spent in ${n} categories, ${often ? 'most often' : 'the most'} on ${first}.`),
      categoryIn: (when, n, first, often) => (n === 1
        ? `${when ? `${when}, you` : 'You'} only got money as ${first}.`
        : `${when ? `${when}, you` : 'You'} got money in ${n} categories, ${often ? 'most often' : 'the most'} as ${first}.`),
    },
    showAll: (n) => `Show all ${n}`,
    showLess: 'Show fewer',
    withName: (when, count, topic, amount) => [
      when ? `${when}, you had ` : 'You have ', count, ' with ', topic, ...(amount ? [', ', amount, ' in total'] : []), '.',
    ],
    withCategory: (when, count, topic, amount, income) => [
      when ? `${when}, you had ` : 'You have ', count, income ? ' as ' : ' for ', topic, ...(amount ? [', ', amount, ' in total'] : []), '.',
    ],
    plain: (when, count, amount) => [
      when ? `${when}, you had ` : 'You have ', count, ...(amount ? [', ', amount, ' in total'] : []), '.',
    ],
    newest: (n) => `The ${n} newest`,
  },
  facts: {
    noAccounts: 'No accounts are loaded yet.',
    balanceOne: (account, amount) => ['You have ', amount, ' in ', account, '.'],
    balanceTotal: (amount, n) => ['You have ', amount, ' across your ', String(n), ' accounts.'],
    balanceOpen: 'Not all balances are in yet.',
    balanceWithout: (names) => `Not counted: ${names}.`,
    balanceKept: 'Some balances aren’t from today.',
    openAccounts: 'Open accounts',
    monthEnd: (month, amount, account) => (account
      ? ['At the end of ', month, ', ', account, ' will likely be at about ', amount, '.']
      : ['At the end of ', month, ', you’ll likely have about ', amount, '.']),
    monthEndFine: 'So it lasts until the end of the month.',
    monthEndZero: (day) => `On ${day} the account could go below zero.`,
    monthEndDip: (day) => `On ${day} the account could briefly go below zero before money comes in again.`,
    monthEndLimit: (day) => `On ${day} your overdraft might not be enough.`,
    noForecast: 'A forecast needs today’s balance first.',
    staleForecast: 'The balance isn’t from today. Refresh your account first.',
    noGiro: 'A forecast needs a current account.',
    forecastPlus: 'The forecast comes with Girovo Plus.',
    openForecast: 'See forecast',
    contractYear: (name, year, month) => [name, ' costs you ', year, ' a year, that’s ', month, ' a month.'],
    contractRose: (month, delta) => ['Since ', month, ' you pay ', delta, ' more.'],
    contractMore: (names) => `Also matching: ${names}.`,
    contractNone: (name) => `“${name}” isn’t among your contracts & subscriptions.`,
    contractsYear: (year, n) => (n === 1
      ? ['Your contract costs you ', year, ' a year.']
      : ['Your ', String(n), ' contracts and subscriptions cost you ', year, ' a year in total.']),
    risesNone: 'None of your subscriptions got more expensive in the last year.',
    riseOne: (name, month, delta, year) => [name, ' costs ', delta, ' more since ', month, ', that’s ', year, ' a year.'],
    risesMany: (n, year) => [String(n), ' contracts got more expensive, ', year, ' more a year in total.'],
    riseSince: (month) => `since ${month}`,
    salaryNext: (name, day, amount, approx) => [
      'Your salary from ', name, day ? ` should arrive on ${day}, ` : ' should arrive today, ', approx ? 'about ' : '', amount, '.',
    ],
    salaryLate: (name, day) => `Your salary from ${name} was expected on ${day} and hasn’t arrived yet.`,
    salaryDue: (name, day) => `Your salary from ${name} was expected on ${day} and should arrive soon.`,
    noSalary: 'Girovo hasn’t found a regular salary in your transactions yet.',
    owedNoRecord: 'Girovo doesn’t keep track of what you request with Split.',
    owedLast: (name, amount, day) => ['The last money from “', name, '” was ', amount, ' on ', day, '.'],
    owedNothing: (name) => `No money from “${name}” in the loaded transactions.`,
    owedShow: (name) => `Show transactions from ${name}`,
    goalPlus: 'Savings goals come with Girovo Plus.',
    noGoals: 'You don’t have a savings goal yet. Set one on a savings account.',
    goalNotFound: (name) => `There’s no savings goal called “${name}”.`,
    goalProgress: (name, have, target, percent) => ['For “', name, '” you have ', have, ' of ', target, ', that’s ', `${percent}%.`],
    goalMissing: (missing) => [missing, ' still to go.'],
    goalPerMonth: (amount, month) => ['That’s ', amount, ' a month until ', month, '.'],
    goalReached: (name) => `You reached your goal “${name}”.`,
    goalNoBalance: (name) => `The balance for “${name}” isn’t in yet.`,
    openGoal: 'Open savings account',
    openGoals: 'See savings goals',
    balanceAtOne: (account, day, amount) => ['On ', day, ' you had ', amount, ' in ', account, '.'],
    balanceAtTotal: (day, amount, n) => ['On ', day, ' you had ', amount, ' across your ', String(n), ' accounts.'],
    balanceAtTooFar: (from) => (from
      ? `Girovo can’t see that far back. Your transactions start on ${from}.`
      : 'Girovo can’t see that far back.'),
    balanceAtSome: 'For some accounts the transactions don’t go back that far.',
    owedOpenOne: (name, amount) => [name, ' still owes you ', amount, '.'],
    owedOpenAll: (amount, n) => (n === 1
      ? ['One person still owes you ', amount, '.']
      : [String(n), ' people still owe you ', amount, ' in total.']),
    owedPaidOne: (name, amount) => [name, ' has already paid you ', amount, '.'],
    owedPaidAll: (amount) => [amount, ' has already been paid back.'],
    owedAllPaid: (name) => `${name} has paid everything.`,
    owedNobody: 'Nobody owes you anything.',
    owedNoRequests: 'You haven’t requested anything with Split yet.',
    owedNoneFor: (name) => `You haven’t requested anything from “${name}” with Split.`,
    owedSince: (day) => `since ${day}`,
    owedOpenCount: (n) => `${n} open`,
    owedRequest: 'Split',
  },
};
