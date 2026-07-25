'use client';

import { useFints } from './FintsProvider';
import { cx } from './ui';

export function Toasts() {
  const { toasts } = useFints();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-200 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'anim-toast max-w-[360px] rounded-[9px] px-4 py-2.5 text-[13.5px] font-medium shadow-[var(--shadow-pop)]',
            t.tone === 'error' ? 'bg-red text-white' : 'bg-ink text-paper',
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
