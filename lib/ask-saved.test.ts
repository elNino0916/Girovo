import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import { ACTION_KINDS } from './ask-actions.ts';
import { FACT_KINDS } from './ask-facts.ts';
import { ASK_SAVED_LIMITS, answerHash, mergeAskConversations, sanitizeAskConversations, sanitizeIntent } from './ask-saved.ts';
import { isBuiltinCategoryId, type CategoryId } from './categories.ts';
import { pinQuery, type AskQuery } from './nano-ask.ts';
import { vaultFromEntries } from './sync-entries.ts';
import { mergeVaults, sanitizeVault } from './vault.ts';

const builtin = (v: unknown): v is CategoryId => isBuiltinCategoryId(v);
const NUL = String.fromCharCode(0);

const sum = (extra: Partial<AskQuery> = {}): AskQuery => ({
  kind: 'sum', dir: 'out', category: null, search: 'Rewe', period: { kind: 'lastMonth' }, ...extra,
});

const turn = (extra: Record<string, unknown> = {}) => ({ question: 'Wie viel bei Rewe?', state: 'answered', day: '2026-10-05', query: sum(), ...extra });

const conv = (id: string, at: string, turns: unknown[] = [turn()], extra: Record<string, unknown> = {}) => ({ id, title: 'Rewe', at, turns, ...extra });

test('anything but a list of conversations is none', () => {
  for (const raw of [undefined, null, 'x', 42, {}, { 0: conv('a', '2026-10-05T10:00:00.000Z') }]) {
    assert.deepEqual(sanitizeAskConversations(raw, builtin), []);
  }
});

test('a well formed conversation comes through as it was', () => {
  const raw = [conv('a1', '2026-10-05T10:00:00.000Z', [
    turn({ written: 'Im September hast du 42,10 € bei Rewe ausgegeben.', writtenFor: answerHash('k') }),
    { question: '', state: 'answered', day: '2026-10-05', recap: '2026-09', query: sum({ search: null, period: { kind: 'month', month: '2026-09' } }) },
    { question: 'Welche Abos habe ich?', state: 'answered', day: '2026-10-05', intent: { kind: 'contracts' } },
    { question: 'Was ist das für eine Zahlung?', state: 'answered', day: '2026-10-05', explain: true, bookingKey: 'd2|2026-10-01|-12.90|x' },
    { question: 'Wetter morgen?', state: 'offTopic', day: '2026-10-05' },
  ])];
  const out = sanitizeAskConversations(raw, builtin);
  assert.deepEqual(out, raw);
});

test('unknown keys are dropped: no booking or figure rides along', () => {
  const [c] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', [
    turn({ booking: { amount: -12.9, counterparty: 'REWE' }, cents: 1290, answer: { cents: 1290 } }),
  ], { balance: 100 })], builtin);
  assert.deepEqual(Object.keys(c).sort(), ['at', 'id', 'title', 'turns']);
  assert.deepEqual(Object.keys(c.turns[0]).sort(), ['day', 'query', 'question', 'state']);
});

test('unknown states, kinds, periods and intents are dropped, with their turn', () => {
  const turns = [
    turn({ state: 'reading' }),
    turn({ state: 'thinking' }),
    turn({ query: sum({ kind: 'median' as AskQuery['kind'] }) }),
    turn({ query: sum({ period: { kind: 'decade' } as unknown as AskQuery['period'] }) }),
    turn({ query: sum({ period: { kind: 'month', month: '2026-13' } }) }),
    turn({ query: sum({ category: 'nope' as CategoryId }) }),
    turn({ query: sum({ kind: 'rank' }) }),
    turn({ query: undefined, intent: { kind: 'launchRocket' } }),
    turn({ query: undefined, intent: { kind: 'read', setting: 'password' } }),
    turn({ query: undefined }),
    turn({ day: 'yesterday' }),
    turn({ question: '   ' }),
    'not a turn',
    turn({ question: 'Übrig' }),
  ];
  const [c] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', turns)], builtin);
  assert.deepEqual(c.turns.map((t) => t.question), ['Übrig']);
});

test('a conversation with no turn left, a bad id or a bad time is dropped', () => {
  const out = sanitizeAskConversations([
    conv('empty', '2026-10-05T10:00:00.000Z', [turn({ state: 'reading' })]),
    conv('bad id!', '2026-10-05T10:00:00.000Z'),
    conv('badtime', 'gestern'),
    conv('ok', '2026-10-05T10:00:00.000Z'),
  ], builtin);
  assert.deepEqual(out.map((c) => c.id), ['ok']);
});

