"""
CITADEL — Trading Strategies

Built-in strategy implementations:
  - Mean Reversion (Z-Score based)
  - Momentum (MACD + RSI + ADX)
  - Statistical Arbitrage (Pairs Trading)
  - Multi-Factor (combined signals)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
import structlog

from src.core.models import Bar, Signal, AgentAction, Position

logger = structlog.get_logger(__name__)


class BaseStrategy(ABC):
    """Base strategy interface."""

    def __init__(self, name: str, config: dict[str, Any] | None = None):
        self._name = name
        self._config = config or {}
        self._bars_history: dict[str, list[Bar]] = {}
        self._signals_generated = 0

    @property
    def name(self) -> str:
        return self._name

    def _add_bar(self, bar: Bar) -> None:
        """Add a bar to history."""
        if bar.symbol not in self._bars_history:
            self._bars_history[bar.symbol] = []
        self._bars_history[bar.symbol].append(bar)
        # Keep only last N bars
        max_history = self._config.get("max_history", 500)
        if len(self._bars_history[bar.symbol]) > max_history:
            self._bars_history[bar.symbol] = self._bars_history[bar.symbol][-max_history:]

    def _get_closes(self, symbol: str) -> np.ndarray:
        """Get close prices as numpy array."""
        bars = self._bars_history.get(symbol, [])
        return np.array([b.close for b in bars])

    def _get_volumes(self, symbol: str) -> np.ndarray:
        """Get volumes as numpy array."""
        bars = self._bars_history.get(symbol, [])
        return np.array([b.volume for b in bars])

    @abstractmethod
    def generate_signals(
        self, bars: dict[str, Bar], portfolio: Any
    ) -> list[Signal]:
        """Generate trading signals from current bars."""
        ...

    def reset(self) -> None:
        """Reset strategy state."""
        self._bars_history.clear()
        self._signals_generated = 0


class MeanReversionStrategy(BaseStrategy):
    """
    Mean Reversion strategy using Z-Score.
    
    Logic:
      - Calculate rolling mean and std of close prices
      - BUY when Z-Score < -entry_threshold (oversold)
      - SELL when Z-Score > exit_threshold (reverted)
      - STOP when Z-Score < -stop_threshold (trend)
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("mean_reversion", config)
        self.lookback = self._config.get("lookback_periods", 20)
        self.entry_z = self._config.get("entry_z_score", -2.0)
        self.exit_z = self._config.get("exit_z_score", 0.0)
        self.stop_z = self._config.get("stop_loss_z_score", -3.5)
        self.size_pct = self._config.get("size_pct", 5.0)

    def generate_signals(
        self, bars: dict[str, Bar], portfolio: Any
    ) -> list[Signal]:
        signals = []
        
        for symbol, bar in bars.items():
            self._add_bar(bar)
            closes = self._get_closes(symbol)
            
            if len(closes) < self.lookback + 1:
                continue

            window = closes[-self.lookback:]
            mean = np.mean(window)
            std = np.std(window)
            
            if std == 0:
                continue

            z_score = (closes[-1] - mean) / std

            # Check if we have a position
            has_position = hasattr(portfolio, 'positions') and symbol in portfolio.positions

            if not has_position and z_score <= self.entry_z:
                # Oversold — BUY
                signals.append(Signal(
                    source=self.name,
                    symbol=symbol,
                    action=AgentAction.BUY,
                    confidence=min(1.0, abs(z_score) / 3.0),
                    size_pct=self.size_pct,
                    rationale=f"Z-Score={z_score:.2f}, oversold below {self.entry_z}",
                ))
            elif has_position and z_score >= self.exit_z:
                # Reverted — CLOSE
                signals.append(Signal(
                    source=self.name,
                    symbol=symbol,
                    action=AgentAction.CLOSE,
                    confidence=0.8,
                    size_pct=100.0,  # Close entire position
                    rationale=f"Z-Score={z_score:.2f}, reverted above {self.exit_z}",
                ))
            elif has_position and z_score <= self.stop_z:
                # Stop loss
                signals.append(Signal(
                    source=self.name,
                    symbol=symbol,
                    action=AgentAction.CLOSE,
                    confidence=1.0,
                    size_pct=100.0,
                    rationale=f"Z-Score={z_score:.2f}, stop loss at {self.stop_z}",
                ))

        return signals


