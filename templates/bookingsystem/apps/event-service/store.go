package main

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrExhausted    = errors.New("not enough seats")
	ErrPrecondition = errors.New("hold expired or released")
	ErrUnavailable  = errors.New("hold journal unavailable")
)

type Store struct {
	pool *pgxpool.Pool
	rdb  *redis.Client
	ttl  time.Duration
	// Rebuilds take mu exclusively. Every Redis step that is followed by a Postgres write holds it
	// shared across both steps, so a rebuild never reads Postgres in between.
	mu sync.RWMutex
}

type EventRow struct {
	ID, Name            string
	Capacity, Available int32
	Held, Sold          int32
	PriceCents          int64
	CreatedAt           time.Time
}

type HoldRow struct {
	BookingID, EventID string
	Quantity           int32
	AmountCents        int64
	Status             string
	ExpiresAt          time.Time
}

const schema = `
CREATE TABLE IF NOT EXISTS events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  capacity int NOT NULL CHECK (capacity > 0),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  created_at timestamptz DEFAULT now());
ALTER TABLE events DROP COLUMN IF EXISTS available;
CREATE TABLE IF NOT EXISTS sales(
  booking_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id),
  quantity int NOT NULL,
  amount_cents bigint NOT NULL,
  created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS sales_event ON sales(event_id);
CREATE TABLE IF NOT EXISTS holds(
  booking_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id),
  quantity int NOT NULL CHECK (quantity > 0),
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('HELD','CONFIRMED','RELEASED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());`

const readyKey = "inventory:ready"

func availKey(id string) string { return "event:" + id + ":available" }
func heldKey(id string) string  { return "event:" + id + ":held" }
func holdKey(b string) string   { return "hold:" + b }

