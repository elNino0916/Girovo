// Sparziele: one goal per savings account — a name, a target and, if the
// user gives one, the month it should be reached by. Kept in the vault with
// the user's other own data (sealed with the PIN); progress is the account's
// balance as the bank reported it, never a figure the app makes up.
//
// "Pro Monat" is what is still missing spread over the months left,
// counting the current one when the date is still ahead: on 24 October with a
// goal for June, October … June are nine months. A goal whose month has
// passed, or that is reached, asks for nothing more per month.

export type SavingsGoal = {
  accountNumber: string;
  name: string;
  /** In cents. */
  target: number;
  /** "2027-06": the month it should be reached by; optional. */
  by?: string;
  /** "2026-02": the month the goal was set, where its month plan starts. */
  since?: string;
};

export type GoalProgress = {
  /** 0…1, the balance's share of the target (never above 1, never below 0). */
  share: number;
  /** In cents; 0 once reached. */
  missing: number;
  reached: boolean;
  /** Months left including the current one; null without a date. */
  monthsLeft: number | null;
  /** Cents per month to reach it in time; null without a date, 0 when reached or due. */
  perMonth: number | null;
};

const MONTH = /^(\d{4})-(\d{2})$/;

/** "2026-10": `d`'s month. */
export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * The month plan of a goal with a date (the Übersicht's strip, owner's pick
 * "Monatsplan", 2026-10-24): how many months it runs, from the month it was
 * set to its date, and which of them is this one. Null without a date.
 */
export function monthPlan(goal: SavingsGoal, today: Date = new Date()): { months: number; current: number } | null {
  if (!goal.by || !MONTH.test(goal.by)) return null;
  const start = goal.since && MONTH.test(goal.since) && goal.since <= goal.by ? goal.since : monthKey(today);
  const span = (from: string, to: string) => {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm) + 1;
  };
  const months = Math.max(1, span(start, goal.by));
  const current = Math.min(months, Math.max(1, span(start, monthKey(today))));
  return { months, current };
}

/** Months from `today`'s month to `by`, both counted; 0 once `by` has passed. */
export function monthsUntil(by: string, today: Date): number {
  const m = MONTH.exec(by);
  if (!m) return 0;
  const diff = (Number(m[1]) - today.getFullYear()) * 12 + (Number(m[2]) - 1 - today.getMonth());
  return diff < 0 ? 0 : diff + 1;
}

export function goalProgress(goal: SavingsGoal, balanceCents: number, today: Date = new Date()): GoalProgress {
  const target = Math.max(1, Math.round(goal.target));
  const have = Math.max(0, Math.round(balanceCents));
  const missing = Math.max(0, target - have);
  const reached = missing === 0;
  const monthsLeft = goal.by ? monthsUntil(goal.by, today) : null;
  const perMonth = monthsLeft == null ? null : reached || monthsLeft === 0 ? 0 : Math.ceil(missing / monthsLeft);
  return { share: Math.min(1, have / target), missing, reached, monthsLeft, perMonth };
}

/** At most this many goals (one per account), names this long, targets this large (cents). */
export const GOAL_LIMITS = { count: 20, name: 40, target: 100_000_000_00 } as const;

/**
 * The goals as the vault may keep them: well formed, one per account (the
 * last one given wins), names trimmed to their limit, within the caps.
 * Whatever else an entry carries never reaches the file.
 */
export function sanitizeGoals(input: unknown): SavingsGoal[] {
  if (!Array.isArray(input)) return [];
  const byAccount = new Map<string, SavingsGoal>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Partial<SavingsGoal>;
    const goal: Partial<SavingsGoal> = {
      accountNumber: typeof g.accountNumber === 'string' ? g.accountNumber.slice(0, 40) : undefined,
      name: typeof g.name === 'string' ? g.name.trim().slice(0, GOAL_LIMITS.name) : undefined,
      target: typeof g.target === 'number' ? Math.round(g.target) : undefined,
      ...(g.by !== undefined ? { by: g.by } : {}),
      ...(typeof g.since === 'string' && MONTH.test(g.since) ? { since: g.since } : {}),
    };
    if (!validGoal(goal) || goal.target > GOAL_LIMITS.target) continue;
    byAccount.delete(goal.accountNumber);
    byAccount.set(goal.accountNumber, goal);
  }
  return [...byAccount.values()].slice(-GOAL_LIMITS.count);
}

/** A goal as stored: a name and a positive target in cents; the month, if any, well formed. */
export function validGoal(g: Partial<SavingsGoal>): g is SavingsGoal {
  return typeof g.accountNumber === 'string' && !!g.accountNumber
    && typeof g.name === 'string' && g.name.trim().length > 0
    && typeof g.target === 'number' && Number.isFinite(g.target) && g.target > 0
    && (g.by === undefined || MONTH.test(g.by));
}
