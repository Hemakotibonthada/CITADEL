"""
CITADEL — Tactician Agent (Trading Logic & Decision Engine)

The primary trading intelligence agent:
  - Uses Chain-of-Thought (CoT) reasoning
  - Combines Price + News + Risk context
  - Produces structured JSON trading decisions
  - Logs "Mental State" for post-market analysis
  - Streams reasoning tokens for "The Brain" UI view
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np
import structlog

from src.agents.base import BaseAgent
from src.core.models import (
    AgentAction, AgentDecision, Bar, Event, EventType,
    Signal, Sentiment, PortfolioSnapshot,
)
from src.core.event_bus.bus import EventBus

logger = structlog.get_logger(__name__)


# Chain-of-Thought system prompt for the trading LLM
SYSTEM_PROMPT = """You are CITADEL Tactician, an expert algorithmic trading agent.
You analyze market data, news sentiment, and risk metrics to make trading decisions.

Your analysis must follow this structured Chain-of-Thought process:

1. MARKET ANALYSIS: Examine current price action, indicators, and trends
2. NEWS CONTEXT: Consider relevant news and sentiment scores  
3. RISK ASSESSMENT: Evaluate current portfolio exposure and risk metrics
4. DECISION: Output a structured trading decision

CRITICAL RULES:
- Never exceed position concentration limits
- Always provide confidence scores (0.0-1.0)
- Consider correlation with existing positions
- Explain your reasoning clearly
- If uncertain, default to HOLD

