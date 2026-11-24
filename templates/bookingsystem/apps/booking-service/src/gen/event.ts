import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { ConfirmSeatsRequest as _bookingsystem_event_v1_ConfirmSeatsRequest, ConfirmSeatsRequest__Output as _bookingsystem_event_v1_ConfirmSeatsRequest__Output } from './bookingsystem/event/v1/ConfirmSeatsRequest.ts';
import type { ConfirmSeatsResponse as _bookingsystem_event_v1_ConfirmSeatsResponse, ConfirmSeatsResponse__Output as _bookingsystem_event_v1_ConfirmSeatsResponse__Output } from './bookingsystem/event/v1/ConfirmSeatsResponse.ts';
import type { CreateEventRequest as _bookingsystem_event_v1_CreateEventRequest, CreateEventRequest__Output as _bookingsystem_event_v1_CreateEventRequest__Output } from './bookingsystem/event/v1/CreateEventRequest.ts';
import type { CreateEventResponse as _bookingsystem_event_v1_CreateEventResponse, CreateEventResponse__Output as _bookingsystem_event_v1_CreateEventResponse__Output } from './bookingsystem/event/v1/CreateEventResponse.ts';
import type { Event as _bookingsystem_event_v1_Event, Event__Output as _bookingsystem_event_v1_Event__Output } from './bookingsystem/event/v1/Event.ts';
import type { EventServiceClient as _bookingsystem_event_v1_EventServiceClient, EventServiceDefinition as _bookingsystem_event_v1_EventServiceDefinition } from './bookingsystem/event/v1/EventService.ts';
import type { GetEventRequest as _bookingsystem_event_v1_GetEventRequest, GetEventRequest__Output as _bookingsystem_event_v1_GetEventRequest__Output } from './bookingsystem/event/v1/GetEventRequest.ts';
import type { GetEventResponse as _bookingsystem_event_v1_GetEventResponse, GetEventResponse__Output as _bookingsystem_event_v1_GetEventResponse__Output } from './bookingsystem/event/v1/GetEventResponse.ts';
import type { Hold as _bookingsystem_event_v1_Hold, Hold__Output as _bookingsystem_event_v1_Hold__Output } from './bookingsystem/event/v1/Hold.ts';
import type { ListEventsRequest as _bookingsystem_event_v1_ListEventsRequest, ListEventsRequest__Output as _bookingsystem_event_v1_ListEventsRequest__Output } from './bookingsystem/event/v1/ListEventsRequest.ts';
import type { ListEventsResponse as _bookingsystem_event_v1_ListEventsResponse, ListEventsResponse__Output as _bookingsystem_event_v1_ListEventsResponse__Output } from './bookingsystem/event/v1/ListEventsResponse.ts';
import type { ReleaseSeatsRequest as _bookingsystem_event_v1_ReleaseSeatsRequest, ReleaseSeatsRequest__Output as _bookingsystem_event_v1_ReleaseSeatsRequest__Output } from './bookingsystem/event/v1/ReleaseSeatsRequest.ts';
import type { ReleaseSeatsResponse as _bookingsystem_event_v1_ReleaseSeatsResponse, ReleaseSeatsResponse__Output as _bookingsystem_event_v1_ReleaseSeatsResponse__Output } from './bookingsystem/event/v1/ReleaseSeatsResponse.ts';
import type { ReserveSeatsRequest as _bookingsystem_event_v1_ReserveSeatsRequest, ReserveSeatsRequest__Output as _bookingsystem_event_v1_ReserveSeatsRequest__Output } from './bookingsystem/event/v1/ReserveSeatsRequest.ts';
import type { ReserveSeatsResponse as _bookingsystem_event_v1_ReserveSeatsResponse, ReserveSeatsResponse__Output as _bookingsystem_event_v1_ReserveSeatsResponse__Output } from './bookingsystem/event/v1/ReserveSeatsResponse.ts';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  bookingsystem: {
    event: {
      v1: {
        ConfirmSeatsRequest: MessageTypeDefinition<_bookingsystem_event_v1_ConfirmSeatsRequest, _bookingsystem_event_v1_ConfirmSeatsRequest__Output>
        ConfirmSeatsResponse: MessageTypeDefinition<_bookingsystem_event_v1_ConfirmSeatsResponse, _bookingsystem_event_v1_ConfirmSeatsResponse__Output>
        CreateEventRequest: MessageTypeDefinition<_bookingsystem_event_v1_CreateEventRequest, _bookingsystem_event_v1_CreateEventRequest__Output>
        CreateEventResponse: MessageTypeDefinition<_bookingsystem_event_v1_CreateEventResponse, _bookingsystem_event_v1_CreateEventResponse__Output>
        Event: MessageTypeDefinition<_bookingsystem_event_v1_Event, _bookingsystem_event_v1_Event__Output>
        EventService: SubtypeConstructor<typeof grpc.Client, _bookingsystem_event_v1_EventServiceClient> & { service: _bookingsystem_event_v1_EventServiceDefinition }
        GetEventRequest: MessageTypeDefinition<_bookingsystem_event_v1_GetEventRequest, _bookingsystem_event_v1_GetEventRequest__Output>
        GetEventResponse: MessageTypeDefinition<_bookingsystem_event_v1_GetEventResponse, _bookingsystem_event_v1_GetEventResponse__Output>
        Hold: MessageTypeDefinition<_bookingsystem_event_v1_Hold, _bookingsystem_event_v1_Hold__Output>
        HoldStatus: EnumTypeDefinition
        ListEventsRequest: MessageTypeDefinition<_bookingsystem_event_v1_ListEventsRequest, _bookingsystem_event_v1_ListEventsRequest__Output>
        ListEventsResponse: MessageTypeDefinition<_bookingsystem_event_v1_ListEventsResponse, _bookingsystem_event_v1_ListEventsResponse__Output>
        ReleaseSeatsRequest: MessageTypeDefinition<_bookingsystem_event_v1_ReleaseSeatsRequest, _bookingsystem_event_v1_ReleaseSeatsRequest__Output>
        ReleaseSeatsResponse: MessageTypeDefinition<_bookingsystem_event_v1_ReleaseSeatsResponse, _bookingsystem_event_v1_ReleaseSeatsResponse__Output>
        ReserveSeatsRequest: MessageTypeDefinition<_bookingsystem_event_v1_ReserveSeatsRequest, _bookingsystem_event_v1_ReserveSeatsRequest__Output>
        ReserveSeatsResponse: MessageTypeDefinition<_bookingsystem_event_v1_ReserveSeatsResponse, _bookingsystem_event_v1_ReserveSeatsResponse__Output>
      }
    }
  }
}

