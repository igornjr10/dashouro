"""Session profile from candles.

Spot gold has no centralized volume and Twelve Data sends none, so this is a time-at-price (TPO) profile:
each bar spreads one unit of weight evenly across the price buckets it traded through. Each bar's weight is
split between buyers and sellers by where it closed inside its own range (close at the high = all buyers).
"""
from dataclasses import dataclass, field
from statistics import median

from . import config
from .data import Bar


@dataclass
class Node:
    price: float      # bucket midpoint
    weight: float
    buy: float
    sell: float

    @property
    def buy_pct(self) -> float:
        total = self.buy + self.sell
        return self.buy / total if total else 0.5


@dataclass
class Profile:
    nodes: list[Node]
    poc: float
    vah: float
    val: float
    hvn: list[float] = field(default_factory=list)
    lvn: list[float] = field(default_factory=list)

    def node_at(self, price: float) -> Node | None:
        if not self.nodes:
            return None
        return min(self.nodes, key=lambda n: abs(n.price - price))


def build(bars: list[Bar], bin_size: float = config.PROFILE_BIN) -> Profile | None:
    if not bars:
        return None
    buckets: dict[int, list[float]] = {}
    for b in bars:
        lo, hi = int(b.l // bin_size), int(b.h // bin_size)
        n = hi - lo + 1
        rng = b.h - b.l
        buy_share = (b.c - b.l) / rng if rng > 0 else 0.5
        for k in range(lo, hi + 1):
            w = buckets.setdefault(k, [0.0, 0.0, 0.0])
            w[0] += 1 / n
            w[1] += buy_share / n
            w[2] += (1 - buy_share) / n
    keys = sorted(buckets)
    nodes = [Node((k + 0.5) * bin_size, *buckets[k]) for k in keys]
    poc_i = max(range(len(nodes)), key=lambda i: nodes[i].weight)

    # Value area: grow from the POC towards the heavier neighbour until it holds 70% of all weight.
    total = sum(n.weight for n in nodes)
    lo_i = hi_i = poc_i
    acc = nodes[poc_i].weight
    while acc < total * config.VALUE_AREA and (lo_i > 0 or hi_i < len(nodes) - 1):
        up = nodes[hi_i + 1].weight if hi_i < len(nodes) - 1 else -1
        down = nodes[lo_i - 1].weight if lo_i > 0 else -1
        if up >= down:
            hi_i += 1
            acc += up
        else:
            lo_i -= 1
            acc += down

    # HVN/LVN: local peaks and troughs of a 3-bucket smoothed profile, compared with the median bucket.
    w = [n.weight for n in nodes]
    sm = [sum(w[max(0, i - 1):i + 2]) / len(w[max(0, i - 1):i + 2]) for i in range(len(w))]
    med = median(sm)
    hvn, lvn = [], []
    for i in range(1, len(sm) - 1):
        if sm[i] >= sm[i - 1] and sm[i] >= sm[i + 1] and sm[i] >= med * 1.3:
            hvn.append(nodes[i].price)
        if sm[i] <= sm[i - 1] and sm[i] <= sm[i + 1] and sm[i] <= med * 0.6 and lo_i <= i <= hi_i:
            lvn.append(nodes[i].price)
    return Profile(nodes, nodes[poc_i].price, nodes[hi_i].price + bin_size / 2, nodes[lo_i].price - bin_size / 2, hvn, lvn)
