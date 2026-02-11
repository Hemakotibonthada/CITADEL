"""
CITADEL — Test Suite: Strategies, Costs & Portfolio
"""

import numpy as np
import pytest
from datetime import datetime, timezone, timedelta

from src.core.models import Bar, Signal, AgentAction, Side
from src.engine.strategies import (
    MeanReversionStrategy, MomentumStrategy,
    MultiFactorStrategy,
)
from src.engine.costs import (
    ZeroCommission, PerShareCommission, FixedSlippage,
    TransactionCostEngine,
)
from src.engine.backtest import Portfolio

NOW = datetime.now(timezone.utc)


class TestStrategies:
    """Test trading strategy implementations."""

    def _make_bar(self, price: float, symbol: str = "AAPL", idx: int = 0) -> Bar:
        return Bar(
            symbol=symbol,
            timestamp=NOW + timedelta(minutes=idx),
            timeframe="1m",
            open=price * 0.99,
            high=price * 1.01,
            low=price * 0.98,
            close=price,
            volume=100000,
        )

    def test_mean_reversion_runs(self):
        """Strategy should accept bars and return signal list."""
        strategy = MeanReversionStrategy(config={
            "lookback_periods": 20,
            "entry_z_score": -2.0,
            "exit_z_score": 0.0,
        })

        # Feed 30 bars to build history, then check the last call
        prices = [100.0] * 25 + [90.0, 85.0, 80.0]
        for i, p in enumerate(prices):
            bar = self._make_bar(p, idx=i)
            signals = strategy.generate_signals({"AAPL": bar}, None)
            assert isinstance(signals, list)

    def test_momentum_runs(self):
        """Strategy should accept bars and return signal list."""
        strategy = MomentumStrategy(config={
            "fast_period": 5,
            "slow_period": 20,
            "rsi_period": 14,
        })

        prices = [100.0 + i * 2 for i in range(30)]
        for i, p in enumerate(prices):
            bar = self._make_bar(p, idx=i)
            signals = strategy.generate_signals({"AAPL": bar}, None)
            assert isinstance(signals, list)

    def test_multi_factor_runs(self):
        """Multi-factor strategy should combine signals."""
        strategy = MultiFactorStrategy(config={
            "strategies": {
                "mean_reversion": {"weight": 0.5},
                "momentum": {"weight": 0.5},
            },
        })

        prices = [100.0 + np.sin(i * 0.5) * 5 for i in range(50)]
        for i, p in enumerate(prices):
            bar = self._make_bar(float(p), idx=i)
            signals = strategy.generate_signals({"AAPL": bar}, None)
            assert isinstance(signals, list)


class TestCostModels:
    """Test transaction cost models."""

    def test_zero_commission(self):
        comm = ZeroCommission()
        assert comm.calculate(100, 150.0, "BUY") == 0.0

    def test_per_share_commission(self):
        comm = PerShareCommission(rate_per_share=0.01, min_per_order=1.0)
        cost = comm.calculate(100, 150.0, "BUY")
        assert cost == max(100 * 0.01, 1.0)

    def test_fixed_slippage(self):
        slip = FixedSlippage(bps=5)
        estimated = slip.estimate(150.0, 100, "BUY")
        assert estimated > 0  # Slippage is positive

    def test_cost_engine(self):
        engine = TransactionCostEngine()
        result = engine.calculate_total_cost(150.0, 100, "BUY")
        assert isinstance(result, dict)
        assert "total_cost" in result
        assert result["total_cost"] >= 0


class TestPortfolio:
    """Test portfolio management."""

    def test_initial_state(self):
        port = Portfolio(initial_capital=100000.0)
        snap = port.snapshot()
        assert snap.total_equity == 100000.0
        assert snap.cash == 100000.0
        assert len(snap.positions) == 0

    def test_buy_position(self):
        port = Portfolio(initial_capital=100000.0)
        port.execute_order("AAPL", Side.BUY, 100, 150.0, commission=1.0)

        snap = port.snapshot()
        assert snap.cash < 100000.0
        assert len(snap.positions) == 1

    def test_sell_position(self):
        port = Portfolio(initial_capital=100000.0)

        # Buy
        port.execute_order("AAPL", Side.BUY, 100, 150.0, commission=1.0)
        # Sell
        port.execute_order("AAPL", Side.SELL, 100, 160.0, commission=1.0)

        snap = port.snapshot()
        # Should have profit: (160-150)*100 - 2 commissions = ~998
        assert snap.cash > 100000.0 - 5
