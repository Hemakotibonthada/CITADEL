# CITADEL — Multi-Agent Algorithmic Trading System

<div align="center">

```
╔═══════════════════════════════════════════════════╗
║              C I T A D E L                        ║
║     Enterprise-Grade Trading Intelligence         ║
║                                                   ║
║  Multi-Agent • Local-First • Hardware-Accelerated ║
╚═══════════════════════════════════════════════════╝
```

**Local-first multi-agent algorithmic trading system with shared memory IPC,
formal verification, hardware-specific kernels, and a Tauri+React GUI.**

</div>

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Tauri + React 19             │
│   Dashboard │ Portfolio │ Brain │ Reports     │
├──────────────────────────────────────────────┤
│              FastAPI + WebSocket              │
├──────────────────────────────────────────────┤
│                  Agent Swarm                  │
│  🛡️ Sentinel  📚 Librarian  🎯 Tactician  🧠 Student │
├──────────────────────────────────────────────┤
│               Trading Engine                  │
│  Strategies │ Backtest │ Live │ Costs │ Risk  │
├──────────────────────────────────────────────┤
│              Shared Memory IPC                │
│  Ring Buffers │ Event Bus │ Event Store       │
├──────────────────────────────────────────────┤
│            Hardware Acceleration              │
│  Intel NPU/GPU (OpenVINO) │ Apple MLX │ CPU  │
├──────────────────────────────────────────────┤
│              Data Layer                       │
│  DuckDB │ FAISS │ Yahoo/Polygon Feeds        │
└──────────────────────────────────────────────┘
```

## Features

### Core Engine
- **Event-driven architecture** with async event bus and event sourcing
- **Shared Memory IPC** — lock-free SPSC ring buffers for sub-millisecond latency
- **DuckDB OLAP** — columnar analytics for backtesting and reporting
- **Formal verification** — property-based testing with Hypothesis

### Multi-Agent Swarm
| Agent | Role | Description |
|-------|------|-------------|
| 🛡️ Sentinel | Risk Guardian | Monitors heartbeats, enforces kill switches (L1/L2/L3), fat finger detection |
| 📚 Librarian | Market Intelligence | News ingestion, FinBERT sentiment, FAISS vector RAG |
| 🎯 Tactician | Trading Logic | Chain-of-Thought reasoning, technical + sentiment + risk analysis |
| 🧠 Student | Self-Correction | Nightly review, alpha decay detection, LoRA fine-tuning |

### Trading Strategies
- **Mean Reversion** — Z-score based entry/exit
- **Momentum** — MACD + RSI + ADX composite
- **Statistical Arbitrage** — Pairs trading with cointegration
- **Multi-Factor** — Weighted strategy ensemble

### Hardware Acceleration
- **Intel** — OpenVINO for NPU/GPU/CPU with automatic device selection
- **Apple** — MLX for M-series Neural Engine
- **CPU** — ONNX Runtime fallback

### GUI (Tauri + React 19)
- Dark-themed trading dashboard with 60FPS animations
- Real-time WebSocket streaming
- "The Brain" — live Chain-of-Thought visualization
- Portfolio management with allocation charts
- Agent monitoring with expandable detail cards
- One-click PDF report generation

### Reports
- **10-section PDF reports** with embedded charts:
  - Executive Summary, Portfolio, Today's Activity, P&L Analysis
  - Agent Learnings, Risk Metrics, Market News, Performance
  - Strategy Breakdown, Outlook
- **Auto-generated** at market close
- **Email delivery** via SMTP
- **Manual trigger** via GUI or CLI

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+ (for GUI)
- DuckDB, NumPy, Pandas

### Installation

```bash
cd citadel

# Python backend
pip install -e .

# Frontend (optional)
cd src-ui && npm install && cd ..
```

### Run

```bash
# Paper trading mode
citadel paper

# Live trading (configure broker in .env first)
citadel live

# Backtest
citadel backtest --strategy momentum --symbols AAPL,MSFT --start-date 2024-01-01 --end-date 2024-12-31

# Generate report
citadel report --type daily --email

# Start GUI dev server
cd src-ui && npm run dev
```

### Configuration

1. Copy `.env.example` → `.env` and fill in API keys
2. Edit `configs/system.yaml` for system settings
3. Edit `configs/risk.yaml` for risk parameters
4. Edit `configs/strategies.yaml` for strategy tuning
5. Edit `configs/agents.yaml` for agent configuration
6. Edit `configs/reports.yaml` for report settings

## Project Structure

```
citadel/
├── configs/              # YAML configuration files
│   ├── system.yaml       # Master system config
│   ├── risk.yaml         # Risk parameters & kill switches
│   ├── strategies.yaml   # Strategy parameters
│   ├── agents.yaml       # Agent configuration
│   └── reports.yaml      # Report generation config
├── src/
│   ├── core/
│   │   ├── models.py     # Domain models, enums, protocols
│   │   ├── config.py     # Configuration management
│   │   ├── shm/          # Shared Memory ring buffers
│   │   ├── event_bus/    # Async event bus + event store
│   │   └── logger/       # Structured logging
│   ├── data/
│   │   ├── feeds.py      # Market data feeds (Yahoo, Polygon, Paper)
│   │   └── storage.py    # DuckDB + FAISS storage
│   ├── engine/
│   │   ├── strategies.py # Trading strategies
│   │   ├── backtest.py   # Backtesting engine
│   │   ├── live.py       # Live trading engine
│   │   ├── costs.py      # Transaction cost models
│   │   └── verify.py     # Formal verification & risk calculator
│   ├── agents/
│   │   ├── base.py       # Base agent class
│   │   ├── sentinel.py   # Risk Guardian
│   │   ├── librarian.py  # News RAG agent
│   │   ├── tactician.py  # Trading logic + CoT
│   │   └── student.py    # Self-correction + LoRA
│   ├── hardware/
│   │   └── accelerator.py # HW abstraction (Intel/Apple/CPU)
│   ├── training/
│   │   └── micro_lora.py # LoRA fine-tuning
│   ├── api/
│   │   └── server.py     # FastAPI + WebSocket server
│   ├── reports/
│   │   └── generator.py  # PDF report generator
│   └── cli.py            # CLI entry point
├── src-ui/               # Tauri + React 19 frontend
│   ├── src/
│   │   ├── App.tsx       # Main app
│   │   ├── store.ts      # Zustand state management
│   │   ├── pages/        # Dashboard, Portfolio, Brain, etc.
│   │   └── components/   # Header, charts
│   └── package.json
├── tests/                # Pytest + Hypothesis test suite
├── pyproject.toml        # Python project config
└── .github/workflows/    # CI/CD pipeline
```

## Kill Switch Levels

| Level | Trigger | Action |
|-------|---------|--------|
| L1 | Single-position loss > 2% | Halt new trades for symbol |
| L2 | Daily portfolio loss > 3% | Close all positions, halt trading |
| L3 | System anomaly / API failure | Emergency shutdown, notification |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.11+ |
| Database | DuckDB (OLAP) |
| IPC | multiprocessing.shared_memory |
| Events | Custom async event bus |
| ML | FinBERT, Sentence Transformers, LoRA |
| Vectors | FAISS |
| API | FastAPI + WebSocket |
| GUI | Tauri 2.0 + React 19 + Zustand |
| Charts | Recharts + Matplotlib |
| Reports | Matplotlib PDF |
| Accel | OpenVINO, MLX |
| Tests | Pytest + Hypothesis |

## License

MIT

---

*Built with precision. Trades with intelligence.*
