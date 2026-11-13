// Girovo AI question set: compares what a message was read as (lib/ask-read.ts
// ReadResult) with what it should be read as (an `expect` of questions.json).
//
// An expect lists only what matters for its question:
//   kind, dir, category, search, period, against, rankBy, rankMetric  (a question about bookings)
//   per: "month" | "year"                                              (an average; none in the reading is "month")
//   intent (+ setting, value, name, day)                                (contracts, read, set, refresh, and the
//                                                                         app's figures: balance, monthEnd, contractCost,
//                                                                         priceRises, salary, owed, goal, and
//                                                                         balanceAt, whose day is a yyyy-mm-dd;
//                                                                         the actions fileUnder, createGoal, budget,
//                                                                         remindContract, prepareTransfer, with
//                                                                         name, category, cents, by, remove)
//   offTopic: true                                                      (small talk, nonsense, injections)
//   anyOf: [expect, …]                                                  (any one of these readings is right;
//                                                                         fields beside anyOf apply to each)
// A field may also be an array of values, any of which is right
// (kind: ["sum", "average"], period: [{…}, {…}]). `search` is a lowercase
// substring the reading's search must contain; null means no search at all.
// Periods are compared by the days they span (periodDays, the app's own), so
// lastMonth and { month: "2026-10" } are the same on 2026-11-12.

import { periodDays } from '../../lib/nano-ask.ts';

const show = (v) => (v === undefined ? 'nothing' : JSON.stringify(v));
const alts = (v) => (Array.isArray(v) ? v : [v]);

function sameSpan(a, b, today) {
  const x = a ? periodDays(a, today) : null;
  const y = b ? periodDays(b, today) : null;
  if (!x || !y) return !x && !y;
  return x.from === y.from && x.to === y.to;
}

function spanText(p, today) {
  if (!p) return 'nothing';
  const days = periodDays(p, today);
  return days ? `${days.from}..${days.to}` : 'all';
}

function what(result) {
  if (!result) return 'no result';
  if ('intent' in result) return `intent ${result.intent.kind}`;
  if ('offTopic' in result) return 'offTopic';
  if ('notUnderstood' in result) return 'notUnderstood';
  if ('query' in result) return `query ${result.query.kind}`;
  return 'unknown result';
}

function scoreOne(result, expect, today) {
  const misses = [];
  if (expect.offTopic) {
    // Not understood is as good as small talk here: neither answers with a sum. So is a transfer order
    // read as one to prepare (lib/ask-actions.ts prepareTransfer): Girovo only opens the form, it never sends.
    const prepared = !!result && 'intent' in result && result.intent.kind === 'prepareTransfer';
    if (!result || !('offTopic' in result || 'notUnderstood' in result || prepared)) misses.push(`offTopic: want offTopic, got ${what(result)}`);
    return misses;
  }
  if (expect.intent) {
    const got = result && 'intent' in result ? result.intent : null;
    if (!got) return [`intent: want ${expect.intent}, got ${what(result)}`];
    if (!alts(expect.intent).includes(got.kind)) misses.push(`intent: want ${show(expect.intent)}, got ${got.kind}`);
    if ('setting' in expect && !alts(expect.setting).includes(got.setting)) misses.push(`setting: want ${show(expect.setting)}, got ${show(got.setting)}`);
    if ('value' in expect && !alts(expect.value).includes(got.value)) misses.push(`value: want ${show(expect.value)}, got ${show(got.value)}`);
    // The contract, person or goal a fact is about: a lowercase piece of it, or null for none.
    // An action's name is kept as typed ("Shell"): compared in lowercase too.
    if ('name' in expect && !alts(expect.name).some((want) => (want == null ? got.name == null : String(got.name ?? '').toLocaleLowerCase('de').includes(String(want).toLocaleLowerCase('de'))))) {
      misses.push(`name: want ${show(expect.name)}, got ${show(got.name ?? null)}`);
    }
    // A past balance's day (balanceAt).
    if ('day' in expect && !alts(expect.day).includes(got.day)) misses.push(`day: want ${show(expect.day)}, got ${show(got.day ?? null)}`);
    // An action's figures (lib/ask-actions.ts): its category, amount in cents, month or day, a budget removed.
    for (const field of ['category', 'cents', 'by', 'remove']) {
      if (field in expect && !alts(expect[field]).includes(got[field] ?? null)) misses.push(`${field}: want ${show(expect[field])}, got ${show(got[field] ?? null)}`);
    }
    return misses;
  }
  const query = result && 'query' in result ? result.query : null;
  if (!query) return [`query: want a reading, got ${what(result)}`];

  for (const field of ['kind', 'dir', 'category']) {
    if (!(field in expect)) continue;
    const got = query[field] ?? null;
    if (!alts(expect[field]).includes(got)) misses.push(`${field}: want ${show(expect[field])}, got ${show(got)}`);
  }
  // An average per month or per year; a reading without `per` is per month.
  if ('per' in expect) {
    const got = query.per ?? 'month';
    if (!alts(expect.per).includes(got)) misses.push(`per: want ${show(expect.per)}, got ${show(got)}`);
  }
  if ('search' in expect) {
    const got = (query.search ?? '').trim().toLocaleLowerCase('de');
    const ok = alts(expect.search).some((want) => (want == null ? !got : got.includes(String(want).toLocaleLowerCase('de'))));
    if (!ok) misses.push(`search: want ${show(expect.search)}, got ${show(query.search ?? null)}`);
  }
  for (const field of ['period', 'against']) {
    if (!(field in expect)) continue;
    const got = query[field];
    if (!alts(expect[field]).some((want) => sameSpan(want, got, today))) {
      misses.push(`${field}: want ${alts(expect[field]).map((p) => spanText(p, today)).join(' or ')}, got ${spanText(got, today)}`);
    }
  }
  if ('rankBy' in expect && !alts(expect.rankBy).includes(query.rank?.by)) misses.push(`rankBy: want ${show(expect.rankBy)}, got ${show(query.rank?.by)}`);
  if ('rankMetric' in expect && !alts(expect.rankMetric).includes(query.rank?.metric)) {
    misses.push(`rankMetric: want ${show(expect.rankMetric)}, got ${show(query.rank?.metric)}`);
  }
  return misses;
}

