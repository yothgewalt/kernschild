import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createDb } from '../src/db.js';
import { createBookings } from '../src/bookings.js';
import { buildApp } from '../src/app.js';
import { code } from '../src/grpc.js';

const ADMIN = 'postgres://postgres:postgres@localhost:5432/postgres';
const URL = 'postgres://postgres:postgres@localhost:5432/booking_test';
const EVENT = '11111111-1111-4111-8111-111111111111';

const rpcErr = (c, details = 'x') => Object.assign(new Error(details), { code: c, details });
let db, app, calls, published, behavior;

before(async () => {
  const admin = new pg.Client(ADMIN);
  await admin.connect();
  if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname='booking_test'`)).rowCount) await admin.query('CREATE DATABASE booking_test');
  await admin.end();
  db = createDb(URL);
  await db.init();
});
after(() => db.close());

beforeEach(async () => {
  await db.ping();
  const p = new pg.Client(URL); await p.connect(); await p.query('TRUNCATE bookings, idempotency_keys'); await p.end();
  calls = []; published = []; behavior = {};
  const rec = (name, def) => async (req) => {
    calls.push([name, req]);
    if (behavior[name]) return behavior[name](req);
    return def(req);
  };
  const grpc = {
    auth: { ValidateToken: rec('ValidateToken', ({ token }) => {
      const users = { good: 'u1', good2: 'u2' };
      if (!users[token]) throw rpcErr(code.UNAUTHENTICATED, 'bad token');
      return { user_id: users[token], email: 'a@b.c' };
    }) },
    event: {
      ReserveSeats: rec('ReserveSeats', (r) => ({ hold: { booking_id: r.booking_id, amount_cents: '300000', status: 'HOLD_STATUS_HELD', expires_at: new Date(Date.now() + 60000).toISOString() } })),
      ConfirmSeats: rec('ConfirmSeats', () => ({})),
      ReleaseSeats: rec('ReleaseSeats', () => ({})),
      ListEvents: rec('ListEvents', () => ({ events: [{ id: EVENT, price_cents: '150000' }] })),
    },
    payment: {},
  };
  const mq = { publish: async (key, body) => { if (behavior.publish) throw behavior.publish; published.push([key, body]); } };
  const bookings = createBookings({ db, grpc, mq });
  app = buildApp({ grpc, db, bookings, healthy: async () => true });
  app.bookings = bookings;
});

const post = (payload, token = 'good', key) => app.inject({
  method: 'POST', url: '/bookings', payload,
  headers: { ...(token && { authorization: `Bearer ${token}` }), ...(key !== undefined && { 'idempotency-key': key }) },
});
const create = async () => (await post({ event_id: EVENT, quantity: 2 })).json().booking;
const result = (b, status) => app.bookings.onResult({ booking_id: b.id, payment_id: '22222222-2222-4222-8222-222222222222', status, amount_cents: 300000 });
const status = async (id) => (await db.get(id)).status;
const PAY = '22222222-2222-4222-8222-222222222222';
const refunds = () => published.filter(([k]) => k === 'payment.refund.requested').map(([, body]) => body);
const keyed = (key, token = 'good', quantity = 2) => post({ event_id: EVENT, quantity }, token, key);
const bookingCount = async () => {
  const p = new pg.Client(URL); await p.connect();
  const n = (await p.query('SELECT count(*)::int n FROM bookings')).rows[0].n; await p.end();
  return n;
};

test('sold out -> 409 sold_out', async () => {
  behavior.ReserveSeats = () => { throw rpcErr(code.RESOURCE_EXHAUSTED); };
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'sold_out');
});

test('missing or invalid token -> 401, even with an invalid body', async () => {
  assert.equal((await post({ event_id: EVENT, quantity: 1 }, null)).statusCode, 401);
  assert.equal((await post({ event_id: EVENT, quantity: 1 }, 'nope')).statusCode, 401);
  assert.equal((await post({}, 'nope')).statusCode, 401);
});

test('POST /bookings -> 202 PENDING and publishes payment.requested', async () => {
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 202);
  const b = r.json().booking;
  assert.equal(b.status, 'PENDING');
  assert.equal(b.amount_cents, 300000);
  assert.deepEqual(published, [['payment.requested', { booking_id: b.id, user_id: 'u1', event_id: EVENT, amount_cents: 300000 }]]);
});

test('publish failure releases seats and marks FAILED', async () => {
  behavior.publish = new Error('broker down');
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 500);
  const [b] = await db.listByUser('u1');
  assert.equal(b.status, 'FAILED');
  assert.ok(calls.some(([n]) => n === 'ReleaseSeats'));
});

test('SUCCEEDED -> CONFIRMED with payment_id', async () => {
  const b = await create();
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = (await app.inject(`/bookings/${b.id}`)).json().booking;
  assert.equal(got.status, 'CONFIRMED');
  assert.equal(got.payment_id, '22222222-2222-4222-8222-222222222222');
});

test('FAILED -> FAILED and seats released', async () => {
  const b = await create();
  await result(b, 'FAILED');
  assert.equal(await status(b.id), 'FAILED');
  assert.ok(calls.some(([n, r]) => n === 'ReleaseSeats' && r.booking_id === b.id));
});

test('SUCCEEDED after hold expiry -> EXPIRED', async () => {
  const b = await create();
  behavior.ConfirmSeats = () => { throw rpcErr(code.FAILED_PRECONDITION); };
  await result(b, 'SUCCEEDED');
  assert.equal(await status(b.id), 'EXPIRED');
});

test('duplicate result message is a no-op', async () => {
  const b = await create();
  await result(b, 'SUCCEEDED');
  calls.length = 0;
  assert.equal(await result(b, 'FAILED'), 'ack');
  assert.equal(await status(b.id), 'CONFIRMED');
  assert.equal(calls.length, 0);
});

test('transient gRPC error requeues and leaves PENDING', async () => {
  const b = await create();
  behavior.ConfirmSeats = () => { throw rpcErr(code.UNAVAILABLE); };
  assert.equal(await result(b, 'SUCCEEDED'), 'requeue');
  assert.equal(await status(b.id), 'PENDING');
});

test('sweeper expires overdue PENDING bookings and releases', async () => {
  const b = await create();
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE bookings SET expires_at = now() - interval '1s' WHERE id=$1`, [b.id]); await p.end();
  await app.bookings.sweep();
  assert.equal(await status(b.id), 'EXPIRED');
  assert.ok(calls.some(([n]) => n === 'ReleaseSeats'));
});

