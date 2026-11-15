'use client';

// Girovo 7 on the desktop: the profile above all banks (lib/profile.ts) in
// Einstellungen → Sicherheit (its name, the password, Windows Hello, deleting
// it) and the dialog that creates one. The provider offers that dialog once
// after a login without a profile; the row "Profil anlegen" stays until
// there is one. The create dialog is mounted by Dashboard, at every width.

import { useEffect, useRef, useState } from 'react';
import { PROFILE_PASSWORD_MIN } from '@/lib/profile-client';
import { useT } from '@/lib/i18n/react';
import { helloAvailable } from '@/lib/windows-hello-client';
import { useFints } from '../FintsProvider';
import { FingerprintIcon, LockIcon, PencilIcon, TrashIcon, UserIcon } from '../icons';
import { firstName, holderName, sessionHolder } from '../shell/session';
import { Alert, Button, Checkbox, Dialog, Field, Input } from '../ui';
import { ActionItem, SettingsGroup, SwitchItem } from './rows';

const MIN = PROFILE_PASSWORD_MIN;
const charCount = (s: string) => Array.from(s).length;

/** Whether Windows Hello can open the profile here: asked once per mount. */
function useHelloAvailable(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void helloAvailable().then((v) => { if (live) setOn(v); });
    return () => { live = false; };
  }, []);
  return on;
}

/** The group on the Sicherheit page; nothing where the app keeps no profile (the phone, a browser). */
export function ProfileGroup() {
  const t = useT();
  const words = t.profile.settings;
  const { profile, openProfileCreate, setProfileHello } = useFints();
  const hello = useHelloAvailable();
  const [open, setOpen] = useState<'rename' | 'password' | 'delete' | null>(null);
  const [switching, setSwitching] = useState(false);
  if (!profile.served) return null;

  if (!profile.exists) {
    return (
      <SettingsGroup title={words.section}>
        <ActionItem icon={<UserIcon />} title={t.profile.create.title} summary={t.profile.create.text} onClick={openProfileCreate} />
      </SettingsGroup>
    );
  }
  if (!profile.open) return null;

  return (
    <SettingsGroup title={words.section}>
      <ActionItem icon={<PencilIcon />} title={words.name} summary={profile.name} action={words.rename} onClick={() => setOpen('rename')} />
      <ActionItem icon={<LockIcon />} title={words.password} summary={words.passwordHint} onClick={() => setOpen('password')} />
      {(hello || profile.hello) && (
        <SwitchItem
          icon={<FingerprintIcon />}
          title={words.hello}
          summary={words.helloHint}
          checked={profile.hello}
          disabled={switching}
          onChange={(next) => {
            setSwitching(true);
            void setProfileHello(next).finally(() => setSwitching(false));
          }}
        />
      )}
      <ActionItem icon={<TrashIcon />} title={words.delete} summary={words.deleteHint} onClick={() => setOpen('delete')} />
      {open === 'rename' && <RenameDialog onClose={() => setOpen(null)} />}
      {open === 'password' && <PasswordDialog onClose={() => setOpen(null)} />}
      {open === 'delete' && <DeleteDialog onClose={() => setOpen(null)} />}
    </SettingsGroup>
  );
}

function RenameDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const words = t.profile.settings;
  const { profile, renameProfile, toast } = useFints();
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!name.trim()) {
      setError(t.profile.create.noName);
      return;
    }
    setBusy(true);
    const problem = await renameProfile(name);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    toast(words.renamed, 'success');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={words.renameTitle}
      initialFocus={first}
      actions={(
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{t.common.save}</Button>
        </>
      )}
    >
      <Field label={t.profile.create.name} hint={t.profile.create.nameHint} error={error ?? undefined} className="mb-1">
        <Input
          ref={first}
          value={name}
          maxLength={40}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); }
          }}
        />
      </Field>
    </Dialog>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const words = t.profile.settings;
  const { changeProfilePassword, toast } = useFints();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<'short' | 'mismatch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (charCount(next) < MIN) { setProblem('short'); return; }
    if (next !== again) { setProblem('mismatch'); return; }
    setBusy(true);
    setError(null);
    const failed = await changeProfilePassword(current, next);
    setBusy(false);
    if (failed) { setError(failed); return; }
    toast(words.changed, 'success');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      onBackdrop={() => {}}
      title={words.password}
      description={t.profile.create.noReset}
      initialFocus={first}
      actions={(
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{t.common.save}</Button>
        </>
      )}
    >
      <Field label={words.current}>
        <Input ref={first} type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(null); }} />
      </Field>
      <Field label={words.next} hint={t.profile.create.passwordHint(MIN)} error={problem === 'short' ? t.profile.create.tooShort(MIN) : undefined}>
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setProblem(null); }} />
      </Field>
      <Field label={t.profile.create.again} error={problem === 'mismatch' ? t.profile.create.mismatch : undefined} className="mb-1">
        <Input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => { setAgain(e.target.value); if (problem === 'mismatch') setProblem(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); }
          }}
        />
      </Field>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Dialog>
  );
}

