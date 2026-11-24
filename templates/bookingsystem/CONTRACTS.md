# Service contracts

The single source of truth that every service is built against. The gRPC
APIs live in `proto/`. This file covers everything else: env vars, tables,
RabbitMQ topology, message bodies and the HTTP API.

## Runtime

Everything runs under `docker compose` (see `docker-compose.yml`). For local
testing, Postgres listens on `localhost:5432` (user/password `postgres`/`postgres`,
databases `auth`, `event`, `booking`, `payment`). RabbitMQ listens on
`localhost:5672` (`guest`/`guest`). Redis listens on `localhost:6379` (AOF on, used by event only).

Every service must:

- Read config only from env vars, with defaults that work locally.
- Retry its Postgres and RabbitMQ connections at startup (about 30 tries, 1s apart),
  because containers start in any order.
- Create its own tables with `CREATE TABLE IF NOT EXISTS` at startup.
- Log one line per significant action (startup, each state change) to stdout.
- Shut down cleanly on SIGTERM/SIGINT.
- Use timestamps in RFC 3339 UTC in all proto string fields.
- Map errors to gRPC codes: bad input → `INVALID_ARGUMENT`, missing → `NOT_FOUND`,
  duplicate → `ALREADY_EXISTS`, and so on.

## auth (Go, `apps/auth-service`, gRPC `GRPC_ADDR` default `:50051`)

Env: `DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/auth?sslmode=disable`),
`JWT_SECRET` (default `dev-only-secret-change-me`), `TOKEN_TTL` (default `24h`).

Table `users(id uuid pk default gen_random_uuid(), email text unique not null, password_hash text not null, created_at timestamptz default now())`.

- `Register`: requires an email containing `@` and a password of at least 6 chars. Stores a bcrypt
  hash. A duplicate email returns `ALREADY_EXISTS`. Emails are lowercased and trimmed.
- `Login`: on a wrong email or password returns `UNAUTHENTICATED`. Returns an HS256 JWT
  with `sub`=user id, `email`, `exp`.
- `ValidateToken`: verifies the signature, alg (HS256 only) and expiry, else returns `UNAUTHENTICATED`.

## event (Go, `apps/event-service`, gRPC `GRPC_ADDR` default `:50052`)

Env: `DATABASE_URL` (default `.../event?sslmode=disable`), `REDIS_URL` (default
`redis://localhost:6379/0`), `HOLD_TTL` (Go duration, default `15s`), `SWEEP_INTERVAL` (default `1s`).

**Redis owns live inventory (available seats and holds), and Postgres is the system of
record for event details and confirmed sales.** Every inventory change is a single Lua
script, so each one is atomic without locks. Redis `TIME`, read inside the script, is the
only clock for holds.

Postgres tables:

- `events(id uuid pk default gen_random_uuid(), name text not null, capacity int not null check (capacity > 0), price_cents bigint not null check (price_cents >= 0), created_at timestamptz default now())`
- `sales(booking_id uuid pk, event_id uuid not null references events(id), quantity int not null, amount_cents bigint not null, created_at timestamptz default now())`
- `holds(booking_id uuid pk, event_id uuid not null references events(id), quantity int not null check (quantity > 0), amount_cents bigint not null, status text not null check (status in ('HELD','CONFIRMED','RELEASED')), expires_at timestamptz not null, created_at timestamptz default now(), updated_at timestamptz default now())`
  is the **hold journal**: a durable copy of every hold, used only to rebuild Redis. It is
  written with plain inserts and updates on distinct rows (no shared counter row), so it
  doesn't bring back the hot-row lock. `expires_at` stores the Redis-computed expiry.

Redis keys (`{id}` is the event id, `{b}` the booking id):

| Key | Type | Meaning |
|---|---|---|
| `event:{id}:available` | int | Seats that can still be held |
| `event:{id}:held` | int | Seats in live holds |
| `hold:{b}` | hash | `event_id, quantity, amount_cents, status (HELD/CONFIRMED/RELEASED), expires_at_ms` |
| `holds:expiry` | zset | Member `{b}`, score `expires_at_ms`, for HELD holds only |
| `inventory:ready` | string | Sentinel: Redis holds a complete inventory. If it is missing, Redis lost data or was never built |

