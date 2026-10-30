"""The two entry models.

CRT (Candle Range Theory): H4 candles on the New York clock (opening 01, 05, 09, 13, 17, 21). When candle B,
opening at 01, 05 or 09 NY, sweeps the high or low of the previous candle A and closes back inside A's range,
price is expected to run to A's opposite side. Entry at the open after B closes; invalidation is B's sweep wick.

Rejection: inside the London (02-05 NY) or New York AM (07-10 NY) killzone, an M5 bar pierces a key level and
closes back on the other side. It must sell in premium / buy in discount of the previous day's range and gather
at least MIN_SCORE points of confluence (nearby levels, OTE zone, node dominated by the opposite side).
"""
from . import config
from .data import Bar
from .levels import DayLevels, levels_at
from .timeutil import HOUR, killzone, ny_time


def h4_candles(m5: list[Bar]) -> list[tuple[int, Bar]]:
    """Aggregates M5 into H4 candles aligned to 01:00 NY. Returns (NY opening hour, candle)."""
    groups: dict[int, list[Bar]] = {}
    for b in m5:
        t = ny_time(b.t)
        key = b.t - ((t.hour - 1) % 4) * HOUR - t.minute * 60_000 - t.second * 1000
        groups.setdefault(key, []).append(b)
    out = []
    for key in sorted(groups):
        g = groups[key]
        # Skip partial candles (weekend edges, gaps): a full H4 has 48 M5 bars; allow a few missing.
        if len(g) < 40:
            continue
        out.append((ny_time(key).hour, Bar(key, g[0].o, max(b.h for b in g), min(b.l for b in g), g[-1].c)))
    return out


# M5 bars that define the short-term swing for the entry. 2 was the only length that kept the stop inside the
# session cap often enough and stayed positive on both the 60-day choice window and the 30-day validation window
# (Aug-Oct 2026); 3 and 6 left almost every stop beyond the cap.
SWING_BARS = 2


def crt_signals(m5: list[Bar]):
    """Yields (side, entry_time, entry_price, invalidation, target, reason).

    The H4 sweep only sets the bias; the entry comes on M5 during the next H4 candle, at the first break of
    short-term structure in the trade's direction (an M5 close beyond the extreme of the previous SWING_BARS bars).
    The invalidation is the opposite extreme of those bars, which keeps the stop inside the session cap far more
    often than the H4 wick would (that wick was a median 133 pips away on gold)."""
    h4 = h4_candles(m5)
    index = {b.t: i for i, b in enumerate(m5)}
    for (_, a), (hb, b) in zip(h4, h4[1:]):
        if hb not in (1, 5, 9) or b.t - a.t != 4 * HOUR:
            continue
        swept_high, swept_low = b.h > a.h, b.l < a.l
        if not (a.l < b.c < a.h) or swept_high == swept_low:   # needs exactly one side purged, close back inside
            continue
        side = "sell" if swept_high else "buy"
        start = index.get(b.t + 4 * HOUR)
        if start is None or start < SWING_BARS:
            continue
        for i in range(start, len(m5) - 1):
            bar = m5[i]
            if bar.t >= b.t + 8 * HOUR:
                break
            prev = m5[i - SWING_BARS:i]
            if side == "sell" and bar.c < min(p.l for p in prev):
                inval = max(p.h for p in prev + [bar])
            elif side == "buy" and bar.c > max(p.h for p in prev):
                inval = min(p.l for p in prev + [bar])
            else:
                continue
            target = a.l if side == "sell" else a.h
            word = "venda" if side == "sell" else "compra"
            yield side, m5[i + 1].t, m5[i + 1].o, inval, target, f"CRT de {word}: H4 das {hb:02d}h NY varreu a {'máxima' if swept_high else 'mínima'} do anterior; quebra de estrutura no M5"
            break


def rejection_signal(bar: Bar, nxt: Bar, lv: DayLevels):
    """Returns (side, entry, invalidation, target, reason) or None for one M5 bar."""
    kz = killzone(bar.t)
    if kz is None:
        return None
    levels = levels_at(lv, bar.t)
    best = None
    for name, price in levels:
        sell = bar.h >= price + config.PIERCE and bar.c < price and bar.c > lv.mid
        buy = bar.l <= price - config.PIERCE and bar.c > price and bar.c < lv.mid
        if not (sell or buy):
            continue
        side = "sell" if sell else "buy"
        score, why = 1, [name]
        near = [n for n, p in levels if n != name and abs(p - price) <= config.CONFLUENCE_RADIUS]
        if near:
            score += 1
            why.append("+ " + ", ".join(sorted(set(near))[:3]))
        lo_ote, hi_ote = (lv.fib[config.OTE_ZONE[0]], lv.fib[config.OTE_ZONE[1]])
        if min(lo_ote, hi_ote) <= price <= max(lo_ote, hi_ote):
            score += 1
            why.append("zona OTE")
        node = lv.prof.node_at(price)
        if node and (node.buy_pct <= 1 - config.STRONG_SIDE if side == "sell" else node.buy_pct >= config.STRONG_SIDE):
            score += 1
            why.append(f"nó {('vendedor' if side == 'sell' else 'comprador')} {max(node.buy_pct, 1 - node.buy_pct):.0%}")
        if score < config.MIN_SCORE or (best and best[0] >= score):
            continue
        # Target: the previous day's opposite extreme of the range, the external liquidity on that side.
        target = lv.pdl if side == "sell" else lv.pdh
        inval = bar.h if side == "sell" else bar.l
        best = (score, side, nxt.o, inval, target, f"Rejeição ({kz}): " + " ".join(why))
    return best[1:] if best else None
