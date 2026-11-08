'use client';

// A contract's own name (vault contractNames): "Deutsche Bahn" in place of
// "DB Vertrieb GmbH". It changes what Girovo shows, never what the bank
// booked; left empty, the bank's name comes back.

import { useRef, useState } from 'react';
import { CONTRACT_NAME_MAX } from '@/lib/contract-watch';
import { displayName } from '@/lib/format';
import { msgs } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import type { RecurringSeries } from '@/lib/recurring';
import { useFints } from '../FintsProvider';
import { Button, Dialog, Field, Input, useFocusWhenDrawn } from '../ui';

export function RenameContract({ s, onClose }: { s: RecurringSeries; onClose: () => void }) {
  const t = useT();
  const words = t.insights.contracts.rename;
  const { setContractName } = useFints();
  const original = displayName(s.name) || msgs().insights.noName;
  const [draft, setDraft] = useState(s.customName ?? '');
  const input = useRef<HTMLInputElement>(null);
  useFocusWhenDrawn(input);

  const save = () => {
    const next = draft.trim();
    // Typing the bank's own name back in is the same as having none.
    setContractName(s.id, next && next !== original ? next : null);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={words.title}
      description={words.description(original)}
      actions={(
        <>
          {s.customName && (
            <Button
              variant="tertiary"
              className="mr-auto"
              onClick={() => {
                setContractName(s.id, null);
                onClose();
              }}
            >
              {words.reset}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={save}>{t.common.save}</Button>
        </>
      )}
    >
      <Field label={words.label} htmlFor="contract-name">
        <Input
          id="contract-name"
          ref={input}
          value={draft}
          maxLength={CONTRACT_NAME_MAX}
          placeholder={original}
          autoComplete="off"
          spellCheck={false}
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
