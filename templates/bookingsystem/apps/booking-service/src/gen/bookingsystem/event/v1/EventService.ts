// Original file: proto/bookingsystem/event/v1/event.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { ConfirmSeatsRequest as _bookingsystem_event_v1_ConfirmSeatsRequest, ConfirmSeatsRequest__Output as _bookingsystem_event_v1_ConfirmSeatsRequest__Output } from '../../../bookingsystem/event/v1/ConfirmSeatsRequest.ts';
import type { ConfirmSeatsResponse as _bookingsystem_event_v1_ConfirmSeatsResponse, ConfirmSeatsResponse__Output as _bookingsystem_event_v1_ConfirmSeatsResponse__Output } from '../../../bookingsystem/event/v1/ConfirmSeatsResponse.ts';
import type { CreateEventRequest as _bookingsystem_event_v1_CreateEventRequest, CreateEventRequest__Output as _bookingsystem_event_v1_CreateEventRequest__Output } from '../../../bookingsystem/event/v1/CreateEventRequest.ts';
import type { CreateEventResponse as _bookingsystem_event_v1_CreateEventResponse, CreateEventResponse__Output as _bookingsystem_event_v1_CreateEventResponse__Output } from '../../../bookingsystem/event/v1/CreateEventResponse.ts';
import type { GetEventRequest as _bookingsystem_event_v1_GetEventRequest, GetEventRequest__Output as _bookingsystem_event_v1_GetEventRequest__Output } from '../../../bookingsystem/event/v1/GetEventRequest.ts';
import type { GetEventResponse as _bookingsystem_event_v1_GetEventResponse, GetEventResponse__Output as _bookingsystem_event_v1_GetEventResponse__Output } from '../../../bookingsystem/event/v1/GetEventResponse.ts';
import type { ListEventsRequest as _bookingsystem_event_v1_ListEventsRequest, ListEventsRequest__Output as _bookingsystem_event_v1_ListEventsRequest__Output } from '../../../bookingsystem/event/v1/ListEventsRequest.ts';
import type { ListEventsResponse as _bookingsystem_event_v1_ListEventsResponse, ListEventsResponse__Output as _bookingsystem_event_v1_ListEventsResponse__Output } from '../../../bookingsystem/event/v1/ListEventsResponse.ts';
import type { ReleaseSeatsRequest as _bookingsystem_event_v1_ReleaseSeatsRequest, ReleaseSeatsRequest__Output as _bookingsystem_event_v1_ReleaseSeatsRequest__Output } from '../../../bookingsystem/event/v1/ReleaseSeatsRequest.ts';
import type { ReleaseSeatsResponse as _bookingsystem_event_v1_ReleaseSeatsResponse, ReleaseSeatsResponse__Output as _bookingsystem_event_v1_ReleaseSeatsResponse__Output } from '../../../bookingsystem/event/v1/ReleaseSeatsResponse.ts';
import type { ReserveSeatsRequest as _bookingsystem_event_v1_ReserveSeatsRequest, ReserveSeatsRequest__Output as _bookingsystem_event_v1_ReserveSeatsRequest__Output } from '../../../bookingsystem/event/v1/ReserveSeatsRequest.ts';
import type { ReserveSeatsResponse as _bookingsystem_event_v1_ReserveSeatsResponse, ReserveSeatsResponse__Output as _bookingsystem_event_v1_ReserveSeatsResponse__Output } from '../../../bookingsystem/event/v1/ReserveSeatsResponse.ts';

export interface EventServiceClient extends grpc.Client {
  ConfirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  ConfirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  ConfirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  ConfirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  confirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  confirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  confirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  confirmSeats(argument: _bookingsystem_event_v1_ConfirmSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ConfirmSeatsResponse__Output>): grpc.ClientUnaryCall;
  
