"""
CITADEL — FastAPI Server with WebSocket Support

The API layer connecting the Python backend to the Tauri/React GUI.

Features:
  - REST endpoints for system control, portfolio, history
  - WebSocket for real-time streaming (ticks, signals, agent CoT)
  - Arrow IPC for zero-copy data transfer
  - CORS configured for Tauri localhost
  - Health checks and system status
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

import numpy as np
import structlog
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

logger = structlog.get_logger(__name__)


# ── Request/Response Models ────────────────────────────────

class SystemStatusResponse(BaseModel):
    state: str
    uptime_s: float
    agents: dict[str, Any]
    portfolio: dict[str, Any] | None
    risk: dict[str, Any] | None


class PortfolioResponse(BaseModel):
    total_equity: float
    cash: float
    positions: list[dict[str, Any]]
    daily_pnl: float
    total_pnl: float
    leverage: float


class TradeRequest(BaseModel):
    symbol: str
    action: str  # BUY, SELL
    quantity: float | None = None
    size_pct: float | None = None
    order_type: str = "MARKET"
    limit_price: float | None = None


class BacktestRequest(BaseModel):
    strategy: str
    symbols: list[str]
    start_date: str
    end_date: str
    initial_capital: float = 100_000.0
    params: dict[str, Any] | None = None


class ReportRequest(BaseModel):
    report_type: str = "daily"
    date: str | None = None
    email: bool = False
    sections: list[str] | None = None     # optional section filter
    date_range_start: str | None = None   # for custom range reports
    date_range_end: str | None = None
    format: str = "pdf"                   # pdf or html


class ReportScheduleRequest(BaseModel):
    report_type: str = "daily"
    cron: str = "0 17 30 * * 1-5"         # cron expression
    email: bool = True
    enabled: bool = True


class KillSwitchRequest(BaseModel):
    action: str  # activate, deactivate, reset
    level: str | None = None  # L1, L2, L3


# ── WebSocket Manager ────────────────────────────────────

class ConnectionManager:
    """Manage active WebSocket connections."""

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {
            "ticks": [],
            "signals": [],
            "portfolio": [],
            "agents": [],
            "cot": [],  # Chain-of-Thought stream
            "system": [],
        }
        self._broadcast_queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

    async def connect(self, ws: WebSocket, channel: str) -> None:
        """Accept and register a WebSocket connection."""
        await ws.accept()
        if channel not in self._connections:
            self._connections[channel] = []
        self._connections[channel].append(ws)
        logger.info("ws.connected", channel=channel, total=len(self._connections[channel]))

    def disconnect(self, ws: WebSocket, channel: str) -> None:
        """Remove a WebSocket connection."""
        if channel in self._connections:
            self._connections[channel] = [
                c for c in self._connections[channel] if c != ws
            ]
        logger.info("ws.disconnected", channel=channel)

    async def broadcast(self, channel: str, data: dict[str, Any]) -> None:
        """Broadcast message to all connections in a channel."""
        if channel not in self._connections:
            return
        
        disconnected = []
        message = json.dumps(data, default=str)
        
        for ws in self._connections[channel]:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(ws)
        
        # Cleanup disconnected
        for ws in disconnected:
            self._connections[channel] = [
                c for c in self._connections[channel] if c != ws
            ]

    @property
    def connection_count(self) -> dict[str, int]:
        """Get connection counts per channel."""
        return {ch: len(conns) for ch, conns in self._connections.items()}


# ── Global State ──────────────────────────────────────────

_state: dict[str, Any] = {
    "start_time": time.time(),
    "system_state": "IDLE",
    "ws_manager": ConnectionManager(),
    "live_engine": None,
    "backtest_engine": None,
    "agents": {},
    "data_store": None,
    "report_gen": None,
    "config": None,
}


def set_engine(name: str, engine: Any) -> None:
    """Register an engine/component with the API server."""
    _state[name] = engine


def set_agents(agents: dict[str, Any]) -> None:
    """Register agents."""
    _state["agents"] = agents


# ── App Factory ───────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """App lifespan handler."""
    logger.info("api.starting")
    _state["start_time"] = time.time()
    
    # Start broadcast loop
    broadcast_task = asyncio.create_task(_broadcast_loop())
    
    yield
    
    broadcast_task.cancel()
    logger.info("api.shutdown")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="CITADEL Trading System",
        description="Enterprise-grade multi-agent algorithmic trading platform",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS for Tauri localhost
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:1420",  # Tauri dev
            "http://localhost:5173",  # Vite dev
            "tauri://localhost",  # Tauri production
            "https://tauri.localhost",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── REST Endpoints ────────────────────────────────

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

    @app.get("/api/status", response_model=SystemStatusResponse)
    async def system_status() -> SystemStatusResponse:
        agents_info = {}
        for name, agent in _state.get("agents", {}).items():
            try:
                status_val = agent.status() if callable(getattr(agent, "status", None)) else str(getattr(agent, "status", "unknown"))
                agents_info[name] = {
                    "status": status_val if isinstance(status_val, str) else status_val.get("running", False) and "running" or "idle",
                    "uptime": getattr(agent, "uptime", 0),
                }
            except Exception:
                agents_info[name] = {"status": "error"}

        return SystemStatusResponse(
            state=_state.get("system_state", "IDLE"),
            uptime_s=time.time() - _state.get("start_time", time.time()),
            agents=agents_info,
            portfolio=None,
            risk=None,
        )

    @app.get("/api/portfolio")
    async def get_portfolio() -> PortfolioResponse:
        engine = _state.get("live_engine")
        if not engine:
            return PortfolioResponse(
                total_equity=0, cash=0, positions=[],
                daily_pnl=0, total_pnl=0, leverage=0,
            )
        
        snapshot = getattr(engine, "portfolio_snapshot", None)
        if snapshot and callable(snapshot):
            snap = snapshot()
            return PortfolioResponse(
                total_equity=snap.total_equity,
                cash=snap.cash,
                positions=[p.model_dump(mode="json") for p in snap.positions],
                daily_pnl=snap.daily_pnl,
                total_pnl=snap.total_pnl,
                leverage=snap.leverage,
            )
        
        return PortfolioResponse(
            total_equity=0, cash=0, positions=[],
            daily_pnl=0, total_pnl=0, leverage=0,
        )

    @app.get("/api/positions")
    async def get_positions() -> list[dict[str, Any]]:
        engine = _state.get("live_engine")
        if not engine:
            return []
        snapshot_fn = getattr(engine, "portfolio_snapshot", None)
        if snapshot_fn and callable(snapshot_fn):
            snap = snapshot_fn()
            return [p.model_dump(mode="json") for p in snap.positions]
        return []

    @app.get("/api/history/trades")
    async def trade_history(
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        store = _state.get("data_store")
        if not store:
            return []
        try:
            trades = store.query_trades(symbol=symbol, limit=limit)
            return trades
        except Exception:
            return []

    @app.get("/api/history/pnl")
    async def pnl_history(days: int = 30) -> list[dict[str, Any]]:
        store = _state.get("data_store")
        if not store:
            return []
        try:
            return store.query_daily_pnl(days=days)
        except Exception:
            return []

    @app.get("/api/agents")
    async def get_agents() -> dict[str, Any]:
        result = {}
        for name, agent in _state.get("agents", {}).items():
            try:
                status_val = agent.status() if callable(getattr(agent, "status", None)) else str(getattr(agent, "status", "unknown"))
                status_str = status_val if isinstance(status_val, str) else ("running" if status_val.get("running") else "idle")
                metrics_val = agent.metrics.to_dict() if hasattr(getattr(agent, "metrics", None), "to_dict") else {}
                result[name] = {
                    "status": status_str,
                    "metrics": metrics_val,
                }
                # Agent-specific data
                if hasattr(agent, "get_analysis_summary"):
                    try:
                        result[name]["analysis"] = agent.get_analysis_summary()
                    except Exception:
                        pass
                if hasattr(agent, "get_lessons"):
                    try:
                        result[name]["lessons"] = agent.get_lessons()[-5:]
                    except Exception:
                        pass
            except Exception:
                result[name] = {"status": "error"}
        return result

    @app.get("/api/agents/{agent_name}/cot")
    async def get_agent_cot(agent_name: str) -> dict[str, Any]:
        agent = _state.get("agents", {}).get(agent_name)
        if not agent:
            raise HTTPException(404, f"Agent '{agent_name}' not found")
        
        cot_fn = getattr(agent, "get_cot_stream", None)
        if cot_fn and callable(cot_fn):
            return {"chain_of_thought": cot_fn()}
        
        return {"chain_of_thought": []}

    @app.post("/api/trade")
    async def submit_trade(request: TradeRequest) -> dict[str, Any]:
        engine = _state.get("live_engine")
        if not engine:
            raise HTTPException(503, "Live engine not running")
        
        try:
            order_id = await engine.submit_order(
                symbol=request.symbol,
                action=request.action,
                quantity=request.quantity,
                size_pct=request.size_pct,
                order_type=request.order_type,
                limit_price=request.limit_price,
            )
            return {"order_id": order_id, "status": "submitted"}
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.post("/api/backtest")
    async def run_backtest(request: BacktestRequest) -> dict[str, Any]:
        engine = _state.get("backtest_engine")
        if not engine:
            raise HTTPException(503, "Backtest engine not available")
        
        try:
            result = await engine.run(
                strategy_name=request.strategy,
                symbols=request.symbols,
                start_date=request.start_date,
                end_date=request.end_date,
                initial_capital=request.initial_capital,
                params=request.params,
            )
            return result.to_dict() if hasattr(result, "to_dict") else {"status": "completed"}
        except Exception as e:
            raise HTTPException(400, str(e))

    @app.post("/api/report")
    async def generate_report(request: ReportRequest) -> dict[str, Any]:
        gen = _state.get("report_gen")
        if not gen:
            # Lazy-initialize a ReportGenerator if not registered via CLI
            try:
                from src.reports.generator import ReportGenerator
                gen = ReportGenerator(
                    config=(_state.get("config") or {}).get("reports", {}) if isinstance(_state.get("config"), dict) else {},
                    data_store=_state.get("data_store"),
                    agents=_state.get("agents", {}),
                )
                _state["report_gen"] = gen
                logger.info("report_gen.lazy_initialized")
            except Exception as e:
                logger.error("report_gen.init_failed", error=str(e))
                raise HTTPException(503, f"Report generator initialization failed: {e}")
        
        try:
            path = await gen.generate(
                report_type=request.report_type,
                date=request.date,
                send_email=request.email,
            )
            return {"path": str(path), "status": "generated"}
        except Exception as e:
            logger.error("report.generation_failed", error=str(e))
            raise HTTPException(500, str(e))

    @app.get("/api/reports")
    async def list_reports(
        report_type: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List all generated PDF reports with metadata."""
        reports_dir = Path("reports")
        if not reports_dir.exists():
            return []

        files: list[dict[str, Any]] = []
        for f in sorted(reports_dir.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True):
            stat = f.stat()
            name_parts = f.stem.split("_")
            rtype = name_parts[1] if len(name_parts) > 1 else "unknown"
            rdate = name_parts[2] if len(name_parts) > 2 else ""
            if report_type and rtype != report_type:
                continue
            files.append({
                "filename": f.name,
                "path": str(f),
                "type": rtype,
                "date": rdate,
                "size_bytes": stat.st_size,
                "size_display": f"{stat.st_size / 1024:.1f} KB",
                "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
            if len(files) >= limit:
                break
        return files

    @app.get("/api/reports/download/{filename}")
    async def download_report(filename: str) -> FileResponse:
        """Download a generated PDF report."""
        filepath = Path("reports") / filename
        if not filepath.exists() or not filepath.suffix == ".pdf":
            raise HTTPException(404, f"Report '{filename}' not found")
        return FileResponse(
            path=str(filepath),
            media_type="application/pdf",
            filename=filename,
        )

    @app.delete("/api/reports/{filename}")
    async def delete_report(filename: str) -> dict[str, str]:
        """Delete a generated report."""
        filepath = Path("reports") / filename
        if not filepath.exists():
            raise HTTPException(404, f"Report '{filename}' not found")
        filepath.unlink()
        logger.info("report.deleted", filename=filename)
        return {"status": "deleted", "filename": filename}

    @app.get("/api/reports/stats")
    async def report_stats() -> dict[str, Any]:
        """Get aggregate report statistics."""
        reports_dir = Path("reports")
        if not reports_dir.exists():
            return {"total": 0, "total_size": "0 KB", "by_type": {}, "last_generated": None}
        pdfs = list(reports_dir.glob("*.pdf"))
        total_size = sum(f.stat().st_size for f in pdfs)
        by_type: dict[str, int] = {}
        for f in pdfs:
            parts = f.stem.split("_")
            rtype = parts[1] if len(parts) > 1 else "unknown"
            by_type[rtype] = by_type.get(rtype, 0) + 1
        last = max(pdfs, key=lambda p: p.stat().st_mtime) if pdfs else None
        return {
            "total": len(pdfs),
            "total_size": f"{total_size / 1024:.1f} KB" if total_size < 1_048_576 else f"{total_size / 1_048_576:.1f} MB",
            "total_size_bytes": total_size,
            "by_type": by_type,
            "last_generated": datetime.fromtimestamp(last.stat().st_mtime, tz=timezone.utc).isoformat() if last else None,
            "last_filename": last.name if last else None,
        }

    @app.get("/api/reports/schedules")
    async def get_schedules() -> list[dict[str, Any]]:
        """Get configured report schedules."""
        schedules = _state.get("report_schedules", [
            {"id": "sched-1", "type": "daily", "cron": "0 30 16 * * 1-5", "email": True, "enabled": True,
             "description": "Daily report at market close (4:30 PM ET)"},
            {"id": "sched-2", "type": "weekly", "cron": "0 0 10 * * 6", "email": True, "enabled": True,
             "description": "Weekly summary every Saturday 10:00 AM ET"},
            {"id": "sched-3", "type": "backtest", "cron": "0 0 6 1 * *", "email": False, "enabled": False,
             "description": "Monthly backtest report (disabled)"},
        ])
        return schedules

    @app.post("/api/reports/schedules")
    async def update_schedule(request: ReportScheduleRequest) -> dict[str, Any]:
        """Add or update a report schedule."""
        schedules = _state.get("report_schedules", [])
        new_sched = {
            "id": f"sched-{len(schedules) + 1}",
            "type": request.report_type,
            "cron": request.cron,
            "email": request.email,
            "enabled": request.enabled,
            "description": f"{request.report_type.title()} report ({request.cron})",
        }
        schedules.append(new_sched)
        _state["report_schedules"] = schedules
        return {"status": "created", "schedule": new_sched}

    @app.get("/api/reports/config")
    async def report_config() -> dict[str, Any]:
        """Get report configuration info."""
        return {
            "available_types": ["daily", "weekly", "backtest"],
            "available_sections": {
                "daily": [
                    "Executive Summary", "Portfolio Overview", "Today's Activity",
                    "P&L Analysis", "Agent Learnings", "Risk Metrics",
                    "Market News", "Performance Metrics", "Strategy Breakdown", "Outlook",
                ],
                "weekly": ["Performance Summary", "Strategy Attribution", "Risk Analysis", "Agent Evolution"],
                "backtest": ["Parameters", "Equity Curve", "Drawdowns", "Trade Log", "Statistics"],
            },
            "output_dir": str(Path("reports").resolve()),
            "email_configured": bool(_state.get("report_gen") and getattr(_state["report_gen"], "_email_config", {}).get("smtp", {}).get("host")),
            "formats": ["pdf"],
        }

    @app.post("/api/killswitch")
    async def kill_switch(request: KillSwitchRequest) -> dict[str, Any]:
        sentinel = _state.get("agents", {}).get("Sentinel")
        if not sentinel:
            raise HTTPException(503, "Sentinel agent not available")
        
        if request.action == "activate":
            level = request.level or "L1"
            await sentinel.activate_kill_switch(level, "Manual activation via API")
            return {"status": "activated", "level": level}
        elif request.action == "reset":
            await sentinel.reset_kill_switch()
            return {"status": "reset"}
        
        raise HTTPException(400, f"Unknown action: {request.action}")

    @app.get("/api/strategies")
    async def get_strategies() -> list[dict[str, Any]]:
        config = _state.get("config")
        if not config:
            return []
        strategies = getattr(config, "strategies", [])
        return [s.model_dump(mode="json") if hasattr(s, "model_dump") else s for s in strategies]

    @app.get("/api/risk")
    async def get_risk_metrics() -> dict[str, Any]:
        sentinel = _state.get("agents", {}).get("Sentinel")
        if not sentinel:
            return {}
        metrics_fn = getattr(sentinel, "get_risk_metrics", None)
        if metrics_fn and callable(metrics_fn):
            return metrics_fn()
        return {}

    @app.get("/api/news")
    async def get_news(limit: int = 20) -> list[dict[str, Any]]:
        librarian = _state.get("agents", {}).get("Librarian")
        if not librarian:
            return []
        news_fn = getattr(librarian, "get_recent_articles", None)
        if news_fn and callable(news_fn):
            return news_fn(limit=limit)
        return []

    @app.get("/api/learnings")
    async def get_learnings(category: str | None = None) -> list[dict[str, Any]]:
        student = _state.get("agents", {}).get("Student")
        if not student:
            return []
        lessons_fn = getattr(student, "get_lessons", None)
        if lessons_fn and callable(lessons_fn):
            return lessons_fn(category=category)
        return []

    # ── WebSocket Endpoints ───────────────────────────

    @app.websocket("/ws/{channel}")
    async def websocket_endpoint(ws: WebSocket, channel: str) -> None:
        manager: ConnectionManager = _state["ws_manager"]
        
        if channel not in manager._connections:
            await ws.close(code=4000, reason=f"Unknown channel: {channel}")
            return
        
        await manager.connect(ws, channel)
        
        try:
            while True:
                # Keep alive — also accept commands from frontend
                data = await ws.receive_text()
                try:
                    msg = json.loads(data)
                    await _handle_ws_message(channel, msg)
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            manager.disconnect(ws, channel)

    return app


async def _handle_ws_message(channel: str, msg: dict[str, Any]) -> None:
    """Handle incoming WebSocket messages from the frontend."""
    cmd = msg.get("command")
    
    if cmd == "ping":
        manager: ConnectionManager = _state["ws_manager"]
        await manager.broadcast(channel, {"type": "pong", "timestamp": time.time()})
    elif cmd == "subscribe":
        # Additional subscription logic
        pass


async def _broadcast_loop() -> None:
    """Background loop that broadcasts state updates to WebSocket clients."""
    manager: ConnectionManager = _state["ws_manager"]
    
    while True:
        try:
            # Portfolio updates (every 1s)
            engine = _state.get("live_engine")
            if engine:
                snapshot_fn = getattr(engine, "portfolio_snapshot", None)
                if snapshot_fn and callable(snapshot_fn):
                    snap = snapshot_fn()
                    await manager.broadcast("portfolio", {
                        "type": "portfolio_update",
                        "data": snap.model_dump(mode="json") if hasattr(snap, "model_dump") else {},
                        "timestamp": time.time(),
                    })

            # Agent status updates (every 2s)
            agents_data = {}
            for name, agent in _state.get("agents", {}).items():
                try:
                    s = agent.status() if callable(getattr(agent, "status", None)) else "unknown"
                    agents_data[name] = {
                        "status": s if isinstance(s, str) else "running" if s.get("running") else "idle",
                    }
                except Exception:
                    pass
            
            if agents_data:
                await manager.broadcast("agents", {
                    "type": "agents_update",
                    "data": agents_data,
                    "timestamp": time.time(),
                })

            # System heartbeat
            await manager.broadcast("system", {
                "type": "heartbeat",
                "state": _state.get("system_state", "IDLE"),
                "connections": manager.connection_count,
                "timestamp": time.time(),
            })

            await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("broadcast_loop.error", error=str(e))
            await asyncio.sleep(5.0)
