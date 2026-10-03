'use client';

import { fmtShortIban } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { AccountTypeIcon } from '../icons';
import { cx } from '../ui';

/**
 * How an account is told apart from its siblings, ready to show: a part that
 * may give way when room is short (`head`) and the part you actually
 * recognise it by (`tail`, never truncated, set heavier), plus what a screen
 * reader should hear instead of the glyphs.
 */
export type AccountIdent = {
  kind: 'iban' | 'card' | 'number';
  head: string;
  tail: string;
  spoken: string;
};

/** Groups of four from the left — the grid IBANs and card numbers are read on. */
const group4 = (s: string) => s.match(/.{1,4}/g) ?? [];

/**
 * The IBAN when the account has one. Otherwise whatever the bank reports as
 * the account number, which for a credit card is the masked card number
 * ("4930XXXXXXXX1234"): shown the way the card itself prints it, in groups of
 * four with the hidden digits as dots — "4930 •••• •••• 1234" — and the last
 * digits, the ones on the plastic, as the tail. A plain account number of
 * eight characters or more gets the same grid; its tail is the last group,
 * widened to at least four
 * characters so a lone "80" never stands for the whole account. For a
 * ten-digit Kontonummer that is exactly how its digits sit inside the IBAN
 * ("0105 5932 80"), so the two never look like different accounts.
 */
export function accountIdent(account: Pick<SerializedAccount, 'iban' | 'accountNumber'>): AccountIdent {
  if (account.iban) {
    const { head, tail } = fmtShortIban(account.iban);
    if (tail) return { kind: 'iban', head, tail, spoken: `IBAN endet auf ${tail}` };
  }

  const raw = String(account.accountNumber ?? '').replace(/\s+/g, '').toUpperCase();
  if (!raw) return { kind: 'number', head: '', tail: '', spoken: '' };

  // A masked card number: some leading digits (or none), the mask, the last digits.
  const card = /^(\d*)([X*•·]+)(\d+)$/.exec(raw);
  if (card) {
    const [, lead, mask, last] = card;
    return {
      kind: 'card',
      head: group4(lead + '•'.repeat(mask.length)).join(' '),
      tail: last,
      spoken: `Karte endet auf ${last}`,
    };
  }

  // Seven characters or fewer read fine as one word; "9876 5" would not.
  if (/^[0-9A-Z]+$/.test(raw) && raw.length >= 8) {
    const groups = group4(raw);
    let k = groups.length - 1;
    let chars = groups[k].length;
    while (chars < 4 && k > 0) chars += groups[--k].length;
    return {
      kind: 'number',
      head: groups.slice(0, k).join(' '),
      tail: groups.slice(k).join(' '),
      spoken: `Kontonummer ${groups.join(' ')}`,
    };
  }

  // Anything else (a short number, separators of the bank's own) is shown as
  // the bank sent it — all of it as the tail, so none of it is ever cut off.
  return { kind: 'number', head: '', tail: String(account.accountNumber).trim(), spoken: `Kontonummer ${raw}` };
}

/**
 * An account's identifier cut down to what you recognise your own account by:
 * "DE78 ···" and then the last six characters of the IBAN, grouped exactly as
 * in the full IBAN — or, for an account without one, its card or account
 * number grouped the same way (see accountIdent).
 *
 * Only the head may give way when the row gets narrow. The tail is the whole
 * point of the abbreviation — two of your accounts at the same bank differ
 * nowhere else — so it never truncates, and a screen reader hears it said
 * plainly instead of "D E 7 8 Punkt Punkt Punkt".
 */
export function ShortIban({ account, className }: { account: SerializedAccount; className?: string }) {
  const { head, tail, spoken } = accountIdent(account);
  if (!tail) return null;
  return (
    <span className={cx('flex min-w-0 items-baseline text-[13px] leading-snug text-ink-3', className)}>
      <span aria-hidden className="iban flex min-w-0">
        {head && <span className="min-w-0 truncate">{head}&nbsp;</span>}
        <span className="id-tail shrink-0">{tail}</span>
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/**
 * The account-type pictogram in its round plate. Not the bank's logo again:
 * every account here is at the same bank, so the logo would say nothing — the
 * kind of account (Giro, Tagesgeld, Kreditkarte …) is what tells rows apart.
 */
export function AccountGlyph({
  account, selected = false, size = 40, className,
}: { account: SerializedAccount; selected?: boolean; size?: 36 | 40 | 44; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full transition-colors duration-150',
        selected ? 'bg-accent text-accent-ink' : 'bg-accent-soft text-accent',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AccountTypeIcon type={account.accountType} product={account.product} size={size >= 44 ? 22 : 20} />
    </span>
  );
}
