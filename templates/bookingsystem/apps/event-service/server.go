package main

import (
	"context"
	"errors"
	"regexp"
	"time"

	pb "event-service/gen/bookingsystem/event/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type server struct {
	pb.UnimplementedEventServiceServer
	st *Store
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func toErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrNotFound):
		return status.Error(codes.NotFound, "not found")
	case errors.Is(err, ErrExhausted):
		return status.Error(codes.ResourceExhausted, "not enough seats")
	case errors.Is(err, ErrPrecondition):
		return status.Error(codes.FailedPrecondition, "hold expired or released")
	case errors.Is(err, ErrUnavailable):
		return status.Error(codes.Unavailable, "hold journal unavailable")
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return status.FromContextError(err).Err()
	}
	return status.Error(codes.Internal, "internal error")
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func toEvent(e *EventRow) *pb.Event {
	return &pb.Event{Id: e.ID, Name: e.Name, Capacity: e.Capacity, Available: e.Available, Held: e.Held,
		Sold: e.Sold, PriceCents: e.PriceCents, CreatedAt: ts(e.CreatedAt)}
}

var holdStatus = map[string]pb.HoldStatus{
	"HELD": pb.HoldStatus_HOLD_STATUS_HELD, "CONFIRMED": pb.HoldStatus_HOLD_STATUS_CONFIRMED,
	"RELEASED": pb.HoldStatus_HOLD_STATUS_RELEASED,
}

func toHold(h *HoldRow) *pb.Hold {
	if h == nil {
		return nil
	}
	return &pb.Hold{BookingId: h.BookingID, EventId: h.EventID, Quantity: h.Quantity,
		AmountCents: h.AmountCents, Status: holdStatus[h.Status], ExpiresAt: ts(h.ExpiresAt)}
}

func badArg(msg string) error { return status.Error(codes.InvalidArgument, msg) }

func (s *server) CreateEvent(ctx context.Context, r *pb.CreateEventRequest) (*pb.CreateEventResponse, error) {
	if r.Name == "" || r.Capacity < 1 || r.Capacity > 100000 || r.PriceCents < 0 {
		return nil, badArg("name required, capacity 1..100000, price >= 0")
	}
	e, err := s.st.CreateEvent(ctx, r.Name, r.Capacity, r.PriceCents)
	if err != nil {
		return nil, toErr(err)
	}
	logf("created event %s (%d seats)", e.ID, e.Capacity)
	return &pb.CreateEventResponse{Event: toEvent(e)}, nil
}

func (s *server) GetEvent(ctx context.Context, r *pb.GetEventRequest) (*pb.GetEventResponse, error) {
	if !uuidRe.MatchString(r.Id) {
		return nil, badArg("id must be a uuid")
	}
	e, err := s.st.GetEvent(ctx, r.Id)
	if err != nil {
		return nil, toErr(err)
	}
	return &pb.GetEventResponse{Event: toEvent(e)}, nil
}

func (s *server) ListEvents(ctx context.Context, _ *pb.ListEventsRequest) (*pb.ListEventsResponse, error) {
	es, err := s.st.ListEvents(ctx)
	if err != nil {
		return nil, toErr(err)
	}
	out := &pb.ListEventsResponse{}
	for _, e := range es {
		out.Events = append(out.Events, toEvent(e))
	}
	return out, nil
}

func (s *server) ReserveSeats(ctx context.Context, r *pb.ReserveSeatsRequest) (*pb.ReserveSeatsResponse, error) {
	if !uuidRe.MatchString(r.BookingId) || !uuidRe.MatchString(r.EventId) || r.Quantity < 1 || r.Quantity > 10 {
		return nil, badArg("booking_id and event_id must be uuids, quantity 1..10")
	}
	h, err := s.st.ReserveSeats(ctx, r.BookingId, r.EventId, r.Quantity)
	if err != nil {
		return nil, toErr(err)
	}
	logf("reserve booking=%s event=%s qty=%d status=%s", h.BookingID, h.EventID, h.Quantity, h.Status)
	return &pb.ReserveSeatsResponse{Hold: toHold(h)}, nil
}

func (s *server) ConfirmSeats(ctx context.Context, r *pb.ConfirmSeatsRequest) (*pb.ConfirmSeatsResponse, error) {
	if !uuidRe.MatchString(r.BookingId) {
		return nil, badArg("booking_id must be a uuid")
	}
	h, err := s.st.ConfirmSeats(ctx, r.BookingId)
	if err != nil {
		return nil, toErr(err)
	}
	logf("confirm booking=%s", h.BookingID)
	return &pb.ConfirmSeatsResponse{Hold: toHold(h)}, nil
}

func (s *server) ReleaseSeats(ctx context.Context, r *pb.ReleaseSeatsRequest) (*pb.ReleaseSeatsResponse, error) {
	if !uuidRe.MatchString(r.BookingId) {
		return nil, badArg("booking_id must be a uuid")
	}
	h, err := s.st.ReleaseSeats(ctx, r.BookingId)
	if err != nil {
		return nil, toErr(err)
	}
	logf("release booking=%s", r.BookingId)
	return &pb.ReleaseSeatsResponse{Hold: toHold(h)}, nil
}
