'use client';

// Vorlagen: payees saved in the encrypted vault. Picking one fills the whole
// form (and still goes through the review step); "Vorlagen verwalten" renames
// and deletes (with an undo in the dialog). Saving is offered on the done
// step, once an order has been carried out — so a template is always a payee
// the bank has accepted, and the review step holds one decision only.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TransferTemplate } from '@/lib/app-types';
import { fmtShortIban, parseAmount } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { ChevronIcon, PencilIcon, StarIcon, TrashIcon, UndoIcon } from '../icons';
import { useMoneyText } from '../Money';
import {
  Alert, Button, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuLabel, MenuSeparator, cx,
} from '../ui';
import { sameTemplate, sortTemplates } from './model';

const shortIban = (iban: string) => {
  const s = fmtShortIban(iban);
  return s.head ? `${s.head} ${s.tail}` : s.tail;
};

/** "Max Mustermann · DE12 ··· 5678 90 · 25,00 €" */
function useTemplateLine() {
  const money = useMoneyText();
  return (t: TransferTemplate) => {
    const amount = t.amount ? parseAmount(t.amount) : null;
    return [t.name !== t.label ? t.name : null, shortIban(t.iban), amount != null && amount > 0 ? money(amount) : null]
      .filter(Boolean)
      .join(' · ');
  };
}

/** Why there are no templates to offer right now, or null when there may be. */
export function vaultNote(status: string): string | null {
  if (status === 'idle' || status === 'loading') return 'Vorlagen werden geladen …';
  if (status === 'error' || status === 'unavailable') return 'Vorlagen sind gerade nicht verfügbar, weil dein verschlüsselter Speicher nicht geladen werden konnte.';
  return null;
}

/**
 * The "Vorlagen" menu. `onManage` opens the management dialog — rendered by
 * the caller outside its <form>, so the dialog's own fields can never submit
 * the transfer form they happen to sit in.
 */