  CreateEvent(argument: _bookingsystem_event_v1_CreateEventRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  CreateEvent(argument: _bookingsystem_event_v1_CreateEventRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  CreateEvent(argument: _bookingsystem_event_v1_CreateEventRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  CreateEvent(argument: _bookingsystem_event_v1_CreateEventRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  createEvent(argument: _bookingsystem_event_v1_CreateEventRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  createEvent(argument: _bookingsystem_event_v1_CreateEventRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  createEvent(argument: _bookingsystem_event_v1_CreateEventRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  createEvent(argument: _bookingsystem_event_v1_CreateEventRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_CreateEventResponse__Output>): grpc.ClientUnaryCall;
  
  GetEvent(argument: _bookingsystem_event_v1_GetEventRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  GetEvent(argument: _bookingsystem_event_v1_GetEventRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  GetEvent(argument: _bookingsystem_event_v1_GetEventRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  GetEvent(argument: _bookingsystem_event_v1_GetEventRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  getEvent(argument: _bookingsystem_event_v1_GetEventRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  getEvent(argument: _bookingsystem_event_v1_GetEventRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  getEvent(argument: _bookingsystem_event_v1_GetEventRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  getEvent(argument: _bookingsystem_event_v1_GetEventRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_GetEventResponse__Output>): grpc.ClientUnaryCall;
  
  ListEvents(argument: _bookingsystem_event_v1_ListEventsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  ListEvents(argument: _bookingsystem_event_v1_ListEventsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  ListEvents(argument: _bookingsystem_event_v1_ListEventsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  ListEvents(argument: _bookingsystem_event_v1_ListEventsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  listEvents(argument: _bookingsystem_event_v1_ListEventsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  listEvents(argument: _bookingsystem_event_v1_ListEventsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  listEvents(argument: _bookingsystem_event_v1_ListEventsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  listEvents(argument: _bookingsystem_event_v1_ListEventsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ListEventsResponse__Output>): grpc.ClientUnaryCall;
  
  ReleaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReleaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReleaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReleaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  releaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  releaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  releaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  releaseSeats(argument: _bookingsystem_event_v1_ReleaseSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ReleaseSeatsResponse__Output>): grpc.ClientUnaryCall;
  
  ReserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  ReserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  reserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  reserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  reserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  reserveSeats(argument: _bookingsystem_event_v1_ReserveSeatsRequest, callback: grpc.requestCallback<_bookingsystem_event_v1_ReserveSeatsResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface EventServiceHandlers extends grpc.UntypedServiceImplementation {
  ConfirmSeats: grpc.handleUnaryCall<_bookingsystem_event_v1_ConfirmSeatsRequest__Output, _bookingsystem_event_v1_ConfirmSeatsResponse>;
  
  CreateEvent: grpc.handleUnaryCall<_bookingsystem_event_v1_CreateEventRequest__Output, _bookingsystem_event_v1_CreateEventResponse>;
  
  GetEvent: grpc.handleUnaryCall<_bookingsystem_event_v1_GetEventRequest__Output, _bookingsystem_event_v1_GetEventResponse>;
  
  ListEvents: grpc.handleUnaryCall<_bookingsystem_event_v1_ListEventsRequest__Output, _bookingsystem_event_v1_ListEventsResponse>;
  
  ReleaseSeats: grpc.handleUnaryCall<_bookingsystem_event_v1_ReleaseSeatsRequest__Output, _bookingsystem_event_v1_ReleaseSeatsResponse>;
  
  ReserveSeats: grpc.handleUnaryCall<_bookingsystem_event_v1_ReserveSeatsRequest__Output, _bookingsystem_event_v1_ReserveSeatsResponse>;
  
}

export interface EventServiceDefinition extends grpc.ServiceDefinition {
  ConfirmSeats: MethodDefinition<_bookingsystem_event_v1_ConfirmSeatsRequest, _bookingsystem_event_v1_ConfirmSeatsResponse, _bookingsystem_event_v1_ConfirmSeatsRequest__Output, _bookingsystem_event_v1_ConfirmSeatsResponse__Output>
  CreateEvent: MethodDefinition<_bookingsystem_event_v1_CreateEventRequest, _bookingsystem_event_v1_CreateEventResponse, _bookingsystem_event_v1_CreateEventRequest__Output, _bookingsystem_event_v1_CreateEventResponse__Output>
  GetEvent: MethodDefinition<_bookingsystem_event_v1_GetEventRequest, _bookingsystem_event_v1_GetEventResponse, _bookingsystem_event_v1_GetEventRequest__Output, _bookingsystem_event_v1_GetEventResponse__Output>
  ListEvents: MethodDefinition<_bookingsystem_event_v1_ListEventsRequest, _bookingsystem_event_v1_ListEventsResponse, _bookingsystem_event_v1_ListEventsRequest__Output, _bookingsystem_event_v1_ListEventsResponse__Output>
  ReleaseSeats: MethodDefinition<_bookingsystem_event_v1_ReleaseSeatsRequest, _bookingsystem_event_v1_ReleaseSeatsResponse, _bookingsystem_event_v1_ReleaseSeatsRequest__Output, _bookingsystem_event_v1_ReleaseSeatsResponse__Output>
  ReserveSeats: MethodDefinition<_bookingsystem_event_v1_ReserveSeatsRequest, _bookingsystem_event_v1_ReserveSeatsResponse, _bookingsystem_event_v1_ReserveSeatsRequest__Output, _bookingsystem_event_v1_ReserveSeatsResponse__Output>
}
