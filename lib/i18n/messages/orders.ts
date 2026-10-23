// Daueraufträge and terminierte Überweisungen: the transfer sheet's "Termin"
// choice and its steps (components/TransferSheet.tsx, components/transfer/*),
// the schedule in words (lib/order-schedule.ts), the bank's Bestand under
// Verträge & Abos (components/BankOrders.tsx), its approvals, and the answers
// of /api/transfer, /api/bank-orders and /api/bank-orders/delete.

import type { ReactNode } from 'react';

/** The two kinds of order the bank keeps for later. */
type Kind = 'standing' | 'dated';
/** What an approval for one of them is for (components/TanWaitOverlay.tsx). */
type OrderWait = 'standingOrder' | 'datedTransfer' | 'bankOrders' | 'orderDelete' | 'orderChange';

/** "1." … "30." — or the end of the month, said in words. */
const deMonthDay = (day: number) => (day === 99 ? 'Monatsletzter'
  : day === 98 ? 'Vorletzter des Monats'
    : day === 97 ? 'Drittletzter des Monats'
      : `${day}.`);

const enOrdinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export const de = {
  /** The two kinds, as a tag or a row's value names them. */
  kind: { standing: 'Dauerauftrag', dated: 'Terminüberweisung' } as Record<Kind, string>,
  /** The two kinds in the plural, as a list's heading names them. */
  kinds: { standing: 'Daueraufträge', dated: 'Terminüberweisungen' } as Record<Kind, string>,

  /** A schedule in words (lib/order-schedule.ts). Dates arrive formatted. */
  schedule: {
    /** Turnus: every `n` months (M) or weeks (W). */
    rhythm: (unit: 'M' | 'W', n: number) => {
      if (unit === 'W') return n === 1 ? 'wöchentlich' : `alle ${n} Wochen`;
      return n === 1 ? 'monatlich'
        : n === 3 ? 'vierteljährlich'
          : n === 6 ? 'halbjährlich'
            : n === 12 ? 'jährlich'
              : `alle ${n} Monate`;
    },
    /** Ausführungstag of a monthly order, in a sentence. 97–99: the last days of the month. */
    onMonthDay: (day: number) => (day === 99 ? 'am letzten Tag des Monats'
      : day === 98 ? 'am vorletzten Tag des Monats'
        : day === 97 ? 'am drittletzten Tag des Monats'
          : `am ${day}.`),
    /** The same, as an option of the "Ausführungstag" select. */
    monthDayOption: deMonthDay,
    /** `name`: the weekday as Intl writes it ("Montag"). */
    onWeekday: (name: string) => `am ${name}`,
    dated: (date: string) => `Ausführung am ${date}`,
    /** `last`: the last execution date, or null for "until further notice". */
    standing: (first: string, rhythm: string, day: string, last: string | null) =>
      `Erste Ausführung am ${first}, dann ${rhythm} ${day} – ${last ? `bis ${last}` : 'bis auf Weiteres'}`,
    /** A Dauerauftrag in a list row: "monatlich am 1.". */
    rhythmLine: (rhythm: string, day: string) => `${rhythm} ${day}`,
  },

  /** The transfer sheet's form. */
  form: {
    /** Sofort, an einem Datum or regelmäßig — the choice and the review's row. */
    when: 'Termin',
    now: 'Sofort',
    dated: 'An einem Datum',
    standing: 'Regelmäßig',
    date: 'Ausführungsdatum',
    /** Under the date fields: the bank's window. */
    window: (from: string, to: string) => `Frühestens am ${from}, spätestens am ${to}.`,
    notBankDay: 'Das ist kein Bankarbeitstag – deine Bank führt den Auftrag am nächsten aus.',
    rhythm: 'Turnus',
    day: 'Ausführungstag',
    first: 'Erste Ausführung',
    last: 'Letzte Ausführung',
    lastHint: 'Leer lassen: bis auf Weiteres.',
    /** Under Standard | Echtzeit, while a date or a rhythm is chosen. */
    noInstant: 'Echtzeit gibt es nur, wenn die Überweisung sofort ausgeführt wird.',
    /** No rules from the bank at hand (none sent, or a device profile from before): the app offers what every bank accepts. */
    defaults: 'Die Regeln deiner Bank dafür liegen der App nicht vor – die Auswahl ist deshalb auf das Übliche beschränkt.',
    problems: {
      dateMissing: 'Bitte wähle das Datum.',
      tooEarly: (from: string) => `Frühestens am ${from} – so viel Vorlauf braucht deine Bank.`,
      tooLate: (to: string) => `Spätestens am ${to} – weiter im Voraus nimmt deine Bank den Auftrag nicht an.`,
      rhythmNotAllowed: 'Diesen Turnus bietet deine Bank nicht an.',
      dayNotAllowed: 'An diesem Tag führt deine Bank Daueraufträge nicht aus.',
      /** `day`: the chosen Ausführungstag as the select names it. */
      firstNotOnDay: (day: string) => `Die erste Ausführung muss auf den Ausführungstag fallen (${day}).`,
      lastBeforeFirst: 'Die letzte Ausführung kann nicht vor der ersten liegen.',
      lastInvalid: 'Bitte gib ein gültiges Datum an – oder lass das Feld leer.',
    },
  },

  /** Each kind's words on the sheet's steps. */
  sheet: {
    titles: {
      standing: {
        review: 'Dauerauftrag prüfen',
        done: 'Dauerauftrag eingerichtet',
        refused: 'Dauerauftrag nicht eingerichtet',
      },
      dated: {
        review: 'Terminüberweisung prüfen',
        done: 'Terminüberweisung angelegt',
        refused: 'Terminüberweisung nicht angelegt',
      },
    } as Record<Kind, { review: string; done: string; refused: string }>,
    /** The review's primary, and the risky outline beside a duplicate or a name mismatch. */
    send: { standing: 'Dauerauftrag einrichten', dated: 'Terminüberweisung anlegen' } as Record<Kind, string>,
    sendAnyway: { standing: 'Trotzdem einrichten', dated: 'Trotzdem anlegen' } as Record<Kind, string>,
    sendUnchecked: { standing: 'Ohne Abgleich einrichten', dated: 'Ohne Abgleich anlegen' } as Record<Kind, string>,
    sendNoResult: { standing: 'Ohne Ergebnis einrichten', dated: 'Ohne Ergebnis anlegen' } as Record<Kind, string>,
    approve: { standing: 'Dauerauftrag freigeben', dated: 'Terminüberweisung freigeben' } as Record<Kind, string>,
    /** The review step: no balance figure for a day that has not come. */
    noFunds: 'Ob das Konto gedeckt ist, prüft deine Bank am Tag der Ausführung.',
    /** The done step, under the schedule line. */
    done: {
      /** `place`: where the list lives ("Verträge & Abos"). */
      where: (place: string) => `Du findest den Auftrag unter „${place}“, sobald du die Aufträge deiner Bank abrufst.`,
    },
    showOrders: 'Aufträge ansehen',
    /** The "Status unklar" step. */
    unknown: {
      noConfirmation: {
        standing: 'Für diesen Dauerauftrag liegt keine Bestätigung vor. Deine Bank kann ihn trotzdem angelegt haben.',
        dated: 'Für diese Terminüberweisung liegt keine Bestätigung vor. Deine Bank kann sie trotzdem angelegt haben.',
      } as Record<Kind, string>,
      /** `action`: the check button's label. */
      beforeResend: {
        standing: (action: string) => 'Bevor du ihn noch einmal anlegst: Sieh nach, ob deine Bank ihn schon führt – '
          + `„${action}“ ruft deine Daueraufträge ab, das kann eine Freigabe erfordern.`,
        dated: (action: string) => 'Bevor du sie noch einmal anlegst: Sieh nach, ob deine Bank sie schon führt – '
          + `„${action}“ ruft deine Terminüberweisungen ab, das kann eine Freigabe erfordern.`,
      } as Record<Kind, (action: string) => string>,
      loading: { standing: 'Daueraufträge werden abgerufen …', dated: 'Terminüberweisungen werden abgerufen …' } as Record<Kind, string>,
      found: 'Gefunden bei deiner Bank',
      /** `when`: the schedule in words. */
      foundText: (amount: ReactNode, name: string, when: string): ReactNode[] => [
        amount, ` an ${name} – ${when}. Lege den Auftrag nicht noch einmal an.`,
      ],
      notVisible: 'Noch nicht sichtbar – bitte nicht noch einmal anlegen',
      notChecked: 'Nachsehen nicht möglich – bitte nicht noch einmal anlegen',
      /** `list`: the plural of the kind ("Daueraufträgen"). */
      notYet: (list: string, time: ReactNode): ReactNode[] => [
        `In deinen ${list} bei der Bank steht der Auftrag noch nicht (Stand `,
        time,
        '). Sieh später noch einmal nach oder prüfe es im Online-Banking deiner Bank.',
      ],
      /** The dative plural for notYet. */
      listDative: { standing: 'Daueraufträgen', dated: 'Terminüberweisungen' } as Record<Kind, string>,
      failed: 'Abruf der Aufträge fehlgeschlagen.',
      tryAgain: 'Versuche es gleich noch einmal oder prüfe es im Online-Banking deiner Bank.',
      nothingToRead: 'Die Aufträge dieses Kontos liefert deine Bank nicht an die App. Prüfe es im Online-Banking deiner Bank.',
    },
  },

  /** An approval for one of them (components/TanWaitOverlay.tsx). */
  wait: {
    title: {
      standingOrder: 'Dauerauftrag freigeben',
      datedTransfer: 'Terminüberweisung freigeben',
      bankOrders: 'Abruf freigeben',
      orderDelete: 'Löschen freigeben',
      orderChange: 'Änderung freigeben',
    } as Record<OrderWait, string>,
    /** As the object of "bestätige …". */
    subject: {
      standingOrder: 'den Dauerauftrag',
      datedTransfer: 'die Terminüberweisung',
      bankOrders: 'den Abruf deiner Aufträge',
      orderDelete: 'das Löschen des Auftrags',
      orderChange: 'die Änderung des Auftrags',
    } as Record<OrderWait, string>,
    /** `account`: the user's own name for it first. */
    listOf: (kind: Kind, account: string) =>
      `den Abruf der ${kind === 'standing' ? 'Daueraufträge' : 'Terminüberweisungen'} von ${account}`,
    afterConfirm: {
      standingOrder: 'Der Dauerauftrag ist freigegeben.',
      datedTransfer: 'Die Terminüberweisung ist freigegeben.',
      bankOrders: 'Die Aufträge werden abgerufen …',
      orderDelete: 'Das Löschen ist freigegeben.',
      orderChange: 'Die Änderung ist freigegeben.',
    } as Record<OrderWait, string>,
    refused: {
      standingOrder: { title: 'Dauerauftrag nicht eingerichtet', text: 'Deine Bank hat den Auftrag abgelehnt:' },
      datedTransfer: { title: 'Terminüberweisung nicht angelegt', text: 'Deine Bank hat den Auftrag abgelehnt:' },
      bankOrders: { title: 'Aufträge nicht abgerufen', text: 'Deine Bank hat den Abruf abgelehnt:' },
      orderDelete: { title: 'Auftrag nicht gelöscht', text: 'Deine Bank hat das Löschen abgelehnt:' },
      orderChange: { title: 'Auftrag nicht geändert', text: 'Deine Bank hat die Änderung abgelehnt:' },
    } as Record<OrderWait, { title: string; text: string }>,
    /** "Freigabe abbrechen?" while one of these is waited for: what stays open. */
    abort: {
      standingOrder: 'Der Dauerauftrag ist vielleicht schon angelegt. Brichst du jetzt ab, bleibt sein Status unklar – '
        + 'sieh bei den Aufträgen deiner Bank nach, bevor du ihn noch einmal anlegst.',
      datedTransfer: 'Die Terminüberweisung ist vielleicht schon angelegt. Brichst du jetzt ab, bleibt ihr Status unklar – '
        + 'sieh bei den Aufträgen deiner Bank nach, bevor du sie noch einmal anlegst.',
      orderDelete: 'Der Auftrag ist vielleicht schon gelöscht. Brichst du jetzt ab, bleibt das unklar – '
        + 'ruf die Liste neu ab, bevor du ihn noch einmal löschst.',
      orderChange: 'Der Auftrag ist vielleicht schon geändert. Brichst du jetzt ab, bleibt das unklar – '
        + 'ruf die Liste neu ab, bevor du ihn noch einmal änderst.',
    } as Record<Exclude<OrderWait, 'bankOrders'>, string>,
  },

  /** The bank's Bestand, under Verträge & Abos (components/BankOrders.tsx). */
  list: {
    title: 'Daueraufträge und Terminüberweisungen',
    /** The tile's subtitle: whose orders, and that they are the bank's. */
    atBank: 'Bei deiner Bank',
    account: 'Konto',
    load: 'Aufträge abrufen',
    reload: 'Aktualisieren',
    /** Beside "Aufträge abrufen". */
    mayNeedApproval: 'Kann eine Freigabe erfordern.',
    loading: 'Aufträge werden abgerufen …',
    none: { standing: 'Keine Daueraufträge bei deiner Bank.', dated: 'Keine Terminüberweisungen bei deiner Bank.' } as Record<Kind, string>,
    notLoaded: { standing: 'Daueraufträge noch nicht abgerufen.', dated: 'Terminüberweisungen noch nicht abgerufen.' } as Record<Kind, string>,
    /** A Dauerauftrag's next execution, after its rhythm. */
    next: (date: string) => `nächste am ${date}`,
    /** A terminierte Überweisung's date. */
    on: (date: string) => `am ${date}`,
    until: (date: string) => `bis ${date}`,
    ended: 'keine weitere Ausführung',
    /** The bank's answer said nothing the app could read about when it runs. */
    noSchedule: 'Termin nicht lesbar',
    more: (n: number) => (n === 1 ? 'und eine weitere Zahlung' : `und ${n} weitere Zahlungen`),
    incomplete: 'Deine Bank hat nicht alle Aufträge geliefert – die Liste ist unvollständig.',
    unreadable: (n: number) => (n === 1
      ? 'Einen Auftrag konnte die App nicht lesen; er fehlt in der Liste.'
      : `${n} Aufträge konnte die App nicht lesen; sie fehlen in der Liste.`),
    /** `time`: when the list was read. */
    asOf: (time: string) => `Stand ${time}`,
    change: 'Ändern geht hier nicht: Lösche den Auftrag und lege ihn neu an.',
    remove: 'Löschen …',
    /** The delete button's full name, for a screen reader. */
    removeLabel: (kind: Kind, name: string) => `${kind === 'standing' ? 'Dauerauftrag' : 'Terminüberweisung'} an ${name} löschen …`,
    deleted: 'Gelöscht',
    deletedToast: (kind: Kind, name: string) =>
      `${kind === 'standing' ? 'Dauerauftrag' : 'Terminüberweisung'} an ${name} gelöscht.`,
    /** A deletion whose outcome the bank did not confirm. */
    deleteUnclear: 'Ob deine Bank den Auftrag gelöscht hat, ist unklar. Lösche ihn nicht noch einmal, bevor du nachgesehen hast: „Aktualisieren“ ruft die Liste neu ab.',
    failed: (reason: string) => `Abruf fehlgeschlagen: ${reason}`,
    /** The phone's Übersicht has no room for it: one link. */
    noAccount: 'Kein Konto bietet Daueraufträge oder Terminüberweisungen über FinTS an.',
  },

  /** Changing one (components/transfer/ChangeOrder.tsx): amount, purpose, date or rhythm — never the payee. */
  change: {
    button: 'Ändern …',
    buttonLabel: (kind: Kind, name: string) => `${kind === 'standing' ? 'Dauerauftrag' : 'Terminüberweisung'} an ${name} ändern …`,
    title: { standing: 'Dauerauftrag ändern', dated: 'Terminüberweisung ändern' } as Record<Kind, string>,
    intro: 'Betrag, Verwendungszweck und Termin lassen sich ändern. Der Empfänger bleibt – für einen anderen legst du einen neuen Auftrag an.',
    payee: 'Empfänger',
    amount: 'Betrag',
    purpose: 'Verwendungszweck',
    purposeTooLong: (max: number) => `Der Verwendungszweck ist zu lang – höchstens ${max} Zeichen.`,
    /** A Dauerauftrag's change applies from a run on, not to those already made. */
    from: (date: string) => `Die Änderung gilt ab der Ausführung am ${date}.`,
    unchanged: 'Du hast noch nichts geändert.',
    send: 'Änderung senden',
    approval: 'Danach bittet dich deine Bank um die Freigabe.',
    done: { standing: 'Dauerauftrag geändert', dated: 'Terminüberweisung geändert' } as Record<Kind, string>,
    doneText: 'Deine Bank hat die Änderung angenommen. „Aktualisieren“ zeigt den Auftrag, wie sie ihn jetzt führt.',
    refused: 'Deine Bank hat die Änderung abgelehnt:',
    refusedPlain: 'Deine Bank hat die Änderung abgelehnt.',
    unclearText: 'Ob deine Bank die Änderung angenommen hat, ist unklar. Ändere den Auftrag nicht noch einmal, bevor du nachgesehen hast: „Aktualisieren“ ruft die Liste neu ab.',
    vopIntro: 'Deine Bank hat den Namen des Empfängers geprüft. Sende die Änderung nur, wenn du sicher bist, dass er stimmt.',
    vopSend: 'Trotzdem senden',
    vopStop: 'Nicht senden',
    changed: 'Geändert',
  },

  /** Deleting one (components/BankOrders.tsx). */
  remove: {
    title: { standing: 'Dauerauftrag löschen?', dated: 'Terminüberweisung löschen?' } as Record<Kind, string>,
    body: {
      standing: 'Deine Bank löscht den Dauerauftrag. Zahlungen, die schon ausgeführt wurden, bleiben, wie sie sind.',
      dated: 'Deine Bank löscht die Terminüberweisung – sie wird dann nicht ausgeführt.',
    } as Record<Kind, string>,
    approval: 'Danach bittet dich deine Bank um die Freigabe.',
    keep: 'Behalten',
    confirm: { standing: 'Dauerauftrag löschen', dated: 'Terminüberweisung löschen' } as Record<Kind, string>,
    refused: 'Deine Bank hat das Löschen abgelehnt:',
    refusedPlain: 'Deine Bank hat das Löschen abgelehnt.',
  },

  /** What an earlier order says about this one (lib/transfer-checks.ts). Amounts and dates arrive formatted. */
  duplicate: {
    /** `when`: "Heute um 9:05 Uhr" (transfer.duplicate.todayAt / dayAt). */
    placedStanding: (when: string, money: string, who: string) =>
      `${when} hast du bereits einen Dauerauftrag über ${money} an ${who} eingerichtet.`,
    placedStandingUnclear: (when: string, money: string, who: string) =>
      `${when} hast du bereits einen Dauerauftrag über ${money} an ${who} gesendet – sein Status ist unklar.`,
    placedDated: (when: string, money: string, who: string, due: string) =>
      `${when} hast du bereits eine Terminüberweisung über ${money} an ${who} zum ${due} angelegt.`,
    placedDatedUnclear: (when: string, money: string, who: string, due: string) =>
      `${when} hast du bereits eine Terminüberweisung über ${money} an ${who} zum ${due} gesendet – ihr Status ist unklar.`,
    /** Found in the list the bank sent. `rhythm`: "monatlich am 1.", or null when unreadable. */
    bankStanding: (money: string, who: string, rhythm: string | null) =>
      `Bei deiner Bank besteht schon ein Dauerauftrag über ${money} an ${who}${rhythm ? ` (${rhythm})` : ''}.`,
    bankDated: (money: string, who: string, date: string | null) =>
      `Bei deiner Bank liegt schon eine Terminüberweisung über ${money} an ${who}${date ? ` zum ${date}` : ''}.`,
    title: { standing: 'Schon eingerichtet?', dated: 'Schon angelegt?' } as Record<Kind, string>,
  },

  /** "Vorgänge dieser Sitzung" (components/Inbox.tsx). */
  activity: {
    /** `date`: the execution date, formatted. */
    dated: (date: string) => `Terminüberweisung zum ${date}`,
    standing: 'Dauerauftrag',
    /** `place`: where the bank's list lives ("Verträge & Abos"). */
    unclear: (place: string) =>
      `Bevor du den Auftrag noch einmal anlegst: Sieh unter „${place}“ nach, ob deine Bank ihn schon führt.`,
  },

  /** The command palette's entry (components/CommandPalette.tsx). */
  palette: {
    label: 'Daueraufträge und Terminüberweisungen',
    description: 'Bei deiner Bank, unter Zahlungen',
    words: ['dauerauftrag', 'daueraufträge', 'terminüberweisung', 'termin', 'regelmäßig', 'bestand', 'standing order', 'scheduled'],
  },

  /** The answers of /api/transfer and /api/bank-orders(/delete). */
  route: {
    unsupported: (kind: Kind) =>
      `Dieses Konto unterstützt keine ${kind === 'standing' ? 'Daueraufträge' : 'Terminüberweisungen'} über FinTS.`,
    scheduleInvalid: 'Der Termin ist ungültig.',
    /** `reason`: the form's own sentence for what is wrong. */
    scheduleRefused: (reason: string) => `Der Termin passt nicht zu den Regeln deiner Bank: ${reason}`,
    noInstant: 'Eine Echtzeitüberweisung kann nicht terminiert werden.',
    unknownOrder: 'Diesen Auftrag kennt die App nicht mehr. Bitte ruf die Liste neu ab.',
    listFailed: 'Deine Bank hat die Liste nicht geliefert.',
    /** A change the bank or the account does not offer for this order. */
    cannotChange: (kind: Kind) => `${kind === 'standing' ? 'Diesen Dauerauftrag' : 'Diese Terminüberweisung'} kannst du hier nicht ändern.`,
    /** A change may keep the payee only: another payee is another order. */
    changePayee: 'Der Empfänger lässt sich nicht ändern – lege dafür einen neuen Auftrag an.',
  },
};

