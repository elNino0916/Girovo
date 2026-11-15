'use client';

// Konten anordnen: how the accounts overview groups the accounts and orders
// them within each group, kept in the vault.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { OWN_GROUP_LIMITS, REST_GROUP, cleanGroupName } from '@/lib/account-groups';
import {
  MAX_ORDER, type AccountGroup, type AccountGrouping, GROUPINGS, groupAccounts, groupKindOf, moveAccount, orderAccounts,
} from '@/lib/account-overview';
import { isDepot } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { ChevronIcon, DragIcon, EyeIcon, EyeOffIcon, MoreIcon, PencilIcon, PlusIcon, TrashIcon } from '../icons';
import {
  Button, Dialog, Field, IconButton, Input, Menu, MenuGroup, MenuItem, Overlay, Segmented, Sheet, cx, useFocusWhenDrawn,
} from '../ui';
import { accountIdent } from './AccountIdentity';
import { AccountDisc } from './AccountMarks';
import { useOwnGroups } from './own-groups';

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
 * With "Eigene" a row can go into another group: the places it can be put,
 * measured when the drag began — a place in a group's list of the other rows
 * (`index`) and where it is on screen (`y`, a line between two rows).
 */
type Slot = { group: string; index: number; y: number };
type OwnDrag = {
  key: string;
  group: string;
  /** Its place among its group's rows. */
  from: number;
  dy: number;
  /** The lifted row's middle when the drag began. */
  centre: number;
  slots: Slot[];
  /** The list's top, for the line that marks the place. */
  top: number;
  target: Slot | null;
};

/** "Konten anordnen" in the desktop frame: no groups, or the user's own. */
type FrameGrouping = 'none' | 'own';
const FRAME_GROUPINGS: readonly FrameGrouping[] = ['none', 'own'];

/**
 * "Konten anordnen": the grouping (Nach Art, Nach Bank, Keine) and the order
 * within each group. A row is moved by its grip, or by resting a finger on
 * it, and with the keyboard by the grip's arrow keys; each change is kept in
 * the vault as it is made, so the sheet can be closed any way. A bottom sheet
 * on a phone, a dialog from 640px. `flat`: the desktop sidebar's list, which
 * has no Nach Art or Nach Bank: one list (Keine), or the user's own groups
 * (Eigene, Girovo Next, lib/account-groups.ts) with a menu on each group's
 * head (Umbenennen, Nach oben, Nach unten, Gruppe löschen) and on each row
 * (Verschieben nach), "Neue Gruppe", and rows dragged from group to group.
 * The phone's layout never offers Eigene.
 */