`sold` in the proto is `SUM(quantity)` from `sales`. `available` and `held` come from Redis.
`available + held + sold == capacity` holds once no confirm is mid-flight.

A HELD hold never gets a key TTL. If a key TTL dropped it, the seats would be lost, so
seats always return through the sweeper. Terminal holds get `PEXPIRE` of 24h, so retries
stay idempotent and memory stays bounded.

Startup, after the Postgres tables exist:

1. Seed one event, `"Kernschild Live 2026"`, with capacity 100 and price 150000 cents, but
   only if `events` is empty.
2. Run `ensureInventory()`.

`ensureInventory()` runs under a process-wide mutex, so concurrent callers wait for one
rebuild:

1. If `inventory:ready` exists, return.
2. Otherwise, read from Postgres:
   - every event,
   - `sold` per event from `sales`,
   - every journal hold with `status = 'HELD'` that has **no** `sales` row. Expired ones are
     included, because the sweeper releases them right after the rebuild, so no clock
     comparison is needed.
3. In one `MULTI`/`EXEC`:
   - per event: `SET available = capacity - sold - live_held` and `SET held = live_held`,
     overwriting any value,
   - per live hold: `HSET hold:{b}` with status HELD and its `expires_at_ms`, then `ZADD holds:expiry`,
   - `SET inventory:ready 1`.
4. Log `rebuilt inventory from postgres: N events, M holds`.

Who calls it:

- startup,
- every sweeper tick (a cheap `EXISTS`, so a Redis that restarted empty is detected within
  `SWEEP_INTERVAL`),
- any Lua script that finds a key missing which should exist. Those scripts call it and
  retry once, as described below.

shortcut: there is one event-service instance, so the mutex is per process. Scaling out
would need a Redis lock (`SET inventory:rebuild NX PX`) around the rebuild.

- `CreateEvent`: the name must be non-empty, the capacity 1..100000, and the price ≥ 0.
  Insert the row, then set both counters (`available = capacity`, `held = 0`) with `SET NX`.
  NX ensures a rebuild that ran in between is never clobbered.
- `ReserveSeats`: the quantity must be 1..10 and `booking_id` a uuid. The price is looked
  up in Postgres (the event is unknown → `NOT_FOUND`), then one Lua script runs:
  - If `hold:{b}` exists, return it unchanged (idempotent).
  - If `event:{id}:available` is missing, return `NOT_FOUND`.
  - If it is less than the quantity, return `RESOURCE_EXHAUSTED`.
  - Otherwise `DECRBY available`, `INCRBY held`, `HSET` the hold with status HELD and
    `expires_at_ms = TIME + ttl`, then `ZADD holds:expiry`.
  - When the counter is missing but the event exists in Postgres, run `ensureInventory()`
    and retry once. Return `NOT_FOUND` only if it is still missing.
  - After a successful Lua call (new or existing hold), run
    `INSERT INTO holds ... ON CONFLICT (booking_id) DO NOTHING`. Running it on the
    idempotent path too heals a crash between the two steps. If this insert fails, release the
    hold in Redis (same Lua as ReleaseSeats) and return `UNAVAILABLE`, so a hold never exists
    only in Redis.
- `ConfirmSeats`:
  - Lua: if the hold is HELD and `expires_at_ms > TIME`, set it to CONFIRMED,
    `DECRBY held`, `ZREM`, and `PEXPIRE` 24h. If it is already CONFIRMED, return OK.
    If it is RELEASED, or HELD but expired, return `FAILED_PRECONDITION`.
  - If it is missing in Redis, run `ensureInventory()` and retry the Lua once. If it is
    still missing, fall back to `sales`: a row there means OK (CONFIRMED). Otherwise
    return `NOT_FOUND`.
  - On OK, in one Postgres tx: `INSERT INTO sales ... ON CONFLICT DO NOTHING` and
    `UPDATE holds SET status='CONFIRMED', updated_at=now() WHERE booking_id=$1`. This
    runs on every OK, so a crash between the steps heals on retry.