export const en: typeof de = {
  kind: { standing: 'Standing order', dated: 'Scheduled transfer' },
  kinds: { standing: 'Standing orders', dated: 'Scheduled transfers' },

  schedule: {
    rhythm: (unit, n) => {
      if (unit === 'W') return n === 1 ? 'weekly' : n === 2 ? 'every two weeks' : `every ${n} weeks`;
      return n === 1 ? 'monthly'
        : n === 3 ? 'quarterly'
          : n === 6 ? 'every six months'
            : n === 12 ? 'yearly'
              : `every ${n} months`;
    },
    onMonthDay: (day) => (day === 99 ? 'on the last day of the month'
      : day === 98 ? 'on the second-to-last day of the month'
        : day === 97 ? 'on the third-to-last day of the month'
          : `on the ${enOrdinal(day)}`),
    monthDayOption: (day) => (day === 99 ? 'Last day of the month'
      : day === 98 ? 'Second-to-last day'
        : day === 97 ? 'Third-to-last day'
          : enOrdinal(day)),
    onWeekday: (name) => `on ${name}`,
    dated: (date) => `Carried out on ${date}`,
    standing: (first, rhythm, day, last) =>
      `First on ${first}, then ${rhythm} ${day} – ${last ? `until ${last}` : 'until further notice'}`,
    rhythmLine: (rhythm, day) => `${rhythm} ${day}`,
  },

  form: {
    when: 'When',
    now: 'Now',
    dated: 'On a date',
    standing: 'Regularly',
    date: 'Execution date',
    window: (from, to) => `From ${from} at the earliest, ${to} at the latest.`,
    notBankDay: 'That is not a banking day – your bank will carry out the order on the next one.',
    rhythm: 'Frequency',
    day: 'Execution day',
    first: 'First payment',
    last: 'Last payment',
    lastHint: 'Leave empty: until further notice.',
    noInstant: 'Instant transfers are only possible when the transfer is carried out now.',
    defaults: 'The app does not have your bank’s rules for this – so the choice is limited to the usual options.',
    problems: {
      dateMissing: 'Please choose the date.',
      tooEarly: (from) => `${from} at the earliest – your bank needs that much notice.`,
      tooLate: (to) => `${to} at the latest – your bank does not accept orders further ahead.`,
      rhythmNotAllowed: 'Your bank does not offer this frequency.',
      dayNotAllowed: 'Your bank does not carry out standing orders on this day.',
      firstNotOnDay: (day) => `The first payment has to fall on the execution day (${day}).`,
      lastBeforeFirst: 'The last payment cannot be before the first.',
      lastInvalid: 'Please enter a valid date – or leave the field empty.',
    },
  },

  sheet: {
    titles: {
      standing: {
        review: 'Review standing order',
        done: 'Standing order set up',
        refused: 'Standing order not set up',
      },
      dated: {
        review: 'Review scheduled transfer',
        done: 'Scheduled transfer created',
        refused: 'Scheduled transfer not created',
      },
    },
    send: { standing: 'Set up standing order', dated: 'Schedule transfer' },
    sendAnyway: { standing: 'Set up anyway', dated: 'Schedule anyway' },
    sendUnchecked: { standing: 'Set up without name check', dated: 'Schedule without name check' },
    sendNoResult: { standing: 'Set up without check result', dated: 'Schedule without check result' },
    approve: { standing: 'Approve standing order', dated: 'Approve scheduled transfer' },
    noFunds: 'Whether the account has enough money is checked by your bank on the day of execution.',
    done: {
      where: (place) => `You will find the order under “${place}” once you fetch your bank’s orders.`,
    },
    showOrders: 'View orders',
    unknown: {
      noConfirmation: {
        standing: 'There is no confirmation for this standing order. Your bank may still have set it up.',
        dated: 'There is no confirmation for this scheduled transfer. Your bank may still have created it.',
      },
      beforeResend: {
        standing: (action) => 'Before you set it up again: check whether your bank already has it – '
          + `“${action}” fetches your standing orders, which may require approval.`,
        dated: (action) => 'Before you schedule it again: check whether your bank already has it – '
          + `“${action}” fetches your scheduled transfers, which may require approval.`,
      },
      loading: { standing: 'Fetching standing orders…', dated: 'Fetching scheduled transfers…' },
      found: 'Found at your bank',
      foundText: (amount, name, when) => [amount, ` to ${name} – ${when}. Do not set up the order again.`],
      notVisible: 'Not visible yet – please do not set it up again',
      notChecked: 'Could not check – please do not set it up again',
      notYet: (list, time) => [
        `The order does not appear in your ${list} at the bank yet (as of `,
        time,
        '). Check again later or look in your bank’s online banking.',
      ],
      listDative: { standing: 'standing orders', dated: 'scheduled transfers' },
      failed: 'Could not load the orders.',
      tryAgain: 'Try again in a moment or check in your bank’s online banking.',
      nothingToRead: 'Your bank does not provide this account’s orders to the app. Check in your bank’s online banking.',
    },
  },

  wait: {
    title: {
      standingOrder: 'Approve standing order',
      datedTransfer: 'Approve scheduled transfer',
      bankOrders: 'Approve retrieval',
      orderDelete: 'Approve deletion',
      orderChange: 'Approve change',
    },
    subject: {
      standingOrder: 'the standing order',
      datedTransfer: 'the scheduled transfer',
      bankOrders: 'the request for your orders',
      orderDelete: 'the deletion of the order',
      orderChange: 'the change of the order',
    },
    listOf: (kind, account) =>
      `the request for the ${kind === 'standing' ? 'standing orders' : 'scheduled transfers'} of ${account}`,
    afterConfirm: {
      standingOrder: 'The standing order is approved.',
      datedTransfer: 'The scheduled transfer is approved.',
      bankOrders: 'Fetching the orders…',
      orderDelete: 'The deletion is approved.',
      orderChange: 'The change is approved.',
    },
    refused: {
      standingOrder: { title: 'Standing order not set up', text: 'Your bank declined the order:' },
      datedTransfer: { title: 'Scheduled transfer not created', text: 'Your bank declined the order:' },
      bankOrders: { title: 'Orders not fetched', text: 'Your bank declined the retrieval:' },
      orderDelete: { title: 'Order not deleted', text: 'Your bank declined the deletion:' },
      orderChange: { title: 'Order not changed', text: 'Your bank declined the change:' },
    },
    abort: {
      standingOrder: 'The standing order may already have been set up. If you cancel now, its status stays unclear – '
        + 'check your bank’s orders before you set it up again.',
      datedTransfer: 'The scheduled transfer may already have been created. If you cancel now, its status stays unclear – '
        + 'check your bank’s orders before you schedule it again.',
      orderDelete: 'The order may already have been deleted. If you cancel now, that stays unclear – '
        + 'fetch the list again before you delete it again.',
      orderChange: 'The order may already have been changed. If you cancel now, that stays unclear – '
        + 'fetch the list again before you change it again.',
    },
  },

  list: {
    title: 'Standing orders and scheduled transfers',
    atBank: 'At your bank',
    account: 'Account',
    load: 'Fetch orders',
    reload: 'Refresh',
    mayNeedApproval: 'May need approval.',
    loading: 'Fetching orders…',
    none: { standing: 'No standing orders at your bank.', dated: 'No scheduled transfers at your bank.' },
    notLoaded: { standing: 'Standing orders not fetched yet.', dated: 'Scheduled transfers not fetched yet.' },
    next: (date) => `next on ${date}`,
    on: (date) => `on ${date}`,
    until: (date) => `until ${date}`,
    ended: 'no further payment',
    noSchedule: 'Date not readable',
    more: (n) => (n === 1 ? 'and one more payment' : `and ${n} more payments`),
    incomplete: 'Your bank did not deliver all orders – the list is incomplete.',
    unreadable: (n) => (n === 1
      ? 'The app could not read one order; it is missing from the list.'
      : `The app could not read ${n} orders; they are missing from the list.`),
    asOf: (time) => `As of ${time}`,
    change: 'Changing an order is not possible here: delete it and create it again.',
    remove: 'Delete…',
    removeLabel: (kind, name) => `Delete ${kind === 'standing' ? 'standing order' : 'scheduled transfer'} to ${name}…`,
    deleted: 'Deleted',
    deletedToast: (kind, name) => `${kind === 'standing' ? 'Standing order' : 'Scheduled transfer'} to ${name} deleted.`,
    deleteUnclear: 'It is unclear whether your bank deleted the order. Do not delete it again before you have checked: “Refresh” fetches the list again.',
    failed: (reason) => `Could not load: ${reason}`,
    noAccount: 'No account offers standing orders or scheduled transfers over FinTS.',
  },

  change: {
    button: 'Change …',
    buttonLabel: (kind, name) => `Change ${kind === 'standing' ? 'standing order' : 'scheduled transfer'} to ${name} …`,
    title: { standing: 'Change standing order', dated: 'Change scheduled transfer' },
    intro: 'The amount, the purpose and the date can be changed. The payee stays – for another one, set up a new order.',
    payee: 'Payee',
    amount: 'Amount',
    purpose: 'Purpose',
    purposeTooLong: (max) => `The purpose is too long – at most ${max} characters.`,
    from: (date) => `The change applies from the payment on ${date}.`,
    unchanged: 'You have not changed anything yet.',
    send: 'Send change',
    approval: 'Your bank then asks you to approve it.',
    done: { standing: 'Standing order changed', dated: 'Scheduled transfer changed' },
    doneText: 'Your bank accepted the change. “Refresh” shows the order as the bank now keeps it.',
    refused: 'Your bank refused the change:',
    refusedPlain: 'Your bank refused the change.',
    unclearText: 'Whether your bank accepted the change is unclear. Do not change the order again before you have checked: “Refresh” fetches the list again.',
    vopIntro: 'Your bank checked the payee’s name. Only send the change if you are sure the name is right.',
    vopSend: 'Send anyway',
    vopStop: 'Do not send',
    changed: 'Changed',
  },

  remove: {
    title: { standing: 'Delete standing order?', dated: 'Delete scheduled transfer?' },
    body: {
      standing: 'Your bank deletes the standing order. Payments already made stay as they are.',
      dated: 'Your bank deletes the scheduled transfer – it will not be carried out.',
    },
    approval: 'Your bank will then ask for your approval.',
    keep: 'Keep',
    confirm: { standing: 'Delete standing order', dated: 'Delete scheduled transfer' },
    refused: 'Your bank declined the deletion:',
    refusedPlain: 'Your bank declined the deletion.',
  },

  duplicate: {
    placedStanding: (when, money, who) => `You already set up a standing order of ${money} to ${who} ${when}.`,
    placedStandingUnclear: (when, money, who) =>
      `You already sent a standing order of ${money} to ${who} ${when} – its status is unclear.`,
    placedDated: (when, money, who, due) => `You already scheduled a transfer of ${money} to ${who} for ${due} ${when}.`,
    placedDatedUnclear: (when, money, who, due) =>
      `You already sent a scheduled transfer of ${money} to ${who} for ${due} ${when} – its status is unclear.`,
    bankStanding: (money, who, rhythm) => `Your bank already holds a standing order of ${money} to ${who}${rhythm ? ` (${rhythm})` : ''}.`,
    bankDated: (money, who, date) => `Your bank already holds a scheduled transfer of ${money} to ${who}${date ? ` for ${date}` : ''}.`,
    title: { standing: 'Already set up?', dated: 'Already scheduled?' },
  },

  activity: {
    dated: (date) => `Scheduled transfer for ${date}`,
    standing: 'Standing order',
    unclear: (place) => `Before you set up the order again: check under “${place}” whether your bank already has it.`,
  },

  palette: {
    label: 'Standing orders and scheduled transfers',
    description: 'At your bank, under Payments',
    words: ['standing order', 'standing orders', 'scheduled', 'scheduled transfer', 'recurring', 'regular'],
  },

  route: {
    unsupported: (kind) =>
      `This account does not support ${kind === 'standing' ? 'standing orders' : 'scheduled transfers'} over FinTS.`,
    scheduleInvalid: 'The date is invalid.',
    scheduleRefused: (reason) => `The date does not fit your bank’s rules: ${reason}`,
    noInstant: 'An instant transfer cannot be scheduled.',
    unknownOrder: 'The app no longer knows this order. Please fetch the list again.',
    listFailed: 'Your bank did not deliver the list.',
    cannotChange: (kind) => `You cannot change this ${kind === 'standing' ? 'standing order' : 'scheduled transfer'} here.`,
    changePayee: 'The payee cannot be changed – set up a new order for that.',
  },
};
