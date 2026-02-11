"""
CITADEL — Live Trading Engine

Connects strategies to real broker APIs with:
  - Real-time data processing
  - Risk-checked order routing
  - Position management
  - Portfolio state tracking
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import structlog

from src.core.models import (
    Bar, Tick, Signal, Order, Fill, Position, PortfolioSnapshot,
    Side, OrderType, OrderStatus, AgentAction, EventType, Event,
    KillSwitchLevel, SystemState,
)
from src.core.event_bus.bus import EventBus
from src.core.shm.ring_buffer import SharedMemoryManager
from src.engine.costs import TransactionCostEngine
from src.engine.verify import RiskVerifier
from src.engine.strategies import BaseStrategy

logger = structlog.get_logger(__name__)


class LiveEngine:
    """
    Live trading engine coordinating all system components.
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
        shm_manager: SharedMemoryManager | None = None,
    ):
        self._config = config or {}
        self._event_bus = event_bus or EventBus()
        self._shm = shm_manager
        self._strategies: list[BaseStrategy] = []
        self._risk_verifier = RiskVerifier(self._config.get("risk", {}))
        self._cost_engine = TransactionCostEngine()
        
        # State
        self._system_state = SystemState.INITIALIZING
        self._running = False
        self._cash = self._config.get("initial_capital", 100_000.0)
        self._positions: dict[str, Position] = {}
        self._pending_orders: dict[str, Order] = {}
        self._fills: list[Fill] = []
        self._daily_pnl = 0.0
        self._equity_curve: list[float] = []
        
        # Metrics
        self._ticks_processed = 0
        self._bars_processed = 0
        self._orders_submitted = 0
        self._start_time: float = 0

    @property
    def system_state(self) -> SystemState:
        return self._system_state

    @property
    def is_running(self) -> bool:
        return self._running

    def add_strategy(self, strategy: BaseStrategy) -> None:
        """Register a trading strategy."""
        self._strategies.append(strategy)
        logger.info("engine.strategy_added", strategy=strategy.name)

    async def start(self) -> None:
        """Start the live trading engine."""
        self._running = True
        self._system_state = SystemState.RUNNING
        self._start_time = time.time()

        await self._event_bus.start()

        # Subscribe to events
        self._event_bus.subscribe(EventType.TICK, self._on_tick)
        self._event_bus.subscribe(EventType.BAR, self._on_bar)
        self._event_bus.subscribe(EventType.ORDER_FILLED, self._on_fill)
        self._event_bus.subscribe(EventType.KILL_SWITCH, self._on_kill_switch)

        logger.info("engine.started", strategies=len(self._strategies))

    async def stop(self) -> None:
        """Stop the live trading engine."""
        self._running = False
        self._system_state = SystemState.PAUSED
        await self._event_bus.stop()
        logger.info("engine.stopped", ticks=self._ticks_processed, bars=self._bars_processed)

    async def _on_tick(self, event: Event) -> None:
        """Process incoming tick data."""
        self._ticks_processed += 1
        tick_data = event.payload
        
        # Update position prices
        symbol = tick_data.get("symbol", "")
        price = tick_data.get("last", 0.0)
        
        if symbol in self._positions and price > 0:
            pos = self._positions[symbol]
            unrealized = (price - pos.avg_entry_price) * pos.quantity
            self._positions[symbol] = Position(
                symbol=symbol,
                side=pos.side,
                quantity=pos.quantity,
                avg_entry_price=pos.avg_entry_price,
                current_price=price,
                unrealized_pnl=unrealized,
                realized_pnl=pos.realized_pnl,
                open_timestamp=pos.open_timestamp,
                last_update=datetime.now(timezone.utc),
            )

    async def _on_bar(self, event: Event) -> None:
        """Process incoming bar data and generate signals."""
        self._bars_processed += 1
        bar_data = event.payload
        
        bar = Bar(**bar_data)
        bars = {bar.symbol: bar}

        # Update position price
        if bar.symbol in self._positions:
            pos = self._positions[bar.symbol]
            unrealized = (bar.close - pos.avg_entry_price) * pos.quantity
            self._positions[bar.symbol] = Position(
                symbol=bar.symbol,
                side=pos.side,
                quantity=pos.quantity,
                avg_entry_price=pos.avg_entry_price,
                current_price=bar.close,
                unrealized_pnl=unrealized,
                realized_pnl=pos.realized_pnl,
                open_timestamp=pos.open_timestamp,
                last_update=datetime.now(timezone.utc),
            )

        # Skip signal generation if restricted
        if self._system_state in (SystemState.L1_RESTRICTED, SystemState.L2_RESTRICTED, SystemState.L3_SHUTDOWN):
            return

        # Generate signals from all strategies
        for strategy in self._strategies:
            try:
                signals = strategy.generate_signals(bars, self)
                for signal in signals:
                    await self._process_signal(signal)
            except Exception as e:
                logger.error("engine.strategy_error", strategy=strategy.name, error=str(e))

    async def _process_signal(self, signal: Signal) -> None:
        """Process a trading signal through risk checks and order routing."""
        # Risk verification
        position_values = {
            s: p.market_value for s, p in self._positions.items()
        }
        
        account_value = self.total_equity
        
        is_valid, violations = self._risk_verifier.verify_order(
            symbol=signal.symbol,
            side="BUY" if signal.action in (AgentAction.BUY, AgentAction.SCALE_IN) else "SELL",
            quantity=0,  # Will be calculated
            price=self._positions.get(signal.symbol, Position(
                symbol=signal.symbol, side=Side.BUY, quantity=0,
                avg_entry_price=0, current_price=0
            )).current_price or 100.0,
            account_value=account_value,
            current_positions=position_values,
        )

        if not is_valid:
            logger.warning(
                "engine.signal_blocked",
                symbol=signal.symbol,
                action=signal.action.value,
                violations=violations,
            )
            return

        # Publish signal event
        await self._event_bus.publish(Event(
            event_type=EventType.SIGNAL,
            source=signal.source,
            payload=signal.model_dump(mode="json"),
        ))

    async def _on_fill(self, event: Event) -> None:
        """Process order fill."""
        fill_data = event.payload
        symbol = fill_data.get("symbol", "")
        side = Side(fill_data.get("side", "BUY"))
        quantity = fill_data.get("quantity", 0.0)
        price = fill_data.get("price", 0.0)
        
        logger.info(
            "engine.fill",
            symbol=symbol,
            side=side.value,
            quantity=quantity,
            price=price,
        )

    async def _on_kill_switch(self, event: Event) -> None:
        """Handle kill switch activation."""
        level = event.payload.get("level", "")
        
        if level == "L1_SOFT":
            self._system_state = SystemState.L1_RESTRICTED
            logger.warning("engine.kill_switch_L1", reason=event.payload.get("reason", ""))
        elif level == "L2_HARD":
            self._system_state = SystemState.L2_RESTRICTED
            logger.error("engine.kill_switch_L2", reason=event.payload.get("reason", ""))
        elif level == "L3_NUCLEAR":
            self._system_state = SystemState.L3_SHUTDOWN
            logger.critical("engine.kill_switch_L3", reason=event.payload.get("reason", ""))
            await self.stop()

    @property
    def total_equity(self) -> float:
        positions_value = sum(p.market_value for p in self._positions.values())
        return self._cash + positions_value

    @property
    def positions(self) -> dict[str, Position]:
        return dict(self._positions)

    def snapshot(self) -> PortfolioSnapshot:
        """Create current portfolio snapshot."""
        return PortfolioSnapshot(
            cash=self._cash,
            positions=list(self._positions.values()),
            total_equity=self.total_equity,
            total_unrealized_pnl=sum(p.unrealized_pnl for p in self._positions.values()),
            total_realized_pnl=sum(p.realized_pnl for p in self._positions.values()),
            gross_exposure=sum(abs(p.market_value) for p in self._positions.values()),
            net_exposure=sum(p.market_value for p in self._positions.values()),
            leverage=sum(abs(p.market_value) for p in self._positions.values()) / max(self.total_equity, 1),
            daily_pnl=self._daily_pnl,
        )

    def status(self) -> dict[str, Any]:
        """Get engine status."""
        return {
            "state": self._system_state.value,
            "running": self._running,
            "equity": round(self.total_equity, 2),
            "cash": round(self._cash, 2),
            "positions": len(self._positions),
            "strategies": len(self._strategies),
            "ticks_processed": self._ticks_processed,
            "bars_processed": self._bars_processed,
            "orders_submitted": self._orders_submitted,
            "uptime_s": round(time.time() - self._start_time, 1) if self._start_time else 0,
        }
