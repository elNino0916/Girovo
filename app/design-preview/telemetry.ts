// A stand-in for the desktop shell's telemetry bridge (window.electronTelemetry)
// in the design preview, so the "Nutzungsdaten teilen?" tile, the Sitzung
// switch and the privacy lines can be seen without the desktop app.
// ?usage=unasked|on|off picks the answer; without it there is no bridge, as
// in the web app. Nothing is sent: events and errors go to the console.

import { forgetUsageConsent, type UsageConsent } from '@/components/telemetry/usage';

export const USAGE_SCENARIOS = ['unasked', 'on', 'off'] as const;

export function installFakeTelemetry(consent: UsageConsent | null): void {
  if (!consent) {
    delete window.electronTelemetry;
  } else {
    let answer: UsageConsent = consent;
    window.electronTelemetry = {
      consent: () => answer,
      setConsent: async (on) => (answer = on ? 'on' : 'off'),
      event: (name, props) => console.info('[design-preview] usage event', name, props ?? {}),
      error: (err) => console.info('[design-preview] error report', err),
    };
  }
  forgetUsageConsent();
}