/** Deleting asks for the password: the safe button has the focus, the dangerous one needs it typed. */
function DeleteDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const words = t.profile.settings;
  const { deleteProfile } = useFints();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!password) return;
    setBusy(true);
    const failed = await deleteProfile(password);
    setBusy(false);
    if (failed) { setError(failed); return; }
    onClose();
  };
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={words.deleteTitle}
      description={words.deleteText}
      actions={(
        <>
          <Button variant="secondary" data-autofocus disabled={busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="danger" busy={busy} disabled={!password} onClick={() => void run()}>{words.delete}</Button>
        </>
      )}
    >
      <Field label={words.deleteConfirm} error={error ?? undefined} className="mb-1">
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} />
      </Field>
    </Dialog>
  );
}

/**
 * Whether this computer can keep a profile: the shell hands out the secret
 * its locks take (src-tauri/src/secret.rs). Null while asking.
 */
function useCanKeepProfile(): boolean | null {
  const [can, setCan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const ask = typeof window !== 'undefined' ? window.electronLinkedUnlock?.secret() : undefined;
    if (!ask) { setCan(false); return; }
    ask.then((s) => { if (live) setCan(!!s); }, () => { if (live) setCan(false); });
    return () => { live = false; };
  }, []);
  return can;
}

/**
 * "Profil anlegen": a name (the holder's first person to start with), the
 * password twice, Windows Hello if Windows has it. What the password cannot
 * be reset is said before it is set. Girovo 7 needs a profile, so it does
 * not close: Abmelden is the other way out. Only where this computer cannot
 * keep a profile at all does it offer "Später", for this run of the app.
 */
export function CreateProfileDialog() {
  const t = useT();
  const words = t.profile.create;
  const { profile, profileCreateOpen, closeProfileCreate, createProfile, accounts, requestLogout } = useFints();
  const hello = useHelloAvailable();
  const canKeep = useCanKeepProfile();
  if (!profile.served || profile.exists || !profileCreateOpen) return null;
  const holder = holderName(sessionHolder(accounts));
  return (
    <CreateForm
      key="create"
      suggested={firstName(holder) ? holder : ''}
      hello={hello}
      words={words}
      // The demo and the design preview have no shell secret: there the dialog is shown as Girovo 7 shows it.
      other={canKeep === false && typeof window !== 'undefined' && !!window.electronLinkedUnlock
        ? { label: words.later, run: closeProfileCreate }
        : { label: t.common.logout, run: requestLogout }}
      create={createProfile}
    />
  );
}

function CreateForm({ suggested, hello, words, other, create }: {
  suggested: string;
  hello: boolean;
  words: ReturnType<typeof useT>['profile']['create'];
  /** The way out beside "Profil anlegen": Abmelden, or "Später" where no profile can be kept. */
  other: { label: string; run: () => void };
  create: (input: { name: string; password: string; hello: boolean }) => Promise<string | null>;
}) {
  const [name, setName] = useState(suggested.slice(0, 40));
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [withHello, setWithHello] = useState(true);
  const [problem, setProblem] = useState<'name' | 'short' | 'mismatch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!name.trim()) { setProblem('name'); return; }
    if (charCount(password) < MIN) { setProblem('short'); return; }
    if (password !== again) { setProblem('mismatch'); return; }
    setBusy(true);
    setError(null);
    const failed = await create({ name, password, hello: hello && withHello });
    setBusy(false);
    // Made: the profile exists now and the dialog goes by itself.
    if (failed) setError(failed);
  };
  return (
    <Dialog
      open
      onBackdrop={() => {}}
      title={words.title}
      icon={<UserIcon size={20} />}
      description={words.text}
      initialFocus={first}
      actions={(
        <>
          <Button variant="secondary" disabled={busy} onClick={other.run}>{other.label}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{words.submit}</Button>
        </>
      )}
    >
      <Field label={words.name} hint={words.nameHint} error={problem === 'name' ? words.noName : undefined}>
        <Input
          ref={first}
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => { setName(e.target.value); if (problem === 'name') setProblem(null); }}
        />
      </Field>
      <Field label={words.password} hint={words.passwordHint(MIN)} error={problem === 'short' ? words.tooShort(MIN) : undefined}>
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); if (problem === 'short') setProblem(null); }} />
      </Field>
      <Field label={words.again} error={problem === 'mismatch' ? words.mismatch : undefined} className={hello ? 'mb-3' : 'mb-1'}>
        <Input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => { setAgain(e.target.value); if (problem === 'mismatch') setProblem(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); }
          }}
        />
      </Field>
      {hello && <Checkbox label={words.hello} checked={withHello} onChange={(e) => setWithHello(e.target.checked)} disabled={busy} />}
      <Alert tone="info" className="mt-3">{words.noReset}</Alert>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Dialog>
  );
}
