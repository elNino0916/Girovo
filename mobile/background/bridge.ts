// What BackgroundJob.java gives the invisible WebView it runs the check in
// (window.GirovoBg, a JavaScript interface): every call answers at once, on
// the WebView's bridge thread — a bank request blocks this script until the
// bank has answered, which nobody waits for here.

export type GirovoBg = {
  /** The secret the PINs' box is sealed with (BackgroundState), base64; null when it cannot be had. */
  secret(): string | null;
  readBox(): string | null;
  /** Written only while the box is still `expected` (a compare-and-set against the page's runtime). */
  writeBoxIf(expected: string | null, text: string | null): boolean;
  /** Written whatever is there (deleting a box this secret does not open). */
  writeBox(text: string | null): void;
  /** Whether the app is in front, or waits for an approval: the user's own session then. */
  inFront(): boolean;
  /** Cancels the six-hourly job: the checks are off. */
  cancel(): void;
  /** The state folder's file names, as JSON. */
  listFiles(): string;
  /** One file of the state folder as UTF-8 text, or null. */
  readFile(name: string): string | null;
  /** One HTTPS request, as JSON both ways (see BackgroundJob.java). */
  http(request: string): string;
  /** What the check found: {channel, notices}. */
  notify(payload: string): void;
  log(message: string): void;
  /** Ends the job. */
  done(summary: string): void;
};

export const bg = (): GirovoBg => (globalThis as unknown as { GirovoBg: GirovoBg }).GirovoBg;
