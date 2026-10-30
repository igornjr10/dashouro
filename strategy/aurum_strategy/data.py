"""Twelve Data XAU/USD candles with a local CSV cache (one credit per request, up to 5000 bars each)."""
import csv
import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

CACHE = Path(__file__).resolve().parent.parent / "data"
INTERVALS = {"1min": 60_000, "5min": 300_000, "1h": 3_600_000}


@dataclass(frozen=True)
class Bar:
    t: int  # open time, ms UTC
    o: float
    h: float
    l: float
    c: float


def api_key() -> str:
    """TWELVEDATA_API_KEY from the environment, else from the dashboard's .env.local."""
    key = os.environ.get("TWELVEDATA_API_KEY")
    if key:
        return key
    for base in (Path.cwd(), Path(__file__).resolve().parents[2]):
        for p in (base / ".env.local", base.parent / "dashouro" / ".env.local"):
            if p.exists():
                for line in p.read_text(encoding="utf-8").splitlines():
                    if line.startswith("TWELVEDATA_API_KEY="):
                        return line.split("=", 1)[1].strip()
    raise SystemExit("TWELVEDATA_API_KEY não encontrada (variável de ambiente ou .env.local).")


def _request(interval: str, end: str | None, key: str) -> list[Bar]:
    q = {"symbol": "XAU/USD", "interval": interval, "outputsize": "5000", "timezone": "UTC", "apikey": key}
    if end:
        q["end_date"] = end
    url = "https://api.twelvedata.com/time_series?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=30) as r:
        j = json.load(r)
    if j.get("status") != "ok":
        raise RuntimeError(f"Twelve Data: {j.get('message', j)}")
    bars = []
    for v in j["values"]:
        t = int(datetime.strptime(v["datetime"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp() * 1000)
        bars.append(Bar(t, float(v["open"]), float(v["high"]), float(v["low"]), float(v["close"])))
    return sorted(bars, key=lambda b: b.t)


def _load(path: Path) -> dict[int, Bar]:
    if not path.exists():
        return {}
    with path.open(newline="") as f:
        return {int(r["t"]): Bar(int(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]), float(r["c"])) for r in csv.DictReader(f)}


def _save(path: Path, bars: dict[int, Bar]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t", "o", "h", "l", "c"])
        for b in sorted(bars.values(), key=lambda b: b.t):
            w.writerow([b.t, b.o, b.h, b.l, b.c])


def candles(interval: str, days: int, refresh: bool = True) -> list[Bar]:
    """Completed bars covering the last `days` days. Pages backwards from now; the free plan allows 8 requests/min."""
    step = INTERVALS[interval]
    path = CACHE / f"xauusd_{interval}.csv"
    have = _load(path)
    now = int(time.time() * 1000)
    since = now - days * 86_400_000
    key = api_key()
    if refresh or not have:
        new = _request(interval, None, key)
        have.update({b.t: b for b in new})
        # Page back until the cache reaches the requested start (Twelve Data returns the newest bars first).
        while min(have) > since:
            oldest = min(have)
            end = datetime.fromtimestamp(oldest / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            older = [b for b in _request(interval, end, key) if b.t < oldest]
            if not older:
                break
            have.update({b.t: b for b in older})
            time.sleep(8)  # stay under 8 requests per minute
        _save(path, have)
    return [b for b in sorted(have.values(), key=lambda b: b.t) if b.t >= since and b.t + step <= now]
