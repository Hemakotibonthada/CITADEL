"""
CITADEL — Student Agent (Self-Correction & LoRA Fine-Tuning)

The meta-learning agent that improves the system:
  - Nightly post-market analysis (after 5 PM)
  - Replays today's decisions vs actual outcomes
  - Detects alpha decay and model drift
  - Triggers LoRA fine-tuning when performance degrades
  - Adjusts strategy weights based on recent performance
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import numpy as np
import structlog

from src.agents.base import BaseAgent
from src.core.models import (
    AgentDecision, Event, EventType, TrainingResult,
)
from src.core.event_bus.bus import EventBus

logger = structlog.get_logger(__name__)


class StudentAgent(BaseAgent):
    """
    Self-Correction Agent — The learner.
    
    Runs nightly analysis to:
      1. Replay today's decisions vs outcomes
      2. Identify winning/losing patterns
      3. Detect alpha decay (rolling Sharpe deterioration)
      4. Adjust strategy weights dynamically
      5. Trigger LoRA fine-tuning when needed
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
        data_store: Any = None,
        training_engine: Any = None,
    ):
        super().__init__("Student", config, event_bus)
        
        self._data_store = data_store
        self._training_engine = training_engine
        
        # Config
        self._review_hour = self._config.get("review_hour", 17)  # 5 PM
        self._alpha_decay_window = self._config.get("alpha_decay_window", 20)
        self._sharpe_threshold = self._config.get("sharpe_threshold", 0.5)
        self._drift_threshold = self._config.get("drift_threshold", 0.15)
        self._min_trades_for_review = self._config.get("min_trades", 5)
        self._lora_trigger_threshold = self._config.get("lora_threshold", -0.3)
        
        # State
        self._todays_decisions: list[AgentDecision] = []
        self._todays_outcomes: list[dict[str, Any]] = []
        self._performance_history: list[dict[str, Any]] = []
        self._strategy_weights: dict[str, float] = {}
        self._training_results: list[TrainingResult] = []
        self._last_review_date: str | None = None
        self._lessons_learned: list[dict[str, Any]] = []

    async def start(self) -> None:
        """Start with event subscriptions."""
        await super().start()
        
        if self._event_bus:
            self._event_bus.subscribe(EventType.SIGNAL, self._on_signal)
            self._event_bus.subscribe(EventType.ORDER_FILLED, self._on_fill)

    async def _process(self) -> None:
        """Main student processing loop."""
        now = datetime.now(timezone.utc)
        today_str = now.strftime("%Y-%m-%d")
        
        # Check if it's time for nightly review
        is_review_time = (
            now.hour >= self._review_hour
            and self._last_review_date != today_str
        )
        
        if is_review_time:
            logger.info("student.starting_review", date=today_str)
            self._last_review_date = today_str
            
            try:
                await self._run_nightly_review()
            except Exception as e:
                logger.error("student.review_error", error=str(e))
        else:
            await asyncio.sleep(30.0)  # Low-frequency checks

    async def _run_nightly_review(self) -> None:
        """Execute the full nightly review pipeline."""
        
        # ── 1. Replay today's decisions ──────────────────
        replay_results = await self._replay_decisions()
        
        # ── 2. Performance attribution ───────────────────
        attribution = self._analyze_performance(replay_results)
        
        # ── 3. Alpha decay detection ─────────────────────
        alpha_status = self._detect_alpha_decay()
        
        # ── 4. Strategy weight adjustment ─────────────────
        new_weights = self._adjust_strategy_weights(attribution)
        
        # ── 5. Check if LoRA fine-tuning needed ───────────
        should_train = self._should_trigger_training(alpha_status, attribution)
        
        if should_train:
            await self._trigger_lora_training(replay_results)
        
        # ── 6. Generate lessons learned ──────────────────
        lessons = self._generate_lessons(replay_results, attribution, alpha_status)
        self._lessons_learned.extend(lessons)
        
        # ── 7. Publish review results ────────────────────
        review_summary = {
            "date": self._last_review_date,
            "decisions_reviewed": len(replay_results),
            "win_rate": attribution.get("win_rate", 0),
            "avg_pnl": attribution.get("avg_pnl", 0),
            "alpha_status": alpha_status,
            "weights_updated": new_weights != self._strategy_weights,
            "training_triggered": should_train,
            "lessons_count": len(lessons),
        }
        
        if self._event_bus:
            await self._event_bus.publish(Event(
                event_type=EventType.AGENT_STATE,
                source=self._name,
                payload={
                    "type": "nightly_review",
                    **review_summary,
                },
            ))
        
        logger.info("student.review_complete", **review_summary)
        
        # Store review
        self._performance_history.append(review_summary)

    async def _replay_decisions(self) -> list[dict[str, Any]]:
        """Replay today's decisions and compare with outcomes."""
        results = []
        
        for decision in self._todays_decisions:
            # Find matching outcome
            outcome = next(
                (o for o in self._todays_outcomes if o.get("symbol") == decision.symbol),
                None,
            )
            
            if outcome:
                entry_price = outcome.get("entry_price", 0)
                exit_price = outcome.get("exit_price", outcome.get("current_price", 0))
                pnl = (exit_price - entry_price) if decision.action.value == "BUY" else (entry_price - exit_price)
                pnl_pct = (pnl / entry_price * 100) if entry_price > 0 else 0
                
                result = {
                    "symbol": decision.symbol,
                    "action": decision.action.value,
                    "confidence": decision.confidence,
                    "rationale": decision.rationale,
                    "entry_price": entry_price,
                    "exit_price": exit_price,
                    "pnl": pnl,
                    "pnl_pct": pnl_pct,
                    "was_correct": pnl > 0,
                    "chain_of_thought": decision.chain_of_thought,
                }
                results.append(result)
        
        return results

    def _analyze_performance(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        """Analyze day's performance attribution."""
        if not results:
            return {
                "win_rate": 0, "avg_pnl": 0,
                "best_trade": None, "worst_trade": None,
                "by_confidence": {},
            }

        wins = [r for r in results if r["was_correct"]]
        win_rate = len(wins) / len(results)
        pnls = [r["pnl_pct"] for r in results]
        avg_pnl = np.mean(pnls) if pnls else 0

        # Best/worst
        sorted_results = sorted(results, key=lambda r: r["pnl_pct"])
        
        # Performance by confidence bucket
        confidence_buckets: dict[str, list[float]] = {
            "low (0.5-0.7)": [],
            "medium (0.7-0.85)": [],
            "high (0.85-1.0)": [],
        }
        for r in results:
            c = r["confidence"]
            if c < 0.7:
                confidence_buckets["low (0.5-0.7)"].append(r["pnl_pct"])
            elif c < 0.85:
                confidence_buckets["medium (0.7-0.85)"].append(r["pnl_pct"])
            else:
                confidence_buckets["high (0.85-1.0)"].append(r["pnl_pct"])

        by_confidence = {
            k: float(np.mean(v)) if v else 0
            for k, v in confidence_buckets.items()
        }

        return {
            "win_rate": float(win_rate),
            "avg_pnl": float(avg_pnl),
            "total_pnl": float(sum(pnls)),
            "best_trade": sorted_results[-1] if sorted_results else None,
            "worst_trade": sorted_results[0] if sorted_results else None,
            "by_confidence": by_confidence,
            "num_trades": len(results),
        }

    def _detect_alpha_decay(self) -> dict[str, Any]:
        """Detect if strategy alpha is decaying."""
        if len(self._performance_history) < self._alpha_decay_window:
            return {"status": "INSUFFICIENT_DATA", "rolling_sharpe": 0}

        # Rolling Sharpe ratio
        recent = self._performance_history[-self._alpha_decay_window:]
        returns = [day.get("avg_pnl", 0) for day in recent]
        
        mean_ret = np.mean(returns)
        std_ret = np.std(returns) if np.std(returns) > 0 else 0.001
        rolling_sharpe = mean_ret / std_ret * np.sqrt(252)

        # Model drift: compare first half vs second half
        half = len(returns) // 2
        first_half_mean = np.mean(returns[:half])
        second_half_mean = np.mean(returns[half:])
        drift = second_half_mean - first_half_mean

        status = "HEALTHY"
        if rolling_sharpe < self._sharpe_threshold:
            status = "DECAYING"
        if abs(drift) > self._drift_threshold:
            status = "DRIFTING"

        return {
            "status": status,
            "rolling_sharpe": float(rolling_sharpe),
            "drift": float(drift),
            "first_half_avg": float(first_half_mean),
            "second_half_avg": float(second_half_mean),
        }

    def _adjust_strategy_weights(
        self, attribution: dict[str, Any]
    ) -> dict[str, float]:
        """Adjust strategy weights based on performance."""
        if not self._strategy_weights:
            self._strategy_weights = {
                "mean_reversion": 0.25,
                "momentum": 0.25,
                "stat_arb": 0.25,
                "multi_factor": 0.25,
            }
        
        # Simple exponential smoothing of weights based on strategy-level P&L
        # Without per-strategy attribution, apply uniform updates
        win_rate = attribution.get("win_rate", 0.5)
        
        if win_rate > 0.6:
            # Boost confidence — maintain current weights
            pass
        elif win_rate < 0.4:
            # Poor performance — shift towards more conservative strategies
            alpha = 0.1
            self._strategy_weights["mean_reversion"] += alpha
            self._strategy_weights["momentum"] -= alpha / 3
            self._strategy_weights["stat_arb"] += alpha / 3
            self._strategy_weights["multi_factor"] -= alpha / 3
        
        # Normalize
        total = sum(self._strategy_weights.values())
        if total > 0:
            self._strategy_weights = {
                k: v / total for k, v in self._strategy_weights.items()
            }
        
        # Publish weight update
        if self._event_bus:
            asyncio.create_task(self._event_bus.publish(Event(
                event_type=EventType.AGENT_STATE,
                source=self._name,
                payload={
                    "type": "weights_updated",
                    "weights": self._strategy_weights,
                },
            )))
        
        return dict(self._strategy_weights)

    def _should_trigger_training(
        self, alpha_status: dict[str, Any], attribution: dict[str, Any]
    ) -> bool:
        """Determine if LoRA fine-tuning should be triggered."""
        if alpha_status.get("status") == "INSUFFICIENT_DATA":
            return False
        
        # Trigger if alpha is decaying or drifting
        if alpha_status.get("status") in ("DECAYING", "DRIFTING"):
            return True
        
        # Trigger if rolling Sharpe drops below threshold
        if alpha_status.get("rolling_sharpe", 1.0) < self._lora_trigger_threshold:
            return True
        
        # Trigger if win rate drops significantly
        if attribution.get("win_rate", 0.5) < 0.35 and attribution.get("num_trades", 0) >= self._min_trades_for_review:
            return True
        
        return False

    async def _trigger_lora_training(
        self, replay_results: list[dict[str, Any]]
    ) -> None:
        """Trigger LoRA fine-tuning with recent data."""
        logger.info(
            "student.triggering_lora",
            num_samples=len(replay_results),
        )
        
        if not self._training_engine:
            logger.warning("student.no_training_engine")
            return
        
        # Build training dataset from replay
        training_data = []
        for result in replay_results:
            if result["was_correct"]:
                # Reinforce correct decisions
                training_data.append({
                    "input": result.get("chain_of_thought", ""),
                    "output": f'{{"action": "{result["action"]}", "confidence": {result["confidence"]:.2f}}}',
                    "label": 1,
                })
            else:
                # Learn from mistakes — reverse the action
                opposite = "SELL" if result["action"] == "BUY" else (
                    "BUY" if result["action"] == "SELL" else "HOLD"
                )
                training_data.append({
                    "input": result.get("chain_of_thought", ""),
                    "output": f'{{"action": "{opposite}", "confidence": 0.5}}',
                    "label": 0,
                })
        
        if training_data:
            try:
                result = await self._training_engine.train(training_data)
                self._training_results.append(result)
                
                logger.info(
                    "student.lora_complete",
                    loss=result.final_loss,
                    samples=result.samples_trained,
                )
            except Exception as e:
                logger.error("student.lora_error", error=str(e))

    def _generate_lessons(
        self,
        replay: list[dict[str, Any]],
        attribution: dict[str, Any],
        alpha_status: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Generate lessons learned from today's trading."""
        lessons = []
        now = datetime.now(timezone.utc).isoformat()
        
        # Lesson from overall performance
        win_rate = attribution.get("win_rate", 0)
        if replay:
            lessons.append({
                "timestamp": now,
                "category": "performance",
                "lesson": (
                    f"Day review: {len(replay)} trades, "
                    f"{win_rate*100:.0f}% win rate, "
                    f"avg P&L {attribution.get('avg_pnl', 0):.2f}%"
                ),
                "severity": "INFO" if win_rate > 0.5 else "WARNING",
            })
        
        # Confidence calibration lesson
        by_conf = attribution.get("by_confidence", {})
        for bucket, avg_pnl in by_conf.items():
            if "high" in bucket and avg_pnl < 0:
                lessons.append({
                    "timestamp": now,
                    "category": "calibration",
                    "lesson": (
                        f"Overconfidence detected: high-confidence trades "
                        f"averaged {avg_pnl:.2f}% — recalibrate"
                    ),
                    "severity": "WARNING",
                })
            elif "low" in bucket and avg_pnl > 0.5:
                lessons.append({
                    "timestamp": now,
                    "category": "calibration",
                    "lesson": (
                        f"Under-confidence detected: low-confidence trades "
                        f"averaged {avg_pnl:.2f}% — consider raising bets"
                    ),
                    "severity": "INFO",
                })
        
        # Alpha decay lesson
        status = alpha_status.get("status", "UNKNOWN")
        if status == "DECAYING":
            lessons.append({
                "timestamp": now,
                "category": "alpha_decay",
                "lesson": (
                    f"Alpha decay detected: rolling Sharpe = "
                    f"{alpha_status.get('rolling_sharpe', 0):.2f}. "
                    f"Consider strategy rotation."
                ),
                "severity": "CRITICAL",
            })
        elif status == "DRIFTING":
            lessons.append({
                "timestamp": now,
                "category": "model_drift",
                "lesson": (
                    f"Model drift: performance shift = "
                    f"{alpha_status.get('drift', 0):.3f}. "
                    f"Market regime may have changed."
                ),
                "severity": "WARNING",
            })
        
        # Worst trade lesson
        worst = attribution.get("worst_trade")
        if worst and worst.get("pnl_pct", 0) < -2:
            lessons.append({
                "timestamp": now,
                "category": "loss_analysis",
                "lesson": (
                    f"Large loss on {worst['symbol']}: {worst['pnl_pct']:.2f}%. "
                    f"Reason: {worst.get('rationale', 'Unknown')[:100]}"
                ),
                "severity": "WARNING",
            })
        
        return lessons

    async def _on_signal(self, event: Event) -> None:
        """Capture decisions for review."""
        payload = event.payload
        if payload.get("source") == "Tactician":
            from src.core.models import AgentAction
            try:
                decision = AgentDecision(
                    agent_name=payload.get("source", ""),
                    action=AgentAction(payload.get("action", "HOLD")),
                    symbol=payload.get("symbol", ""),
                    confidence=payload.get("confidence", 0.5),
                    size_pct=payload.get("size_pct", 0),
                    rationale=payload.get("rationale", ""),
                )
                self._todays_decisions.append(decision)
            except Exception:
                pass

    async def _on_fill(self, event: Event) -> None:
        """Capture fill outcomes."""
        self._todays_outcomes.append(event.payload)

    def get_lessons(self, category: str | None = None) -> list[dict[str, Any]]:
        """Get lessons learned, optionally filtered by category."""
        if category:
            return [l for l in self._lessons_learned if l.get("category") == category]
        return list(self._lessons_learned)

    def get_strategy_weights(self) -> dict[str, float]:
        """Get current strategy weights."""
        return dict(self._strategy_weights)

    def get_training_history(self) -> list[dict[str, Any]]:
        """Get LoRA training history."""
        return [
            {
                "timestamp": tr.timestamp.isoformat(),
                "loss": tr.final_loss,
                "samples": tr.samples_trained,
            }
            for tr in self._training_results
        ]
