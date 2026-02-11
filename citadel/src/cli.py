"""
CITADEL — Main Entry Point

CLI interface for the trading system:
  citadel live      — Start live trading
  citadel paper     — Start paper trading
  citadel backtest  — Run backtest
  citadel report    — Generate report
  citadel status    — Show system status
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys
from pathlib import Path

import structlog

from src.core.config import load_config, CitadelConfig
from src.core.logger.logging import setup_logging
from src.core.event_bus.bus import EventBus, EventStore
from src.core.shm.ring_buffer import SharedMemoryManager
from src.data.feeds import FeedManager
from src.data.storage import MarketDataStore, VectorStore
from src.engine.backtest import BacktestEngine
from src.engine.strategies import MeanReversionStrategy, MomentumStrategy, MultiFactorStrategy
from src.engine.costs import TransactionCostEngine
from src.engine.verify import RiskVerifier
from src.agents.sentinel import SentinelAgent
from src.agents.librarian import LibrarianAgent
from src.agents.tactician import TacticianAgent
from src.agents.student import StudentAgent
from src.reports.generator import ReportGenerator

logger = structlog.get_logger(__name__)


async def run_live(config: CitadelConfig, paper: bool = False) -> None:
    """Start live or paper trading."""
    mode = "PAPER" if paper else "LIVE"
    logger.info("citadel.starting", mode=mode)

    # Initialize core systems
    event_bus = EventBus()
    event_store = EventStore()
    shm_manager = SharedMemoryManager()
    data_store = MarketDataStore()
    vector_store = VectorStore()

    # Feed manager
    feed_manager = FeedManager()

    # Cost engine
    cost_engine = TransactionCostEngine()

    # Risk verifier
    risk_verifier = RiskVerifier()

    # Report generator
    report_gen = ReportGenerator(
        config=config.model_dump(mode="json").get("reports", {}),
        data_store=data_store,
    )

    # Initialize agents
    agents = {}

    sentinel = SentinelAgent(
        config=config.model_dump(mode="json").get("agents", {}).get("sentinel", {}),
        event_bus=event_bus,
    )
    agents["Sentinel"] = sentinel

    librarian = LibrarianAgent(
        config=config.model_dump(mode="json").get("agents", {}).get("librarian", {}),
        event_bus=event_bus,
    )
    agents["Librarian"] = librarian

    tactician = TacticianAgent(
        config=config.model_dump(mode="json").get("agents", {}).get("tactician", {}),
        event_bus=event_bus,
    )
    agents["Tactician"] = tactician

    student = StudentAgent(
        config=config.model_dump(mode="json").get("agents", {}).get("student", {}),
        event_bus=event_bus,
        data_store=data_store,
    )
    agents["Student"] = student

    # Update report generator with agents
    report_gen._agents = agents

    # Register with API server
    from src.api.server import set_engine, set_agents
    set_agents(agents)
    set_engine("data_store", data_store)
    set_engine("report_gen", report_gen)

    # Start all agents
    for name, agent in agents.items():
        await agent.start()
        logger.info("agent.started", name=name)

    # Start event bus
    await event_bus.start()

    # Start API server
    from src.api.server import create_app
    import uvicorn

    app = create_app()

    server_config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
    server = uvicorn.Server(server_config)

    # Handle shutdown
    shutdown_event = asyncio.Event()

    def handle_signal(sig: int, frame: Any = None) -> None:
        logger.info("citadel.shutdown_signal", signal=sig)
        shutdown_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    logger.info("citadel.running", mode=mode, api="http://localhost:8000")

    try:
        await server.serve()
    except asyncio.CancelledError:
        pass
    finally:
        # Cleanup
        for agent in agents.values():
            await agent.stop()
        await event_bus.stop()
        shm_manager.cleanup()
        logger.info("citadel.stopped")


async def run_backtest(config: CitadelConfig, args: argparse.Namespace) -> None:
    """Run a backtest."""
    logger.info("backtest.starting",
                strategy=args.strategy,
                symbols=args.symbols,
                start=args.start_date,
                end=args.end_date)

    # Initialize
    data_store = MarketDataStore()
    cost_engine = TransactionCostEngine()

    # Select strategy
    strategy_map = {
        "mean_reversion": MeanReversionStrategy,
        "momentum": MomentumStrategy,
        "multi_factor": MultiFactorStrategy,
    }

    strategy_cls = strategy_map.get(args.strategy)
    if not strategy_cls:
        logger.error("Unknown strategy", strategy=args.strategy,
                     available=list(strategy_map.keys()))
        return

    strategy = strategy_cls()

    # Run backtest
    engine = BacktestEngine(
        strategy=strategy,
        cost_engine=cost_engine,
    )

    result = await engine.run(
        symbols=args.symbols.split(","),
        start_date=args.start_date,
        end_date=args.end_date,
        initial_capital=args.capital,
    )

    # Print results
    print("\n" + "=" * 60)
    print("CITADEL BACKTEST RESULTS")
    print("=" * 60)
    print(f"Strategy:       {args.strategy}")
    print(f"Period:         {args.start_date} to {args.end_date}")
    print(f"Symbols:        {args.symbols}")
    print(f"Initial:        ${args.capital:,.2f}")
    print(f"Final Equity:   ${result.final_equity:,.2f}")
    print(f"Total Return:   {result.total_return_pct:.2f}%")
    print(f"Sharpe Ratio:   {result.sharpe_ratio:.2f}")
    print(f"Max Drawdown:   {result.max_drawdown_pct:.2f}%")
    print(f"Win Rate:       {result.win_rate*100:.0f}%")
    print(f"Total Trades:   {result.total_trades}")
    print("=" * 60)


async def run_report(config: CitadelConfig, args: argparse.Namespace) -> None:
    """Generate a report."""
    data_store = MarketDataStore()
    report_gen = ReportGenerator(
        config=config.model_dump(mode="json").get("reports", {}),
        data_store=data_store,
    )

    path = await report_gen.generate(
        report_type=args.type,
        date=args.date,
        send_email=args.email,
    )

    print(f"Report generated: {path}")


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="citadel",
        description="CITADEL — Multi-Agent Algorithmic Trading System",
    )
    parser.add_argument("--config", default="configs/system.yaml",
                       help="Path to config file")
    parser.add_argument("--verbose", "-v", action="store_true",
                       help="Verbose logging")

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # live
    live_parser = subparsers.add_parser("live", help="Start live trading")

    # paper
    paper_parser = subparsers.add_parser("paper", help="Start paper trading")

    # backtest
    bt_parser = subparsers.add_parser("backtest", help="Run backtest")
    bt_parser.add_argument("--strategy", "-s", required=True,
                          help="Strategy name")
    bt_parser.add_argument("--symbols", required=True,
                          help="Comma-separated symbols")
    bt_parser.add_argument("--start-date", required=True, help="Start date")
    bt_parser.add_argument("--end-date", required=True, help="End date")
    bt_parser.add_argument("--capital", type=float, default=100000,
                          help="Initial capital")

    # report
    rpt_parser = subparsers.add_parser("report", help="Generate report")
    rpt_parser.add_argument("--type", default="daily",
                           choices=["daily", "weekly", "backtest"])
    rpt_parser.add_argument("--date", default=None, help="Report date")
    rpt_parser.add_argument("--email", action="store_true",
                           help="Send via email")

    # status
    subparsers.add_parser("status", help="Show system status")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Setup
    setup_logging(verbose=args.verbose)

    try:
        config = load_config(args.config)
    except Exception:
        config = CitadelConfig()

    # Dispatch
    if args.command == "live":
        asyncio.run(run_live(config, paper=False))
    elif args.command == "paper":
        asyncio.run(run_live(config, paper=True))
    elif args.command == "backtest":
        asyncio.run(run_backtest(config, args))
    elif args.command == "report":
        asyncio.run(run_report(config, args))
    elif args.command == "status":
        print("CITADEL Status: Use the GUI or API at http://localhost:8000/api/status")


if __name__ == "__main__":
    main()
