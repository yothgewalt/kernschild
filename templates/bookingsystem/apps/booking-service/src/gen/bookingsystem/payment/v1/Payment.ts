// Original file: proto/bookingsystem/payment/v1/payment.proto

import type { PaymentStatus as _bookingsystem_payment_v1_PaymentStatus, PaymentStatus__Output as _bookingsystem_payment_v1_PaymentStatus__Output } from '../../../bookingsystem/payment/v1/PaymentStatus.ts';
import type { Long } from '@grpc/proto-loader';

export interface Payment {
  'id'?: (string);
  'booking_id'?: (string);
  'user_id'?: (string);
  'amount_cents'?: (number | string | Long);
  'status'?: (_bookingsystem_payment_v1_PaymentStatus);
  'created_at'?: (string);
  'updated_at'?: (string);
}

export interface Payment__Output {
  'id': (string);
  'booking_id': (string);
  'user_id': (string);
  'amount_cents': (string);
  'status': (_bookingsystem_payment_v1_PaymentStatus__Output);
  'created_at': (string);
  'updated_at': (string);
}
