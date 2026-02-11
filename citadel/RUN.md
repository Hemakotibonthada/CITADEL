# CITADEL — Quick Start Guide

## 1-Minute Setup

```bash
# Clone & install
cd citadel
pip install -e .

# Copy environment template
cp .env.example .env
# Edit .env with your API keys (at minimum set POLYGON_API_KEY or use paper mode)

# Run in paper-trading mode (no API keys needed)
citadel paper
```

The API server starts at `http://localhost:8000`. Open the dashboard at `http://localhost:8000/docs`.

---

## Detailed Setup

### Step 1: Python Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# Windows CMD:
.\.venv\Scripts\activate.bat
# Linux/macOS:
source .venv/bin/activate

# Install CITADEL
pip install -e .
```

### Step 2: Configuration

```bash
# Copy environment template
cp .env.example .env
```

Edit `.env` with your keys:

```env
# Required for live data
POLYGON_API_KEY=your_key_here

# Optional
NEWS_API_KEY=your_key_here
FINNHUB_API_KEY=your_key_here

# Email reports (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=app_password_here
REPORT_EMAIL_TO=you@gmail.com
```

### Step 3: Run Modes

#### Paper Trading (Simulated)
```bash
citadel paper
```
No API keys needed. Uses geometric Brownian motion for price simulation.

#### Live Trading
```bash
citadel live
```
Requires `POLYGON_API_KEY` in `.env`. **Real money — configure risk.yaml carefully.**

#### Backtesting
```bash
# Single strategy
citadel backtest --strategy momentum --symbols AAPL,MSFT,GOOGL --start-date 2024-01-01 --end-date 2024-12-31

# All strategies
citadel backtest --strategy mean_reversion --symbols SPY --start-date 2023-01-01 --end-date 2024-01-01
```

#### Generate Report
```bash
# PDF only
citadel report --type daily

# PDF + email
citadel report --type daily --email

# Weekly report
citadel report --type weekly --email
```

#### System Status
```bash
citadel status
```

---

## Frontend (Optional)

### Development
```bash
cd src-ui
npm install
npm run dev
```
Opens at `http://localhost:5173` with hot reload. API requests proxy to `http://localhost:8000`.

### Production Build
```bash
cd src-ui
npm run build
```

### Tauri Desktop App
```bash
# Install Tauri CLI
cargo install tauri-cli

cd src-ui
npm run tauri dev    # Development
npm run tauri build  # Production binary
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | System status |
| GET | `/api/portfolio` | Current portfolio |
| GET | `/api/positions` | Open positions |
| GET | `/api/agents` | Agent statuses |
| GET | `/api/agents/{name}/cot` | Agent chain-of-thought |
| GET | `/api/history/trades` | Trade history |
| GET | `/api/history/pnl` | P&L history |
| GET | `/api/risk` | Risk metrics |
| GET | `/api/news` | Recent news |
| GET | `/api/learnings` | Agent learnings |
| GET | `/api/strategies` | Strategy info |
| POST | `/api/trade` | Submit trade |
| POST | `/api/backtest` | Run backtest |
| POST | `/api/report` | Generate report |
| POST | `/api/killswitch` | Toggle kill switch |
| WS | `/ws/{channel}` | WebSocket streams |

### WebSocket Channels
- `ticks` — Real-time price ticks
- `signals` — Trading signals
- `portfolio` — Portfolio updates
- `agents` — Agent status updates
- `cot` — Chain-of-thought stream
- `system` — System events

---

## Tests

```bash
# Run all tests
pytest

# With verbose output
pytest -v

# Property-based tests only
pytest -m property_based

# Specific test file
pytest tests/test_risk.py -v
```

---

## Tuning Configs

### Risk Parameters (`configs/risk.yaml`)
- `max_position_pct`: Max single position as % of equity (default: 5%)
- `max_portfolio_leverage`: Max leverage ratio (default: 2.0)
- `max_daily_loss_pct`: Daily loss limit to trigger L2 kill switch (default: 3%)
- `max_drawdown_pct`: Max drawdown before alert (default: 10%)

### Strategy Parameters (`configs/strategies.yaml`)
- Mean Reversion: `z_entry_threshold`, `z_exit_threshold`, `lookback_period`
- Momentum: `fast_period`, `slow_period`, `signal_period`, `rsi_period`
- Stat Arb: `cointegration_window`, `z_entry`, `z_exit`
- Multi-Factor: `strategy_weights` (ensemble weights)

---

## Troubleshooting

### Common Issues

**DuckDB lock error**
```
Only one process can access a DuckDB database at once.
Stop other CITADEL instances first.
```

**Missing numpy/pandas**
```bash
pip install -e .   # Reinstall with all dependencies
```

**OpenVINO not detected**
```bash
pip install openvino   # Intel acceleration
# Falls back to CPU automatically if not available
```

**Port 8000 in use**
```bash
# Kill existing process
# Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F
# Linux/macOS:
lsof -ti:8000 | xargs kill
```
