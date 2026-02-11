"""
CITADEL — Async Event Bus

High-performance asyncio event system with:
  - Type-safe event routing
  - Priority queues
  - Dead letter handling
  - Event persistence (Event Sourcing)
  - Backpressure management
"""

from __future__ import annotations

import asyncio
import time
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

import orjson
import structlog

from src.core.models import Event, EventType

logger = structlog.get_logger(__name__)

# Type alias for event handlers
EventHandler = Callable[[Event], Coroutine[Any, Any, None]]


class EventBus:
    """
    Central event bus for the CITADEL system.
    
    Features:
        - Pub/Sub with async handlers
        - Priority-based event processing
        - Event persistence for sourcing
        - Dead letter queue for failed events
        - Backpressure via bounded queues
        - Wildcard subscriptions
    """

    def __init__(
        self,
        max_queue_size: int = 100_000,
        max_retries: int = 3,
        persist_events: bool = True,
        event_log_path: str = "./data/events",
    ):
        self._handlers: dict[EventType, list[tuple[int, EventHandler]]] = defaultdict(list)
        self._wildcard_handlers: list[tuple[int, EventHandler]] = []
        self._queue: asyncio.PriorityQueue[tuple[int, float, Event]] = asyncio.PriorityQueue(
            maxsize=max_queue_size
        )
        self._running = False
        self._task: asyncio.Task | None = None
        self._max_retries = max_retries
        self._persist = persist_events
        self._event_log_path = event_log_path
        self._dead_letter: list[tuple[Event, str]] = []
        self._sequence_counter = 0
        self._metrics = EventMetrics()

        # Event log file handle
        self._log_file = None

    async def start(self) -> None:
        """Start the event processing loop."""
        if self._running:
            return

        self._running = True

        if self._persist:
            import os
            os.makedirs(self._event_log_path, exist_ok=True)
            log_file = os.path.join(
                self._event_log_path,
                f"events_{datetime.now(timezone.utc).strftime('%Y%m%d')}.jsonl",
            )
            self._log_file = open(log_file, "ab")

        self._task = asyncio.create_task(self._process_loop())
        logger.info("event_bus.started")

    async def stop(self) -> None:
        """Stop the event processing loop and drain remaining events."""
        self._running = False

        if self._task:
            # Process remaining events
            while not self._queue.empty():
                try:
                    _, _, event = self._queue.get_nowait()
                    await self._dispatch(event)
                except asyncio.QueueEmpty:
                    break

            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        if self._log_file:
            self._log_file.close()
            self._log_file = None

        logger.info("event_bus.stopped", metrics=self._metrics.to_dict())

    def subscribe(
        self,
        event_type: EventType | None,
        handler: EventHandler,
        priority: int = 0,
    ) -> None:
        """
        Subscribe a handler to an event type.
        
        Args:
            event_type: Event type to subscribe to, or None for wildcard
            handler: Async callable to handle the event
            priority: Lower = higher priority (0 is highest)
        """
        if event_type is None:
            self._wildcard_handlers.append((priority, handler))
            self._wildcard_handlers.sort(key=lambda x: x[0])
        else:
            self._handlers[event_type].append((priority, handler))
            self._handlers[event_type].sort(key=lambda x: x[0])

        logger.debug(
            "event_bus.subscribed",
            event_type=event_type.value if event_type else "*",
            handler=handler.__qualname__,
        )

    def unsubscribe(self, event_type: EventType | None, handler: EventHandler) -> None:
        """Unsubscribe a handler from an event type."""
        if event_type is None:
            self._wildcard_handlers = [
                (p, h) for p, h in self._wildcard_handlers if h != handler
            ]
        else:
            self._handlers[event_type] = [
                (p, h) for p, h in self._handlers[event_type] if h != handler
            ]

    async def publish(self, event: Event, priority: int = 5) -> None:
        """
        Publish an event to the bus.
        
        Args:
            event: Event to publish
            priority: Queue priority (0 = highest, 9 = lowest)
        """
        self._sequence_counter += 1
        # Use timestamp for FIFO within same priority
        await self._queue.put((priority, time.monotonic(), event))
        self._metrics.total_published += 1

    def publish_sync(self, event: Event, priority: int = 5) -> None:
        """Synchronous publish (for use from non-async contexts)."""
        self._sequence_counter += 1
        try:
            self._queue.put_nowait((priority, time.monotonic(), event))
            self._metrics.total_published += 1
        except asyncio.QueueFull:
            self._dead_letter.append((event, "Queue full"))
            self._metrics.total_dropped += 1

    async def _process_loop(self) -> None:
        """Main event processing loop."""
        while self._running:
            try:
                priority, _, event = await asyncio.wait_for(
                    self._queue.get(), timeout=0.1
                )
                await self._dispatch(event)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("event_bus.process_error", error=str(e))

    async def _dispatch(self, event: Event) -> None:
        """Dispatch event to all matching handlers."""
        start_time = time.perf_counter()
        handlers_called = 0

        # Persist event
        if self._persist and self._log_file:
            try:
                data = orjson.dumps(event.model_dump(mode="json"))
                self._log_file.write(data + b"\n")
            except Exception as e:
                logger.error("event_bus.persist_error", error=str(e))

        # Type-specific handlers
        for priority, handler in self._handlers.get(event.event_type, []):
            await self._call_handler(handler, event)
            handlers_called += 1

        # Wildcard handlers
        for priority, handler in self._wildcard_handlers:
            await self._call_handler(handler, event)
            handlers_called += 1

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        self._metrics.total_processed += 1
        self._metrics.total_latency_ms += elapsed_ms
        if elapsed_ms > self._metrics.max_latency_ms:
            self._metrics.max_latency_ms = elapsed_ms

    async def _call_handler(self, handler: EventHandler, event: Event) -> None:
        """Call a handler with retry logic."""
        for attempt in range(self._max_retries):
            try:
                await handler(event)
                return
            except Exception as e:
                if attempt == self._max_retries - 1:
                    error_msg = f"{handler.__qualname__}: {str(e)}\n{traceback.format_exc()}"
                    self._dead_letter.append((event, error_msg))
                    self._metrics.total_errors += 1
                    logger.error(
                        "event_bus.handler_error",
                        handler=handler.__qualname__,
                        event_type=event.event_type.value,
                        error=str(e),
                        attempt=attempt + 1,
                    )
                else:
                    await asyncio.sleep(0.01 * (attempt + 1))

    def get_dead_letters(self) -> list[tuple[Event, str]]:
        """Get failed events from the dead letter queue."""
        return list(self._dead_letter)

    def clear_dead_letters(self) -> None:
        """Clear the dead letter queue."""
        self._dead_letter.clear()

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    @property
    def metrics(self) -> "EventMetrics":
        return self._metrics


