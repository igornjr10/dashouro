"""Key levels for a trading day, all built only from data available before that day (no look-ahead)."""
from dataclasses import dataclass, field

from . import config, profile
from .data import Bar
from .timeutil import DAY, HOUR, utc_day


@dataclass
class DayLevels:
    day: int                     # UTC day start (ms)
    pdh: float
    pdl: float
    pdc: float
    fib: dict[float, float]      # ratio -> price, 0 = previous high, 1 = previous low
    prof: profile.Profile
    asia_high: float | None = None
    asia_low: float | None = None
    named: list[tuple[str, float]] = field(default_factory=list)

    @property
    def mid(self) -> float:
        """50% of the previous day's range: above it is premium (sell side), below it discount (buy side)."""
        return (self.pdh + self.pdl) / 2


def group_by_day(bars: list[Bar]) -> dict[int, list[Bar]]:
    days: dict[int, list[Bar]] = {}
    for b in bars:
        days.setdefault(utc_day(b.t), []).append(b)
    return days


def for_day(day: int, prev: list[Bar], today: list[Bar]) -> DayLevels | None:
    p = profile.build(prev)
    if not prev or p is None:
        return None
    hi, lo = max(b.h for b in prev), min(b.l for b in prev)
    fib = {r: hi - r * (hi - lo) for r in config.FIB_LEVELS}
    lv = DayLevels(day, hi, lo, prev[-1].c, fib, p)
    # The Asian range (00-07 UTC) only becomes a level once that session has closed.
    asia = [b for b in today if b.t < day + 7 * HOUR]
    if asia:
        lv.asia_high, lv.asia_low = max(b.h for b in asia), min(b.l for b in asia)
    lv.named = [("máx ontem", hi), ("mín ontem", lo), ("POC", p.poc), ("VAH", p.vah), ("VAL", p.val)]
    lv.named += [(f"Fib {r * 100:g}%", v) for r, v in fib.items()]
    lv.named += [("HVN", v) for v in p.hvn] + [("LVN", v) for v in p.lvn]
    return lv


def levels_at(lv: DayLevels, t: int) -> list[tuple[str, float]]:
    """Levels usable at time t: the Asian high/low join after the Asian session ends."""
    out = list(lv.named)
    if lv.asia_high is not None and t >= lv.day + 7 * HOUR:
        out += [("máx Ásia", lv.asia_high), ("mín Ásia", lv.asia_low)]
    return out


def previous_trading_day(days: dict[int, list[Bar]], day: int) -> list[Bar]:
    """Bars of the latest earlier UTC day that has data (skips weekends)."""
    d = day - DAY
    for _ in range(5):
        if d in days:
            return days[d]
        d -= DAY
    return []
