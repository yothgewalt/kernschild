// Original file: proto/bookingsystem/event/v1/event.proto

import type { Long } from '@grpc/proto-loader';

export interface Event {
  'id'?: (string);
  'name'?: (string);
  'capacity'?: (number);
  'available'?: (number);
  'held'?: (number);
  'sold'?: (number);
  'price_cents'?: (number | string | Long);
  'created_at'?: (string);
}

export interface Event__Output {
  'id': (string);
  'name': (string);
  'capacity': (number);
  'available': (number);
  'held': (number);
  'sold': (number);
  'price_cents': (string);
  'created_at': (string);
}
