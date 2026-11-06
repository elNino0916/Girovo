// The route handlers' telemetry (lib/telemetry.ts) on the desktop: they run
// in this page, so their reports go to the shell's hub (src-tauri/src/telemetry.rs),
// which scrubs the errors, drops usage without the user's yes and keeps only
// the fields it declares, exactly as for the shell's own reports. The phone's
// hub takes them through this very sink (mobile/bridges/telemetry.ts).

import { invoke } from '../shell';

type Sink = (message: Record<string, unknown>) => void;

export function installTelemetry(): void {
  (globalThis as { __girovoTelemetrySink?: Sink }).__girovoTelemetrySink = (message) => {
    // A report must never break a request, nor wait for one.
    invoke('telemetry_relay', { message }).catch(() => {});
  };
}
