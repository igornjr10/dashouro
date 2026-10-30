"""Runs both setups over history, one open trade per setup at a time, and summarizes the results."""
from dataclasses import dataclass, field

from . import levels as lvmod
from .data import Bar
from .setups import crt_signals, rejection_signal
from .trades import Trade, plan, simulate


@dataclass
class Result:
    trades: list[Trade] = field(default_factory=list)
    skipped: list[tuple[str, int, str]] = field(default_factory=list)   # (setup, time, why)
    day_levels: dict[int, lvmod.DayLevels] = field(default_factory=dict)


def run(m5: list[Bar]) -> Result:
    res = Result()
    days = lvmod.group_by_day(m5)
    for day in sorted(days):
        lv = lvmod.for_day(day, lvmod.previous_trading_day(days, day), days[day])
        if lv:
            res.day_levels[day] = lv

    busy_until = {"CRT": 0, "Rejeição": 0}

    def take(setup: str, side: str, t: int, entry: float, inval: float, target: float, reason: str):
        if t < busy_until[setup]:
            return
        tr = plan(setup, side, t, entry, inval, target, reason)
        if isinstance(tr, str):
            res.skipped.append((setup, t, tr))
            return
        simulate(tr, [b for b in m5 if b.t >= t])
        res.trades.append(tr)
        busy_until[setup] = tr.exit_t or 10**15

    for side, t, entry, inval, target, reason in crt_signals(m5):
        take("CRT", side, t, entry, inval, target, reason)

    for i in range(len(m5) - 1):
        b, nxt = m5[i], m5[i + 1]
        lv = res.day_levels.get(b.t // 86_400_000 * 86_400_000)
        if not lv or nxt.t - b.t != 300_000:
            continue
        sig = rejection_signal(b, nxt, lv)
        if sig:
            side, entry, inval, target, reason = sig
            take("Rejeição", side, nxt.t, entry, inval, target, reason)
    res.trades.sort(key=lambda t: t.signal_t)
    return res


def stats(trades: list[Trade]) -> dict:
    closed = [t for t in trades if t.status != "open"]
    wins = [t for t in closed if t.result_pips > 0]
    losses = [t for t in closed if t.status == "sl"]
    net, peak, dd = 0.0, 0.0, 0.0
    for t in closed:
        net += t.result_pips
        peak = max(peak, net)
        dd = max(dd, peak - net)
    risk = [t.sl_pips for t in closed]
    return {
        "trades": len(closed),
        "abertos": len(trades) - len(closed),
        "ganhos": len(wins),
        "stops": len(losses),
        "empates": len(closed) - len(wins) - len(losses),
        "taxa_acerto": len(wins) / len(closed) if closed else 0.0,
        "pips_liquidos": round(net, 1),
        "pips_medio": round(net / len(closed), 1) if closed else 0.0,
        "maior_queda_pips": round(dd, 1),
        "risco_medio_pips": round(sum(risk) / len(risk), 1) if risk else 0.0,
        "por_resultado": {s: sum(1 for t in closed if t.status == s) for s in ("sl", "be", "tp1", "tp2", "tp3", "target", "timeout")},
    }
