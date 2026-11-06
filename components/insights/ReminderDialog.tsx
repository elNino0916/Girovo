'use client';

// "Kündigungsfrist": the day a contract can be cancelled by and how long
// before it Girovo says so (lib/contract-watch.ts). Kept in the vault and
// synced; Mitteilungen shows it from then on, and with "Neue Umsätze melden"
// on the background check sends it once as a notification.

import { useRef, useState } from 'react';
import { useFints } from '../FintsProvider';
import { Button, Dialog, Field, Input, Segmented } from '../ui';
import { dayNum } from '@/lib/contract-watch';
import { dayKey } from '@/lib/format';
import { useT } from '@/lib/i18n/react';

type Lead = '7' | '14' | '30';

export function ReminderDialog({ seriesId, name, onClose }: { seriesId: string; name: string; onClose: () => void }) {
  const t = useT();
  const words = t.insights.contracts.reminder;
  const { vault, setContractReminder } = useFints();
  const current = vault?.contractReminders?.[seriesId];
  const today = dayKey(new Date());
  const [by, setBy] = useState(current?.by ?? '');
  const [lead, setLead] = useState<Lead>(String(current?.lead ?? 30) as Lead);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const day = dayNum(by);
    const problem = day === null ? words.missing : day < dayNum(today)! ? words.past : null;
    if (problem) {
      setError(problem);
      dateRef.current?.focus();
      return;
    }
    setContractReminder(seriesId, { by, lead: Number(lead), name });
    onClose();
  };

  const remove = () => {
    setContractReminder(seriesId, null);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      onBackdrop={dirty ? () => {} : undefined}
      title={words.title}
      description={words.description(name)}
      initialFocus={dateRef}
      actions={(
        <>
          {current && <Button variant="tertiary" className="mr-auto" onClick={remove}>{words.remove}</Button>}
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={save}>{words.save}</Button>
        </>
      )}
    >
      <Field label={words.by} htmlFor="reminder-by" hint={error ? undefined : words.byHint} error={error}>
        <Input
          id="reminder-by"
          ref={dateRef}
          type="date"
          min={today}
          value={by}
          onChange={(e) => {
            setBy(e.target.value);
            setDirty(true);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
          className="tnum"
        />
      </Field>
      <p aria-hidden className="mb-2 text-[13px] font-semibold text-ink-2">{words.lead}</p>
      <Segmented<Lead>
        aria-label={words.lead}
        block
        value={lead}
        onChange={(v) => {
          setLead(v);
          setDirty(true);
        }}
        options={[
          { value: '7', label: words.leads.week },
          { value: '14', label: words.leads.twoWeeks },
          { value: '30', label: words.leads.month },
        ]}
      />
      <p className="mt-4 text-[13px] leading-snug text-ink-3">{words.notify}</p>
    </Dialog>
  );
}
