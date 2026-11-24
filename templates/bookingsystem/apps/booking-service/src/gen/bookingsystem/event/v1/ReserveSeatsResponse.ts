// Original file: proto/bookingsystem/event/v1/event.proto

import type { Hold as _bookingsystem_event_v1_Hold, Hold__Output as _bookingsystem_event_v1_Hold__Output } from '../../../bookingsystem/event/v1/Hold.ts';

export interface ReserveSeatsResponse {
  'hold'?: (_bookingsystem_event_v1_Hold | null);
}

export interface ReserveSeatsResponse__Output {
  'hold': (_bookingsystem_event_v1_Hold__Output | null);
}
