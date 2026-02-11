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
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

import numpy as np
import structlog
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