class MomentumStrategy(BaseStrategy):
    """
    Momentum strategy using MACD + RSI + ADX.
    
    Logic:
      - BUY when MACD crosses above signal line AND RSI < overbought AND ADX > threshold
      - SELL when MACD crosses below signal line OR RSI > overbought
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("momentum", config)
        self.fast = self._config.get("fast_period", 12)
        self.slow = self._config.get("slow_period", 26)
        self.signal_period = self._config.get("signal_period", 9)
        self.rsi_period = self._config.get("rsi_period", 14)
        self.rsi_overbought = self._config.get("rsi_overbought", 70)
        self.rsi_oversold = self._config.get("rsi_oversold", 30)
        self.adx_threshold = self._config.get("adx_threshold", 25)
        self.size_pct = self._config.get("size_pct", 5.0)

    def _ema(self, data: np.ndarray, period: int) -> np.ndarray:
        """Exponential moving average."""
        alpha = 2.0 / (period + 1)
        result = np.zeros_like(data)
        result[0] = data[0]
        for i in range(1, len(data)):
            result[i] = alpha * data[i] + (1 - alpha) * result[i - 1]
        return result

    def _rsi(self, data: np.ndarray, period: int = 14) -> float:
        """Calculate RSI."""
        if len(data) < period + 1:
            return 50.0
        
        deltas = np.diff(data[-period - 1:])
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = np.mean(gains)
        avg_loss = np.mean(losses)
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def _adx(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """Simplified ADX calculation."""
        if len(closes) < period + 1:
            return 0.0
        
        tr_list = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            tr_list.append(tr)
        
        if not tr_list:
            return 0.0
        
        atr = np.mean(tr_list[-period:])
        if atr == 0:
            return 0.0
        
        # Simplified DX
        price_range = max(closes[-period:]) - min(closes[-period:])
        dx = (price_range / atr) * 10
        return min(100, dx)

    def generate_signals(
        self, bars: dict[str, Bar], portfolio: Any
    ) -> list[Signal]:
        signals = []

        for symbol, bar in bars.items():
            self._add_bar(bar)
            closes = self._get_closes(symbol)
            
            if len(closes) < self.slow + self.signal_period:
                continue

            # MACD
            ema_fast = self._ema(closes, self.fast)
            ema_slow = self._ema(closes, self.slow)
            macd = ema_fast - ema_slow
            signal_line = self._ema(macd, self.signal_period)
            
            macd_curr = macd[-1]
            macd_prev = macd[-2]
            signal_curr = signal_line[-1]
            signal_prev = signal_line[-2]

            # RSI
            rsi = self._rsi(closes, self.rsi_period)

            # ADX (simplified)
            bars_list = self._bars_history.get(symbol, [])
            highs = np.array([b.high for b in bars_list])
            lows = np.array([b.low for b in bars_list])
            adx = self._adx(highs, lows, closes)

            has_position = hasattr(portfolio, 'positions') and symbol in portfolio.positions

            # BUY signal: MACD cross up + RSI not overbought + trending
            if (not has_position 
                and macd_prev <= signal_prev 
                and macd_curr > signal_curr
                and rsi < self.rsi_overbought
                and adx > self.adx_threshold):
                
                confidence = min(1.0, (adx / 50) * (1 - rsi / 100))
                signals.append(Signal(
                    source=self.name,
                    symbol=symbol,
                    action=AgentAction.BUY,
                    confidence=confidence,
                    size_pct=self.size_pct,
                    rationale=(
                        f"MACD bullish crossover, RSI={rsi:.1f}, ADX={adx:.1f}"
                    ),
                    metadata={"rsi": rsi, "adx": adx, "macd": macd_curr},
                ))

            # SELL signal: MACD cross down OR RSI overbought
            elif has_position and (
                (macd_prev >= signal_prev and macd_curr < signal_curr)
                or rsi > self.rsi_overbought
            ):
                signals.append(Signal(
                    source=self.name,
                    symbol=symbol,
                    action=AgentAction.CLOSE,
                    confidence=0.8,
                    size_pct=100.0,
                    rationale=f"MACD bearish crossover or RSI={rsi:.1f} overbought",
                ))

        return signals


class StatArbStrategy(BaseStrategy):
    """
    Statistical Arbitrage (Pairs Trading).
    
    Logic:
      - Monitor price ratio of correlated pairs
      - BUY underperformer / SELL outperformer when spread deviates
      - Close when spread reverts to mean
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("stat_arb", config)
        self.pairs = self._config.get("pairs", [["SPY", "QQQ"]])
        self.lookback = self._config.get("cointegration_lookback", 60)
        self.entry_z = self._config.get("z_score_entry", 2.0)
        self.exit_z = self._config.get("z_score_exit", 0.5)
        self.size_pct = self._config.get("size_pct", 3.0)

    def generate_signals(
        self, bars: dict[str, Bar], portfolio: Any
    ) -> list[Signal]:
        signals = []

        for pair in self.pairs:
            if len(pair) != 2:
                continue
            sym_a, sym_b = pair

            if sym_a in bars:
                self._add_bar(bars[sym_a])
            if sym_b in bars:
                self._add_bar(bars[sym_b])

            prices_a = self._get_closes(sym_a)
            prices_b = self._get_closes(sym_b)

            min_len = min(len(prices_a), len(prices_b))
            if min_len < self.lookback:
                continue

            prices_a = prices_a[-self.lookback:]
            prices_b = prices_b[-self.lookback:]

            # Calculate spread (log ratio)
            ratio = np.log(prices_a / prices_b)
            mean_ratio = np.mean(ratio)
            std_ratio = np.std(ratio)

            if std_ratio == 0:
                continue

            z_score = (ratio[-1] - mean_ratio) / std_ratio

            has_pos_a = hasattr(portfolio, 'positions') and sym_a in portfolio.positions

            if not has_pos_a and z_score > self.entry_z:
                # Spread widened: short A, long B
                signals.append(Signal(
                    source=self.name, symbol=sym_a,
                    action=AgentAction.SELL, confidence=min(1.0, abs(z_score) / 3),
                    size_pct=self.size_pct,
                    rationale=f"Pairs trade {sym_a}/{sym_b}: z={z_score:.2f}, short {sym_a}",
                ))
                signals.append(Signal(
                    source=self.name, symbol=sym_b,
                    action=AgentAction.BUY, confidence=min(1.0, abs(z_score) / 3),
                    size_pct=self.size_pct,
                    rationale=f"Pairs trade {sym_a}/{sym_b}: z={z_score:.2f}, long {sym_b}",
                ))
            elif not has_pos_a and z_score < -self.entry_z:
                # Spread narrowed: long A, short B
                signals.append(Signal(
                    source=self.name, symbol=sym_a,
                    action=AgentAction.BUY, confidence=min(1.0, abs(z_score) / 3),
                    size_pct=self.size_pct,
                    rationale=f"Pairs trade {sym_a}/{sym_b}: z={z_score:.2f}, long {sym_a}",
                ))
                signals.append(Signal(
                    source=self.name, symbol=sym_b,
                    action=AgentAction.SELL, confidence=min(1.0, abs(z_score) / 3),
                    size_pct=self.size_pct,
                    rationale=f"Pairs trade {sym_a}/{sym_b}: z={z_score:.2f}, short {sym_b}",
                ))
            elif has_pos_a and abs(z_score) < self.exit_z:
                # Spread reverted: close both
                signals.append(Signal(
                    source=self.name, symbol=sym_a,
                    action=AgentAction.CLOSE, confidence=0.8, size_pct=100.0,
                    rationale=f"Pairs reversion {sym_a}/{sym_b}: z={z_score:.2f}",
                ))
                signals.append(Signal(
                    source=self.name, symbol=sym_b,
                    action=AgentAction.CLOSE, confidence=0.8, size_pct=100.0,
                    rationale=f"Pairs reversion {sym_a}/{sym_b}: z={z_score:.2f}",
                ))

        return signals


