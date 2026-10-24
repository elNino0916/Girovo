// Aufteilen: a booking's amount shared between the user and others, each of
// whom is asked for their part with Geld anfordern (components/ShareAccount).
//
// Counted in cents. An equal split gives every share the same cents; what
// does not divide evenly falls to the user, who paid the whole and so never
// asks anyone for a cent more than their part. Shares the user typed are kept
// as typed; the user's own share is what is left, and a split whose shares
// ask for more than the booking is refused.

export type SplitPerson = {
  /** Stable within the sheet, for React keys and edits. */
  id: string;
  /** What the request is addressed to; may be empty while being typed. */
  name: string;
  /** This person's share in cents. */
  cents: number;
  /** Typed by the user (kept when the split is redone), or worked out. */
  typed: boolean;
};

export type Split = {
  /** The user's own share in cents: the booking less everyone else's. */
  own: number;
  others: SplitPerson[];
  /** The others ask for more than the booking: no requests until fixed. */
  over: boolean;
};

/** Equal shares of `total` cents among the user and `others`; the remainder stays with the user. */
export function equalSplit(total: number, others: readonly Omit<SplitPerson, 'cents' | 'typed'>[]): Split {
  const cents = Math.abs(Math.round(total));
  const n = others.length + 1;
  const each = Math.floor(cents / n);
  const people = others.map((p) => ({ ...p, cents: each, typed: false }));
  return { own: cents - each * others.length, others: people, over: false };
}

/**
 * The split after the user typed some shares: typed ones stay, the rest
 * share what is left equally with the user (the remainder again the user's).
 */
export function resplit(total: number, others: readonly SplitPerson[]): Split {
  const cents = Math.abs(Math.round(total));
  const typedSum = others.filter((p) => p.typed).reduce((s, p) => s + Math.max(0, p.cents), 0);
  const open = others.filter((p) => !p.typed);
  const left = cents - typedSum;
  if (left < 0) return { own: left, others: others.map((p) => (p.typed ? p : { ...p, cents: 0 })), over: true };
  const each = Math.floor(left / (open.length + 1));
  const people = others.map((p) => (p.typed ? p : { ...p, cents: each }));
  return { own: left - each * open.length, others: people, over: false };
}

/** Whether the split can be asked for: nobody over, and everyone asked has a name and a share. */
export function canRequest(split: Split): boolean {
  return !split.over && split.others.length > 0 && split.others.every((p) => p.cents > 0 && p.name.trim().length > 0);
}
