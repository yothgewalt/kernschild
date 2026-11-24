# Booking system demo

A small ticket booking system built as four microservices. Use it to see these patterns
working together:

- gRPC between services
- RabbitMQ for asynchronous payment
- one Postgres database per service
- Redis for live seat inventory
- seat holds that keep a booking `PENDING` while payment runs, and that never oversell
  under a burst of concurrent requests

The payment provider is a mock.

| App | Language | Port | Role |
|---|---|---|---|
| `apps/booking-service` | Node.js | HTTP 3000 | Public HTTP API and orchestrator |
| `apps/auth-service` | Go | gRPC 50051 | Users, login, JWT validation |
| `apps/event-service` | Go | gRPC 50052 | Events and seat inventory. Holds live in Redis; events and sales in Postgres |
| `apps/payment-service` | Python | gRPC 50053 | Mock payment worker (RabbitMQ consumer) and payment lookup |

## Flow

```
client ──HTTP──► booking ──gRPC──► auth      ValidateToken
                    │
                    ├──gRPC──► event         ReserveSeats  → Redis Lua hold (TTL, default 15s)
                    │                         booking saved as PENDING
                    └──AMQP──► payment.requested ──► payment (sleeps 2–6s, 80% succeed)
                                                        │
booking ◄── payment.completed / payment.failed ◄────────┘
   ├── succeeded → event.ConfirmSeats → CONFIRMED
   │      (hold already expired → EXPIRED + payment.refund.requested → payment REFUNDED)
   └── failed    → event.ReleaseSeats → FAILED
sweepers: event releases expired holds, booking marks expired PENDING bookings EXPIRED
```

## Quick start

Requirements: Docker with Compose, [Task](https://taskfile.dev), and Node.js for the demo
scripts.

```sh
task up          # build and start everything, wait until healthy
task demo        # one booking: PENDING → CONFIRMED or FAILED
task loadtest    # 500 concurrent bookings for 100 seats; asserts no oversell
task demo:expiry # make payment slower than the hold and watch the booking expire
task check       # prove idempotency keys, late-payment refunds and Redis-loss recovery
task stats       # booking counts by status and seat inventory
task reset       # stop everything and delete the data
```

Run `task` to list all commands. To change the protos, edit them under `proto/` and run
`task gen`. To run the unit and integration tests, run `task test`. These need Go, Node,
`uv` and buf locally.

## HTTP API (localhost:3000)

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{email, password}` |
| POST | `/auth/login` | `{email, password}` → `{token}` |
| GET | `/events`, `/events/:id` | Includes `available`, `held` and `sold` |
| POST | `/events` | Requires auth. `{name, capacity, price_cents}` |
| POST | `/bookings` | Requires auth. `{event_id, quantity}` → `202` PENDING, or `409` when sold out. The optional `Idempotency-Key` header makes retries safe: the same key returns the same booking (`200`, `Idempotent-Replayed: true`) |
| GET | `/bookings` | Requires auth. The caller's bookings |
| GET | `/bookings/:id` | |
| GET | `/payments`, `/payments/:bookingId` | Served from the payment service over gRPC |
| GET | `/stats` | Bookings by status, plus every event's inventory |
| GET | `/healthz` | |

Send `Authorization: Bearer <token>` on routes that require auth. You can watch the queues
in the RabbitMQ UI at http://localhost:15672 (`guest`/`guest`).

## How a burst stays correct

- **No oversell.** `ReserveSeats` runs one Redis Lua script. The script checks
  `event:{id}:available`, decrements it, and records the hold, all in one step. Redis runs
  scripts one at a time, so concurrent requests can't interleave and no locks are needed.
  A request that loses gets `409`. Confirmed sales are written to Postgres, which remains
  the system of record. When the event service starts, it rebuilds missing Redis counters
  from Postgres.
- **Bounded concurrency.** Each service has a capped database pool. RabbitMQ consumers use
  manual acks with prefetch, so the payment worker processes up to `PAYMENT_CONCURRENCY`
  messages at once.
- **Idempotency.** Holds and payments are keyed by booking id, so retries and redelivered
  messages don't double-book or double-charge. Booking status changes only out of `PENDING`,
  so late or duplicate results are ignored. A client `Idempotency-Key` maps to one booking id
  per user, so even concurrent retries converge on one booking and one hold. Reusing a key
  with a different body returns `422`.
- **Refunds.** A payment that succeeds after its booking expired or failed is refunded. The
  booking service publishes `payment.refund.requested`, and the payment service marks the
  payment `REFUNDED`. Refunds are idempotent too.
- **Expiry.** The Redis clock sets the hold deadline. Both services use the same
  `expires_at`, so a payment that arrives late can never confirm a released seat. Held
  seats return to the pool through a sweeper that reads a sorted set of hold expiry
  times. Key TTLs are not used for this, because a key that silently expires would lose
  its seats.
- **Redis loss.** Every hold is also written to a `holds` journal in Postgres. When the
  `inventory:ready` sentinel is missing, the event service rebuilds the counters and live
  holds from Postgres. It checks on startup, on each sweeper tick and on any missing key,
  so bookings that are mid-payment still confirm after Redis restarts empty.

## Configuration

Set these in the environment before `task up`, or use them as `task` variables where noted:

| Variable | Default | Effect |
|---|---|---|
| `HOLD_TTL` | `15s` | How long seats stay held while payment runs |
| `PAYMENT_MIN_DELAY`, `PAYMENT_MAX_DELAY` | `2`, `6` | Mock payment duration (seconds) |
| `PAYMENT_SUCCESS_RATE` | `0.8` | Fraction of payments that succeed |
| `PAYMENT_CONCURRENCY` | `200` | Payment messages processed in parallel |
| `JWT_SECRET` | dev value | Token signing key |
| `N`, `CAPACITY`, `USERS` (task vars) | `500`, `100`, `20` | Load test shape, for example `task loadtest N=2000 CAPACITY=300` |

`CONTRACTS.md` has the full service contracts: tables, queues, message bodies and error
mapping.

## Layout

Each app under `apps/` is self-contained. It has its own dependencies, Dockerfile and
generated code. The only shared input is `proto/`, and `task gen` regenerates every app's
copy from it. `deploy/postgres/init.sql` creates the four databases. `scripts/` holds the
demo and load-test clients.
