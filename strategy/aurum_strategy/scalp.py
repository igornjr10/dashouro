"""Scalping setups on M1/M5, all traded with Igor's rules through trades.plan/simulate.

Each generator yields (side, entry_time, entry_price, invalidation, target, reason); entries happen at the open of the
bar after the signal bar, so nothing uses information from the future.
"""
from . import config
from .data import Bar
from .timeutil import HOUR, ny_time, utc_day

MIN = 60_000


def _ema(values: list[float], n: int) -> list[float]:
    out, e, k = [], None, 2 / (n + 1)
    for v in values:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def _ny_minutes(t: int) -> int:
    x = ny_time(t)
    return x.hour * 60 + x.minute


def _far(side: str, entry: float) -> float:
    """No natural target: aim at TP3 so the ladder decides the exits."""
    return entry + (1 if side == "buy" else -1) * config.TP3 * config.PIP


def opening_range_breakout(bars: list[Bar], step: int, opens=((3, 0), (8, 0)), minutes: int = 15, window_h: int = 2):
    """First `minutes` after London (03:00 NY) and New York (08:00 NY) define a range; the first close outside it
    within `window_h` hours enters in that direction, stop at the other side of the range."""
    by_day: dict[int, list[int]] = {}
    for i, b in enumerate(bars):
        by_day.setdefault(utc_day(b.t), []).append(i)
    for idx in by_day.values():
        for oh, om in opens:
            start = oh * 60 + om
            rng = [i for i in idx if start <= _ny_minutes(bars[i].t) < start + minutes]
            if len(rng) < minutes * MIN // step * 0.8:
                continue
            hi, lo = max(bars[i].h for i in rng), min(bars[i].l for i in rng)
            end_t = bars[rng[-1]].t + step + window_h * HOUR
            for i in range(rng[-1] + 1, min(len(bars) - 1, rng[-1] + 1 + window_h * HOUR // step)):
                b = bars[i]
                if b.t >= end_t:
                    break
                side = "buy" if b.c > hi else "sell" if b.c < lo else None
                if side:
                    nxt = bars[i + 1]
                    yield side, nxt.t, nxt.o, lo if side == "buy" else hi, _far(side, nxt.o), f"Rompimento da faixa de {minutes} min ({oh:02d}h NY)"
                    break


def asia_sweep(bars: list[Bar], step: int):
    """Asian range 00-07 UTC. In the London killzone (02-05 NY) a bar trades through the Asian high or low and closes
    back inside: trade against the sweep, stop beyond the sweep wick, target the other side of the range."""
    by_day: dict[int, list[int]] = {}
    for i, b in enumerate(bars):
        by_day.setdefault(utc_day(b.t), []).append(i)
    for day, idx in by_day.items():
        asia = [i for i in idx if bars[i].t < day + 7 * HOUR]
        if len(asia) < 7 * HOUR // step * 0.8:
            continue
        hi, lo = max(bars[i].h for i in asia), min(bars[i].l for i in asia)
        for i in idx:
            m = _ny_minutes(bars[i].t)
            if not (120 <= m < 300) or bars[i].t < day + 7 * HOUR or i + 1 >= len(bars):
                continue
            b = bars[i]
            side = "sell" if b.h > hi and lo < b.c < hi else "buy" if b.l < lo and lo < b.c < hi else None
            if side:
                nxt = bars[i + 1]
                yield side, nxt.t, nxt.o, b.h if side == "sell" else b.l, lo if side == "sell" else hi, "Varredura da Ásia em Londres"
                break


def ema_pullback(bars: list[Bar], step: int):
    """Trend on the bar timeframe (EMA20 vs EMA50) agreeing with H1 (EMA20 vs EMA50 of hourly closes); in a killzone,
    a bar dips to EMA20 and closes back on the trend side in the trend's colour: enter, stop beyond that bar."""
    closes = [b.c for b in bars]
    e20, e50 = _ema(closes, 20), _ema(closes, 50)
    per_h = HOUR // step
    hourly = [bars[i].c for i in range(per_h - 1, len(bars), per_h)]
    h20, h50 = _ema(hourly, 20), _ema(hourly, 50)
    for i in range(60 * per_h, len(bars) - 1):
        m = _ny_minutes(bars[i].t)
        if not (120 <= m < 300 or 420 <= m < 600):
            continue
        h = i // per_h - 1
        if h < 50:
            continue
        b = bars[i]
        up = e20[i] > e50[i] and h20[h] > h50[h]
        down = e20[i] < e50[i] and h20[h] < h50[h]
        side = "buy" if up and b.l <= e20[i] < b.c and b.c > b.o else "sell" if down and b.h >= e20[i] > b.c and b.c < b.o else None
        if side:
            nxt = bars[i + 1]
            yield side, nxt.t, nxt.o, b.l if side == "buy" else b.h, _far(side, nxt.o), "Pullback na EMA20 a favor de M5 e H1"


def crt_m15_m1(m1: list[Bar], swing: int = 2):
    """CRT on M15 candles in the killzones: candle B sweeps candle A's high or low and closes back inside; during the
    next 15 minutes, the first M1 close beyond the previous `swing` M1 bars enters; target A's other side."""
    groups: dict[int, list[int]] = {}
    for i, b in enumerate(m1):
        groups.setdefault(b.t // (15 * MIN) * (15 * MIN), []).append(i)
    keys = sorted(groups)
    for ka, kb in zip(keys, keys[1:]):
        if kb - ka != 15 * MIN or len(groups[ka]) < 12 or len(groups[kb]) < 12:
            continue
        m = _ny_minutes(kb)
        if not (120 <= m < 300 or 420 <= m < 600):
            continue
        A, B = [m1[i] for i in groups[ka]], [m1[i] for i in groups[kb]]
        ah, al = max(x.h for x in A), min(x.l for x in A)
        bh, bl, bc = max(x.h for x in B), min(x.l for x in B), B[-1].c
        up, dn = bh > ah, bl < al
        if not (al < bc < ah) or up == dn:
            continue
        side = "sell" if up else "buy"
        start = groups[kb][-1] + 1
        for i in range(max(start, swing), min(len(m1) - 1, start + 15)):
            prev = m1[i - swing:i]
            b = m1[i]
            if side == "sell" and b.c < min(p.l for p in prev):
                inval = max(max(p.h for p in prev), b.h)
            elif side == "buy" and b.c > max(p.h for p in prev):
                inval = min(min(p.l for p in prev), b.l)
            else:
                continue
            nxt = m1[i + 1]
            yield side, nxt.t, nxt.o, inval, al if side == "sell" else ah, "CRT de M15 com entrada no M1"
            break
