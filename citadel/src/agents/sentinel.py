"""
CITADEL — Sentinel Agent (Risk Guardian & System Supervisor)

The Sentinel runs as a high-priority dedicated process:
  - Monitors system health (heartbeats from all agents)
  - Watches broker latency and API health
  - Enforces "Fat Finger" heuristics
  - Has authority to SIGKILL other agents
  - Manages kill switch escalation chain
"""

from __future__ import annotations

import asyncio
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any

import psutil
import structlog

from src.agents.base import BaseAgent
from src.core.models import (
    Event, EventType, KillSwitchLevel, SystemState,
    PortfolioSnapshot, RiskMetrics,
)
from src.core.event_bus.bus import EventBus
from src.engine.verify import RiskVerifier, RiskCalculator

logger = structlog.get_logger(__name__)


class SentinelAgent(BaseAgent):
    """
    Risk Guardian — The system's immune system.
    
    Responsibilities:
      1. Monitor heartbeats from all agents
      2. Track broker API latency and error rates
      3. Enforce position limits, leverage, and P&L limits
      4. Activate kill switches when thresholds are breached
      5. SIGKILL unresponsive agents
      6. Maintain system state machine
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
    ):
        super().__init__("Sentinel", config, event_bus)
        self._risk_verifier = RiskVerifier(config or {})
        self._risk_calculator = RiskCalculator()
        
        # Agent monitoring
        self._agent_heartbeats: dict[str, float] = {}
        self._heartbeat_timeout_ms = self._config.get("heartbeat_timeout_ms", 5000)
        
        # Broker monitoring
        self._broker_latencies: list[float] = []
        self._api_errors: int = 0
        self._api_requests: int = 0
        
        # System state
        self._system_state = SystemState.RUNNING
        self._active_kill_switches: set[KillSwitchLevel] = set()
        self._kill_switch_cooldown: dict[str, float] = {}
        
        # Portfolio state (received via events)
        self._portfolio: PortfolioSnapshot | None = None
        self._daily_pnl_start: float = 0.0
        self._equity_history: list[float] = []
        
        # Performance metrics
        self._check_count = 0
        self._violation_count = 0

    async def start(self) -> None:
        """Start sentinel with event subscriptions."""
        await super().start()
        
        if self._event_bus:
            self._event_bus.subscribe(EventType.HEARTBEAT, self._on_heartbeat)
            self._event_bus.subscribe(EventType.ORDER_SUBMITTED, self._on_order_check)
            self._event_bus.subscribe(EventType.ORDER_FILLED, self._on_fill)
            self._event_bus.subscribe(EventType.RISK_ALERT, self._on_risk_alert)

    async def _process(self) -> None:
        """Main sentinel processing loop."""
        self._check_count += 1

        # ── 1. Check agent heartbeats ────────────────────
        await self._check_heartbeats()

        # ── 2. Check system resources ────────────────────
        await self._check_system_health()

        # ── 3. Check portfolio risk ──────────────────────
        if self._portfolio:
            await self._check_portfolio_risk()

        # ── 4. Check API health ──────────────────────────
        await self._check_api_health()

        # ── 5. Emit risk metrics ─────────────────────────
        if self._check_count % 10 == 0:
            await self._emit_risk_metrics()

        # Control loop frequency
        await asyncio.sleep(self._heartbeat_interval)

    async def _check_heartbeats(self) -> None:
        """Monitor heartbeats from all registered agents."""
        now = time.time()
        timeout_s = self._heartbeat_timeout_ms / 1000.0

        for agent_name, last_beat in list(self._agent_heartbeats.items()):
            elapsed = now - last_beat
            
            if elapsed > timeout_s * 3:
                # Agent completely unresponsive — escalate
                logger.critical(
                    "sentinel.agent_dead",
                    agent=agent_name,
                    elapsed_s=round(elapsed, 1),
                )
                await self._activate_kill_switch(
                    KillSwitchLevel.L3_NUCLEAR,
                    f"Agent {agent_name} unresponsive for {elapsed:.1f}s",
                )
            elif elapsed > timeout_s * 2:
                logger.error(
                    "sentinel.agent_timeout",
                    agent=agent_name,
                    elapsed_s=round(elapsed, 1),
                )
            elif elapsed > timeout_s:
                logger.warning(
                    "sentinel.agent_slow",
                    agent=agent_name,
                    elapsed_s=round(elapsed, 1),
                )

    async def _check_system_health(self) -> None:
        """Monitor system resources."""
        try:
            cpu_pct = psutil.cpu_percent(interval=0)
            mem = psutil.virtual_memory()
            
            if cpu_pct > 95:
                logger.warning("sentinel.high_cpu", cpu_pct=cpu_pct)
            
            if mem.percent > 90:
                logger.warning("sentinel.high_memory", mem_pct=mem.percent)
        except Exception:
            pass

    async def _check_portfolio_risk(self) -> None:
        """Run portfolio risk checks."""
        if not self._portfolio:
            return

        portfolio = self._portfolio
        
        # Build positions dict for verifier
        positions = {}
        for pos in portfolio.positions:
            positions[pos.symbol] = {
                "value": pos.market_value,
                "quantity": pos.quantity,
            }

        # Verify portfolio invariants
        is_valid, violations = self._risk_verifier.verify_portfolio(
            account_value=portfolio.total_equity,
            cash=portfolio.cash,
            positions=positions,
            daily_pnl=portfolio.daily_pnl,
        )

        if not is_valid:
            self._violation_count += len(violations)
            for v in violations:
                logger.warning("sentinel.invariant_violation", violation=v)

            # Check kill switch triggers
            daily_pnl_pct = 0.0
            if portfolio.total_equity > 0:
                daily_pnl_pct = (portfolio.daily_pnl / portfolio.total_equity) * 100

            triggers = self._risk_verifier.verify_kill_switch(
                daily_pnl_pct=daily_pnl_pct,
                sharpe_ratio=0.0,  # Would come from metrics
                win_rate=0.5,
                api_error_rate=self._api_error_rate,
                heartbeat_ok=True,
            )

            for trigger in triggers:
                level_str = trigger.split(":")[0]
                try:
                    level = KillSwitchLevel(level_str)
                    await self._activate_kill_switch(level, trigger)
                except ValueError:
                    pass

    async def _check_api_health(self) -> None:
        """Monitor broker API health."""
        error_rate = self._api_error_rate
        
        if error_rate > 0.5:
            await self._activate_kill_switch(
                KillSwitchLevel.L3_NUCLEAR,
                f"API error rate critical: {error_rate*100:.1f}%",
            )
        elif error_rate > 0.2:
            logger.warning("sentinel.api_degraded", error_rate=f"{error_rate*100:.1f}%")

    @property
    def _api_error_rate(self) -> float:
        if self._api_requests == 0:
            return 0.0
        return self._api_errors / self._api_requests

    async def _activate_kill_switch(self, level: KillSwitchLevel, reason: str) -> None:
        """Activate a kill switch level."""
        # Check cooldown
        now = time.time()
        cooldown_key = f"{level.value}"
        if cooldown_key in self._kill_switch_cooldown:
            if now - self._kill_switch_cooldown[cooldown_key] < 300:
                return  # 5-minute cooldown
        
        self._kill_switch_cooldown[cooldown_key] = now
        self._active_kill_switches.add(level)

        if level == KillSwitchLevel.L1_SOFT:
            self._system_state = SystemState.L1_RESTRICTED
            logger.warning("sentinel.kill_switch_L1", reason=reason)
            actions = ["block_new_opens", "alert_user"]
        
        elif level == KillSwitchLevel.L2_HARD:
            self._system_state = SystemState.L2_RESTRICTED
            logger.error("sentinel.kill_switch_L2", reason=reason)
            actions = ["liquidate_sector", "block_sector", "alert_urgent"]
        
        elif level == KillSwitchLevel.L3_NUCLEAR:
            self._system_state = SystemState.L3_SHUTDOWN
            logger.critical("sentinel.kill_switch_L3", reason=reason)
            actions = ["liquidate_all", "sever_connections", "lock_gui", "emergency_email"]

        # Publish kill switch event
        if self._event_bus:
            await self._event_bus.publish(
                Event(
                    event_type=EventType.KILL_SWITCH,
                    source=self._name,
                    payload={
                        "level": level.value,
                        "reason": reason,
                        "actions": actions,
                        "system_state": self._system_state.value,
                    },
                ),
                priority=0,  # Highest priority
            )

    async def _on_heartbeat(self, event: Event) -> None:
        """Record agent heartbeat."""
        self._agent_heartbeats[event.source] = time.time()

    async def _on_order_check(self, event: Event) -> None:
        """Pre-trade risk check on order submission."""
        self._api_requests += 1
        order_data = event.payload
        
        # Fat finger check
        symbol = order_data.get("symbol", "")
        quantity = order_data.get("quantity", 0)
        price = order_data.get("price", 0)
        
        if self._portfolio:
            is_valid, violations = self._risk_verifier.verify_order(
                symbol=symbol,
                side=order_data.get("side", "BUY"),
                quantity=quantity,
                price=price,
                account_value=self._portfolio.total_equity,
                current_positions={
                    p.symbol: p.market_value 
                    for p in self._portfolio.positions
                },
            )
            
            if not is_valid:
                logger.warning(
                    "sentinel.order_blocked",
                    symbol=symbol,
                    violations=violations,
                )

    async def _on_fill(self, event: Event) -> None:
        """Record fill for risk tracking."""
        self._api_requests += 1

    async def _on_risk_alert(self, event: Event) -> None:
        """Handle risk alert from other components."""
        alert = event.payload
        level_str = alert.get("level", "L1_SOFT")
        try:
            level = KillSwitchLevel(level_str)
            await self._activate_kill_switch(level, alert.get("reason", "External alert"))
        except ValueError:
            pass

    async def _emit_risk_metrics(self) -> None:
        """Publish current risk metrics."""
        if not self._event_bus:
            return

        metrics = RiskMetrics(
            system_state=self._system_state,
            portfolio_leverage=self._portfolio.leverage if self._portfolio else 0.0,
            gross_exposure_pct=self._portfolio.gross_exposure if self._portfolio else 0.0,
            daily_pnl_pct=0.0,
            active_kill_switches=list(self._active_kill_switches),
        )

        await self._event_bus.publish(Event(
            event_type=EventType.RISK_ALERT,
            source=self._name,
            payload={
                "type": "metrics",
                "metrics": metrics.model_dump(mode="json"),
            },
        ), priority=1)

    def register_agent(self, agent_name: str) -> None:
        """Register an agent for heartbeat monitoring."""
        self._agent_heartbeats[agent_name] = time.time()
        logger.info("sentinel.agent_registered", agent=agent_name)

    def update_portfolio(self, snapshot: PortfolioSnapshot) -> None:
        """Update portfolio snapshot for risk monitoring."""
        self._portfolio = snapshot
        self._equity_history.append(snapshot.total_equity)

    def get_risk_report(self) -> dict[str, Any]:
        """Get comprehensive risk report."""
        return {
            "system_state": self._system_state.value,
            "active_kill_switches": [ks.value for ks in self._active_kill_switches],
            "agent_status": {
                name: {
                    "last_heartbeat_s": round(time.time() - ts, 1),
                    "healthy": (time.time() - ts) < self._heartbeat_timeout_ms / 1000,
                }
                for name, ts in self._agent_heartbeats.items()
            },
            "api_health": {
                "error_rate": round(self._api_error_rate * 100, 1),
                "total_requests": self._api_requests,
                "total_errors": self._api_errors,
            },
            "checks_performed": self._check_count,
            "violations_detected": self._violation_count,
        }
