"""
CITADEL — Librarian Agent (Market Intelligence & News RAG)

The Librarian handles:
  - News ingestion from multiple sources (NewsAPI, Finnhub)
  - Sentiment analysis using FinBERT
  - RAG pipeline with local vector store
  - Real-time sentiment_tensor written to Shared Memory
  - Document chunking and embedding
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import numpy as np
import structlog

from src.agents.base import BaseAgent
from src.core.models import (
    Event, EventType, NewsArticle, Sentiment,
)
from src.core.event_bus.bus import EventBus
from src.data.storage import VectorStore

logger = structlog.get_logger(__name__)


class LibrarianAgent(BaseAgent):
    """
    Market Intelligence Agent.
    
    Pipeline:
      1. Fetch news from multiple sources
      2. Chunk and embed articles
      3. Run sentiment analysis (FinBERT)
      4. Store in vector DB for RAG retrieval
      5. Write sentiment_tensor to shared memory
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
    ):
        super().__init__("Librarian", config, event_bus)
        
        self._http_client: httpx.AsyncClient | None = None
        self._vector_store: VectorStore | None = None
        self._embedding_model = None
        self._sentiment_model = None
        
        # Config
        self._news_sources = self._config.get("news_sources", [])
        self._fetch_interval = self._config.get("fetch_interval_s", 300)
        self._embedding_dim = self._config.get("embedding_dim", 384)
        self._chunk_size = self._config.get("chunk_size", 512)
        self._chunk_overlap = self._config.get("chunk_overlap", 64)
        self._relevance_threshold = self._config.get("relevance_threshold", 0.6)
        
        # State
        self._articles: list[NewsArticle] = []
        self._sentiment_tensor = np.zeros(10, dtype=np.float32)  # Per-symbol sentiment
        self._last_fetch = 0.0
        self._seen_hashes: set[str] = set()
        
        # Metrics
        self._articles_processed = 0
        self._embeddings_generated = 0

    async def start(self) -> None:
        """Initialize models and start processing."""
        await super().start()
        
        self._http_client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "CITADEL/1.0"},
        )
        
        self._vector_store = VectorStore(
            dim=self._embedding_dim,
            index_path="./data/vectors",
        )
        
        # Initialize embedding model
        await self._init_embedding_model()
        await self._init_sentiment_model()

    async def stop(self) -> None:
        """Cleanup resources."""
        if self._http_client:
            await self._http_client.aclose()
        if self._vector_store:
            self._vector_store.save()
        await super().stop()

    async def _init_embedding_model(self) -> None:
        """Initialize sentence embedding model."""
        try:
            from sentence_transformers import SentenceTransformer
            model_name = self._config.get("embedding_model", "all-MiniLM-L6-v2")
            self._embedding_model = SentenceTransformer(model_name)
            logger.info("librarian.embedding_model_loaded", model=model_name)
        except ImportError:
            logger.warning("librarian.sentence_transformers_not_available")
            self._embedding_model = None

    async def _init_sentiment_model(self) -> None:
        """Initialize FinBERT sentiment model."""
        try:
            from transformers import pipeline
            model_name = self._config.get("sentiment_model", "ProsusAI/finbert")
            self._sentiment_model = pipeline(
                "sentiment-analysis",
                model=model_name,
                top_k=None,
            )
            logger.info("librarian.sentiment_model_loaded", model=model_name)
        except (ImportError, Exception) as e:
            logger.warning("librarian.sentiment_model_not_available", error=str(e))
            self._sentiment_model = None

    async def _process(self) -> None:
        """Main librarian processing loop."""
        now = time.time()
        
        # Fetch news periodically
        if now - self._last_fetch >= self._fetch_interval:
            self._last_fetch = now
            await self._fetch_all_news()
        
        # Process any unprocessed articles
        await self._process_pending_articles()
        
        # Update sentiment tensor
        self._update_sentiment_tensor()
        
        await asyncio.sleep(10.0)  # Check every 10 seconds

    async def _fetch_all_news(self) -> None:
        """Fetch news from all configured sources."""
        tasks = []
        for source in self._news_sources:
            provider = source.get("provider", "")
            if provider == "newsapi":
                tasks.append(self._fetch_newsapi(source))
            elif provider == "finnhub":
                tasks.append(self._fetch_finnhub(source))
        
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.error("librarian.fetch_error", error=str(result))
                elif isinstance(result, list):
                    for article in result:
                        # Deduplicate
                        content_hash = hashlib.md5(article.title.encode()).hexdigest()
                        if content_hash not in self._seen_hashes:
                            self._seen_hashes.add(content_hash)
                            self._articles.append(article)

    async def _fetch_newsapi(self, source_config: dict[str, Any]) -> list[NewsArticle]:
        """Fetch from NewsAPI."""
        api_key = source_config.get("api_key", "")
        if not api_key or not self._http_client:
            return []

        articles = []
        try:
            categories = source_config.get("categories", ["business"])
            for category in categories:
                url = (
                    f"https://newsapi.org/v2/top-headlines"
                    f"?category={category}&language=en&pageSize=20"
                )
                resp = await self._http_client.get(
                    url, headers={"X-Api-Key": api_key}
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("articles", []):
                    try:
                        articles.append(NewsArticle(
                            timestamp=datetime.fromisoformat(
                                item["publishedAt"].replace("Z", "+00:00")
                            ),
                            source=item.get("source", {}).get("name", "NewsAPI"),
                            title=item.get("title", ""),
                            summary=item.get("description", ""),
                            content=item.get("content", ""),
                            url=item.get("url", ""),
                            symbols=self._extract_symbols(
                                item.get("title", "") + " " + item.get("description", "")
                            ),
                        ))
                    except Exception:
                        continue

            logger.debug("librarian.newsapi_fetched", articles=len(articles))
        except Exception as e:
            logger.error("librarian.newsapi_error", error=str(e))

        return articles

    async def _fetch_finnhub(self, source_config: dict[str, Any]) -> list[NewsArticle]:
        """Fetch from Finnhub."""
        api_key = source_config.get("api_key", "")
        if not api_key or not self._http_client:
            return []

        articles = []
        try:
            now = datetime.now(timezone.utc)
            from_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
            to_date = now.strftime("%Y-%m-%d")

            url = (
                f"https://finnhub.io/api/v1/news"
                f"?category=general&from={from_date}&to={to_date}"
                f"&token={api_key}"
            )
            resp = await self._http_client.get(url)
            resp.raise_for_status()
            data = resp.json()

            for item in data:
                try:
                    articles.append(NewsArticle(
                        timestamp=datetime.fromtimestamp(
                            item.get("datetime", 0), tz=timezone.utc
                        ),
                        source=item.get("source", "Finnhub"),
                        title=item.get("headline", ""),
                        summary=item.get("summary", ""),
                        url=item.get("url", ""),
                        symbols=item.get("related", "").split(",") if item.get("related") else [],
                    ))
                except Exception:
                    continue

            logger.debug("librarian.finnhub_fetched", articles=len(articles))
        except Exception as e:
            logger.error("librarian.finnhub_error", error=str(e))

        return articles

    def _extract_symbols(self, text: str) -> list[str]:
        """Extract stock symbols from text."""
        ticker_set = {
            "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "TSLA",
            "META", "SPY", "QQQ", "IWM", "AMD", "INTC", "NFLX",
        }
        name_to_ticker = {
            "Apple": "AAPL", "Microsoft": "MSFT", "Google": "GOOGL",
            "Amazon": "AMZN", "Nvidia": "NVDA", "Tesla": "TSLA",
            "Meta": "META",
        }
        
        found = []
        text_upper = text.upper()
        for sym in ticker_set:
            if sym in text_upper:
                found.append(sym)
        
        for name, sym in name_to_ticker.items():
            if name.lower() in text.lower():
                found.append(sym)
        
        return list(set(found))

    async def _process_pending_articles(self) -> None:
        """Process articles: sentiment + embedding."""
        pending = [a for a in self._articles if a.sentiment == Sentiment.NEUTRAL and a.sentiment_score == 0.0]
        
        if not pending:
            return

        for article in pending[:10]:  # Process 10 at a time
            # Sentiment analysis
            sentiment, score = await self._analyze_sentiment(article.title + ". " + article.summary)
            
            # Generate embedding
            embedding = await self._generate_embedding(article.title + " " + article.summary)
            
            # Update article (create new immutable copy)
            idx = self._articles.index(article)
            self._articles[idx] = NewsArticle(
                id=article.id,
                timestamp=article.timestamp,
                source=article.source,
                title=article.title,
                summary=article.summary,
                content=article.content,
                url=article.url,
                symbols=article.symbols,
                sentiment=sentiment,
                sentiment_score=score,
                relevance_score=article.relevance_score,
                embedding=embedding.tolist() if embedding is not None else None,
            )

            # Add to vector store
            if embedding is not None and self._vector_store:
                self._vector_store.add(
                    embeddings=embedding.reshape(1, -1),
                    metadata=[{
                        "id": article.id,
                        "title": article.title,
                        "sentiment": sentiment.value,
                        "score": score,
                        "symbols": article.symbols,
                        "timestamp": article.timestamp.isoformat(),
                    }],
                )
                self._embeddings_generated += 1

            self._articles_processed += 1

            # Publish event
            if self._event_bus:
                await self._event_bus.publish(Event(
                    event_type=EventType.AGENT_STATE,
                    source=self._name,
                    payload={
                        "type": "news_processed",
                        "title": article.title,
                        "sentiment": sentiment.value,
                        "score": score,
                        "symbols": article.symbols,
                    },
                ))

    async def _analyze_sentiment(self, text: str) -> tuple[Sentiment, float]:
        """Run sentiment analysis on text."""
        if self._sentiment_model is None:
            # Fallback: simple keyword-based
            return self._keyword_sentiment(text)

        try:
            results = self._sentiment_model(text[:512])
            if results and len(results) > 0:
                # FinBERT returns list of dicts with label and score
                sentiments = results[0] if isinstance(results[0], list) else results
                best = max(sentiments, key=lambda x: x["score"])
                label = best["label"].lower()
                score = best["score"]

                if label == "positive":
                    if score > 0.8:
                        return Sentiment.VERY_BULLISH, score
                    return Sentiment.BULLISH, score
                elif label == "negative":
                    if score > 0.8:
                        return Sentiment.VERY_BEARISH, -score
                    return Sentiment.BEARISH, -score
                else:
                    return Sentiment.NEUTRAL, 0.0
        except Exception as e:
            logger.error("librarian.sentiment_error", error=str(e))

        return Sentiment.NEUTRAL, 0.0

    def _keyword_sentiment(self, text: str) -> tuple[Sentiment, float]:
        """Simple keyword-based sentiment fallback."""
        text_lower = text.lower()
        
        positive_words = {
            "surge", "rally", "gain", "profit", "growth", "bullish",
            "record", "beat", "exceed", "optimistic", "upgrade", "buy",
            "strong", "soar", "breakout", "innovation",
        }
        negative_words = {
            "crash", "decline", "loss", "fall", "bearish", "warning",
            "recession", "risk", "downturn", "sell", "miss", "cut",
            "weak", "plunge", "concern", "crisis", "layoff",
        }

        pos_count = sum(1 for w in positive_words if w in text_lower)
        neg_count = sum(1 for w in negative_words if w in text_lower)
        total = pos_count + neg_count

        if total == 0:
            return Sentiment.NEUTRAL, 0.0

        score = (pos_count - neg_count) / total

        if score > 0.5:
            return Sentiment.BULLISH, score
        elif score > 0.2:
            return Sentiment.BULLISH, score
        elif score < -0.5:
            return Sentiment.BEARISH, score
        elif score < -0.2:
            return Sentiment.BEARISH, score
        else:
            return Sentiment.NEUTRAL, score

    async def _generate_embedding(self, text: str) -> np.ndarray | None:
        """Generate text embedding."""
        if self._embedding_model is None:
            return None

        try:
            embedding = self._embedding_model.encode(text, show_progress_bar=False)
            return np.array(embedding, dtype=np.float32)
        except Exception as e:
            logger.error("librarian.embedding_error", error=str(e))
            return None

    def _update_sentiment_tensor(self) -> None:
        """Update the sentiment tensor from recent articles."""
        symbol_sentiments: dict[str, list[float]] = {}
        
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        
        for article in self._articles:
            if article.timestamp < cutoff:
                continue
            for symbol in article.symbols:
                if symbol not in symbol_sentiments:
                    symbol_sentiments[symbol] = []
                symbol_sentiments[symbol].append(article.sentiment_score)
        
        # Aggregate
        for symbol, scores in symbol_sentiments.items():
            if scores:
                avg = np.mean(scores)
                symbol_sentiments[symbol] = [avg]

    async def query_rag(
        self,
        query: str,
        k: int = 5,
        symbol: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        RAG query: find relevant news articles for a query.
        
        Args:
            query: Search query text
            k: Number of results
            symbol: Optional symbol filter
        """
        if self._embedding_model is None or self._vector_store is None:
            return []

        query_embedding = await self._generate_embedding(query)
        if query_embedding is None:
            return []

        results = self._vector_store.search(query_embedding, k=k * 2)
        
        # Filter by symbol if specified
        if symbol:
            results = [
                (score, meta) for score, meta in results
                if symbol in meta.get("symbols", [])
            ]

        return [
            {
                "score": score,
                "title": meta.get("title", ""),
                "sentiment": meta.get("sentiment", ""),
                "symbols": meta.get("symbols", []),
                "timestamp": meta.get("timestamp", ""),
            }
            for score, meta in results[:k]
        ]

    def get_sentiment_summary(self) -> dict[str, Any]:
        """Get current sentiment summary."""
        recent = [
            a for a in self._articles
            if a.timestamp > datetime.now(timezone.utc) - timedelta(hours=24)
        ]
        
        if not recent:
            return {"overall": "NEUTRAL", "score": 0.0, "articles": 0}

        avg_score = np.mean([a.sentiment_score for a in recent])
        
        sentiment_counts = {}
        for a in recent:
            s = a.sentiment.value
            sentiment_counts[s] = sentiment_counts.get(s, 0) + 1

        return {
            "overall": max(sentiment_counts, key=sentiment_counts.get) if sentiment_counts else "NEUTRAL",
            "score": round(float(avg_score), 3),
            "articles": len(recent),
            "breakdown": sentiment_counts,
            "top_articles": [
                {
                    "title": a.title,
                    "sentiment": a.sentiment.value,
                    "score": a.sentiment_score,
                    "symbols": a.symbols,
                    "source": a.source,
                    "timestamp": a.timestamp.isoformat(),
                }
                for a in sorted(recent, key=lambda x: abs(x.sentiment_score), reverse=True)[:10]
            ],
        }

    @property
    def articles_count(self) -> int:
        return len(self._articles)

    @property
    def recent_articles(self) -> list[NewsArticle]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        return [a for a in self._articles if a.timestamp > cutoff]
