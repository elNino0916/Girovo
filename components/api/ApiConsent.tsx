'use client';

// The Girovo API's consent dialog (docs/girovo-api.md, "The dialog"), like
// Windows' UAC, inside Girovo's window: one request at a time
// (./consent-store.ts), the window asking for attention while one waits.
//
//   - the app's icon (the shell reads it from the executable; a generic glyph
//     where it has none), its name as Girovo found it, and "Herausgeber: …"
//     with the verified mark (MT-Media, a publisher Windows trusts), or
//     "Herausgeber: unbekannt" with the file's path and the warning callout
//     (Container High, the glyph in Marker Orange: DESIGN.md's warning;
//     amber stays Vorgemerkt's);
//   - "über Girovo MCP" when an assistant asks through Girovo's helper;
//   - the app's own reason line, set apart and marked as the app's words:
//     an app's text is never an instruction to Girovo or to the user;
//   - one switch per permission, on as asked;
//   - Zulassen and Ablehnen. The Safe Choice Rule: for an unknown publisher
//     Ablehnen is the filled button; for a signed app Zulassen is.
// No Escape and no backdrop: the user decides, as with UAC.

import { useEffect, useId, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { appName, grantSubject } from '@/lib/api/grants';
import { showsPath } from '@/lib/api/host-state';
import type { ApiPermission } from '@/lib/api/types';
import { AlertTriangleIcon, MonitorIcon, ShieldIcon } from '../icons';
import { Button, DialogActions, Overlay, Sheet, Switch } from '../ui';
import { useCurrentConsent } from './consent-store';

/** The executable's icon from the shell, or null (none, or no shell to ask). */
export function useAppIcon(exe: string | undefined): string | null {
  const [icon, setIcon] = useState<{ exe: string; url: string | null } | null>(null);
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.electronGirovoApi;
    if (!exe || !bridge) return;
    let live = true;
    bridge.icon(exe).then((url) => live && setIcon({ exe, url: url ?? null }), () => live && setIcon({ exe, url: null }));
    return () => {
      live = false;
    };
  }, [exe]);
  return icon && icon.exe === exe ? icon.url : null;
}

