"""
CITADEL — Agent Base Class

Common functionality for all agents in the swarm:
  - Lifecycle management (start/stop/heartbeat)
  - Shared memory access
  - Event bus integration
  - Health monitoring
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

import structlog

from src.core.models import Event, EventType
from src.core.event_bus.bus import EventBus

logger = structlog.get_logger(__name__)


class BaseAgent(ABC):
    """
    Base class for all CITADEL agents.
    
    Provides:
      - Async lifecycle (start/stop)
      - Heartbeat monitoring
      - Event bus integration
      - Performance metrics
    """

    def __init__(
        self,
        name: str,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
    ):
        self._name = name
        self._config = config or {}
        self._event_bus = event_bus
        self._running = False
        self._alive = False
        self._last_heartbeat = 0.0
        self._heartbeat_interval = self._config.get("heartbeat_interval_ms", 1000) / 1000.0
        self._start_time = 0.0
        self._errors: list[dict[str, Any]] = []
        self._metrics = AgentMetrics()
        self._task: asyncio.Task | None = None

    @property
    def name(self) -> str:
        return self._name

    @property
    def is_alive(self) -> bool:
        return self._alive

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def uptime(self) -> float:
        if self._start_time == 0:
            return 0.0
        return time.time() - self._start_time

    async def start(self) -> None:
        """Start the agent."""
        if self._running:
            return

        self._running = True
        self._alive = True
        self._start_time = time.time()
        self._last_heartbeat = time.time()

        logger.info(f"agent.started", agent=self._name)

        # Start the main loop
        self._task = asyncio.create_task(self._run_loop())

        # Publish start event
        if self._event_bus:
            await self._event_bus.publish(Event(
                event_type=EventType.AGENT_STATE,
                source=self._name,
                payload={"state": "started"},
            ))

    async def stop(self) -> None:
        """Stop the agent gracefully."""
        self._running = False
        self._alive = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        logger.info(
            f"agent.stopped",
            agent=self._name,
            uptime=f"{self.uptime:.1f}s",
            errors=len(self._errors),
        )

        if self._event_bus:
            await self._event_bus.publish(Event(
                event_type=EventType.AGENT_STATE,
                source=self._name,
                payload={"state": "stopped"},
            ))

    async def heartbeat(self) -> bool:
        """Check agent health and return status."""
        self._last_heartbeat = time.time()
        
        if self._event_bus:
            await self._event_bus.publish(Event(
                event_type=EventType.HEARTBEAT,
                source=self._name,
                payload={
                    "alive": self._alive,
                    "uptime": self.uptime,
                    "errors": len(self._errors),
                },
            ), priority=0)

        return self._alive

    async def _run_loop(self) -> None:
        """Main agent loop — subclasses implement _process."""
        while self._running:
            try:
                start = time.perf_counter()
                await self._process()
                elapsed = (time.perf_counter() - start) * 1000
                self._metrics.total_cycles += 1
                self._metrics.total_latency_ms += elapsed
                if elapsed > self._metrics.max_latency_ms:
                    self._metrics.max_latency_ms = elapsed
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._errors.append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "error": str(e),
                })
                self._metrics.total_errors += 1
                logger.error(f"agent.error", agent=self._name, error=str(e))
                await asyncio.sleep(1.0)  # Back off on error

    @abstractmethod
    async def _process(self) -> None:
        """Main processing step — implemented by subclasses."""
        ...

    def status(self) -> dict[str, Any]:
        """Get agent status."""
        return {
            "name": self._name,
            "alive": self._alive,
            "running": self._running,
            "uptime_s": round(self.uptime, 1),
            "last_heartbeat": self._last_heartbeat,
            "errors": len(self._errors),
            "metrics": self._metrics.to_dict(),
        }


class AgentMetrics:
    """Performance metrics for an agent."""

    def __init__(self):
        self.total_cycles: int = 0
        self.total_errors: int = 0
        self.total_latency_ms: float = 0.0
        self.max_latency_ms: float = 0.0

    @property
    def avg_latency_ms(self) -> float:
        if self.total_cycles == 0:
            return 0.0
        return self.total_latency_ms / self.total_cycles

    def to_dict(self) -> dict[str, Any]:
        return {
            "cycles": self.total_cycles,
            "errors": self.total_errors,
            "avg_latency_ms": round(self.avg_latency_ms, 3),
            "max_latency_ms": round(self.max_latency_ms, 3),
        }
