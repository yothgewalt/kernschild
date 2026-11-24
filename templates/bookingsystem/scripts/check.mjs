// End-to-end checks for email+name customers, idempotent bookings, late-payment refunds and
// Redis-loss recovery.
// Usage: node scripts/check.mjs customer|idempotency|refund|redis-loss  (task check runs all
// with the service settings each one needs).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { BASE, api, must, newCustomer, sleep } from './lib.mjs';

const checks = { customer, idempotency, refund, 'redis-loss': redisLoss };
const name = process.argv[2];
if (!checks[name]) throw new Error(`usage: check.mjs ${Object.keys(checks).join('|')}`);
await checks[name]();
console.log(`OK: ${name}`);

async function newEvent(capacity) {
  const body = { name: `check ${name} ${crypto.randomUUID().slice(0, 8)}`, capacity, price_cents: 1000 };
  return (await must('POST', '/events', { body })).event;
}

async function eventNow(id) {
  return (await must("GET", `/events/${id}`)).event;
}

async function until(label, fn, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function post(key, body) {
  return fetch(`${BASE}/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, replayed: r.headers.get('idempotent-replayed'), body: await r.json() }));
}

// Booking needs only an email and a name; both are validated, and email identifies the customer.
async function customer() {
  const event = await newEvent(5);
  const who = newCustomer('cust');
  const bad = [
    ['missing email', { event_id: event.id, quantity: 1, name: who.name }],
    ['invalid email', { event_id: event.id, quantity: 1, name: who.name, email: 'not-an-email' }],
    ['missing name', { event_id: event.id, quantity: 1, email: who.email }],
    ['blank name', { event_id: event.id, quantity: 1, email: who.email, name: '   ' }],
  ];
  for (const [label, body] of bad) {
    const r = await api('POST', '/bookings', { body });
    console.log(`${label} →`, r.status, r.body?.error);
    assert.equal(r.status, 400, label);
  }
  const { booking } = await must('POST', '/bookings', { body: { event_id: event.id, quantity: 1, email: `  ${who.email.toUpperCase()} `, name: ` ${who.name} ` } });
  console.log('booked with messy email/name →', { email: booking.email, name: booking.name, status: booking.status });
  assert.equal(booking.email, who.email, 'email is trimmed and lowercased');
  assert.equal(booking.name, who.name, 'name is trimmed');
  const mine = (await must('GET', `/bookings?email=${encodeURIComponent(who.email.toUpperCase())}`)).bookings;
  console.log('GET /bookings?email= (upper-cased query) →', mine.map((b) => b.id));
  assert.deepEqual(mine.map((b) => b.id), [booking.id]);
  const noEmail = await api('GET', '/bookings');
  assert.equal(noEmail.status, 400, 'GET /bookings requires ?email=');
}

async function idempotency() {
  const who = newCustomer('idem');
  const event = await newEvent(5);
  const key = crypto.randomUUID();
  const body = { event_id: event.id, quantity: 2, ...who };

  const burst = await Promise.all(Array.from({ length: 20 }, () => post(key, body)));
  const ids = new Set(burst.map((r) => r.body.booking?.id));
  console.log('20 concurrent same-key requests →', { statuses: burst.map((r) => r.status).join(','), distinct_booking_ids: ids.size });
  assert.equal(ids.size, 1, 'same key must yield one booking');
  assert.ok(burst.every((r) => r.status === 202 || r.status === 200), 'unexpected status');

  const ev = await eventNow(event.id);
  console.log('seats after burst →', { available: ev.available, held: ev.held, sold: ev.sold });
  assert.equal(ev.available + ev.held + ev.sold, 5);
  assert.equal(5 - ev.available, 2, 'seats must be held once, not 20 times');

  const replay = await post(key, body);
  console.log('sequential replay →', { status: replay.status, replayed: replay.replayed, same_id: replay.body.booking.id === [...ids][0] });
  assert.equal(replay.status, 200);
  assert.equal(replay.replayed, 'true');

  const reused = await post(key, { ...body, quantity: 1 });
  console.log('same key, different body →', reused.status, reused.body.error);
  assert.equal(reused.status, 422);

  const otherRes = await post(key, { ...body, ...newCustomer('idem2') });
  console.log('same key, other customer email →', { status: otherRes.status, independent: otherRes.body.booking?.id !== [...ids][0] });
  assert.equal(otherRes.status, 202);
  assert.notEqual(otherRes.body.booking.id, [...ids][0]);
}

// Needs payment slower than the hold (task check sets HOLD_TTL=5s, payment 8–10s, success 100%).
async function refund() {
  const event = await newEvent(3);
  const { booking } = await must('POST', '/bookings', { body: { event_id: event.id, quantity: 1, ...newCustomer('refund') } });
  console.log('booked', booking.id, booking.status);

  const expired = await until('EXPIRED', async () => {
    const b = (await must('GET', `/bookings/${booking.id}`)).booking;
    return b.status !== 'PENDING' && b;
  });
  console.log('booking →', expired.status);
  assert.equal(expired.status, 'EXPIRED');

  const payment = await until('REFUNDED', async () => {
    const r = await api('GET', `/payments/${booking.id}`);
    return r.body?.payment?.status === 'REFUNDED' && r.body.payment;
  });
  console.log('payment →', payment.status, `(charged after the hold expired, then refunded)`);
  const ev = await eventNow(event.id);
  console.log('seats →', { available: ev.available, held: ev.held, sold: ev.sold });
  assert.deepEqual([ev.available, ev.held, ev.sold], [3, 0, 0]);
}

// Needs payment to finish inside the hold (task check sets HOLD_TTL=60s, payment 6–8s, success 100%).
async function redisLoss() {
  const who = newCustomer('redis');
  const event = await newEvent(10);
  const bookings = await Promise.all(
    [1, 2, 3].map(async () => (await must('POST', '/bookings', { body: { event_id: event.id, quantity: 1, ...who } })).booking),
  );
  console.log('3 bookings PENDING, seats →', pick(await eventNow(event.id)));

  execFileSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'FLUSHALL'], { stdio: 'inherit' });
  console.log('FLUSHALL: Redis lost every key while payments were in flight');

  const rebuilt = await until('rebuild', async () => {
    const ev = await eventNow(event.id);
    return ev.held === 3 && ev;
  }, 10);
  console.log('after rebuild, seats →', pick(rebuilt));

  const final = await until('settle', async () => {
    const st = await Promise.all(bookings.map(async (b) => (await must('GET', `/bookings/${b.id}`)).booking.status));
    return !st.includes('PENDING') && st;
  });
  console.log('booking outcomes →', final.join(','));
  assert.deepEqual(final, ['CONFIRMED', 'CONFIRMED', 'CONFIRMED'], 'mid-payment bookings must survive Redis loss');
  const ev = await eventNow(event.id);
  console.log('final seats →', pick(ev));
  assert.deepEqual([ev.available, ev.held, ev.sold], [7, 0, 3]);
}

function pick({ available, held, sold }) {
  return { available, held, sold };
}
