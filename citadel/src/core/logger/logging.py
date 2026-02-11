"""
CITADEL — Structured JSON Logging System

Features:
  - JSON-structured output for machine parsing
  - Rich console output for human debugging
  - Per-component log isolation
  - Trade audit trail logging
  - Performance metrics logging
  - Log rotation and archival
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from rich.console import Console
from rich.logging import RichHandler


def setup_logging(
    level: str = "INFO",
    log_dir: str = "./logs",
    json_output: bool = True,
    console_output: bool = True,
    component: str = "citadel",
) -> structlog.BoundLogger:
    """
    Configure structured logging for the CITADEL system.
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_dir: Directory for log files
        json_output: Enable JSON file output
        console_output: Enable rich console output
        component: Component name for log isolation
        
    Returns:
        Configured structlog logger
    """
    os.makedirs(log_dir, exist_ok=True)

    # ── Processors ────────────────────────────────────────
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    # ── Standard Library Logging Setup ────────────────────
    handlers: list[logging.Handler] = []

    if console_output:
        console_handler = RichHandler(
            console=Console(stderr=True),
            show_time=True,
            show_path=False,
            markup=True,
            rich_tracebacks=True,
            tracebacks_show_locals=True,
        )
        console_handler.setLevel(getattr(logging, level.upper()))
        handlers.append(console_handler)

    if json_output:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        json_handler = logging.FileHandler(
            os.path.join(log_dir, f"{component}_{date_str}.jsonl"),
            encoding="utf-8",
        )
        json_handler.setLevel(logging.DEBUG)
        # Use JSON formatter for file output
        json_handler.setFormatter(logging.Formatter("%(message)s"))
        handlers.append(json_handler)

    # Configure root logger
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        handlers=handlers,
        force=True,
    )

    # ── Structlog Configuration ───────────────────────────
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Set formatter for JSON handler
    if json_output and len(handlers) > 1:
        json_formatter = structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
            foreign_pre_chain=shared_processors,
        )
        handlers[-1].setFormatter(json_formatter)

    # Set formatter for console handler
    if console_output:
        console_formatter = structlog.stdlib.ProcessorFormatter(
            processor=structlog.dev.ConsoleRenderer(colors=True),
            foreign_pre_chain=shared_processors,
        )
        handlers[0].setFormatter(console_formatter)

    return structlog.get_logger(component)


class TradeAuditLogger:
    """
    Specialized logger for trade audit trail.
    Every trade action is logged with full context for compliance and review.
    """

    def __init__(self, log_dir: str = "./logs/audit"):
        os.makedirs(log_dir, exist_ok=True)
        self._logger = structlog.get_logger("audit")
        
        # Dedicated audit file
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        handler = logging.FileHandler(
            os.path.join(log_dir, f"audit_{date_str}.jsonl"),
            encoding="utf-8",
        )
        handler.setLevel(logging.INFO)
        
        audit_logger = logging.getLogger("audit")
        audit_logger.addHandler(handler)
        audit_logger.setLevel(logging.INFO)

    def log_order(
        self,
        action: str,
        symbol: str,
        quantity: float,
        price: float,
        order_id: str,
        signal_id: str = "",
        agent: str = "",
        **kwargs: Any,
    ) -> None:
        """Log an order action."""
        self._logger.info(
            "trade.order",
            action=action,
            symbol=symbol,
            quantity=quantity,
            price=price,
            order_id=order_id,
            signal_id=signal_id,
            agent=agent,
            **kwargs,
        )

    def log_fill(
        self,
        order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        commission: float = 0.0,
        **kwargs: Any,
    ) -> None:
        """Log a fill event."""
        self._logger.info(
            "trade.fill",
            order_id=order_id,
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price,
            commission=commission,
            **kwargs,
        )

    def log_risk_event(
        self,
        level: str,
        trigger: str,
        details: dict[str, Any],
        **kwargs: Any,
    ) -> None:
        """Log a risk/kill-switch event."""
        self._logger.warning(
            "trade.risk",
            level=level,
            trigger=trigger,
            details=details,
            **kwargs,
        )

    def log_agent_decision(
        self,
        agent: str,
        action: str,
        symbol: str,
        confidence: float,
        rationale: str,
        **kwargs: Any,
    ) -> None:
        """Log an agent decision."""
        self._logger.info(
            "trade.decision",
            agent=agent,
            action=action,
            symbol=symbol,
            confidence=confidence,
            rationale=rationale,
            **kwargs,
        )


class PerformanceLogger:
    """Logger for system performance metrics."""

    def __init__(self):
        self._logger = structlog.get_logger("performance")

    def log_latency(
        self, component: str, operation: str, latency_ms: float, **kwargs: Any
    ) -> None:
        self._logger.debug(
            "perf.latency",
            component=component,
            operation=operation,
            latency_ms=round(latency_ms, 3),
            **kwargs,
        )

    def log_throughput(
        self, component: str, items_per_sec: float, **kwargs: Any
    ) -> None:
        self._logger.debug(
            "perf.throughput",
            component=component,
            items_per_sec=round(items_per_sec, 2),
            **kwargs,
        )

    def log_memory(
        self, component: str, rss_mb: float, vms_mb: float, **kwargs: Any
    ) -> None:
        self._logger.debug(
            "perf.memory",
            component=component,
            rss_mb=round(rss_mb, 2),
            vms_mb=round(vms_mb, 2),
            **kwargs,
        )
