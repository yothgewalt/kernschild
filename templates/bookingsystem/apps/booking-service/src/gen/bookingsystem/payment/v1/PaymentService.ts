// Original file: proto/bookingsystem/payment/v1/payment.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { GetPaymentRequest as _bookingsystem_payment_v1_GetPaymentRequest, GetPaymentRequest__Output as _bookingsystem_payment_v1_GetPaymentRequest__Output } from '../../../bookingsystem/payment/v1/GetPaymentRequest.ts';
import type { GetPaymentResponse as _bookingsystem_payment_v1_GetPaymentResponse, GetPaymentResponse__Output as _bookingsystem_payment_v1_GetPaymentResponse__Output } from '../../../bookingsystem/payment/v1/GetPaymentResponse.ts';
import type { ListPaymentsRequest as _bookingsystem_payment_v1_ListPaymentsRequest, ListPaymentsRequest__Output as _bookingsystem_payment_v1_ListPaymentsRequest__Output } from '../../../bookingsystem/payment/v1/ListPaymentsRequest.ts';
import type { ListPaymentsResponse as _bookingsystem_payment_v1_ListPaymentsResponse, ListPaymentsResponse__Output as _bookingsystem_payment_v1_ListPaymentsResponse__Output } from '../../../bookingsystem/payment/v1/ListPaymentsResponse.ts';

export interface PaymentServiceClient extends grpc.Client {
  GetPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  GetPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  GetPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  GetPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  getPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  getPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  getPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  getPayment(argument: _bookingsystem_payment_v1_GetPaymentRequest, callback: grpc.requestCallback<_bookingsystem_payment_v1_GetPaymentResponse__Output>): grpc.ClientUnaryCall;
  
  ListPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  ListPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  ListPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  ListPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  listPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  listPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  listPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  listPayments(argument: _bookingsystem_payment_v1_ListPaymentsRequest, callback: grpc.requestCallback<_bookingsystem_payment_v1_ListPaymentsResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface PaymentServiceHandlers extends grpc.UntypedServiceImplementation {
  GetPayment: grpc.handleUnaryCall<_bookingsystem_payment_v1_GetPaymentRequest__Output, _bookingsystem_payment_v1_GetPaymentResponse>;
  
  ListPayments: grpc.handleUnaryCall<_bookingsystem_payment_v1_ListPaymentsRequest__Output, _bookingsystem_payment_v1_ListPaymentsResponse>;
  
}

export interface PaymentServiceDefinition extends grpc.ServiceDefinition {
  GetPayment: MethodDefinition<_bookingsystem_payment_v1_GetPaymentRequest, _bookingsystem_payment_v1_GetPaymentResponse, _bookingsystem_payment_v1_GetPaymentRequest__Output, _bookingsystem_payment_v1_GetPaymentResponse__Output>
  ListPayments: MethodDefinition<_bookingsystem_payment_v1_ListPaymentsRequest, _bookingsystem_payment_v1_ListPaymentsResponse, _bookingsystem_payment_v1_ListPaymentsRequest__Output, _bookingsystem_payment_v1_ListPaymentsResponse__Output>
}
