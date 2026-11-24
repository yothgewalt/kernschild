import type { ValidateTokenResponse__Output } from './gen/bookingsystem/auth/v1/ValidateTokenResponse.ts';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';

// A row of the bookings table, with the bigint amount as a number.
export interface Booking {
  id: string;
  user_id: string;
  event_id: string;
  quantity: number;
  amount_cents: number;
  status: BookingStatus;
  payment_id: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export type AuthedUser = ValidateTokenResponse__Output;

export type RefundReason = 'hold_expired' | 'booking_not_pending';

// The bodies booking publishes, by routing key.
export interface Outbox {
  'payment.requested': { booking_id: string; user_id: string; event_id: string; amount_cents: number };
  'payment.refund.requested': { booking_id: string; payment_id: string; reason: RefundReason };
}

// The payment.completed / payment.failed body, limited to the fields booking reads.
export interface PaymentResult {
  booking_id: string;
  payment_id: string;
  status: 'SUCCEEDED' | 'FAILED';
}

export function isPaymentResult(x: unknown): x is PaymentResult {
  return typeof x === 'object' && x !== null
    && 'booking_id' in x && typeof x.booking_id === 'string'
    && 'payment_id' in x && typeof x.payment_id === 'string'
    && 'status' in x && (x.status === 'SUCCEEDED' || x.status === 'FAILED');
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