test('a change still waiting for its yes is not kept; one answered is', () => {
  const ask = (intent: unknown, outcome?: string) => turn({ query: undefined, intent, ...(outcome ? { outcome } : {}) });
  const [c] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', [
    ask({ kind: 'set', setting: 'theme', value: 'dark' }),
    ask({ kind: 'set', setting: 'theme', value: 'dark' }, 'done'),
    ask({ kind: 'prepareTransfer', name: 'Lea', cents: 2000, purpose: 'Pizza' }),
    ask({ kind: 'prepareTransfer', name: 'Lea', cents: 2000, purpose: 'Pizza' }, 'cancelled'),
    ask({ kind: 'refresh' }),
    ask({ kind: 'budget', category: 'groceries', cents: 30000, step: 2 }, 'done'),
    ask({ kind: 'balance' }),
  ])], builtin);
  assert.deepEqual(c.turns.map((t) => [t.intent?.kind, t.outcome]), [
    ['set', 'done'], ['prepareTransfer', 'cancelled'], ['budget', 'done'], ['balance', undefined],
  ]);
  // A step that is none of 1 or -1 is dropped, the rest of the intent kept.
  assert.deepEqual(c.turns[2].intent, { kind: 'budget', category: 'groceries', cents: 30000 });
});

test('strings are clipped and made one line', () => {
  const long = 'x'.repeat(1000);
  const [c] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', [
    turn({ question: `Wie${NUL}viel\nbei\tRewe?  ${long}`, query: sum({ search: long }), written: long, writtenFor: answerHash('k') }),
  ], { title: long })], builtin);
  assert.equal(c.title.length, ASK_SAVED_LIMITS.title);
  const t = c.turns[0];
  assert.ok(t.question.startsWith('Wie viel bei Rewe? x'));
  assert.equal(t.question.length, ASK_SAVED_LIMITS.question);
  assert.equal(t.query?.search?.length, ASK_SAVED_LIMITS.search);
  assert.equal((t.written as string).length, ASK_SAVED_LIMITS.written);
});

test('Gemma\'s sentences stay only with a well formed hash of their figures', () => {
  const [c] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', [
    turn({ written: 'Satz.', writtenFor: '{"cents":1290}' }),
    turn({ written: 'Satz.' }),
    turn({ written: false, writtenFor: answerHash('k') }),
    turn({ written: 42, writtenFor: answerHash('k') }),
  ])], builtin);
  assert.deepEqual(c.turns.map((t) => t.written), [undefined, undefined, false, undefined]);
});

test('an own category counts only where the vault knows it', () => {
  const own = (v: unknown): v is CategoryId => builtin(v) || v === 'c_urlaub01';
  const raw = [conv('a', '2026-10-05T10:00:00.000Z', [turn({ query: sum({ category: 'c_urlaub01' as CategoryId, search: null }) })])];
  assert.equal(sanitizeAskConversations(raw, builtin).length, 0);
  assert.equal(sanitizeAskConversations(raw, own).length, 1);
});

