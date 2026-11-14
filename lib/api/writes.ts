// Girovo API, phase 2: the write methods (docs/girovo-api.md, Methods).
// Each checks what the app sent, finds what it names by the opaque ids the
// read methods hand out (a booking, an account, a contract), and then does
// the change the way the app's own screens do it: through ApiActions, which
// components/api/ApiHost.tsx makes from the provider's setters (setCategory,
// setNote, setBudgets, setGoal, setContractReminder, setContractName,
// addCustomCategory), the same ones the UI and Girovo AI's actions
// (lib/ask-actions.ts, components/insights/ask/ActionAnswers.tsx) use. So a
// change from an app is kept, cleaned and synced exactly like one made by hand.
//
// Pure and node-test-safe: the router (./router.ts) brings the data and the
// actions.

import type { SerializedTransaction } from '../fints-types';
import type { CategoryId, CustomCategoryId } from '../categories';
import type { ContractReminder } from '../contract-watch';
import type { SavingsGoal } from '../savings-goal';
import type { Budgets } from '../budgets';
import { filePlan } from '../ask-actions.ts';
import { isSavingsAccount } from '../balances.ts';
import { BUDGET_MAX_CENTS, isBudgetCategory } from '../budgets.ts';
import { counterpartyName, counterpartyRuleKeys } from '../categories.ts';
import { REMINDER_LEADS } from '../contract-watch.ts';
import { cleanNote } from '../notes.ts';
import { GOAL_LIMITS } from '../savings-goal.ts';
import { categoryValidator, cleanCategoryName } from '../splits.ts';
import { accountId, findAccount, findBooking, findSeries, realDay, seriesId, type ApiData, type MethodOutcome } from './methods.ts';

/** What the write methods change, made by the host from the provider's own setters. */
export type ApiActions = {
  /** FintsProvider setCategory: one booking, or (`rule`) every booking of its counterparty; null back to the automatic one. */
  setCategory: (tx: SerializedTransaction, id: CategoryId | null, rule: boolean) => void;
  /** FintsProvider addCustomCategory. */
  addCategory: (name: string, direction: 'in' | 'out') => { id: CustomCategoryId } | { error: 'empty' | 'taken' | 'full' };
  setNote: (tx: SerializedTransaction, text: string | null) => void;
  setBudgets: (next: Budgets) => void;
  /** Sparziele are a Plus perk in the Play build (lib/plus.ts goalsAllowed); always on the desktop. */
  goalsAllowed: boolean;
  setGoal: (accountKey: string, goal: Omit<SavingsGoal, 'accountNumber'> | null) => void;
  setReminder: (seriesKey: string, reminder: ContractReminder | null) => void;
  setContractName: (seriesKey: string, name: string | null) => void;
};

/** The method's answer when it refuses for a reason the app should know (`not_permitted` with `data.reason`). */
export type WriteOutcome = MethodOutcome;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && realDay(v);
const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v) && +v.slice(5) >= 1 && +v.slice(5) <= 12;
const isCents = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max;
// eslint-disable-next-line no-control-regex
const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();

const categoryOk = (data: ApiData) => categoryValidator(data.customCategories ?? []);
const named = (data: ApiData, id: CategoryId) => ({ id, name: data.categoryName(id) });

// ---------------------------------------------------------------------------
// categories.set, rules.add, categories.create
// ---------------------------------------------------------------------------

/** `{ booking, category }`: one booking filed under a category; `category: null` back to what a rule or the guess says. */
export function categoriesSet(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const found = findBooking(data, params.booking);
  if (!found) return { invalid: 'booking' };
  const category = params.category;
  if (category !== null && !categoryOk(data)(category)) return { invalid: 'category' };
  actions.setCategory(found.tx, category as CategoryId | null, false);
  return { result: { booking: params.booking, category: category === null ? null : named(data, category as CategoryId) } };
}