/** One turn's score: whether the reading is right, and each field it got wrong. */
export function scoreTurn(result, expect, today) {
  if (Array.isArray(expect.anyOf)) {
    const { anyOf, ...shared } = expect;
    let best = null;
    for (const option of anyOf) {
      const misses = scoreOne(result, { ...shared, ...option }, today);
      if (!misses.length) return { ok: true, misses: [] };
      if (!best || misses.length < best.length) best = misses;
    }
    return { ok: false, misses: best ?? ['anyOf: no options'] };
  }
  const misses = scoreOne(result, expect, today);
  return { ok: !misses.length, misses };
}

/** What a turn asks for, for the breakdown: intent, offTopic, or the kind of answer. */
export function groupOf(expect) {
  const e = Array.isArray(expect.anyOf) ? { ...expect, ...expect.anyOf[0] } : expect;
  if (e.offTopic) return 'offTopic';
  if (e.intent) return `intent`;
  const kind = alts(e.kind ?? 'unspecified')[0];
  return kind;
}

/** The topic a turn asks about, for the breakdown: its category, "payee" for a name, or "none". */
export function topicOf(expect) {
  const e = Array.isArray(expect.anyOf) ? { ...expect, ...expect.anyOf[0] } : expect;
  if (e.offTopic || e.intent) return null;
  if (typeof alts(e.search)[0] === 'string') return 'payee';
  return alts(e.category ?? 'none')[0] ?? 'none';
}

const tally = (rows, keyOf) => {
  const out = {};
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null) continue;
    out[k] ??= { passed: 0, total: 0 };
    out[k].total++;
    if (r.ok) out[k].passed++;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

/**
 * Totals over scored turns. Each row: { id, lang, turn, q, expect, ok, misses }.
 * Items (whole conversations) pass only when every turn does.
 */
export function summarize(rows) {
  const items = {};
  for (const r of rows) items[r.id] = (items[r.id] ?? true) && r.ok;
  return {
    passed: rows.filter((r) => r.ok).length,
    total: rows.length,
    items: { passed: Object.values(items).filter(Boolean).length, total: Object.keys(items).length },
    byKind: tally(rows, (r) => groupOf(r.expect)),
    byTopic: tally(rows, (r) => topicOf(r.expect)),
    byLang: tally(rows, (r) => r.lang),
    byTurn: tally(rows, (r) => (r.turn === 0 ? 'first' : 'followUp')),
  };
}
