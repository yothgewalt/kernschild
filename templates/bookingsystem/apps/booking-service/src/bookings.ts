// Booking orchestration and the one status machine: PENDING -> CONFIRMED | FAILED | EXPIRED.
// Every transition goes through db.transition (guarded on status='PENDING').
import { createHash, randomUUID } from 'node:crypto';
import { code } from './grpc.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const KEY_SWEEP_MS = 60_000;

const httpError = (status, error, message) => Object.assign(new Error(message), { statusCode: status, httpError: error });

export function createBookings({ db, grpc, mq }) {
  let lastKeySweep = 0;
  const requestPayment = (b) =>
    mq.publish('payment.requested', { booking_id: b.id, user_id: b.user_id, event_id: b.event_id, amount_cents: b.amount_cents });

  const bookings = {
    // Returns { booking, replayed }. With an idempotency key, the booking id comes from the stored key.
    async create(user, { event_id, quantity }, key, rebound = false) {
      let id = randomUUID();
      if (key !== undefined) {
        const hash = createHash('sha256').update(JSON.stringify({ event_id, quantity })).digest('hex');
        const stored = await db.claimKey(user.user_id, key, hash, id);
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
      if (hold.status !== 'HOLD_STATUS_HELD' || Date.parse(hold.expires_at) <= Date.now()) {
        // A keyed retry of a try that reserved but never inserted, whose hold has since died:
        // ReserveSeats returns it unchanged forever, so rebind the key to a fresh id once.
        if (key === undefined || rebound) throw new Error(`ReserveSeats returned a dead hold for ${id}`);
        log('idempotency key points at a dead hold, rebinding', id);
        await db.releaseKey(user.user_id, key, id);
        return bookings.create(user, { event_id, quantity }, key, true);
      }
      const b = { id, user_id: user.user_id, event_id, quantity, amount_cents: Number(hold.amount_cents), expires_at: hold.expires_at };
      try { await db.insert(b); } catch (e) {
        await grpc.event.ReleaseSeats({ booking_id: id }).catch(() => {});
        throw e;
      }
      try {
        await requestPayment(b);
      } catch (e) {
        log('publish failed, releasing', id, e.message);
        await grpc.event.ReleaseSeats({ booking_id: id }).catch(() => {});
        await db.transition(id, 'FAILED');
        throw e;
      }
      log('booking pending', id);
      return { booking: await db.get(id), replayed: false };
    },

    // Returns 'ack' or 'requeue'. Duplicate and late messages are no-ops, except that a
    // SUCCEEDED payment on a booking that will never confirm is refunded (idempotent downstream).
    async onResult(msg) {
      if (msg?.status !== 'SUCCEEDED' && msg?.status !== 'FAILED') throw new Error('bad result message');
      // shortcut: every failure below requeues (a dropped SUCCEEDED is a charge never refunded), so a
      // permanently failing message retries once a second forever; add a DLX if that shows up.
      try {
        const b = await db.get(msg.booking_id);
        if (!b) { log('result for unknown booking', msg.booking_id); return 'ack'; }
        const refund = async (reason) => {
          try {
            await mq.publish('payment.refund.requested', { booking_id: b.id, payment_id: msg.payment_id, reason });
          } catch (e) { log('refund publish failed, requeue', b.id, e.message); return 'requeue'; }
          log('refund requested', b.id, reason);
          return 'ack';
        };
        // SUCCEEDED on a booking that is no longer PENDING: CONFIRMED is a duplicate, anything else is refunded.
        const notPending = async (status) => {
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
          if (e.code !== code.FAILED_PRECONDITION && e.code !== code.NOT_FOUND) throw e;
          if (await db.transition(b.id, 'EXPIRED', msg.payment_id)) log('booking expired: payment succeeded after hold expired', b.id);
          else await db.setPaymentIdIfNull(b.id, msg.payment_id); // the sweeper expired it meanwhile
          return refund('hold_expired');
        }
        if (await db.transition(b.id, 'CONFIRMED', msg.payment_id)) { log('booking confirmed', b.id); return 'ack'; }
        // Lost the race to the sweeper after ConfirmSeats sold the seats, or a duplicate confirmed it first.
        // The sale stays recorded on the event side; booking has no way to undo it.
        log('booking left PENDING during confirm', b.id);
        return notPending((await db.get(b.id)).status);
      } catch (e) {
        log('result handling failed, requeue', msg.booking_id, e.message);
        return 'requeue';
      }
    },

    async sweep() {
      for (const id of await db.expireOverdue()) {
        log('booking expired', id);
        await grpc.event.ReleaseSeats({ booking_id: id }).catch((e) => log('release failed', id, e.message));
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
