// The background check on the phone (lib/background-check.ts), as
// BackgroundJob.java runs it every six hours in a WebView nobody sees:
// scripts/build-mobile.mjs bundles this as mobile-background.js, with the
// same shims as the page's runtime — but no Capacitor: the bank, the files
// and the notifications are reached through window.GirovoBg (./bridge.ts).
//
// It mounts the state folder read-only (the remembered devices), opens the
// sealed box with the shell's secret, runs one check, hands the notices to
// Android and ends the job. Whatever happens, the job ends.

// First: fetch() through the job's HTTPS stack, then the files the desktop
// ships beside its server (lib/banks.ts and lib/session.ts read them while
// they load).
import './fetch';
import '../server/assets';
import { bankPolicy } from '../../lib/bank-fetch.ts';
import { bankSide } from '../../lib/background-bank';
import { parseSecret, runCheck } from '../../lib/background-check';
import type { BackgroundStore } from '../../lib/background-store';
import { backgroundStore } from '../../lib/background-store';
import { msgs } from '../../lib/i18n/index.ts';
import { mountData, refuseData, unreadableFiles } from '../shims/fs';
import { bg } from './bridge';

// A request blocks until the bank answers (BackgroundJob.java times it); a
// timer here could not end it anyway.
bankPolicy.firstByteMs = Infinity;

const store: BackgroundStore = {
  read: async () => bg().readBox(),
  write: async (text, expected) => {
    if (expected === undefined) {
      bg().writeBox(text);
      return true;
    }
    return bg().writeBoxIf(expected, text);
  },
};
(globalThis as typeof globalThis & { __girovoBackgroundStore?: BackgroundStore }).__girovoBackgroundStore = store;
// The app in front, or waiting for an approval: its own session reads the banks then (lib/background-bank.ts).
(globalThis as typeof globalThis & { __girovoAppInFront?: () => boolean }).__girovoAppInFront = () => bg().inFront();

async function main(): Promise<string> {
  const files = await mountData('fints-state');
  // A file that could not be read (the app writing it this very moment): a
  // device profile missing would pause its login as if it no longer opened.
  // This run fails instead, and the next one reads it.
  if (unreadableFiles().length) throw new Error(`${unreadableFiles().length} saved file(s) could not be read`);
  refuseData();
  const secret = parseSecret(bg().secret());
  if (!secret) return 'no secret';
  const result = await runCheck(backgroundStore(), secret, bankSide);
  if (result.notices.length) {
    bg().notify(JSON.stringify({ channel: msgs().background.channel, notices: result.notices }));
  }
  // Nothing kept any more (the last PIN refused, the box gone): no more jobs.
  if (!result.on) bg().cancel();
  // Counts only.
  return `files=${files} checked=${result.checked} notices=${result.notices.length}`;
}

main().then(
  (summary) => bg().done(summary),
  (err) => {
    bg().log(`failed: ${(err as Error)?.name || 'Error'}`);
    bg().done('failed');
  },
);
