import asyncio
import json
import random
import uuid

import pytest

from main import Config, Processor, decide, parse_refund, parse_request, refund_requeues


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
    body = json.dumps({"booking_id": b, "user_id": "u", "event_id": "e", "amount_cents": 5}).encode()
    assert parse_request(body) == (b, "u", 5)


@pytest.mark.parametrize("body", [b"not json", b"[]", b"{}", b"[" * 100000, b'{"booking_id":"x","user_id":"u","amount_cents":1}',
                                  json.dumps({"booking_id": str(uuid.uuid4()), "user_id": "u", "amount_cents": "5"}).encode()])
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

    body = json.dumps({"booking_id": str(uuid.uuid4()), "user_id": "u", "amount_cents": 5}).encode()
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