// Init creates tables, seeds one event when the table is empty, and builds Redis inventory if it is missing.
func (s *Store) Init(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, schema); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO events(name,capacity,price_cents)
		SELECT 'Kernschild Live 2026',100,150000 WHERE NOT EXISTS (SELECT 1 FROM events)`); err != nil {
		return err
	}
	return s.ensureInventory(ctx)
}

// ensureInventory rebuilds every counter and live hold from Postgres when the inventory:ready sentinel is gone.
// shortcut: the mutex is per process because there is one event-service instance; scaling out needs a Redis lock.
func (s *Store) ensureInventory(ctx context.Context) error {
	ready := func() (bool, error) { n, err := s.rdb.Exists(ctx, readyKey).Result(); return n == 1, err }
	if ok, err := ready(); err != nil || ok { // lock-free fast path for the per-tick check
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ok, err := ready(); err != nil || ok {
		return err
	}
	type ev struct{ capacity, sold, held int32 }
	events := map[string]*ev{}
	rows, err := s.pool.Query(ctx, `SELECT e.id::text, e.capacity,
		COALESCE((SELECT sum(quantity) FROM sales s WHERE s.event_id=e.id),0)::int FROM events e`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		e := &ev{}
		if err := rows.Scan(&id, &e.capacity, &e.sold); err != nil {
			rows.Close()
			return err
		}
		events[id] = e
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	// Expired HELD holds are included on purpose: the sweeper releases them right after.
	rows, err = s.pool.Query(ctx, `SELECT h.booking_id::text, h.event_id::text, h.quantity, h.amount_cents, h.expires_at
		FROM holds h WHERE h.status='HELD' AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.booking_id=h.booking_id)`)
	if err != nil {
		return err
	}
	var holds []HoldRow
	for rows.Next() {
		var h HoldRow
		if err := rows.Scan(&h.BookingID, &h.EventID, &h.Quantity, &h.AmountCents, &h.ExpiresAt); err != nil {
			rows.Close()
			return err
		}
		// An event created after the first query keeps the counters CreateEvent set with NX, so skip its holds.
		if e := events[h.EventID]; e != nil {
			e.held += h.Quantity
			holds = append(holds, h)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	live := map[string]bool{}
	for _, h := range holds {
		live[holdKey(h.BookingID)] = true
	}
	// A HELD hold that is not in the journal (Redis kept data the sentinel didn't vouch for, such as
	// an upgrade from the version without a journal) would be released or confirmed on top of the
	// rebuilt counters, so drop it. Terminal holds stay for idempotency.
	var stale []string
	iter := s.rdb.Scan(ctx, 0, "hold:*", 1000).Iterator()
	for iter.Next(ctx) {
		if k := iter.Val(); !live[k] && s.rdb.HGet(ctx, k, "status").Val() == "HELD" {
			stale = append(stale, k)
		}
	}
	if err := iter.Err(); err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	if len(stale) > 0 {
		pipe.Del(ctx, stale...)
	}
	pipe.Del(ctx, "holds:expiry")
	for id, e := range events {
		pipe.Set(ctx, availKey(id), e.capacity-e.sold-e.held, 0)
		pipe.Set(ctx, heldKey(id), e.held, 0)
	}
	for _, h := range holds {
		ms := h.ExpiresAt.UnixMilli()
		pipe.Del(ctx, holdKey(h.BookingID)) // drops any terminal hold's 24h TTL: a HELD hold never has one
		pipe.HSet(ctx, holdKey(h.BookingID), "event_id", h.EventID, "quantity", h.Quantity,
			"amount_cents", h.AmountCents, "status", "HELD", "expires_at_ms", ms)
		pipe.ZAdd(ctx, "holds:expiry", redis.Z{Score: float64(ms), Member: h.BookingID})
	}
	pipe.Set(ctx, readyKey, 1, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	logf("rebuilt inventory from postgres: %d events, %d holds (dropped %d stale)", len(events), len(holds), len(stale))
	return nil
}

const eventCols = `e.id::text, e.name, e.capacity, e.price_cents, e.created_at,
  COALESCE((SELECT sum(quantity) FROM sales s WHERE s.event_id=e.id),0)::int`

func scanEvent(r pgx.Row) (*EventRow, error) {
	e := &EventRow{}
	err := r.Scan(&e.ID, &e.Name, &e.Capacity, &e.PriceCents, &e.CreatedAt, &e.Sold)
	return e, err
}

// fill sets Available and Held from Redis with one MGET. A missing counter reads as 0.
func (s *Store) fill(ctx context.Context, es ...*EventRow) error {
	keys := make([]string, 0, 2*len(es))
	for _, e := range es {
		keys = append(keys, availKey(e.ID), heldKey(e.ID))
	}
	if len(keys) == 0 {
		return nil
	}
	vals, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return err
	}
	num := func(v any) int32 {
		n, _ := strconv.ParseInt(fmt.Sprint(v), 10, 32)
		return int32(n)
	}
	for i, e := range es {
		e.Available, e.Held = num(vals[2*i]), num(vals[2*i+1])
	}
	return nil
}

func (s *Store) CreateEvent(ctx context.Context, name string, capacity int32, price int64) (*EventRow, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var e *EventRow
	// The row commits only after the counters are set, so a Redis failure never leaves an unbookable event.
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if e, err = scanEvent(tx.QueryRow(ctx, `WITH e AS (
			INSERT INTO events(name,capacity,price_cents) VALUES($1,$2,$3) RETURNING *)
			SELECT `+eventCols+` FROM e`, name, capacity, price)); err != nil {
			return err
		}
		// NX so a rebuild that ran in between is never clobbered.
		pipe := s.rdb.Pipeline()
		pipe.SetNX(ctx, availKey(e.ID), capacity, 0)
		pipe.SetNX(ctx, heldKey(e.ID), 0, 0)
		_, err = pipe.Exec(ctx)
		return err
	})
	if err != nil {
		return nil, err
	}
	e.Available = capacity
	return e, nil
}

func (s *Store) GetEvent(ctx context.Context, id string) (*EventRow, error) {
	e, err := scanEvent(s.pool.QueryRow(ctx, `SELECT `+eventCols+` FROM events e WHERE e.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return e, s.fill(ctx, e)
}

