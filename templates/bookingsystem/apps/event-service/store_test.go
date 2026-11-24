package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newStore(t *testing.T, ttl time.Duration) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	rurl := os.Getenv("TEST_REDIS_URL")
	if rurl == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	ctx := context.Background()
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	admin := cfg.Copy()
	admin.Database = "postgres"
	c, err := pgx.ConnectConfig(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	var exists bool
	c.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)`, cfg.Database).Scan(&exists)
	if !exists {
		if _, err := c.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{cfg.Database}.Sanitize()); err != nil {
			t.Fatal(err)
		}
	}
	c.Close(ctx)
	pcfg, _ := pgxpool.ParseConfig(url)
	pcfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	ropt, err := redis.ParseURL(rurl)
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(ropt)
	t.Cleanup(func() { rdb.Close() })
	if err := rdb.FlushDB(ctx).Err(); err != nil { // only the test db, never the default one
		t.Fatal(err)
	}
	st := &Store{pool: pool, rdb: rdb, ttl: ttl}
	if err := st.Init(ctx); err != nil {
		t.Fatal(err)
	}
	return st
}

func newEvent(t *testing.T, st *Store, seats int32) *EventRow {
	e, err := st.CreateEvent(context.Background(), "t", seats, 100)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func avail(t *testing.T, st *Store, id string) *EventRow {
	e, err := st.GetEvent(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestConcurrentNoOversell(t *testing.T) {
	st := newStore(t, time.Minute)
	ev := newEvent(t, st, 100)
	var ok, exhausted, other int
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := st.ReserveSeats(context.Background(), newUUID(), ev.ID, 1)
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				ok++
			case ErrExhausted:
				exhausted++
			default:
				other++
				t.Log(err)
			}
		}()
	}
	wg.Wait()
	if ok != 100 || exhausted != 400 || other != 0 {
		t.Fatalf("ok=%d exhausted=%d other=%d", ok, exhausted, other)
	}
	if e := avail(t, st, ev.ID); e.Available != 0 || e.Held != 100 {
		t.Fatalf("available=%d held=%d", e.Available, e.Held)
	}
	var n int
	if err := st.pool.QueryRow(context.Background(), `SELECT count(*) FROM holds WHERE event_id=$1 AND status='HELD'`, ev.ID).Scan(&n); err != nil || n != 100 {
		t.Fatalf("journal rows=%d err=%v", n, err)
	}
}

func TestReserveIdempotent(t *testing.T) {
	st := newStore(t, time.Minute)
	ev := newEvent(t, st, 10)
	id := newUUID()
	for i := 0; i < 2; i++ {
		h, err := st.ReserveSeats(context.Background(), id, ev.ID, 3)
		if err != nil || h.Quantity != 3 || h.AmountCents != 300 {
			t.Fatalf("%v %+v", err, h)
		}
	}
	if e := avail(t, st, ev.ID); e.Available != 7 {
		t.Fatalf("available=%d", e.Available)
	}
	if _, err := st.ReserveSeats(context.Background(), newUUID(), newUUID(), 1); err != ErrNotFound {
		t.Fatalf("want not found, got %v", err)
	}
}

func TestExpiry(t *testing.T) {
	st := newStore(t, 300*time.Millisecond)
	ev := newEvent(t, st, 10)
	ctx := context.Background()
	id := newUUID()
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 4); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	if _, err := st.ConfirmSeats(ctx, id); err != ErrPrecondition { // expired even before the sweeper runs
		t.Fatalf("pre-sweep confirm: %v", err)
	}
	if _, err := st.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Available != 10 || e.Held != 0 {
		t.Fatalf("available=%d held=%d", e.Available, e.Held)
	}
	_, err := st.ConfirmSeats(ctx, id)
	if status.Code(toErr(err)) != codes.FailedPrecondition {
		t.Fatalf("post-sweep confirm: %v", err)
	}
}

func TestConfirmReleaseNoop(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	a, b := newUUID(), newUUID()
	for _, id := range []string{a, b} {
		if _, err := st.ReserveSeats(ctx, id, ev.ID, 2); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ { // confirm is idempotent
		if _, err := st.ConfirmSeats(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	if h, err := st.ReleaseSeats(ctx, a); err != nil || h.Status != "CONFIRMED" {
		t.Fatalf("release after confirm: %v %+v", err, h)
	}
	for i := 0; i < 2; i++ {
		if h, err := st.ReleaseSeats(ctx, b); err != nil || h.Status != "RELEASED" {
			t.Fatalf("release %d: %v %+v", i, err, h)
		}
	}
	if e := avail(t, st, ev.ID); e.Available != 8 || e.Sold != 2 || e.Held != 0 {
		t.Fatalf("%+v", e)
	}
	if h, err := st.ReleaseSeats(ctx, newUUID()); err != nil || h != nil {
		t.Fatalf("missing: %v %v", err, h)
	}
}

func salesCount(t *testing.T, st *Store, id string) (n int) {
	t.Helper()
	if err := st.pool.QueryRow(context.Background(), `SELECT count(*) FROM sales WHERE booking_id=$1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return
}

func TestConfirmWritesSale(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	id := newUUID()
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 3); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // retry must not duplicate
		if _, err := st.ConfirmSeats(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	if n := salesCount(t, st, id); n != 1 {
		t.Fatalf("sales rows=%d", n)
	}
	// Redis hold gone (as after its 24h TTL): the sales row still answers confirm.
	if err := st.rdb.Del(ctx, holdKey(id)).Err(); err != nil {
		t.Fatal(err)
	}
	if h, err := st.ConfirmSeats(ctx, id); err != nil || h.Status != "CONFIRMED" || h.Quantity != 3 {
		t.Fatalf("fallback confirm: %v %+v", err, h)
	}
	if e := avail(t, st, ev.ID); e.Sold != 3 || e.Available != 7 || e.Held != 0 {
		t.Fatalf("%+v", e)
	}
}

