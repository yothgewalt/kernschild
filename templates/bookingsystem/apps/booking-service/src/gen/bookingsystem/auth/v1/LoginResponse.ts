// Original file: proto/bookingsystem/auth/v1/auth.proto

import type { User as _bookingsystem_auth_v1_User, User__Output as _bookingsystem_auth_v1_User__Output } from '../../../bookingsystem/auth/v1/User.ts';

export interface LoginResponse {
  'token'?: (string);
  'expires_at'?: (string);
  'user'?: (_bookingsystem_auth_v1_User | null);
}

export interface LoginResponse__Output {
  'token': (string);
  'expires_at': (string);
  'user': (_bookingsystem_auth_v1_User__Output | null);
}
