import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { createDb } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createBookings } from '../src/bookings.ts';
import type { Bookings } from '../src/bookings.ts';
import { buildApp } from '../src/app.ts';
import { code } from '../src/grpc.ts';
import type { Clients, GrpcStatus } from '../src/grpc.ts';
import type { Hold__Output } from '../src/gen/bookingsystem/event/v1/Hold.ts';
import type { Booking, Outbox } from '../src/types.ts';

// The fields the tests read from a response body. JSON turns the booking's Dates into strings.
interface Body {
  booking: { [K in keyof Booking]: Booking[K] extends Date ? string : Booking[K] };
  error: string;
  events: { price_cents: number }[];
}

const ADMIN = 'postgres://postgres:postgres@localhost:5432/postgres';
const URL = 'postgres://postgres:postgres@localhost:5432/booking_test';
const EVENT = '11111111-1111-4111-8111-111111111111';

// Every RPC by name, as the fakes implement it: (req) => res, sync or async.
type Rpcs = Clients['auth'] & Clients['event'] & Clients['payment'];
type Req<K extends keyof Rpcs> = Parameters<Rpcs[K]>[0];
type Res<K extends keyof Rpcs> = Awaited<ReturnType<Rpcs[K]>>;
type Fake<K extends keyof Rpcs> = (req: Req<K>) => Res<K> | Promise<Res<K>>;
type Fakes = { [K in keyof Rpcs]?: Fake<K> };

const rpcErr = (c: GrpcStatus, details = 'x') => Object.assign(new Error(details), { code: c, details });
const bookingIdOf = (req: unknown) => (typeof req === 'object' && req !== null && 'booking_id' in req ? req.booking_id : undefined);
const unexpected = () => { throw new Error('unexpected call'); };
const liveHold = (booking_id = ''): Hold__Output => ({ booking_id, event_id: EVENT, quantity: 2, amount_cents: '300000',
  status: 'HOLD_STATUS_HELD', expires_at: new Date(Date.now() + 60000).toISOString() });
let db: Db, app: FastifyInstance, bookings: Bookings, calls: [keyof Rpcs, unknown][], published: [keyof Outbox, Outbox[keyof Outbox]][];
let behavior: Fakes & { publish?: Error };

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
  const rec = <K extends keyof Rpcs>(name: K, def: Fake<K>) => async (req: Req<K>): Promise<Res<K>> => {
    calls.push([name, req]);
    const fakes: Fakes = behavior;
    const b = fakes[name];
    if (b) return b(req);
    return def(req);
  };
  const grpc: Clients = {
    auth: {
      Register: rec('Register', unexpected),
      Login: rec('Login', unexpected),
      ValidateToken: rec('ValidateToken', ({ token }) => {
        const users: Record<string, string> = { good: 'u1', good2: 'u2' };
        const user_id = users[token];
        if (!user_id) throw rpcErr(code.UNAUTHENTICATED, 'bad token');
        return { user_id, email: 'a@b.c' };
      }),
    },
    event: {
      CreateEvent: rec('CreateEvent', unexpected),
      GetEvent: rec('GetEvent', unexpected),
      ReserveSeats: rec('ReserveSeats', (r) => ({ hold: liveHold(r.booking_id) })),
      ConfirmSeats: rec('ConfirmSeats', () => ({ hold: null })),
      ReleaseSeats: rec('ReleaseSeats', () => ({ hold: null })),
      ListEvents: rec('ListEvents', () => ({ events: [{ id: EVENT, name: 'e', capacity: 1, available: 1, held: 0, sold: 0, price_cents: '150000', created_at: '' }] })),
    },
    payment: { GetPayment: rec('GetPayment', unexpected), ListPayments: rec('ListPayments', unexpected) },
  };
  const mq = { publish: async <K extends keyof Outbox>(key: K, body: Outbox[K]) => { if (behavior.publish) throw behavior.publish; published.push([key, body]); } };
  bookings = createBookings({ db, grpc, mq });
  app = buildApp({ grpc, db, bookings, healthy: async () => true });
});

