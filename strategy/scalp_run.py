"""Scalping research: backtests the M1/M5 setups with Igor's rules and the spread, split into two halves.

  python strategy/scalp_run.py            # uses the cached M5 (1 year) and M1 (30 days) data
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aurum_strategy import backtest, config, data, scalp  # noqa: E402
from aurum_strategy.trades import plan, simulate  # noqa: E402


def run(name, signals, bars):
    """One open trade at a time; signals that break the rules are counted, not traded."""
    trades, skipped, busy = [], 0, 0
    for side, t, entry, inval, target, reason in signals:
        if t < busy:
            continue
        tr = plan(name, side, t, entry, inval, target, reason)
        if isinstance(tr, str):
            skipped += 1
            continue
        i = next((k for k, b in enumerate(bars) if b.t >= t), None)
        if i is None:
            continue
        simulate(tr, bars[i:i + 24 * 60 * 60_000 // (bars[1].t - bars[0].t) + 2])
        trades.append(tr)
        busy = tr.exit_t or 10**15
    return trades, skipped


def line(label, trades, skipped=None):
    s0, s3 = backtest.stats(trades, 0), backtest.stats(trades, config.SPREAD_PIPS)
    extra = f" | descartados {skipped}" if skipped is not None else ""
    return (f"  {label:34s} trades {s3['trades']:4d} | TP1+ {s3['taxa_acerto']:4.0%} | sem spread {s0['pips_liquidos']:+8.1f}"
            f" | com spread {s3['pips_liquidos']:+8.1f} | média {s3['pips_medio']:+5.1f} | queda {s3['maior_queda_pips']:5.0f}{extra}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    m5 = data.candles("5min", 365, refresh=False)
    m1 = data.candles("1min", 30, refresh=False)
    tests = [
        ("Rompimento da abertura (M5)", lambda b: scalp.opening_range_breakout(b, 300_000), m5),
        ("Varredura da Ásia (M5)", lambda b: scalp.asia_sweep(b, 300_000), m5),
        ("Pullback EMA20 (M5)", lambda b: scalp.ema_pullback(b, 300_000), m5),
        ("Rompimento da abertura (M1)", lambda b: scalp.opening_range_breakout(b, 60_000), m1),
        ("Pullback EMA20 (M1)", lambda b: scalp.ema_pullback(b, 60_000), m1),
        ("CRT M15 → M1", lambda b: scalp.crt_m15_m1(b), m1),
    ]
    print(f"Spread considerado: {config.SPREAD_PIPS} pips por operação · regras: SL {config.SL_CAP_ASIA_LONDON}/{config.SL_CAP_NY}, TP {config.TP1}/{config.TP2}/{config.TP3}, BE no TP1, saída em 3 partes")
    for name, gen, bars in tests:
        trades, skipped = run(name, gen(bars), bars)
        mid = bars[0].t + (bars[-1].t - bars[0].t) // 2
        print(f"\n{name} · {len(bars)} candles")
        print(line("período completo", trades, skipped))
        print(line("1ª metade", [t for t in trades if t.signal_t < mid]))
        print(line("2ª metade", [t for t in trades if t.signal_t >= mid]))


if __name__ == "__main__":
    main()
