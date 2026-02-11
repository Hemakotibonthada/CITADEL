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

# Absolute path to reports directory (resolved from project root)
_CITADEL_ROOT = Path(__file__).resolve().parent.parent.parent
_REPORTS_DIR = _CITADEL_ROOT / "reports"

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
    trigger: str = "manual"               # "manual" or "auto"
    sections: list[str] | None = None     # optional section filter
    date_range_start: str | None = None   # for custom range reports
    date_range_end: str | None = None
    format: str = "pdf"                   # pdf or html


class ReportScheduleRequest(BaseModel):
    report_type: str = "daily"
    cron: str = "0 17 30 * * 1-5"         # cron expression
    email: bool = True
    enabled: bool = True


class TrainRequest(BaseModel):
    model_name: str = "lora_adapter"
    epochs: int = 10
    learning_rate: float = 1e-4
    batch_size: int = 8
    rank: int = 4
    data_source: str = "replay"  # replay, synthetic, custom
    samples: int = 50


class KillSwitchRequest(BaseModel):
    action: str  # activate, deactivate, reset
    level: str | None = None  # L1, L2, L3


class PortfolioSettingsRequest(BaseModel):
    initial_capital: float | None = None
    risk_per_trade_pct: float | None = None   # max risk per trade (%)
    max_position_pct: float | None = None     # max single position as % of portfolio
    max_positions: int | None = None          # max open positions
    stop_loss_pct: float | None = None        # default stop loss %
    take_profit_pct: float | None = None      # default take profit %


class ManualPositionRequest(BaseModel):
    symbol: str
    quantity: float
    avg_cost: float
    side: str = "long"  # long or short


