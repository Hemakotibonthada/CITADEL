"""Quick-start CITADEL in paper trading mode."""
import sys, os

_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(_DIR)
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, _DIR)
sys.path.insert(0, os.path.join(_DIR, 'src'))

# ── Load .env file ────────────────────────────────────────
_env_path = os.path.join(_DIR, ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _, _val = _line.partition("=")
                os.environ.setdefault(_key.strip(), _val.strip())

import asyncio
import uvicorn
import structlog

logger = structlog.get_logger("citadel.start")

async def main():
    print("=" * 60)
    print("  CITADEL Trading System - Paper Trading Mode")
    print("=" * 60)

    # Load config
    from core.config import load_config
    config = load_config()
    print("[OK] Configuration loaded")

    # Initialize core systems
    from core.event_bus.bus import EventBus, EventStore
    event_bus = EventBus()
    event_store = EventStore()
    print("[OK] Event bus initialized")

    from core.shm.ring_buffer import SharedMemoryManager
    shm_manager = SharedMemoryManager()
    print("[OK] Shared memory manager initialized")

    from data.storage import MarketDataStore, VectorStore
    data_store = MarketDataStore()
    vector_store = VectorStore()
    print("[OK] Data stores initialized")

    # Initialize market data feeds
    from data.feeds import AlpacaFeed, PaperFeed, FeedManager

    feed_manager = FeedManager()

    alpaca_key = os.environ.get("ALPACA_API_KEY", "")
    alpaca_secret = os.environ.get("ALPACA_SECRET_KEY", "")
    use_alpaca = bool(alpaca_key and alpaca_secret)

    if use_alpaca:
        alpaca_feed = AlpacaFeed({
            "api_key": alpaca_key,
            "api_secret": alpaca_secret,
            "base_url": os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
        })
        feed_manager.register_feed(alpaca_feed, primary=True)
        print("[OK] Alpaca feed registered (primary)")
    else:
        print("[WARN] No Alpaca credentials found — using paper feed only")

    # Always register paper feed as fallback
    paper_feed = PaperFeed()
    feed_manager.register_feed(paper_feed, primary=not use_alpaca)
    print("[OK] Paper feed registered (fallback)")

    # Connect feeds and subscribe to symbols
    symbols = config.data_feeds.symbols
    try:
        await feed_manager.connect_all()
        await feed_manager.subscribe_all(symbols)
        print(f"[OK] Feeds connected & subscribed to {len(symbols)} symbols")
    except Exception as e:
        print(f"[WARN] Feed connection issue: {e} — falling back to paper feed")

    # Initialize agents
    from agents.sentinel import SentinelAgent
    from agents.librarian import LibrarianAgent
    from agents.tactician import TacticianAgent
    from agents.student import StudentAgent

    agent_cfg = config.model_dump(mode="json").get("agents", {})
    agents = {}

    sentinel = SentinelAgent(
        config=agent_cfg.get("sentinel", {}),
        event_bus=event_bus,
    )
    agents["Sentinel"] = sentinel

    librarian = LibrarianAgent(
        config=agent_cfg.get("librarian", {}),
        event_bus=event_bus,
    )
    agents["Librarian"] = librarian

    tactician = TacticianAgent(
        config=agent_cfg.get("tactician", {}),
        event_bus=event_bus,
    )
    agents["Tactician"] = tactician

    student = StudentAgent(
        config=agent_cfg.get("student", {}),
        event_bus=event_bus,
        data_store=data_store,
    )
    agents["Student"] = student
    print(f"[OK] {len(agents)} agents initialized: {list(agents.keys())}")

    # Register with API server
    from api.server import create_app, set_engine, set_agents
    set_agents(agents)
    set_engine("data_store", data_store)
    set_engine("feed_manager", feed_manager)

    # Initialize report generator
    try:
        from reports.generator import ReportGenerator
        report_gen = ReportGenerator(
            config=config.get("reports", {}),
            data_store=data_store,
            agents=agents,
        )
        set_engine("report_gen", report_gen)
        print("[OK] Report generator initialized")
    except Exception as e:
        print(f"[WARN] Report generator init failed: {e}")

    print("[OK] Components registered with API server")

    # Start agents
    for name, agent in agents.items():
        try:
            await agent.start()
            print(f"  [OK] Agent {name} started")
        except Exception as e:
            print(f"  [WARN] Agent {name} start failed: {e}")

    # Start event bus
    await event_bus.start()
    print("[OK] Event bus started")

    # Create and start API server
    app = create_app()

    print("\n" + "=" * 60)
    print("  CITADEL API Server starting on http://localhost:8000")
    print("  Health: http://localhost:8000/api/health")
    print("  Status: http://localhost:8000/api/status")
    print("  Docs:   http://localhost:8000/docs")
    print("  Press Ctrl+C to stop")
    print("=" * 60 + "\n")

    server_config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
    server = uvicorn.Server(server_config)

    try:
        await server.serve()
    except asyncio.CancelledError:
        pass
    finally:
        for agent in agents.values():
            try:
                await agent.stop()
            except Exception:
                pass
        await feed_manager.disconnect_all()
        await event_bus.stop()
        shm_manager.cleanup()
        print("\nCITADEL stopped.")

asyncio.run(main())
