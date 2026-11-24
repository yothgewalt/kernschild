// Fires N concurrent bookings at an event with CAPACITY seats and checks nothing is oversold.
// Usage: node scripts/loadtest.mjs [N=500] [CAPACITY=100] [USERS=20]
import assert from 'node:assert/strict';
import { api, must, newCustomer, sleep } from './lib.mjs';

const [N = 500, CAPACITY = 100, USERS = 20] = process.argv.slice(2).map(Number);

const customers = Array.from({ length: USERS }, () => newCustomer('load'));
const { event } = await must('POST', '/events', {
  body: { name: `Load test ${new Date().toISOString()}`, capacity: CAPACITY, price_cents: 5000 },
});
console.log(`event ${event.id}: capacity=${CAPACITY}, firing ${N} concurrent bookings from ${USERS} customers`);

const started = performance.now();
const results = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const t0 = performance.now();
    const res = await api('POST', '/bookings', {
      body: { event_id: event.id, quantity: 1, ...customers[i % USERS] },
    });
    return { ...res, ms: performance.now() - t0 };
  }),
);
const elapsed = (performance.now() - started) / 1000;

const byStatus = Object.groupBy(results, (r) => r.status);
const accepted = (byStatus[202] ?? []).map((r) => r.body.booking.id);
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))].toFixed(0);
console.log(
  `burst done in ${elapsed.toFixed(2)}s (${(N / elapsed).toFixed(0)} req/s), p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`,
);
console.log('HTTP status counts:', Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.length])));

const unexpected = results.filter((r) => r.status !== 202 && r.status !== 409);
assert.equal(unexpected.length, 0, `unexpected responses: ${JSON.stringify(unexpected.slice(0, 3))}`);
// Can exceed CAPACITY: a payment that fails mid-burst releases its seats and a later request takes them.
assert.ok(accepted.length >= Math.min(N, CAPACITY), 'seats left unsold while requests were rejected');
if (accepted.length > CAPACITY) console.log(`${accepted.length - CAPACITY} seats were re-held after a failed payment released them`);

const afterBurst = (await must('GET', `/events/${event.id}`)).event;
console.log('right after burst:', pick(afterBurst));
assert.equal(afterBurst.available + afterBurst.held + afterBurst.sold, CAPACITY, 'seat accounting broken');

console.log('waiting for payments to settle…');
// Settled = every booking left PENDING (booking writes its status after event updates the counters).
let final;
for (let i = 0; i < 120; i++) {
  final = await Promise.all(accepted.map(async (id) => (await must('GET', `/bookings/${id}`)).booking.status));
  if (!final.includes('PENDING')) break;
  await sleep(1000);
}
const ev = (await must('GET', `/events/${event.id}`)).event;
const finalCounts = Object.fromEntries(Object.entries(Object.groupBy(final, (s) => s)).map(([k, v]) => [k, v.length]));
assert.equal(ev.held, 0, 'holds still outstanding after every booking settled');
console.log('settled event:', pick(ev));
console.log('booking outcomes:', finalCounts);

assert.equal(finalCounts.PENDING ?? 0, 0, 'bookings left PENDING');
assert.equal(ev.sold, finalCounts.CONFIRMED ?? 0, 'sold seats must match CONFIRMED bookings');
assert.ok(ev.sold <= CAPACITY, 'oversold');
assert.equal(ev.available + ev.sold, CAPACITY, 'unsold seats must return to the pool');
console.log('OK: no oversell, every hold settled, seat accounting consistent');

function pick({ capacity, available, held, sold }) {
  return { capacity, available, held, sold };
}