const post = (payload: object, token: string | null = 'good', key?: string) => app.inject({
  method: 'POST', url: '/bookings', payload,
  headers: { ...(token && { authorization: `Bearer ${token}` }), ...(key !== undefined && { 'idempotency-key': key }) },
});
const create = async () => (await post({ event_id: EVENT, quantity: 2 })).json<Body>().booking;
const result = (b: { id: string }, status: string) => bookings.onResult({ booking_id: b.id, payment_id: '22222222-2222-4222-8222-222222222222', status, amount_cents: 300000 });
const status = async (id: string) => (await db.get(id))?.status;
const PAY = '22222222-2222-4222-8222-222222222222';
const refunds = () => published.filter(([k]) => k === 'payment.refund.requested').map(([, body]) => body);
const keyed = (key: string, token = 'good', quantity = 2) => post({ event_id: EVENT, quantity }, token, key);
const bookingCount = async () => {
  const p = new pg.Client(URL); await p.connect();
  const n = (await p.query<{ n: number }>('SELECT count(*)::int n FROM bookings')).rows[0]?.n; await p.end();
  return n;
};

test('sold out -> 409 sold_out', async () => {
  behavior.ReserveSeats = () => { throw rpcErr(code.RESOURCE_EXHAUSTED); };
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json<Body>().error, 'sold_out');
});

test('missing or invalid token -> 401, even with an invalid body', async () => {
  assert.equal((await post({ event_id: EVENT, quantity: 1 }, null)).statusCode, 401);
  assert.equal((await post({ event_id: EVENT, quantity: 1 }, 'nope')).statusCode, 401);
  assert.equal((await post({}, 'nope')).statusCode, 401);
});

test('POST /bookings -> 202 PENDING and publishes payment.requested', async () => {
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 202);
  const b = r.json<Body>().booking;
  assert.equal(b.status, 'PENDING');
  assert.equal(b.amount_cents, 300000);
  assert.deepEqual(published, [['payment.requested', { booking_id: b.id, user_id: 'u1', event_id: EVENT, amount_cents: 300000 }]]);
});

test('publish failure releases seats and marks FAILED', async () => {
  behavior.publish = new Error('broker down');
  const r = await post({ event_id: EVENT, quantity: 2 });
  assert.equal(r.statusCode, 500);
  const [b] = await db.listByUser('u1');
  assert.equal(b?.status, 'FAILED');
  assert.ok(calls.some(([n]) => n === 'ReleaseSeats'));
});

test('SUCCEEDED -> CONFIRMED with payment_id', async () => {
  const b = await create();
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = (await app.inject(`/bookings/${b.id}`)).json<Body>().booking;
  assert.equal(got?.status, 'CONFIRMED');
  assert.equal(got?.payment_id, '22222222-2222-4222-8222-222222222222');
});

test('FAILED -> FAILED and seats released', async () => {
  const b = await create();
  await result(b, 'FAILED');
  assert.equal(await status(b.id), 'FAILED');
  assert.ok(calls.some(([n, r]) => n === 'ReleaseSeats' && bookingIdOf(r) === b.id));
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
  await bookings.sweep();
  assert.equal(await status(b.id), 'EXPIRED');
  assert.ok(calls.some(([n]) => n === 'ReleaseSeats'));
});

test('GET /events renders int64 as number', async () => {
  assert.equal((await app.inject('/events')).json<Body>().events[0]?.price_cents, 150000);
});

test('SUCCEEDED + FAILED_PRECONDITION -> EXPIRED and refund hold_expired', async () => {
  const b = await create();
  behavior.ConfirmSeats = () => { throw rpcErr(code.FAILED_PRECONDITION); };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got?.status, 'EXPIRED');
  assert.equal(got?.payment_id, PAY);
  assert.deepEqual(refunds(), [{ booking_id: b.id, payment_id: PAY, reason: 'hold_expired' }]);
});

