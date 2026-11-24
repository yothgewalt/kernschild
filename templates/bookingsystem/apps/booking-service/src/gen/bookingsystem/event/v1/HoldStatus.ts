// Original file: proto/bookingsystem/event/v1/event.proto

export const HoldStatus = {
  HOLD_STATUS_UNSPECIFIED: 'HOLD_STATUS_UNSPECIFIED',
  HOLD_STATUS_HELD: 'HOLD_STATUS_HELD',
  HOLD_STATUS_CONFIRMED: 'HOLD_STATUS_CONFIRMED',
  HOLD_STATUS_RELEASED: 'HOLD_STATUS_RELEASED',
} as const;

export type HoldStatus =
  | 'HOLD_STATUS_UNSPECIFIED'
  | 0
  | 'HOLD_STATUS_HELD'
  | 1
  | 'HOLD_STATUS_CONFIRMED'
  | 2
  | 'HOLD_STATUS_RELEASED'
  | 3

export type HoldStatus__Output = typeof HoldStatus[keyof typeof HoldStatus]