export function ArrangeSheet({ onClose, flat = false }: { onClose: () => void; flat?: boolean }) {
  const { accounts, vault, arrangeAccounts, bankOf, banks, accountLabel, logoFiles, accountsHidden, setAccountsHidden } = useFints();
  const t = useT();
  const words = t.insights.accounts;
  const ownWords = words.ownGroups;
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState('');
  const own = useOwnGroups();
  const ownMode = flat && own.on;
  const grouping: AccountGrouping = flat ? 'none' : vault?.accountGrouping ?? 'type';
  const order = useMemo(() => orderAccounts(accounts, vault?.accountOrder).map((a) => a.accountNumber), [accounts, vault?.accountOrder]);
  const byKey = useMemo(() => new Map(accounts.map((a) => [a.accountNumber, a])), [accounts]);
  const severalBanks = new Set(accounts.map((a) => bankOf(a)?.key ?? 'primary')).size > 1;
  const groups: AccountGroup<SerializedAccount>[] = ownMode
    ? own.shown.map((g) => ({ key: g.id, kind: null, accounts: g.accounts }))
    : groupAccounts(
      order.map((n) => byKey.get(n)!).filter(Boolean),
      grouping,
      { kindOf: groupKindOf, bankOf: (a) => bankOf(a)?.key ?? 'primary', banks: banks.map((b) => b.key) },
    );
  /** A shown own group's name: the user's, or "Weitere Konten". */
  const ownName = (key: string) => own.nameOf(own.shown.find((g) => g.id === key) ?? own.groups.find((g) => g.id === key) ?? { name: null });
  // Where a row can go with "Verschieben nach": every group, and Weitere Konten.
  const targets = [...own.groups.map((g) => ({ id: g.id, name: g.name })), { id: REST_GROUP, name: words.groups.other }];

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [ownDrag, setOwnDrag] = useState<OwnDrag | null>(null);
  const ownDragRef = useRef<OwnDrag | null>(null);
  ownDragRef.current = ownDrag;
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);

  /** After a move the row may be drawn anew (another group) or its node moved, which drops focus: its grip takes it back. */
  const keepGrip = (key: string) => {
    window.setTimeout(() => {
      const grip = listRef.current?.querySelector<HTMLElement>(`[data-order-row="${CSS.escape(key)}"] [data-grip]`);
      if (grip && document.activeElement !== grip) grip.focus({ preventScroll: false });
    }, 0);
  };

  const move = (members: string[], from: number, to: number) => {
    const next = moveAccount(order, members, from, to);
    arrangeAccounts({ order: next });
    const name = accountLabel(byKey.get(members[from])!);
    setSaid(words.moved(name, to + 1, members.length));
    if (ownMode) keepGrip(members[from]);
  };

  /**
   * With "Eigene": an account put at `index` among the rows of group
   * `target` (counted without it). In its own group a move to another place;
   * Weitere Konten keeps its order in the order of every account.
   */
  const place = (key: string, target: string, index: number) => {
    const from = groups.find((g) => g.accounts.some((a) => a.accountNumber === key));
    const dest = groups.find((g) => g.key === target);
    const others = (dest?.accounts ?? []).map((a) => a.accountNumber).filter((k) => k !== key);
    const at = Math.max(0, Math.min(index, others.length));
    const name = accountLabel(byKey.get(key)!);
    if (from?.key === target) {
      const members = from.accounts.map((a) => a.accountNumber);
      const was = members.indexOf(key);
      if (was === at) return;
      if (target === REST_GROUP) move(members, was, at);
      else {
        own.reorder(target, [...others.slice(0, at), key, ...others.slice(at)]);
        setSaid(words.moved(name, at + 1, members.length));
        keepGrip(key);
      }
      return;
    }
    // One account more than the groups can keep (lib/account-groups.ts moveIntoGroup refuses it): nothing to say.
    const grouped = own.groups.reduce((n, x) => n + x.accounts.length, 0);
    if (target !== REST_GROUP && from?.key === REST_GROUP && grouped >= MAX_ORDER) return;
    if (target === REST_GROUP) {
      own.moveInto(key, REST_GROUP);
      // Weitere Konten follows the order of every account: the account takes its place there.
      const rest = new Set(others);
      const members = order.filter((k) => rest.has(k) || k === key);
      arrangeAccounts({ order: moveAccount(order, members, members.indexOf(key), at) });
    } else {
      own.moveInto(key, target, others[at] ?? null);
    }
    setSaid(ownWords.movedTo(name, ownName(target)));
    // In another group the row is drawn anew: its grip takes the focus (the arrow keys go on, the menu's ⋯ is gone).
    keepGrip(key);
  };

  /** Lifts a row: measures its group's rows, so the others can make room as it moves. */
  const lift = (key: string, group: AccountGroup<SerializedAccount>, startY: number) => {
    startYRef.current = startY;
    navigator.vibrate?.(10);
    if (ownMode) {
      liftOwn(key, group);
      return;
    }
    const members = group.accounts.map((a) => a.accountNumber);
    const rows = members.map((n) => listRef.current?.querySelector<HTMLElement>(`[data-order-row="${CSS.escape(n)}"]`));
    const rects = rows.map((r) => {
      const box = r?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
    const from = members.indexOf(key);
    setDrag({ key, group: group.key, members, from, over: from, dy: 0, rects });
  };
  const startYRef = useRef(0);

  /** With "Eigene": every place in every group the row could go, measured once. */
  const liftOwn = (key: string, group: AccountGroup<SerializedAccount>) => {
    const list = listRef.current;
    if (!list) return;
    const box = (el: Element | null | undefined) => el?.getBoundingClientRect();
    const me = box(list.querySelector(`[data-order-row="${CSS.escape(key)}"]`));
    const slots: Slot[] = [];
    for (const g of groups) {
      const keys = g.accounts.map((a) => a.accountNumber).filter((k) => k !== key);
      const rows = keys.map((k) => box(list.querySelector(`[data-order-row="${CSS.escape(k)}"]`)));
      if (!rows.length) {
        const body = box(list.querySelector(`[data-own-drop="${CSS.escape(g.key)}"]`));
        if (body) slots.push({ group: g.key, index: 0, y: body.top + body.height / 2 });
        continue;
      }
      rows.forEach((r, i) => { if (r) slots.push({ group: g.key, index: i, y: r.top }); });
      const last = rows[rows.length - 1];
      if (last) slots.push({ group: g.key, index: rows.length, y: last.bottom });
    }
    const from = group.accounts.findIndex((a) => a.accountNumber === key);
    setOwnDrag({
      key, group: group.key, from, dy: 0, centre: me ? me.top + me.height / 2 : startYRef.current,
      slots, top: box(list)?.top ?? 0, target: null,
    });
  };

  const follow = (y: number) => {
    const o = ownDragRef.current;
    if (o) {
      const dy = y - startYRef.current;
      const at = o.centre + dy;
      let target: Slot | null = null;
      for (const s of o.slots) if (!target || Math.abs(s.y - at) < Math.abs(target.y - at)) target = s;
      setOwnDrag({ ...o, dy, target });
      return;
    }
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
    const o = ownDragRef.current;
    if (o) {
      setOwnDrag(null);
      if (o.target && !(o.target.group === o.group && o.target.index === o.from)) place(o.key, o.target.group, o.target.index);
      return;
    }
    const d = dragRef.current;
    setDrag(null);
    if (d && d.over !== d.from) move(d.members, d.from, d.over);
  };

  // While a row is lifted the page under the finger must not scroll.
  const lifted = !!drag || !!ownDrag;
  useEffect(() => {
    if (!lifted) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, [lifted]);

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
    if (dragRef.current || ownDragRef.current) follow(e.clientY);
  };

  const onRowUp = () => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
    if (dragRef.current || ownDragRef.current) drop();
  };

  // The eye (not in the desktop sidebar's list, whose tick boxes do this):
  // an account out of the overview and the Gesamtsaldo, kept on this device.
  // The last one shown can't go.
  const hidden = new Set(accountsHidden);
  const shownLeft = accounts.filter((a) => !hidden.has(a.accountNumber)).length;
  const toggleHidden = (a: SerializedAccount) => {
    const key = a.accountNumber;
    const hide = !hidden.has(key);
    setAccountsHidden((current) => {
      const rest = current.filter((x) => x !== key);
      return hide ? [...rest, key] : rest;
    });
    setSaid(hide ? words.hide(accountLabel(a)) : words.show(accountLabel(a)));
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, key: string, members: string[], group: string) => {
    const from = members.indexOf(key);
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    if (ownMode) {
      e.preventDefault();
      const to = from + step;
      if (to >= 0 && to < members.length) {
        place(key, group, to);
        return;
      }
      // Past its group's edge: to the end of the group above, or the start of the one below.
      const gi = groups.findIndex((g) => g.key === group);
      const next = groups[gi + step];
      if (next) place(key, next.key, step < 0 ? next.accounts.length : 0);
      return;
    }
    const to = from + step;
    if (to < 0 || to >= members.length) return;
    e.preventDefault();
    move(members, from, to);
  };

  // A group's head: its menu's changes, said to a screen reader too.
  const ownIndex = (gid: string) => own.groups.findIndex((g) => g.id === gid);
  const shiftGroup = (gid: string, step: number) => {
    const to = ownIndex(gid) + step;
    own.moveGroupTo(gid, to);
    setSaid(words.moved(ownName(gid), to + 1, own.groups.length));
  };
  const addRef = useRef<HTMLElement>(null);
  const removeGroup = (gid: string) => {
    const name = ownName(gid);
    const had = !!own.shown.find((x) => x.id === gid)?.accounts.length;
    own.remove(gid);
    setSaid(had ? ownWords.removedMoved(name, words.groups.other) : ownWords.removed(name));
    // The menu leaves with its ⋯: focus stays in the sheet, on the way to a new group.
    window.setTimeout(() => addRef.current?.focus({ preventScroll: true }), 0);
  };
  const saveName = (name: string) => {
    if (!naming) return;
    if (naming.id) own.rename(naming.id, name);
    else if (own.add(name)) setSaid(ownWords.added(cleanGroupName(name)));
    setNaming(null);
  };

  const indicator = ownDrag?.target ? ownDrag.target.y - ownDrag.top : null;

  return (
    <>
      <Overlay open onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-hint`}>
        <Sheet
          onClose={onClose}
          className="select-none"
          footer={<Button variant="primary" className="w-full" onClick={onClose}>{words.done}</Button>}
        >
          <div data-arrange>
            <h2 id={`${id}-title`} className="text-[22px] leading-7 font-medium text-ink">{words.arrange}</h2>
            <p id={`${id}-hint`} className="mt-1 text-[14px] leading-5 text-ink-2">
              {ownMode ? ownWords.hint : words.arrangeHint}
              {!flat && ` ${words.hideHint}`}
              <span className="sr-only"> {words.arrangeKeys}</span>
            </p>

            <p className="mt-4 mb-2 text-[14px] leading-5 font-medium text-ink-2">{words.grouping}</p>
            {flat ? (
              <Segmented
                block
                aria-label={words.grouping}
                value={ownMode ? 'own' : 'none'}
                onChange={(g: FrameGrouping) => own.setOn(g === 'own')}
                options={FRAME_GROUPINGS.map((g) => ({ value: g, label: words.groupings[g] }))}
              />
            ) : (
              <Segmented
                block
                aria-label={words.grouping}
                value={grouping}
                onChange={(g) => arrangeAccounts({ grouping: g })}
                options={GROUPINGS.map((g) => ({ value: g, label: words.groupings[g] }))}
              />
            )}

            <div ref={listRef} className="relative -mx-4 mt-2 sm:-mx-6">
              {groups.map((g, gi) => {
                const members = g.accounts.map((a) => a.accountNumber);
                const entry = grouping === 'bank' ? banks.find((b) => b.key === g.key) ?? null : null;
                const title = ownMode ? ownName(g.key) : g.kind ? words.groups[g.kind] : entry?.bank.name ?? null;
                const rowsLifted = drag?.group === g.key ? drag : null;
                const ownGroup = ownMode && g.key !== REST_GROUP;
                const at = ownIndex(g.key);
                return (
                  <section key={g.key} data-own-group={ownMode ? g.key : undefined} aria-label={title ?? t.common.account.accounts}>
                    {title && grouping !== 'none' && !ownMode && (
                      <h3 className="px-4 pt-3.5 pb-1 text-[14px] leading-5 font-medium text-ink-2 sm:px-6">{title}</h3>
                    )}
                    {title && ownMode && (
                      <div className="flex min-h-12 items-center gap-2 pt-1.5 pr-2 pl-4 sm:pr-4 sm:pl-6">
                        <h3 className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-ink-2">{title}</h3>
                        {ownGroup && (
                          <Menu
                            placement="bottom-end"
                            minWidth={200}
                            label={ownWords.moreFor(title)}
                            trigger={(p) => (
                              <IconButton {...p} size="md" aria-label={ownWords.moreFor(title)} title={ownWords.moreFor(title)}>
                                <MoreIcon size={20} />
                              </IconButton>
                            )}
                          >
                            {/* The menu gives focus back to the ⋯, the dialog takes it from there and gives it back to it. */}
                            <MenuItem icon={<PencilIcon size={18} />} onSelect={() => setNaming({ id: g.key, name: title })}>
                              {ownWords.rename}
                            </MenuItem>
                            <MenuItem icon={<ChevronIcon dir="up" size={18} />} disabled={at <= 0} onSelect={() => shiftGroup(g.key, -1)}>
                              {ownWords.up}
                            </MenuItem>
                            <MenuItem icon={<ChevronIcon dir="down" size={18} />} disabled={at < 0 || at >= own.groups.length - 1} onSelect={() => shiftGroup(g.key, 1)}>
                              {ownWords.down}
                            </MenuItem>
                            {/* keepOpen: the group's ⋯ goes with it, so focus goes to "Neue Gruppe" (removeGroup). */}
                            <MenuItem icon={<TrashIcon size={18} />} tone="danger" keepOpen onSelect={() => removeGroup(g.key)}>
                              {ownWords.remove}
                            </MenuItem>
                          </Menu>
                        )}
                      </div>
                    )}
                    <ul data-own-drop={ownMode ? g.key : undefined} className={cx(ownMode && gi === groups.length - 1 && 'pb-1')}>
                      {ownMode && !g.accounts.length && (
                        <li className="px-4 py-3 text-[14px] leading-5 text-ink-2 sm:px-6">{ownWords.empty}</li>
                      )}
                      {g.accounts.map((a, i) => {
                        const key = a.accountNumber;
                        const isLifted = rowsLifted?.key === key || ownDrag?.key === key;
                        const dy = rowsLifted?.key === key ? rowsLifted.dy : ownDrag?.key === key ? ownDrag.dy : 0;
                        // The others make room: each row between the lifted one's place and where it is over moves a row's height.
                        let shift = 0;
                        if (rowsLifted && !isLifted) {
                          const h = rowsLifted.rects[rowsLifted.from].height;
                          if (rowsLifted.from < rowsLifted.over && i > rowsLifted.from && i <= rowsLifted.over) shift = -h;
                          if (rowsLifted.from > rowsLifted.over && i < rowsLifted.from && i >= rowsLifted.over) shift = h;
                        }
                        const entryOf = bankOf(a);
                        const ident = accountIdent(a);
                        const off = !flat && hidden.has(key);
                        const label = accountLabel(a);
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
                              transform: isLifted ? `translateY(${dy}px) rotate(-0.6deg)` : shift ? `translateY(${shift}px)` : undefined,
                              // Only while a row is lifted: once it is dropped, the new order puts every row where it already stands.
                              transition: rowsLifted && !isLifted ? 'transform var(--m3e-spatial-fast-ms) var(--m3e-spatial-fast)' : undefined,
                            }}
                            className={cx(
                              'relative grid min-h-16 items-center gap-x-3 py-2 pr-4 pl-3 sm:pr-6 sm:pl-5',
                              flat && !ownMode && 'grid-cols-[24px_40px_minmax(0,1fr)_auto]',
                              (!flat || ownMode) && 'grid-cols-[24px_40px_minmax(0,1fr)_auto_auto] pr-2 sm:pr-4',
                              isLifted && 'z-10 mx-2 rounded-[16px] bg-paper pr-2 pl-1 shadow-[var(--shadow-pop)] sm:pr-4 sm:pl-3',
                            )}
                          >
                            <button
                              type="button"
                              data-grip
                              aria-label={words.move(label)}
                              aria-describedby={`${id}-hint`}
                              onPointerDown={(e) => onGripDown(e, key, g)}
                              onKeyDown={(e) => onGripKey(e, key, members, g.key)}
                              className="-m-3 grid size-12 cursor-grab touch-none place-items-center rounded-full text-ink-2 outline-offset-[-4px] active:cursor-grabbing"
                            >
                              <DragIcon size={24} />
                            </button>
                            <span className={cx('contents', off && '[&>*]:opacity-50')}>
                            <AccountDisc account={a} entry={severalBanks ? entryOf : null} logoFile={entryOf ? logoFiles[entryOf.bank.brand] : undefined} />
                            <span className="min-w-0">
                              <span className="block truncate text-[16px] leading-[22px] font-medium text-ink">{label}</span>
                              {/* The end of its number tells it apart; the disc's mark already names its bank. */}
                              <span className="block truncate text-[14px] leading-5 text-ink-2">
                                {ident.tail && !isDepot(a) ? (
                                  <span className="iban text-[13px]">{ident.kind === 'card' ? `${words.card} ` : ''}··· {ident.tail}</span>
                                ) : entryOf?.bank.name}
                              </span>
                            </span>
                            <ArrangeFigure account={a} />
                            </span>
                            {ownMode ? (
                              <Menu
                                placement="bottom-end"
                                minWidth={200}
                                label={ownWords.moveToFor(label)}
                                trigger={(p) => (
                                  <IconButton {...p} size="md" aria-label={ownWords.moveToFor(label)} title={ownWords.moveToFor(label)}>
                                    <MoreIcon size={20} />
                                  </IconButton>
                                )}
                              >
                                <MenuGroup label={ownWords.moveTo}>
                                  {/* keepOpen: the row and its ⋯ are drawn anew in the other group, and its grip takes the focus (place). */}
                                  {targets.filter((x) => x.id !== g.key).map((x) => (
                                    <MenuItem key={x.id} keepOpen onSelect={() => place(key, x.id, Number.MAX_SAFE_INTEGER)}>{x.name}</MenuItem>
                                  ))}
                                </MenuGroup>
                              </Menu>
                            ) : !flat && (
                              <IconButton
                                size="md"
                                aria-label={off ? words.show(label) : words.hide(label)}
                                title={off ? words.show(label) : words.hide(label)}
                                disabled={!off && shownLeft <= 1}
                                onClick={() => toggleHidden(a)}
                              >
                                {off ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                              </IconButton>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {/* Where a row dragged with "Eigene" will go. */}
              {indicator != null && (
                <div aria-hidden className="pointer-events-none absolute right-4 left-4 z-20 h-0.5 rounded-full bg-[var(--md-primary)] sm:right-6 sm:left-6" style={{ top: indicator - 1 }} />
              )}
            </div>
            {ownMode && (
              <Button
                ref={addRef}
                variant="tertiary"
                size="sm"
                className="mt-2 -ml-3"
                iconLeft={<PlusIcon size={16} />}
                disabled={own.groups.length >= OWN_GROUP_LIMITS.groups}
                aria-haspopup="dialog"
                onClick={() => setNaming({ id: null, name: '' })}
              >
                {ownWords.add}
              </Button>
            )}
            <p role="status" className="sr-only">{said}</p>
          </div>
        </Sheet>
      </Overlay>
      {naming && (
        <GroupNameDialog
          title={naming.id ? ownWords.renameTitle : ownWords.add}
          initial={naming.name}
          onSave={saveName}
          onClose={() => setNaming(null)}
        />
      )}
    </>
  );
}

/** A group's name, new or changed: one field, saved with Enter or "Speichern". */
function GroupNameDialog({ title, initial, onSave, onClose }: {
  title: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const words = t.insights.accounts.ownGroups;
  const fieldId = useId();
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useFocusWhenDrawn(input);
  const ok = draft.trim().length > 0;
  const save = () => {
    if (ok) onSave(draft);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={(
        <>
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" disabled={!ok} onClick={save}>{t.common.save}</Button>
        </>
      )}
    >
      <Field label={words.name} htmlFor={fieldId}>
        <Input
          id={fieldId}
          ref={input}
          value={draft}
          maxLength={OWN_GROUP_LIMITS.name}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
        />
      </Field>
    </Dialog>
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
