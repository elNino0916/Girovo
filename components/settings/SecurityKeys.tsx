'use client';

// "Mit Sicherheitsschlüssel anmelden" on the desktop (lib/security-key.ts): the
// row in Sicherheit and its dialog. A key takes the place of typing the first
// login's PIN; a second one is a spare, and losing one only means typing the
// PIN again. Windows' own dialog asks for the touch and the key's PIN.

import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { PencilIcon, ShieldIcon, TrashIcon } from '../icons';
import { Button, Dialog, IconButton, Input, useFocusWhenDrawn } from '../ui';
import { ActionItem } from './rows';

/** How many keys one login can have (lib/security-key.ts KEYS_MAX). */
const KEYS_MAX = 5;

/** The row, where this Windows can use a security key (securityKeys is null elsewhere). */
export function SecurityKeysRow() {
  const t = useT();
  const { bank, securityKeys } = useFints();
  const [open, setOpen] = useState(false);
  if (securityKeys === null || !bank) return null;
  const words = t.settings.securityKeys;
  return (
    <>
      <ActionItem
        icon={<ShieldIcon />}
        title={words.title}
        summary={securityKeys.length ? words.count(securityKeys.length) : words.hint(bank.name)}
        onClick={() => setOpen(true)}
      />
      {open && <SecurityKeysDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SecurityKeysDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { securityKeys, addSecurityKey, renameSecurityKey, removeSecurityKey } = useFints();
  const [working, setWorking] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const nameField = useRef<HTMLInputElement>(null);
  useFocusWhenDrawn(nameField, naming);
  const words = t.settings.securityKeys;
  const keys = securityKeys ?? [];

  const startNaming = (id: string, current: string) => {
    setAsking(null);
    setDraft(current);
    setNaming(id);
  };
  const saveName = (id: string) => {
    setNaming(null);
    void run(() => renameSecurityKey(id, draft.trim()));
  };

  // A key just added gets its name right away, while it is still in hand.
  const count = useRef(keys.length);
  useEffect(() => {
    const newest = keys[keys.length - 1];
    if (keys.length > count.current && newest) startNaming(newest.id, '');
    count.current = keys.length;
    // Only when the number of keys changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.length]);

  const run = async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      onClose={working ? undefined : onClose}
      title={words.dialogTitle}
      icon={<ShieldIcon size={20} />}
      description={words.dialogIntro}
      actions={(
        <>
          <Button variant="secondary" disabled={working} onClick={onClose}>{t.common.close}</Button>
          <Button variant="primary" data-autofocus busy={working} disabled={keys.length >= KEYS_MAX} onClick={() => void run(addSecurityKey)}>
            {keys.length ? words.addAnother : words.add}
          </Button>
        </>
      )}
    >
      {keys.length > 0 ? (
        <ul>
          {keys.map((key, i) => {
            const label = key.name || words.keyName(i + 1);
            if (naming === key.id) {
              return (
                <li key={key.id} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={words.nameLabel}
                      ref={nameField}
                      value={draft}
                      maxLength={40}
                      placeholder={words.namePlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          saveName(key.id);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setNaming(null);
                        }
                      }}
                    />
                  </div>
                  <Button variant="tertiary" size="xs" onClick={() => setNaming(null)}>{t.common.cancel}</Button>
                  <Button variant="tertiary" size="xs" onClick={() => saveName(key.id)}>{t.common.save}</Button>
                </li>
              );
            }
            return (
            <li key={key.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] leading-snug font-medium text-ink">{label}</p>
                <p className="text-[13px] leading-snug text-ink-2">{words.added(fmtDate(key.added))}</p>
              </div>
              {/* Two steps: it deletes the PIN kept for this key, and it's the first thing in the dialog to take focus. */}
              {asking === key.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="tertiary" size="xs" disabled={working} onClick={() => setAsking(null)}>{t.common.cancel}</Button>
                  <Button
                    variant="tertiary"
                    size="xs"
                    disabled={working}
                    onClick={() => {
                      setAsking(null);
                      void run(() => removeSecurityKey(key.id));
                    }}
                  >
                    {words.removeConfirm}
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center">
                  <IconButton aria-label={words.rename(label)} disabled={working} onClick={() => startNaming(key.id, key.name ?? '')}>
                    <PencilIcon size={16} />
                  </IconButton>
                  <IconButton aria-label={words.remove(label)} disabled={working} onClick={() => setAsking(key.id)}>
                    <TrashIcon size={16} />
                  </IconButton>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px] leading-relaxed text-ink-2">{words.none}</p>
      )}
    </Dialog>
  );
}
