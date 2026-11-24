// Original file: proto/bookingsystem/event/v1/event.proto

import type { HoldStatus as _bookingsystem_event_v1_HoldStatus, HoldStatus__Output as _bookingsystem_event_v1_HoldStatus__Output } from '../../../bookingsystem/event/v1/HoldStatus.ts';
import type { Long } from '@grpc/proto-loader';

export interface Hold {
  'booking_id'?: (string);
  'event_id'?: (string);
  'quantity'?: (number);
  'amount_cents'?: (number | string | Long);
  'status'?: (_bookingsystem_event_v1_HoldStatus);
  'expires_at'?: (string);
}

export interface Hold__Output {
  'booking_id': (string);
  'event_id': (string);
  'quantity': (number);
  'amount_cents': (string);
  'status': (_bookingsystem_event_v1_HoldStatus__Output);
  'expires_at': (string);
}
