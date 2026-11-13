// Girovo AI and the Monatsbudgets (lib/budgets.ts): questions about them and
// the figures they are answered from (components/insights/ask/FactAnswers.tsx
// says them, lib/ask-notes.ts brings up the one that runs out):
//
// - budgetLeft   "Wie viel darf ich diesen Monat noch für Essen ausgeben?",
//                "Was ist noch im Lebensmittel-Budget?": one category's budget,
//                spent so far this month, what is left, and per day for the
//                rest of the month; every budget when none is named
// - budgetsOver  "Wo bin ich über dem Budget?", "Welche Budgets reichen nicht?":
//                every budget over or nearly used up this month, worst first
//
// Spent is exactly what the Analyse's budget tile counts: the category's row
// of "Ausgaben nach Kategorie" for the month (lib/analytics.ts periodTotals),
// read against the loaded days (lib/budgets.ts monthCoverage, budgetLines).
// A question about the bookings ("Wie viel hab ich für Essen ausgegeben?")
// is none of these.
//
// Pure: no path aliases, `.ts` on sibling imports.

import { periodTotals, type CategoryOf } from './analytics.ts';
import { budgetLines, monthCoverage, type BudgetLine, type Budgets, type MonthCoverage } from './budgets.ts';
import type { BuiltinCategoryId, CategoryId } from './categories';
import type { SerializedTransaction } from './fints-types';
import { categoryFromQuestion } from './nano-ask.ts';

export type BudgetIntent =
  /**
   * category: the app's category the question names; name: the word that
   * names it otherwise ("essen", one of the user's own), folded; both null
   * for every budget.
   */
  | { kind: 'budgetLeft'; category: BuiltinCategoryId | null; name: string | null }
  | { kind: 'budgetsOver' };

/** A budget this far used up counts as nearly gone. */
export const BUDGET_NEAR = 0.9;
/** Before this day of the month, a budget nearly gone is worth a note. */
export const BUDGET_NOTE_BEFORE_DAY = 20;