- `ReleaseSeats` (Lua): if the hold is HELD, set it to RELEASED, `INCRBY available`,
  `DECRBY held`, `ZREM`, and `PEXPIRE` 24h. If it is in any other state, this is a no-op
  that returns the hold. If it is missing in Redis, run `ensureInventory()` and retry once.
  If it is still missing, return OK with `hold` unset. After the Lua call, run
  `UPDATE holds SET status='RELEASED', updated_at=now() WHERE booking_id=$1 AND status='HELD'`.
- Sweeper goroutine, every `SWEEP_INTERVAL`:
  1. Run `ensureInventory()`.
  2. Run one Lua script. It takes up to 1000 members of `holds:expiry` with score ≤ TIME,
     releases each HELD one exactly as `ReleaseSeats` does, and returns the **booking ids it
     actually released**.
  3. Run `UPDATE holds SET status='RELEASED' ... WHERE booking_id = ANY($1) AND status='HELD'`.
  4. Loop while the script processed 1000 members, and log the total released when it is > 0.

Journal lag is safe. If a status update to `holds` is lost in a crash, a rebuild can bring
back an already-released hold as HELD. The hold's `expires_at` is in the past, so the next
sweep releases it again. A confirmed hold always has a `sales` row, so a rebuild never
brings it back.

## payment (Python, `apps/payment-service`, gRPC `GRPC_ADDR` default `[::]:50053`)

Env: `DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/payment`),
`RABBITMQ_URL` (default `amqp://guest:guest@localhost:5672/`), `PAYMENT_MIN_DELAY` (seconds,
float, default 2), `PAYMENT_MAX_DELAY` (default 6), `PAYMENT_SUCCESS_RATE` (default 0.8),
`PAYMENT_CONCURRENCY` (RabbitMQ prefetch, default 200).

Table `payments(id uuid pk default gen_random_uuid(), booking_id uuid unique not null, user_id text not null, amount_cents bigint not null, status text not null check (status in ('PROCESSING','SUCCEEDED','FAILED','REFUNDED')), created_at timestamptz default now(), updated_at timestamptz default now())`.

The consumer is a mock payment processor. It uses asyncio and handles up to PAYMENT_CONCURRENCY
messages at once:

1. `INSERT ... (status PROCESSING) ON CONFLICT (booking_id) DO NOTHING RETURNING id`.
   If the row already exists and is terminal (SUCCEEDED/FAILED), republish its result and ack,
   because this is a redelivery. If it exists and is PROCESSING, a crash interrupted it, so
   process it again.
2. `await asyncio.sleep(uniform(MIN, MAX))`. The outcome is `random() < SUCCESS_RATE`.
3. Update the status, then publish the result, then ack. A crash before the ack causes a
   redelivery, which step 1 handles.

   A `REFUNDED` row is also terminal. Ack it without republishing, because the booking was
   already settled and refunded.

On a malformed message, log it and `reject(requeue=False)`.

Because an older database has the 3-value check, migrate it idempotently at startup:
`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check, ADD CONSTRAINT payments_status_check CHECK (status in ('PROCESSING','SUCCEEDED','FAILED','REFUNDED'))`.

**Refund consumer** on queue `payment.refunds` (same prefetch and manual ack):

1. `UPDATE payments SET status='REFUNDED', updated_at=now() WHERE booking_id=$1 AND status='SUCCEEDED' RETURNING id`.
2. If a row is updated, log `refunded payment <id> for booking <b> (<reason>)`.
3. Otherwise read the row:
   - `REFUNDED`: a duplicate, so this is a no-op.
   - `FAILED`, or no row: nothing was charged, so log and ack.
   - `PROCESSING`: impossible if booking follows the contract, because refunds are only
     requested after a SUCCEEDED result. Nack with requeue so it is retried after the
     charge settles.
4. Ack. A malformed body gets `reject(requeue=False)`.

The refund is a mock. No money moves, and nothing is published after a refund.

gRPC: `GetPayment(booking_id)` returns NOT_FOUND if there is no row. `ListPayments(limit)`
returns rows newest first, with limit defaulting to 50 and capped at 500.

## RabbitMQ topology

Both sides declare it idempotently with the same arguments:

