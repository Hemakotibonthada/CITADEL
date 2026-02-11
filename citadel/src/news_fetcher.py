"""
CITADEL — Live News Fetcher
Fetches news in real-time from NewsAPI and Finnhub.
Results are cached briefly to avoid hitting rate limits.
FinBERT sentiment analysis is applied when available.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

# In-memory cache: { cache_key: (timestamp, articles) }
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL = 120  # seconds

# Sentiment model (lazy-loaded)
_sentiment_pipeline: Any = None
_sentiment_loaded = False


def _get_sentiment_pipeline():
    """Lazy-load FinBERT sentiment pipeline."""
    global _sentiment_pipeline, _sentiment_loaded
    if _sentiment_loaded:
        return _sentiment_pipeline
    _sentiment_loaded = True
    try:
        from transformers import pipeline as hf_pipeline

        model_path = os.path.join(os.path.dirname(__file__), "..", "models", "finbert-tone")
        if os.path.isdir(model_path):
            _sentiment_pipeline = hf_pipeline(
                "sentiment-analysis", model=model_path, tokenizer=model_path,
                truncation=True, max_length=512,
            )
            logger.info("news_fetcher.finbert_loaded", path=model_path)
        else:
            # Try from HuggingFace hub
            _sentiment_pipeline = hf_pipeline(
                "sentiment-analysis", model="ProsusAI/finbert",
                truncation=True, max_length=512,
            )
            logger.info("news_fetcher.finbert_loaded", source="hub")
    except Exception as e:
        logger.warning("news_fetcher.finbert_unavailable", error=str(e))
        _sentiment_pipeline = None
    return _sentiment_pipeline


def _analyze_sentiment(text: str) -> tuple[str, float]:
    """Run FinBERT sentiment analysis. Returns (label, score)."""
    pipe = _get_sentiment_pipeline()
    if not pipe or not text:
        return "neutral", 0.0
    try:
        result = pipe(text[:512])[0]
        label = result["label"].lower()  # positive, negative, neutral
        raw_score = result["score"]
        # Map to -1..+1 range
        if label == "positive":
            return "bullish", round(raw_score, 3)
        elif label == "negative":
            return "bearish", round(-raw_score, 3)
        else:
            return "neutral", 0.0
    except Exception:
        return "neutral", 0.0


async def _fetch_newsapi(limit: int = 30) -> list[dict[str, Any]]:
    """Fetch from NewsAPI top headlines."""
    api_key = os.getenv("NEWS_API_KEY", "")
    if not api_key:
        return []

    articles = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Business headlines
            resp = await client.get(
                "https://newsapi.org/v2/top-headlines",
                params={"category": "business", "language": "en", "pageSize": limit},
                headers={"X-Api-Key": api_key},
            )
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("articles", []):
                title = item.get("title", "")
                if not title or title == "[Removed]":
                    continue
                description = item.get("description", "") or ""
                articles.append({
                    "title": title,
                    "source": item.get("source", {}).get("name", "NewsAPI"),
                    "summary": description,
                    "url": item.get("url", ""),
                    "image_url": item.get("urlToImage", ""),
                    "timestamp": item.get("publishedAt", ""),
                    "provider": "newsapi",
                    "symbols": _extract_symbols(title + " " + description),
                })
    except Exception as e:
        logger.error("news_fetcher.newsapi_error", error=str(e))

    return articles


async def _fetch_finnhub_news() -> list[dict[str, Any]]:
    """Fetch from Finnhub general/market news."""
    api_key = os.getenv("FINNHUB_API_KEY", "")
    if not api_key:
        return []

    articles = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://finnhub.io/api/v1/news",
                params={"category": "general", "token": api_key},
            )
            resp.raise_for_status()
            data = resp.json()

            for item in data[:30]:
                title = item.get("headline", "")
                if not title:
                    continue
                summary = item.get("summary", "") or ""
                ts = item.get("datetime", 0)
                articles.append({
                    "title": title,
                    "source": item.get("source", "Finnhub"),
                    "summary": summary,
                    "url": item.get("url", ""),
                    "image_url": item.get("image", ""),
                    "timestamp": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else "",
                    "provider": "finnhub",
                    "symbols": _extract_symbols(title + " " + summary),
                })
    except Exception as e:
        logger.error("news_fetcher.finnhub_error", error=str(e))

    return articles


# Common stock symbols to detect in text
_KNOWN_SYMBOLS = {
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "TSLA", "META",
    "SPY", "QQQ", "IWM", "DIA",
    "JPM", "BAC", "WFC", "GS", "MS",
    "JNJ", "UNH", "PFE", "ABBV", "MRK",
    "XOM", "CVX", "COP",
    "DIS", "NFLX", "COST", "WMT", "HD",
    "V", "MA", "PYPL",
    "AMD", "INTC", "AVGO", "QCOM", "CRM",
    "BA", "CAT", "RTX", "LMT",
    "BRK", "BERKSHIRE",
}

# Text aliases → ticker
_COMPANY_ALIASES = {
    "apple": "AAPL", "microsoft": "MSFT", "google": "GOOGL", "alphabet": "GOOGL",
    "amazon": "AMZN", "nvidia": "NVDA", "tesla": "TSLA",
    "meta": "META", "facebook": "META",
    "netflix": "NFLX", "disney": "DIS", "costco": "COST",
    "walmart": "WMT", "jpmorgan": "JPM", "goldman": "GS",
    "boeing": "BA", "intel": "INTC", "amd": "AMD",
    "salesforce": "CRM", "paypal": "PYPL",
    "berkshire": "BRK",
}


def _extract_symbols(text: str) -> list[str]:
    """Extract stock symbols mentioned in text."""
    if not text:
        return []
    symbols = set()
    words = text.upper().split()
    for w in words:
        clean = w.strip(".,;:!?()[]{}\"'$#@")
        if clean in _KNOWN_SYMBOLS:
            symbols.add(clean)
    # Also check company name aliases
    lower = text.lower()
    for alias, ticker in _COMPANY_ALIASES.items():
        if alias in lower:
            symbols.add(ticker)
    return sorted(symbols)[:5]


async def fetch_live_news(
    limit: int = 40,
    symbol: str | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """
    Fetch live news from all configured sources.
    Deduplicates by title hash and applies FinBERT sentiment.
    """
    cache_key = f"news_{limit}_{symbol or 'all'}"

    # Check cache
    if use_cache and cache_key in _cache:
        ts, cached = _cache[cache_key]
        if time.time() - ts < _CACHE_TTL:
            return cached

    # Fetch from all sources in parallel
    results = await asyncio.gather(
        _fetch_newsapi(limit=limit),
        _fetch_finnhub_news(),
        return_exceptions=True,
    )

    all_articles: list[dict[str, Any]] = []
    seen: set[str] = set()

    for result in results:
        if isinstance(result, Exception):
            logger.error("news_fetcher.source_error", error=str(result))
            continue
        for article in result:
            # Deduplicate by title hash
            title_hash = hashlib.md5(article["title"].encode()).hexdigest()
            if title_hash in seen:
                continue
            seen.add(title_hash)
            all_articles.append(article)

    # Filter by symbol if specified
    if symbol:
        all_articles = [a for a in all_articles if symbol in a.get("symbols", [])]

    # Sort by timestamp (newest first)
    all_articles.sort(key=lambda a: a.get("timestamp", ""), reverse=True)

    # Apply sentiment analysis
    for article in all_articles[:limit]:
        text = article.get("title", "") + ". " + article.get("summary", "")
        sentiment, score = _analyze_sentiment(text)
        article["sentiment"] = sentiment
        article["score"] = score

    final = all_articles[:limit]

    # Cache the result
    _cache[cache_key] = (time.time(), final)

    return final