test('capped: the newest conversations, the newest turns, and a size limit', () => {
  const many = Array.from({ length: 40 }, (_, i) => conv(`c${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()));
  const out = sanitizeAskConversations(many, builtin);
  assert.equal(out.length, ASK_SAVED_LIMITS.conversations);
  assert.equal(out[0].id, 'c39');
  assert.equal(out.at(-1)?.id, 'c10');

  const turns = Array.from({ length: 25 }, (_, i) => turn({ question: `Frage ${i}` }));
  const [long] = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z', turns)], builtin);
  assert.equal(long.turns.length, ASK_SAVED_LIMITS.turns);
  assert.equal(long.turns[0].question, 'Frage 5');

  const big = Array.from({ length: 30 }, (_, i) => conv(`b${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    Array.from({ length: 20 }, () => turn({ written: 'w'.repeat(600), writtenFor: answerHash('k') }))));
  const kept = sanitizeAskConversations(big, builtin);
  assert.ok(kept.length > 0 && kept.length < 30);
  assert.ok(JSON.stringify(kept).length <= ASK_SAVED_LIMITS.bytes);
  // The oldest go first.
  assert.equal(kept[0].id, 'b29');
});

test('each id once, the newest first', () => {
  const out = sanitizeAskConversations([
    conv('a', '2026-10-01T10:00:00.000Z'),
    conv('b', '2026-10-03T10:00:00.000Z'),
    conv('a', '2026-10-09T10:00:00.000Z'),
  ], builtin);
  assert.deepEqual(out.map((c) => [c.id, c.at.slice(0, 10)]), [['b', '2026-10-03'], ['a', '2026-10-01']]);
});

test('a backup\'s conversations beside this device\'s: this device\'s win', () => {
  const here = sanitizeAskConversations([conv('a', '2026-10-01T10:00:00.000Z', [turn({ question: 'hier' })])], builtin);
  const backup = sanitizeAskConversations([
    conv('a', '2026-10-01T10:00:00.000Z', [turn({ question: 'backup' })]),
    conv('b', '2026-10-02T10:00:00.000Z'),
  ], builtin);
  const merged = sanitizeAskConversations(mergeAskConversations(here, backup), builtin);
  assert.deepEqual(merged.map((c) => [c.id, c.turns[0].question]), [['b', 'Wie viel bei Rewe?'], ['a', 'hier']]);
});

test('answerHash: short, stable, and another for other figures', () => {
  const a = answerHash('["de",1290,3]|friendly|short');
  assert.match(a, /^[0-9a-z]{1,16}$/);
  assert.equal(a, answerHash('["de",1290,3]|friendly|short'));
  assert.notEqual(a, answerHash('["de",1291,3]|friendly|short'));
});

test('the vault keeps the conversations, checks them, and keeps them on this device', () => {
  const askConversations = sanitizeAskConversations([conv('a', '2026-10-05T10:00:00.000Z')], builtin);
  const v: VaultData = { ...EMPTY_VAULT, askConversations };
  assert.deepEqual(sanitizeVault(v)?.askConversations, askConversations);
  // A hand-edited field: whatever is not a conversation goes, and none at all is no key.
  const bad = sanitizeVault({ ...EMPTY_VAULT, askConversations: [{ id: 'x' }, 'y'] });
  assert.equal(bad && 'askConversations' in bad, false);
  // A backup brings its own beside these.
  const backup: VaultData = { ...EMPTY_VAULT, askConversations: sanitizeAskConversations([conv('b', '2026-10-06T10:00:00.000Z')], builtin) };
  assert.deepEqual(mergeVaults(v, backup).askConversations?.map((c) => c.id), ['b', 'a']);
  // Never an entry for another device: taken from this device's own vault.
  assert.deepEqual(vaultFromEntries(new Map(), v).askConversations, askConversations);
  assert.equal(vaultFromEntries(new Map(), EMPTY_VAULT).askConversations, undefined);
});

test('pinQuery: a question from an earlier day keeps the days it meant', () => {
  const asked = '2026-10-05';
  const today = '2026-11-14';
  assert.deepEqual(pinQuery(sum(), asked, today).period, { kind: 'month', month: '2026-09' });
  assert.deepEqual(pinQuery(sum({ period: { kind: 'lastYear' } }), asked, today).period, { kind: 'year', year: 2025 });
  assert.deepEqual(pinQuery(sum({ period: { kind: 'thisMonth' } }), asked, today).period, { kind: 'range', from: '2026-10-01', to: '2026-10-05' });
  assert.deepEqual(pinQuery(sum({ period: { kind: 'days', days: 7 } }), asked, today).period, { kind: 'range', from: '2026-09-29', to: '2026-10-05' });
  // "Diesen Monat mehr als letzten?": last month cut to as many days as this one had then.
  const compare = pinQuery(sum({ kind: 'compare', period: { kind: 'thisMonth' }, against: { kind: 'lastMonth' } }), asked, today);
  assert.deepEqual(compare.period, { kind: 'range', from: '2026-10-01', to: '2026-10-05' });
  assert.deepEqual(compare.against, { kind: 'range', from: '2026-09-01', to: '2026-09-05' });
  // Nothing that moves, or asked today: the very same query.
  const fixed = sum({ period: { kind: 'month', month: '2026-08' } });
  assert.equal(pinQuery(fixed, asked, today), fixed);
  const same = sum();
  assert.equal(pinQuery(same, today, today), same);
});

test('every intent the app reads can be kept: a new kind needs its sanitiser', () => {
  const samples: Record<string, unknown> = {
    contracts: { kind: 'contracts' },
    refresh: { kind: 'refresh' },
    read: { kind: 'read', setting: 'theme' },
    set: { kind: 'set', setting: 'language', value: 'en' },
    balance: { kind: 'balance' },
    balanceAt: { kind: 'balanceAt', day: '2026-09-30' },
    monthEnd: { kind: 'monthEnd' },
    contractCost: { kind: 'contractCost', name: 'netflix' },
    priceRises: { kind: 'priceRises' },
    salary: { kind: 'salary' },
    owed: { kind: 'owed', name: null },
    goal: { kind: 'goal', name: 'urlaub' },
    budgetLeft: { kind: 'budgetLeft', category: 'groceries', name: null },
    budgetsOver: { kind: 'budgetsOver' },
    cancelBy: { kind: 'cancelBy', until: null },
    renewal: { kind: 'renewal', name: 'spotify' },
    afford: { kind: 'afford', cents: 80000, month: '2026-11' },
    fileUnder: { kind: 'fileUnder', name: 'Shell', category: 'mobility' },
    createGoal: { kind: 'createGoal', name: 'Urlaub', cents: 150000, by: '2027-06' },
    budget: { kind: 'budget', category: 'dining', cents: 20000, remove: true },
    remindContract: { kind: 'remindContract', name: 'spotify', by: '2026-12-01', lead: 14 },
    prepareTransfer: { kind: 'prepareTransfer', name: 'Lea', cents: 2000, purpose: 'Pizza' },
    cancelLetter: { kind: 'cancelLetter', name: 'fitnessstudio', end: '2026-12-31' },
  };
  for (const kind of [...FACT_KINDS, ...ACTION_KINDS, 'contracts', 'refresh', 'read', 'set']) {
    assert.ok(samples[kind], `no sample for the intent ${kind}`);
    assert.deepEqual(sanitizeIntent(samples[kind], builtin), samples[kind], kind);
  }
});
