// Booking orchestration and the one status machine: PENDING -> CONFIRMED | FAILED | EXPIRED.
// Every transition goes through db.transition (guarded on status='PENDING').
import { createHash, randomUUID } from 'node:crypto';
import { code, grpcCode } from './grpc.ts';
import type { Clients } from './grpc.ts';
import type { Db } from './db.ts';
import type { Mq } from './mq.ts';
import { errorMessage, isPaymentResult } from './types.ts';
import type { Booking, BookingStatus, Customer, RefundReason } from './types.ts';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const KEY_SWEEP_MS = 60_000;

export type HttpError = Error & { statusCode: number; httpError: string };
const httpError = (status: number, error: string, message: string): HttpError =>
  Object.assign(new Error(message), { statusCode: status, httpError: error });

export type Verdict = 'ack' | 'requeue';
export interface BookingRequest extends Customer { event_id: string; quantity: number }
export type Bookings = ReturnType<typeof createBookings>;

export function createBookings({ db, grpc, mq }: { db: Db; grpc: Clients; mq: Pick<Mq, 'publish'> }) {
  let lastKeySweep = 0;
  const requestPayment = (b: Pick<Booking, 'id' | 'email' | 'event_id' | 'amount_cents'>) =>
    mq.publish('payment.requested', { booking_id: b.id, email: b.email, event_id: b.event_id, amount_cents: b.amount_cents });

  const bookings = {
    // Returns { booking, replayed }. With an idempotency key, the booking id comes from the stored key.
    async create({ event_id, quantity, email, name }: BookingRequest, key: string | undefined, rebound = false): Promise<{ booking: Booking | undefined; replayed: boolean }> {
      let id: string = randomUUID();
      if (key !== undefined) {
        const hash = createHash('sha256').update(JSON.stringify({ event_id, quantity, email, name })).digest('hex');
        const stored = await db.claimKey(email, key, hash, id);
        if (stored.request_hash !== hash) throw httpError(422, 'idempotency_key_reused', 'Idempotency-Key was used with a different request');
        id = stored.booking_id;
        const existing = await db.get(id);
        if (existing) {
          if (existing.status === 'PENDING') await requestPayment(existing); // heals a crash between insert and publish
          log('booking replayed', id);
          return { booking: existing, replayed: true };
        }
      }
      const { hold } = await grpc.event.ReserveSeats({ booking_id: id, event_id, quantity });
      if (!hold) throw new Error(`ReserveSeats returned no hold for ${id}`);
      if (hold.status !== 'HOLD_STATUS_HELD' || Date.parse(hold.expires_at) <= Date.now()) {
        // A keyed retry of a try that reserved but never inserted, whose hold has since died:
        // ReserveSeats returns it unchanged forever, so rebind the key to a fresh id once.
        if (key === undefined || rebound) throw new Error(`ReserveSeats returned a dead hold for ${id}`);
        log('idempotency key points at a dead hold, rebinding', id);
        await db.releaseKey(email, key, id);
        return bookings.create({ event_id, quantity, email, name }, key, true);
      }
      const b = { id, email, name, event_id, quantity, amount_cents: Number(hold.amount_cents), expires_at: hold.expires_at };
      try { await db.insert(b); } catch (e) {
        await grpc.event.ReleaseSeats({ booking_id: id }).catch(() => {});
        throw e;
      }
      try {
        await requestPayment(b);
      } catch (e) {
        log('publish failed, releasing', id, errorMessage(e));
        await grpc.event.ReleaseSeats({ booking_id: id }).catch(() => {});
        await db.transition(id, 'FAILED');
        throw e;
      }
      log('booking pending', id);
      return { booking: await db.get(id), replayed: false };
    },

    // Returns 'ack' or 'requeue'. Duplicate and late messages are no-ops, except that a
    // SUCCEEDED payment on a booking that will never confirm is refunded (idempotent downstream).
    async onResult(msg: unknown): Promise<Verdict> {
      if (!isPaymentResult(msg)) throw new Error('bad result message');
      // shortcut: every failure below requeues (a dropped SUCCEEDED is a charge never refunded), so a
      // permanently failing message retries once a second forever; add a DLX if that shows up.
      try {
        const b = await db.get(msg.booking_id);
        if (!b) { log('result for unknown booking', msg.booking_id); return 'ack'; }
        const refund = async (reason: RefundReason): Promise<Verdict> => {
          try {
            await mq.publish('payment.refund.requested', { booking_id: b.id, payment_id: msg.payment_id, reason });
          } catch (e) { log('refund publish failed, requeue', b.id, errorMessage(e)); return 'requeue'; }
          log('refund requested', b.id, reason);
          return 'ack';
        };
        // SUCCEEDED on a booking that is no longer PENDING: CONFIRMED is a duplicate, anything else is refunded.
        const notPending = async (status: BookingStatus): Promise<Verdict> => {
          if (status === 'CONFIRMED') return 'ack';
          await db.setPaymentIdIfNull(b.id, msg.payment_id);
          return refund('booking_not_pending');
        };
        if (msg.status === 'FAILED') {
          if (b.status !== 'PENDING') return 'ack';
          await grpc.event.ReleaseSeats({ booking_id: b.id });
          if (await db.transition(b.id, 'FAILED', msg.payment_id)) log('booking failed', b.id);
          return 'ack';
        }
        if (b.status !== 'PENDING') return notPending(b.status); // the sweeper or a publish failure got there first
        try {
          await grpc.event.ConfirmSeats({ booking_id: b.id });
        } catch (e) {
          if (grpcCode(e) !== code.FAILED_PRECONDITION && grpcCode(e) !== code.NOT_FOUND) throw e;
          if (await db.transition(b.id, 'EXPIRED', msg.payment_id)) log('booking expired: payment succeeded after hold expired', b.id);
          else await db.setPaymentIdIfNull(b.id, msg.payment_id); // the sweeper expired it meanwhile
          return refund('hold_expired');
        }
        if (await db.transition(b.id, 'CONFIRMED', msg.payment_id)) { log('booking confirmed', b.id); return 'ack'; }
        // A duplicate confirmed it first (the sweeper never expires a booking whose hold is CONFIRMED).
        log('booking left PENDING during confirm', b.id);
        const now = await db.get(b.id);
        if (!now) throw new Error('booking vanished during confirm'); // requeue; the retry acks it as unknown
        return notPending(now.status);
      } catch (e) {
        log('result handling failed, requeue', msg.booking_id, errorMessage(e));
        return 'requeue';
      }
    },

    // Event owns the hold, so release first and let its answer decide: a hold it already
    // CONFIRMED means a paid result is mid-flight and will confirm this booking.
    async sweep() {
      for (const id of await db.listOverdue()) {
        let hold;
        try { ({ hold } = await grpc.event.ReleaseSeats({ booking_id: id })); } catch (e) { log('release failed, retry next sweep', id, errorMessage(e)); continue; }
        if (hold?.status === 'HOLD_STATUS_CONFIRMED') continue;
        if (await db.transition(id, 'EXPIRED')) log('booking expired', id);
      }
      if (Date.now() - lastKeySweep >= KEY_SWEEP_MS) {
        lastKeySweep = Date.now();
        const n = await db.deleteOldKeys();
        if (n) log('deleted expired idempotency keys', n);
      }
    },
  };
  return bookings;
}
