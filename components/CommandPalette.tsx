'use client';

// "Suche" — one field for everything the dashboard can do.
//
// Strg+K / ⌘K, the masthead's Suche and the phone's "Mehr" open it. It finds
// three kinds of things, always in this order so the eye learns where to
// look: Aktionen (everything a button elsewhere does), Konten (switch to one)
// and Umsätze (bookings already loaded in this session, by name, purpose,
// IBAN or amount — the same matcher as the Umsätze search). Choosing a
// booking opens the Umsätze list filtered to what was typed, on the booking's
// account when that is answered from the cache.
//
// "Abmelden" is the one entry that ends something, so it stands apart, last,
// under "Sitzung", and answers only a deliberate query: the start of its name
// on screen from three letters ("abm", "log" for "Log out"), or one of its
// words in full, German or English ("logout", "ausloggen", "sign out") —
// never "ab" (Abos, an Abbuchung) or a fuzzy hit like "logo" or "med", which
// could leave it alone and preselected (lib/palette.ts). With nothing typed
// it is listed too — on a phone, "Mehr" is where people look for it.
//
// Commands are found by their words in the language on screen; on an
// English screen their German names and words find them too.
//
// Nothing here bypasses anything: Überweisen opens the transfer sheet with
// its review, Namensabgleich and TAN. Choosing a Konto is a switch like any
// other (it may load). Choosing a booking is "show me", and that never reads
// from the bank: when its account was loaded for another range (or before
// midnight), the list opens on the current account, says whose booking it
// was and offers the switch — with the note that it may need an approval.
//
// ARIA: the input is a combobox that owns a listbox; arrow keys move the
// active option (aria-activedescendant), focus never leaves the field.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { txMatcher } from '@/lib/analytics';
import { dayKey, fmtDate, initials, translateType } from '@/lib/format';
import { MESSAGES, msgs, type Messages } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/react';
import { paletteResults } from '@/lib/palette';
import { setThemePref } from '@/lib/theme';
import type { DashboardTab } from '@/lib/app-types';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { useFints } from './FintsProvider';
import { isCardAccount } from '@/lib/balances';
import { Money } from './Money';
import { useThemePref } from './ThemeToggle';
import {
  AccountTypeIcon, BellIcon, ChartIcon, CheckIcon, CloseIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileIcon, HomeIcon,
  KeyboardIcon, LogoutIcon, MonitorIcon, MoonIcon, QrIcon, RefreshIcon, RepeatIcon, SearchIcon, SunIcon, TransferIcon,
} from './icons';
import { EmptyState, IconButton, Kbd, Overlay, cx } from './ui';
import { searchText, txText } from './transactions/model';
import { useShellActions, useShowOnAccount } from './shell/actions';
import { hasNewer, updates, useUpdates } from './updates/store';
import { privacyNotice } from './shell/useShortcuts';
import { ShortIban } from './overview/AccountIdentity';

type Group = 'actions' | 'accounts' | 'transactions' | 'session';

type Item = {
  id: string;
  group: Group;
  label: string;
  description?: ReactNode;
  icon: ReactNode;
  /** Right edge: a shortcut, a balance, an amount. */
  hint?: ReactNode;
  keywords?: string[];
  /** Shown before anything is typed. */
  featured?: boolean;
  /** Identifiers (IBAN, account number): matched as a run of characters, never fuzzily. */
  ids?: string[];
  /** Ends something: listed last, and only for a deliberate query (lib/palette.ts). */
  lastResort?: boolean;
  run: () => void;
};

/** A command's own search words in lib/i18n/messages/shell.ts. */
type WordsId = keyof Messages['shell']['palette']['words'];

const GROUP_ORDER: readonly Group[] = ['actions', 'accounts', 'transactions', 'session'];
const MAX_TX = 6;
const MIN_TX_QUERY = 2;

/**
 * Abmelden's words, whichever language is on screen: each answers when typed
 * in full (lib/palette.ts), German and English alike — never the start of
 * one, never a fuzzy hit. Its name in the language on screen answers from
 * three letters on.
 */
