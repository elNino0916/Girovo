'use client';

// "Suche und Befehle" — one field for everything the dashboard can do.
//
// Strg+K / ⌘K, the masthead's Suche and the phone's "Mehr" open it. It finds
// three kinds of things, always in this order so the eye learns where to
// look: Aktionen (everything a button elsewhere does), Konten (switch to one)
// and Umsätze (bookings already loaded in this session, by name, purpose,
// IBAN or amount — the same matcher as the Umsätze search). Choosing a
// booking opens the Umsätze list filtered to what was typed, on the booking's
// account when that is answered from the cache.
//
// Nothing here bypasses anything: Überweisen opens the transfer sheet with
// its review, Namensabgleich and TAN. Choosing a Konto is a switch like any
// other (it may load). Choosing a booking is "show me", and that never reads
// from the bank: when its account was loaded for another range (or before
// midnight), the list opens on the current account and a toast offers the
// switch — with the note that it may need an approval.
//
// ARIA: the input is a combobox that owns a listbox; arrow keys move the
// active option (aria-activedescendant), focus never leaves the field.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { txMatcher } from '@/lib/analytics';
import { dayKey, fmtDate, fmtShortIban, initials, translateType } from '@/lib/format';
import { setThemePref } from '@/lib/theme';
import type { DashboardTab } from '@/lib/app-types';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { useFints } from './FintsProvider';
import { Money } from './Money';
import { useThemePref } from './ThemeToggle';
import {
  AccountTypeIcon, BellIcon, ChartIcon, CheckIcon, CloseIcon, DownloadIcon, EyeIcon, EyeOffIcon, FileIcon, HomeIcon,
  KeyboardIcon, LogoutIcon, MonitorIcon, MoonIcon, QrIcon, RefreshIcon, RepeatIcon, SearchIcon, SunIcon, TransferIcon,
} from './icons';
import { EmptyState, IconButton, Kbd, Overlay, cx } from './ui';
import { searchText, txText } from './transactions/model';
import { useShellActions } from './shell/actions';
import { hasNewer, updates, useUpdates } from './updates/store';
import { fuzzyScore } from './shell/fuzzy';

type Group = 'actions' | 'accounts' | 'transactions';

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
  run: () => void;
};

