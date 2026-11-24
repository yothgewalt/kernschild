export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';

// A row of the bookings table, with the bigint amount as a number.
export interface Booking {
  id: string;
  email: string;
  name: string;
  event_id: string;
  quantity: number;
  amount_cents: number;
  status: BookingStatus;
  payment_id: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

// A customer is the email they book with (trimmed, lowercased) plus a display name; there are no accounts.
export interface Customer { email: string; name: string }

export type RefundReason = 'hold_expired' | 'booking_not_pending';

// The bodies booking publishes, by routing key.
export interface Outbox {
  'payment.requested': { booking_id: string; email: string; event_id: string; amount_cents: number };
  'payment.refund.requested': { booking_id: string; payment_id: string; reason: RefundReason };
}

// The payment.completed / payment.failed body, limited to the fields booking reads.
export interface PaymentResult {
  booking_id: string;
  payment_id: string;
  status: 'SUCCEEDED' | 'FAILED';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);

// Both ids land in uuid columns: a non-uuid one would make pg throw and the message requeue forever.
export function isPaymentResult(x: unknown): x is PaymentResult {
  return typeof x === 'object' && x !== null
    && 'booking_id' in x && isUuid(x.booking_id)
    && 'payment_id' in x && isUuid(x.payment_id)
    && 'status' in x && (x.status === 'SUCCEEDED' || x.status === 'FAILED');
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