class EventMetrics:
    """Metrics for the event bus."""

    def __init__(self):
        self.total_published: int = 0
        self.total_processed: int = 0
        self.total_errors: int = 0
        self.total_dropped: int = 0
        self.total_latency_ms: float = 0.0
        self.max_latency_ms: float = 0.0

    @property
    def avg_latency_ms(self) -> float:
        if self.total_processed == 0:
            return 0.0
        return self.total_latency_ms / self.total_processed

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_published": self.total_published,
            "total_processed": self.total_processed,
            "total_errors": self.total_errors,
            "total_dropped": self.total_dropped,
            "avg_latency_ms": round(self.avg_latency_ms, 3),
            "max_latency_ms": round(self.max_latency_ms, 3),
        }


class EventStore:
    """
    Event store for Event Sourcing pattern.
    Uses DuckDB for persistent storage and fast replay.
    """

    def __init__(self, db_path: str = "./data/events/events.duckdb"):
        import duckdb
        import os
        
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._db = duckdb.connect(db_path)
        self._init_schema()

    def _init_schema(self) -> None:
        """Initialize the event store schema."""
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                event_type VARCHAR NOT NULL,
                source VARCHAR DEFAULT '',
                payload JSON DEFAULT '{}',
                sequence_number BIGINT NOT NULL
            )
        """)
        self._db.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_type 
            ON events (event_type)
        """)
        self._db.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_timestamp 
            ON events (timestamp)
        """)
        self._db.execute("""
            CREATE SEQUENCE IF NOT EXISTS event_seq START 1
        """)

    async def append(self, event: Event) -> None:
        """Append an event to the store."""
        seq = self._db.execute("SELECT nextval('event_seq')").fetchone()[0]
        self._db.execute(
            """
            INSERT INTO events (id, timestamp, event_type, source, payload, sequence_number)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                event.id,
                event.timestamp.isoformat(),
                event.event_type.value,
                event.source,
                orjson.dumps(event.payload).decode(),
                seq,
            ],
        )

    async def get_events(
        self,
        event_type: EventType | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        source: str | None = None,
        limit: int = 1000,
    ) -> list[Event]:
        """Query events with filters."""
        conditions = []
        params = []

        if event_type:
            conditions.append("event_type = ?")
            params.append(event_type.value)
        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())
        if source:
            conditions.append("source = ?")
            params.append(source)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"""
            SELECT id, timestamp, event_type, source, payload, sequence_number
            FROM events {where}
            ORDER BY sequence_number ASC
            LIMIT {limit}
        """

        rows = self._db.execute(query, params).fetchall()
        events = []
        for row in rows:
            events.append(Event(
                id=row[0],
                timestamp=row[1] if isinstance(row[1], datetime) else datetime.fromisoformat(row[1]),
                event_type=EventType(row[2]),
                source=row[3],
                payload=orjson.loads(row[4]) if isinstance(row[4], str) else row[4],
                sequence_number=row[5],
            ))
        return events

    async def replay(
        self, start: datetime, end: datetime, event_types: list[EventType] | None = None
    ) -> list[Event]:
        """Replay events in a time range for state reconstruction."""
        return await self.get_events(
            start=start, end=end, limit=1_000_000
        )

    async def get_count(self, event_type: EventType | None = None) -> int:
        """Get event count."""
        if event_type:
            result = self._db.execute(
                "SELECT COUNT(*) FROM events WHERE event_type = ?",
                [event_type.value],
            ).fetchone()
        else:
            result = self._db.execute("SELECT COUNT(*) FROM events").fetchone()
        return result[0]

    def close(self) -> None:
        """Close the database connection."""
        self._db.close()