class MultiFactorStrategy(BaseStrategy):
    """
    Multi-Factor strategy that combines signals from multiple sub-strategies.
    Weighted ensemble of individual strategy signals.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("multi_factor", config)
        self._sub_strategies: list[tuple[BaseStrategy, float]] = []

    def add_strategy(self, strategy: BaseStrategy, weight: float = 1.0) -> None:
        """Add a sub-strategy with a weight."""
        self._sub_strategies.append((strategy, weight))

    def generate_signals(
        self, bars: dict[str, Bar], portfolio: Any
    ) -> list[Signal]:
        """Combine signals from all sub-strategies."""
        # Collect all signals
        all_signals: dict[str, list[tuple[Signal, float]]] = {}
        
        for strategy, weight in self._sub_strategies:
            sub_signals = strategy.generate_signals(bars, portfolio)
            for sig in sub_signals:
                key = f"{sig.symbol}_{sig.action.value}"
                if key not in all_signals:
                    all_signals[key] = []
                all_signals[key].append((sig, weight))

        # Merge signals per symbol+action
        merged_signals = []
        for key, weighted_signals in all_signals.items():
            total_weight = sum(w for _, w in weighted_signals)
            weighted_confidence = sum(
                s.confidence * w for s, w in weighted_signals
            ) / total_weight

            # Use the first signal as template
            base_signal = weighted_signals[0][0]
            sources = [s.source for s, _ in weighted_signals]
            
            merged_signals.append(Signal(
                source=f"multi_factor({','.join(sources)})",
                symbol=base_signal.symbol,
                action=base_signal.action,
                confidence=weighted_confidence,
                size_pct=base_signal.size_pct,
                rationale=f"Multi-factor consensus ({len(weighted_signals)} strategies)",
                metadata={"contributing_strategies": sources},
            ))

        return merged_signals

    def reset(self) -> None:
        super().reset()
        for strategy, _ in self._sub_strategies:
            strategy.reset()