test('GET /events renders int64 as number', async () => {
  assert.equal((await app.inject('/events')).json().events[0].price_cents, 150000);
});

test('SUCCEEDED + FAILED_PRECONDITION -> EXPIRED and refund hold_expired', async () => {
  const b = await create();
  behavior.ConfirmSeats = () => { throw rpcErr(code.FAILED_PRECONDITION); };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got.status, 'EXPIRED');
  assert.equal(got.payment_id, PAY);
  assert.deepEqual(refunds(), [{ booking_id: b.id, payment_id: PAY, reason: 'hold_expired' }]);
});

test('SUCCEEDED after the sweeper expired the booking -> refund booking_not_pending', async () => {
  const b = await create();
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE bookings SET expires_at = now() - interval '1s' WHERE id=$1`, [b.id]); await p.end();
  await app.bookings.sweep();
  calls.length = 0;
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got.status, 'EXPIRED');
  assert.equal(got.payment_id, PAY);
  assert.deepEqual(refunds(), [{ booking_id: b.id, payment_id: PAY, reason: 'booking_not_pending' }]);
  assert.ok(!calls.some(([n]) => n === 'ConfirmSeats'));
});

test('duplicate SUCCEEDED for a CONFIRMED booking -> no refund', async () => {
  const b = await create();
  await result(b, 'SUCCEEDED');
  calls.length = 0;
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  assert.equal(await status(b.id), 'CONFIRMED');
  assert.deepEqual(refunds(), []);
  assert.equal(calls.length, 0);
});

test('refund publish failure -> requeue; redelivery publishes the refund', async () => {
  const b = await create();
  behavior.ConfirmSeats = () => { throw rpcErr(code.FAILED_PRECONDITION); };
  behavior.publish = new Error('broker down');
  assert.equal(await result(b, 'SUCCEEDED'), 'requeue');
  delete behavior.publish;
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  assert.deepEqual(refunds(), [{ booking_id: b.id, payment_id: PAY, reason: 'booking_not_pending' }]);
});

test('same Idempotency-Key and body twice -> same booking, second is a 200 replay', async () => {
  const r1 = await keyed('k1');
  assert.equal(r1.statusCode, 202);
  assert.equal(r1.headers['idempotent-replayed'], undefined);
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.headers['idempotent-replayed'], 'true');
  assert.equal(r2.json().booking.id, r1.json().booking.id);
  const reserves = calls.filter(([n]) => n === 'ReserveSeats');
  assert.equal(reserves.length, 1);
  assert.equal(reserves[0][1].booking_id, r1.json().booking.id);
  // still PENDING, so the replay re-publishes payment.requested for the same booking
  assert.deepEqual(published.map(([k, body]) => [k, body.booking_id]), [['payment.requested', r1.json().booking.id], ['payment.requested', r1.json().booking.id]]);
});

test('replay of a non-PENDING booking does not re-publish', async () => {
  const r1 = await keyed('k1');
  await result(r1.json().booking, 'SUCCEEDED');
  published.length = 0;
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json().booking.status, 'CONFIRMED');
  assert.deepEqual(published, []);
});

test('20 concurrent same-key requests converge on one booking', async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, () => keyed('same')));
  const ids = new Set(rs.map((r) => r.json().booking.id));
  assert.ok(rs.every((r) => r.statusCode === 202 || r.statusCode === 200), rs.map((r) => r.statusCode).join());
  assert.equal(ids.size, 1);
  assert.equal(await bookingCount(), 1);
  assert.ok(calls.filter(([n]) => n === 'ReserveSeats').every(([, r]) => ids.has(r.booking_id)));
});

test('same key with a different body -> 422 idempotency_key_reused', async () => {
  assert.equal((await keyed('k1', 'good', 2)).statusCode, 202);
  const r = await keyed('k1', 'good', 3);
  assert.equal(r.statusCode, 422);
  assert.equal(r.json().error, 'idempotency_key_reused');
  assert.equal(await bookingCount(), 1);
});

test('same key from a different user -> independent bookings', async () => {
  const a = await keyed('k1', 'good');
  const b = await keyed('k1', 'good2');
  assert.equal(a.statusCode, 202);
  assert.equal(b.statusCode, 202);
  assert.notEqual(a.json().booking.id, b.json().booking.id);
  assert.equal(b.json().booking.user_id, 'u2');
});

test('bad Idempotency-Key -> 400 invalid_idempotency_key', async () => {
  for (const key of ['', 'x'.repeat(201)]) {
    const r = await keyed(key);
    assert.equal(r.statusCode, 400, JSON.stringify(key));
    assert.equal(r.json().error, 'invalid_idempotency_key');
  }
  assert.equal((await keyed('x'.repeat(200))).statusCode, 202);
  assert.equal(calls.filter(([n]) => n === 'ReserveSeats').length, 1);
});

test('key after a 409 sold out -> retry succeeds once seats exist', async () => {
  behavior.ReserveSeats = () => { throw rpcErr(code.RESOURCE_EXHAUSTED); };
  const r1 = await keyed('k1');
  assert.equal(r1.statusCode, 409);
  assert.equal(await bookingCount(), 0);
  delete behavior.ReserveSeats;
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 202);
  assert.equal(r2.json().booking.status, 'PENDING');
});

test('sweeper deletes idempotency keys older than 24h, at most once a minute', async () => {
  await keyed('old'); await keyed('new');
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key='old'`);
  await app.bookings.sweep();
  const keys = async () => (await p.query('SELECT key FROM idempotency_keys ORDER BY key')).rows.map((r) => r.key);
  assert.deepEqual(await keys(), ['new']);
  await p.query(`UPDATE idempotency_keys SET created_at = now() - interval '25 hours'`);
  await app.bookings.sweep(); // within the minute: skipped
  assert.deepEqual(await keys(), ['new']);
  await p.end();
});