export function TemplatesMenu({ onPick, onManage }: { onPick: (t: TransferTemplate) => void; onManage: () => void }) {
  const { vault, vaultStatus } = useFints();
  const line = useTemplateLine();
  const templates = useMemo(() => sortTemplates(vault?.templates ?? []), [vault?.templates]);
  const note = vaultNote(vaultStatus);

  return (
    <>
      <Menu
        placement="bottom-end"
        minWidth={280}
        label="Vorlagen"
        trigger={(p, { open }) => (
          <Button
            {...p}
            variant="tertiary"
            size="sm"
            className="-mr-3"
            iconLeft={<StarIcon size={16} />}
            iconRight={<ChevronIcon size={14} strokeWidth={2.2} className={cx('transition-transform duration-150', open && 'rotate-180')} />}
          >
            Vorlagen{templates.length ? <span className="tnum font-semibold text-ink-3"> {templates.length}</span> : null}
          </Button>
        )}
      >
        {templates.length > 0 ? (
          <>
            <MenuLabel>Vorlage verwenden</MenuLabel>
            {templates.map((t) => (
              <MenuItem key={t.id} onSelect={() => onPick(t)} description={line(t)}>
                <span className="font-semibold">{t.label}</span>
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        ) : (
          <p className="max-w-[300px] px-3 pt-2 pb-2.5 text-[13.5px] leading-snug text-ink-3">
            {note ?? 'Noch keine Vorlagen. Ist eine Überweisung ausgeführt, kannst du den Empfänger als Vorlage speichern.'}
          </p>
        )}
        <MenuItem icon={<PencilIcon size={17} />} onSelect={onManage} disabled={!vault}>
          Vorlagen verwalten …
        </MenuItem>
      </Menu>
    </>
  );
}

/** Where focus goes once the list has re-rendered: a row's control, or "Fertig". */
type Refocus = { id: string; control: 'rename' | 'delete' } | 'done';

export function ManageTemplates({ onClose }: { onClose: () => void }) {
  const { vault, vaultStatus, updateVault, deleteTemplate } = useFints();
  const templates = useMemo(() => sortTemplates(vault?.templates ?? []), [vault?.templates]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Deleted while this dialog is open, newest first — each can be put back from here. */
  const [removed, setRemoved] = useState<TransferTemplate[]>([]);
  const [live, setLive] = useState('');
  const line = useTemplateLine();
  const listRef = useRef<HTMLUListElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  // Deleting a row, leaving a rename or undoing removes the control that has
  // focus. Left alone, focus falls to the document body — outside the
  // dialog, where Escape no longer reaches it. So every one of those says
  // where focus goes next, and it is placed as soon as the list has changed.
  const refocus = useRef<Refocus | null>(null);
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const target = want === 'done'
      ? null
      : listRef.current?.querySelector<HTMLElement>(`[data-tpl-${want.control}="${CSS.escape(want.id)}"]`);
    (target ?? doneRef.current)?.focus();
  });

  const startRename = (t: TransferTemplate) => { setEditing(t.id); setDraft(t.label); };
  const endRename = (t: TransferTemplate) => {
    setEditing(null);
    refocus.current = { id: t.id, control: 'rename' };
  };
  const commitRename = (t: TransferTemplate) => {
    const label = [...draft.replace(/\s+/g, ' ').trim()].slice(0, 60).join('');
    endRename(t);
    if (!label || label === t.label) return;
    updateVault((v) => ({ ...v, templates: v.templates.map((x) => (x.id === t.id ? { ...x, label } : x)) }));
    setLive(`Vorlage in „${label}“ umbenannt.`);
  };

  // Deleting is one click, so it is undoable rather than confirmed — and the
  // undo sits in this dialog, where a keyboard can reach it (a toast lives
  // outside the modal layers, behind their focus trap).
  const remove = (t: TransferTemplate) => {
    const i = templates.findIndex((x) => x.id === t.id);
    const neighbour = templates[i + 1] ?? templates[i - 1];
    refocus.current = neighbour ? { id: neighbour.id, control: 'delete' } : 'done';
    deleteTemplate(t.id);
    setRemoved((r) => [t, ...r.filter((x) => x.id !== t.id)]);
    setLive(`Vorlage „${t.label}“ gelöscht.`);
  };

  const undo = () => {
    const [t, ...rest] = removed;
    if (!t) return;
    refocus.current = { id: t.id, control: 'delete' };
    updateVault((v) => (v.templates.some((x) => x.id === t.id) ? v : { ...v, templates: [t, ...v.templates] }));
    setRemoved(rest);
    setLive(`Vorlage „${t.label}“ wiederhergestellt.`);
  };

  const lastRemoved = removed[0];

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Vorlagen verwalten"
      description="Vorlagen werden verschlüsselt gespeichert und sind nur nach deiner Anmeldung lesbar."
      initialFocus={doneRef}
      actions={<Button ref={doneRef} variant="primary" onClick={onClose}>Fertig</Button>}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">{live}</p>
      {vaultStatus !== 'ready' && (
        <Alert tone="warn" className="mb-4">
          Änderungen werden gerade nicht gespeichert, weil dein verschlüsselter Speicher nicht verfügbar ist.
        </Alert>
      )}
      {lastRemoved && (
        <div className="mb-3 flex min-h-12 items-center gap-3 rounded-[10px] bg-inset py-1.5 pr-1.5 pl-4">
          <TrashIcon size={17} className="shrink-0 text-ink-3" />
          <p className="min-w-0 flex-1 text-[14px] leading-snug break-words text-ink">
            Vorlage „{lastRemoved.label}“ gelöscht.
          </p>
          <Button
            size="sm"
            variant="tertiary"
            iconLeft={<UndoIcon size={16} />}
            aria-label={`Rückgängig – „${lastRemoved.label}“ wiederherstellen`}
            onClick={undo}
          >
            Rückgängig
          </Button>
        </div>
      )}
      {templates.length === 0 ? (
        <EmptyState compact icon={<StarIcon size={22} />} title="Keine Vorlagen">
          Ist eine Überweisung ausgeführt, kannst du den Empfänger als Vorlage speichern.
        </EmptyState>
      ) : (
        <ul ref={listRef} className="-mx-2 divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex min-h-15 items-center gap-2 px-2 py-2">
              {editing === t.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    autoFocus
                    aria-label={`Neuer Name für „${t.label}“`}
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(t); }
                      // Escape leaves the rename, not the dialog.
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(t); }
                    }}
                    className="h-10"
                  />
                  <Button size="sm" variant="primary" onClick={() => commitRename(t)}>Speichern</Button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">{t.label}</p>
                    <p className="truncate text-[13px] text-ink-3">{line(t)}</p>
                  </div>
                  <IconButton aria-label={`„${t.label}“ umbenennen`} data-tpl-rename={t.id} onClick={() => startRename(t)}>
                    <PencilIcon size={17} />
                  </IconButton>
                  <IconButton aria-label={`„${t.label}“ löschen`} data-tpl-delete={t.id} onClick={() => remove(t)}>
                    <TrashIcon size={17} />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const LABEL_MAX = 60;
const clipLabel = (s: string) => [...s.replace(/\s+/g, ' ').trim()].slice(0, LABEL_MAX).join('');

/**
 * "Als Vorlage speichern" on the done step: the bank has just accepted this
 * payee. One button, the template's name prefilled and editable beside it.
 * Offered only while the vault can actually save, and never for a payee a
 * template already says exactly.
 */
export function SaveAsTemplate({ payee }: { payee: Omit<TransferTemplate, 'id' | 'label' | 'createdAt' | 'lastUsedAt'> }) {
  const { vault, vaultStatus, saveTemplate } = useFints();
  const [label, setLabel] = useState(() => clipLabel(payee.name));
  const [saved, setSaved] = useState<string | null>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const existing = useMemo(
    () => (vault?.templates ?? []).find((t) => sameTemplate(t, payee)) ?? null,
    [vault?.templates, payee],
  );

  // The button that was pressed is gone; focus goes to what replaced it.
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const name = clipLabel(label) || clipLabel(payee.name);
    saveTemplate({ ...payee, label: name });
    setSaved(name);
  };

  const done = saved ?? existing?.label ?? null;
  if (done) {
    return (
      <p ref={savedRef} tabIndex={-1} className="flex items-center gap-2 text-[14px] text-ink-2 outline-none">
        <StarIcon size={16} className="shrink-0 text-ink-3" />
        {saved ? <>Als Vorlage „{done}“ gespeichert.</> : <>Schon als Vorlage „{done}“ gespeichert.</>}
      </p>
    );
  }
  if (vaultStatus !== 'ready') return null;
  return (
    <form onSubmit={save} noValidate>
      <Field
        label="Name der Vorlage"
        htmlFor="tf-tpl"
        className="mb-0"
        hint="Empfänger, IBAN, Betrag und Verwendungszweck – verschlüsselt auf diesem Rechner."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="tf-tpl" value={label} maxLength={LABEL_MAX} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" iconLeft={<StarIcon size={16} />}>Als Vorlage speichern</Button>
        </div>
      </Field>
    </form>
  );
}