// i18n-data-start — search words, never shown
const LOGOUT_WORDS = ['logout', 'log out', 'sign out', 'session', 'abmelden', 'ausloggen', 'abmeldung', 'sitzung beenden'];
// i18n-data-end

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useFints();
  const t = useT();
  return (
    <Overlay open={paletteOpen} onClose={() => setPaletteOpen(false)} label={t.common.search}>
      <Palette onClose={() => setPaletteOpen(false)} />
    </Overlay>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const f = useFints();
  const tr = useT();
  const { locale } = useLocale();
  const a = useShellActions();
  const showOnAccount = useShowOnAccount();
  const themePref = useThemePref();
  const { state: update } = useUpdates();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const downOnBackdrop = useRef(false);
  const base = useId();
  const listId = `${base}-list`;
  const optId = (i: number) => `${base}-opt-${i}`;

  /**
   * Closes the palette, then runs the choice once it is gone: an action that
   * opens another layer must find focus back where it was before the palette,
   * so that layer returns it there too.
   */
  const choose = (item: Item) => {
    onClose();
    // A task, not a frame: React has committed the close by then, and a
    // timer still runs when the window is in the background.
    setTimeout(item.run, 0);
  };

  const actions = useMemo<Item[]>(() => {
    const p = tr.shell.palette;
    const de = MESSAGES.de;
    /**
     * A command's name and the words that find it: its own in the language on
     * screen, and — when that is not German — its German name and words as
     * well, so a German query finds it whatever the app speaks.
     * `extra`: words of this one entry (a theme's own name).
     */
    const named = (name: (m: Messages) => string, words: WordsId, extra: string[] = []) => ({
      label: name(tr),
      keywords: locale === 'de'
        ? [...p.words[words], ...extra]
        : [...p.words[words], ...extra, name(de), ...de.shell.palette.words[words]],
    });
    // A one-key hint only while those keys work (they can be switched off).
    const single = (keys: string[]) => (f.singleKeyShortcuts ? <KeyHint keys={keys} /> : undefined);
    // The sections are one press away in the institute bar (and the phone's
    // bottom bar), so they are found by typing, not listed up front.
    const tab = (t: DashboardTab, icon: ReactNode, key: string): Item => ({
      id: `tab-${t}`, group: 'actions', ...named((m) => m.common.nav[t], t), icon,
      hint: <KeyHint keys={['Alt', key]} />,
      description: f.tab === t ? p.youAreHere : undefined,
      run: () => f.setTab(t),
    });
    const theme = (pref: 'light' | 'dark' | 'system', icon: ReactNode): Item => ({
      id: `theme-${pref}`, group: 'actions',
      ...named((m) => m.shell.theme.current(m.common.theme[pref]), 'theme', [tr.common.theme[pref]]), icon,
      description: themePref === pref ? p.currentSetting : undefined,
      run: () => setThemePref(pref),
    });
    const list: (Item | false)[] = [
      a.canTransfer && {
        id: 'transfer', group: 'actions', ...named((m) => m.shell.transfer, 'transfer'), icon: <TransferIcon />, featured: true,
        hint: single(['N']),
        run: a.transfer,
      },
      a.canShare && {
        id: 'share', group: 'actions', ...named((m) => m.shell.requestMoney, 'share'), icon: <QrIcon />, featured: true,
        description: p.shareHint,
        run: a.share,
      },
      {
        // Not listed up front: this field already searches the Umsätze.
        id: 'search', group: 'actions', ...named((m) => m.shell.searchTransactions, 'search'), icon: <SearchIcon size={18} />,
        hint: single(['/']),
        run: a.focusSearch,
      },
      a.canStatement && {
        id: 'statement', group: 'actions', ...named((m) => m.shell.statementPdf, 'statement'), icon: <FileIcon />, featured: true,
        description: a.rangeLabel,
        run: a.statement,
      },
      a.canExport && {
        id: 'csv', group: 'actions', ...named((m) => m.shell.palette.csv, 'csv'), icon: <DownloadIcon />,
        description: p.csvNote(a.rangeLabel),
        run: a.exportCsv,
      },
      {
        id: 'privacy', group: 'actions', ...named((m) => (f.privacy ? m.common.showAmounts : m.common.hideAmounts), 'privacy'),
        icon: f.privacy ? <EyeIcon /> : <EyeOffIcon />, featured: true,
        hint: single(['B']),
        run: () => {
          const hidden = !f.privacy;
          f.togglePrivacy();
          // Every figure changes at once, behind the closing palette: said
          // too, for whoever cannot see that happen.
          f.toast(privacyNotice(hidden, f.singleKeyShortcuts), 'info');
        },
      },
      {
        id: 'inbox', group: 'actions', ...named((m) => m.common.nav.messages, 'inbox'), icon: <BellIcon />, featured: true,
        description: f.unreadCount ? tr.shell.unread(f.unreadCount) : p.inboxHint,
        run: () => f.setInboxOpen(true),
      },
      tab('overview', <HomeIcon />, '1'),
      tab('analysis', <ChartIcon />, '2'),
      tab('contracts', <RepeatIcon />, '3'),
      theme('light', <SunIcon />),
      theme('dark', <MoonIcon />),
      theme('system', <MonitorIcon />),
      {
        id: 'single-keys', group: 'actions',
        ...named((m) => (f.singleKeyShortcuts ? m.shell.singleKeys.turnOff : m.shell.singleKeys.turnOn), 'singleKeys'),
        icon: <KeyboardIcon />,
        description: tr.shell.singleKeys.keys,
        run: () => {
          const on = !f.singleKeyShortcuts;
          f.setSingleKeyShortcuts(on);
          // Nothing on screen changes; the toast is the only answer.
          const say = msgs().shell.singleKeys;
          f.toast(on ? say.nowOn : say.nowOff, 'success');
        },
      },
      // Desktop app only. Opening the dialog is the action; with nothing new
      // known yet, it also asks.
      !!update && {
        id: 'updates', group: 'actions',
        ...named((m) => (hasNewer(update) ? m.shell.palette.updateTo(update.release.version) : m.shell.checkForUpdates), 'updates'),
        icon: hasNewer(update) ? <DownloadIcon /> : <RefreshIcon />,
        description: p.installed(update.current),
        run: () => {
          if (!hasNewer(update)) void updates.check();
          updates.openDialog();
        },
      },
      {
        id: 'shortcuts', group: 'actions', ...named((m) => m.common.shortcuts, 'shortcuts'), icon: <KeyboardIcon />,
        hint: single(['?']),
        run: () => f.setShortcutsOpen(true),
      },
      {
        // Its name in the language on screen, its words in both (LOGOUT_WORDS).
        id: 'logout', group: 'session', label: tr.common.logout, icon: <LogoutIcon />, featured: true, lastResort: true,
        keywords: LOGOUT_WORDS,
        // Asks first only while this session holds a transfer whose status is unclear.
        run: f.requestLogout,
      },
    ];
    return list.filter((x): x is Item => !!x);
  }, [a, f, themePref, update, tr, locale]);

  const accounts = useMemo<Item[]>(() => f.accounts.map((acct, i) => {
    const balance = f.balances[acct.accountNumber];
    const isActive = acct.accountNumber === f.activeAccount?.accountNumber;
    return {
      id: `acct-${acct.accountNumber}`,
      group: 'accounts',
      label: f.accountLabel(acct),
      icon: <AccountTypeIcon type={acct.accountType} product={acct.product} />,
      featured: true,
      // As the account list shows it: "DE62 ··· 5932 71", a card as "4930 •••• •••• 1234".
      description: <ShortIban account={acct} />,
      hint: (
        <span className="flex items-center gap-3">
          {isActive && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent">
              <CheckIcon size={16} strokeWidth={2.2} />
              <span className="max-sm:sr-only">{tr.shell.palette.selected}</span>
            </span>
          )}
          {balance && (
            // A card's balance is negative by nature: ink, never alarm red.
            <Money
              value={balance.balance}
              currency={balance.currency}
              tone={isCardAccount(acct) ? 'plain' : 'auto'}
              className="text-[14px] font-semibold"
            />
          )}
          {i < 9 && f.singleKeyShortcuts && <span className="hidden sm:inline-flex"><KeyHint keys={[String(i + 1)]} /></span>}
        </span>
      ),
      keywords: [
        acct.product ?? '',
        translateType(acct.accountType),
        // German finds it too, as it finds the actions: "girokonto" on an English screen.
        ...(locale === 'de' ? [] : [MESSAGES.de.format.accountTypes[acct.accountType] || MESSAGES.de.format.accountType]),
      ],
      ids: [acct.iban ?? '', acct.accountNumber],
      run: () => {
        if (!isActive) f.selectAccount(acct);
        f.setTab('overview');
      },
    } satisfies Item;
  }), [f, tr, locale]);

  // Bookings: only once something is typed, newest first, across every
  // account loaded in this session — found by what their rows show (the
  // tidied name, the town, the category), as in the Umsätze search.
  const q = query.trim();
  const searchCtx = useMemo(() => ({ categoryOf: f.categoryOf, shownText: searchText }), [f.categoryOf]);
  const txMatches = useMemo(() => {
    if (q.length < MIN_TX_QUERY) return { list: [] as { tx: SerializedTransaction; account: SerializedAccount }[], total: 0, inActive: 0 };
    const match = txMatcher(q, searchCtx);
    const hits: { tx: SerializedTransaction; account: SerializedAccount; day: string }[] = [];
    let inActive = 0;
    for (const account of f.accounts) {
      for (const tx of f.txByAccount[account.accountNumber] ?? []) {
        if (!match(tx)) continue;
        hits.push({ tx, account, day: dayKey(tx.entryDate) });
        if (account.accountNumber === f.activeAccount?.accountNumber) inActive++;
      }
    }
    hits.sort((x, y) => (x.day === y.day ? 0 : x.day < y.day ? 1 : -1));
    return { list: hits.slice(0, MAX_TX), total: hits.length, inActive };
  }, [q, searchCtx, f.accounts, f.txByAccount, f.activeAccount]);

  const transactions = useMemo<Item[]>(() => {
    // A booking hit: the Umsätze list, filtered, on the booking's account —
    // when switching there is answered from the cache. Bookings of an account
    // loaded for another range stay findable, but going to them would ask the
    // bank again (perhaps for a TAN), which a "show me" choice must not set
    // off: the list opens on the current account, names the booking's, and
    // offers the switch as a deliberate step (useShowOnAccount).
    const showBooking = (account: SerializedAccount) => showOnAccount(account, { query: q });

    // The account is only worth naming when the hits come from more than one.
    const several = new Set(txMatches.list.map((h) => h.account.accountNumber)).size > 1;
    const items: Item[] = txMatches.list.map(({ tx, account }, i) => {
      // Read the way the Umsätze list reads it: the payee as a person would
      // write it, and a second line without the card terminal's own record
      // (shop again, city, timestamp, card number) or SEPA tags.
      const { name, summary } = txText(tx);
      const meta = [fmtDate(tx.entryDate), several ? f.accountLabel(account) : '', summary].filter(Boolean).join(' · ');
      return {
        id: `tx-${i}`,
        group: 'transactions',
        label: name,
        description: <span className="block truncate">{meta}</span>,
        icon: <span aria-hidden className="text-[12px] font-bold">{initials(name)}</span>,
        hint: <Money value={tx.amount} currency={tx.currency} signed tone="credit" className="text-[14px] font-semibold" />,
        run: () => showBooking(account),
      };
    });
    if (txMatches.inActive > 0) {
      items.unshift({
        id: 'tx-all',
        group: 'transactions',
        label: tr.shell.palette.showAll(q),
        description: tr.shell.palette.inSelected(txMatches.inActive),
        icon: <SearchIcon size={18} />,
        run: () => f.showTransactions({ query: q }),
      });
    }
    return items;
  }, [txMatches, q, f, showOnAccount, tr]);

  const items = useMemo(() => {
    const r = paletteResults(actions, accounts, q);
    // Abmelden after everything, bookings included: never the row an Enter
    // meant for a search lands on.
    return [...r.actions, ...r.accounts, ...(q ? transactions : []), ...r.last];
  }, [q, actions, accounts, transactions]);

  // A new query starts at the top.
  useEffect(() => setActive(0), [q]);
  const current = Math.min(active, Math.max(0, items.length - 1));

  // Keep the active option in view as the arrows move it.
  useEffect(() => {
    document.getElementById(optId(current))?.scrollIntoView({ block: 'nearest' });
    // optId is derived from a stable id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive(Math.max(0, Math.min(items.length - 1, current + (e.key === 'PageDown' ? 5 : -5))));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(items[current]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      // The same keys that opened it close it again.
      e.preventDefault();
      onClose();
    }
  };

  const groups = GROUP_ORDER
    .map((g) => ({ g, rows: items.map((item, i) => ({ item, i })).filter((r) => r.item.group === g) }))
    .filter((x) => x.rows.length);
  const groupLabel: Record<Group, string> = {
    actions: tr.shell.palette.groups.actions,
    accounts: tr.common.account.accounts,
    transactions: tr.common.booking.transactions,
    session: tr.shell.palette.groups.session,
  };

  const txNote = q.length >= MIN_TX_QUERY && txMatches.total > MAX_TX
    ? tr.shell.palette.newest(MAX_TX, txMatches.total)
    : null;

  // What a screen reader hears about the results: focus never leaves the
  // field, so an emptied list or a new count would otherwise pass in silence.
  // Settled first — the list changes with every key, and a polite region that
  // speaks per keystroke says nothing anyone can follow.
  const status = !q
    ? ''
    : !items.length
      ? tr.shell.palette.noResults(q)
      : tr.shell.palette.results(items.length, txNote);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(status), 400);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div
      className="flex h-full w-full flex-col items-center sm:pt-[min(10vh,88px)]"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); }}
    >
      <div className="anim-sheet flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-t-[var(--radius-sheet)] bg-raised shadow-[var(--shadow-pop)] sm:max-h-[min(620px,100%)] sm:max-w-[660px] sm:flex-none sm:rounded-[var(--radius-sheet)]">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line pr-2 pl-5 sm:pr-4">
          <SearchIcon size={20} className="text-ink-3" />
          <input
            ref={inputRef}
            // Starts here with a keyboard; on a touch screen the dialog takes
            // focus instead, so the on-screen keyboard does not cover the list.
            data-autofocus="fine"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optId(current) : undefined}
            aria-label={tr.shell.palette.field}
            placeholder={tr.shell.palette.placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3"
          />
          <span aria-hidden className="hidden sm:contents"><Kbd>Esc</Kbd></span>
          <IconButton size="md" aria-label={tr.common.close} data-dialog-close className="sm:hidden" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          {/* Said first, while the field is (nearly) empty: the masthead calls
              this "Suche", so before anything else it says what it searches. */}
          {q.length < MIN_TX_QUERY && (
            <p className="px-5 pt-1.5 pb-1 text-[13px] leading-snug text-ink-3">
              {tr.shell.palette.intro}
            </p>
          )}

          {/* Always rendered, so aria-controls never points at nothing. */}
          <div id={listId} role="listbox" aria-label={tr.shell.palette.resultsLabel}>
            {groups.map(({ g, rows }) => (
              <div key={g} role="group" aria-labelledby={`${base}-g-${g}`} className="pb-1">
                <div id={`${base}-g-${g}`} role="presentation" className="flex items-baseline justify-between px-5 pt-2.5 pb-1.5">
                  <span className="text-[13px] font-semibold text-ink-3">{groupLabel[g]}</span>
                  {g === 'transactions' && txNote && <span className="text-[12.5px] text-ink-3">{txNote}</span>}
                </div>
                {rows.map(({ item, i }) => (
                  <Option
                    key={item.id}
                    id={optId(i)}
                    item={item}
                    active={i === current}
                    onHover={() => setActive(i)}
                    onChoose={() => choose(item)}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Always mounted: a live region that appears together with its text
              is often not heard. */}
          <p role="status" className="sr-only">{announced}</p>

          {!items.length && (
            <EmptyState illustration="search" compact title={tr.shell.palette.noResults(q)}>
              {tr.shell.palette.emptyHint}
            </EmptyState>
          )}
        </div>

        <div aria-hidden className="hidden shrink-0 items-center gap-5 border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3 sm:flex">
          <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> {tr.shell.palette.keys.select}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> {tr.shell.palette.keys.open}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> {tr.shell.palette.keys.close}</span>
        </div>
      </div>
    </div>
  );
}

function Option({
  id, item, active, onHover, onChoose,
}: { id: string; item: Item; active: boolean; onHover: () => void; onChoose: () => void }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      // Pointer and keyboard share one highlight; a click chooses. mousedown
      // is prevented so the field keeps focus (and the caret) throughout.
      onMouseMove={() => { if (!active) onHover(); }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={cx(
        'mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2',
        // The tint alone is ~1.1:1 on --raised; the ring is what a keyboard
        // user actually sees (focus stays in the field). Forced colours drop
        // box-shadows, so there it is an outline.
        active
          ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)] forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-solid'
          : undefined,
      )}
    >
      <span
        className={cx(
          'grid size-8 shrink-0 place-items-center rounded-[8px] transition-colors duration-100',
          active ? 'bg-surface text-accent' : 'bg-inset text-ink-2',
        )}
      >
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{item.label}</span>
        {item.description && <span className="block truncate text-[13px] leading-snug text-ink-3">{item.description}</span>}
      </span>
      {item.hint && <span className="shrink-0">{item.hint}</span>}
    </div>
  );
}

function KeyHint({ keys }: { keys: string[] }) {
  return (
    <span aria-hidden className="hidden items-center gap-1 sm:inline-flex">
      {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
    </span>
  );
}
