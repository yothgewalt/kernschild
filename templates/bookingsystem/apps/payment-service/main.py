import asyncio
import json
import logging
import os
import random
import signal
import uuid
from dataclasses import dataclass
from datetime import timezone

import aio_pika
import asyncpg
import grpc
from bookingsystem.payment.v1 import payment_pb2, payment_pb2_grpc

log = logging.getLogger("payment")
EXCHANGE = "bookings"
STATUS = {
    "PROCESSING": payment_pb2.PAYMENT_STATUS_PROCESSING,
    "SUCCEEDED": payment_pb2.PAYMENT_STATUS_SUCCEEDED,
    "FAILED": payment_pb2.PAYMENT_STATUS_FAILED,
    "REFUNDED": payment_pb2.PAYMENT_STATUS_REFUNDED,
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL,
  user_id text NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED','REFUNDED')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check,
  ADD CONSTRAINT payments_status_check CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED','REFUNDED'));
"""


@dataclass(frozen=True)
class Config:
    database_url: str
    rabbitmq_url: str
    min_delay: float
    max_delay: float
    success_rate: float
    concurrency: int
    grpc_addr: str

    @classmethod
    def from_env(cls, env=os.environ) -> "Config":
        return cls(
            database_url=env.get("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/payment"),
            rabbitmq_url=env.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
            min_delay=float(env.get("PAYMENT_MIN_DELAY", "2")),
            max_delay=float(env.get("PAYMENT_MAX_DELAY", "6")),
            success_rate=float(env.get("PAYMENT_SUCCESS_RATE", "0.8")),
            concurrency=int(env.get("PAYMENT_CONCURRENCY", "200")),
            grpc_addr=env.get("GRPC_ADDR", "[::]:50053"),
        )


def decide(cfg: Config, rng=random) -> tuple[float, bool]:
    """Returns (delay seconds, succeeded)."""
    return rng.uniform(cfg.min_delay, cfg.max_delay), rng.random() < cfg.success_rate


def parse_request(body: bytes) -> tuple[str, str, int]:
    """Returns (booking_id, user_id, amount_cents); raises ValueError if malformed."""
    try:
        d = json.loads(body)
        booking_id = str(uuid.UUID(d["booking_id"]))
        user_id = d["user_id"]
        amount = d["amount_cents"]
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError, UnicodeDecodeError, RecursionError) as e:
        raise ValueError(f"malformed payment request: {e!r}") from e
    if not isinstance(user_id, str) or not user_id or type(amount) is not int or amount < 0:
        raise ValueError("malformed payment request: bad user_id or amount_cents")
    return booking_id, user_id, amount


def parse_refund(body: bytes) -> tuple[str, str]:
    """Returns (booking_id, reason); raises ValueError if malformed."""
    try:
        d = json.loads(body)
        booking_id = str(uuid.UUID(d["booking_id"]))
        reason = d["reason"]
    except (KeyError, TypeError, AttributeError, ValueError, UnicodeDecodeError, RecursionError) as e:
        raise ValueError(f"malformed refund request: {e!r}") from e
    if not isinstance(reason, str) or not reason:
        raise ValueError("malformed refund request: bad reason")
    return booking_id, reason


def refund_requeues(status: str | None) -> bool:
    """For a refund that updated no row: True means nack-requeue (charge still PROCESSING), False means ack."""
    return status == "PROCESSING"


async def retry(what, fn, tries=30):
    for i in range(1, tries + 1):
        try:
            return await fn()
        except Exception as e:
            if i == tries:
                raise
            log.warning("%s not ready (%d/%d): %s", what, i, tries, e)
            await asyncio.sleep(1)


def to_proto(r) -> payment_pb2.Payment:
    ts = lambda t: t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return payment_pb2.Payment(
        id=str(r["id"]), booking_id=str(r["booking_id"]), user_id=r["user_id"],
        amount_cents=r["amount_cents"], status=STATUS[r["status"]],
        created_at=ts(r["created_at"]), updated_at=ts(r["updated_at"]),
    )


class PaymentServicer(payment_pb2_grpc.PaymentServiceServicer):
    def __init__(self, pool):
        self.pool = pool

    async def GetPayment(self, request, context):
        try:
            bid = uuid.UUID(request.booking_id)
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "booking_id must be a uuid")
        r = await self.pool.fetchrow("SELECT * FROM payments WHERE booking_id = $1", bid)
        if r is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "no payment for booking")
        return payment_pb2.GetPaymentResponse(payment=to_proto(r))

    async def ListPayments(self, request, context):
        limit = min(request.limit if request.limit > 0 else 50, 500)
        rows = await self.pool.fetch("SELECT * FROM payments ORDER BY created_at DESC, id LIMIT $1", limit)
        return payment_pb2.ListPaymentsResponse(payments=[to_proto(r) for r in rows])


class Processor:
    def __init__(self, cfg, pool, exchange):
        self.cfg, self.pool, self.exchange = cfg, pool, exchange
        self.inflight: set[str] = set()  # shortcut: single-instance dedupe, use a DB lock to scale out

    async def publish(self, booking_id, payment_id, status, amount):
        body = json.dumps({"booking_id": booking_id, "payment_id": str(payment_id),
                           "status": status, "amount_cents": amount}).encode()
        key = "payment.completed" if status == "SUCCEEDED" else "payment.failed"
        msg = aio_pika.Message(body, content_type="application/json",
                               delivery_mode=aio_pika.DeliveryMode.PERSISTENT)
        await self.exchange.publish(msg, routing_key=key)  # awaits publisher confirm

    async def handle(self, message: aio_pika.abc.AbstractIncomingMessage):
        try:
            booking_id, user_id, amount = parse_request(message.body)
        except ValueError as e:
            log.error("rejecting message: %s", e)
            await message.reject(requeue=False)
            return
        if booking_id in self.inflight:  # concurrent duplicate; the first one publishes the result
            log.info("booking %s already in flight, dropping duplicate", booking_id)
            await message.ack()
            return
        self.inflight.add(booking_id)
        try:
            await self.process(booking_id, user_id, amount)
            await message.ack()
        except Exception:
            log.exception("booking %s failed, requeueing", booking_id)
            await asyncio.sleep(1)  # before the nack: a sleep after it throttles nothing
            self.inflight.discard(booking_id)  # before the nack, or the redelivery is acked as a duplicate
            await message.nack(requeue=True)
        finally:
            self.inflight.discard(booking_id)

    async def process(self, booking_id, user_id, amount):
        bid = uuid.UUID(booking_id)
        row = await self.pool.fetchrow(
            "INSERT INTO payments (booking_id, user_id, amount_cents, status) VALUES ($1,$2,$3,'PROCESSING') "
            "ON CONFLICT (booking_id) DO NOTHING RETURNING id", bid, user_id, amount)
        if row is None:
            row = await self.pool.fetchrow("SELECT id, status, amount_cents FROM payments WHERE booking_id = $1", bid)
            if row["status"] == "REFUNDED":  # settled and refunded; booking needs nothing more
                log.info("booking %s already REFUNDED, acking without republish", booking_id)
                return
            if row["status"] != "PROCESSING":
                log.info("booking %s already %s, republishing result", booking_id, row["status"])
                await self.publish(booking_id, row["id"], row["status"], row["amount_cents"])
                return
            log.info("booking %s was left PROCESSING, processing again", booking_id)
        else:
            log.info("booking %s payment %s PROCESSING", booking_id, row["id"])
        delay, ok = decide(self.cfg)
        await asyncio.sleep(delay)
        status = "SUCCEEDED" if ok else "FAILED"
        await self.pool.execute("UPDATE payments SET status=$2, updated_at=now() WHERE id=$1", row["id"], status)
        log.info("booking %s payment %s %s", booking_id, row["id"], status)
        await self.publish(booking_id, row["id"], status, amount)

    async def handle_refund(self, message: aio_pika.abc.AbstractIncomingMessage):
        try:
            booking_id, reason = parse_refund(message.body)
        except ValueError as e:
            log.error("rejecting refund: %s", e)
            await message.reject(requeue=False)
            return
        try:
            bid = uuid.UUID(booking_id)
            row = await self.pool.fetchrow(
                "UPDATE payments SET status='REFUNDED', updated_at=now() "
                "WHERE booking_id=$1 AND status='SUCCEEDED' RETURNING id", bid)
            if row is not None:
                log.info("refunded payment %s for booking %s (%s)", row["id"], booking_id, reason)
            else:
                status = await self.pool.fetchval("SELECT status FROM payments WHERE booking_id=$1", bid)
                if refund_requeues(status):
                    log.warning("refund for booking %s while payment PROCESSING, requeueing", booking_id)
                    # sleep before the nack: each delivery is its own task, so a sleep after it throttles nothing
                    await asyncio.sleep(1)
                    await message.nack(requeue=True)
                    return
                log.info("refund for booking %s is a no-op: payment %s (%s)", booking_id, status or "missing", reason)
        except Exception:
            log.exception("refund for booking %s failed, requeueing", booking_id)
            await asyncio.sleep(1)
            await message.nack(requeue=True)
            return
        await message.ack()


async def declare(channel):
    ex = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
    req = await channel.declare_queue("payment.requests", durable=True)
    await req.bind(ex, "payment.requested")
    res = await channel.declare_queue("booking.payment-results", durable=True)
    await res.bind(ex, "payment.completed")
    await res.bind(ex, "payment.failed")
    refunds = await channel.declare_queue("payment.refunds", durable=True)
    await refunds.bind(ex, "payment.refund.requested")
    return ex, req, refunds


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = Config.from_env()

    async def mkpool():
        return await asyncpg.create_pool(cfg.database_url, min_size=1, max_size=min(cfg.concurrency, 20))
    pool = await retry("postgres", mkpool)
    await pool.execute(SCHEMA)

    conn = await retry("rabbitmq", lambda: aio_pika.connect_robust(cfg.rabbitmq_url))
    pub_ch = await conn.channel(publisher_confirms=True)
    ex, _, _ = await declare(pub_ch)
    ch = await conn.channel()
    await ch.set_qos(prefetch_count=cfg.concurrency)
    _, req, refunds = await declare(ch)
    proc = Processor(cfg, pool, ex)

    server = grpc.aio.server()
    payment_pb2_grpc.add_PaymentServiceServicer_to_server(PaymentServicer(pool), server)
    server.add_insecure_port(cfg.grpc_addr)
    await server.start()
    log.info("payment started: grpc=%s concurrency=%d", cfg.grpc_addr, cfg.concurrency)

    # no_ack=False + callback: aio-pika runs each message as its own task, bounded by prefetch
    tag = await req.consume(proc.handle)
    refund_tag = await refunds.consume(proc.handle_refund)

    stop = asyncio.Event()
    for s in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(s, stop.set)
    await stop.wait()

    log.info("shutting down")
    await req.cancel(tag)
    await refunds.cancel(refund_tag)
    await server.stop(5)
    while proc.inflight:  # let in-flight payments finish and ack
        await asyncio.sleep(0.1)
    await conn.close()
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
