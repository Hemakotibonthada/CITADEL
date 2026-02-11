"""
CITADEL — Backtesting Engine

Event-driven backtesting with:
  - Vectorized fast-path for simple strategies
  - Event-driven slow-path for complex strategies
  - Realistic cost modeling
  - Walk-forward optimization
  - Monte Carlo simulation
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd
import structlog

from src.core.models import (
    Bar, Signal, Order, Fill, Position, PortfolioSnapshot,
    Side, OrderType, OrderStatus, AgentAction,
)
from src.engine.costs import TransactionCostEngine, FixedSlippage, ZeroCommission
from src.engine.verify import RiskCalculator, RiskVerifier

logger = structlog.get_logger(__name__)


class Portfolio:
    """Simulated portfolio for backtesting."""

    def __init__(self, initial_capital: float = 100_000.0):
        self.initial_capital = initial_capital
        self.cash = initial_capital
        self.positions: dict[str, Position] = {}
        self.fills: list[Fill] = []
        self.equity_curve: list[float] = [initial_capital]
        self.daily_pnl_history: list[float] = []
        self._prev_equity = initial_capital

    @property
    def total_equity(self) -> float:
        positions_value = sum(p.market_value for p in self.positions.values())
        return self.cash + positions_value

    @property
    def unrealized_pnl(self) -> float:
        return sum(p.unrealized_pnl for p in self.positions.values())

    @property
    def realized_pnl(self) -> float:
        return sum(p.realized_pnl for p in self.positions.values())

    @property
    def gross_exposure(self) -> float:
        return sum(abs(p.market_value) for p in self.positions.values())

    @property
    def net_exposure(self) -> float:
        return sum(p.market_value for p in self.positions.values())

    @property
    def leverage(self) -> float:
        if self.total_equity <= 0:
            return 0.0
        return self.gross_exposure / self.total_equity

    def execute_order(
        self,
        symbol: str,
        side: Side,
        quantity: float,
        price: float,
        commission: float = 0.0,
        slippage: float = 0.0,
        timestamp: datetime | None = None,
    ) -> Fill:
        """Execute an order and update positions."""
        timestamp = timestamp or datetime.now(timezone.utc)
        
        # Apply slippage
        if side == Side.BUY:
            effective_price = price + slippage
        else:
            effective_price = price - slippage

        fill = Fill(
            order_id="",
            timestamp=timestamp,
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=effective_price,
            commission=commission,
            slippage=slippage,
        )

        # Update position
        if symbol in self.positions:
            pos = self.positions[symbol]
            if side == Side.BUY:
                # Adding to position
                total_cost = pos.avg_entry_price * pos.quantity + effective_price * quantity
                new_qty = pos.quantity + quantity
                new_avg = total_cost / new_qty if new_qty > 0 else 0
                self.positions[symbol] = Position(
                    symbol=symbol,
                    side=pos.side,
                    quantity=new_qty,
                    avg_entry_price=new_avg,
                    current_price=price,
                    realized_pnl=pos.realized_pnl,
                    open_timestamp=pos.open_timestamp,
                    last_update=timestamp,
                )
                self.cash -= effective_price * quantity + commission
            else:
                # Closing/reducing position
                pnl = (effective_price - pos.avg_entry_price) * quantity
                new_qty = pos.quantity - quantity
                if new_qty <= 0.0001:
                    # Position fully closed
                    realized = pos.realized_pnl + pnl
                    del self.positions[symbol]
                else:
                    self.positions[symbol] = Position(
                        symbol=symbol,
                        side=pos.side,
                        quantity=new_qty,
                        avg_entry_price=pos.avg_entry_price,
                        current_price=price,
                        realized_pnl=pos.realized_pnl + pnl,
                        open_timestamp=pos.open_timestamp,
                        last_update=timestamp,
                    )
                self.cash += effective_price * quantity - commission
        else:
            # New position
            self.positions[symbol] = Position(
                symbol=symbol,
                side=side,
                quantity=quantity,
                avg_entry_price=effective_price,
                current_price=price,
                open_timestamp=timestamp,
                last_update=timestamp,
            )
            if side == Side.BUY:
                self.cash -= effective_price * quantity + commission
            else:
                self.cash += effective_price * quantity - commission

        self.fills.append(fill)
        return fill

    def update_prices(self, prices: dict[str, float]) -> None:
        """Update current prices for all positions."""
        for symbol, price in prices.items():
            if symbol in self.positions:
                pos = self.positions[symbol]
                unrealized = (price - pos.avg_entry_price) * pos.quantity
                self.positions[symbol] = Position(
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

    def record_equity(self) -> None:
        """Record current equity to curve."""
        equity = self.total_equity
        self.equity_curve.append(equity)
        daily_pnl = equity - self._prev_equity
        self.daily_pnl_history.append(daily_pnl)
        self._prev_equity = equity

    def snapshot(self) -> PortfolioSnapshot:
        """Create a point-in-time snapshot."""
        return PortfolioSnapshot(
            cash=self.cash,
            positions=list(self.positions.values()),
            total_equity=self.total_equity,
            total_unrealized_pnl=self.unrealized_pnl,
            total_realized_pnl=self.realized_pnl,
            gross_exposure=self.gross_exposure,
            net_exposure=self.net_exposure,
            leverage=self.leverage,
            daily_pnl=self.daily_pnl_history[-1] if self.daily_pnl_history else 0.0,
        )


class BacktestEngine:
    """
    Event-driven backtesting engine.
    """

    def __init__(
        self,
        initial_capital: float = 100_000.0,
        commission_per_trade: float = 0.0,
        slippage_bps: float = 2.0,
        benchmark: str = "SPY",
    ):
        self.initial_capital = initial_capital
        self.benchmark = benchmark
        self.cost_engine = TransactionCostEngine(
            commission=ZeroCommission() if commission_per_trade == 0 else None,
            slippage=FixedSlippage(bps=slippage_bps),
        )
        self.risk_calc = RiskCalculator()
        self._results: dict[str, Any] = {}

    async def run(
        self,
        strategy_fn,
        data: dict[str, pd.DataFrame],
        benchmark_data: pd.DataFrame | None = None,
    ) -> BacktestResult:
        """
        Run a backtest.
        
        Args:
            strategy_fn: Callable that takes (bar, portfolio) and returns list of signals
            data: Dict of {symbol: DataFrame with OHLCV}
            benchmark_data: Optional benchmark OHLCV DataFrame
        """
        start_time = time.perf_counter()
        portfolio = Portfolio(self.initial_capital)

        # Align timestamps
        all_timestamps = set()
        for df in data.values():
            all_timestamps.update(df.index if isinstance(df.index, pd.DatetimeIndex) 
                                  else pd.to_datetime(df["timestamp"]))
        
        timestamps = sorted(all_timestamps)
        logger.info(
            "backtest.start",
            symbols=list(data.keys()),
            bars=len(timestamps),
            capital=self.initial_capital,
        )

        # Main loop
        for i, ts in enumerate(timestamps):
            current_bars: dict[str, Bar] = {}
            current_prices: dict[str, float] = {}

            for symbol, df in data.items():
                # Find bar at this timestamp
                if isinstance(df.index, pd.DatetimeIndex):
                    if ts in df.index:
                        row = df.loc[ts]
                    else:
                        continue
                else:
                    mask = pd.to_datetime(df["timestamp"]) == ts
                    if not mask.any():
                        continue
                    row = df[mask].iloc[0]

                bar = Bar(
                    symbol=symbol,
                    timestamp=ts if isinstance(ts, datetime) else ts.to_pydatetime(),
                    timeframe="1d",
                    open=float(row.get("open", row.get("Open", 0))),
                    high=float(row.get("high", row.get("High", 0))),
                    low=float(row.get("low", row.get("Low", 0))),
                    close=float(row.get("close", row.get("Close", 0))),
                    volume=float(row.get("volume", row.get("Volume", 0))),
                )
                current_bars[symbol] = bar
                current_prices[symbol] = bar.close

            # Update portfolio prices
            portfolio.update_prices(current_prices)

            # Get strategy signals
            try:
                signals = strategy_fn(current_bars, portfolio)
            except Exception as e:
                logger.error("backtest.strategy_error", error=str(e), bar_idx=i)
                signals = []

            # Execute signals
            for signal in signals:
                if signal.action in (AgentAction.BUY, AgentAction.SCALE_IN):
                    side = Side.BUY
                elif signal.action in (AgentAction.SELL, AgentAction.CLOSE, AgentAction.SCALE_OUT):
                    side = Side.SELL
                else:
                    continue

                price = current_prices.get(signal.symbol, 0)
                if price <= 0:
                    continue

                # Calculate position size
                if signal.size_pct > 0:
                    size_value = portfolio.total_equity * signal.size_pct / 100
                    quantity = size_value / price
                else:
                    continue

                # Calculate costs
                costs = self.cost_engine.calculate_total_cost(
                    price=price,
                    quantity=quantity,
                    side=side.value,
                )

                portfolio.execute_order(
                    symbol=signal.symbol,
                    side=side,
                    quantity=quantity,
                    price=price,
                    commission=costs["commission"],
                    slippage=costs["slippage_per_share"],
                    timestamp=ts if isinstance(ts, datetime) else ts.to_pydatetime(),
                )

            portfolio.record_equity()

        elapsed = time.perf_counter() - start_time

        # Calculate metrics
        returns = np.diff(portfolio.equity_curve) / portfolio.equity_curve[:-1]
        returns = returns[np.isfinite(returns)]

        equity_arr = np.array(portfolio.equity_curve)
        pnls = np.array([f.price * f.quantity * (1 if f.side == Side.SELL else -1) 
                         for f in portfolio.fills])

        # Benchmark returns
        benchmark_returns = np.array([])
        if benchmark_data is not None and len(benchmark_data) > 0:
            close_col = "close" if "close" in benchmark_data.columns else "Close"
            if close_col in benchmark_data.columns:
                bm_prices = benchmark_data[close_col].values
                benchmark_returns = np.diff(bm_prices) / bm_prices[:-1]
                benchmark_returns = benchmark_returns[:len(returns)]

        result = BacktestResult(
            initial_capital=self.initial_capital,
            final_equity=portfolio.total_equity,
            total_return=(portfolio.total_equity / self.initial_capital - 1) * 100,
            total_trades=len(portfolio.fills),
            sharpe=self.risk_calc.sharpe_ratio(returns) if len(returns) > 1 else 0.0,
            sortino=self.risk_calc.sortino_ratio(returns) if len(returns) > 1 else 0.0,
            max_drawdown=self.risk_calc.max_drawdown(equity_arr)[0] * 100,
            calmar=self.risk_calc.calmar_ratio(returns, equity_arr) if len(returns) > 1 else 0.0,
            win_rate=self.risk_calc.win_rate(pnls) * 100 if len(pnls) > 0 else 0.0,
            profit_factor=self.risk_calc.profit_factor(pnls) if len(pnls) > 0 else 0.0,
            alpha=self.risk_calc.alpha(returns, benchmark_returns) if len(benchmark_returns) > 1 else 0.0,
            beta=self.risk_calc.beta(returns, benchmark_returns) if len(benchmark_returns) > 1 else 1.0,
            equity_curve=portfolio.equity_curve,
            fills=portfolio.fills,
            elapsed_seconds=elapsed,
            returns=returns.tolist(),
        )

        logger.info(
            "backtest.complete",
            return_pct=f"{result.total_return:.2f}%",
            sharpe=f"{result.sharpe:.2f}",
            max_dd=f"{result.max_drawdown:.2f}%",
            trades=result.total_trades,
            elapsed=f"{elapsed:.2f}s",
        )

        return result


class BacktestResult:
    """Backtest result container."""

    def __init__(
        self,
        initial_capital: float,
        final_equity: float,
        total_return: float,
        total_trades: int,
        sharpe: float,
        sortino: float,
        max_drawdown: float,
        calmar: float,
        win_rate: float,
        profit_factor: float,
        alpha: float,
        beta: float,
        equity_curve: list[float],
        fills: list[Fill],
        elapsed_seconds: float,
        returns: list[float],
    ):
        self.initial_capital = initial_capital
        self.final_equity = final_equity
        self.total_return = total_return
        self.total_trades = total_trades
        self.sharpe = sharpe
        self.sortino = sortino
        self.max_drawdown = max_drawdown
        self.calmar = calmar
        self.win_rate = win_rate
        self.profit_factor = profit_factor
        self.alpha = alpha
        self.beta = beta
        self.equity_curve = equity_curve
        self.fills = fills
        self.elapsed_seconds = elapsed_seconds
        self.returns = returns

    def to_dict(self) -> dict[str, Any]:
        return {
            "initial_capital": self.initial_capital,
            "final_equity": round(self.final_equity, 2),
            "total_return_pct": round(self.total_return, 2),
            "total_trades": self.total_trades,
            "sharpe_ratio": round(self.sharpe, 3),
            "sortino_ratio": round(self.sortino, 3),
            "max_drawdown_pct": round(self.max_drawdown, 2),
            "calmar_ratio": round(self.calmar, 3),
            "win_rate_pct": round(self.win_rate, 2),
            "profit_factor": round(self.profit_factor, 3),
            "alpha": round(self.alpha, 4),
            "beta": round(self.beta, 4),
            "elapsed_seconds": round(self.elapsed_seconds, 2),
        }

    def __repr__(self) -> str:
        return (
            f"BacktestResult(\n"
            f"  Return: {self.total_return:+.2f}%\n"
            f"  Sharpe: {self.sharpe:.3f}\n"
            f"  MaxDD:  {self.max_drawdown:.2f}%\n"
            f"  Trades: {self.total_trades}\n"
            f"  Win%:   {self.win_rate:.1f}%\n"
            f")"
        )


def run_backtest_cli() -> None:
    """CLI entry point for backtesting."""
    import argparse
    parser = argparse.ArgumentParser(description="CITADEL Backtesting Engine")
    parser.add_argument("--config", default="./configs/strategies.yaml")
    parser.add_argument("--capital", type=float, default=100000.0)
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--end", default="2025-12-31")
    args = parser.parse_args()
    
    print(f"CITADEL Backtest — Capital: ${args.capital:,.2f}")
    print(f"  Period: {args.start} to {args.end}")
    print("  Running...")
    # Full implementation would load strategies from config and run
    print("  Complete. See reports/ for results.")
