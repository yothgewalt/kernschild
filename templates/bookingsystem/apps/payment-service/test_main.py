import asyncio
import json
import os
import random
import uuid

import asyncpg
import pytest

from main import SCHEMA, Config, Processor, decide, parse_refund, parse_request, refund_requeues, to_proto


def test_config_defaults_and_override():
    c = Config.from_env({"PAYMENT_MIN_DELAY": "0.1", "PAYMENT_CONCURRENCY": "7"})
    assert (c.min_delay, c.max_delay, c.success_rate, c.concurrency) == (0.1, 6.0, 0.8, 7)


def test_decide_bounds_and_rate():
    c = Config.from_env({"PAYMENT_MIN_DELAY": "1", "PAYMENT_MAX_DELAY": "2", "PAYMENT_SUCCESS_RATE": "0"})
    assert all(1 <= decide(c, random)[0] <= 2 and not decide(c, random)[1] for _ in range(50))
    c = Config.from_env({"PAYMENT_SUCCESS_RATE": "1"})
    assert decide(c)[1]


def test_parse_request():
    b = str(uuid.uuid4())
    body = json.dumps({"booking_id": b, "email": "ada@example.com", "event_id": "e", "amount_cents": 5}).encode()
    assert parse_request(body) == (b, "ada@example.com", 5)


@pytest.mark.parametrize("body", [b"not json", b"[]", b"{}", b"[" * 100000, b'{"booking_id":"x","email":"a@b.c","amount_cents":1}',
                                  json.dumps({"booking_id": str(uuid.uuid4()), "email": "a@b.c", "amount_cents": "5"}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "amount_cents": 5}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "user_id": "u", "amount_cents": 5}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "email": "", "amount_cents": 5}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "email": 5, "amount_cents": 5}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "email": ["a@b.c"], "amount_cents": 5}).encode()])
def test_parse_request_malformed(body):
    with pytest.raises(ValueError):
        parse_request(body)


def test_parse_refund():
    b = str(uuid.uuid4())
    body = json.dumps({"booking_id": b, "payment_id": str(uuid.uuid4()), "reason": "hold_expired"}).encode()
    assert parse_refund(body) == (b, "hold_expired")


@pytest.mark.parametrize("body", [b"not json", b"[]", b"{}", b"[" * 100000, b'{"booking_id":"x","reason":"hold_expired"}',
                                  json.dumps({"booking_id": str(uuid.uuid4())}).encode(),
                                  json.dumps({"booking_id": str(uuid.uuid4()), "reason": 5}).encode()])
def test_parse_refund_malformed(body):
    with pytest.raises(ValueError):
        parse_refund(body)


@pytest.mark.parametrize("status,requeue", [("PROCESSING", True), ("REFUNDED", False), ("FAILED", False), (None, False)])
def test_refund_requeues(status, requeue):
    assert refund_requeues(status) is requeue


def test_failed_payment_redelivery_is_processed_not_dropped():
    """A nack-requeue redelivers at once; it must be processed, not acked as an in-flight duplicate."""
    published, acks, pid = [], [], uuid.uuid4()

    class Pool:
        calls = 0

        async def fetchrow(self, *a):
            Pool.calls += 1
            if Pool.calls == 1:
                raise ConnectionError("transient")
            return {"id": pid}

        async def execute(self, *a):
            pass

    class Exchange:
        async def publish(self, msg, routing_key):
            published.append(routing_key)

    body = json.dumps({"booking_id": str(uuid.uuid4()), "email": "ada@example.com", "amount_cents": 5}).encode()
    cfg = Config.from_env({"PAYMENT_MIN_DELAY": "0", "PAYMENT_MAX_DELAY": "0", "PAYMENT_SUCCESS_RATE": "1"})
    proc = Processor(cfg, Pool(), Exchange())

    class Msg:
        def __init__(self):
            self.body = body

        async def ack(self):
            acks.append(self)

        async def nack(self, requeue):
            assert requeue
            await proc.handle(Msg())  # the broker redelivers within milliseconds

    asyncio.run(proc.handle(Msg()))
    assert published == ["payment.completed"] and len(acks) == 1 and not proc.inflight


AUTH_ERA_PAYMENTS = """
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL,
  user_id text NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED','REFUNDED')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
"""


def test_schema_migrates_auth_era_payments_and_reruns():
    async def run():
        url = os.environ.get("PAYMENT_TEST_DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres")
        conn = await asyncpg.connect(url)
        try:  # a scratch schema, so SCHEMA (which targets current_schema()) never touches real tables
            await conn.execute("DROP SCHEMA IF EXISTS payment_migration_test CASCADE; CREATE SCHEMA payment_migration_test;"
                               "SET search_path TO payment_migration_test")
            await conn.execute(AUTH_ERA_PAYMENTS)
            b = uuid.uuid4()
            await conn.execute("INSERT INTO payments (booking_id, user_id, amount_cents, status) VALUES ($1, 'u-old', 5, 'SUCCEEDED')", b)
            await conn.execute(SCHEMA)
            await conn.execute(SCHEMA)  # a second boot is a no-op
            rows = await conn.fetch("SELECT * FROM payments")
            assert [(str(r["booking_id"]), to_proto(r).email) for r in rows] == [(str(b), "u-old")]
            assert "user_id" not in rows[0].keys()
        finally:
            await conn.execute("DROP SCHEMA IF EXISTS payment_migration_test CASCADE")
            await conn.close()
    asyncio.run(run())
