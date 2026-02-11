"""
CITADEL — Test Suite: Event Bus & Ring Buffer
"""

import asyncio
import numpy as np
import pytest

from src.core.models import Event, EventType, TICK_DTYPE
from src.core.event_bus.bus import EventBus
from src.core.shm.ring_buffer import RingBuffer


class TestRingBuffer:
    """Test shared memory ring buffer."""

    def test_write_read(self):
        buf = RingBuffer("test_wr", TICK_DTYPE, capacity=64, create=True)
        try:
            record = np.zeros(1, dtype=TICK_DTYPE)
            record[0]["bid"] = 149.9
            record[0]["ask"] = 150.1
            record[0]["volume"] = 1000

            buf.write(record[0])
            result = buf.read()

            assert result is not None
            assert result["bid"] == 149.9
            assert result["ask"] == 150.1
            assert result["volume"] == 1000
        finally:
            buf.close()

    def test_empty_read_returns_none(self):
        buf = RingBuffer("test_empty", TICK_DTYPE, capacity=64, create=True)
        try:
            result = buf.read()
            assert result is None
        finally:
            buf.close()

    def test_batch_write_read(self):
        buf = RingBuffer("test_batch", TICK_DTYPE, capacity=128, create=True)
        try:
            batch = np.zeros(10, dtype=TICK_DTYPE)
            for i in range(10):
                batch[i]["bid"] = float(i * 10)
                batch[i]["ask"] = float(i * 10 + 1)
                batch[i]["volume"] = i * 100

            written = buf.write_batch(batch)
            assert written == 10

            results = buf.read_batch(10)
            assert len(results) == 10
            assert results[0]["bid"] == 0.0
            assert results[9]["bid"] == 90.0
        finally:
            buf.close()

    def test_wraparound(self):
        buf = RingBuffer("test_wrap", TICK_DTYPE, capacity=8, create=True)
        try:
            for i in range(12):
                record = np.zeros(1, dtype=TICK_DTYPE)
                record[0]["bid"] = float(i)
                buf.write(record[0])

            snapshot = buf.get_snapshot()
            assert len(snapshot) > 0
        finally:
            buf.close()

    def test_snapshot(self):
        buf = RingBuffer("test_snap", TICK_DTYPE, capacity=64, create=True)
        try:
            for i in range(5):
                rec = np.zeros(1, dtype=TICK_DTYPE)
                rec[0]["bid"] = float(100 + i)
                buf.write(rec[0])

            snap = buf.get_snapshot()
            assert len(snap) <= 64
        finally:
            buf.close()


class TestEventBus:
    """Test async event bus."""

    @pytest.mark.asyncio
    async def test_publish_subscribe(self):
        bus = EventBus()
        received = []

        async def handler(event: Event):
            received.append(event)

        bus.subscribe(EventType.TICK, handler)
        await bus.start()

        try:
            event = Event(
                event_type=EventType.TICK,
                source="test",
                payload={"symbol": "AAPL", "price": 150.0},
            )
            await bus.publish(event)
            await asyncio.sleep(0.2)

            assert len(received) == 1
            assert received[0].payload["symbol"] == "AAPL"
        finally:
            await bus.stop()

    @pytest.mark.asyncio
    async def test_multiple_subscribers(self):
        bus = EventBus()
        count = {"a": 0, "b": 0}

        async def handler_a(event: Event):
            count["a"] += 1

        async def handler_b(event: Event):
            count["b"] += 1

        bus.subscribe(EventType.SIGNAL, handler_a)
        bus.subscribe(EventType.SIGNAL, handler_b)
        await bus.start()

        try:
            await bus.publish(Event(
                event_type=EventType.SIGNAL,
                source="test",
                payload={},
            ))
            await asyncio.sleep(0.2)

            assert count["a"] == 1
            assert count["b"] == 1
        finally:
            await bus.stop()

    @pytest.mark.asyncio
    async def test_unsubscribed_events_ignored(self):
        bus = EventBus()
        received = []

        async def handler(event: Event):
            received.append(event)

        bus.subscribe(EventType.TICK, handler)
        await bus.start()

        try:
            # Publish a different event type
            await bus.publish(Event(
                event_type=EventType.ORDER_FILLED,
                source="test",
                payload={},
            ))
            await asyncio.sleep(0.2)

            assert len(received) == 0
        finally:
            await bus.stop()
