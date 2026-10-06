'use client';

// A release's notes, from the blocks lib/release-notes.ts reads out of the
// Markdown — React elements only, never HTML. Links leave the window like
// every other outside link (main.cjs sends them to the real browser).

import { Fragment } from 'react';
import { useT } from '@/lib/i18n/react';
import type { Inline, NotesBlock } from '@/lib/release-notes';
import { ExternalIcon } from '../icons';

function Inlines({ nodes }: { nodes: Inline[] }) {
  const t = useT();
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return <strong key={i} className="font-semibold text-ink"><Inlines nodes={n.children} /></strong>;
      case 'em':
        return <em key={i}><Inlines nodes={n.children} /></em>;
      case 'code':
        return <code key={i} className="rounded-[4px] bg-raised px-1 py-px font-mono text-[0.9em] text-ink">{n.text}</code>;
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent underline-offset-4 hover:underline"
          >
            <Inlines nodes={n.children} />
            {/* As "Auf GitHub": the link opens the browser, not this window. */}
            <ExternalIcon size={12} className="ml-0.5 inline-block align-[-1px]" />
            <span className="sr-only">{` ${t.shell.opensExternally}`}</span>
          </a>
        );
    }
  });
}

export function ReleaseNotes({ blocks }: { blocks: NotesBlock[] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return b.level === 2 ? (
            <h4 key={i} className="mt-2 text-[14.5px] font-bold text-headline first:mt-0">
              <Inlines nodes={b.children} />
            </h4>
          ) : (
            <h5 key={i} className="mt-1 text-[14px] font-semibold text-ink first:mt-0">
              <Inlines nodes={b.children} />
            </h5>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-3">
              {b.items.map((item, j) => (
                <li key={j}><Inlines nodes={item} /></li>
              ))}
            </ul>
          );
        }
        return <p key={i}><Inlines nodes={b.children} /></p>;
      })}
    </div>
  );
}
