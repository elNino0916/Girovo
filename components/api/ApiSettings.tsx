'use client';

// Einstellungen → Girovo API (lib/settings-pages.ts 'api'; docs/girovo-api.md),
// on the desktop app with the shell's bridge. Elsewhere the page keeps
// saying that it comes later (components/settings/Settings.tsx).
//
//   - the page's main switch "Girovo API zulassen", as Girovo AI's page heads
//     with its own, here on the primary container; the shell keeps it
//     (./bridge.ts useApiOn), so the API listens before the login too;
//   - Apps: each allowed app with its icon, name, publisher and last use, its
//     permissions as switches, and "Zugriff entziehen";
//   - Mit KI-Assistenten verbinden: where Girovo MCP lies on this computer
//     and Claude Desktop's configuration for it, to copy (phase 3);
//   - Verlauf: the newest calls, what and when, and why one was not answered;
//     a call that changed something with a pencil, the setting it changed,
//     and a transfer request with how it ended (phase 2);
//   - Für Entwickler: the documentation, later on girovo.de.
// Grants and the Verlauf are this computer's (lib/api/grants.ts), never synced.

import { createElement, useContext, useEffect, useId, useRef, useState } from 'react';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { copyText } from '@/lib/clipboard';
import { grantKey, withPermission, withoutGrant } from '@/lib/api/grants';
import { claudeDesktopConfig } from '@/lib/api/mcp';
import { isWriteMethod, type ApiGrant, type ApiLogEntry, type ApiPermission } from '@/lib/api/types';
import { useFints } from '../FintsProvider';
import { CheckIcon, CodeIcon, CopyIcon, EyeIcon, HistoryIcon, InfoIcon, LockIcon, PencilIcon, TransferIcon } from '../icons';
import { GroupHeading, MainSwitch, SettingItem, SettingsGroup, SwitchItem } from '../settings/rows';
import { Button } from '../ui';
import { AppIcon } from './ApiConsent';
import { setApiOn, useApiOn } from './bridge';

/** How many calls the Verlauf shows. */
/** The Verlauf shows the newest few; "Alle anzeigen" opens the rest (owner 2026-11-15: at most 3). */
const LOG_SHOWN = 3;

const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });

export function ApiSettingsPage() {
  const t = useT();
  const words = t.api.page;
  const { vault, updateVault } = useFints();
  const id = useId();
  const on = useApiOn() === true;
  const grants = vault?.apiGrants ?? [];
  const log = vault?.apiLog ?? [];

  const setOn = (next: boolean) => void setApiOn(next);
  const setGrants = (fn: (g: ApiGrant[]) => ApiGrant[]) => updateVault((v) => {
    const next = fn(v.apiGrants ?? []);
    const rest = { ...v };
    if (next.length) rest.apiGrants = next;
    else delete rest.apiGrants;
    return rest;
  });

  const hintId = `${id}-hint`;
  const localId = `${id}-local`;
  return (
    <>
      <section data-setting="api">
        <MainSwitch title={words.use} checked={on} onChange={setOn} describedBy={`${hintId} ${localId}`} tone="api" />
        <div className="flex flex-col gap-1 px-6 pt-3 text-[14px] leading-5 text-ink-2">
          <p id={hintId} className="flex items-start gap-2.5">
            <InfoIcon size={18} className="mt-px shrink-0" />
            {words.hint}
          </p>
          <p id={localId} className="flex items-start gap-2.5">
            <LockIcon size={18} className="mt-px shrink-0" />
            {words.local}
          </p>
        </div>
      </section>

      <AppsSection grants={grants} setGrants={setGrants} />

      <McpSection on={on} />

      <SettingsGroup title={words.log}>
        <LogRows log={log} />
      </SettingsGroup>

      <SettingsGroup title={words.developers}>
        <SettingItem icon={<CodeIcon />} title={words.docs} summary={words.docsLater} />
      </SettingsGroup>
    </>
  );
}

function AppsSection({ grants, setGrants }: { grants: readonly ApiGrant[]; setGrants: (fn: (g: ApiGrant[]) => ApiGrant[]) => void }) {
  const t = useT();
  const id = useId();
  // The subheader as SettingsGroup draws it, one level under the page's name.
  const level = useContext(GroupHeading);
  return (
    <section aria-labelledby={`${id}-apps`} className="flex flex-col gap-3">
      {createElement(level, { id: `${id}-apps`, className: '-mb-1 px-4 text-[14px] leading-5 font-medium tracking-[0.1px] text-accent' }, t.api.page.apps)}
      {grants.length ? (
        grants.map((g) => <AppGroup key={grantKey(g)} grant={g} setGrants={setGrants} />)
      ) : (
        <div data-settings-group>
          <SettingItem icon={<InfoIcon />} title={t.api.page.noApps} />
        </div>
      )}
    </section>
  );
}