const GROUP_LABEL: Record<Group, string> = { actions: 'Aktionen', accounts: 'Konten', transactions: 'Umsätze' };
const MAX_TX = 6;
const MIN_TX_QUERY = 2;

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useFints();
  return (
    <Overlay open={paletteOpen} onClose={() => setPaletteOpen(false)} label="Suche und Befehle">
      <Palette onClose={() => setPaletteOpen(false)} />
    </Overlay>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const f = useFints();
  const a = useShellActions();
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
    // A one-key hint only while those keys work (they can be switched off).
    const single = (keys: string[]) => (f.singleKeyShortcuts ? <KeyHint keys={keys} /> : undefined);
    const tab = (t: DashboardTab, label: string, icon: ReactNode, key: string, keywords: string[]): Item => ({
      id: `tab-${t}`, group: 'actions', label, icon, keywords, featured: f.tab !== t,
      hint: <KeyHint keys={['Alt', key]} />,
      description: f.tab === t ? 'Du bist hier' : undefined,
      run: () => f.setTab(t),
    });
    const theme = (pref: 'light' | 'dark' | 'system', label: string, icon: ReactNode): Item => ({
      id: `theme-${pref}`, group: 'actions', label: `Darstellung: ${label}`, icon,
      keywords: ['theme', 'modus', 'farbe', 'dark mode', 'nachtmodus', 'aussehen', label],
      description: themePref === pref ? 'Aktuelle Einstellung' : undefined,
      run: () => setThemePref(pref),
    });
    const list: (Item | false)[] = [
      a.canTransfer && {
        id: 'transfer', group: 'actions', label: 'Überweisen', icon: <TransferIcon />, featured: true,
        hint: single(['N']),
        keywords: ['überweisung', 'geld senden', 'zahlen', 'bezahlen', 'echtzeit', 'sepa'],
        run: a.transfer,
      },
      a.canShare && {
        id: 'share', group: 'actions', label: 'Geld anfordern', icon: <QrIcon />, featured: true,
        description: 'GiroCode mit deinen Kontodaten',
        keywords: ['girocode', 'qr', 'code', 'empfangen', 'kontodaten', 'iban teilen'],
        run: a.share,
      },
      {
        id: 'search', group: 'actions', label: 'Umsätze durchsuchen', icon: <SearchIcon size={18} />, featured: true,
        hint: single(['/']),
        keywords: ['suche', 'filter', 'finden', 'buchungen'],
        run: a.focusSearch,
      },
      a.canStatement && {
        id: 'statement', group: 'actions', label: 'Kontoauszug als PDF', icon: <FileIcon />, featured: true,
        description: a.rangeLabel,
        keywords: ['pdf', 'drucken', 'auszug', 'beleg', 'dokument'],
        run: a.statement,
      },
      a.canExport && {
        id: 'csv', group: 'actions', label: 'Umsätze als CSV exportieren', icon: <DownloadIcon />, featured: true,
        description: a.rangeLabel ? `${a.rangeLabel} · für Excel` : 'Für Excel',
        keywords: ['export', 'excel', 'csv', 'tabelle', 'download', 'herunterladen'],
        run: a.exportCsv,
      },
      {
        id: 'privacy', group: 'actions', label: f.privacy ? 'Beträge anzeigen' : 'Beträge ausblenden',
        icon: f.privacy ? <EyeIcon /> : <EyeOffIcon />, featured: true,
        hint: single(['B']),
        keywords: ['privat', 'verbergen', 'verstecken', 'datenschutz', 'bildschirm teilen', 'beträge', 'einblenden'],
        run: f.togglePrivacy,
      },
      {
        id: 'inbox', group: 'actions', label: 'Mitteilungen', icon: <BellIcon />, featured: true,
        description: f.unreadCount ? `${f.unreadCount} ungelesen` : 'Nachrichten deiner Bank und Vorgänge dieser Sitzung',
        keywords: ['nachrichten', 'bank', 'vorgänge', 'hinweise', 'inbox'],
        run: () => f.setInboxOpen(true),
      },
      tab('overview', 'Übersicht', <HomeIcon />, '1', ['start', 'konten', 'finanzübersicht', 'kontostand']),
      tab('analysis', 'Analyse', <ChartIcon />, '2', ['auswertung', 'kategorien', 'ausgaben', 'einnahmen', 'statistik', 'umsatzanalyse']),
      tab('contracts', 'Verträge & Abos', <RepeatIcon />, '3', ['abos', 'abonnements', 'fixkosten', 'wiederkehrend', 'daueraufträge', 'verträge']),
      theme('light', 'Hell', <SunIcon />),
      theme('dark', 'Dunkel', <MoonIcon />),
      theme('system', 'System', <MonitorIcon />),
      {
        id: 'single-keys', group: 'actions',
        label: f.singleKeyShortcuts ? 'Kürzel mit einzelnen Tasten ausschalten' : 'Kürzel mit einzelnen Tasten einschalten',
        icon: <KeyboardIcon />,
        description: '/, ?, N, B, G und 1–9',
        keywords: ['tastenkürzel', 'shortcuts', 'einzeltasten', 'sprachsteuerung', 'barrierefreiheit', 'tastatur'],
        run: () => {
          const on = !f.singleKeyShortcuts;
          f.setSingleKeyShortcuts(on);
          // Nothing on screen changes; the toast is the only answer.
          f.toast(on ? 'Kürzel mit einzelnen Tasten sind eingeschaltet.' : 'Kürzel mit einzelnen Tasten sind ausgeschaltet.', 'success');
        },
      },
      // Desktop app only. Opening the dialog is the action; with nothing new
      // known yet, it also asks.
      !!update && {
        id: 'updates', group: 'actions',
        label: hasNewer(update) ? `Update auf Version ${update.release.version}` : 'Nach Updates suchen',
        icon: hasNewer(update) ? <DownloadIcon /> : <RefreshIcon />,
        description: `Installiert: Version ${update.current}`,
        keywords: ['update', 'aktualisieren', 'aktualisierung', 'version', 'neue version', 'upgrade', 'installieren'],
        run: () => {
          if (!hasNewer(update)) void updates.check();
          updates.openDialog();
        },
      },
      {
        id: 'shortcuts', group: 'actions', label: 'Tastenkürzel', icon: <KeyboardIcon />,
        hint: single(['?']),
        keywords: ['shortcuts', 'tastatur', 'hilfe', 'kürzel'],
        run: () => f.setShortcutsOpen(true),
      },
      {
        id: 'logout', group: 'actions', label: 'Abmelden', icon: <LogoutIcon />,
        keywords: ['logout', 'ausloggen', 'beenden', 'sitzung'],
        run: () => void f.logout('user'),
      },
    ];
    return list.filter((x): x is Item => !!x);
  }, [a, f, themePref, update]);

  const accounts = useMemo<Item[]>(() => f.accounts.map((acct, i) => {
    const short = fmtShortIban(acct.iban || acct.accountNumber);
    const balance = f.balances[acct.accountNumber];
    const isActive = acct.accountNumber === f.activeAccount?.accountNumber;
    return {
      id: `acct-${acct.accountNumber}`,
      group: 'accounts',
      label: f.accountLabel(acct),
      icon: <AccountTypeIcon type={acct.accountType} product={acct.product} />,
      featured: true,
      description: <span className="iban">{short.head} <span className="id-tail">{short.tail}</span></span>,
      hint: (
        <span className="flex items-center gap-3">
          {isActive && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent">
              <CheckIcon size={16} strokeWidth={2.2} />
              <span className="max-sm:sr-only">Ausgewählt</span>
            </span>
          )}
          {balance && <Money value={balance.balance} currency={balance.currency} className="text-[14px] font-semibold" />}
          {i < 9 && f.singleKeyShortcuts && <span className="hidden sm:inline-flex"><KeyHint keys={[String(i + 1)]} /></span>}
        </span>
      ),
      keywords: [acct.product ?? '', translateType(acct.accountType)],
      ids: [acct.iban ?? '', acct.accountNumber],
      run: () => {
        if (!isActive) f.selectAccount(acct);
        f.setTab('overview');
      },
    } satisfies Item;
  }), [f]);

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
    /**
     * A booking hit: the Umsätze list, filtered, on the booking's account —
     * when switching there is answered from the cache. Bookings of an account
     * loaded for another range stay findable, but going to them would ask the
     * bank again (perhaps for a TAN), which a "show me" choice must not set
     * off: the list opens on the current account, and a toast says why and
     * offers the switch as a deliberate step.
     */
    const showBooking = (account: SerializedAccount) => {
      const elsewhere = account.accountNumber !== f.activeAccount?.accountNumber;
      const fromCache = elsewhere && !f.busy && f.isLoadedForAppliedRange(account.accountNumber);
      if (fromCache) f.selectAccount(account);
      f.showTransactions({ query: q });
      if (!elsewhere || fromCache) return;
      const label = f.accountLabel(account);
      if (f.busy) {
        f.toast(`„${label}“ lässt sich wählen, sobald der laufende Vorgang fertig ist.`, 'info');
        return;
      }
      f.toast(
        `Die Umsätze von „${label}“ sind für einen anderen Zeitraum geladen. Wechseln lädt sie neu – das kann eine Freigabe erfordern.`,
        'info',
        12_000,
        { label: 'Konto wechseln', run: () => f.selectAccount(account) },
      );
    };

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
        label: `Alle Treffer für „${q}“ anzeigen`,
        description: `${txMatches.inActive} ${txMatches.inActive === 1 ? 'Umsatz' : 'Umsätze'} im ausgewählten Konto`,
        icon: <SearchIcon size={18} />,
        run: () => f.showTransactions({ query: q }),
      });
    }
    return items;
  }, [txMatches, q, f]);

  const items = useMemo(() => {
    if (!q) return [...actions.filter((x) => x.featured), ...accounts];
    // "12,99", "-49,90", ">100": an amount, which only bookings can answer.
    const amountLike = /^[\s\d.,+\-−<>=€]+$/.test(q);
    const compact = q.replace(/\s+/g, '').toUpperCase();
    const score = (item: Item) => {
      // Four or more characters of an IBAN or account number, typed with or
      // without its spaces, find that account.
      const idHit = compact.length >= 4
        && (item.ids ?? []).some((id) => id.replace(/\s+/g, '').toUpperCase().includes(compact));
      if (idHit) return 70;
      return amountLike ? 0 : fuzzyScore(item.label, q, item.keywords);
    };
    const rank = (list: Item[]) =>
      list
        .map((item, i) => ({ item, i, score: score(item) }))
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score || x.i - y.i)
        .map((r) => r.item);
    return [...rank(actions).slice(0, 8), ...rank(accounts), ...transactions];
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

  const groups = (['actions', 'accounts', 'transactions'] as const)
    .map((g) => ({ g, rows: items.map((item, i) => ({ item, i })).filter((r) => r.item.group === g) }))
    .filter((x) => x.rows.length);

  const txNote = q.length >= MIN_TX_QUERY && txMatches.total > MAX_TX
    ? `Die ${MAX_TX} neuesten von ${txMatches.total} Treffern`
    : null;

  // What a screen reader hears about the results: focus never leaves the
  // field, so an emptied list or a new count would otherwise pass in silence.
  // Settled first — the list changes with every key, and a polite region that
  // speaks per keystroke says nothing anyone can follow.
  const status = !q
    ? ''
    : !items.length
      ? `Keine Treffer für „${q}“`
      : `${items.length === 1 ? '1 Ergebnis' : `${items.length} Ergebnisse`}${txNote ? ` · Umsätze: ${txNote}` : ''}`;
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
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optId(current) : undefined}
            aria-label="Suchen oder Befehl eingeben"
            placeholder="Suchen oder Befehl eingeben …"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3"
          />
          <span aria-hidden className="hidden sm:contents"><Kbd>Esc</Kbd></span>
          <IconButton size="md" aria-label="Schließen" data-dialog-close className="sm:hidden" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          {/* Always rendered, so aria-controls never points at nothing. */}
          <div id={listId} role="listbox" aria-label="Ergebnisse">
            {groups.map(({ g, rows }) => (
              <div key={g} role="group" aria-labelledby={`${base}-g-${g}`} className="pb-1">
                <div id={`${base}-g-${g}`} role="presentation" className="flex items-baseline justify-between px-5 pt-2.5 pb-1.5">
                  <span className="text-[13px] font-semibold text-ink-3">{GROUP_LABEL[g]}</span>
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
            <EmptyState illustration="search" compact title={`Keine Treffer für „${q}“`}>
              Suche nach einer Aktion wie „Überweisen“, nach einem Konto oder nach geladenen Umsätzen — Name,
              Verwendungszweck oder Betrag wie „12,99“.
            </EmptyState>
          )}

          {items.length > 0 && q.length < MIN_TX_QUERY && (
            <p className="px-5 pt-2 pb-2 text-[13px] leading-snug text-ink-3">
              Tippe einen Namen, Verwendungszweck oder Betrag, um in den geladenen Umsätzen zu suchen.
            </p>
          )}
        </div>

        <div aria-hidden className="hidden shrink-0 items-center gap-5 border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3 sm:flex">
          <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> auswählen</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> ausführen</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> schließen</span>
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
        'mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2',
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