func TestInitRebuildsCounters(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	id := newUUID()
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConfirmSeats(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := st.rdb.Del(ctx, availKey(ev.ID), heldKey(ev.ID), readyKey).Err(); err != nil {
		t.Fatal(err)
	}
	if err := st.Init(ctx); err != nil {
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Available != 6 || e.Held != 0 || e.Sold != 4 {
		t.Fatalf("after rebuild %+v", e)
	}
	if _, err := st.ReserveSeats(ctx, newUUID(), ev.ID, 1); err != nil {
		t.Fatal(err)
	}
	if err := st.Init(ctx); err != nil { // sentinel present: live counters survive
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Available != 5 || e.Held != 1 {
		t.Fatalf("init overwrote live keys: %+v", e)
	}
}

func journalStatus(t *testing.T, st *Store, id string) (s string) {
	t.Helper()
	if err := st.pool.QueryRow(context.Background(), `SELECT status FROM holds WHERE booking_id=$1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return
}

// flush simulates Redis losing its data (test db 15 only).
func flush(t *testing.T, st *Store) {
	t.Helper()
	if err := st.rdb.FlushDB(context.Background()).Err(); err != nil {
		t.Fatal(err)
	}
}

func TestConfirmAfterRedisLoss(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	id := newUUID()
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 3); err != nil {
		t.Fatal(err)
	}
	flush(t, st)
	if h, err := st.ConfirmSeats(ctx, id); err != nil || h.Status != "CONFIRMED" || h.Quantity != 3 {
		t.Fatalf("confirm after loss: %v %+v", err, h)
	}
	if e := avail(t, st, ev.ID); e.Sold != 3 || e.Available != 7 || e.Held != 0 {
		t.Fatalf("%+v", e)
	}
	if s := journalStatus(t, st, id); s != "CONFIRMED" {
		t.Fatalf("journal status=%s", s)
	}
}

func TestSweepRebuildsAfterRedisLoss(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	sold, held := newUUID(), newUUID()
	if _, err := st.ReserveSeats(ctx, sold, ev.ID, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConfirmSeats(ctx, sold); err != nil {
		t.Fatal(err)
	}
	h, err := st.ReserveSeats(ctx, held, ev.ID, 3)
	if err != nil {
		t.Fatal(err)
	}
	flush(t, st)
	if _, err := st.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Sold != 2 || e.Held != 3 || e.Available != 10-2-3 {
		t.Fatalf("%+v", e)
	}
	score, err := st.rdb.ZScore(ctx, "holds:expiry", held).Result()
	if err != nil || int64(score) != h.ExpiresAt.UnixMilli() {
		t.Fatalf("expiry score=%v want %d err=%v", score, h.ExpiresAt.UnixMilli(), err)
	}
	if n, _ := st.rdb.TTL(ctx, holdKey(held)).Result(); n != -1 {
		t.Fatalf("rebuilt HELD hold has a key TTL: %v", n)
	}
}

func TestRebuildSkipsSoldAndSweepsExpired(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	sold, live, expired := newUUID(), newUUID(), newUUID()
	for id, q := range map[string]int32{sold: 2, live: 3, expired: 1} {
		if _, err := st.ReserveSeats(ctx, id, ev.ID, q); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.ConfirmSeats(ctx, sold); err != nil {
		t.Fatal(err)
	}
	// Journal lag: the sold hold still reads HELD, and one hold expired before Redis was lost.
	if _, err := st.pool.Exec(ctx, `UPDATE holds SET status='HELD' WHERE booking_id=$1`, sold); err != nil {
		t.Fatal(err)
	}
	if _, err := st.pool.Exec(ctx, `UPDATE holds SET expires_at=now()-interval '1 minute' WHERE booking_id=$1`, expired); err != nil {
		t.Fatal(err)
	}
	flush(t, st)
	if err := st.ensureInventory(ctx); err != nil {
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Sold != 2 || e.Held != 4 || e.Available != 4 {
		t.Fatalf("after rebuild %+v", e)
	}
	if n, _ := st.rdb.Exists(ctx, holdKey(sold)).Result(); n != 0 {
		t.Fatal("rebuild restored a hold that has a sales row")
	}
	if _, err := st.Sweep(ctx); err != nil {
		t.Fatal(err)
	}
	if e := avail(t, st, ev.ID); e.Sold != 2 || e.Held != 3 || e.Available != 5 {
		t.Fatalf("after sweep %+v", e)
	}
	if s := journalStatus(t, st, expired); s != "RELEASED" {
		t.Fatalf("expired journal status=%s", s)
	}
	if s := journalStatus(t, st, live); s != "HELD" {
		t.Fatalf("live journal status=%s", s)
	}
}

func TestReserveRetryWritesMissingJournal(t *testing.T) {
	st := newStore(t, time.Minute)
	ctx := context.Background()
	ev := newEvent(t, st, 10)
	id := newUUID()
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 2); err != nil {
		t.Fatal(err)
	}
	// As if the process crashed between the Lua call and the journal insert.
	if _, err := st.pool.Exec(ctx, `DELETE FROM holds WHERE booking_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReserveSeats(ctx, id, ev.ID, 2); err != nil {
		t.Fatal(err)
	}
	if s := journalStatus(t, st, id); s != "HELD" {
		t.Fatalf("journal status=%s", s)
	}
	if e := avail(t, st, ev.ID); e.Available != 8 || e.Held != 2 {
		t.Fatalf("%+v", e)
	}
}

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
