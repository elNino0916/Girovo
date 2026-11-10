// Pins a test process to New York time before any fixture builds a Date —
// the counterpart of tz.ts for the cases that only exist west of Greenwich:
// there `new Date('2025-11-03')` (UTC midnight) is still the evening of the
// 2nd, so a bank day kept as a bare yyyy-mm-dd shows up a day early wherever
// it is read that way. Import this first, in a test file of its own: each
// test file runs in its own process, so no other test sees the change.
process.env.TZ = 'America/New_York';

export {};
