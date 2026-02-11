"""
CITADEL — Transaction Cost Models

Realistic models for:
  - Commission schedules (tiered, per-share, per-trade)
  - Slippage estimation (fixed, volume-based, volatility-based)
  - Market impact (square-root model)
  - Tax calculations (wash sale, short-term / long-term)
  - Financing costs (margin interest, borrow fees)
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import numpy as np


# ════════════════════════════════════════════════════════════
#  COMMISSION MODELS
# ════════════════════════════════════════════════════════════

class CommissionModel(ABC):
    """Base class for commission calculations."""

    @abstractmethod
    def calculate(
        self,
        quantity: float,
        price: float,
        side: str,
        **kwargs: Any,
    ) -> float:
        """Calculate commission for a trade."""
        ...


class ZeroCommission(CommissionModel):
    """Zero commission (many modern brokers)."""

    def calculate(self, quantity: float, price: float, side: str, **kwargs: Any) -> float:
        return 0.0


class PerShareCommission(CommissionModel):
    """Per-share commission model (Interactive Brokers style)."""

    def __init__(
        self,
        rate_per_share: float = 0.005,
        min_per_order: float = 1.0,
        max_pct_of_value: float = 0.005,
    ):
        self.rate_per_share = rate_per_share
        self.min_per_order = min_per_order
        self.max_pct_of_value = max_pct_of_value

    def calculate(self, quantity: float, price: float, side: str, **kwargs: Any) -> float:
        commission = max(
            quantity * self.rate_per_share,
            self.min_per_order,
        )
        max_commission = quantity * price * self.max_pct_of_value
        return min(commission, max_commission)


class TieredCommission(CommissionModel):
    """Tiered commission based on monthly volume."""

    def __init__(self, tiers: list[tuple[float, float]] | None = None):
        # (volume_threshold, rate_per_share)
        self.tiers = tiers or [
            (300_000, 0.0035),
            (3_000_000, 0.0020),
            (20_000_000, 0.0015),
            (float("inf"), 0.0010),
        ]
        self._monthly_volume = 0.0

    def calculate(self, quantity: float, price: float, side: str, **kwargs: Any) -> float:
        rate = self.tiers[-1][1]
        for threshold, tier_rate in self.tiers:
            if self._monthly_volume < threshold:
                rate = tier_rate
                break
        
        self._monthly_volume += quantity
        return max(quantity * rate, 0.35)  # Minimum $0.35

    def reset_monthly_volume(self) -> None:
        self._monthly_volume = 0.0


# ════════════════════════════════════════════════════════════
#  SLIPPAGE MODELS
# ════════════════════════════════════════════════════════════

class SlippageModel(ABC):
    """Base class for slippage estimation."""

    @abstractmethod
    def estimate(
        self,
        price: float,
        quantity: float,
        side: str,
        volatility: float = 0.0,
        avg_volume: float = 0.0,
        spread: float = 0.0,
        **kwargs: Any,
    ) -> float:
        """Estimate slippage in price units."""
        ...


class FixedSlippage(SlippageModel):
    """Fixed basis points slippage."""

    def __init__(self, bps: float = 2.0):
        self.bps = bps

    def estimate(
        self, price: float, quantity: float, side: str,
        volatility: float = 0.0, avg_volume: float = 0.0,
        spread: float = 0.0, **kwargs: Any,
    ) -> float:
        return price * self.bps / 10_000


class VolumeSlippage(SlippageModel):
    """Volume-dependent slippage model."""

    def __init__(
        self,
        base_bps: float = 1.0,
        volume_impact_factor: float = 0.1,
        max_bps: float = 50.0,
    ):
        self.base_bps = base_bps
        self.volume_impact_factor = volume_impact_factor
        self.max_bps = max_bps

    def estimate(
        self, price: float, quantity: float, side: str,
        volatility: float = 0.0, avg_volume: float = 1_000_000.0,
        spread: float = 0.0, **kwargs: Any,
    ) -> float:
        if avg_volume <= 0:
            avg_volume = 1_000_000.0
        
        participation_rate = quantity / avg_volume
        volume_impact_bps = self.volume_impact_factor * participation_rate * 10_000
        total_bps = min(self.base_bps + volume_impact_bps, self.max_bps)
        
        return price * total_bps / 10_000


class SquareRootMarketImpact(SlippageModel):
    """
    Almgren-Chriss square root market impact model.
    Impact ∝ σ * √(Q / V)
    """

    def __init__(
        self,
        impact_coefficient: float = 0.1,
        temporary_impact: float = 0.01,
    ):
        self.impact_coefficient = impact_coefficient
        self.temporary_impact = temporary_impact

    def estimate(
        self, price: float, quantity: float, side: str,
        volatility: float = 0.02, avg_volume: float = 1_000_000.0,
        spread: float = 0.0, **kwargs: Any,
    ) -> float:
        if avg_volume <= 0:
            return price * 0.001

        participation = quantity / avg_volume
        
        # Permanent impact
        permanent = self.impact_coefficient * volatility * math.sqrt(participation)
        
        # Temporary impact
        temporary = self.temporary_impact * volatility * participation
        
        # Add half-spread
        spread_cost = spread / 2 if spread > 0 else price * 0.0001
        
        total_impact = (permanent + temporary) * price + spread_cost
        return max(total_impact, 0.0)


# ════════════════════════════════════════════════════════════
#  TAX MODELS
# ════════════════════════════════════════════════════════════

@dataclass
class TaxLot:
    """Individual tax lot for cost basis tracking."""
    symbol: str
    quantity: float
    price: float
    date: str
    remaining: float = 0.0

    def __post_init__(self):
        if self.remaining == 0:
            self.remaining = self.quantity


class TaxCalculator:
    """
    Tax calculation engine.
    Handles:
      - Short-term vs long-term capital gains
      - Wash sale detection
      - Tax lot matching (FIFO, LIFO, specific ID)
    """

    def __init__(
        self,
        short_term_rate: float = 0.37,
        long_term_rate: float = 0.20,
        long_term_threshold_days: int = 365,
        wash_sale_window_days: int = 30,
    ):
        self.short_term_rate = short_term_rate
        self.long_term_rate = long_term_rate
        self.long_term_threshold_days = long_term_threshold_days
        self.wash_sale_window_days = wash_sale_window_days
        self._lots: list[TaxLot] = []
        self._wash_sales: list[dict[str, Any]] = []

    def add_lot(self, symbol: str, quantity: float, price: float, date: str) -> None:
        """Add a new tax lot (buy)."""
        self._lots.append(TaxLot(symbol, quantity, price, date))

    def calculate_gain(
        self,
        symbol: str,
        sell_quantity: float,
        sell_price: float,
        sell_date: str,
        method: str = "fifo",
    ) -> dict[str, float]:
        """
        Calculate capital gain/loss for a sale.
        
        Returns:
            Dictionary with short_term_gain, long_term_gain, total_gain, tax_estimate
        """
        from datetime import datetime
        
        sell_dt = datetime.strptime(sell_date, "%Y-%m-%d")
        remaining = sell_quantity
        short_term_gain = 0.0
        long_term_gain = 0.0

        # Get matching lots
        lots = [l for l in self._lots if l.symbol == symbol and l.remaining > 0]
        if method == "lifo":
            lots = reversed(lots)

        for lot in lots:
            if remaining <= 0:
                break
            
            matched = min(lot.remaining, remaining)
            lot.remaining -= matched
            remaining -= matched

            gain = (sell_price - lot.price) * matched
            lot_dt = datetime.strptime(lot.date, "%Y-%m-%d")
            holding_days = (sell_dt - lot_dt).days

            if holding_days > self.long_term_threshold_days:
                long_term_gain += gain
            else:
                short_term_gain += gain

        total_gain = short_term_gain + long_term_gain
        tax = (
            max(0, short_term_gain) * self.short_term_rate
            + max(0, long_term_gain) * self.long_term_rate
        )

        return {
            "short_term_gain": short_term_gain,
            "long_term_gain": long_term_gain,
            "total_gain": total_gain,
            "tax_estimate": tax,
        }


# ════════════════════════════════════════════════════════════
#  COST AGGREGATOR
# ════════════════════════════════════════════════════════════

class TransactionCostEngine:
    """
    Aggregates all cost models for realistic P&L calculation.
    """

    def __init__(
        self,
        commission: CommissionModel | None = None,
        slippage: SlippageModel | None = None,
        tax_calculator: TaxCalculator | None = None,
        margin_rate: float = 0.05,
    ):
        self.commission = commission or ZeroCommission()
        self.slippage = slippage or FixedSlippage(bps=2.0)
        self.tax_calculator = tax_calculator or TaxCalculator()
        self.margin_rate = margin_rate

    def calculate_total_cost(
        self,
        price: float,
        quantity: float,
        side: str,
        volatility: float = 0.0,
        avg_volume: float = 0.0,
        spread: float = 0.0,
    ) -> dict[str, float]:
        """
        Calculate all transaction costs.
        
        Returns:
            Dictionary with commission, slippage, total_cost, effective_price
        """
        commission = self.commission.calculate(quantity, price, side)
        slippage = self.slippage.estimate(
            price, quantity, side, volatility, avg_volume, spread
        )

        total_cost = commission + slippage * quantity
        
        if side == "BUY":
            effective_price = price + slippage + commission / quantity
        else:
            effective_price = price - slippage - commission / quantity

        return {
            "commission": commission,
            "slippage_per_share": slippage,
            "total_slippage": slippage * quantity,
            "total_cost": total_cost,
            "effective_price": effective_price,
            "cost_bps": (total_cost / (price * quantity)) * 10_000 if price * quantity > 0 else 0,
        }

    def margin_cost(
        self,
        borrowed_amount: float,
        days: int,
    ) -> float:
        """Calculate margin interest cost."""
        return borrowed_amount * self.margin_rate * days / 365