const expireNow = async (id) => {
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE bookings SET expires_at = now() - interval '1s' WHERE id=$1`, [id]); await p.end();
};

test('sweeper expires the booking while ConfirmSeats succeeds -> refund booking_not_pending', async () => {
  const b = await create();
  behavior.ConfirmSeats = async () => { await expireNow(b.id); await app.bookings.sweep(); return {}; };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got.status, 'EXPIRED');
  assert.equal(got.payment_id, PAY);
  assert.deepEqual(refunds(), [{ booking_id: b.id, payment_id: PAY, reason: 'booking_not_pending' }]);
});

test('concurrent duplicate confirms the booking first -> no refund', async () => {
  const b = await create();
  behavior.ConfirmSeats = async () => { await db.transition(b.id, 'CONFIRMED', PAY); return {}; };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  assert.equal(await status(b.id), 'CONFIRMED');
  assert.deepEqual(refunds(), []);
});

test('keyed retry after the hold was released -> fresh booking on a live hold', async () => {
  const holds = new Map(); // mirrors event-service: an existing hold is returned unchanged
  behavior.ReserveSeats = (r) => {
    if (!holds.has(r.booking_id)) holds.set(r.booking_id, { booking_id: r.booking_id, amount_cents: '300000', status: 'HOLD_STATUS_HELD', expires_at: new Date(Date.now() + 60000).toISOString() });
    return { hold: holds.get(r.booking_id) };
  };
  behavior.ReleaseSeats = (r) => { const h = holds.get(r.booking_id); if (h) h.status = 'HOLD_STATUS_RELEASED'; return {}; };
  const insert = db.insert;
  db.insert = async () => { db.insert = insert; throw new Error('pg blip'); };
  const r1 = await keyed('k1');
  assert.equal(r1.statusCode, 500);
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 202);
  const b = r2.json().booking;
  assert.equal(b.status, 'PENDING');
  assert.equal(holds.get(b.id).status, 'HOLD_STATUS_HELD');
  assert.equal(await bookingCount(), 1);
  const r3 = await keyed('k1');
  assert.equal(r3.statusCode, 200);
  assert.equal(r3.json().booking.id, b.id);
});

test('keyed retry after the hold expired but before the event sweeper -> fresh booking', async () => {
  let n = 0;
  behavior.ReserveSeats = (r) => ({ hold: { booking_id: r.booking_id, amount_cents: '300000', status: 'HOLD_STATUS_HELD',
    expires_at: new Date(Date.now() + (n++ === 0 ? -1000 : 60000)).toISOString() } });
  const r = await keyed('k1');
  assert.equal(r.statusCode, 202);
  assert.ok(Date.parse(r.json().booking.expires_at) > Date.now());
});

test('database or INTERNAL error while handling a result -> requeue, not drop', async () => {
  const b = await create();
  const get = db.get;
  db.get = async () => { db.get = get; throw new Error('ECONNREFUSED'); };
  assert.equal(await result(b, 'SUCCEEDED'), 'requeue');
  behavior.ConfirmSeats = () => { throw rpcErr(code.INTERNAL); };
  assert.equal(await result(b, 'SUCCEEDED'), 'requeue');
  assert.equal(await status(b.id), 'PENDING');
  delete behavior.ConfirmSeats;
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  assert.equal(await status(b.id), 'CONFIRMED');
});
