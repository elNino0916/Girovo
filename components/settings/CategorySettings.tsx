'use client';

// Einstellungen → Eigene Kategorien: the categories the user made
// (lib/splits.ts), each with a way to rename and to delete it, and a way to
// make a new one. They are made where they are needed — a booking's category
// menu — and kept here, where all of them can be seen at once.

import { useMemo, useState } from 'react';
import type { CustomCategory } from '@/lib/categories';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { PencilIcon, PlusIcon, TagIcon, TrashIcon } from '../icons';
import { CategoryNameDialog } from '../transactions/CategoryDialogs';
import { Button, Dialog, IconButton } from '../ui';
import { ActionItem, SettingItem } from './rows';

export function CategorySettings() {
  const { vault, vaultStatus, txByAccount, categoryOf, deleteCustomCategory } = useFints();
  const t = useT();
  const words = t.transactions.custom;
  const list = vault?.customCategories ?? [];
  const [renaming, setRenaming] = useState<CustomCategory | null>(null);
  const [removing, setRemoving] = useState<CustomCategory | null>(null);
  const [adding, setAdding] = useState(false);

  // How many loaded bookings each one holds — said beside it, so deleting one
  // never comes as a surprise. A split booking counts for each of its shares.
  const used = useMemo(() => {
    const n = new Map<string, number>();
    if (!list.length) return n;
    for (const txs of Object.values(txByAccount)) {
      for (const tx of txs) {
        const r = categoryOf(tx);
        for (const id of r.parts?.length ? r.parts.map((p) => p.id) : [r.id]) {
          if (id.startsWith('c_')) n.set(id, (n.get(id) ?? 0) + 1);
        }
      }
    }
    return n;
  }, [list.length, txByAccount, categoryOf]);

  // Rows of the section's group (./rows.tsx): one per category, its two
  // actions at its end, then the way to a new one. The section's note says
  // where they apply and how they are kept.
  return (
    <>
      {list.map((c) => {
        const count = used.get(c.id) ?? 0;
        return (
          <SettingItem
            key={c.id}
            icon={<TagIcon />}
            title={<span className="block truncate">{c.name}</span>}
            summary={`${c.direction === 'in' ? words.kindIn : words.kindOut} · ${count ? words.used(count) : words.unused}`}
            trailing={(
              <span className="-mr-2 flex">
                <IconButton size="md" aria-label={words.renameLabel(c.name)} aria-haspopup="dialog" onClick={() => setRenaming(c)}>
                  <PencilIcon size={18} />
                </IconButton>
                <IconButton size="md" aria-label={words.removeLabel(c.name)} aria-haspopup="dialog" onClick={() => setRemoving(c)}>
                  <TrashIcon size={18} />
                </IconButton>
              </span>
            )}
          />
        );
      })}
      <ActionItem
        icon={<PlusIcon />}
        title={words.add}
        summary={list.length === 0 ? words.none : undefined}
        onClick={() => setAdding(true)}
      />
      {vaultStatus !== 'ready' && <SettingItem title={t.transactions.categorize.sessionOnly} />}

      <CategoryNameDialog open={adding} onClose={() => setAdding(false)} />
      <CategoryNameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        rename={renaming ? { id: renaming.id, name: renaming.name } : undefined}
      />
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title={words.removeTitle(removing.name)}
          description={words.removeBody}
          actions={(
            <>
              <Button data-autofocus onClick={() => setRemoving(null)}>{words.keep}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteCustomCategory(removing.id);
                  setRemoving(null);
                }}
              >
                {words.remove}
              </Button>
            </>
          )}
        />
      )}
    </>
  );
}
