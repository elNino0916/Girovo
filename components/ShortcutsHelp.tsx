'use client';

// The list of keyboard shortcuts, as the user meets them: grouped by what
// they are for, each key drawn as a key. Opened with "?", from the Sitzung
// panel or from the palette — the last two still work with the single keys
// switched off, which is done here.
//
// The switch exists for WCAG 2.1.4: a shortcut on one unmodified key fires
// from a dictated word or a stray press. Those keys stay on by default (the
// spec asks for them); what is off is shown as off, not left to be guessed.

import { Fragment, useEffect, useState } from 'react';
import type { Messages } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { useFints } from './FintsProvider';
import { TOAST_KEY } from './Toasts';
import { KeyboardIcon } from './icons';
import { Button, Dialog, Kbd, Switch, cx } from './ui';

/** `single`: one unmodified key, which the switch turns off. */
type Row = { keys: string[][]; label: string; single?: boolean };
type Group = { id: 'everywhere' | 'navigation' | 'actions' | 'lists'; title: string; rows: Row[] };

/**
 * Two columns of about the same height — "Überall" and "Aktionen" are short,
 * "Navigation" is long — read top to bottom, left column first.
 */
function columns(t: Messages, mod: string): Group[][] {
  const [everywhere, navigation, actions, lists] = groups(t, mod);
  return [[everywhere, actions], [navigation, lists]];
}

function groups(t: Messages, mod: string): Group[] {
  const s = t.shell.shortcuts;
  return [
    {
      id: 'everywhere',
      title: s.groups.everywhere,
      rows: [
        { keys: [[mod, 'K']], label: t.common.search },
        { keys: [['?']], label: s.thisList, single: true },
        { keys: [[TOAST_KEY]], label: s.toToast },
      ],
    },
    {
      id: 'navigation',
      title: s.groups.navigation,
      rows: [
        { keys: [['Alt', '1']], label: t.common.nav.overview },
        { keys: [['Alt', '2']], label: t.common.nav.analysis },
        { keys: [['Alt', '3']], label: t.common.nav.contracts },
        { keys: [['1'], ['…'], ['9']], label: s.switchAccount, single: true },
        { keys: [['/']], label: t.shell.searchTransactions, single: true },
      ],
    },
    {
      id: 'actions',
      title: s.groups.actions,
      rows: [
        { keys: [['N']], label: s.newTransfer, single: true },
        { keys: [['B']], label: s.toggleAmounts, single: true },
      ],
    },
    {
      id: 'lists',
      title: s.groups.lists,
      rows: [
        { keys: [['↑'], ['↓']], label: s.moveSelection },
        { keys: [['↵']], label: s.chooseOrOpen },
        { keys: [['Esc']], label: t.common.close },
      ],
    },
  ];
}

/** Whether the keyboard is a Mac's, with "⌘" for Strg — read after mount, the server cannot know. */
function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform ?? '';
    if (/mac|iphone|ipad/i.test(platform)) setMac(true);
  }, []);
  return mac;
}

export function ShortcutsHelp() {
  const { shortcutsOpen, setShortcutsOpen, singleKeyShortcuts, setSingleKeyShortcuts } = useFints();
  const t = useT();
  const mac = useIsMac();
  // "Strg" on Windows and Linux ("Ctrl" in English), "⌘" on a Mac.
  const mod = mac ? '⌘' : t.shell.ctrl;
  const close = () => setShortcutsOpen(false);

  return (
    <Dialog
      open={shortcutsOpen}
      onClose={close}
      size="lg"
      icon={<KeyboardIcon size={20} />}
      title={t.common.shortcuts}
      description={t.shell.shortcuts.description}
      // Focus starts on "Fertig", not on the switch: "?" then Enter must
      // close the list, never quietly turn the keys off.
      actions={<Button variant="primary" data-autofocus onClick={close}>{t.common.done}</Button>}
    >
      <Switch
        checked={singleKeyShortcuts}
        onChange={setSingleKeyShortcuts}
        label={t.shell.singleKeys.name}
        description={t.shell.shortcuts.switchHint(mac ? '⌘K' : `${t.shell.ctrl}+K`, TOAST_KEY)}
        className="mb-6 rounded-[8px] bg-inset px-4 py-3"
      />
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {columns(t, mod).map((column) => (
          <div key={column[0].id} className="flex flex-col gap-6">
            {column.map((g) => (
              <section key={g.id} aria-label={g.title}>
                <h3 className="mb-2 text-[13px] font-semibold text-ink-3">{g.title}</h3>
                <dl className="flex flex-col">
                  {g.rows.map((r) => {
                    const off = r.single && !singleKeyShortcuts;
                    return (
                      <div key={r.label} className="flex min-h-10 items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
                        <dt className={cx('min-w-0 text-[14.5px] leading-snug', off ? 'text-ink-3' : 'text-ink')}>{r.label}</dt>
                        <dd className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-3">
                          {off ? (
                            <>
                              <span aria-hidden className="font-semibold">{t.shell.shortcuts.off}</span>
                              <span className="sr-only">{t.shell.shortcuts.offSpoken}</span>
                            </>
                          ) : <KeyCombos combos={r.keys} />}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                {g.id === 'navigation' && singleKeyShortcuts && (
                  <p className="mt-2 text-[13px] leading-[28px] text-ink-3">
                    {rich(t.shell.shortcuts.gKeys((k) => <Kbd>{k}</Kbd>))}
                  </p>
                )}
              </section>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Alternatives are separated by "oder"; the keys of a chord (Alt+1) sit side
 * by side, with "plus" between them for a screen reader. The words are read
 * out; the drawn keys are what the eye scans.
 */
function KeyCombos({ combos }: { combos: string[][] }) {
  const s = useT().shell.shortcuts;
  // "1 … 9" is a range, not three alternatives.
  if (combos.length === 3 && combos[1][0] === '…') {
    return (
      <>
        <Kbd>{combos[0][0]}</Kbd>
        <span aria-hidden>–</span>
        <span className="sr-only">{s.to}</span>
        <Kbd>{combos[2][0]}</Kbd>
      </>
    );
  }
  return (
    <>
      {combos.map((keys, i) => (
        <Fragment key={keys.join('+')}>
          {i > 0 && <span className="px-0.5">{s.or}</span>}
          {keys.map((k, j) => (
            <Fragment key={k}>
              {j > 0 && <span className="sr-only">{s.plus}</span>}
              <Kbd>{k}</Kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}
