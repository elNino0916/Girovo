'use client';

// Girovo Next on the desktop: "Mit Girovo AI kategorisieren". Gemma reads the
// outgoing bookings still in Sonstiges, one prompt per counterparty, with the
// phone's category prompt (lib/ai-categorize.ts); then a review lists every
// suggestion with its own checkbox and the category menu, and nothing changes
// before Übernehmen. What is taken is filed as the user's rule for the
// counterparty (FintsProvider setCategory with `rule`), exactly as "für alle"
// in a booking's details: it syncs, and the Kategorie-Check counts it as the
// user's.
//
// The way in: a row on Einstellungen' Girovo AI page and a line in the
// Kategorie-Check's list of what has no category. Both are there only where
// the shell has Gemma (not on Android: the phone keeps Gemini Nano's own
// guesses), and stay disabled with one line while the model is not ready or
// Girovo AI is switched off.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  aiGroups, aiPrompt, answerKey, applyList, initialPicks, readAnswer, type AiGroup, type AiPick,
} from '@/lib/ai-categorize';
import { categoryLabel, type CategoryId } from '@/lib/categories';
import type { GuessableCategory } from '@/lib/category-guess';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../../FintsProvider';
import { AiMarkIcon, ChevronIcon } from '../../icons';
import { ActionItem, SettingItem } from '../../settings/rows';
import { menuGroups } from '../../transactions/TxDetail';
import { Button, Checkbox, Dialog, Menu, MenuGroup, MenuItemRadio, Progress } from '../../ui';
import { gemmaPrompt, gemmaUsable, useGemma } from '../gemma';

/**
 * Gemma's answers for this session, by prompt and prompt version
 * (lib/ai-categorize.ts answerKey): opened again, the review comes without
 * asking twice. In memory only, like the guesses' own answers.
 */
const answers = new Map<string, GuessableCategory | null>();

/** Prompts that fail one after another before Girovo stops asking: Gemma is not answering. */
const GIVE_UP_AFTER = 3;

/** Whether the way in shows, whether it works now, and what it would read. */
function useAiCategorize() {
  const gemma = useGemma();
  const { vault, txByAccount, pendingCache, loadedTxs, categoryOf } = useFints();
  // Only where the shell has Gemma for this system: null in a browser and on Android.
  const shown = !IS_ANDROID && !!gemma?.supported;
  const modelReady = shown && gemmaUsable(gemma);
  const off = !!vault?.askOff;
  // The listed bookings, Vorgemerkte included: the rule moves them too. The
  // rest of what is loaded is only checked (lib/ai-categorize.ts aiGroups).
  const groups = useMemo(
    () => (shown
      ? aiGroups([...Object.values(txByAccount).flat(), ...Object.values(pendingCache).flat()], categoryOf, loadedTxs)
      : []),
    [shown, txByAccount, pendingCache, loadedTxs, categoryOf],
  );
  const count = useMemo(() => groups.reduce((n, g) => n + g.txs.length, 0), [groups]);
  return { shown, ready: modelReady && !off, why: !modelReady ? 'model' as const : off ? 'off' as const : null, groups, count };
}