/**
 * `{ booking, category }` or `{ payee, category }`: a rule for a counterparty,
 * as "Immer so einordnen" (für alle) sets it in a booking's details. By a
 * booking: that booking's counterparty. By a name: every counterparty that
 * name fits among the loaded bookings, as Girovo AI's "Ordne alle
 * Shell-Buchungen Mobilität zu" finds them (lib/ask-actions.ts filePlan);
 * a payee whose bookings the user filed by hand is left alone, as there.
 */
export function rulesAdd(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const category = params.category;
  if (!categoryOk(data)(category)) return { invalid: 'category' };
  if (params.booking !== undefined) {
    const found = findBooking(data, params.booking);
    if (!found) return { invalid: 'booking' };
    // A counterparty with neither IBAN, creditor ID nor name cannot carry a rule.
    if (counterpartyRuleKeys(found.tx)[0] === 'name:?') return { invalid: 'booking', data: { reason: 'no_counterparty' } };
    actions.setCategory(found.tx, category, true);
    return { result: { applied: true, payees: [counterpartyName(found.tx)], category: named(data, category) } };
  }
  const payee = params.payee;
  if (typeof payee !== 'string' || !clean(payee) || payee.length > 100) return { invalid: 'payee' };
  const loaded = data.accounts.flatMap((a) => data.txByAccount[a.key] ?? []);
  const plan = filePlan(loaded, loaded, clean(payee), category, (tx) => {
    const c = data.categoryOf(tx);
    return { name: counterpartyName(tx), keys: counterpartyRuleKeys(tx), category: c.id, source: c.source, split: !!c.parts };
  });
  if (plan.state === 'none') return { invalid: 'payee', data: { reason: 'not_found' } };
  if (plan.state === 'handFiled') {
    return { result: { applied: false, reason: 'filed_by_hand', payees: plan.names, category: named(data, category) } };
  }
  if (plan.state === 'already') {
    return { result: { applied: false, reason: 'already', payees: plan.names, bookings: plan.count, category: named(data, category) } };
  }
  for (const tx of plan.anchors) actions.setCategory(tx, category, true);
  return { result: { applied: true, payees: plan.names, bookings: plan.count, skippedFiledByHand: plan.skipped, category: named(data, category) } };
}

/** `{ name, direction? }` ('out' for spending, the default, or 'in' for income): a category of the user's own. */
export function categoriesCreate(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  if (typeof params.name !== 'string' || params.name.length > 200) return { invalid: 'name' };
  const direction = params.direction === undefined ? 'out' : params.direction;
  if (direction !== 'in' && direction !== 'out') return { invalid: 'direction' };
  const name = cleanCategoryName(params.name);
  if (!name) return { invalid: 'name', data: { reason: 'empty' } };
  const made = actions.addCategory(name, direction);
  if ('error' in made) return { invalid: 'name', data: { reason: made.error } };
  return { result: { category: { id: made.id, name }, direction } };
}

// ---------------------------------------------------------------------------
// notes.set
// ---------------------------------------------------------------------------

/** `{ booking, text }`: the booking's note; null or an empty text removes it. One line, 280 characters, as the app keeps notes. */
export function notesSet(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const found = findBooking(data, params.booking);
  if (!found) return { invalid: 'booking' };
  if (params.text !== null && (typeof params.text !== 'string' || params.text.length > 2000)) return { invalid: 'text' };
  const text = params.text === null ? '' : cleanNote(params.text);
  actions.setNote(found.tx, text || null);
  return { result: { booking: params.booking, note: text || null } };
}

// ---------------------------------------------------------------------------
// budgets.set, goals.set
// ---------------------------------------------------------------------------

/** `{ category, cents }`: the category's Monatsbudget in whole cents; null removes it. Spending categories only. */
export function budgetsSet(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const category = params.category;
  if (!categoryOk(data)(category) || !isBudgetCategory(category)) return { invalid: 'category' };
  if (params.cents !== null && !isCents(params.cents, BUDGET_MAX_CENTS)) return { invalid: 'cents' };
  const budgets: Budgets = { ...data.budgets };
  if (params.cents === null) delete budgets[category];
  else budgets[category] = params.cents;
  actions.setBudgets(budgets);
  return { result: { category: named(data, category), cents: params.cents } };
}

