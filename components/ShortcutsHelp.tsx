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
import { useFints } from './FintsProvider';
import { KeyboardIcon } from './icons';
import { Button, Dialog, Kbd, Switch, cx } from './ui';

/** `single`: one unmodified key, which the switch turns off. */
type Row = { keys: string[][]; label: string; single?: boolean };

function groups(mod: string): { title: string; rows: Row[] }[] {
  return [
    {
      title: 'Überall',
      rows: [
        { keys: [[mod, 'K']], label: 'Suche und Befehle' },
        { keys: [['?']], label: 'Diese Übersicht', single: true },
      ],
    },
    {
      title: 'Navigation',
      rows: [
        { keys: [['Alt', '1']], label: 'Übersicht' },
        { keys: [['Alt', '2']], label: 'Analyse' },
        { keys: [['Alt', '3']], label: 'Verträge & Abos' },
        { keys: [['1'], ['…'], ['9']], label: 'Konto wechseln', single: true },
        { keys: [['/']], label: 'Umsätze durchsuchen', single: true },
      ],
    },
    {
      title: 'Aktionen',
      rows: [
        { keys: [['N']], label: 'Neue Überweisung', single: true },
        { keys: [['B']], label: 'Beträge aus- oder einblenden', single: true },
      ],
    },
    {
      title: 'In Listen und Dialogen',
      rows: [
        { keys: [['↑'], ['↓']], label: 'Auswahl bewegen' },
        { keys: [['↵']], label: 'Auswählen oder ausführen' },
        { keys: [['Esc']], label: 'Schließen' },
      ],
    },
  ];
}

/** "Strg" on Windows and Linux, "⌘" on a Mac — read after mount, the server cannot know. */
function useModifierLabel(): string {
  const [mod, setMod] = useState('Strg');
  useEffect(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform ?? '';
    if (/mac|iphone|ipad/i.test(platform)) setMod('⌘');
  }, []);
  return mod;
}

export function ShortcutsHelp() {
  const { shortcutsOpen, setShortcutsOpen, singleKeyShortcuts, setSingleKeyShortcuts } = useFints();
  const mod = useModifierLabel();
  const close = () => setShortcutsOpen(false);

  return (
    <Dialog
      open={shortcutsOpen}
      onClose={close}
      size="lg"
      icon={<KeyboardIcon size={20} />}
      title="Tastenkürzel"
      description="Einzelne Tasten wirken nur, solange du nicht in einem Eingabefeld schreibst – und lassen sich ganz ausschalten."
      // Focus starts on "Fertig", not on the switch: "?" then Enter must
      // close the list, never quietly turn the keys off.
      actions={<Button variant="primary" data-autofocus onClick={close}>Fertig</Button>}
    >
      <Switch
        checked={singleKeyShortcuts}
        onChange={setSingleKeyShortcuts}
        label="Kürzel mit einzelnen Tasten"
        description={
          <>
            /, ?, N, B, G und 1–9. Ausschalten, wenn du per Sprache steuerst oder Tasten leicht versehentlich
            triffst. {mod === '⌘' ? '⌘K' : 'Strg+K'} und Alt+1–3 wirken immer.
          </>
        }
        className="mb-6 rounded-[10px] bg-inset px-4 py-3"
      />
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {groups(mod).map((g) => (
          <section key={g.title} aria-label={g.title}>
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
                          <span aria-hidden className="font-semibold">aus</span>
                          <span className="sr-only">ausgeschaltet</span>
                        </>
                      ) : <KeyCombos combos={r.keys} />}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {g.title === 'Navigation' && singleKeyShortcuts && (
              <p className="mt-2 text-[13px] leading-[28px] text-ink-3">
                Oder <Kbd>G</Kbd> drücken, dann <Kbd>Ü</Kbd>, <Kbd>A</Kbd> oder <Kbd>V</Kbd> für die drei Bereiche.
              </p>
            )}
          </section>
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
  // "1 … 9" is a range, not three alternatives.
  if (combos.length === 3 && combos[1][0] === '…') {
    return (
      <>
        <Kbd>{combos[0][0]}</Kbd>
        <span aria-hidden>–</span>
        <span className="sr-only">bis</span>
        <Kbd>{combos[2][0]}</Kbd>
      </>
    );
  }
  return (
    <>
      {combos.map((keys, i) => (
        <Fragment key={keys.join('+')}>
          {i > 0 && <span className="px-0.5">oder</span>}
          {keys.map((k, j) => (
            <Fragment key={k}>
              {j > 0 && <span className="sr-only">plus</span>}
              <Kbd>{k}</Kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}
