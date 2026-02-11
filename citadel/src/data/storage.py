"""
CITADEL — Data Storage Layer

Manages persistent storage using:
  - DuckDB for OLAP queries (backtesting, analytics)
  - Apache Arrow for zero-copy memory sharing
  - Parquet files for price data archival
  - LanceDB for vector storage (embeddings)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import structlog

from src.core.models import Bar, Fill, Position, PortfolioSnapshot, NewsArticle, Event, EventType

logger = structlog.get_logger(__name__)


class MarketDataStore:
    """
    DuckDB-backed store for market data (bars, ticks).
    Provides fast OLAP queries for backtesting and analytics.
    """

    def __init__(self, db_path: str = "./data/citadel.duckdb"):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._db = duckdb.connect(db_path)
        self._init_schema()

    def _init_schema(self) -> None:
        """Initialize market data tables."""
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS bars (
                symbol VARCHAR NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                timeframe VARCHAR NOT NULL,
                open DOUBLE NOT NULL,
                high DOUBLE NOT NULL,
                low DOUBLE NOT NULL,
                close DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                vwap DOUBLE DEFAULT 0.0,
                trades INTEGER DEFAULT 0,
                PRIMARY KEY (symbol, timestamp, timeframe)
            )
        """)

        self._db.execute("""
            CREATE TABLE IF NOT EXISTS trades_log (
                id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                symbol VARCHAR NOT NULL,
                side VARCHAR NOT NULL,
                quantity DOUBLE NOT NULL,
                price DOUBLE NOT NULL,
                commission DOUBLE DEFAULT 0.0,
                slippage DOUBLE DEFAULT 0.0,
                order_id VARCHAR,
                signal_id VARCHAR,
                strategy VARCHAR DEFAULT '',
                pnl DOUBLE DEFAULT 0.0
            )
        """)

        self._db.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                cash DOUBLE NOT NULL,
                total_equity DOUBLE NOT NULL,
                unrealized_pnl DOUBLE DEFAULT 0.0,
                realized_pnl DOUBLE DEFAULT 0.0,
                daily_pnl DOUBLE DEFAULT 0.0,
                gross_exposure DOUBLE DEFAULT 0.0,
                net_exposure DOUBLE DEFAULT 0.0,
                leverage DOUBLE DEFAULT 0.0,
                num_positions INTEGER DEFAULT 0,
                positions_json JSON DEFAULT '[]'
            )
        """)

        self._db.execute("""
            CREATE TABLE IF NOT EXISTS daily_metrics (
                date DATE PRIMARY KEY,
                total_equity DOUBLE NOT NULL,
                daily_pnl DOUBLE DEFAULT 0.0,
                daily_return DOUBLE DEFAULT 0.0,
                num_trades INTEGER DEFAULT 0,
                win_rate DOUBLE DEFAULT 0.0,
                sharpe_ratio DOUBLE DEFAULT 0.0,
                sortino_ratio DOUBLE DEFAULT 0.0,
                max_drawdown DOUBLE DEFAULT 0.0,
                gross_exposure DOUBLE DEFAULT 0.0,
                net_exposure DOUBLE DEFAULT 0.0,
                volatility DOUBLE DEFAULT 0.0,
                var_95 DOUBLE DEFAULT 0.0,
                benchmark_return DOUBLE DEFAULT 0.0,
                alpha DOUBLE DEFAULT 0.0,
                beta DOUBLE DEFAULT 0.0
            )
        """)

        self._db.execute("""
            CREATE TABLE IF NOT EXISTS news_articles (
                id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                source VARCHAR,
                title VARCHAR NOT NULL,
                summary VARCHAR DEFAULT '',
                url VARCHAR DEFAULT '',
                symbols JSON DEFAULT '[]',
                sentiment VARCHAR DEFAULT 'NEUTRAL',
                sentiment_score DOUBLE DEFAULT 0.0,
                relevance_score DOUBLE DEFAULT 0.0
            )
        """)

        self._db.execute("""
            CREATE TABLE IF NOT EXISTS agent_learnings (
                id VARCHAR PRIMARY KEY,
                date DATE NOT NULL,
                agent VARCHAR NOT NULL,
                learning_type VARCHAR NOT NULL,
                description VARCHAR NOT NULL,
                details JSON DEFAULT '{}',
                impact_score DOUBLE DEFAULT 0.0
            )
        """)

        logger.debug("storage.schema_initialized")

    def insert_bars(self, bars: list[Bar]) -> int:
        """Bulk insert bars."""
        if not bars:
            return 0
        
        df = pd.DataFrame([b.model_dump() for b in bars])
        self._db.execute(
            "INSERT OR REPLACE INTO bars SELECT * FROM df"
        )
        return len(bars)

    def get_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        limit: int = 100_000,
    ) -> pd.DataFrame:
        """Query bars as DataFrame."""
        return self._db.execute(
            """
            SELECT * FROM bars
            WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            LIMIT ?
            """,
            [symbol, timeframe, start.isoformat(), end.isoformat(), limit],
        ).fetchdf()

    def get_bars_arrow(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> pa.Table:
        """Query bars as Arrow Table (zero-copy for frontend)."""
        return self._db.execute(
            """
            SELECT * FROM bars
            WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            """,
            [symbol, timeframe, start.isoformat(), end.isoformat()],
        ).fetch_arrow_table()

    def insert_trade(self, fill: Fill, strategy: str = "", pnl: float = 0.0) -> None:
        """Log a trade fill."""
        self._db.execute(
            """
            INSERT INTO trades_log (id, timestamp, symbol, side, quantity, price,
                                     commission, slippage, order_id, strategy, pnl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                fill.id, fill.timestamp.isoformat(), fill.symbol,
                fill.side.value, fill.quantity, fill.price,
                fill.commission, fill.slippage, fill.order_id,
                strategy, pnl,
            ],
        )

    def get_trades(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        symbol: str | None = None,
    ) -> pd.DataFrame:
        """Query trade history."""
        conditions = []
        params = []
        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return self._db.execute(
            f"SELECT * FROM trades_log {where} ORDER BY timestamp ASC", params
        ).fetchdf()

    def save_portfolio_snapshot(self, snapshot: PortfolioSnapshot) -> None:
        """Save a portfolio state snapshot."""
        import orjson
        positions_json = orjson.dumps(
            [p.model_dump(mode="json") for p in snapshot.positions]
        ).decode()
        
        self._db.execute(
            """
            INSERT INTO portfolio_snapshots
            (timestamp, cash, total_equity, unrealized_pnl, realized_pnl,
             daily_pnl, gross_exposure, net_exposure, leverage, num_positions, positions_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                snapshot.timestamp.isoformat(), snapshot.cash,
                snapshot.total_equity, snapshot.total_unrealized_pnl,
                snapshot.total_realized_pnl, snapshot.daily_pnl,
                snapshot.gross_exposure, snapshot.net_exposure,
                snapshot.leverage, len(snapshot.positions), positions_json,
            ],
        )

    def save_daily_metrics(self, metrics: dict[str, Any]) -> None:
        """Save end-of-day metrics."""
        cols = ", ".join(metrics.keys())
        placeholders = ", ".join(["?"] * len(metrics))
        self._db.execute(
            f"INSERT OR REPLACE INTO daily_metrics ({cols}) VALUES ({placeholders})",
            list(metrics.values()),
        )

    def get_daily_metrics(
        self, start_date: str | None = None, end_date: str | None = None
    ) -> pd.DataFrame:
        """Query daily metrics."""
        conditions = []
        params = []
        if start_date:
            conditions.append("date >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("date <= ?")
            params.append(end_date)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return self._db.execute(
            f"SELECT * FROM daily_metrics {where} ORDER BY date ASC", params
        ).fetchdf()

    def insert_news_article(self, article: NewsArticle) -> None:
        """Insert a news article."""
        import orjson
        self._db.execute(
            """
            INSERT OR REPLACE INTO news_articles
            (id, timestamp, source, title, summary, url, symbols, sentiment, sentiment_score, relevance_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                article.id, article.timestamp.isoformat(), article.source,
                article.title, article.summary, article.url,
                orjson.dumps(article.symbols).decode(),
                article.sentiment.value, article.sentiment_score,
                article.relevance_score,
            ],
        )

    def get_news(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        symbol: str | None = None,
        limit: int = 50,
    ) -> pd.DataFrame:
        """Query news articles."""
        conditions = []
        params = []
        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())
        if symbol:
            conditions.append(f"symbols::VARCHAR LIKE '%{symbol}%'")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return self._db.execute(
            f"SELECT * FROM news_articles {where} ORDER BY timestamp DESC LIMIT ?",
            params + [limit],
        ).fetchdf()

    def save_agent_learning(
        self,
        agent: str,
        learning_type: str,
        description: str,
        details: dict[str, Any] | None = None,
        impact_score: float = 0.0,
    ) -> None:
        """Record an agent learning event."""
        import orjson
        import uuid
        self._db.execute(
            """
            INSERT INTO agent_learnings (id, date, agent, learning_type, description, details, impact_score)
            VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?)
            """,
            [
                str(uuid.uuid4()), agent, learning_type, description,
                orjson.dumps(details or {}).decode(), impact_score,
            ],
        )

    def get_agent_learnings(self, date: str | None = None) -> pd.DataFrame:
        """Get agent learnings for a date."""
        if date:
            return self._db.execute(
                "SELECT * FROM agent_learnings WHERE date = ? ORDER BY impact_score DESC",
                [date],
            ).fetchdf()
        return self._db.execute(
            "SELECT * FROM agent_learnings WHERE date = CURRENT_DATE ORDER BY impact_score DESC"
        ).fetchdf()

    def get_portfolio_equity_curve(
        self, start: datetime | None = None, end: datetime | None = None
    ) -> pd.DataFrame:
        """Get equity curve data."""
        conditions = []
        params = []
        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return self._db.execute(
            f"""
            SELECT timestamp, total_equity, cash, daily_pnl, leverage
            FROM portfolio_snapshots {where}
            ORDER BY timestamp ASC
            """,
            params,
        ).fetchdf()

    def export_to_parquet(self, table: str, output_path: str) -> None:
        """Export a table to Parquet format."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        arrow_table = self._db.execute(f"SELECT * FROM {table}").fetch_arrow_table()
        pq.write_table(arrow_table, output_path, compression="zstd")
        logger.info("storage.exported", table=table, path=output_path)

    def vacuum(self) -> None:
        """Optimize database storage."""
        self._db.execute("VACUUM")

    def close(self) -> None:
        """Close database connection."""
        self._db.close()


class VectorStore:
    """
    Vector storage for embeddings (news, documents).
    Uses FAISS for similarity search.
    """

    def __init__(self, dim: int = 384, index_path: str = "./data/vectors"):
        self._dim = dim
        self._index_path = index_path
        os.makedirs(index_path, exist_ok=True)
        
        self._index = None
        self._metadata: list[dict[str, Any]] = []
        self._init_index()

    def _init_index(self) -> None:
        """Initialize or load FAISS index — use numpy fallback if faiss unavailable."""
        # Skip faiss entirely on Python 3.13+ due to import hangs (DLL deadlocks)
        import sys
        if sys.version_info >= (3, 13):
            logger.info("vector_store.numpy_fallback", reason="python_3.13_faiss_compat")
            self._embeddings: list[np.ndarray] = []
            return

        try:
            import faiss
            index_file = os.path.join(self._index_path, "faiss.index")
            if os.path.exists(index_file):
                self._index = faiss.read_index(index_file)
                logger.info("vector_store.loaded", path=index_file)
            else:
                self._index = faiss.IndexFlatIP(self._dim)  # Inner product for cosine sim
                logger.info("vector_store.created", dim=self._dim)
        except (ImportError, Exception) as e:
            logger.warning("vector_store.faiss_not_available, using numpy fallback", error=str(e))
            self._embeddings: list[np.ndarray] = []

    def add(
        self,
        embeddings: np.ndarray,
        metadata: list[dict[str, Any]],
    ) -> None:
        """Add embeddings with metadata."""
        if self._index is not None:
            # Normalize for cosine similarity
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            norms[norms == 0] = 1
            normalized = embeddings / norms
            self._index.add(normalized.astype(np.float32))
        else:
            for emb in embeddings:
                self._embeddings.append(emb)
        
        self._metadata.extend(metadata)

    def search(
        self,
        query_embedding: np.ndarray,
        k: int = 10,
    ) -> list[tuple[float, dict[str, Any]]]:
        """Search for similar embeddings."""
        # Normalize query
        norm = np.linalg.norm(query_embedding)
        if norm > 0:
            query_embedding = query_embedding / norm

        query = query_embedding.reshape(1, -1).astype(np.float32)
        
        if self._index is not None:
            distances, indices = self._index.search(query, min(k, len(self._metadata)))
            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx >= 0 and idx < len(self._metadata):
                    results.append((float(dist), self._metadata[idx]))
            return results
        else:
            # NumPy fallback
            if not self._embeddings:
                return []
            embeddings = np.array(self._embeddings)
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            norms[norms == 0] = 1
            normalized = embeddings / norms
            similarities = (normalized @ query.T).flatten()
            top_k = np.argsort(similarities)[-k:][::-1]
            return [
                (float(similarities[i]), self._metadata[i])
                for i in top_k
            ]

    def save(self) -> None:
        """Persist index to disk."""
        if self._index is not None:
            import faiss
            faiss.write_index(
                self._index,
                os.path.join(self._index_path, "faiss.index"),
            )
        
        import orjson
        meta_path = os.path.join(self._index_path, "metadata.json")
        with open(meta_path, "wb") as f:
            f.write(orjson.dumps(self._metadata))
        
        logger.info("vector_store.saved", count=len(self._metadata))

    @property
    def count(self) -> int:
        if self._index is not None:
            return self._index.ntotal
        return len(self._embeddings) if hasattr(self, "_embeddings") else 0
