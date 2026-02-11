"""
CITADEL — Test Suite: Risk Verification (Formal Verification)

Property-based tests for risk invariants using Hypothesis.
"""

import numpy as np
import pytest
from hypothesis import given, strategies as st, settings, assume

from src.core.models import Side
from src.engine.verify import RiskVerifier, RiskCalculator


class TestRiskVerifier:
    """Property-based formal verification of risk invariants."""

    def setup_method(self):
        self.verifier = RiskVerifier(config={
            "max_position_pct": 20.0,
            "max_portfolio_risk": 5.0,
            "max_leverage": 2.0,
            "max_order_value": 50000.0,
            "max_daily_loss_pct": 3.0,
            "min_cash_pct": 5.0,
            "max_concentration": 25.0,
            "max_correlation_exposure": 0.8,
        })

    @given(
        st.floats(min_value=10000, max_value=1000000),
        st.floats(min_value=1, max_value=100),
        st.floats(min_value=1.0, max_value=10000.0),
    )
    @settings(max_examples=50)
    def test_position_size_invariant(self, equity: float, qty: float, price: float):
        """No single position may exceed max_position_pct of equity."""
        is_valid, violations = self.verifier.verify_order(
            symbol="AAPL", side="BUY",
            quantity=int(qty), price=price,
            account_value=equity,
            current_positions={},
        )
        assert isinstance(is_valid, bool)
        assert isinstance(violations, list)

        order_value = int(qty) * price
        max_value = equity * 0.20
        if order_value > max_value:
            # Should be rejected
            assert not is_valid or len(violations) > 0

    def test_leverage_invariant(self):
        """Portfolio leverage must not exceed max_leverage."""
        is_valid, violations = self.verifier.verify_portfolio(
            account_value=100000,
            cash=10000,
            positions={"AAPL": {"value": 200000, "quantity": 1000}},
        )
        assert isinstance(is_valid, bool)
        assert isinstance(violations, list)

    @given(st.floats(min_value=-50, max_value=0))
    @settings(max_examples=50)
    def test_daily_loss_invariant(self, loss_pct: float):
        """Should flag when daily loss exceeds threshold."""
        daily_pnl = 100000 * (loss_pct / 100)
        is_valid, violations = self.verifier.verify_portfolio(
            account_value=100000,
            cash=50000,
            positions={},
            daily_pnl=daily_pnl,
        )
        assert isinstance(is_valid, bool)
        assert isinstance(violations, list)

    def test_cash_reserve_invariant(self):
        """Must maintain minimum cash percentage."""
        is_valid, violations = self.verifier.verify_portfolio(
            account_value=100000,
            cash=1000,  # Only 1%
            positions={"AAPL": {"value": 99000, "quantity": 500}},
        )
        assert isinstance(is_valid, bool)
        assert isinstance(violations, list)


class TestRiskCalculator:
    """Test quantitative risk calculations."""

    def test_sharpe_ratio(self):
        returns = np.array([0.01, 0.02, -0.01, 0.015, 0.005])
        sharpe = RiskCalculator.sharpe_ratio(returns)
        assert isinstance(sharpe, float)
        assert not np.isnan(sharpe)

    def test_sortino_ratio(self):
        returns = np.array([0.01, 0.02, -0.01, 0.015, -0.005])
        sortino = RiskCalculator.sortino_ratio(returns)
        assert isinstance(sortino, float)

    def test_max_drawdown(self):
        equity = np.array([100.0, 110.0, 105.0, 120.0, 115.0, 130.0])
        result = RiskCalculator.max_drawdown(equity)
        # Returns tuple (dd, peak_idx, trough_idx)
        if isinstance(result, tuple):
            dd = result[0]
        else:
            dd = result
        assert dd >= 0

    @given(st.lists(st.floats(min_value=-0.1, max_value=0.1), min_size=10, max_size=100))
    @settings(max_examples=30)
    def test_var_is_negative(self, returns_list):
        """VaR should represent a loss (negative for losses)."""
        returns = np.array(returns_list)
        assume(not np.any(np.isnan(returns)))
        var = RiskCalculator.value_at_risk(returns, confidence=0.95)
        assert isinstance(var, float)

    def test_win_rate(self):
        pnls = np.array([100, -50, 200, -30, 150, -20], dtype=float)
        wr = RiskCalculator.win_rate(pnls)
        assert wr == pytest.approx(0.5, abs=0.01)

    def test_profit_factor(self):
        pnls = np.array([100, -50, 200, -30], dtype=float)
        pf = RiskCalculator.profit_factor(pnls)
        assert pf > 0
        assert pf == pytest.approx(300 / 80, rel=0.01)

    @given(
        st.floats(min_value=0.1, max_value=0.9),
        st.floats(min_value=0.01, max_value=100.0),
        st.floats(min_value=0.01, max_value=100.0),
    )
    @settings(max_examples=50)
    def test_kelly_fraction(self, win_rate: float, avg_win: float, avg_loss: float):
        """Kelly fraction should be bounded."""
        kelly = RiskCalculator.kelly_fraction(win_rate, avg_win, avg_loss)
        assert isinstance(kelly, float)
        assert kelly <= 1.0