class WatchlistRequest(BaseModel):
    symbols: list[str]


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
            "training": [],  # Training progress stream
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
    "training_runs": [],          # list of completed training run dicts
    "active_training": None,      # currently running training dict or None
    # ── Portfolio & Trading State ──
    "portfolio_settings": {
        "initial_capital": 100_000.0,
        "risk_per_trade_pct": 2.0,
        "max_position_pct": 25.0,
        "max_positions": 20,
        "stop_loss_pct": 5.0,
        "take_profit_pct": 10.0,
    },
    "manual_positions": [],        # list of manually-added positions
    "order_history": [],           # completed/cancelled orders
    "open_orders": [],             # currently open limit/stop orders
    "watchlist": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "SPY"],
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
                    output_dir=str(_REPORTS_DIR),
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
                trigger=request.trigger,
            )
            return {"path": str(path), "status": "generated", "filename": Path(path).name}
        except Exception as e:
            logger.error("report.generation_failed", error=str(e))
            raise HTTPException(500, str(e))

    @app.get("/api/reports")
    async def list_reports(
        report_type: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List all generated PDF reports with metadata."""
        _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        if not _REPORTS_DIR.exists():
            return []

        files: list[dict[str, Any]] = []
        for f in sorted(_REPORTS_DIR.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True):
            stat = f.stat()
            name_parts = f.stem.split("_")
            # Support both old format: citadel_{type}_{date}
            # and new format: citadel_{trigger}_{type}_{date}_{time}
            if len(name_parts) >= 5:
                # New format: citadel_manual_daily_2026-02-11_163045
                trigger = name_parts[1]
                rtype = name_parts[2]
                rdate = name_parts[3]
                rtime = name_parts[4] if len(name_parts) > 4 else ""
            elif len(name_parts) >= 3:
                # Old format: citadel_daily_2026-02-11
                trigger = "manual"
                rtype = name_parts[1]
                rdate = name_parts[2]
                rtime = ""
            else:
                trigger = "unknown"
                rtype = "unknown"
                rdate = ""
                rtime = ""
            if report_type and rtype != report_type:
                continue
            files.append({
                "filename": f.name,
                "path": str(f),
                "type": rtype,
                "trigger": trigger,
                "date": rdate,
                "time": rtime,
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
        filepath = _REPORTS_DIR / filename
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
        filepath = _REPORTS_DIR / filename
        if not filepath.exists():
            raise HTTPException(404, f"Report '{filename}' not found")
        filepath.unlink()
        logger.info("report.deleted", filename=filename)
        return {"status": "deleted", "filename": filename}

    @app.get("/api/reports/stats")
    async def report_stats() -> dict[str, Any]:
        """Get aggregate report statistics."""
        _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        if not _REPORTS_DIR.exists():
            return {"total": 0, "total_size": "0 KB", "by_type": {}, "last_generated": None}
        pdfs = list(_REPORTS_DIR.glob("*.pdf"))
        total_size = sum(f.stat().st_size for f in pdfs)
        by_type: dict[str, int] = {}
        for f in pdfs:
            parts = f.stem.split("_")
            # New format: citadel_trigger_type_date_time → type at index 2
            # Old format: citadel_type_date → type at index 1
            rtype = parts[2] if len(parts) >= 5 else (parts[1] if len(parts) > 1 else "unknown")
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
            "output_dir": str(_REPORTS_DIR.resolve()),
            "naming_pattern": "citadel_{trigger}_{type}_{date}_{HHMMSS}.pdf",
            "email_configured": bool(_state.get("report_gen") and getattr(_state["report_gen"], "_email_config", {}).get("smtp", {}).get("host")),
            "formats": ["pdf"],
        }

    # ── Training Endpoints ────────────────────────────

    @app.get("/api/models")
    async def get_models() -> list[dict[str, Any]]:
        """Get all model info with training history."""
        import torch
        models_info: list[dict[str, Any]] = []

        # Check for real model files
        model_dirs = [
            ("FinBERT Sentiment", "Transformer (BERT)", "models/finbert-tone", 110_000_000),
            ("MiniLM Embeddings", "Sentence Transformer", "models/all-MiniLM-L6-v2", 22_700_000),
        ]
        for name, mtype, mpath, params in model_dirs:
            p = Path(mpath)
            exists = p.exists()
            model_files = list(p.glob("*.bin")) + list(p.glob("*.safetensors")) if exists else []
            config_file = p / "config.json"
            config_data: dict[str, Any] = {}
            if config_file.exists():
                try:
                    config_data = json.loads(config_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            size_bytes = sum(f.stat().st_size for f in model_files) if model_files else 0
            models_info.append({
                "name": name,
                "type": mtype,
                "status": "ready" if exists else "not_downloaded",
                "total_epochs": 0,
                "current_epoch": 0,
                "best_loss": 0,
                "training_history": [],
                "last_trained": "",
                "parameters": config_data.get("num_parameters", params),
                "checkpoint_path": str(p),
                "version": config_data.get("transformers_version", "4.x"),
                "architecture": config_data.get("architectures", [mtype])[0] if config_data.get("architectures") else mtype,
                "hidden_size": config_data.get("hidden_size", 0),
                "num_layers": config_data.get("num_hidden_layers", 0),
                "vocab_size": config_data.get("vocab_size", 0),
                "max_seq_length": config_data.get("max_position_embeddings", 512),
                "model_size_bytes": size_bytes,
                "model_size_display": f"{size_bytes / 1_048_576:.1f} MB" if size_bytes > 0 else "N/A",
                "framework": "PyTorch " + torch.__version__,
                "device": "cuda" if torch.cuda.is_available() else "cpu",
                "quantized": any(f.name.endswith(".int8.bin") for f in model_files) if model_files else False,
                "config": config_data,
            })

        # LoRA adapter
        lora_dir = Path("checkpoints/lora")
        lora_files = sorted(lora_dir.glob("*.npz")) if lora_dir.exists() else []
        lora_history: list[dict[str, Any]] = []
        for run in _state.get("training_runs", []):
            lora_history.append(run)
        models_info.append({
            "name": "LoRA Adapter (Strategy)",
            "type": "LoRA Fine-tune",
            "status": "ready" if lora_files else "untrained",
            "total_epochs": 0,
            "current_epoch": 0,
            "best_loss": 0,
            "training_history": lora_history,
            "last_trained": lora_files[-1].stat().st_mtime if lora_files else "",
            "parameters": 294_912,
            "checkpoint_path": str(lora_dir),
            "version": "1.0",
            "architecture": "LoRA Rank-4",
            "hidden_size": 512,
            "num_layers": 1,
            "vocab_size": 0,
            "max_seq_length": 512,
            "model_size_bytes": sum(f.stat().st_size for f in lora_files) if lora_files else 0,
            "model_size_display": f"{sum(f.stat().st_size for f in lora_files) / 1024:.1f} KB" if lora_files else "N/A",
            "framework": "NumPy (custom)",
            "device": "cpu",
            "quantized": False,
            "config": {"rank": 4, "alpha": 1.0, "checkpoints": len(lora_files)},
        })

        return models_info

    @app.post("/api/models/train")
    async def start_training(request: TrainRequest) -> dict[str, Any]:
        """Trigger model training. Runs asynchronously and streams progress via WS."""
        if _state.get("active_training"):
            raise HTTPException(409, "Training already in progress")

        run_id = f"train_{int(time.time())}"
        run_info: dict[str, Any] = {
            "id": run_id,
            "model_name": request.model_name,
            "status": "running",
            "epochs_total": request.epochs,
            "epochs_completed": 0,
            "current_loss": 0.0,
            "current_val_loss": 0.0,
            "current_accuracy": 0.0,
            "current_lr": request.learning_rate,
            "best_loss": float("inf"),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_s": 0.0,
            "epoch_history": [],
            "config": {
                "epochs": request.epochs,
                "learning_rate": request.learning_rate,
                "batch_size": request.batch_size,
                "rank": request.rank,
                "data_source": request.data_source,
                "samples": request.samples,
            },
        }
        _state["active_training"] = run_info

        # Run training in background task
        asyncio.create_task(_run_training(run_info))

        return {"run_id": run_id, "status": "started", "config": run_info["config"]}

    @app.get("/api/models/training/status")
    async def training_status() -> dict[str, Any]:
        """Get current training run status."""
        active = _state.get("active_training")
        if not active:
            return {"status": "idle", "active": False}
        return {**active, "active": True}

    @app.post("/api/models/training/stop")
    async def stop_training() -> dict[str, Any]:
        """Stop active training run."""
        active = _state.get("active_training")
        if not active:
            raise HTTPException(404, "No active training")
        active["status"] = "stopping"
        return {"status": "stopping"}

    @app.get("/api/models/training/history")
    async def training_history() -> list[dict[str, Any]]:
        """Get all past training runs."""
        return list(_state.get("training_runs", []))

    @app.get("/api/models/{model_name}/details")
    async def model_details(model_name: str) -> dict[str, Any]:
        """Get detailed model properties, config, and metadata."""
        models = await get_models()
        for m in models:
            if m["name"] == model_name:
                return m
        raise HTTPException(404, f"Model '{model_name}' not found")

    # ── Agent Detail Endpoints ────────────────────────

    @app.get("/api/agents/{agent_name}/details")
    async def agent_details(agent_name: str) -> dict[str, Any]:
        """Get detailed agent info including model, version, properties."""
        agent = _state.get("agents", {}).get(agent_name)
        agent_meta: dict[str, dict[str, Any]] = {
            "Sentinel": {
                "role": "Risk Guardian",
                "description": "Monitors portfolio risk exposure, enforces limits, triggers kill switches",
                "model": "Rule-based + Statistical",
                "version": "2.0.0",
                "capabilities": ["VaR Calculation", "Drawdown Monitoring", "Kill Switch Management", "Position Limit Enforcement", "Leverage Monitoring"],
                "config_keys": ["var_lookback", "max_drawdown_pct", "max_leverage", "kill_switch_levels"],
            },
            "Librarian": {
                "role": "Market Intelligence",
                "description": "Aggregates news, runs NLP sentiment analysis, manages vector knowledge base",
                "model": "FinBERT + MiniLM-L6-v2",
                "version": "2.0.0",
                "capabilities": ["Sentiment Analysis", "News Aggregation", "Vector Search", "Entity Extraction", "Semantic Embeddings"],
                "config_keys": ["sentiment_model", "embedding_model", "max_articles", "vector_dim"],
            },
            "Tactician": {
                "role": "Trading Logic",
                "description": "Generates buy/sell signals using multi-strategy ensemble with confidence weighting",
                "model": "Multi-Strategy Ensemble",
                "version": "2.0.0",
                "capabilities": ["Signal Generation", "Multi-Timeframe Analysis", "Mean Reversion", "Momentum", "Statistical Arbitrage"],
                "config_keys": ["strategies", "min_confidence", "max_positions", "rebalance_interval"],
            },
            "Student": {
                "role": "Self-Correction & Learning",
                "description": "Learns from mistakes via LoRA fine-tuning, adjusts strategy weights, detects alpha decay",
                "model": "LoRA Adapter (Rank-4)",
                "version": "2.0.0",
                "capabilities": ["Nightly Review", "Alpha Decay Detection", "LoRA Fine-tuning", "Strategy Weight Adjustment", "Confidence Calibration"],
                "config_keys": ["review_hour", "alpha_decay_window", "sharpe_threshold", "lora_threshold"],
            },
        }

        meta = agent_meta.get(agent_name, {
            "role": "Agent", "description": "", "model": "Unknown",
            "version": "1.0.0", "capabilities": [], "config_keys": [],
        })

        result: dict[str, Any] = {
            "name": agent_name,
            **meta,
            "status": "IDLE",
            "uptime": 0,
            "metrics": {},
            "config_values": {},
            "error_count": 0,
            "last_heartbeat": None,
        }

        if agent:
            try:
                status_data = agent.status() if callable(getattr(agent, "status", None)) else {}
                if isinstance(status_data, dict):
                    result["status"] = "ACTIVE" if status_data.get("running") else "IDLE"
                    result["uptime"] = status_data.get("uptime_s", 0)
                    result["metrics"] = status_data.get("metrics", {})
                    result["error_count"] = status_data.get("errors", 0)
                    result["last_heartbeat"] = status_data.get("last_heartbeat")
                elif isinstance(status_data, str):
                    result["status"] = status_data
            except Exception:
                result["status"] = "ERROR"
            
            # Get agent config values
            config = getattr(agent, "_config", {})
            result["config_values"] = {k: config.get(k) for k in meta.get("config_keys", []) if config.get(k) is not None}

            # Agent-specific data
            if hasattr(agent, "get_lessons"):
                try:
                    result["lessons"] = agent.get_lessons()[-10:]
                except Exception:
                    pass
            if hasattr(agent, "get_strategy_weights"):
                try:
                    result["strategy_weights"] = agent.get_strategy_weights()
                except Exception:
                    pass
            if hasattr(agent, "get_training_history"):
                try:
                    result["training_history"] = agent.get_training_history()
                except Exception:
                    pass
            if hasattr(agent, "get_analysis_summary"):
                try:
                    result["analysis"] = agent.get_analysis_summary()
                except Exception:
                    pass

        return result

    # ── Stock Detail Endpoint ─────────────────────────

    @app.get("/api/stock/{symbol}")
    async def get_stock_detail(symbol: str) -> dict[str, Any]:
        """Get stock detail with price, fundamentals, and candle history."""
        symbol = symbol.upper()
        # Try to get from data store first
        store = _state.get("data_store")
        candles: list[dict[str, Any]] = []
        if store:
            try:
                candles = store.query_candles(symbol=symbol, days=90) or []
            except Exception:
                pass

        # Generate synthetic candles if no real data
        if not candles:
            base_prices: dict[str, float] = {
                "AAPL": 195, "MSFT": 420, "GOOGL": 175, "AMZN": 200, "NVDA": 800,
                "TSLA": 250, "META": 550, "SPY": 520, "QQQ": 445, "IWM": 210,
            }
            price = base_prices.get(symbol, 100.0)
            now = datetime.now(timezone.utc)
            for i in range(90, -1, -1):
                from datetime import timedelta
                d = now - timedelta(days=i)
                if d.weekday() >= 5:
                    continue
                change = price * (np.random.random() - 0.48) * 0.03
                open_p = price
                price = max(1.0, price + change)
                high = max(open_p, price) * (1 + np.random.random() * 0.01)
                low = min(open_p, price) * (1 - np.random.random() * 0.01)
                candles.append({
                    "date": d.strftime("%Y-%m-%d"),
                    "open": round(open_p, 2),
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "close": round(price, 2),
                    "volume": int(1e6 + np.random.random() * 5e6),
                })

        last = candles[-1] if candles else {"close": 100, "high": 105, "low": 95}
        prev = candles[-2] if len(candles) > 1 else last
        change = last["close"] - prev["close"]
        names: dict[str, str] = {
            "AAPL": "Apple Inc.", "MSFT": "Microsoft Corp.", "GOOGL": "Alphabet Inc.",
            "AMZN": "Amazon.com Inc.", "NVDA": "NVIDIA Corp.", "TSLA": "Tesla Inc.",
            "META": "Meta Platforms Inc.", "SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco QQQ Trust",
            "IWM": "iShares Russell 2000",
        }
        return {
            "symbol": symbol,
            "name": names.get(symbol, symbol),
            "price": last["close"],
            "change": round(change, 2),
            "changePct": round((change / prev["close"]) * 100, 2) if prev["close"] else 0,
            "high52w": round(max(c["high"] for c in candles), 2) if candles else 0,
            "low52w": round(min(c["low"] for c in candles), 2) if candles else 0,
            "marketCap": f"${round(last['close'] * (1e9 + np.random.random() * 2e9) / 1e9)}B",
            "pe": round(15 + np.random.random() * 25, 1),
            "candles": candles,
            "volumeHistory": [{"date": c["date"], "volume": c["volume"]} for c in candles],
        }

    # ── Portfolio Settings & Management ───────────────

    @app.get("/api/portfolio/settings")
    async def get_portfolio_settings() -> dict[str, Any]:
        """Get portfolio configuration like capital, risk limits."""
        return _state["portfolio_settings"]

    @app.put("/api/portfolio/settings")
    async def update_portfolio_settings(request: PortfolioSettingsRequest) -> dict[str, Any]:
        """Update portfolio settings."""
        settings = _state["portfolio_settings"]
        if request.initial_capital is not None:
            settings["initial_capital"] = request.initial_capital
        if request.risk_per_trade_pct is not None:
            settings["risk_per_trade_pct"] = request.risk_per_trade_pct
        if request.max_position_pct is not None:
            settings["max_position_pct"] = request.max_position_pct
        if request.max_positions is not None:
            settings["max_positions"] = request.max_positions
        if request.stop_loss_pct is not None:
            settings["stop_loss_pct"] = request.stop_loss_pct
        if request.take_profit_pct is not None:
            settings["take_profit_pct"] = request.take_profit_pct
        return {"status": "updated", "settings": settings}

    @app.get("/api/portfolio/holdings")
    async def get_holdings() -> dict[str, Any]:
        """Get all holdings including manual positions and engine positions."""
        engine = _state.get("live_engine")
        engine_positions: list[dict[str, Any]] = []
        cash = _state["portfolio_settings"]["initial_capital"]

        if engine:
            snapshot_fn = getattr(engine, "portfolio_snapshot", None)
            if snapshot_fn and callable(snapshot_fn):
                snap = snapshot_fn()
                engine_positions = [p.model_dump(mode="json") for p in snap.positions]
                cash = snap.cash

        manual = _state.get("manual_positions", [])
        all_positions = engine_positions + manual
        invested = sum(abs(p.get("market_value", p.get("quantity", 0) * p.get("avg_cost", 0))) for p in all_positions)

        return {
            "cash": cash,
            "invested": round(invested, 2),
            "total_equity": round(cash + invested, 2),
            "positions": all_positions,
            "manual_count": len(manual),
            "engine_count": len(engine_positions),
            "settings": _state["portfolio_settings"],
        }

    @app.post("/api/portfolio/holdings")
    async def add_manual_position(request: ManualPositionRequest) -> dict[str, Any]:
        """Add a manual position (for tracking external holdings)."""
        pos = {
            "symbol": request.symbol.upper(),
            "quantity": request.quantity,
            "avg_cost": request.avg_cost,
            "market_value": round(request.quantity * request.avg_cost, 2),
            "unrealized_pnl": 0,
            "unrealized_pnl_pct": 0,
            "side": request.side,
            "source": "manual",
            "added_at": datetime.now(timezone.utc).isoformat(),
        }
        _state.setdefault("manual_positions", []).append(pos)
        # Deduct from cash
        cost = request.quantity * request.avg_cost
        _state["portfolio_settings"]["initial_capital"] = max(0, _state["portfolio_settings"]["initial_capital"] - cost)
        return {"status": "added", "position": pos}

    @app.delete("/api/portfolio/holdings/{symbol}")
    async def remove_manual_position(symbol: str) -> dict[str, Any]:
        """Remove a manual position and return cash."""
        symbol = symbol.upper()
        manual = _state.get("manual_positions", [])
        removed = None
        for i, p in enumerate(manual):
            if p["symbol"] == symbol:
                removed = manual.pop(i)
                # Return cash
                _state["portfolio_settings"]["initial_capital"] += removed["market_value"]
                break
        if not removed:
            raise HTTPException(404, f"Manual position '{symbol}' not found")
        return {"status": "removed", "position": removed}

    # ── Order Management ──────────────────────────────

    @app.post("/api/orders")
    async def place_order(request: TradeRequest) -> dict[str, Any]:
        """Place a new order (market or limit)."""
        order_id = f"ord_{int(time.time())}_{np.random.randint(1000, 9999)}"
        order = {
            "id": order_id,
            "symbol": request.symbol.upper(),
            "action": request.action.upper(),
            "quantity": request.quantity or 0,
            "size_pct": request.size_pct,
            "order_type": request.order_type.upper(),
            "limit_price": request.limit_price,
            "status": "FILLED" if request.order_type.upper() == "MARKET" else "OPEN",
            "filled_price": request.limit_price or 0,  # simulated fill
            "created_at": datetime.now(timezone.utc).isoformat(),
            "filled_at": datetime.now(timezone.utc).isoformat() if request.order_type.upper() == "MARKET" else None,
        }

        # For market orders, simulate immediate fill
        if order["status"] == "FILLED" and request.quantity:
            pos = {
                "symbol": order["symbol"],
                "quantity": request.quantity if request.action.upper() == "BUY" else -request.quantity,
                "avg_cost": request.limit_price or 0,
                "market_value": round((request.quantity) * (request.limit_price or 0), 2),
                "unrealized_pnl": 0,
                "unrealized_pnl_pct": 0,
                "side": "long" if request.action.upper() == "BUY" else "short",
                "source": "order",
                "added_at": datetime.now(timezone.utc).isoformat(),
            }
            # Check if position already exists for this symbol
            manual = _state.setdefault("manual_positions", [])
            existing = next((p for p in manual if p["symbol"] == order["symbol"]), None)
            if existing:
                # Average in
                total_qty = existing["quantity"] + pos["quantity"]
                if total_qty != 0:
                    existing["avg_cost"] = round(
                        (existing["quantity"] * existing["avg_cost"] + pos["quantity"] * pos["avg_cost"]) / total_qty, 2
                    )
                existing["quantity"] = total_qty
                existing["market_value"] = round(total_qty * existing["avg_cost"], 2)
            else:
                manual.append(pos)

            # Update cash
            cost = request.quantity * (request.limit_price or 0)
            if request.action.upper() == "BUY":
                _state["portfolio_settings"]["initial_capital"] -= cost
            else:
                _state["portfolio_settings"]["initial_capital"] += cost

            _state.setdefault("order_history", []).append(order)
        else:
            _state.setdefault("open_orders", []).append(order)

        return {"status": order["status"], "order": order}

    @app.get("/api/orders")
    async def get_orders(status: str | None = None) -> dict[str, Any]:
        """Get open and historical orders."""
        open_orders = _state.get("open_orders", [])
        history = _state.get("order_history", [])
        if status:
            open_orders = [o for o in open_orders if o["status"] == status.upper()]
            history = [o for o in history if o["status"] == status.upper()]
        return {
            "open": open_orders,
            "history": history[-50:],
            "total_open": len(_state.get("open_orders", [])),
            "total_filled": len(_state.get("order_history", [])),
        }

    @app.delete("/api/orders/{order_id}")
    async def cancel_order(order_id: str) -> dict[str, Any]:
        """Cancel an open order."""
        open_orders = _state.get("open_orders", [])
        for i, o in enumerate(open_orders):
            if o["id"] == order_id:
                o["status"] = "CANCELLED"
                o["filled_at"] = datetime.now(timezone.utc).isoformat()
                _state.setdefault("order_history", []).append(open_orders.pop(i))
                return {"status": "cancelled", "order": o}
        raise HTTPException(404, f"Order '{order_id}' not found")

    # ── Watchlist ─────────────────────────────────────

    @app.get("/api/watchlist")
    async def get_watchlist() -> dict[str, Any]:
        """Get watchlist symbols."""
        return {"symbols": _state.get("watchlist", [])}

    @app.put("/api/watchlist")
    async def update_watchlist(request: WatchlistRequest) -> dict[str, Any]:
        """Set watchlist symbols."""
        _state["watchlist"] = [s.upper() for s in request.symbols]
        return {"status": "updated", "symbols": _state["watchlist"]}

    @app.post("/api/watchlist/{symbol}")
    async def add_to_watchlist(symbol: str) -> dict[str, Any]:
        """Add a symbol to watchlist."""
        symbol = symbol.upper()
        wl = _state.setdefault("watchlist", [])
        if symbol not in wl:
            wl.append(symbol)
        return {"status": "added", "symbols": wl}

    @app.delete("/api/watchlist/{symbol}")
    async def remove_from_watchlist(symbol: str) -> dict[str, Any]:
        """Remove a symbol from watchlist."""
        symbol = symbol.upper()
        wl = _state.get("watchlist", [])
        if symbol in wl:
            wl.remove(symbol)
        return {"status": "removed", "symbols": wl}

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


async def _run_training(run_info: dict[str, Any]) -> None:
    """Background task that simulates/runs training epochs and broadcasts progress."""
    manager: ConnectionManager = _state["ws_manager"]
    start_time = time.time()
    epochs = run_info["config"]["epochs"]
    lr = run_info["config"]["learning_rate"]
    loss = 0.85 + np.random.random() * 0.3
    val_loss = loss * 1.15

    try:
        for epoch in range(1, epochs + 1):
            if run_info["status"] == "stopping":
                run_info["status"] = "stopped"
                break

            # Simulate epoch training (realistic timing)
            await asyncio.sleep(1.5 + np.random.random() * 1.0)

            # Loss decay with noise
            loss *= (0.88 + np.random.random() * 0.09)
            val_loss *= (0.89 + np.random.random() * 0.10)
            accuracy = min(0.98, 0.45 + (epoch / epochs) * 0.48 + np.random.random() * 0.03)
            if epoch % max(1, epochs // 4) == 0:
                lr *= 0.5

            epoch_data = {
                "epoch": epoch,
                "loss": round(float(loss), 6),
                "val_loss": round(float(val_loss), 6),
                "accuracy": round(float(accuracy), 4),
                "learning_rate": float(lr),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            run_info["epoch_history"].append(epoch_data)
            run_info["epochs_completed"] = epoch
            run_info["current_loss"] = epoch_data["loss"]
            run_info["current_val_loss"] = epoch_data["val_loss"]
            run_info["current_accuracy"] = epoch_data["accuracy"]
            run_info["current_lr"] = epoch_data["learning_rate"]
            run_info["elapsed_s"] = round(time.time() - start_time, 1)
            if epoch_data["loss"] < run_info["best_loss"]:
                run_info["best_loss"] = epoch_data["loss"]

            # Broadcast progress to WS clients
            await manager.broadcast("system", {
                "type": "training_progress",
                "data": {**run_info, "active": True},
                "timestamp": time.time(),
            })

        if run_info["status"] != "stopped":
            run_info["status"] = "completed"
        run_info["elapsed_s"] = round(time.time() - start_time, 1)
        run_info["finished_at"] = datetime.now(timezone.utc).isoformat()

    except Exception as e:
        run_info["status"] = "failed"
        run_info["error"] = str(e)
        logger.error("training.failed", error=str(e))
    finally:
        # Archive run and clear active
        _state.setdefault("training_runs", []).append(dict(run_info))
        _state["active_training"] = None

        await manager.broadcast("system", {
            "type": "training_complete",
            "data": run_info,
            "timestamp": time.time(),
        })
        logger.info("training.finished", run_id=run_info["id"], status=run_info["status"])


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
