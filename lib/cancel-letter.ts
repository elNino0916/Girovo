// Girovo Next, Verträge & Abos: a cancellation letter (Kündigungsschreiben)
// for a contract, to take away as text, as a PDF or as an e-mail the user
// sends themselves. Girovo never sends it.
//
// The letter is the user's, read by the provider: formal, standard form, in
// the interface language (lib/i18n/messages/insights.ts contracts.letter.text).
// What Girovo does not know (the sender's address, the provider's address,
// the customer number, the town) is left as a line to fill in, marked so on
// every way out: "[Straße und Hausnummer]" in the text, a blank line on paper.
//
//   sender      the account holder's name, then the address lines to fill in
//   recipient   the contract's name (the payee), then its address to fill in
//   date        "[Ort], 14. November 2026"
//   subject     "Kündigung meines Vertrags mit Netflix", and the customer number
//   body        cancelled "fristgerecht zum nächstmöglichen Zeitpunkt", "zum <Tag>"
//               as well where the end is known; a written confirmation asked
//               for (the Kündbar-bis day named where the user set one); the
//               debits stopped and the SEPA mandate revoked from the end, with
//               the Gläubiger-ID and Mandatsreferenz the bookings carry
//   closing     greeting, the line to sign on, the name
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import { MESSAGES } from './i18n/messages/index.ts';
import { activeLocale, INTL_LOCALES, type Locale } from './i18n/locale.ts';

/** A piece of a line: text as written, or a gap to fill in with what goes there. */
export type LetterPiece = string | { fill: string };
export type LetterLine = LetterPiece[];

export type LetterInput = {
  /** The account holder, presentable ("Nino Bornemann"); empty leaves a line to fill in. */
  holder: string;
  /** The contract's name as Verträge & Abos shows it: the provider the letter goes to. */
  contract: string;
  /** yyyy-mm-dd the letter is dated. */
  today: string;
  /** yyyy-mm-dd the contract ends, when the user knows it: "zum <Tag>, hilfsweise zum nächstmöglichen Zeitpunkt". */
  endDay?: string | null;
  /** yyyy-mm-dd the cancellation must have arrived by (the reminder's "Kündbar bis"). */
  noticeBy?: string | null;
  /** The bookings' Gläubiger-ID and Mandatsreferenz. */
  creditorId?: string | null;
  mandateReference?: string | null;
  /** Collected by SEPA direct debit: the mandate is revoked too. */
  directDebit?: boolean;
  /** The customer or contract number, as typed; empty leaves a line to fill in. */
  customerNumber?: string | null;
};

export type CancelLetter = {
  sender: LetterLine[];
  recipient: LetterLine[];
  date: LetterLine;
  subject: string;
  reference: LetterLine;
  salutation: string;
  paragraphs: string[];
  closing: string;
  signer: LetterLine;
  /** The whole letter as plain text, gaps as "[…]". */
  text: string;
  /** The same as an e-mail: no address blocks, the number first. */
  mail: { subject: string; body: string };
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day as a letter writes it: "14. November 2026", "14 November 2026"; null for no real day. */
export function letterDay(day: string | null | undefined, locale: Locale): string | null {
  const m = DAY.exec(day ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** A typed value on one line: no control characters, spaces folded, at most `max` long. */
const oneLine = (s: string | null | undefined, max: number) =>
  String(s ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A line as text: a gap as "[Straße und Hausnummer]". */
export const lineText = (line: LetterLine): string => line.map((p) => (typeof p === 'string' ? p : `[${p.fill}]`)).join('');

/** The letter for a contract, in `locale` (the interface's language unless given). */
export function cancelLetter(input: LetterInput, locale: Locale = activeLocale()): CancelLetter {
  const w = MESSAGES[locale].insights.contracts.letter.text;
  const holder = oneLine(input.holder, 120);
  const contract = oneLine(input.contract, 120) || w.provider;
  const number = oneLine(input.customerNumber, 60);
  const today = letterDay(input.today, locale) ?? input.today;
  const end = letterDay(input.endDay, locale);
  const noticeBy = letterDay(input.noticeBy, locale);
  const creditorId = oneLine(input.creditorId, 40);
  const mandate = oneLine(input.mandateReference, 40);

  const name: LetterLine = holder ? [holder] : [{ fill: w.nameFill }];
  const sender: LetterLine[] = [name, [{ fill: w.streetFill }], [{ fill: w.cityFill }]];
  const recipient: LetterLine[] = [[contract], [{ fill: w.addressFill }]];
  const date: LetterLine = [{ fill: w.placeFill }, `, ${today}`];
  const subject = w.subject(contract);
  const reference: LetterLine = [w.numberLabel, number || { fill: w.numberFill }];

  const debit = [w.stop];
  if (input.directDebit || creditorId || mandate) {
    const ids = [creditorId && w.creditorId(creditorId), mandate && w.mandateRef(mandate)].filter(Boolean).join(', ');
    debit.push(ids ? w.mandateIds(ids) : w.mandate);
  }
  const paragraphs = [
    end ? w.cancelOn(end) : w.cancel,
    noticeBy ? w.confirmBy(noticeBy) : w.confirm,
    debit.join(' '),
  ];

  const blocks = [
    sender.map(lineText).join('\n'),
    recipient.map(lineText).join('\n'),
    lineText(date),
    [subject, lineText(reference)].join('\n'),
    w.salutation,
    ...paragraphs,
    // Room to sign between the greeting and the name.
    `${w.closing}\n\n\n${lineText(name)}`,
  ];
  const mailBody = [
    lineText(reference),
    w.salutation,
    ...paragraphs,
    `${w.closing}\n${lineText(name)}\n${sender.slice(1).map(lineText).join('\n')}`,
  ].join('\n\n');

  return {
    sender,
    recipient,
    date,
    subject,
    reference,
    salutation: w.salutation,
    paragraphs,
    closing: w.closing,
    signer: name,
    text: `${blocks.join('\n\n')}\n`,
    mail: { subject: number ? w.mailSubject(subject, number) : subject, body: mailBody },
  };
}

/**
 * The letter as an e-mail for the user's own mail program: subject and body,
 * lines ending in CRLF as mailto wants them. `to` only where the address is
 * known; otherwise the user fills it in there.
 */
export function letterMailto(letter: CancelLetter, to = ''): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
  return `mailto:${encodeURIComponent(to)}?subject=${enc(letter.mail.subject)}&body=${enc(letter.mail.body)}`;
}

/** The file name the PDF is offered under: "Kuendigung_Netflix.pdf". */
export function letterFileName(contract: string, locale: Locale = activeLocale()): string {
  const base = MESSAGES[locale].insights.contracts.letter.file;
  const name = contract.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${base}${name ? `_${name}` : ''}.pdf`;
}
