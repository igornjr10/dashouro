"""Self-contained HTML report: candles with the latest day's levels and every backtest trade, the session profile
split into buyers and sellers, and the result tables."""
import html
import json
from pathlib import Path

from . import config
from .backtest import Result, stats
from .data import Bar
from .timeutil import brt

STATUS = {"sl": "SL", "tp1": "TP1", "tp2": "TP2", "tp3": "TP3", "target": "Alvo", "timeout": "Tempo", "open": "Aberto"}


def _profile_svg(lv) -> str:
    """Horizontal bars, price on the y axis: green = buyers' share, red = sellers' share of each node."""
    nodes = lv.prof.nodes
    if not nodes:
        return ""
    top, bottom = nodes[-1].price, nodes[0].price
    h, w, row = 520, 300, 520 / max(1, len(nodes))
    peak = max(n.weight for n in nodes)
    y = lambda p: (top - p) / max(1e-9, top - bottom) * (h - row)
    out = [f'<svg viewBox="0 0 {w + 70} {h}" class="prof" role="img" aria-label="Perfil da sessão anterior">']
    for n in nodes:
        width = n.weight / peak * w
        bw = width * n.buy_pct
        yy = y(n.price)
        out.append(f'<rect x="70" y="{yy:.1f}" width="{bw:.1f}" height="{max(1, row - 1):.1f}" fill="#2fa57e"><title>{n.price:.2f}: {n.buy_pct:.0%} compradores</title></rect>')
        out.append(f'<rect x="{70 + bw:.1f}" y="{yy:.1f}" width="{width - bw:.1f}" height="{max(1, row - 1):.1f}" fill="#d9574a"><title>{n.price:.2f}: {1 - n.buy_pct:.0%} vendedores</title></rect>')
    for name, price, color in (("POC", lv.prof.poc, "#e8edeb"), ("VAH", lv.prof.vah, "#d8b875"), ("VAL", lv.prof.val, "#d8b875")):
        yy = y(price) + row / 2
        out.append(f'<line x1="70" x2="{w + 70}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{color}" stroke-dasharray="4 3"/><text x="0" y="{yy + 4:.1f}" fill="{color}" font-size="11">{name} {price:.2f}</text>')
    out.append("</svg>")
    return "".join(out)


def _rows(trades) -> str:
    rows = []
    for t in reversed(trades[-60:]):
        cls = "win" if t.result_pips > 0 else "loss" if t.status == "sl" else ""
        rows.append(
            f"<tr class='{cls}'><td>{brt(t.signal_t)}</td><td>{t.setup}</td><td>{'Compra' if t.side == 'buy' else 'Venda'}</td>"
            f"<td>{t.entry:.2f}</td><td>{t.sl_pips}</td><td>{t.session}</td><td>{STATUS.get(t.status, t.status)}</td>"
            f"<td>{t.result_pips:+.1f}</td><td>{t.max_pips:.0f}</td><td class='why'>{html.escape(t.reason)}</td></tr>")
    return "".join(rows)


def _cards(title: str, s: dict) -> str:
    return (f"<section class='card'><h3>{title}</h3><div class='kpis'>"
            f"<div><small>Trades</small><b>{s['trades']}</b></div>"
            f"<div><small>Acerto (TP1+)</small><b>{s['taxa_acerto']:.0%}</b></div>"
            f"<div><small>Pips líquidos</small><b class='{'pos' if s['pips_liquidos'] > 0 else 'neg'}'>{s['pips_liquidos']:+.1f}</b></div>"
            f"<div><small>Média por trade</small><b>{s['pips_medio']:+.1f}</b></div>"
            f"<div><small>Maior queda</small><b>{s['maior_queda_pips']:.0f} pips</b></div>"
            f"<div><small>Stop médio</small><b>{s['risco_medio_pips']:.0f} pips</b></div></div>"
            f"<p class='muted'>Por resultado: " + ", ".join(f"{STATUS.get(k, k)} {v}" for k, v in s['por_resultado'].items() if v) + "</p></section>")