Output your decision as JSON:
{
    "action": "BUY|SELL|HOLD|CLOSE",
    "symbol": "TICKER",
    "confidence": 0.0-1.0,
    "size_pct": 0.0-100.0,
    "rationale": "Brief explanation",
    "risk_assessment": "Risk evaluation",
    "chain_of_thought": "Full reasoning process"
}"""


class TacticianAgent(BaseAgent):
    """
    Trading Logic Agent — The market strategist.
    
    Uses LLM reasoning (Chain-of-Thought) to analyze:
      1. Technical indicators and price patterns
      2. News sentiment from the Librarian
      3. Portfolio risk from the Sentinel
      
    Produces structured trading decisions.
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        event_bus: EventBus | None = None,
        llm_engine: Any = None,
    ):
        super().__init__("Tactician", config, event_bus)
        
        self._llm_engine = llm_engine
        self._llm_config = self._config.get("llm_config", {})
        self._min_confidence = self._config.get("min_confidence", 0.7)
        self._max_positions = self._config.get("max_positions", 5)
        
        # State
        self._current_bars: dict[str, list[Bar]] = {}
        self._portfolio: PortfolioSnapshot | None = None
        self._sentiment_data: dict[str, float] = {}
        self._news_context: list[dict[str, Any]] = []
        self._decisions: list[AgentDecision] = []
        self._mental_states: list[dict[str, Any]] = []
        self._cot_stream: list[str] = []  # For UI streaming
        
        # Analysis interval
        self._analysis_interval = self._config.get("analysis_interval_s", 60)
        self._last_analysis = 0.0
        self._decisions_today = 0

    async def start(self) -> None:
        """Start with event subscriptions."""
        await super().start()
        
        if self._event_bus:
            self._event_bus.subscribe(EventType.BAR, self._on_bar)
            self._event_bus.subscribe(EventType.AGENT_STATE, self._on_agent_state)

    async def _process(self) -> None:
        """Main tactician processing loop."""
        now = time.time()
        
        if now - self._last_analysis < self._analysis_interval:
            await asyncio.sleep(1.0)
            return
        
        self._last_analysis = now
        
        # Analyze each symbol in universe
        universe = self._config.get("universe", ["AAPL", "MSFT", "GOOGL"])
        
        for symbol in universe:
            if symbol not in self._current_bars or not self._current_bars[symbol]:
                continue
            
            try:
                decision = await self._analyze_symbol(symbol)
                if decision and decision.confidence >= self._min_confidence:
                    self._decisions.append(decision)
                    self._decisions_today += 1
                    
                    # Convert to signal and publish
                    signal = Signal(
                        source=self._name,
                        symbol=decision.symbol,
                        action=decision.action,
                        confidence=decision.confidence,
                        size_pct=decision.size_pct,
                        rationale=decision.rationale,
                    )
                    
                    if self._event_bus:
                        await self._event_bus.publish(Event(
                            event_type=EventType.SIGNAL,
                            source=self._name,
                            payload=signal.model_dump(mode="json"),
                        ))
                    
                    logger.info(
                        "tactician.decision",
                        symbol=decision.symbol,
                        action=decision.action.value,
                        confidence=decision.confidence,
                        rationale=decision.rationale[:100],
                    )
            except Exception as e:
                logger.error("tactician.analysis_error", symbol=symbol, error=str(e))

    async def _analyze_symbol(self, symbol: str) -> AgentDecision | None:
        """
        Perform full Chain-of-Thought analysis on a symbol.
        """
        bars = self._current_bars.get(symbol, [])
        if not bars:
            return None

        # ── 1. Build technical context ────────────────────
        technical_context = self._build_technical_context(symbol, bars)

        # ── 2. Build news context ─────────────────────────
        news_context = self._build_news_context(symbol)

        # ── 3. Build risk context ─────────────────────────
        risk_context = self._build_risk_context(symbol)

        # ── 4. Build prompt ───────────────────────────────
        prompt = self._build_analysis_prompt(
            symbol, technical_context, news_context, risk_context
        )

        # ── 5. Run LLM analysis ──────────────────────────
        if self._llm_engine:
            decision = await self._run_llm_analysis(symbol, prompt)
        else:
            # Fallback: rule-based analysis
            decision = self._rule_based_analysis(symbol, technical_context, news_context)

        # ── 6. Log mental state ──────────────────────────
        if decision:
            mental_state = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "symbol": symbol,
                "action": decision.action.value,
                "confidence": decision.confidence,
                "technical_summary": technical_context.get("summary", ""),
                "sentiment": news_context.get("sentiment", "NEUTRAL"),
                "risk_level": risk_context.get("risk_level", "NORMAL"),
                "chain_of_thought": decision.chain_of_thought,
            }
            self._mental_states.append(mental_state)

        return decision

    def _build_technical_context(
        self, symbol: str, bars: list[Bar]
    ) -> dict[str, Any]:
        """Build technical analysis context."""
        if len(bars) < 20:
            return {"summary": "Insufficient data", "indicators": {}}

        closes = np.array([b.close for b in bars])
        volumes = np.array([b.volume for b in bars])
        highs = np.array([b.high for b in bars])
        lows = np.array([b.low for b in bars])

        # Moving averages
        sma_20 = np.mean(closes[-20:])
        sma_50 = np.mean(closes[-50:]) if len(closes) >= 50 else sma_20

        # RSI
        deltas = np.diff(closes[-15:])
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.mean(gains) if len(gains) > 0 else 0
        avg_loss = np.mean(losses) if len(losses) > 0 else 0.001
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))

        # Volatility
        returns = np.diff(closes) / closes[:-1]
        volatility = np.std(returns[-20:]) * np.sqrt(252) if len(returns) >= 20 else 0

        # Trend
        current = closes[-1]
        trend = "BULLISH" if current > sma_20 > sma_50 else (
            "BEARISH" if current < sma_20 < sma_50 else "SIDEWAYS"
        )

        # Volume trend
        avg_vol = np.mean(volumes[-20:])
        vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 1.0

        # Support/Resistance
        recent_low = np.min(lows[-20:])
        recent_high = np.max(highs[-20:])

        return {
            "summary": f"{symbol}: {trend}, RSI={rsi:.1f}, Vol={volatility*100:.1f}%",
            "price": float(current),
            "sma_20": float(sma_20),
            "sma_50": float(sma_50),
            "rsi": float(rsi),
            "volatility": float(volatility),
            "trend": trend,
            "volume_ratio": float(vol_ratio),
            "support": float(recent_low),
            "resistance": float(recent_high),
            "indicators": {
                "price": float(current),
                "sma_20": float(sma_20),
                "sma_50": float(sma_50),
                "rsi": float(rsi),
                "volatility": float(volatility),
                "volume_ratio": float(vol_ratio),
            },
        }

    def _build_news_context(self, symbol: str) -> dict[str, Any]:
        """Build news/sentiment context for a symbol."""
        symbol_sentiment = self._sentiment_data.get(symbol, 0.0)
        relevant_news = [
            n for n in self._news_context
            if symbol in n.get("symbols", [])
        ][:5]

        sentiment = "BULLISH" if symbol_sentiment > 0.2 else (
            "BEARISH" if symbol_sentiment < -0.2 else "NEUTRAL"
        )

        return {
            "sentiment": sentiment,
            "score": symbol_sentiment,
            "articles": relevant_news,
            "count": len(relevant_news),
        }

    def _build_risk_context(self, symbol: str) -> dict[str, Any]:
        """Build risk context for a symbol."""
        if not self._portfolio:
            return {"risk_level": "UNKNOWN", "has_position": False}

        has_position = any(
            p.symbol == symbol for p in self._portfolio.positions
        )
        
        position_value = 0.0
        position_pnl = 0.0
        for p in self._portfolio.positions:
            if p.symbol == symbol:
                position_value = p.market_value
                position_pnl = p.unrealized_pnl

        exposure_pct = (position_value / max(self._portfolio.total_equity, 1)) * 100

        risk_level = "LOW"
        if self._portfolio.leverage > 1.5:
            risk_level = "HIGH"
        elif self._portfolio.leverage > 1.0:
            risk_level = "MEDIUM"

        return {
            "risk_level": risk_level,
            "has_position": has_position,
            "position_value": position_value,
            "position_pnl": position_pnl,
            "exposure_pct": exposure_pct,
            "portfolio_leverage": self._portfolio.leverage,
            "daily_pnl": self._portfolio.daily_pnl,
            "num_positions": len(self._portfolio.positions),
        }

    def _build_analysis_prompt(
        self,
        symbol: str,
        technical: dict[str, Any],
        news: dict[str, Any],
        risk: dict[str, Any],
    ) -> str:
        """Build the analysis prompt for the LLM."""
        return f"""
ANALYZE: {symbol}

TECHNICAL DATA:
- Price: ${technical.get('price', 0):.2f}
- SMA(20): ${technical.get('sma_20', 0):.2f}
- SMA(50): ${technical.get('sma_50', 0):.2f}
- RSI(14): {technical.get('rsi', 50):.1f}
- Trend: {technical.get('trend', 'UNKNOWN')}
- Volatility: {technical.get('volatility', 0)*100:.1f}%
- Volume Ratio: {technical.get('volume_ratio', 1):.2f}x
- Support: ${technical.get('support', 0):.2f}
- Resistance: ${technical.get('resistance', 0):.2f}

NEWS SENTIMENT:
- Overall: {news.get('sentiment', 'NEUTRAL')} (score: {news.get('score', 0):.2f})
- Recent articles: {news.get('count', 0)}
{chr(10).join(f"  - {a.get('title', '')}" for a in news.get('articles', [])[:3])}

RISK CONTEXT:
- Risk Level: {risk.get('risk_level', 'UNKNOWN')}
- Has Position: {risk.get('has_position', False)}
- Position P&L: ${risk.get('position_pnl', 0):.2f}
- Portfolio Leverage: {risk.get('portfolio_leverage', 0):.2f}x
- Current Positions: {risk.get('num_positions', 0)}

Provide your Chain-of-Thought analysis and trading decision as JSON.
"""

    async def _run_llm_analysis(
        self, symbol: str, prompt: str
    ) -> AgentDecision | None:
        """Run LLM-based analysis."""
        try:
            # Stream the response for the "Brain" view
            self._cot_stream.clear()
            
            full_prompt = SYSTEM_PROMPT + "\n\n" + prompt
            response = await self._llm_engine.generate(
                full_prompt,
                max_tokens=self._llm_config.get("max_tokens", 2048),
            )

            self._cot_stream.append(response)

            # Parse JSON decision from response
            decision_data = self._parse_decision(response, symbol)
            if decision_data:
                return AgentDecision(
                    agent_name=self._name,
                    action=AgentAction(decision_data.get("action", "HOLD")),
                    symbol=symbol,
                    confidence=float(decision_data.get("confidence", 0.5)),
                    size_pct=float(decision_data.get("size_pct", 0.0)),
                    rationale=decision_data.get("rationale", ""),
                    risk_assessment=decision_data.get("risk_assessment", ""),
                    chain_of_thought=decision_data.get("chain_of_thought", response),
                )
        except Exception as e:
            logger.error("tactician.llm_error", symbol=symbol, error=str(e))

        return None

    def _rule_based_analysis(
        self,
        symbol: str,
        technical: dict[str, Any],
        news: dict[str, Any],
    ) -> AgentDecision | None:
        """Fallback rule-based analysis when LLM is unavailable."""
        rsi = technical.get("rsi", 50)
        trend = technical.get("trend", "SIDEWAYS")
        sentiment = news.get("sentiment", "NEUTRAL")
        vol_ratio = technical.get("volume_ratio", 1.0)

        # Scoring
        score = 0.0
        rationale_parts = []

        # Trend signal
        if trend == "BULLISH":
            score += 0.3
            rationale_parts.append("Bullish trend (price > SMA20 > SMA50)")
        elif trend == "BEARISH":
            score -= 0.3
            rationale_parts.append("Bearish trend")

        # RSI signal
        if rsi < 30:
            score += 0.25
            rationale_parts.append(f"Oversold RSI={rsi:.1f}")
        elif rsi > 70:
            score -= 0.25
            rationale_parts.append(f"Overbought RSI={rsi:.1f}")

        # Sentiment signal
        if sentiment == "BULLISH":
            score += 0.2
            rationale_parts.append("Positive news sentiment")
        elif sentiment == "BEARISH":
            score -= 0.2
            rationale_parts.append("Negative news sentiment")

        # Volume confirmation
        if vol_ratio > 1.5:
            score *= 1.2
            rationale_parts.append(f"High volume ({vol_ratio:.1f}x avg)")

        # Decision
        confidence = min(1.0, abs(score))
        
        if score > 0.2 and confidence >= self._min_confidence:
            return AgentDecision(
                agent_name=self._name,
                action=AgentAction.BUY,
                symbol=symbol,
                confidence=confidence,
                size_pct=min(10.0, confidence * 15),
                rationale="; ".join(rationale_parts),
                risk_assessment=f"Trend: {trend}, RSI: {rsi:.1f}",
                chain_of_thought=f"Rule-based: score={score:.2f}. " + "; ".join(rationale_parts),
            )
        elif score < -0.2 and confidence >= self._min_confidence:
            return AgentDecision(
                agent_name=self._name,
                action=AgentAction.SELL,
                symbol=symbol,
                confidence=confidence,
                size_pct=min(10.0, confidence * 15),
                rationale="; ".join(rationale_parts),
                risk_assessment=f"Trend: {trend}, RSI: {rsi:.1f}",
                chain_of_thought=f"Rule-based: score={score:.2f}. " + "; ".join(rationale_parts),
            )

        return None

    def _parse_decision(self, response: str, symbol: str) -> dict[str, Any] | None:
        """Parse JSON decision from LLM response."""
        try:
            # Find JSON block
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                json_str = response[start:end]
                return json.loads(json_str)
        except json.JSONDecodeError:
            pass
        
        return None

    async def _on_bar(self, event: Event) -> None:
        """Receive bar data."""
        bar_data = event.payload
        symbol = bar_data.get("symbol", "")
        if symbol:
            if symbol not in self._current_bars:
                self._current_bars[symbol] = []
            
            bar = Bar(**bar_data)
            self._current_bars[symbol].append(bar)
            
            # Keep last 200 bars
            if len(self._current_bars[symbol]) > 200:
                self._current_bars[symbol] = self._current_bars[symbol][-200:]

    async def _on_agent_state(self, event: Event) -> None:
        """Receive state updates from other agents."""
        if event.source == "Librarian":
            payload = event.payload
            if payload.get("type") == "news_processed":
                symbols = payload.get("symbols", [])
                score = payload.get("score", 0.0)
                for sym in symbols:
                    self._sentiment_data[sym] = score
                self._news_context.append(payload)
                # Keep recent
                if len(self._news_context) > 100:
                    self._news_context = self._news_context[-100:]

    def update_portfolio(self, snapshot: PortfolioSnapshot) -> None:
        """Update portfolio state."""
        self._portfolio = snapshot

    def get_mental_states(self) -> list[dict[str, Any]]:
        """Get recorded mental states for review."""
        return list(self._mental_states)

    def get_decisions_today(self) -> list[AgentDecision]:
        """Get all decisions made today."""
        today = datetime.now(timezone.utc).date()
        return [
            d for d in self._decisions
            if d.timestamp.date() == today
        ]

    def get_cot_stream(self) -> list[str]:
        """Get the latest Chain-of-Thought stream for UI."""
        return list(self._cot_stream)

    def get_analysis_summary(self) -> dict[str, Any]:
        """Get analysis summary."""
        return {
            "decisions_today": self._decisions_today,
            "total_decisions": len(self._decisions),
            "symbols_tracked": list(self._current_bars.keys()),
            "sentiment_data": dict(self._sentiment_data),
            "recent_decisions": [
                {
                    "symbol": d.symbol,
                    "action": d.action.value,
                    "confidence": d.confidence,
                    "rationale": d.rationale[:100],
                    "timestamp": d.timestamp.isoformat(),
                }
                for d in self._decisions[-10:]
            ],
        }