/** Einstellungen' Girovo AI page: the row, with how much is in Sonstiges. */
export function AiCategorizeRow() {
  const t = useT();
  const words = t.settings.aiCategorize;
  const s = useAiCategorize();
  const [open, setOpen] = useState(false);
  if (!s.shown) return null;
  // A row of Girovo AI's group "Funktionen" (components/settings/AskSettings.tsx); its dialog stands outside the group.
  return (
    <>
      {s.ready ? (
        <ActionItem
          icon={<AiMarkIcon />}
          title={words.row}
          summary={words.rowHint(s.count)}
          onClick={() => setOpen(true)}
        />
      ) : (
        <SettingItem
          disabled
          icon={<AiMarkIcon />}
          title={words.row}
          summary={s.why === 'off' ? words.isOff : words.needsModel}
        />
      )}
      {open && <AiCategorizeRun groups={s.groups} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The Kategorie-Check's list of what has no category: a small way in, while spending sits in Sonstiges. */
export function AiCategorizeEntry() {
  const t = useT();
  const words = t.settings.aiCategorize;
  const s = useAiCategorize();
  const [open, setOpen] = useState(false);
  if (!s.shown || s.count === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        variant="tertiary"
        size="xs"
        className="-ml-3"
        disabled={!s.ready}
        iconLeft={<AiMarkIcon size={16} />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {words.row}
      </Button>
      {!s.ready && <span className="text-[13px] leading-snug text-ink-3">{s.why === 'off' ? words.isOff : words.needsModel}</span>}
      {open && <AiCategorizeRun groups={s.groups} onClose={() => setOpen(false)} />}
    </div>
  );
}

type Phase =
  | { kind: 'asking'; done: number; total: number }
  | { kind: 'review'; stopped: { done: number; total: number } | null }
  | { kind: 'failed' };

/**
 * One run, mounted while its dialog is open: asks Gemma what it has not
 * answered yet, then the review. The counterparties are the ones there when
 * it opened, so the list holds still while the user decides.
 */
function AiCategorizeRun({ groups, onClose }: { groups: AiGroup[]; onClose: () => void }) {
  const t = useT();
  const words = t.settings.aiCategorize;
  const { setCategory, toast } = useFints();
  const [snapshot] = useState(groups);
  // The prompts still to ask, one per distinct name and purpose.
  const [todo] = useState(() => {
    const out = new Map<string, AiGroup>();
    for (const g of snapshot) {
      const key = answerKey(g);
      if (!answers.has(key) && !out.has(key)) out.set(key, g);
    }
    return out;
  });
  const [phase, setPhase] = useState<Phase>(() => (todo.size ? { kind: 'asking', done: 0, total: todo.size } : { kind: 'review', stopped: null }));
  const [picks, setPicks] = useState<AiPick[]>(() => (todo.size ? [] : initialPicks(snapshot, answers)));
  const stop = useRef(false);
  const done = useRef(0);

  useEffect(() => {
    if (!todo.size) return;
    let live = true;
    void (async () => {
      let failedInRow = 0;
      let answered = 0;
      for (const [key, g] of todo) {
        if (!live || stop.current) return;
        if (answers.has(key)) {
          done.current++;
          continue;
        }
        const p = aiPrompt(g);
        const raw = await gemmaPrompt(p.system, p.user, p.maxTokens);
        // An answer that comes after Abbrechen is still kept for next time.
        if (raw != null) {
          answers.set(key, readAnswer(raw));
          answered++;
          failedInRow = 0;
        } else failedInRow++;
        if (!live || stop.current) return;
        done.current++;
        setPhase({ kind: 'asking', done: done.current, total: todo.size });
        if (failedInRow >= GIVE_UP_AFTER && !answered) break;
      }
      const next = initialPicks(snapshot, answers);
      setPicks(next);
      setPhase(!answered && !next.length && failedInRow > 0 ? { kind: 'failed' } : { kind: 'review', stopped: null });
    })();
    return () => {
      live = false;
    };
  }, [todo, snapshot]);

  // Abbrechen while Gemma reads: what is answered so far goes to the review.
  const cancel = () => {
    stop.current = true;
    setPicks(initialPicks(snapshot, answers));
    setPhase({ kind: 'review', stopped: { done: done.current, total: todo.size } });
  };
  const close = () => {
    stop.current = true;
    onClose();
  };

  const byKey = useMemo(() => new Map(snapshot.map((g) => [g.key, g])), [snapshot]);
  const setPick = (key: string, change: Partial<AiPick>) =>
    setPicks((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const chosen = applyList(snapshot, picks);

  const apply = () => {
    let moved = 0;
    for (const a of chosen) {
      setCategory(a.tx, a.category, { rule: true });
      moved += a.count;
    }
    if (moved) toast(words.applied(moved), 'success');
    close();
  };

  const asking = phase.kind === 'asking';
  const reviewing = phase.kind === 'review' && picks.length > 0;
  const actions = asking ? (
    <Button variant="secondary" onClick={cancel} data-autofocus>{t.common.cancel}</Button>
  ) : reviewing ? (
    <>
      <Button variant="secondary" onClick={close}>{t.common.cancel}</Button>
      <Button variant="primary" onClick={apply} disabled={!chosen.length}>{words.apply}</Button>
    </>
  ) : (
    <Button variant="secondary" onClick={close} data-autofocus>{t.common.close}</Button>
  );

  return (
    <Dialog
      open
      onClose={close}
      // A click beside the review must not throw away what was picked.
      onBackdrop={reviewing ? () => {} : close}
      size="md"
      icon={<AiMarkIcon size={22} />}
      title={words.title}
      description={words.intro}
      actions={actions}
    >
      {asking && (
        <div>
          <p className="tnum text-[14px] leading-5 text-ink-2" aria-live="polite">{words.reading(phase.done, phase.total)}</p>
          <Progress
            className="mt-3"
            value={(phase.done / Math.max(1, phase.total)) * 100}
            label={words.title}
            valueText={words.reading(phase.done, phase.total)}
          />
        </div>
      )}

      {phase.kind === 'failed' && <p className="text-[15px] leading-snug text-ink">{words.failed}</p>}

      {phase.kind === 'review' && (
        <>
          {phase.stopped && (
            <p className="tnum text-[14px] leading-5 text-ink-2">{words.stopped(phase.stopped.done, phase.stopped.total)}</p>
          )}
          {picks.length === 0 ? (
            <p className={phase.stopped ? 'mt-2 text-[15px] leading-snug text-ink' : 'text-[15px] leading-snug text-ink'}>
              {snapshot.length ? words.noIdeas : words.nothingOpen}
            </p>
          ) : (
            <>
              <p className={phase.stopped ? 'mt-1 text-[13px] leading-snug text-ink-3' : 'text-[13px] leading-snug text-ink-3'}>{words.reviewHint}</p>
              <ul data-ai className="mt-3 rounded-[16px] px-4">
                {picks.map((p) => {
                  const g = byKey.get(p.key);
                  return g ? <PickRow key={p.key} group={g} pick={p} onChange={(change) => setPick(p.key, change)} /> : null;
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

/** One counterparty in the review: its checkbox (the name, how many bookings) and its category menu. */
function PickRow({ group, pick, onChange }: { group: AiGroup; pick: AiPick; onChange: (change: Partial<AiPick>) => void }) {
  const t = useT();
  const words = t.settings.aiCategorize;
  const facts = [t.insights.count.bookings(group.txs.length), group.person ? words.person : ''].filter(Boolean).join(' · ');
  const label = categoryLabel(pick.category);
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <Checkbox
        className="min-w-0 flex-1"
        checked={pick.checked}
        onChange={(e) => onChange({ checked: e.target.checked })}
        label={<span className="block truncate font-semibold">{group.name}</span>}
        description={<span className="tnum">{facts}</span>}
      />
      <Menu
        placement="bottom-end"
        label={words.pickFor(group.name)}
        minWidth={280}
        trigger={(props) => (
          <Button
            {...props}
            size="xs"
            variant="secondary"
            aria-label={`${words.pickFor(group.name)}: ${label}`}
            iconRight={<ChevronIcon size={14} strokeWidth={2} />}
          >
            {label}
          </Button>
        )}
      >
        {menuGroups(false, t).map((mg) => (
          <MenuGroup key={mg.label} label={mg.label}>
            {mg.ids.map((id: CategoryId) => (
              // Picking a category is a yes to this row.
              <MenuItemRadio key={id} checked={id === pick.category} onSelect={() => onChange({ category: id, checked: true })}>
                {categoryLabel(id)}
              </MenuItemRadio>
            ))}
          </MenuGroup>
        ))}
      </Menu>
    </li>
  );
}