func (s *Store) ListEvents(ctx context.Context) ([]*EventRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventCols+` FROM events e ORDER BY e.created_at, e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*EventRow
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, s.fill(ctx, out...)
}

// Lua prelude shared by every script. Redis TIME is the only clock. Script results are
// {code, event_id, quantity, amount_cents, status, expires_at_ms}; code 0 ok, 1 missing,
// 2 exhausted, 3 expired or released.
// shortcut: scripts build event keys from the hold's event_id, so they need a single Redis node, not Cluster.
const luaCommon = `
local function now_ms()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end
local function hold(hk)
  local h = redis.call('HMGET', hk, 'event_id', 'quantity', 'amount_cents', 'status', 'expires_at_ms')
  return {0, h[1], h[2], h[3], h[4], h[5]}
end
local function release(b)
  local hk = 'hold:' .. b
  redis.call('ZREM', 'holds:expiry', b)
  if redis.call('HGET', hk, 'status') == 'HELD' then
    local q = tonumber(redis.call('HGET', hk, 'quantity'))
    local eid = redis.call('HGET', hk, 'event_id')
    redis.call('INCRBY', 'event:' .. eid .. ':available', q)
    redis.call('DECRBY', 'event:' .. eid .. ':held', q)
    redis.call('HSET', hk, 'status', 'RELEASED')
    redis.call('PEXPIRE', hk, 86400000)
    return true
  end
  return false
end
`

// KEYS: hold, available, held, holds:expiry. ARGV: booking, event, qty, amount, ttl_ms.
var reserveScript = redis.NewScript(luaCommon + `
if redis.call('EXISTS', KEYS[1]) == 1 then return hold(KEYS[1]) end
local av = redis.call('GET', KEYS[2])
if not av then return {1} end
local q = tonumber(ARGV[3])
if tonumber(av) < q then return {2} end
local exp = now_ms() + tonumber(ARGV[5])
redis.call('DECRBY', KEYS[2], q)
redis.call('INCRBY', KEYS[3], q)
redis.call('HSET', KEYS[1], 'event_id', ARGV[2], 'quantity', ARGV[3], 'amount_cents', ARGV[4],
  'status', 'HELD', 'expires_at_ms', exp)
redis.call('ZADD', KEYS[4], exp, ARGV[1])
return hold(KEYS[1])`)

// KEYS: hold. ARGV: booking.
var confirmScript = redis.NewScript(luaCommon + `
local hk = KEYS[1]
local st = redis.call('HGET', hk, 'status')
if not st then return {1} end
if st == 'CONFIRMED' then return hold(hk) end
if st == 'HELD' and tonumber(redis.call('HGET', hk, 'expires_at_ms')) > now_ms() then
  local eid = redis.call('HGET', hk, 'event_id')
  redis.call('DECRBY', 'event:' .. eid .. ':held', tonumber(redis.call('HGET', hk, 'quantity')))
  redis.call('HSET', hk, 'status', 'CONFIRMED')
  redis.call('ZREM', 'holds:expiry', ARGV[1])
  redis.call('PEXPIRE', hk, 86400000)
  return hold(hk)
end
return {3}`)

// KEYS: hold. ARGV: booking.
var releaseScript = redis.NewScript(luaCommon + `
if redis.call('EXISTS', KEYS[1]) == 0 then return {1} end
release(ARGV[1])
return hold(KEYS[1])`)

// Undoes a reserve whose journal insert failed: releases the seats and deletes the hold, so a retry
// with the same booking id makes a fresh hold instead of getting a RELEASED one back.
// KEYS: hold. ARGV: booking.
var abortScript = redis.NewScript(luaCommon + `
if release(ARGV[1]) then redis.call('DEL', KEYS[1]) end
return {0}`)

// Returns {processed, released booking ids}.
var sweepScript = redis.NewScript(luaCommon + `
local due = redis.call('ZRANGEBYSCORE', 'holds:expiry', '-inf', now_ms(), 'LIMIT', 0, 1000)
local out = {}
for _, b in ipairs(due) do if release(b) then out[#out + 1] = b end end
return {#due, out}`)

// holdFrom parses a script result; it returns (nil, nil) for code 1 and the matching error otherwise.
func holdFrom(bookingID string, res any) (*HoldRow, int64, error) {
	v := res.([]any)
	code := v[0].(int64)
	switch code {
	case 1:
		return nil, code, nil
	case 2:
		return nil, code, ErrExhausted
	case 3:
		return nil, code, ErrPrecondition
	}
	str := func(i int) string { return v[i].(string) }
	q, _ := strconv.ParseInt(str(2), 10, 32)
	amt, _ := strconv.ParseInt(str(3), 10, 64)
	ms, _ := strconv.ParseInt(str(5), 10, 64)
	return &HoldRow{BookingID: bookingID, EventID: str(1), Quantity: int32(q), AmountCents: amt,
		Status: str(4), ExpiresAt: time.UnixMilli(ms)}, code, nil
}

func (s *Store) ReserveSeats(ctx context.Context, bookingID, eventID string, qty int32) (*HoldRow, error) {
	var price int64
	err := s.pool.QueryRow(ctx, `SELECT price_cents FROM events WHERE id=$1::uuid`, eventID).Scan(&price)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// The journal insert runs on the idempotent path too, so a crash between the Lua call and it heals on retry.
	h, code, err := s.runHold(ctx, reserveScript, bookingID,
		[]string{holdKey(bookingID), availKey(eventID), heldKey(eventID), "holds:expiry"},
		func(h *HoldRow) error {
			_, err := s.pool.Exec(ctx, `INSERT INTO holds(booking_id,event_id,quantity,amount_cents,status,expires_at)
				VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (booking_id) DO NOTHING`,
				bookingID, h.EventID, h.Quantity, h.AmountCents, h.Status, h.ExpiresAt)
			if err == nil {
				return nil
			}
			// A hold must never exist only in Redis. WithoutCancel: a cancelled request must still release.
			if _, rerr := abortScript.Run(context.WithoutCancel(ctx), s.rdb, []string{holdKey(bookingID)}, bookingID).Result(); rerr != nil {
				logf("release after journal failure %s: %v", bookingID, rerr)
			}
			logf("hold journal insert failed for %s: %v", bookingID, err)
			return ErrUnavailable
		},
		bookingID, eventID, qty, int64(qty)*price, s.ttl.Milliseconds())
	if err != nil {
		return nil, err
	}
	if code == 1 {
		return nil, ErrNotFound
	}
	return h, nil
}

// runHold runs a hold script and, on success, journal (if set) under the shared lock. When the script
// reports a missing key, it rebuilds inventory outside the lock and retries once.
func (s *Store) runHold(ctx context.Context, sc *redis.Script, bookingID string, keys []string,
	journal func(*HoldRow) error, args ...any) (*HoldRow, int64, error) {
	once := func() (*HoldRow, int64, error) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		res, err := sc.Run(ctx, s.rdb, keys, args...).Result()
		if err != nil {
			return nil, 0, err
		}
		h, code, err := holdFrom(bookingID, res)
		if err == nil && code == 0 && journal != nil {
			err = journal(h)
		}
		return h, code, err
	}
	h, code, err := once()
	if code != 1 {
		return h, code, err
	}
	if err := s.ensureInventory(ctx); err != nil {
		return nil, 0, err
	}
	return once()
}

func (s *Store) ConfirmSeats(ctx context.Context, bookingID string) (*HoldRow, error) {
	// The sales tx runs on every OK so a crash after the Redis step heals on retry.
	h, code, err := s.runHold(ctx, confirmScript, bookingID, []string{holdKey(bookingID)}, func(h *HoldRow) error {
		return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `INSERT INTO sales(booking_id,event_id,quantity,amount_cents) VALUES($1,$2,$3,$4)
				ON CONFLICT DO NOTHING`, bookingID, h.EventID, h.Quantity, h.AmountCents); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE holds SET status='CONFIRMED', updated_at=now() WHERE booking_id=$1`, bookingID)
			return err
		})
	}, bookingID)
	if err != nil {
		return nil, err
	}
	if code == 1 { // hold key gone (24h TTL): a sales row still means confirmed
		h = &HoldRow{BookingID: bookingID, Status: "CONFIRMED"}
		err := s.pool.QueryRow(ctx, `SELECT event_id::text, quantity, amount_cents, created_at FROM sales WHERE booking_id=$1`,
			bookingID).Scan(&h.EventID, &h.Quantity, &h.AmountCents, &h.ExpiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return h, err
	}
	return h, nil
}

// ReleaseSeats returns (nil, nil) when no hold exists.
func (s *Store) ReleaseSeats(ctx context.Context, bookingID string) (*HoldRow, error) {
	h, code, err := s.runHold(ctx, releaseScript, bookingID, []string{holdKey(bookingID)}, nil, bookingID)
	if err != nil || code == 1 {
		return nil, err
	}
	if h.Status != "RELEASED" { // a CONFIRMED hold must not be marked RELEASED in the journal
		return h, nil
	}
	_, err = s.pool.Exec(ctx, `UPDATE holds SET status='RELEASED', updated_at=now() WHERE booking_id=$1 AND status='HELD'`, bookingID)
	return h, err
}

// Sweep rebuilds inventory if Redis lost it, then releases expired holds in batches of 1000
// and returns how many it released.
func (s *Store) Sweep(ctx context.Context) (int64, error) {
	if err := s.ensureInventory(ctx); err != nil {
		return 0, err
	}
	var total int64
	for {
		res, err := sweepScript.Run(ctx, s.rdb, nil).Slice()
		if err != nil {
			return total, err
		}
		ids := make([]string, 0, len(res[1].([]any)))
		for _, b := range res[1].([]any) {
			ids = append(ids, b.(string))
		}
		if len(ids) > 0 {
			// A lost update is safe: a rebuild brings the hold back as HELD and expired, and the next sweep releases it.
			if _, err := s.pool.Exec(ctx, `UPDATE holds SET status='RELEASED', updated_at=now()
				WHERE booking_id = ANY($1::uuid[]) AND status='HELD'`, ids); err != nil {
				return total, err
			}
		}
		total += int64(len(ids))
		if res[0].(int64) < 1000 {
			return total, nil
		}
	}
}
