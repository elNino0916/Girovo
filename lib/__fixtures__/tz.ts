// Pins every test process to German local time before any fixture builds a
// Date. Import this first: the app buckets bookings by *local* day, and the
// interesting cases (a booking dated 3 October arriving as
// "2026-10-02T22:00:00.000Z", the two DST switches) only exist in a zone
// that is not UTC. Node applies a TZ change immediately, on every platform.
process.env.TZ = 'Europe/Berlin';

export {};
