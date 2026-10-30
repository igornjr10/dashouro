"""Trade simulation with Igor's rules: session-capped stop, 20/50/80 pip ladder, break-even after TP1."""
from dataclasses import dataclass

from . import config
from .data import Bar
from .timeutil import HOUR, session


@dataclass
class Trade:
    setup: str
    side: str            # "buy" | "sell"
    signal_t: int        # close time of the signal bar (ms)
    entry: float
    sl: float
    target: float        # final target price
    reason: str
    session: str
    sl_pips: int
    status: str = "open"        # sl | be | tp1 | tp2 | tp3 | target | timeout
    result_pips: float = 0.0
    exit_t: int | None = None
    max_pips: float = 0.0


def sl_cap(t: int) -> int:
    return config.SL_CAP_NY if session(t) == "ny" else config.SL_CAP_ASIA_LONDON


def plan(setup: str, side: str, t: int, entry: float, invalidation: float, target: float, reason: str) -> Trade | str:
    """Builds a trade or returns why it breaks the rules. The stop sits beyond the invalidation (the swept wick);
    if that is wider than the session cap the trade is skipped, because moving the stop inside the wick would
    put it where the setup has already shown price can reach."""
    d = 1 if side == "buy" else -1
    stop = invalidation - d * config.STOP_BUFFER * config.PIP
    sl_pips = round(abs(entry - stop) / config.PIP)
    cap = sl_cap(t)
    if sl_pips > cap:
        return f"stop estrutural de {sl_pips} pips acima do limite de {cap}"
    if sl_pips < config.SL_MIN:
        sl_pips = config.SL_MIN
        stop = entry - d * sl_pips * config.PIP
    room = (target - entry) * d / config.PIP
    if room < config.TP1:
        return f"só {room:.0f} pips até o alvo (menos que o TP1)"
    return Trade(setup, side, t, entry, stop, target, reason, session(t), sl_pips)


def simulate(tr: Trade, bars: list[Bar]) -> Trade:
    """Replays M5 bars after the signal with the position split in three equal parts that close at TP1, TP2 and the
    final target (TP3 or the setup's target, whichever is nearer). After TP1 the stop of the remaining parts moves
    to the entry. When one bar touches both the stop and a target, the stop is assumed first (conservative).
    status names the furthest rung reached; result_pips is the average of the three parts."""
    d = 1 if tr.side == "buy" else -1
    pips = lambda p: (p - tr.entry) * d / config.PIP
    final = min(config.TP3, pips(tr.target))
    legs = [r for r in (config.TP1, config.TP2) if r < final] + [final]
    while len(legs) < 3:
        legs.insert(0, legs[0])   # short targets: several parts share the nearest rung
    best, tp1 = 0.0, False
    for b in bars:
        if b.t < tr.signal_t:
            continue
        fav, adv = pips(b.h if d > 0 else b.l), pips(b.l if d > 0 else b.h)
        stop = 0.0 if tp1 else pips(tr.sl)
        if adv <= stop:
            return _close(tr, best, stop, legs, b.t)
        best = max(best, fav)
        tp1 = tp1 or best >= legs[0]
        if best >= final:
            return _close(tr, best, stop, legs, b.t)
        if b.t - tr.signal_t > config.MAX_HOLD_HOURS * HOUR:
            return _close(tr, best, pips(b.c), legs, b.t, timeout=True)
    tr.max_pips = round(best, 1)
    return tr


def _close(tr: Trade, best: float, exit_pips: float, legs: list[float], t: int, timeout: bool = False) -> Trade:
    parts = [leg if best >= leg else exit_pips for leg in legs]
    reached = [leg for leg in legs if best >= leg]
    if timeout:
        status = "timeout"
    elif not reached:
        status = "sl"
    elif best >= legs[-1]:
        status = "tp3" if legs[-1] >= config.TP3 else "target"
    else:
        status = "tp2" if max(reached) >= config.TP2 else "tp1"
    tr.status, tr.result_pips, tr.exit_t, tr.max_pips = status, round(sum(parts) / 3, 1), t, round(best, 1)
    return tr