def write(path: Path, m5: list[Bar], res: Result, days_shown: int = 5) -> Path:
    last_day = max(res.day_levels) if res.day_levels else None
    lv = res.day_levels.get(last_day) if last_day else None
    since = m5[-1].t - days_shown * 86_400_000
    shown = [b for b in m5 if b.t >= since]
    candles = [{"time": b.t // 1000, "open": b.o, "high": b.h, "low": b.l, "close": b.c} for b in shown]
    marks = []
    for t in res.trades:
        if t.signal_t < since:
            continue
        up = t.side == "buy"
        marks.append({"time": t.signal_t // 1000 // 300 * 300, "position": "belowBar" if up else "aboveBar", "shape": "arrowUp" if up else "arrowDown",
                      "color": "#2fa57e" if up else "#d9574a", "text": f"{t.setup[:3]} {STATUS.get(t.status, '')} {t.result_pips:+.0f}"})
    marks.sort(key=lambda m: m["time"])
    lines = []
    if lv:
        lines = [{"price": p, "title": n} for n, p in lv.named if n in ("máx ontem", "mín ontem", "POC", "VAH", "VAL") or n.startswith("Fib")]
        if lv.asia_high is not None:
            lines += [{"price": lv.asia_high, "title": "máx Ásia"}, {"price": lv.asia_low, "title": "mín Ásia"}]
    all_s, crt_s, rej_s = stats(res.trades), stats([t for t in res.trades if t.setup == "CRT"]), stats([t for t in res.trades if t.setup == "Rejeição"])
    first = brt(m5[0].t) if m5 else "-"
    skipped = len(res.skipped)
    page = TEMPLATE.format(
        period=f"{first} → {brt(m5[-1].t)}" if m5 else "-",
        cards=_cards("Todas as entradas", all_s) + _cards("CRT (H4 01/05/09 NY, entrada no M5)", crt_s) + _cards("Rejeição de nível (killzones) · sem vantagem comprovada", rej_s),
        rows=_rows(res.trades), skipped=skipped,
        profile=_profile_svg(lv) if lv else "<p>Sem perfil.</p>",
        profile_day=brt(last_day)[:5] if last_day else "-",
        data=json.dumps({"candles": candles, "marks": marks, "lines": lines}),
        rules=f"1 pip = {config.PIP} USD · SL máx. {config.SL_CAP_ASIA_LONDON} pips (Ásia/Londres) e {config.SL_CAP_NY} (Nova York) · saídas em 3 partes: TP1 {config.TP1}, TP2 {config.TP2}, TP3 {config.TP3} pips ou o alvo do setup · BE após o TP1",
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page, encoding="utf-8")
    return path


TEMPLATE = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estratégia Aurum · XAU/USD</title>
<style>
:root{{--bg:#0b0f10;--panel:#121718;--line:#252c2b;--muted:#87918e;--text:#e8edeb;--gold:#d8b875;--green:#2fa57e;--red:#d9574a}}
body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,Segoe UI,sans-serif}}
main{{max-width:1200px;margin:0 auto;padding:20px 16px}} h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:15px;margin:24px 0 10px}} h3{{font-size:13px;margin:0 0 10px}}
.muted{{color:var(--muted);font-size:12px}} .grid{{display:grid;grid-template-columns:1fr 380px;gap:16px}} .cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}
.card,.panel{{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}} .kpis{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}}
.kpis small{{display:block;color:var(--muted);font-size:10px}} .kpis b{{font-size:16px}} .pos{{color:var(--green)}} .neg{{color:var(--red)}}
#chart{{height:520px}} .prof{{width:100%}} table{{width:100%;border-collapse:collapse;font-size:12px}} th,td{{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{color:var(--muted);font-weight:500}} tr.win td:nth-child(8){{color:var(--green)}} tr.loss td:nth-child(8){{color:var(--red)}} td.why{{color:var(--muted);max-width:420px}}
.tablewrap{{overflow-x:auto}} @media(max-width:900px){{.grid,.cards{{grid-template-columns:1fr}}}}
</style></head><body><main>
<h1>Estratégia Aurum · XAU/USD</h1>
<p class="muted">Backtest de {period} (horário de Brasília) · {rules}</p>
<div class="cards">{cards}</div>
<h2>Gráfico M5 (últimos dias) com os níveis do dia atual e as entradas</h2>
<div class="grid"><div class="panel"><div id="chart"></div></div>
<div class="panel"><h3>Perfil da sessão anterior ({profile_day})</h3>{profile}
<p class="muted">Perfil por tempo em cada preço (TPO), porque o ouro spot não tem volume central e a Twelve Data não envia volume. Verde/vermelho = parte de compradores/vendedores, pela posição do fechamento de cada candle na sua faixa.</p></div></div>
<h2>Entradas (mais recentes primeiro)</h2>
<div class="panel tablewrap"><table><thead><tr><th>Sinal</th><th>Setup</th><th>Lado</th><th>Entrada</th><th>SL (pips)</th><th>Sessão</th><th>Resultado</th><th>Pips</th><th>Máx. a favor</th><th>Motivo</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="muted">{skipped} sinais foram descartados por quebrar as regras (stop estrutural acima do limite da sessão ou alvo a menos de 20 pips). Resultado de backtest não garante resultado futuro; spread e execução da Exness não estão incluídos.</p>
</main>
<script src="https://unpkg.com/lightweight-charts@5.0.9/dist/lightweight-charts.standalone.production.js"></script>
<script>
const D={data};
const el=document.getElementById('chart');
const chart=LightweightCharts.createChart(el,{{autoSize:true,layout:{{background:{{color:'#121718'}},textColor:'#87918e'}},grid:{{vertLines:{{color:'rgba(255,255,255,.03)'}},horzLines:{{color:'rgba(255,255,255,.03)'}}}},timeScale:{{timeVisible:true,secondsVisible:false}},localization:{{timeFormatter:t=>new Date((t-10800)*1000).toISOString().slice(5,16).replace('T',' ')}}}});
const s=chart.addSeries(LightweightCharts.CandlestickSeries,{{upColor:'#7ac5a7',downColor:'#c8867e',borderVisible:false,wickUpColor:'#7ac5a7',wickDownColor:'#c8867e'}});
s.setData(D.candles);
LightweightCharts.createSeriesMarkers(s,D.marks);
for(const l of D.lines)s.createPriceLine({{price:l.price,title:l.title,color:l.title.startsWith('Fib')?'#6f5a8f':l.title.includes('Ásia')?'#4f9aa8':'#d8b875',lineWidth:1,lineStyle:2,axisLabelVisible:true}});
chart.timeScale().fitContent();
</script></body></html>"""
