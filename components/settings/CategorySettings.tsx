'use client';

// Einstellungen → Eigene Kategorien: the categories the user made
// (lib/splits.ts), each with a way to rename and to delete it, and a way to
// make a new one. They are made where they are needed — a booking's category
// menu — and kept here, where all of them can be seen at once.

import { useMemo, useState } from 'react';
import type { CustomCategory } from '@/lib/categories';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { PlusIcon, TagIcon } from '../icons';
import { CategoryNameDialog } from '../transactions/CategoryDialogs';
import { Button, Dialog } from '../ui';
import { MachineIcon } from './rows';

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

  return (
    <>
      <p className="text-[13px] leading-snug text-ink-3">{words.sectionHint}</p>
      {list.length === 0 ? (
        <p className="mt-3 text-[14px] leading-snug text-ink-2">{words.none}</p>
      ) : (
        <ul className="mt-1">
          {list.map((c) => {
            const count = used.get(c.id) ?? 0;
            return (
              <li key={c.id} className="flex min-h-14 items-center gap-3 py-2">
                <MachineIcon><TagIcon size={16} /></MachineIcon>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] leading-snug font-semibold text-ink">{c.name}</p>
                  <p className="text-[13px] leading-snug text-ink-3">
                    {c.direction === 'in' ? words.kindIn : words.kindOut} · {count ? words.used(count) : words.unused}
                  </p>
                </div>
                <div className="-mr-2 flex shrink-0">
                  <Button variant="tertiary" size="xs" aria-label={words.renameLabel(c.name)} aria-haspopup="dialog" onClick={() => setRenaming(c)}>
                    {words.rename}
                  </Button>
                  <Button variant="tertiary" size="xs" aria-label={words.removeLabel(c.name)} aria-haspopup="dialog" onClick={() => setRemoving(c)}>
                    {words.remove}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2">
        <Button variant="secondary" size="sm" aria-haspopup="dialog" iconLeft={<PlusIcon size={16} />} onClick={() => setAdding(true)}>
          {words.add}
        </Button>
      </div>
      {vaultStatus !== 'ready' && <p className="mt-2 text-[13px] leading-snug text-ink-3">{t.transactions.categorize.sessionOnly}</p>}

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
