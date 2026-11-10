'use client';

// Konten anordnen: how the accounts overview groups the accounts and orders
// them within each group, kept in the vault.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { type AccountGroup, type AccountGrouping, GROUPINGS, groupAccounts, groupKindOf, moveAccount, orderAccounts } from '@/lib/account-overview';
import { isDepot } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { DragIcon } from '../icons';
import { Button, cx, Overlay, Segmented, Sheet } from '../ui';
import { accountIdent } from './AccountIdentity';
import { AccountDisc } from './AccountMarks';

/** How far a finger or the mouse moves before a press on a row stops being a press. */
const SLOP = 8;
/** How long a finger rests on a row before the row lifts (the grip lifts at once). */
const HOLD_MS = 350;

type Drag = {
  key: string;
  group: string;
  members: string[];
  from: number;
  over: number;
  dy: number;
  /** The rows' tops and heights, measured when the drag began. */
  rects: Array<{ top: number; height: number }>;
};

/**
 * "Konten anordnen": the grouping (Nach Art, Nach Bank, Keine) and the order
 * within each group. A row is moved by its grip, or by resting a finger on
 * it, and with the keyboard by the grip's arrow keys; each change is kept in
 * the vault as it is made, so the sheet can be closed any way. A bottom sheet
 * on a phone, a dialog from 640px. `flat`: the desktop sidebar's list, which
 * has no groups — every account in one list, and no grouping to pick.
 */
