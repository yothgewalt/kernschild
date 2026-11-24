import Fastify from 'fastify';
import compress from '@fastify/compress';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { code, grpcCode } from './grpc.ts';
import type { Clients, GrpcStatus } from './grpc.ts';
import type { Db } from './db.ts';
import type { BookingRequest, Bookings } from './bookings.ts';
import type { AuthedUser } from './types.ts';
import type { Event__Output } from './gen/bookingsystem/event/v1/Event.ts';
import type { Payment__Output } from './gen/bookingsystem/payment/v1/Payment.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser; // set by the auth onRequest hook
  }
}

const IDEMPOTENCY_KEY = /^[\x20-\x7E]{1,200}$/; // 1..200 printable ASCII

const HTTP_BY_GRPC: Partial<Record<GrpcStatus, readonly [number, string]>> = {
  [code.INVALID_ARGUMENT]: [400, 'invalid_argument'],
  [code.UNAUTHENTICATED]: [401, 'unauthenticated'],
  [code.PERMISSION_DENIED]: [403, 'forbidden'],
  [code.NOT_FOUND]: [404, 'not_found'],
  [code.ALREADY_EXISTS]: [409, 'already_exists'],
  [code.RESOURCE_EXHAUSTED]: [409, 'sold_out'],
  [code.FAILED_PRECONDITION]: [409, 'failed_precondition'],
  [code.UNAVAILABLE]: [503, 'unavailable'],
  [code.DEADLINE_EXCEEDED]: [504, 'timeout'],
};

// The single gRPC -> HTTP error mapping. Handlers throw grpc ServiceErrors and HttpErrors too, not only FastifyErrors.
function onError(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (err.validation) return reply.code(400).send({ error: 'invalid_request', message: err.message });
  if ('httpError' in err && err.httpError && typeof err.statusCode === 'number') {
    return reply.code(err.statusCode).send({ error: err.httpError, message: err.message });
  }
  const c = grpcCode(err);
  const m = c === undefined ? undefined : HTTP_BY_GRPC[c];
  if (m) return reply.code(m[0]).send({ error: m[1], message: ('details' in err ? err.details : undefined) ?? err.message });
  req.log.error(err);
  const status = err.statusCode ?? 500;
  reply.code(status).send(status < 500 ? { error: 'bad_request', message: err.message } : { error: 'internal', message: 'internal error' });
}

const num = (x: string) => Number(x);
const strip = (prefix: string, s: string) => String(s).replace(prefix, '');
const event = (e: Event__Output | null) => e && { ...e, price_cents: num(e.price_cents) };
const payment = (p: Payment__Output | null) => p && { ...p, amount_cents: num(p.amount_cents), status: strip('PAYMENT_STATUS_', p.status) };

interface Creds { email: string; password: string }
interface NewEvent { name: string; capacity: number; price_cents: number }
const creds = { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } };
const uuid = { type: 'string', format: 'uuid' };

const unauthenticated = () => Object.assign(new Error('missing bearer token'), { code: code.UNAUTHENTICATED });

export async function buildApp({ grpc, db, bookings, healthy }: { grpc: Clients; db: Db; bookings: Bookings; healthy: () => Promise<boolean> }) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(onError);
  // gzip/br/deflate per Accept-Encoding for bodies over 1 KiB; awaited so the hook covers every route below.
  await app.register(compress, { threshold: 1024 });

  const authenticate = async (req: FastifyRequest) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m?.[1]) throw unauthenticated();
    req.user = await grpc.auth.ValidateToken({ token: m[1] });
  };
  // Only routes with the auth hook call this, so a missing user cannot happen there.
  const userOf = (req: FastifyRequest): AuthedUser => {
    if (!req.user) throw unauthenticated();
    return req.user;
  };
  // onRequest so a bad token is 401 before body validation can say 400.
  const auth = { onRequest: authenticate };

  app.get('/healthz', async (_, reply) => {
    const ok = await healthy().catch(() => false);
    return reply.code(ok ? 200 : 503).send({ ok });
  });

  app.post<{ Body: Creds }>('/auth/register', { schema: { body: creds } }, async (req, reply) =>
    reply.code(201).send({ user: (await grpc.auth.Register(req.body)).user }));
  app.post<{ Body: Creds }>('/auth/login', { schema: { body: creds } }, async (req) => grpc.auth.Login(req.body));

  app.get('/events', async () => ({ events: (await grpc.event.ListEvents({})).events.map(event) }));
  app.get<{ Params: { id: string } }>('/events/:id', async (req) => ({ event: event((await grpc.event.GetEvent({ id: req.params.id })).event) }));
  app.post<{ Body: NewEvent }>('/events', {
    ...auth,
    schema: { body: { type: 'object', required: ['name', 'capacity', 'price_cents'],
      properties: { name: { type: 'string' }, capacity: { type: 'integer' }, price_cents: { type: 'integer' } } } },
  }, async (req, reply) => reply.code(201).send({ event: event((await grpc.event.CreateEvent(req.body)).event) }));

  app.post<{ Body: BookingRequest; Headers: { 'idempotency-key'?: string } }>('/bookings', {
    ...auth,
    schema: { body: { type: 'object', required: ['event_id', 'quantity'], properties: { event_id: uuid, quantity: { type: 'integer' } } } },
  }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
      return reply.code(400).send({ error: 'invalid_idempotency_key', message: 'Idempotency-Key must be 1..200 printable ASCII chars' });
    }
    const { booking, replayed } = await bookings.create(userOf(req), req.body, key);
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.code(replayed ? 200 : 202).send({ booking });
  });
  app.get('/bookings', auth, async (req) => ({ bookings: await db.listByUser(userOf(req).user_id) }));
  app.get<{ Params: { id: string } }>('/bookings/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const booking = await db.get(req.params.id);
    return booking ? { booking } : reply.code(404).send({ error: 'not_found', message: 'booking not found' });
  });

  app.get<{ Querystring: { limit?: string } }>('/payments', async (req) => ({
    payments: (await grpc.payment.ListPayments({ limit: Number(req.query.limit) || 0 })).payments.map(payment),
  }));
  app.get<{ Params: { bookingId: string } }>('/payments/:bookingId', async (req) =>
    ({ payment: payment((await grpc.payment.GetPayment({ booking_id: req.params.bookingId })).payment) }));

  app.get('/stats', async () => ({
    bookings: await db.counts(),
    events: (await grpc.event.ListEvents({})).events.map(event),
  }));

  return app;
}