test('SUCCEEDED after the sweeper expired the booking -> refund booking_not_pending', async () => {
  const b = await create();
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE bookings SET expires_at = now() - interval '1s' WHERE id=$1`, [b.id]); await p.end();
  await bookings.sweep();
  calls.length = 0;
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got?.status, 'EXPIRED');
  assert.equal(got?.payment_id, PAY);
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
  assert.equal(r2.json<Body>().booking.id, r1.json<Body>().booking.id);
  const reserves = calls.filter(([n]) => n === 'ReserveSeats');
  assert.equal(reserves.length, 1);
  assert.equal(bookingIdOf(reserves[0]?.[1]), r1.json<Body>().booking.id);
  // still PENDING, so the replay re-publishes payment.requested for the same booking
  assert.deepEqual(published.map(([k, body]) => [k, body.booking_id]), [['payment.requested', r1.json<Body>().booking.id], ['payment.requested', r1.json<Body>().booking.id]]);
});

test('replay of a non-PENDING booking does not re-publish', async () => {
  const r1 = await keyed('k1');
  await result(r1.json<Body>().booking, 'SUCCEEDED');
  published.length = 0;
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json<Body>().booking.status, 'CONFIRMED');
  assert.deepEqual(published, []);
});

test('20 concurrent same-key requests converge on one booking', async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, () => keyed('same')));
  const ids = new Set<unknown>(rs.map((r) => r.json<Body>().booking.id));
  assert.ok(rs.every((r) => r.statusCode === 202 || r.statusCode === 200), rs.map((r) => r.statusCode).join());
  assert.equal(ids.size, 1);
  assert.equal(await bookingCount(), 1);
  assert.ok(calls.filter(([n]) => n === 'ReserveSeats').every(([, r]) => ids.has(bookingIdOf(r))));
});

test('same key with a different body -> 422 idempotency_key_reused', async () => {
  assert.equal((await keyed('k1', 'good', 2)).statusCode, 202);
  const r = await keyed('k1', 'good', 3);
  assert.equal(r.statusCode, 422);
  assert.equal(r.json<Body>().error, 'idempotency_key_reused');
  assert.equal(await bookingCount(), 1);
});

test('same key from a different user -> independent bookings', async () => {
  const a = await keyed('k1', 'good');
  const b = await keyed('k1', 'good2');
  assert.equal(a.statusCode, 202);
  assert.equal(b.statusCode, 202);
  assert.notEqual(a.json<Body>().booking.id, b.json<Body>().booking.id);
  assert.equal(b.json<Body>().booking.user_id, 'u2');
});

test('bad Idempotency-Key -> 400 invalid_idempotency_key', async () => {
  for (const key of ['', 'x'.repeat(201)]) {
    const r = await keyed(key);
    assert.equal(r.statusCode, 400, JSON.stringify(key));
    assert.equal(r.json<Body>().error, 'invalid_idempotency_key');
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
  assert.equal(r2.json<Body>().booking.status, 'PENDING');
});

test('sweeper deletes idempotency keys older than 24h, at most once a minute', async () => {
  await keyed('old'); await keyed('new');
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key='old'`);
  await bookings.sweep();
  const keys = async () => (await p.query<{ key: string }>('SELECT key FROM idempotency_keys ORDER BY key')).rows.map((r) => r.key);
  assert.deepEqual(await keys(), ['new']);
  await p.query(`UPDATE idempotency_keys SET created_at = now() - interval '25 hours'`);
  await bookings.sweep(); // within the minute: skipped
  assert.deepEqual(await keys(), ['new']);
  await p.end();
});

const expireNow = async (id: string) => {
  const p = new pg.Client(URL); await p.connect();
  await p.query(`UPDATE bookings SET expires_at = now() - interval '1s' WHERE id=$1`, [id]); await p.end();
};

test('sweeper runs right after ConfirmSeats sold the seats -> booking still CONFIRMED, no refund', async () => {
  const b = await create();
  behavior.ReleaseSeats = () => ({ hold: { ...liveHold(b.id), status: 'HOLD_STATUS_CONFIRMED' } }); // release is a no-op on a sold hold
  behavior.ConfirmSeats = async () => { await expireNow(b.id); await bookings.sweep(); return { hold: null }; };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  const got = await db.get(b.id);
  assert.equal(got?.status, 'CONFIRMED');
  assert.equal(got?.payment_id, PAY);
  assert.deepEqual(refunds(), []);
});

