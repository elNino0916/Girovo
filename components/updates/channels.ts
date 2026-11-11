// The update channels the updater offers (docs/update-channels.md). Stabil and
// Nightly are the app's own and named by its texts; girovo.de can list more,
// which bring their own names. Shells from before 6.2.0 report no list: they
// know the two built-in channels only.

import type { Locale } from '@/lib/i18n/locale';
import type { Messages } from '@/lib/i18n/messages';

const BUILTIN: readonly UpdateChannelInfo[] = [
  { id: 'stable', builtin: true, usage: false },
  { id: 'preview', builtin: true, usage: true },
];

type ChannelWords = Messages['settings']['channel'];

/** The channels to offer, Stabil and Nightly first. */
export function channelsOf(state: ElectronUpdateState | null | undefined): readonly UpdateChannelInfo[] {
  return state?.channels?.length ? state.channels : BUILTIN;
}

/** What the shell says about channel `id`, or undefined for one it does not offer. */
export function channelInfo(state: ElectronUpdateState | null | undefined, id: UpdateChannel | undefined): UpdateChannelInfo | undefined {
  return id == null ? undefined : channelsOf(state).find((c) => c.id === id);
}

/** Whether choosing channel `id` comes with usage data. Nightly does even when a shell reports nothing about it. */
export function needsUsage(state: ElectronUpdateState | null | undefined, id: UpdateChannel | undefined): boolean {
  return channelInfo(state, id)?.usage ?? id === 'preview';
}

/** The channel's name on screen. */
export function channelName(info: UpdateChannelInfo | undefined, id: UpdateChannel, words: ChannelWords, locale: Locale): string {
  if (id === 'stable') return words.stable;
  if (id === 'preview') return words.preview;
  return info?.name?.[locale] || id;
}

/** The channel's one-line hint under its name in the choice. */
export function channelHint(info: UpdateChannelInfo | undefined, id: UpdateChannel, words: ChannelWords, locale: Locale): string {
  if (id === 'stable') return words.stableHint;
  if (id === 'preview') return words.previewHint;
  return info?.hint?.[locale] ?? '';
}
