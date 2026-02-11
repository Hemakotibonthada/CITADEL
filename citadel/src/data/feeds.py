"""
CITADEL — Market Data Feed Handlers

Provides unified interface for multiple data sources:
  - Yahoo Finance (free, delayed)
  - Polygon.io (real-time, paid)
  - Alpaca Markets (real-time, free with account)
  - Paper/Simulated data for testing

All feeds normalize data into CITADEL domain objects.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

import httpx
import numpy as np
import pandas as pd
import structlog

from src.core.models import (
    Bar,
    Tick,
    symbol_hash,
    TICK_DTYPE,
)

logger = structlog.get_logger(__name__)


class BaseFeed(ABC):
    """Abstract base class for all data feeds."""

    def __init__(self, name: str, config: dict[str, Any] | None = None):
        self.name = name
        self._config = config or {}
        self._connected = False
        self._subscribed_symbols: set[str] = set()

    @property
    def is_connected(self) -> bool:
        return self._connected

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to data source."""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from data source."""
        ...

    async def subscribe(self, symbols: list[str]) -> None:
        """Subscribe to market data for symbols."""
        self._subscribed_symbols.update(symbols)
        logger.info(f"feed.subscribed", feed=self.name, symbols=symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        """Unsubscribe from symbols."""
        self._subscribed_symbols -= set(symbols)

    @abstractmethod
    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        """Fetch historical OHLCV bars."""
        ...

    @abstractmethod
    async def stream_ticks(self) -> AsyncIterator[Tick]:
        """Stream live tick data."""
        ...

    async def get_latest_price(self, symbol: str) -> float | None:
        """Get latest price for a symbol."""
        bars = await self.get_historical_bars(
            symbol, "1m",
            datetime.now(timezone.utc) - timedelta(minutes=5),
            datetime.now(timezone.utc),
        )
        if bars:
            return bars[-1].close
        return None


class YahooFeed(BaseFeed):
    """Yahoo Finance data feed (free, delayed)."""

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("yahoo", config)
        self._client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "CITADEL/1.0"},
        )
        self._connected = True
        logger.info("feed.connected", feed=self.name)

    async def disconnect(self) -> None:
        if self._client:
            await self._client.aclose()
        self._connected = False
        logger.info("feed.disconnected", feed=self.name)

    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        """Fetch historical data from Yahoo Finance."""
        try:
            # Map timeframe to Yahoo interval
            interval_map = {
                "1m": "1m", "5m": "5m", "15m": "15m",
                "30m": "30m", "1h": "60m", "1d": "1d", "1w": "1wk",
            }
            interval = interval_map.get(timeframe, "1d")

            period1 = int(start.timestamp())
            period2 = int(end.timestamp())

            url = (
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
                f"?period1={period1}&period2={period2}&interval={interval}"
            )

            if not self._client:
                await self.connect()

            resp = await self._client.get(url)
            resp.raise_for_status()
            data = resp.json()

            result = data.get("chart", {}).get("result", [])
            if not result:
                return []

            chart = result[0]
            timestamps = chart.get("timestamp", [])
            quote = chart.get("indicators", {}).get("quote", [{}])[0]

            bars = []
            for i, ts in enumerate(timestamps):
                try:
                    o = quote["open"][i]
                    h = quote["high"][i]
                    l = quote["low"][i]
                    c = quote["close"][i]
                    v = quote["volume"][i]
                    if any(x is None for x in [o, h, l, c, v]):
                        continue
                    bars.append(Bar(
                        symbol=symbol,
                        timestamp=datetime.fromtimestamp(ts, tz=timezone.utc),
                        timeframe=timeframe,
                        open=float(o),
                        high=float(h),
                        low=float(l),
                        close=float(c),
                        volume=float(v),
                    ))
                except (IndexError, TypeError, KeyError):
                    continue

            logger.debug("feed.historical", feed=self.name, symbol=symbol, bars=len(bars))
            return bars

        except Exception as e:
            logger.error("feed.historical_error", feed=self.name, symbol=symbol, error=str(e))
            return []

    async def stream_ticks(self) -> AsyncIterator[Tick]:
        """Simulate tick stream from Yahoo (polling-based)."""
        while self._connected:
            for symbol in self._subscribed_symbols:
                try:
                    price = await self.get_latest_price(symbol)
                    if price:
                        spread = price * 0.0002  # Simulate 2bps spread
                        yield Tick(
                            symbol=symbol,
                            timestamp=datetime.now(timezone.utc),
                            bid=price - spread / 2,
                            ask=price + spread / 2,
                            last=price,
                            volume=0.0,
                        )
                except Exception as e:
                    logger.error("feed.tick_error", symbol=symbol, error=str(e))
            await asyncio.sleep(1.0)


class PolygonFeed(BaseFeed):
    """Polygon.io data feed (real-time)."""

    def __init__(self, api_key: str = "", config: dict[str, Any] | None = None):
        super().__init__("polygon", config)
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None
        self._base_url = "https://api.polygon.io"

    async def connect(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        self._connected = True
        logger.info("feed.connected", feed=self.name)

    async def disconnect(self) -> None:
        if self._client:
            await self._client.aclose()
        self._connected = False

    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        """Fetch from Polygon REST API."""
        try:
            tf_map = {
                "1m": ("minute", 1), "5m": ("minute", 5),
                "15m": ("minute", 15), "1h": ("hour", 1),
                "1d": ("day", 1),
            }
            timespan, multiplier = tf_map.get(timeframe, ("day", 1))
            
            start_str = start.strftime("%Y-%m-%d")
            end_str = end.strftime("%Y-%m-%d")
            
            url = (
                f"{self._base_url}/v2/aggs/ticker/{symbol}/range/"
                f"{multiplier}/{timespan}/{start_str}/{end_str}"
                f"?adjusted=true&sort=asc&limit=50000"
            )

            if not self._client:
                await self.connect()

            resp = await self._client.get(url)
            resp.raise_for_status()
            data = resp.json()

            bars = []
            for r in data.get("results", []):
                bars.append(Bar(
                    symbol=symbol,
                    timestamp=datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc),
                    timeframe=timeframe,
                    open=r["o"],
                    high=r["h"],
                    low=r["l"],
                    close=r["c"],
                    volume=r["v"],
                    vwap=r.get("vw", 0.0),
                    trades=r.get("n", 0),
                ))
            return bars

        except Exception as e:
            logger.error("feed.historical_error", feed=self.name, symbol=symbol, error=str(e))
            return []

    async def stream_ticks(self) -> AsyncIterator[Tick]:
        """WebSocket tick stream from Polygon."""
        import websockets

        ws_url = f"wss://socket.polygon.io/stocks"
        try:
            async with websockets.connect(ws_url) as ws:
                # Authenticate
                await ws.send(f'{{"action":"auth","params":"{self._api_key}"}}')
                await ws.recv()

                # Subscribe
                symbols = ",".join(f"T.{s}" for s in self._subscribed_symbols)
                await ws.send(f'{{"action":"subscribe","params":"{symbols}"}}')
                await ws.recv()

                while self._connected:
                    msg = await ws.recv()
                    import orjson
                    data = orjson.loads(msg)
                    for item in data:
                        if item.get("ev") == "T":
                            yield Tick(
                                symbol=item["sym"],
                                timestamp=datetime.fromtimestamp(
                                    item["t"] / 1e9, tz=timezone.utc
                                ),
                                bid=item["p"] * 0.9999,
                                ask=item["p"] * 1.0001,
                                last=item["p"],
                                volume=item.get("s", 0),
                            )
        except Exception as e:
            logger.error("feed.stream_error", feed=self.name, error=str(e))


class PaperFeed(BaseFeed):
    """
    Simulated data feed for paper trading and testing.
    Generates realistic-looking price data using GBM.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("paper", config)
        self._base_prices: dict[str, float] = {
            "AAPL": 195.0, "MSFT": 420.0, "GOOGL": 175.0,
            "AMZN": 200.0, "NVDA": 800.0, "TSLA": 250.0,
            "META": 550.0, "SPY": 520.0, "QQQ": 445.0, "IWM": 210.0,
        }
        self._current_prices: dict[str, float] = dict(self._base_prices)

    async def connect(self) -> None:
        self._connected = True
        logger.info("feed.connected", feed=self.name)

    async def disconnect(self) -> None:
        self._connected = False

    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        """Generate simulated historical bars using GBM."""
        base_price = self._base_prices.get(symbol, 100.0)
        
        tf_minutes = {
            "1m": 1, "5m": 5, "15m": 15,
            "30m": 30, "1h": 60, "1d": 1440,
        }
        minutes = tf_minutes.get(timeframe, 1440)
        
        total_minutes = int((end - start).total_seconds() / 60)
        num_bars = max(1, total_minutes // minutes)
        
        # GBM parameters
        mu = 0.0001  # drift per bar
        sigma = 0.02  # volatility per bar
        dt = 1.0
        
        prices = [base_price]
        for _ in range(num_bars - 1):
            change = prices[-1] * (mu * dt + sigma * np.sqrt(dt) * np.random.randn())
            prices.append(max(0.01, prices[-1] + change))

        bars = []
        current = start
        for i, price in enumerate(prices):
            noise = abs(np.random.randn() * price * 0.005)
            o = price + np.random.randn() * noise
            h = max(price, o) + abs(noise)
            l = min(price, o) - abs(noise)
            c = price
            v = abs(np.random.randn() * 1_000_000) + 100_000

            bars.append(Bar(
                symbol=symbol,
                timestamp=current,
                timeframe=timeframe,
                open=round(o, 2),
                high=round(h, 2),
                low=round(l, 2),
                close=round(c, 2),
                volume=round(v, 0),
            ))
            current += timedelta(minutes=minutes)

        self._current_prices[symbol] = prices[-1]
        return bars

    async def stream_ticks(self) -> AsyncIterator[Tick]:
        """Generate simulated tick stream."""
        while self._connected:
            for symbol in self._subscribed_symbols:
                price = self._current_prices.get(symbol, 100.0)
                # Random walk
                change = price * np.random.randn() * 0.001
                price = max(0.01, price + change)
                self._current_prices[symbol] = price

                spread = price * 0.0002
                yield Tick(
                    symbol=symbol,
                    timestamp=datetime.now(timezone.utc),
                    bid=round(price - spread / 2, 4),
                    ask=round(price + spread / 2, 4),
                    last=round(price, 4),
                    volume=float(random.randint(100, 10000)),
                )
            await asyncio.sleep(0.1)


class AlpacaFeed(BaseFeed):
    """
    Alpaca Markets data feed (real-time, free with paper account).

    Uses Alpaca Data API v2:
      - REST: https://data.alpaca.markets/v2/stocks/{symbol}/bars
      - WebSocket: wss://stream.data.alpaca.markets/v2/iex

    Requires ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables
    (or pass them via config dict).
    """

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__("alpaca", config)
        self._api_key = self._config.get("api_key", os.environ.get("ALPACA_API_KEY", ""))
        self._api_secret = self._config.get("api_secret", os.environ.get("ALPACA_SECRET_KEY", ""))
        self._base_url = self._config.get(
            "base_url",
            os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
        )
        self._data_url = "https://data.alpaca.markets"
        self._ws_url = "wss://stream.data.alpaca.markets/v2/iex"
        self._client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        """Connect to Alpaca — validates credentials against the account endpoint."""
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={
                "APCA-API-KEY-ID": self._api_key,
                "APCA-API-SECRET-KEY": self._api_secret,
            },
        )
        # Validate credentials
        try:
            resp = await self._client.get(f"{self._base_url}/v2/account")
            resp.raise_for_status()
            acct = resp.json()
            logger.info(
                "feed.connected",
                feed=self.name,
                account_status=acct.get("status"),
                buying_power=acct.get("buying_power"),
                equity=acct.get("equity"),
            )
        except httpx.HTTPStatusError as exc:
            logger.error("feed.auth_failed", feed=self.name, status=exc.response.status_code)
            raise ConnectionError(f"Alpaca auth failed: {exc.response.status_code}") from exc
        self._connected = True

    async def disconnect(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        self._connected = False
        logger.info("feed.disconnected", feed=self.name)

    # ── Historical bars ───────────────────────────────────
    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        """Fetch historical bars from Alpaca Data API v2."""
        try:
            tf_map = {
                "1m": "1Min", "5m": "5Min", "15m": "15Min",
                "30m": "30Min", "1h": "1Hour", "1d": "1Day", "1w": "1Week",
            }
            alpaca_tf = tf_map.get(timeframe, "1Day")

            if not self._client:
                await self.connect()

            all_bars: list[Bar] = []
            page_token: str | None = None

            while True:
                params: dict[str, Any] = {
                    "timeframe": alpaca_tf,
                    "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "limit": 10000,
                    "adjustment": "all",
                    "feed": "iex",
                    "sort": "asc",
                }
                if page_token:
                    params["page_token"] = page_token

                resp = await self._client.get(
                    f"{self._data_url}/v2/stocks/{symbol}/bars",
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()

                for b in data.get("bars", []) or []:
                    all_bars.append(Bar(
                        symbol=symbol,
                        timestamp=datetime.fromisoformat(b["t"].replace("Z", "+00:00")),
                        timeframe=timeframe,
                        open=float(b["o"]),
                        high=float(b["h"]),
                        low=float(b["l"]),
                        close=float(b["c"]),
                        volume=float(b["v"]),
                        vwap=float(b.get("vw", 0.0)),
                        trades=int(b.get("n", 0)),
                    ))

                page_token = data.get("next_page_token")
                if not page_token:
                    break

            logger.debug("feed.historical", feed=self.name, symbol=symbol, bars=len(all_bars))
            return all_bars

        except Exception as e:
            logger.error("feed.historical_error", feed=self.name, symbol=symbol, error=str(e))
            return []

    # ── Latest quote ──────────────────────────────────────
    async def get_latest_price(self, symbol: str) -> float | None:
        """Get latest trade price from Alpaca."""
        try:
            if not self._client:
                await self.connect()
            resp = await self._client.get(
                f"{self._data_url}/v2/stocks/{symbol}/trades/latest",
                params={"feed": "iex"},
            )
            resp.raise_for_status()
            trade = resp.json().get("trade", {})
            return float(trade["p"]) if trade else None
        except Exception as e:
            logger.error("feed.latest_error", feed=self.name, symbol=symbol, error=str(e))
            return None

    # ── Real-time streaming ───────────────────────────────
    async def stream_ticks(self) -> AsyncIterator[Tick]:
        """Stream real-time trades via Alpaca WebSocket (IEX feed)."""
        import websockets
        import json as _json

        while self._connected:
            try:
                async with websockets.connect(self._ws_url) as ws:
                    # Wait for welcome
                    welcome = await asyncio.wait_for(ws.recv(), timeout=10)
                    logger.debug("feed.ws_welcome", data=welcome)

                    # Authenticate
                    auth_msg = _json.dumps({
                        "action": "auth",
                        "key": self._api_key,
                        "secret": self._api_secret,
                    })
                    await ws.send(auth_msg)
                    auth_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                    logger.debug("feed.ws_auth", data=auth_resp)

                    # Subscribe to trades + quotes
                    sub_msg = _json.dumps({
                        "action": "subscribe",
                        "trades": list(self._subscribed_symbols),
                        "quotes": list(self._subscribed_symbols),
                    })
                    await ws.send(sub_msg)
                    sub_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                    logger.info("feed.ws_subscribed", data=sub_resp)

                    # Read messages
                    async for raw in ws:
                        if not self._connected:
                            break
                        msgs = _json.loads(raw)
                        for msg in msgs:
                            t = msg.get("T")
                            if t == "t":  # trade
                                yield Tick(
                                    symbol=msg["S"],
                                    timestamp=datetime.fromisoformat(
                                        msg["t"].replace("Z", "+00:00")
                                    ),
                                    bid=float(msg["p"]) * 0.9999,
                                    ask=float(msg["p"]) * 1.0001,
                                    last=float(msg["p"]),
                                    volume=float(msg.get("s", 0)),
                                )
                            elif t == "q":  # quote
                                yield Tick(
                                    symbol=msg["S"],
                                    timestamp=datetime.fromisoformat(
                                        msg["t"].replace("Z", "+00:00")
                                    ),
                                    bid=float(msg.get("bp", 0)),
                                    ask=float(msg.get("ap", 0)),
                                    last=float(msg.get("bp", 0)),
                                    volume=0.0,
                                )

            except Exception as e:
                logger.error("feed.stream_error", feed=self.name, error=str(e))
                if self._connected:
                    await asyncio.sleep(5.0)  # Reconnect backoff


class FeedManager:
    """
    Manages multiple data feeds and provides unified access.
    Handles failover between primary and secondary feeds.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self._config = config or {}
        self._feeds: dict[str, BaseFeed] = {}
        self._primary: str = ""
        self._secondary: str = ""

    def register_feed(self, feed: BaseFeed, primary: bool = False) -> None:
        """Register a data feed."""
        self._feeds[feed.name] = feed
        if primary:
            self._primary = feed.name

    async def connect_all(self) -> None:
        """Connect all registered feeds."""
        for feed in self._feeds.values():
            try:
                await feed.connect()
            except Exception as e:
                logger.error("feed_manager.connect_error", feed=feed.name, error=str(e))

    async def disconnect_all(self) -> None:
        """Disconnect all feeds."""
        for feed in self._feeds.values():
            try:
                await feed.disconnect()
            except Exception:
                pass

    async def subscribe_all(self, symbols: list[str]) -> None:
        """Subscribe all feeds to symbols."""
        for feed in self._feeds.values():
            await feed.subscribe(symbols)

    async def get_historical_bars(
        self,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        feed_name: str | None = None,
    ) -> list[Bar]:
        """Get bars from specified or primary feed, with failover."""
        feed_name = feed_name or self._primary
        
        # Try primary
        feed = self._feeds.get(feed_name)
        if feed:
            bars = await feed.get_historical_bars(symbol, timeframe, start, end)
            if bars:
                return bars

        # Failover to other feeds
        for name, feed in self._feeds.items():
            if name != feed_name:
                bars = await feed.get_historical_bars(symbol, timeframe, start, end)
                if bars:
                    logger.warning("feed_manager.failover", primary=feed_name, used=name)
                    return bars

        return []

    def get_feed(self, name: str) -> BaseFeed | None:
        """Get a specific feed by name."""
        return self._feeds.get(name)

    @property
    def primary_feed(self) -> BaseFeed | None:
        return self._feeds.get(self._primary)

    def status(self) -> dict[str, dict[str, Any]]:
        """Get status of all feeds."""
        return {
            name: {
                "connected": feed.is_connected,
                "subscribed": list(feed._subscribed_symbols),
            }
            for name, feed in self._feeds.items()
        }
