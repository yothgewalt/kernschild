import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { AuthServiceClient as _bookingsystem_auth_v1_AuthServiceClient, AuthServiceDefinition as _bookingsystem_auth_v1_AuthServiceDefinition } from './bookingsystem/auth/v1/AuthService.ts';
import type { LoginRequest as _bookingsystem_auth_v1_LoginRequest, LoginRequest__Output as _bookingsystem_auth_v1_LoginRequest__Output } from './bookingsystem/auth/v1/LoginRequest.ts';
import type { LoginResponse as _bookingsystem_auth_v1_LoginResponse, LoginResponse__Output as _bookingsystem_auth_v1_LoginResponse__Output } from './bookingsystem/auth/v1/LoginResponse.ts';
import type { RegisterRequest as _bookingsystem_auth_v1_RegisterRequest, RegisterRequest__Output as _bookingsystem_auth_v1_RegisterRequest__Output } from './bookingsystem/auth/v1/RegisterRequest.ts';
import type { RegisterResponse as _bookingsystem_auth_v1_RegisterResponse, RegisterResponse__Output as _bookingsystem_auth_v1_RegisterResponse__Output } from './bookingsystem/auth/v1/RegisterResponse.ts';
import type { User as _bookingsystem_auth_v1_User, User__Output as _bookingsystem_auth_v1_User__Output } from './bookingsystem/auth/v1/User.ts';
import type { ValidateTokenRequest as _bookingsystem_auth_v1_ValidateTokenRequest, ValidateTokenRequest__Output as _bookingsystem_auth_v1_ValidateTokenRequest__Output } from './bookingsystem/auth/v1/ValidateTokenRequest.ts';
import type { ValidateTokenResponse as _bookingsystem_auth_v1_ValidateTokenResponse, ValidateTokenResponse__Output as _bookingsystem_auth_v1_ValidateTokenResponse__Output } from './bookingsystem/auth/v1/ValidateTokenResponse.ts';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  bookingsystem: {
    auth: {
      v1: {
        AuthService: SubtypeConstructor<typeof grpc.Client, _bookingsystem_auth_v1_AuthServiceClient> & { service: _bookingsystem_auth_v1_AuthServiceDefinition }
        LoginRequest: MessageTypeDefinition<_bookingsystem_auth_v1_LoginRequest, _bookingsystem_auth_v1_LoginRequest__Output>
        LoginResponse: MessageTypeDefinition<_bookingsystem_auth_v1_LoginResponse, _bookingsystem_auth_v1_LoginResponse__Output>
        RegisterRequest: MessageTypeDefinition<_bookingsystem_auth_v1_RegisterRequest, _bookingsystem_auth_v1_RegisterRequest__Output>
        RegisterResponse: MessageTypeDefinition<_bookingsystem_auth_v1_RegisterResponse, _bookingsystem_auth_v1_RegisterResponse__Output>
        User: MessageTypeDefinition<_bookingsystem_auth_v1_User, _bookingsystem_auth_v1_User__Output>
        ValidateTokenRequest: MessageTypeDefinition<_bookingsystem_auth_v1_ValidateTokenRequest, _bookingsystem_auth_v1_ValidateTokenRequest__Output>
        ValidateTokenResponse: MessageTypeDefinition<_bookingsystem_auth_v1_ValidateTokenResponse, _bookingsystem_auth_v1_ValidateTokenResponse__Output>
      }
    }
  }
}

