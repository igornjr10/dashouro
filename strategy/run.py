"""Aurum strategy: backtest and today's levels.

  python strategy/run.py                # 90 days of M5, backtest, report at strategy/output/relatorio.html
  python strategy/run.py --dias 60      # longer history (pages back on Twelve Data; ~1 request per 17 days)
  python strategy/run.py --offline      # reuse the local cache, no API request
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aurum_strategy import backtest, data, report  # noqa: E402
from aurum_strategy.timeutil import brt, utc_day  # noqa: E402


def main() -> None:
    # The Windows console defaults to cp1252, which cannot print accents and arrows reliably.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Estratégia Aurum para XAU/USD")
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--offline", action="store_true", help="usa só o cache local")
    args = ap.parse_args()

    m5 = data.candles("5min", args.dias, refresh=not args.offline)
    if len(m5) < 500:
        raise SystemExit(f"Poucos candles ({len(m5)}). Rode sem --offline para baixar o histórico.")
    res = backtest.run(m5)
    out = report.write(Path(__file__).resolve().parent / "output" / "relatorio.html", m5, res)

    print(f"Candles M5: {len(m5)} ({brt(m5[0].t)} → {brt(m5[-1].t)}, horário de Brasília)")
    for name, trades in (("Todas", res.trades), ("CRT", [t for t in res.trades if t.setup == "CRT"]), ("Rejeição", [t for t in res.trades if t.setup == "Rejeição"])):
        s = backtest.stats(trades)
        print(f"  {name:9s} trades {s['trades']:3d} | acerto {s['taxa_acerto']:.0%} | pips {s['pips_liquidos']:+.1f} | média {s['pips_medio']:+.1f} | maior queda {s['maior_queda_pips']:.0f} | stop médio {s['risco_medio_pips']:.0f}")
    print(f"  Descartados pelas regras: {len(res.skipped)}")

    lv = res.day_levels.get(utc_day(m5[-1].t))
    if lv:
        print("\nNíveis de hoje:")
        for n, p in sorted(lv.named + ([("máx Ásia", lv.asia_high), ("mín Ásia", lv.asia_low)] if lv.asia_high else []), key=lambda x: -x[1]):
            print(f"  {p:9.2f}  {n}")
        print(f"  Premium acima de {lv.mid:.2f} (vender) · discount abaixo (comprar)")
    open_ = [t for t in res.trades if t.status == "open"]
    for t in open_:
        print(f"\nEm aberto: {t.setup} {'compra' if t.side == 'buy' else 'venda'} em {t.entry:.2f}, SL {t.sl:.2f} ({t.sl_pips} pips) · {t.reason}")
    print(f"\nRelatório: {out}")


if __name__ == "__main__":
    main()