- Exchange `bookings`, type `topic`, durable.
- Queue `payment.requests`, durable, bound with key `payment.requested`. The payment service consumes it.
- Queue `booking.payment-results`, durable, bound with keys `payment.completed` and `payment.failed`.
  The booking service consumes it.
- Queue `payment.refunds`, durable, bound with key `payment.refund.requested`. The booking
  service publishes to it and the payment service consumes it.
- Messages are JSON (`content_type: application/json`) and persistent (delivery mode 2).
  Consumers use manual ack and prefetch.

`payment.requested` body:
`{"booking_id": "<uuid>", "user_id": "<uuid>", "event_id": "<uuid>", "amount_cents": 300000}`

`payment.completed` / `payment.failed` body:
`{"booking_id": "<uuid>", "payment_id": "<uuid>", "status": "SUCCEEDED"|"FAILED", "amount_cents": 300000}`

`payment.refund.requested` body:
`{"booking_id": "<uuid>", "payment_id": "<uuid>", "reason": "hold_expired"|"booking_not_pending"}`

## booking (Node.js, `apps/booking-service`, HTTP `HTTP_PORT` default 3000)

This is the public HTTP API. It calls the other services over gRPC, using `@grpc/grpc-js` and
`@grpc/proto-loader` to load `${PROTO_DIR}/bookingsystem/*/v1/*.proto` at runtime. `PROTO_DIR`
defaults to the `proto/` copy inside the app, which `task gen` exports with `buf export`.

Env: `DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/booking`), `RABBITMQ_URL`,
`AUTH_ADDR` (`localhost:50051`), `EVENT_ADDR` (`localhost:50052`), `PAYMENT_ADDR` (`localhost:50053`),
`SWEEP_INTERVAL_MS` (1000).

Table `bookings(id uuid pk, user_id text not null, event_id uuid not null, quantity int not null, amount_cents bigint not null, status text not null check (status in ('PENDING','CONFIRMED','FAILED','EXPIRED')), payment_id uuid, expires_at timestamptz not null, created_at timestamptz default now(), updated_at timestamptz default now())`
plus indexes on `(user_id)` and `(status, expires_at)`.

Table `idempotency_keys(user_id text not null, key text not null, request_hash text not null, booking_id uuid not null, created_at timestamptz default now(), primary key (user_id, key))`
plus an index on `(created_at)`.

Status machine: `PENDING → CONFIRMED | FAILED | EXPIRED`. Every transition is
`UPDATE ... WHERE id=$1 AND status='PENDING'`, so a late or duplicate message is a no-op.

- `POST /bookings {event_id, quantity}` (auth). The optional header is `Idempotency-Key`,
  1..200 printable ASCII chars, otherwise 400 `invalid_idempotency_key`.
  1. Choose the booking id.
     - Without the header, use `crypto.randomUUID()`.
     - With the header:
       - Compute `request_hash = sha256(JSON.stringify({event_id, quantity}))`.
       - Run `INSERT INTO idempotency_keys (user_id, key, request_hash, booking_id) VALUES (...,randomUUID()) ON CONFLICT DO NOTHING`,
         then `SELECT request_hash, booking_id`. Keys are scoped per user, so another user's
         key never collides.
       - A different `request_hash` → 422 `idempotency_key_reused`.
       - Otherwise use the stored `booking_id`.
       - If that booking row already exists, this is a replay:
         - If the booking is PENDING, re-publish `payment.requested`. This heals a crash
           between insert and publish; payment dedups by booking_id.
         - Respond `200 {booking}` with header `Idempotent-Replayed: true`.
       - If the row doesn't exist yet (first try, a concurrent duplicate, or an earlier try
         that failed before inserting), continue below with that id. Every step is
         idempotent per booking_id: ReserveSeats returns the same hold, the insert uses
         `ON CONFLICT (id) DO NOTHING`, and payment dedups. So concurrent duplicates converge
         on one booking and one hold.
  2. Call `Event.ReserveSeats`. `RESOURCE_EXHAUSTED` → 409 `{error:"sold_out"}`. `NOT_FOUND` → 404.
     `INVALID_ARGUMENT` → 400. Nothing is stored for a 409, so a retry with the same key
     tries again.
  3. Insert a PENDING booking with the hold's `expires_at` and `amount_cents`, using
     `INSERT ... ON CONFLICT (id) DO NOTHING`, then read the row back.
  4. Publish `payment.requested` on a confirm channel and await the broker ack.
     On a failure here, release the seats and mark the booking FAILED.
  5. Respond `202 {booking}`.
