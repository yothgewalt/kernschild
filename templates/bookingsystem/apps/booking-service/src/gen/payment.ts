import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { GetPaymentRequest as _bookingsystem_payment_v1_GetPaymentRequest, GetPaymentRequest__Output as _bookingsystem_payment_v1_GetPaymentRequest__Output } from './bookingsystem/payment/v1/GetPaymentRequest.ts';
import type { GetPaymentResponse as _bookingsystem_payment_v1_GetPaymentResponse, GetPaymentResponse__Output as _bookingsystem_payment_v1_GetPaymentResponse__Output } from './bookingsystem/payment/v1/GetPaymentResponse.ts';
import type { ListPaymentsRequest as _bookingsystem_payment_v1_ListPaymentsRequest, ListPaymentsRequest__Output as _bookingsystem_payment_v1_ListPaymentsRequest__Output } from './bookingsystem/payment/v1/ListPaymentsRequest.ts';
import type { ListPaymentsResponse as _bookingsystem_payment_v1_ListPaymentsResponse, ListPaymentsResponse__Output as _bookingsystem_payment_v1_ListPaymentsResponse__Output } from './bookingsystem/payment/v1/ListPaymentsResponse.ts';
import type { Payment as _bookingsystem_payment_v1_Payment, Payment__Output as _bookingsystem_payment_v1_Payment__Output } from './bookingsystem/payment/v1/Payment.ts';
import type { PaymentServiceClient as _bookingsystem_payment_v1_PaymentServiceClient, PaymentServiceDefinition as _bookingsystem_payment_v1_PaymentServiceDefinition } from './bookingsystem/payment/v1/PaymentService.ts';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  bookingsystem: {
    payment: {
      v1: {
        GetPaymentRequest: MessageTypeDefinition<_bookingsystem_payment_v1_GetPaymentRequest, _bookingsystem_payment_v1_GetPaymentRequest__Output>
        GetPaymentResponse: MessageTypeDefinition<_bookingsystem_payment_v1_GetPaymentResponse, _bookingsystem_payment_v1_GetPaymentResponse__Output>
        ListPaymentsRequest: MessageTypeDefinition<_bookingsystem_payment_v1_ListPaymentsRequest, _bookingsystem_payment_v1_ListPaymentsRequest__Output>
        ListPaymentsResponse: MessageTypeDefinition<_bookingsystem_payment_v1_ListPaymentsResponse, _bookingsystem_payment_v1_ListPaymentsResponse__Output>
        Payment: MessageTypeDefinition<_bookingsystem_payment_v1_Payment, _bookingsystem_payment_v1_Payment__Output>
        PaymentService: SubtypeConstructor<typeof grpc.Client, _bookingsystem_payment_v1_PaymentServiceClient> & { service: _bookingsystem_payment_v1_PaymentServiceDefinition }
        PaymentStatus: EnumTypeDefinition
      }
    }
  }
}