export function ArrangeSheet({ onClose, flat = false }: { onClose: () => void; flat?: boolean }) {
  const { accounts, vault, arrangeAccounts, bankOf, banks, accountLabel, logoFiles } = useFints();
  const t = useT();
  const words = t.insights.accounts;
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState('');
  const grouping: AccountGrouping = flat ? 'none' : vault?.accountGrouping ?? 'type';
  const order = useMemo(() => orderAccounts(accounts, vault?.accountOrder).map((a) => a.accountNumber), [accounts, vault?.accountOrder]);
  const byKey = useMemo(() => new Map(accounts.map((a) => [a.accountNumber, a])), [accounts]);
  const severalBanks = new Set(accounts.map((a) => bankOf(a)?.key ?? 'primary')).size > 1;
  const groups = groupAccounts(
    order.map((n) => byKey.get(n)!).filter(Boolean),
    grouping,
    { kindOf: groupKindOf, bankOf: (a) => bankOf(a)?.key ?? 'primary', banks: banks.map((b) => b.key) },
  );

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);

  const move = (members: string[], from: number, to: number) => {
    const next = moveAccount(order, members, from, to);
    arrangeAccounts({ order: next });
    const name = accountLabel(byKey.get(members[from])!);
    setSaid(words.moved(name, to + 1, members.length));
  };

  /** Lifts a row: measures its group's rows, so the others can make room as it moves. */
  const lift = (key: string, group: AccountGroup<SerializedAccount>, startY: number) => {
    const members = group.accounts.map((a) => a.accountNumber);
    const rows = members.map((n) => listRef.current?.querySelector<HTMLElement>(`[data-order-row="${CSS.escape(n)}"]`));
    const rects = rows.map((r) => {
      const box = r?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
    const from = members.indexOf(key);
    startYRef.current = startY;
    setDrag({ key, group: group.key, members, from, over: from, dy: 0, rects });
    navigator.vibrate?.(10);
  };
  const startYRef = useRef(0);

  const follow = (y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = y - startYRef.current;
    const me = d.rects[d.from];
    const centre = me.top + me.height / 2 + dy;
    let over = d.from;
    // The place whose row the lifted one's middle has passed.
    for (let i = 0; i < d.rects.length; i++) {
      const r = d.rects[i];
      if (i < d.from && centre < r.top + r.height / 2) { over = i; break; }
      if (i > d.from && centre > r.top + r.height / 2) over = i;
    }
    setDrag({ ...d, dy, over });
  };

  const drop = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d && d.over !== d.from) move(d.members, d.from, d.over);
  };

  // While a row is lifted the page under the finger must not scroll.
  useEffect(() => {
    if (!drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, [drag]);

  const onGripDown = (e: ReactPointerEvent<HTMLElement>, key: string, group: AccountGroup<SerializedAccount>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lift(key, group, e.clientY);
  };

  const onRowDown = (e: ReactPointerEvent<HTMLElement>, key: string, group: AccountGroup<SerializedAccount>) => {
    if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('[data-grip]')) return;
    const target = e.currentTarget;
    const pointer = e.pointerId;
    const y = e.clientY;
    hold.current = {
      x: e.clientX,
      y,
      timer: window.setTimeout(() => {
        hold.current = null;
        try { target.setPointerCapture(pointer); } catch { /* the finger has left */ }
        lift(key, group, y);
      }, HOLD_MS),
    };
  };

  const onRowMove = (e: ReactPointerEvent<HTMLElement>) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP) {
      // A scroll, not a hold.
      clearTimeout(h.timer);
      hold.current = null;
    }
    if (dragRef.current) follow(e.clientY);
  };

  const onRowUp = () => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
    if (dragRef.current) drop();
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, key: string, members: string[]) => {
    const from = members.indexOf(key);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : -1;
    if (to < 0 || to >= members.length) return;
    e.preventDefault();
    move(members, from, to);
  };

  return (
    <Overlay open onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-hint`}>
      <Sheet
        onClose={onClose}
        className="select-none"
        footer={<Button variant="primary" className="w-full" onClick={onClose}>{words.done}</Button>}
      >
        <div data-arrange>
          <h2 id={`${id}-title`} className="text-[22px] leading-7 font-medium text-ink">{words.arrange}</h2>
          <p id={`${id}-hint`} className="mt-1 text-[14px] leading-5 text-ink-2">
            {words.arrangeHint}
            <span className="sr-only"> {words.arrangeKeys}</span>
          </p>

          {!flat && (
            <>
              <p className="mt-4 mb-2 text-[14px] leading-5 font-medium text-ink-2">{words.grouping}</p>
              <Segmented
                block
                aria-label={words.grouping}
                value={grouping}
                onChange={(g) => arrangeAccounts({ grouping: g })}
                options={GROUPINGS.map((g) => ({ value: g, label: words.groupings[g] }))}
              />
            </>
          )}

          <div ref={listRef} className="-mx-4 mt-2 sm:-mx-6">
            {groups.map((g) => {
              const members = g.accounts.map((a) => a.accountNumber);
              const entry = grouping === 'bank' ? banks.find((b) => b.key === g.key) ?? null : null;
              const title = g.kind ? words.groups[g.kind] : entry?.bank.name ?? null;
              const lifted = drag?.group === g.key ? drag : null;
              return (
                <section key={g.key} aria-label={title ?? t.common.account.accounts}>
                  {title && grouping !== 'none' && (
                    <h3 className="px-4 pt-3.5 pb-1 text-[14px] leading-5 font-medium text-ink-2 sm:px-6">{title}</h3>
                  )}
                  <ul>
                    {g.accounts.map((a, i) => {
                      const key = a.accountNumber;
                      const isLifted = lifted?.key === key;
                      // The others make room: each row between the lifted one's place and where it is over moves a row's height.
                      let shift = 0;
                      if (lifted && !isLifted) {
                        const h = lifted.rects[lifted.from].height;
                        if (lifted.from < lifted.over && i > lifted.from && i <= lifted.over) shift = -h;
                        if (lifted.from > lifted.over && i < lifted.from && i >= lifted.over) shift = h;
                      }
                      const entryOf = bankOf(a);
                      const ident = accountIdent(a);
                      return (
                        <li
                          key={key}
                          data-order-row={key}
                          onPointerDown={(e) => onRowDown(e, key, g)}
                          onPointerMove={onRowMove}
                          onPointerUp={onRowUp}
                          onPointerCancel={onRowUp}
                          // A held finger brings up no menu of its own.
                          onContextMenu={(e) => e.preventDefault()}
                          style={{
                            transform: isLifted ? `translateY(${lifted!.dy}px) rotate(-0.6deg)` : shift ? `translateY(${shift}px)` : undefined,
                            // Only while a row is lifted: once it is dropped, the new order puts every row where it already stands.
                            transition: lifted && !isLifted ? 'transform var(--m3e-spatial-fast-ms) var(--m3e-spatial-fast)' : undefined,
                          }}
                          className={cx(
                            'relative grid min-h-16 grid-cols-[24px_40px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 pr-4 pl-3 sm:pr-6 sm:pl-5',
                            isLifted && 'z-10 mx-2 rounded-[16px] bg-paper pr-2 pl-1 shadow-[var(--shadow-pop)] sm:pr-4 sm:pl-3',
                          )}
                        >
                          <button
                            type="button"
                            data-grip
                            aria-label={words.move(accountLabel(a))}
                            aria-describedby={`${id}-hint`}
                            onPointerDown={(e) => onGripDown(e, key, g)}
                            onKeyDown={(e) => onGripKey(e, key, members)}
                            className="-m-3 grid size-12 cursor-grab touch-none place-items-center rounded-full text-ink-2 outline-offset-[-4px] active:cursor-grabbing"
                          >
                            <DragIcon size={24} />
                          </button>
                          <AccountDisc account={a} entry={severalBanks ? entryOf : null} logoFile={entryOf ? logoFiles[entryOf.bank.brand] : undefined} />
                          <span className="min-w-0">
                            <span className="block truncate text-[16px] leading-[22px] font-medium text-ink">{accountLabel(a)}</span>
                            {/* The end of its number tells it apart; the disc's mark already names its bank. */}
                            <span className="block truncate text-[14px] leading-5 text-ink-2">
                              {ident.tail && !isDepot(a) ? (
                                <span className="iban text-[13px]">{ident.kind === 'card' ? `${words.card} ` : ''}··· {ident.tail}</span>
                              ) : entryOf?.bank.name}
                            </span>
                          </span>
                          <ArrangeFigure account={a} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          <p role="status" className="sr-only">{said}</p>
        </div>
      </Sheet>
    </Overlay>
  );
}

/** A row's figure in the sheet, as far as this session knows it. */
function ArrangeFigure({ account }: { account: SerializedAccount }) {
  const { balances, portfolios } = useFints();
  const acct = account.accountNumber;
  const value = isDepot(account) ? portfolios[acct]?.totalValue : balances[acct]?.balance;
  const currency = isDepot(account) ? portfolios[acct]?.currency : balances[acct]?.currency;
  if (value == null) return <span />;
  return <Money value={value} currency={currency} tone="plain" className="text-right text-[14px] leading-5 font-medium text-ink" />;
}
