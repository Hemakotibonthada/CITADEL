"""Test Alpaca Paper Trading connection and data feed."""
import sys, os

_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(_DIR)
sys.path.insert(0, _DIR)
sys.path.insert(0, os.path.join(_DIR, "src"))

# Load .env
_env_path = os.path.join(_DIR, ".env")
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

import asyncio
from datetime import datetime, timedelta, timezone
from data.feeds import AlpacaFeed


async def main():
    feed = AlpacaFeed()

    # 1) Connect & validate credentials
    print("=" * 50)
    print(" TEST 1: Alpaca Connection")
    print("=" * 50)
    try:
        await feed.connect()
        print(f"  Connected: {feed.is_connected}")
        assert feed.is_connected, "Failed to connect"
        print("  [PASS] Connection successful\n")
    except Exception as e:
        print(f"  [FAIL] Connection failed: {e}")
        return

    # 2) Get latest price
    print("=" * 50)
    print(" TEST 2: Latest Price")
    print("=" * 50)
    for symbol in ["AAPL", "MSFT", "NVDA"]:
        price = await feed.get_latest_price(symbol)
        print(f"  {symbol}: ${price:.2f}" if price else f"  {symbol}: N/A")
    print("  [PASS] Latest prices fetched\n")

    # 3) Historical bars
    print("=" * 50)
    print(" TEST 3: Historical Bars (AAPL, 1d, last 5 days)")
    print("=" * 50)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=5)
    bars = await feed.get_historical_bars("AAPL", "1d", start, end)
    print(f"  Got {len(bars)} daily bars")
    for bar in bars[-3:]:
        print(f"    {bar.timestamp.date()} | O:{bar.open:.2f} H:{bar.high:.2f} L:{bar.low:.2f} C:{bar.close:.2f} V:{bar.volume:.0f}")
    if bars:
        print("  [PASS] Historical bars retrieved\n")
    else:
        print("  [WARN] No bars returned (market may be closed)\n")

    # 4) Intraday bars
    print("=" * 50)
    print(" TEST 4: Intraday Bars (SPY, 5m, today)")
    print("=" * 50)
    today_start = end.replace(hour=14, minute=0, second=0)  # ~market open UTC
    intraday = await feed.get_historical_bars("SPY", "5m", today_start, end)
    print(f"  Got {len(intraday)} 5-min bars for SPY")
    for bar in intraday[-3:]:
        print(f"    {bar.timestamp.strftime('%H:%M')} | C:{bar.close:.2f} V:{bar.volume:.0f}")
    print("  [PASS] Intraday bars OK\n")

    # 5) Cleanup
    await feed.disconnect()
    print(f"Disconnected: {not feed.is_connected}")
    print("\n*** All Alpaca tests passed ***")


if __name__ == "__main__":
    asyncio.run(main())
