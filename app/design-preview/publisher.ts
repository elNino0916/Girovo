// A stand-in for "MT-Media als Herausgeber" (window.electronPublisherCert) in
// the design preview: every state of Sicherheit → Herausgeber without the
// desktop shell, UAC or the machine's trust stores. ?publisher=<state> on any
// view. The buttons work: installing turns the state to trusted, removing to
// not installed, each after a moment, as the real one waits for UAC.

import type { PublisherCertAnswer, PublisherCertStatus } from '@/types/electron-window';

export const PUBLISHER_STATES = ['notInstalled', 'trusted', 'invalid', 'expired', 'mismatch'] as const;
export type PublisherState = (typeof PUBLISHER_STATES)[number];

export const isPublisherState = (s: string): s is PublisherState => (PUBLISHER_STATES as readonly string[]).includes(s);

function status(state: PublisherState): PublisherCertStatus {
  const installed = state === 'trusted' || state === 'invalid' || state === 'expired';
  return {
    available: true,
    state,
    publisher: 'MT-Media',
    subject: 'CN=MT-Media, O=MT-Media, OU=Software Development, L=Mömlingen, S=Bayern, C=DE',
    thumbprint: '07995B7408F1482085F8DC239DEC4294F0CAF149',
    sha256: '0F12F14D595982FF1B017F860169A51EBD464CEAA60230E04192B7E2E0895AB5',
    validUntil: '2028-11-14',
    inRoot: installed,
    inTrustedPublisher: installed && state !== 'invalid',
  };
}

export function installFakePublisherCert(state: PublisherState | null) {
  if (typeof window === 'undefined') return;
  if (!state) {
    delete window.electronPublisherCert;
    return;
  }
  let now = state;
  const later = (next: PublisherState): Promise<PublisherCertAnswer> =>
    new Promise((resolve) => setTimeout(() => {
      now = next;
      resolve({ result: 'done', status: status(now) });
    }, 900));
  window.electronPublisherCert = {
    status: async () => status(now),
    install: () => later('trusted'),
    remove: () => later('notInstalled'),
  };
}