/**
 * `{ account, name, target, by? }`: the Sparziel of a savings account (target
 * in cents, by as yyyy-mm); `{ account, target: null }` removes it. As the
 * account's own "Sparziel setzen": savings accounts only, one goal each, a
 * Plus perk in the Play build.
 */
export function goalsSet(data: ApiData, actions: ApiActions, params: unknown, thisMonth: string): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const account = findAccount(data, params.account);
  if (!account || !isSavingsAccount(account.account)) return { invalid: 'account' };
  if (!actions.goalsAllowed) return { fail: 'not_permitted', data: { reason: 'plus' } };
  const current = data.goals.find((g) => g.accountNumber === account.key);
  if (params.target === null) {
    actions.setGoal(account.key, null);
    return { result: { account: accountId(account.key), goal: null } };
  }
  if (!isCents(params.target, GOAL_LIMITS.target)) return { invalid: 'target' };
  const name = typeof params.name === 'string' ? clean(params.name).slice(0, GOAL_LIMITS.name).trim() : current?.name ?? '';
  if (!name) return { invalid: 'name' };
  if (params.by !== undefined && params.by !== null && (!isMonth(params.by) || params.by < thisMonth)) return { invalid: 'by' };
  const by = typeof params.by === 'string' ? params.by : undefined;
  // The plan starts the month the goal was first set; a changed goal keeps it (components/overview/SavingsGoal.tsx).
  actions.setGoal(account.key, { name, target: params.target, ...(by ? { by } : {}), since: current?.since ?? thisMonth });
  return { result: { account: accountId(account.key), goal: { name, target: params.target, ...(by ? { by } : {}) } } };
}

// ---------------------------------------------------------------------------
// reminders.set, contracts.rename
// ---------------------------------------------------------------------------

const seriesName = (s: { customName?: string | null; name: string }) => s.customName ?? s.name;

/**
 * `{ contract, by, lead? }`: Verträge & Abos' reminder before the day the
 * contract can be cancelled by (yyyy-mm-dd, today or later), `lead` days
 * before it (7, 14 or 30; the one it has, else 30); `by: null` removes it.
 */
export function remindersSet(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const s = findSeries(data, params.contract);
  if (!s) return { invalid: 'contract' };
  if (params.by === null) {
    actions.setReminder(s.id, null);
    return { result: { contract: seriesId(s.id), reminder: null } };
  }
  if (!isDay(params.by) || params.by < data.today) return { invalid: 'by' };
  const current = data.reminders?.[s.id];
  const lead = params.lead === undefined ? current?.lead ?? 30 : params.lead;
  if (!(REMINDER_LEADS as readonly unknown[]).includes(lead)) return { invalid: 'lead' };
  const reminder: ContractReminder = { by: params.by, lead: lead as number, name: seriesName(s) };
  actions.setReminder(s.id, reminder);
  return { result: { contract: seriesId(s.id), reminder: { by: reminder.by, lead: reminder.lead } } };
}

/** The longest name a contract keeps (lib/contract-watch.ts). */
export const CONTRACT_NAME_MAX = 70;

/** `{ contract, name }`: the contract's own name in place of the bank's; null (or the bank's own) goes back to it. */
export function contractsRename(data: ApiData, actions: ApiActions, params: unknown): WriteOutcome {
  if (!isRecord(params)) return { invalid: 'params' };
  const s = findSeries(data, params.contract);
  if (!s) return { invalid: 'contract' };
  if (params.name !== null && (typeof params.name !== 'string' || params.name.length > 500)) return { invalid: 'name' };
  const name = params.name === null ? '' : clean(params.name).slice(0, CONTRACT_NAME_MAX).trim();
  // As the rename dialog: the bank's own name, or nothing, is no name of the user's (components/insights/RenameContract.tsx).
  const own = name && name !== s.name ? name : null;
  actions.setContractName(s.id, own);
  return { result: { contract: seriesId(s.id), name: own ?? s.name, own: !!own } };
}