/** One allowed app: its head row, then a switch per permission it has (or had, while the page is open). */
function AppGroup({ grant, setGrants }: { grant: ApiGrant; setGrants: (fn: (g: ApiGrant[]) => ApiGrant[]) => void }) {
  const t = useT();
  const words = t.api.page;
  const key = grantKey(grant);
  // A permission switched off keeps its row until the page closes, so it can be switched on again.
  const [shown, setShown] = useState<ReadonlySet<ApiPermission>>(() => new Set(grant.permissions));
  const rows = (Object.keys(t.api.permissions) as ApiPermission[]).filter((p) => shown.has(p) || grant.permissions.includes(p));
  const publisher = grant.publisher ? (grant.publisher.kind === 'mtmedia' ? 'MT-Media' : grant.publisher.name) : words.unknownPublisher;
  const parts = [
    publisher,
    grant.viaMcp ? t.api.consent.viaMcp : null,
    grant.used ? words.lastUsed(when(grant.used)) : words.neverUsed,
  ].filter(Boolean);
  const toggle = (p: ApiPermission, next: boolean) => {
    setShown((s) => new Set([...s, p]));
    setGrants((g) => withPermission(g, key, p, next));
  };
  return (
    <div data-settings-group data-api-grant>
      <div data-item className="flex min-h-[72px] w-full items-center gap-4 px-4 py-3">
        <AppIcon exe={grant.exe} name={grant.name} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] leading-6 font-medium break-words text-ink">{grant.name}</span>
          <span className="block text-[14px] leading-5 text-ink-2">{parts.join(' · ')}</span>
          {!grant.publisher && <span className="block font-mono text-[12px] leading-4 break-all text-ink-2">{grant.exe}</span>}
        </span>
        <Button variant="tertiary" size="sm" className="shrink-0" onClick={() => setGrants((g) => withoutGrant(g, key))}>
          {words.revoke}
        </Button>
      </div>
      {rows.map((p) => (
        <SwitchItem
          key={p}
          title={t.api.permissions[p]}
          summary={t.api.permissionHints[p]}
          checked={grant.permissions.includes(p)}
          onChange={(next) => toggle(p, next)}
        />
      ))}
    </div>
  );
}

/**
 * Mit KI-Assistenten verbinden: Girovo MCP's real path (the shell's
 * api_mcp_path) and Claude Desktop's configuration naming it, with a copy
 * button. Shells without the command show nothing here.
 */
function McpSection({ on }: { on: boolean }) {
  const t = useT();
  const words = t.api.mcp;
  // undefined while the shell is asked, and in shells without the command; null: no helper in this build.
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const ask = window.electronGirovoApi?.mcpPath;
    if (!ask) return undefined;
    let live = true;
    ask().then((p) => live && setPath(p || null), () => live && setPath(null));
    return () => {
      live = false;
      clearTimeout(timer.current);
    };
  }, []);

  if (path === undefined) return null;
  const snippet = path ? claudeDesktopConfig(path) : null;
  const copy = async () => {
    if (!snippet || !(await copyText(snippet))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };
  return (
    <SettingsGroup title={words.title} note={words.cloud}>
      <SettingItem icon={<InfoIcon />} title={words.hint} summary={on ? undefined : words.needsApi} />
      {path && snippet ? (
        <>
          <SettingItem
            icon={<CodeIcon />}
            title={words.helper}
            below={<span className="block font-mono text-[12px] leading-4 break-all text-ink-2" data-mcp-path>{path}</span>}
          />
          <SettingItem
            icon={<CopyIcon />}
            title={words.config}
            summary={words.configHint}
            below={(
              <span className="mt-2 flex flex-col items-start gap-2">
                <code className="block w-full overflow-x-auto rounded-[8px] bg-inset px-3 py-2 font-mono text-[12px] leading-[18px] whitespace-pre text-ink" data-mcp-config>{snippet}</code>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={copied ? <CheckIcon size={16} strokeWidth={2.2} /> : <CopyIcon size={16} />}
                  onClick={() => void copy()}
                >
                  {copied ? words.copied : words.copy}
                </Button>
              </span>
            )}
          />
        </>
      ) : (
        <SettingItem icon={<CodeIcon />} title={words.missing} />
      )}
    </SettingsGroup>
  );
}

function LogRows({ log }: { log: readonly ApiLogEntry[] }) {
  const t = useT();
  const words = t.api.page;
  const [all, setAll] = useState(false);
  if (!log.length) return <SettingItem icon={<HistoryIcon />} title={words.noLog} />;
  const newest = (all ? [...log] : log.slice(-LOG_SHOWN)).reverse();
  return (
    <>
      {newest.map((e, i) => {
        const write = isWriteMethod(e.method);
        const what = words.methods[e.method] ?? e.method;
        // settings.set names the setting; a transfer request how it ended.
        const setting = e.detail ? words.settings[e.detail] ?? e.detail : null;
        const parts = [
          setting ? `${what}: ${setting}` : what,
          when(e.at),
          !e.ok && e.code ? words.outcomes[e.code] : null,
          e.ok && e.outcome ? words.transfer[e.outcome] : null,
        ];
        return (
          <SettingItem
            key={`${e.at}-${i}`}
            icon={e.method === 'transfers.request'
              ? <TransferIcon />
              : write ? <PencilIcon /> : <EyeIcon />}
            title={e.name}
            summary={parts.filter(Boolean).join(' · ')}
          />
        );
      })}
      {log.length > LOG_SHOWN && (
        <button
          type="button"
          data-item
          data-pressable
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="row-focus flex min-h-12 w-full items-center px-4 py-3 text-left text-[14px] leading-5 font-medium text-accent"
        >
          {all ? words.showLess : words.showAll(log.length)}
        </button>
      )}
    </>
  );
}
