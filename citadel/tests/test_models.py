"""
CITADEL — Test Suite: Core Models

Property-based tests using Hypothesis for formal verification.
"""

import numpy as np
import pytest
from datetime import datetime, timezone
from hypothesis import given, strategies as st, settings

from src.core.models import (
    Tick, Bar, Signal, Order, Fill, Position, PortfolioSnapshot,
    Side, OrderType, OrderStatus, AgentAction, KillSwitchLevel,
    EventType, Sentiment, Event,
    TICK_DTYPE, SIGNAL_DTYPE, RISK_DTYPE, PORTFOLIO_DTYPE,
    symbol_hash,
)

NOW = datetime.now(timezone.utc)


class TestTick:
    def test_create(self):
        tick = Tick(
            symbol="AAPL", timestamp=NOW,
            bid=149.9, ask=150.1, volume=100,
        )
        assert tick.symbol == "AAPL"
        assert tick.mid == pytest.approx(150.0)
        assert tick.volume == 100

    @given(st.text(min_size=1, max_size=10), st.floats(min_value=0.01, max_value=1e6))
    @settings(max_examples=50)
    def test_tick_invariants(self, symbol: str, price: float):
        tick = Tick(
            symbol=symbol, timestamp=NOW,
            bid=price * 0.999, ask=price * 1.001, volume=1,
        )
        assert tick.bid > 0
        assert tick.ask >= tick.bid


class TestOrder:
    def test_market_order(self):
        order = Order(
            symbol="MSFT", side=Side.BUY,
            order_type=OrderType.MARKET, quantity=100,
        )
        assert order.side == Side.BUY
        assert order.quantity == 100
        assert order.status == OrderStatus.PENDING

    def test_limit_order_has_price(self):
        order = Order(
            symbol="TSLA", side=Side.SELL,
            order_type=OrderType.LIMIT, quantity=50,
            price=250.0,
        )
        assert order.price == 250.0


class TestPosition:
    def test_pnl_calculation(self):
        pos = Position(
            symbol="GOOGL", side=Side.BUY, quantity=100,
            avg_entry_price=140.0, current_price=150.0,
            unrealized_pnl=1000.0,
        )
        assert pos.unrealized_pnl == 1000.0
        assert pos.market_value == 15000.0
        assert pos.cost_basis == 14000.0

    @given(
        st.integers(min_value=1, max_value=10000),
        st.floats(min_value=1.0, max_value=10000.0),
    )
    @settings(max_examples=50)
    def test_position_invariants(self, qty: int, cost: float):
        pos = Position(
            symbol="TEST", side=Side.BUY, quantity=qty,
            avg_entry_price=cost, current_price=cost,
        )
        assert pos.market_value == pytest.approx(qty * cost, rel=1e-6)
        assert pos.cost_basis == pytest.approx(qty * cost, rel=1e-6)


class TestPortfolioSnapshot:
    def test_snapshot(self):
        snap = PortfolioSnapshot(
            total_equity=100000.0, cash=50000.0,
            positions=[], daily_pnl=500.0, leverage=1.0,
        )
        assert snap.total_equity == 100000.0


class TestSymbolHash:
    def test_deterministic(self):
        h1 = symbol_hash("AAPL")
        h2 = symbol_hash("AAPL")
        assert h1 == h2

    def test_different_symbols(self):
        h1 = symbol_hash("AAPL")
        h2 = symbol_hash("MSFT")
        assert h1 != h2

    @given(st.text(min_size=1, max_size=20))
    @settings(max_examples=100)
    def test_hash_is_uint64(self, symbol: str):
        h = symbol_hash(symbol)
        assert 0 <= h < 2**64


class TestEnums:
    def test_side(self):
        assert Side.BUY.value == "BUY"
        assert Side.SELL.value == "SELL"

    def test_kill_switch_levels(self):
        assert KillSwitchLevel.L1_SOFT.value == "L1_SOFT"
        assert KillSwitchLevel.L3_NUCLEAR.value == "L3_NUCLEAR"

    def test_event_types(self):
        assert EventType.TICK.value == "TICK"
        assert EventType.KILL_SWITCH.value == "KILL_SWITCH"


class TestDtypes:
    def test_tick_dtype(self):
        arr = np.zeros(10, dtype=TICK_DTYPE)
        assert arr.dtype == TICK_DTYPE
        arr[0]["bid"] = 149.9
        arr[0]["ask"] = 150.1
        assert arr[0]["bid"] == 149.9
        assert arr[0]["ask"] == 150.1

    def test_signal_dtype(self):
        arr = np.zeros(5, dtype=SIGNAL_DTYPE)
        arr[0]["confidence"] = 0.95
        assert arr[0]["confidence"] == pytest.approx(0.95, rel=1e-6)

    def test_risk_dtype(self):
        arr = np.zeros(1, dtype=RISK_DTYPE)
        arr[0]["var_95"] = 5000.0
        assert arr[0]["var_95"] == 5000.0

    def test_portfolio_dtype(self):
        arr = np.zeros(1, dtype=PORTFOLIO_DTYPE)
        arr[0]["total_equity"] = 100000.0
        assert arr[0]["total_equity"] == 100000.0


class TestEvent:
    def test_create_event(self):
        event = Event(
            event_type=EventType.TICK,
            source="feed",
            payload={"symbol": "AAPL", "price": 150.0},
        )
        assert event.event_type == EventType.TICK
        assert event.payload["symbol"] == "AAPL"
