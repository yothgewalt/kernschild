// Original file: proto/bookingsystem/event/v1/event.proto


export interface ReserveSeatsRequest {
  'booking_id'?: (string);
  'event_id'?: (string);
  'quantity'?: (number);
}

export interface ReserveSeatsRequest__Output {
  'booking_id': (string);
  'event_id': (string);
  'quantity': (number);
}