/** The app's icon at `size`: its own picture, else its first letter on a tile (many tools, Codex too, carry no icon). */
export function AppIcon({ exe, name, size = 48 }: { exe: string; name: string; size?: number }) {
  const t = useT();
  const url = useAppIcon(exe);
  if (url) {
    return <img src={url} alt={t.api.consent.icon(name)} width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[12px] bg-[var(--md-secondary-container)] font-medium text-[var(--md-on-secondary-container)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {appName(name).match(/\p{L}|\p{N}/u)?.[0]?.toLocaleUpperCase('de') ?? <MonitorIcon size={Math.round(size * 0.5)} />}
    </span>
  );
}

export function ApiConsentDialog() {
  const waiting = useCurrentConsent();
  // Keyed by the request: the next one in the queue starts with its own switches.
  return waiting ? <ConsentSheet key={waiting.request.id} waiting={waiting} /> : null;
}

function ConsentSheet({ waiting }: { waiting: NonNullable<ReturnType<typeof useCurrentConsent>> }) {
  const t = useT();
  const words = t.api.consent;
  const id = useId();
  const titleId = `${id}-title`;
  const { request } = waiting;
  const { who, viaMcp } = grantSubject(request.client);
  const unknown = who.publisher.kind === 'unknown';
  const publisherName = who.publisher.kind === 'mtmedia' ? 'MT-Media' : who.publisher.name;
  const [on, setOn] = useState<ReadonlySet<ApiPermission>>(() => new Set(request.permissions));
  const more = request.existing.length > 0;
  // The app's own name for itself only where it is not the one Girovo found.
  // Through Girovo MCP the name it sends is the helper's own ("Girovo MCP"), not the assistant's: left out.
  const shown = appName(who.name);
  const claim = !viaMcp && request.app && request.app.toLocaleLowerCase() !== shown.toLocaleLowerCase() && request.app.toLocaleLowerCase() !== who.name.toLocaleLowerCase() ? request.app : null;

  const allow = () => waiting.answer({ allow: request.permissions.filter((p) => on.has(p)) });
  const refuse = () => waiting.answer({ refused: true });
  const toggle = (p: ApiPermission, next: boolean) => setOn((s) => {
    const copy = new Set(s);
    if (next) copy.add(p);
    else copy.delete(p);
    return copy;
  });

  const allowButton = (
    // Nothing switched on is nothing to allow: Ablehnen is the answer then.
    <Button key="allow" variant={unknown ? 'secondary' : 'primary'} onClick={allow} disabled={on.size === 0}>{words.allow}</Button>
  );
  const refuseButton = (
    <Button key="refuse" variant={unknown ? 'primary' : 'secondary'} onClick={refuse}>{words.refuse}</Button>
  );

  return (
    <Overlay open labelledBy={titleId}>
      <Sheet
        size="md"
        footer={(
          <DialogActions className="">
            {/* The filled one goes last: rightmost, or topmost when the row stacks. */}
            {unknown ? [allowButton, refuseButton] : [refuseButton, allowButton]}
          </DialogActions>
        )}
      >
        <h2 id={titleId} className="text-[22px] leading-7 font-medium text-headline">{more ? words.titleMore : words.title}</h2>

        <div data-api-app className="mt-5 flex items-start gap-4">
          <AppIcon exe={who.exe} name={shown} />
          <div className="min-w-0 flex-1">
            <p className="text-[18px] leading-6 font-medium break-words text-ink">{shown}</p>
            {unknown ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-[14px] leading-5 text-ink-2">
                <AlertTriangleIcon size={16} className="shrink-0 text-emphasis" />
                {words.publisherUnknown}
              </p>
            ) : (
              <p className="mt-0.5 flex items-center gap-1.5 text-[14px] leading-5 text-ink-2">
                <ShieldIcon check size={16} className="shrink-0 text-green" aria-label={words.verified} role="img" />
                {words.publisher(publisherName ?? '')}
              </p>
            )}
            {viaMcp && <p className="text-[14px] leading-5 text-ink-2">{words.viaMcp}</p>}
            {claim && <p className="text-[14px] leading-5 text-ink-2">{words.saysItIs(claim)}</p>}
            {who.elevated && <p className="text-[14px] leading-5 text-ink-2">{words.elevated}</p>}
            {showsPath(who) && <p data-api-path className="mt-1 font-mono text-[12px] leading-4 break-all text-ink-2">{who.exe}</p>}
          </div>
        </div>

        {unknown && (
          <p className="mt-4 flex items-start gap-3 rounded-[12px] bg-inset py-3 pr-3 pl-4 text-[14px] leading-5 text-ink">
            <AlertTriangleIcon size={18} className="mt-px shrink-0 text-emphasis" />
            {words.unknownWarning}
          </p>
        )}

        {request.reason && (
          <figure className="mt-4 rounded-[12px] bg-inset px-4 py-3">
            <figcaption className="text-[12px] leading-4 font-medium text-ink-2">{words.reasonLabel}</figcaption>
            {/* The app's words, quoted as they came: never Girovo's, never an instruction. */}
            <blockquote className="mt-1 text-[14px] leading-5 break-words whitespace-pre-line text-ink">„{request.reason}“</blockquote>
          </figure>
        )}

        <h3 className="mt-6 text-[14px] leading-5 font-medium tracking-[0.1px] text-accent">{more ? words.asksMore : words.asks}</h3>
        <ul className="mt-1">
          {request.permissions.map((p) => (
            <li key={p} className="py-2">
              <Switch
                checked={on.has(p)}
                onChange={(next) => toggle(p, next)}
                label={t.api.permissions[p]}
                description={t.api.permissionHints[p]}
                className="items-center"
              />
            </li>
          ))}
        </ul>
      </Sheet>
    </Overlay>
  );
}
