import Fastify from 'fastify';
import compress from '@fastify/compress';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { code, grpcCode } from './grpc.ts';
import type { Clients, GrpcStatus } from './grpc.ts';
import type { Db } from './db.ts';
import type { BookingRequest, Bookings } from './bookings.ts';
import type { Event__Output } from './gen/bookingsystem/event/v1/Event.ts';
import type { Payment__Output } from './gen/bookingsystem/payment/v1/Payment.ts';

const IDEMPOTENCY_KEY = /^[\x20-\x7E]{1,200}$/; // 1..200 printable ASCII

const HTTP_BY_GRPC: Partial<Record<GrpcStatus, readonly [number, string]>> = {
  [code.INVALID_ARGUMENT]: [400, 'invalid_argument'],
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

interface NewEvent { name: string; capacity: number; price_cents: number }
const uuid = { type: 'string', format: 'uuid' };
const email = { type: 'string', format: 'email', maxLength: 254 };

// Runs in preValidation, so the schema checks the normalized values: a padded email is valid and a blank name fails minLength.
// Non-strings get 400 here: Ajv's coerceTypes would turn ["X"] or 5 into a string after this hook, skipping normalization.
async function normalizeCustomer(req: FastifyRequest, reply: FastifyReply) {
  const o = (req.method === 'GET' ? req.query : req.body) as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null) return;
  for (const f of ['email', 'name'] as const) {
    if (!(f in o)) continue;
    const v = o[f];
    if (typeof v !== 'string') return reply.code(400).send({ error: 'invalid_request', message: `${f} must be a string` });
    o[f] = f === 'email' ? v.trim().toLowerCase() : v.trim();
  }
}

export async function buildApp({ grpc, db, bookings, healthy }: { grpc: Clients; db: Db; bookings: Bookings; healthy: () => Promise<boolean> }) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(onError);
  // gzip/br/deflate per Accept-Encoding for bodies over 1 KiB; awaited so the hook covers every route below.
  await app.register(compress, { threshold: 1024 });

  app.get('/healthz', async (_, reply) => {
    const ok = await healthy().catch(() => false);
    return reply.code(ok ? 200 : 503).send({ ok });
  });

  app.get('/events', async () => ({ events: (await grpc.event.ListEvents({})).events.map(event) }));
  app.get<{ Params: { id: string } }>('/events/:id', async (req) => ({ event: event((await grpc.event.GetEvent({ id: req.params.id })).event) }));
  app.post<{ Body: NewEvent }>('/events', {
    schema: { body: { type: 'object', required: ['name', 'capacity', 'price_cents'],
      properties: { name: { type: 'string' }, capacity: { type: 'integer' }, price_cents: { type: 'integer' } } } },
  }, async (req, reply) => reply.code(201).send({ event: event((await grpc.event.CreateEvent(req.body)).event) }));

  app.post<{ Body: BookingRequest; Headers: { 'idempotency-key'?: string } }>('/bookings', {
    preValidation: normalizeCustomer,
    schema: { body: { type: 'object', required: ['event_id', 'quantity', 'email', 'name'], properties: {
      event_id: uuid, quantity: { type: 'integer', minimum: 1, maximum: 10 }, email, name: { type: 'string', minLength: 1, maxLength: 100 } } } },
  }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
      return reply.code(400).send({ error: 'invalid_idempotency_key', message: 'Idempotency-Key must be 1..200 printable ASCII chars' });
    }
    const { booking, replayed } = await bookings.create(req.body, key);
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.code(replayed ? 200 : 202).send({ booking });
  });
  app.get<{ Querystring: { email: string } }>('/bookings', {
    preValidation: normalizeCustomer,
    schema: { querystring: { type: 'object', required: ['email'], properties: { email } } },
  }, async (req) => ({ bookings: await db.listByEmail(req.query.email) }));
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