test('sweeper keeps an overdue booking PENDING while event is unreachable, expires it once release works', async () => {
  const b = await create();
  await expireNow(b.id);
  behavior.ReleaseSeats = () => { throw rpcErr(code.UNAVAILABLE); };
  await bookings.sweep();
  assert.equal(await status(b.id), 'PENDING');
  delete behavior.ReleaseSeats;
  await bookings.sweep();
  assert.equal(await status(b.id), 'EXPIRED');
});

test('concurrent duplicate confirms the booking first -> no refund', async () => {
  const b = await create();
  behavior.ConfirmSeats = async () => { await db.transition(b.id, 'CONFIRMED', PAY); return { hold: null }; };
  assert.equal(await result(b, 'SUCCEEDED'), 'ack');
  assert.equal(await status(b.id), 'CONFIRMED');
  assert.deepEqual(refunds(), []);
});

test('keyed retry after the hold was released -> fresh booking on a live hold', async () => {
  const holds = new Map<string | undefined, Hold__Output>(); // mirrors event-service: an existing hold is returned unchanged
  behavior.ReserveSeats = (r) => {
    const hold = holds.get(r.booking_id) ?? liveHold(r.booking_id);
    holds.set(r.booking_id, hold);
    return { hold };
  };
  behavior.ReleaseSeats = (r) => { const h = holds.get(r.booking_id); if (h) h.status = 'HOLD_STATUS_RELEASED'; return { hold: null }; };
  const insert = db.insert;
  db.insert = async () => { db.insert = insert; throw new Error('pg blip'); };
  const r1 = await keyed('k1');
  assert.equal(r1.statusCode, 500);
  const r2 = await keyed('k1');
  assert.equal(r2.statusCode, 202);
  const b = r2.json<Body>().booking;
  assert.equal(b.status, 'PENDING');
  assert.equal(holds.get(b.id)?.status, 'HOLD_STATUS_HELD');
  assert.equal(await bookingCount(), 1);
  const r3 = await keyed('k1');
  assert.equal(r3.statusCode, 200);
  assert.equal(r3.json<Body>().booking.id, b.id);
});

test('keyed retry after the hold expired but before the event sweeper -> fresh booking', async () => {
  let n = 0;
  behavior.ReserveSeats = (r) => ({ hold: { ...liveHold(r.booking_id),
    expires_at: new Date(Date.now() + (n++ === 0 ? -1000 : 60000)).toISOString() } });
  const r = await keyed('k1');
  assert.equal(r.statusCode, 202);
  assert.ok(Date.parse(r.json<Body>().booking.expires_at) > Date.now());
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

test('result with a non-uuid id is dropped before any side effect', async () => {
  const b = await create();
  await assert.rejects(bookings.onResult({ booking_id: 'not-a-uuid', payment_id: PAY, status: 'FAILED' }), /bad result message/);
  await assert.rejects(bookings.onResult({ booking_id: b.id, payment_id: 'not-a-uuid', status: 'SUCCEEDED' }), /bad result message/);
  assert.ok(!calls.some(([n]) => n === 'ConfirmSeats' || n === 'ReleaseSeats'));
  assert.equal(await status(b.id), 'PENDING');
});

test('booking row gone during confirm -> requeue, no refund', async () => {
  const b = await create();
  behavior.ConfirmSeats = async () => {
    const p = new pg.Client(URL); await p.connect(); await p.query('DELETE FROM bookings WHERE id=$1', [b.id]); await p.end();
    return { hold: null };
  };
  assert.equal(await result(b, 'SUCCEEDED'), 'requeue');
  assert.deepEqual(refunds(), []);
});

// An RPC request must name every field: proto3 would send a missing one as '' or 0.
// @ts-expect-error booking_id is missing
const _missingField = (c: Clients) => c.event.ConfirmSeats({});