const fold = (s: string) => ` ${s.toLocaleLowerCase('de').replace(/[?!.,;:„“"'()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

// i18n-data-start — the words people use, German and English
const BUDGET = /budget/;
const OVER = / (?:über|ueber|übers|überm|drüber|drueber|darüber|überschritten|ueberschritten|überzogen|ueberzogen|reicht nicht|reichen nicht|reicht\w* (?:\S+ ){0,2}nicht|knapp|fast (?:aufgebraucht|leer|weg|alle|ausgeschöpft|ausgeschoepft|durch)|aufgebraucht|ausgeschöpft|ausgeschoepft|over|exceeded|blown|running (?:low|out)|almost (?:gone|used up|out|spent)|used up|not enough) /;
const LEFT_ASK = / (?:noch|übrig|uebrig|rest|left|remaining|remain|wie ?viel|how much|was|what|stand|steht|stehe|status|wie|how|wo|where) /;
/** "Wie viel darf ich noch für Essen ausgeben?": what is left, without the word budget. */
const ALLOWANCE = / (?:darf|kann|könnte|koennte|sollte) ich (?:\S+ ){0,5}noch (?:\S+ ){0,5}ausgeben | (?:how much|what) (?:more )?(?:can|may|should) i (?:still )?spend | how much (?:do i have |have i got |is )?left (?:to spend )?(?:for|on) /;
/** Making, changing or removing a budget is another thing ("Leg ein Budget für Essen an", "Budget Lebensmittel 250 im Monat"). */
const CREATE = /^ (?:bitte |please )?(?:leg|lege|setz|setze|erstell\w*|richte?|mach|mache|neues?|änder\w*|aender\w*|erhöh\w*|erhoeh\w*|senk\w*|lösch\w*|loesch\w*|entfern\w*|create|set|add|make|new|change|raise|lower|delete|remove) | (?:anlegen|festlegen|einrichten|erstellen|setzen|hinzufügen|hinzufuegen|ändern|aendern|erhöhen|erhoehen|senken|löschen|loeschen|entfernen|set up|change|delete|remove) |\d/;
const QUESTION_START = /^ (?:wie|was|wo|welche\w*|wann|bin|ist|sind|how|what|where|which|am|is|are|do|does) /;
/** Words around a category's name that are no part of it. */
const FILLER = new Set((
  'monats monat gesamt mein meine meinem meinen meiner dem den das die der des im in ins am an fürs für fuer for on my the a this '
  + 'diesen diesem dieser monthly month noch ich wie viel was ist sind left over übrig uebrig is are how much what '
  + 'welche welcher welches welchen welchem which wo where bin am alle all any my über ueber drüber drueber stehen steht').split(' '));
/** "Essen" or "food" alone: the supermarket or eating out, whichever has a budget. */
const FOOD = /^(?:essen|food|nahrung|ernährung|ernaehrung)$/;
// i18n-data-end

/** The word a budget question names its category by: "lebensmittel" for "Lebensmittelbudget", "essen" for "für Essen". */
function budgetName(q: string): string | null {
  const ok = (w: string | undefined) => !!w && w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w);
  const compound = / (\S+?)-?budgets? /.exec(q);
  if (compound && ok(compound[1])) {
    const w = compound[1];
    // "Essensbudget": the name without the joining s.
    return w.length > 5 && w.endsWith('s') ? w.slice(0, -1) : w;
  }
  const after = / budgets? (?:für|fuer|fürs|for|on) (?:den |das |die |my |the )?(\S+)/.exec(q);
  if (after && ok(after[1])) return after[1];
  const before = / (\S+) budgets? /.exec(q);
  if (before && ok(before[1])) return before[1];
  const forWhat = / (?:für|fuer|fürs|for|on) (?:den |das |die |my |the )?(\S+)/.exec(q);
  if (forWhat && ok(forWhat[1]) && !/^(?:den|das|die|diesen|this|the|a)$/.test(forWhat[1])) return forWhat[1];
  return null;
}

/** What a question asks of the budgets; null for anything else. */
export function budgetIntentOf(question: string): BudgetIntent | null {
  const q = fold(question);
  const budget = BUDGET.test(q);
  if (!budget && !ALLOWANCE.test(q)) return null;
  if (CREATE.test(q) && !QUESTION_START.test(q)) return null;
  const category = categoryFromQuestion(question);
  // Income and Umbuchungen carry no budget: "Wie viel Gehalt ist noch übrig?" is no budget question.
  if (category === 'income' || category === 'transfer' || category === 'otherIn') return null;
  const name = category ? null : budgetName(q);
  if (!budget) return category || name ? { kind: 'budgetLeft', category, name } : null;
  if (!category && !name && OVER.test(q)) return { kind: 'budgetsOver' };
  if (category || name || LEFT_ASK.test(q) || OVER.test(q)) return { kind: 'budgetLeft', category, name };
  return null;
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');
function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

export type MonthBudgets = {
  /** yyyy-mm */
  month: string;
  coverage: MonthCoverage;
  /** The days of the month the figures cover. */
  from: string;
  to: string;
  /** Every budget against the month, as the tile lists them. */
  lines: BudgetLine[];
};

/**
 * Every budget against `month` (the running one by default) over the loaded
 * bookings `txs`, which cover `from`..`to`: the month's "Ausgaben nach
 * Kategorie", as the Analyse's budget tile counts them.
 */
export function monthBudgets(
  budgets: Budgets,
  txs: readonly SerializedTransaction[],
  opts: { categoryOf: CategoryOf; currency: string; from: string; to: string; today: string; month?: string },
): MonthBudgets {
  const month = opts.month ?? opts.today.slice(0, 7);
  const first = `${month}-01`;
  const last = lastDay(month);
  const from = opts.from > first ? opts.from : first;
  const to = opts.to < last ? opts.to : last;
  const noData = !opts.from || !opts.to || opts.from > last || opts.to < first;
  const coverage = monthCoverage({ month, from, to, noData }, opts.today);
  const spending = coverage === 'none' ? [] : periodTotals(txs, { categoryOf: opts.categoryOf, currency: opts.currency, from, to }).byCategory;
  return { month, coverage, from, to, lines: budgetLines(budgets, spending, coverage) };
}

/**
 * The budgets a question is about. `category` and `name` as the intent has
 * them; `own`: the user's own categories (their ids and names). `asked`:
 * the categories the question named (several for "Essen"), so a missing
 * budget can be said by its name; empty when it named none.
 */
export function budgetsAsked(
  lines: readonly BudgetLine[],
  category: CategoryId | null,
  name: string | null,
  own: readonly { id: string; name: string }[] = [],
): { lines: BudgetLine[]; asked: CategoryId[] } {
  let asked: CategoryId[] = [];
  if (category) asked = [category];
  else if (name) {
    const squash = (s: string) => s.toLocaleLowerCase('de').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
    const n = squash(name);
    const mine = own.filter((c) => {
      const o = squash(c.name);
      return !!o && n.length >= 3 && (o.includes(n) || (o.length >= 4 && n.includes(o)));
    });
    if (mine.length) asked = mine.map((c) => c.id as CategoryId);
    else if (FOOD.test(name)) asked = ['groceries', 'dining'];
    else {
      const builtin = categoryFromQuestion(name);
      if (builtin) asked = [builtin];
    }
  }
  if (!category && !name) return { lines: [...lines], asked };
  const hit = lines.filter((l) => asked.includes(l.id));
  return { lines: hit, asked };
}

/** spent ÷ budget, not capped: how far a budget is used up. */
export const usedShare = (l: Pick<BudgetLine, 'spent' | 'budget'>): number => (l.budget > 0 ? l.spent / l.budget : 0);

/** The days of the month from `today` to its last, today counted. */
export function daysLeftInMonth(today: string): number {
  return Number(lastDay(today.slice(0, 7)).slice(8)) - Number(today.slice(8, 10)) + 1;
}

/** What is left a day for the rest of the month, whole cents (rounded down); null when nothing is left or it cannot be said. */
export function perDayLeft(line: Pick<BudgetLine, 'state' | 'rest'>, today: string): number | null {
  if (line.state !== 'left') return null;
  const days = daysLeftInMonth(today);
  return days > 0 ? Math.floor(line.rest / days) : null;
}

/** The budgets over or nearly used up (at least BUDGET_NEAR), the most used up first. */
export function tightBudgets(lines: readonly BudgetLine[]): BudgetLine[] {
  return lines
    .filter((l) => l.state === 'over' || l.state === 'exact' || usedShare(l) >= BUDGET_NEAR)
    .sort((a, b) => usedShare(b) - usedShare(a));
}

/**
 * The budgets worth a note without asking, the most used up first: over the
 * budget at any time, or, in the running month before the
 * BUDGET_NOTE_BEFORE_DAY-th, at least BUDGET_NEAR used up. The notes say
 * only the first of them the user has not closed.
 */
export function budgetsToNote(m: MonthBudgets, today: string): BudgetLine[] {
  const running = m.month === today.slice(0, 7) && m.coverage === 'running';
  const early = running && Number(today.slice(8, 10)) < BUDGET_NOTE_BEFORE_DAY;
  return m.lines
    .filter((l) => l.state === 'over' || (early && usedShare(l) >= BUDGET_NEAR))
    .sort((a, b) => usedShare(b) - usedShare(a));
}