- The sweeper also deletes idempotency keys older than 24h. Run it at most once a minute.
- Results consumer on `booking.payment-results`. Read the booking first:
  - Unknown booking: log it and ack.
  - `SUCCEEDED` and the booking is PENDING: call `Event.ConfirmSeats`.
    - On OK, set CONFIRMED and `payment_id`.
    - On `FAILED_PRECONDITION`/`NOT_FOUND`, set EXPIRED and `payment_id`, then publish
      `payment.refund.requested` with reason `hold_expired`.
  - `SUCCEEDED` and the booking is already CONFIRMED: a duplicate, so this is a no-op.
  - `SUCCEEDED` and the booking is EXPIRED or FAILED (the sweeper got there first): set
    `payment_id` if it is null, then publish `payment.refund.requested` with reason
    `booking_not_pending`. This is a guarded `UPDATE ... WHERE payment_id IS NULL`.
  - `FAILED` and the booking is PENDING: call `Event.ReleaseSeats`, then set FAILED and
    `payment_id`. On any other status, this is a no-op.
  - Every refund publish goes through the confirm channel before the ack. Refunds are
    idempotent at the payment side, so republishing on redelivery is safe.
  - Ack after the DB update and any refund publish. On a transient gRPC error
    (UNAVAILABLE/DEADLINE_EXCEEDED) or a publish failure, nack with requeue.
- Sweeper every `SWEEP_INTERVAL_MS`: `UPDATE bookings SET status='EXPIRED' WHERE status='PENDING' AND expires_at <= now() RETURNING id`,
  then call `Event.ReleaseSeats` for each. That call is idempotent, and the event sweeper also
  covers it.
- Auth header: `Authorization: Bearer <token>`. Validate via `Auth.ValidateToken`.
  `UNAUTHENTICATED` → 401.

HTTP API (JSON; error bodies are `{"error": "<snake_case>", "message": "..."}`):

| Method | Path | Auth | Calls |
|---|---|---|---|
| POST | /auth/register `{email,password}` | – | Auth.Register → 201 `{user}` |
| POST | /auth/login `{email,password}` | – | Auth.Login → 200 `{token, expires_at, user}` |
| GET | /events | – | Event.ListEvents → `{events}` |
| GET | /events/:id | – | Event.GetEvent → `{event}` |
| POST | /events `{name, capacity, price_cents}` | yes | Event.CreateEvent → 201 `{event}` |
| POST | /bookings `{event_id, quantity}` (+ optional `Idempotency-Key` header) | yes | see above → 202 `{booking}` (200 on replay) |
| GET | /bookings | yes | the caller's bookings, newest first → `{bookings}` |
| GET | /bookings/:id | – | `{booking}` (404 if missing) |
| GET | /payments?limit= | – | Payment.ListPayments → `{payments}` |
| GET | /payments/:bookingId | – | Payment.GetPayment → `{payment}` |
| GET | /stats | – | `{bookings: {PENDING:n, CONFIRMED:n, FAILED:n, EXPIRED:n}, events: [Event...]}` |
| GET | /healthz | – | 200 `{ok:true}` when DB + RabbitMQ are connected, else 503 |

Booking JSON uses snake_case fields that mirror the table columns. Proto enums are rendered as
strings without their prefix: `PAYMENT_STATUS_SUCCEEDED` → `"SUCCEEDED"`. Every gRPC call has
a deadline of 5s.

## Repository layout

Each app under `apps/` is self-contained, as if it were its own repo. Each one has its own
module or package file, its own Dockerfile (the build context is the app dir), and its own
generated code. The only shared input is `proto/`. `task gen` regenerates every app's copy:
Go into `apps/{auth,event}-service/gen`, Python into `apps/payment-service/gen`, and the raw
`.proto` files into `apps/booking-service/proto`.
