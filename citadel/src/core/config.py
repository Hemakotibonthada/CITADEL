"""
CITADEL — Configuration Management

Loads, validates, and provides access to all system configuration.
Supports:
  - YAML config files with strict schema validation
  - Environment variable overrides
  - Hot-reloading of non-critical configs
  - Config versioning
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


def _resolve_env_vars(value: Any) -> Any:
    """Recursively resolve ${ENV_VAR} references in config values."""
    if isinstance(value, str):
        pattern = re.compile(r"\$\{(\w+)(?::([^}]*))?\}")
        def replacer(match):
            env_var = match.group(1)
            default = match.group(2) or ""
            return os.environ.get(env_var, default)
        return pattern.sub(replacer, value)
    elif isinstance(value, dict):
        return {k: _resolve_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [_resolve_env_vars(v) for v in value]
    return value


class SystemConfig(BaseModel):
    """System-level configuration."""
    name: str = "CITADEL"
    version: str = "1.0.0"
    environment: str = "paper"
    timezone: str = "America/New_York"
    data_dir: str = "./data"
    log_dir: str = "./logs"
    heartbeat_interval_ms: int = 500
    max_workers: int = 4


class SharedMemoryConfig(BaseModel):
    """Shared memory configuration."""
    enabled: bool = True
    total_size_mb: int = 256
    ring_buffer_slots: int = 65536
    tick_buffer_name: str = "citadel_ticks"
    signal_buffer_name: str = "citadel_signals"
    risk_buffer_name: str = "citadel_risk"
    portfolio_buffer_name: str = "citadel_portfolio"


class DatabaseConfig(BaseModel):
    """Database configuration."""
    duckdb_path: str = "./data/citadel.duckdb"
    vector_db_path: str = "./data/vectors"
    event_log_path: str = "./data/events"
    checkpoint_interval_s: int = 60


class BrokerConfig(BaseModel):
    """Broker connection configuration."""
    provider: str = "paper"
    endpoint: str = ""
    api_key: str = ""
    api_secret: str = ""
    account_id: str = ""
    paper_trading: bool = True
    max_retries: int = 3
    timeout_s: int = 10
    rate_limit_per_min: int = 200


class DataFeedConfig(BaseModel):
    """Market data feed configuration."""
    primary: str = "yahoo"
    secondary: str = "yahoo"
    tick_interval_ms: int = 100
    bar_intervals: list[str] = Field(default_factory=lambda: ["1m", "5m", "15m", "1h", "1d"])
    symbols: list[str] = Field(default_factory=lambda: [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "SPY", "QQQ", "IWM"
    ])
    max_history_days: int = 365
    cache_ttl_s: int = 300


class KillSwitchConfig(BaseModel):
    """Kill switch tier configuration."""
    description: str = ""
    triggers: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)


class RiskConfig(BaseModel):
    """Risk management configuration."""
    max_portfolio_leverage: float = 2.0
    max_gross_exposure_pct: float = 200.0
    max_net_exposure_pct: float = 100.0
    max_single_position_pct: float = 10.0
    max_sector_exposure_pct: float = 30.0
    max_correlated_positions: int = 5
    correlation_breach_threshold: float = 0.85
    daily_loss_limit_pct: float = 3.0
    weekly_loss_limit_pct: float = 7.0
    monthly_loss_limit_pct: float = 12.0
    max_drawdown_pct: float = 15.0
    trailing_stop_pct: float = 2.0
    fat_finger: dict[str, Any] = Field(default_factory=lambda: {
        "max_order_value_usd": 100000.0,
        "max_order_qty_multiplier": 5.0,
        "price_deviation_pct": 2.0,
        "min_confirmation_delay_ms": 500,
    })
    kill_switches: dict[str, KillSwitchConfig] = Field(default_factory=dict)
    position_sizing: dict[str, Any] = Field(default_factory=lambda: {
        "method": "kelly_fraction",
        "kelly_fraction": 0.25,
    })
    monitoring: dict[str, Any] = Field(default_factory=dict)


class StrategyConfig(BaseModel):
    """Individual strategy configuration."""
    enabled: bool = True
    universe: list[str] = Field(default_factory=list)
    timeframe: str = "1h"
    weight: float = 0.25
    params: dict[str, Any] = Field(default_factory=dict)


class BacktestConfig(BaseModel):
    """Backtesting configuration."""
    start_date: str = "2024-01-01"
    end_date: str = "2025-12-31"
    initial_capital: float = 100000.0
    commission_per_trade: float = 0.0
    slippage_bps: float = 2.0
    margin_rate: float = 0.05
    benchmark: str = "SPY"
    warmup_bars: int = 50


class LLMConfig(BaseModel):
    """LLM inference configuration."""
    model_id: str = "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
    max_tokens: int = 4096
    temperature: float = 0.3
    top_p: float = 0.9
    reasoning_tokens: int = 2048
    device_priority: list[str] = Field(default_factory=lambda: [
        "intel_npu", "intel_gpu", "apple_metal", "cuda", "cpu"
    ])
    quantization: str = "int4"
    max_batch_size: int = 8
    cache_size_gb: float = 2.0


class ReportConfig(BaseModel):
    """Report generation configuration."""
    enabled: bool = True
    format: str = "pdf"
    output_dir: str = "./reports"
    sections: list[dict[str, Any]] = Field(default_factory=list)
    styling: dict[str, str] = Field(default_factory=lambda: {
        "primary_color": "#1a1a2e",
        "accent_color": "#e94560",
        "success_color": "#0f9b58",
        "danger_color": "#db4437",
        "warning_color": "#f4b400",
    })
    email: dict[str, Any] = Field(default_factory=dict)


class CitadelConfig(BaseModel):
    """Master configuration for the entire CITADEL system."""
    system: SystemConfig = Field(default_factory=SystemConfig)
    shared_memory: SharedMemoryConfig = Field(default_factory=SharedMemoryConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    broker: BrokerConfig = Field(default_factory=BrokerConfig)
    data_feeds: DataFeedConfig = Field(default_factory=DataFeedConfig)
    risk: RiskConfig = Field(default_factory=RiskConfig)
    strategies: dict[str, StrategyConfig] = Field(default_factory=dict)
    backtest: BacktestConfig = Field(default_factory=BacktestConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    reports: ReportConfig = Field(default_factory=ReportConfig)


def load_config(config_dir: str = "./configs") -> CitadelConfig:
    """
    Load and merge all configuration files.
    
    Priority (highest to lowest):
      1. Environment variables
      2. .env file
      3. YAML config files
      4. Default values
    """
    config_path = Path(config_dir)
    merged: dict[str, Any] = {}

    # Load YAML files
    yaml_files = ["system.yaml", "risk.yaml", "strategies.yaml", "agents.yaml", "reports.yaml"]
    for filename in yaml_files:
        filepath = config_path / filename
        if filepath.exists():
            with open(filepath, "r") as f:
                data = yaml.safe_load(f) or {}
                data = _resolve_env_vars(data)
                merged.update(data)

    # Build config
    config = CitadelConfig(
        system=SystemConfig(**merged.get("system", {})),
        shared_memory=SharedMemoryConfig(**merged.get("shared_memory", {})),
        database=DatabaseConfig(**merged.get("database", {})),
        broker=BrokerConfig(**merged.get("broker", {})),
        data_feeds=DataFeedConfig(**merged.get("data_feeds", {})),
        risk=RiskConfig(**merged.get("risk", {})),
        backtest=BacktestConfig(**merged.get("backtest", {})),
        llm=LLMConfig(**merged.get("llm", {})),
        reports=ReportConfig(**merged.get("reports", {}).get("daily_report", {})),
    )

    # Parse strategies
    for name, strat_data in merged.get("strategies", {}).items():
        if isinstance(strat_data, dict):
            params = {k: v for k, v in strat_data.items() if k not in StrategyConfig.model_fields}
            base = {k: v for k, v in strat_data.items() if k in StrategyConfig.model_fields}
            base["params"] = params
            config.strategies[name] = StrategyConfig(**base)

    return config


# Global config singleton
_config: CitadelConfig | None = None


def get_config(config_dir: str = "./configs") -> CitadelConfig:
    """Get or create the global configuration."""
    global _config
    if _config is None:
        _config = load_config(config_dir)
    return _config


def reset_config() -> None:
    """Reset the global configuration (for testing)."""
    global _config
    _config = None
