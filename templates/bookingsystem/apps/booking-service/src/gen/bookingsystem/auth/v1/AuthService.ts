// Original file: proto/bookingsystem/auth/v1/auth.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { LoginRequest as _bookingsystem_auth_v1_LoginRequest, LoginRequest__Output as _bookingsystem_auth_v1_LoginRequest__Output } from '../../../bookingsystem/auth/v1/LoginRequest.ts';
import type { LoginResponse as _bookingsystem_auth_v1_LoginResponse, LoginResponse__Output as _bookingsystem_auth_v1_LoginResponse__Output } from '../../../bookingsystem/auth/v1/LoginResponse.ts';
import type { RegisterRequest as _bookingsystem_auth_v1_RegisterRequest, RegisterRequest__Output as _bookingsystem_auth_v1_RegisterRequest__Output } from '../../../bookingsystem/auth/v1/RegisterRequest.ts';
import type { RegisterResponse as _bookingsystem_auth_v1_RegisterResponse, RegisterResponse__Output as _bookingsystem_auth_v1_RegisterResponse__Output } from '../../../bookingsystem/auth/v1/RegisterResponse.ts';
import type { ValidateTokenRequest as _bookingsystem_auth_v1_ValidateTokenRequest, ValidateTokenRequest__Output as _bookingsystem_auth_v1_ValidateTokenRequest__Output } from '../../../bookingsystem/auth/v1/ValidateTokenRequest.ts';
import type { ValidateTokenResponse as _bookingsystem_auth_v1_ValidateTokenResponse, ValidateTokenResponse__Output as _bookingsystem_auth_v1_ValidateTokenResponse__Output } from '../../../bookingsystem/auth/v1/ValidateTokenResponse.ts';

export interface AuthServiceClient extends grpc.Client {
  Login(argument: _bookingsystem_auth_v1_LoginRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  Login(argument: _bookingsystem_auth_v1_LoginRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  Login(argument: _bookingsystem_auth_v1_LoginRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  Login(argument: _bookingsystem_auth_v1_LoginRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  login(argument: _bookingsystem_auth_v1_LoginRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  login(argument: _bookingsystem_auth_v1_LoginRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  login(argument: _bookingsystem_auth_v1_LoginRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  login(argument: _bookingsystem_auth_v1_LoginRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_LoginResponse__Output>): grpc.ClientUnaryCall;
  
  Register(argument: _bookingsystem_auth_v1_RegisterRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  Register(argument: _bookingsystem_auth_v1_RegisterRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  Register(argument: _bookingsystem_auth_v1_RegisterRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  Register(argument: _bookingsystem_auth_v1_RegisterRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  register(argument: _bookingsystem_auth_v1_RegisterRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  register(argument: _bookingsystem_auth_v1_RegisterRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  register(argument: _bookingsystem_auth_v1_RegisterRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  register(argument: _bookingsystem_auth_v1_RegisterRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_RegisterResponse__Output>): grpc.ClientUnaryCall;
  
  ValidateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  ValidateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  ValidateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  ValidateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  validateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  validateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  validateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  validateToken(argument: _bookingsystem_auth_v1_ValidateTokenRequest, callback: grpc.requestCallback<_bookingsystem_auth_v1_ValidateTokenResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface AuthServiceHandlers extends grpc.UntypedServiceImplementation {
  Login: grpc.handleUnaryCall<_bookingsystem_auth_v1_LoginRequest__Output, _bookingsystem_auth_v1_LoginResponse>;
  
  Register: grpc.handleUnaryCall<_bookingsystem_auth_v1_RegisterRequest__Output, _bookingsystem_auth_v1_RegisterResponse>;
  
  ValidateToken: grpc.handleUnaryCall<_bookingsystem_auth_v1_ValidateTokenRequest__Output, _bookingsystem_auth_v1_ValidateTokenResponse>;
  
}

export interface AuthServiceDefinition extends grpc.ServiceDefinition {
  Login: MethodDefinition<_bookingsystem_auth_v1_LoginRequest, _bookingsystem_auth_v1_LoginResponse, _bookingsystem_auth_v1_LoginRequest__Output, _bookingsystem_auth_v1_LoginResponse__Output>
  Register: MethodDefinition<_bookingsystem_auth_v1_RegisterRequest, _bookingsystem_auth_v1_RegisterResponse, _bookingsystem_auth_v1_RegisterRequest__Output, _bookingsystem_auth_v1_RegisterResponse__Output>
  ValidateToken: MethodDefinition<_bookingsystem_auth_v1_ValidateTokenRequest, _bookingsystem_auth_v1_ValidateTokenResponse, _bookingsystem_auth_v1_ValidateTokenRequest__Output, _bookingsystem_auth_v1_ValidateTokenResponse__Output>
}
