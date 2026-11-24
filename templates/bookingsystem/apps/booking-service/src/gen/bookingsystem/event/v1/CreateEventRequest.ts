// Original file: proto/bookingsystem/event/v1/event.proto

import type { Long } from '@grpc/proto-loader';

export interface CreateEventRequest {
  'name'?: (string);
  'capacity'?: (number);
  'price_cents'?: (number | string | Long);
}

export interface CreateEventRequest__Output {
  'name': (string);
  'capacity': (number);
  'price_cents': (string);
}
