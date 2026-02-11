# 🔧 MASTER PROMPT: PROJECT CITADEL — ENTERPRISE LOCAL-FIRST TRADING SYSTEM

**ROLE & OBJECTIVE**
You are a Principal Quant Architect and Senior ML Systems Engineer. Your objective is to build **"CITADEL"**, an industrial-grade, **local-first** multi-agent algorithmic trading system.

**SCALE REQUIREMENT:**
The target codebase complexity is **50,000+ lines of code (LOC)**.
You must move beyond simple scripts. You are building a **Platform**, not just a bot. This requires:
1.  **Strict Domain-Driven Design (DDD)** with Interface/Protocol definitions.
2.  **Shared Memory IPC** for sub-millisecond data transfer between agents.
3.  **Formal Verification** logic to mathematically prove risk safety.
4.  **Hardware-Specific Kernels** (Intel NPU/GPU & Apple Silicon Metal).
5.  **Hyper-Local GUI** (Tauri 2.0 + React 19) with 60FPS rendering.

---

## 1. CORE ARCHITECTURE (THE "OMNI-KERNEL")

### A) The Nervous System (IPC & Data)
- **Shared Memory Bus:** Implement `core.kernel.shm` using Python's `multiprocessing.shared_memory`. Market data, signals, and risk flags must exist in ring buffers to minimize serialization overhead between the *Data Ingester*, *Strategy Engine*, and *UI Bridge*.
- **DuckDB + Apache Arrow:** Use **DuckDB** for heavy OLAP queries (backtesting) and **Apache Arrow** for zero-copy memory sharing with the frontend.
- **Event Sourcing:** The system state must be reconstructible from an append-only log of events (Ticks, Signals, Fills, UserActions).

### B) The "Iron Dome" Risk Layer
- **Formal Verification:** Create a `src/verify/` module using **Hypothesis** (property-based testing). You must define invariants (e.g., `TotalExposure <= AccountValue * Leverage`) and prove they cannot be violated by any strategy input.
- **Multi-Tier Kill-Switches:**
  - **L1 (Soft):** Block new opens (Strategy drift).
  - **L2 (Hard):** Liquidate specific sector (Correlation breach).
  - **L3 (Nuclear):** Sever API connections and lock GUI (P&L breach or API error).

### C) Hardware Acceleration (The "Edge" Compute)
- **Windows (Intel Meteor Lake/Arrow Lake):**
  - Implement `llm.ov_engine.py` using **OpenVINO GenAI**.
  - Target **NPU (Neural Processing Unit)** for background tasks (News Sentiment, Anomaly Detection).
  - Target **iGPU/dGPU** for the heavy "Trader Agent" reasoning (DeepSeek-R1-Distill).
  - Include `installers/intel_setup.ps1` for driver/runtime prerequisites.
- **macOS (Apple Silicon):**
  - Implement `llm.mlx_engine.py` using **Apple MLX** or **llama.cpp** with Metal backend.
  - Unified memory optimizations for simultaneous LLM inference and backtest processing.

---

## 2. THE MULTI-AGENT SWARM

### Agent 1: The "Sentinel" (Risk & Supervisor)
- Runs in a dedicated high-priority process.
- Monitors system health (heartbeats), broker latency, and "Fat Finger" heuristics.
- Has the authority to `SIGKILL` other agents if they violate safety protocols.

### Agent 2: The "Librarian" (Market Intelligence)
- **Ingestion:** Fetches news/macro data (APIs + Scrapers).
- **RAG Pipeline:** Stores embeddings locally (FAISS or DuckDB vector).
- **Output:** Produces a real-time `sentiment_tensor` written to Shared Memory.

### Agent 3: The "Tactician" (Trader Logic)
- **Reasoning:** Uses **Chain-of-Thought (CoT)** to plan trades based on Price + News + Risk.
- **Output:** Structured JSON decisions (`Action: BUY, Confidence: 0.85, Rationale: ...`).
- **Reflection:** Logs "Mental State" for post-market analysis.

### Agent 4: The "Student" (Self-Correction)
- **Nightly Loop (5:00 PM):**
  - Replays the day's logs.
  - Identifies "Alpha Decay" or "Model Drift."
  - Triggers a **LoRA Fine-Tuning** job using **OpenVINO Training Extensions (OVTE)** to update the model weights for the next day.

---

## 3. THE FRONTEND (TAURI 2.0 + REACT 19)

- **Architecture:** Rust backend (Tauri) binding directly to the Python Kernel via local WebSocket or Shared Memory reader.
- **UI Components:**
  - **Framer Motion:** Smooth, professional animations for state changes (not just flashiness, but functional cues).
  - **Canvas/WebGL Charts:** Custom implementation capable of rendering 1M+ candles without lag.
  - **"The Brain" View:** A real-time visualization of the Agent's CoT streaming (token by token) as it analyzes the market.
- **State Management:** `Zustand` with persistence. Layouts must be savable/loadable.

---

## 4. DETAILED SCOPE & FILE STRUCTURE

Generate the repository structure below. Use **Markdown** code blocks for each file.

```text
citadel/
├── .github/workflows/          # CI for local testing
├── assets/                     # Professional icons/fonts
├── configs/                    # YAML configs (Strict Schema Validation)
├── data/                       # Parquet (Price) + LanceDB (Vector)
├── docs/                       # Architecture diagrams & Math specs
├── installers/                 # Complex setup scripts (PowerShell/Bash)
├── notebooks/                  # Research sandboxes
├── src/
│   ├── core/                   # The Omni-Kernel
│   │   ├── shm/                # Shared Memory Managers
│   │   ├── event_bus/          # Asyncio Event Loop
│   │   └── logger/             # Structured JSON Logging
│   ├── data/                   # Feed Handlers (Live + Hist)
│   ├── engine/                 # Backtest & Live Engines
│   │   ├── costs.py            # Slippage/Tax models
│   │   └── verify.py           # Formal Verification Logic
│   ├── agents/                 # The Swarm
│   │   ├── sentinel.py         # Risk Guardian
│   │   ├── librarian.py        # News RAG
│   │   └── tactician.py        # Trading LLM
│   ├── hardware/               # Accelerators
│   │   ├── intel_npu.py        # OpenVINO bindings
│   │   └── apple_metal.py      # MLX bindings
│   ├── training/               # Nightly Optimization
│   │   └── micro_lora.py       # OVTE Training Loop
│   └── api/                    # Server for GUI communication
├── src-ui/                     # Tauri + React Application
│   ├── src-tauri/              # Rust bindings
│   └── src-react/              # React 19 Frontend
│       ├── components/         # Shadcn/UI + Framer
│       ├── stores/             # Zustand State
│       └── views/              # Dashboard/Charts/Settings
├── tests/                      # Hypothesis & PyTest Suites
├── .env.example
├── pyproject.toml
├── README.md
└── RUN.md


and make sure create all the required and possible features and options and functionalities in this project, 

the gui should be user friendly and Advanced and graphical representation with all the graphs and charts and all.

also 
in the ui it should generate a pdf file which contain few sections,

in those sections one of the section should be says what the agent learned today,
what the current portpolio
what is today's investments
and what are the profits and losess for today,

what are the top news for today.

with appropiate colors and graphs and all.

and also implement appropiate sections that needs to be contained in the report which should be generated in the end of the day to mail id and manually generated when user wanted to generate the report.