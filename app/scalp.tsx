'use client';
import {Zap} from 'lucide-react';
import type {CrtSetup} from './crt';

export type ScalpSetup={
 day:number; asia:{high:number;low:number;bars:number}|null; window:{from:number;to:number};
 status:'asia-formando'|'aguardando'|'entrada'|'descartado'|'encerrado'|'sem-dados';
 side:'buy'|'sell'|null; sweep:{time:number;wick:number}|null; detail:string; entry?:CrtSetup['entry'];
};
const num=(v:number,d=2)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const hm=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const STATUS:Record<ScalpSetup['status'],{label:string;cls:string}>={
 'asia-formando':{label:'Ásia em formação',cls:''},'aguardando':{label:'Observando',cls:'gold-text'},'entrada':{label:'Entrada',cls:'green'},
 'descartado':{label:'Fora das regras',cls:'red'},'encerrado':{label:'Sem setup hoje',cls:'muted'},'sem-dados':{label:'Sem dados',cls:'muted'},
};

// Gold only: the Asian sweep was backtested on XAU/USD with Igor's pip rules.
export function ScalpCard({s}:{s:ScalpSetup|null|undefined}){
 if(!s)return null;
 const st=STATUS[s.status], e=s.entry, sell=s.side==='sell';
 return <section className="panel crt-card scalp-card">
  <div className="panel-heading"><h2><Zap size={17}/>Scalping M5 · varredura da Ásia em Londres</h2><span className={'status-pill '+(s.status==='entrada'?'good':'')}>{st.label}</span></div>
  <div className="crt-body">
   <div className="crt-range">
    <div><small>MÁXIMA DA ÁSIA</small><strong>{s.asia?num(s.asia.high):'—'}</strong>{s.sweep&&sell&&<em className="red">varrida às {hm(s.sweep.time)}</em>}</div>
    <div><small>MÍNIMA DA ÁSIA</small><strong>{s.asia?num(s.asia.low):'—'}</strong>{s.sweep&&!sell&&<em className="green">varrida às {hm(s.sweep.time)}</em>}</div>
    <div><small>JANELA (BRASÍLIA)</small><strong>{hm(s.window.from)} – {hm(s.window.to)}</strong><em>Ásia: {hm(s.day)} – {hm(s.day+7*3_600_000)}</em></div>
   </div>
   <p className={'crt-detail '+st.cls}>{s.detail}</p>
   {e&&<div className="rule-plan">
    <div className="rule-row"><small>{sell?'Venda':'Compra'} · {hm(e.time)}</small><strong>{num(e.price)}</strong><em>abertura do M5 após a varredura (Twelve Data)</em></div>
    <div className="rule-row rule-sl"><small>SL</small><strong>{num(e.sl)}</strong><em>{e.slPips} pips · {num(e.slPips*10)} USD por lote · além do pavio da varredura</em></div>
    {e.tps.map(t=><div key={t.name} className="rule-row rule-tp"><small>{t.name}</small><strong>{num(t.price)}</strong><em>{Math.round(Math.abs(t.price-e.price)/0.1)} pips{t.name==='TP1'?' · depois, SL no BE':''}</em></div>)}
    {e.layer&&<div className="rule-row rule-layer"><small>Camada de proteção</small><strong>{num(e.layer.from)} – {num(e.layer.to)}</strong><em>mesmo lote, mesmo SL</em></div>}
   </div>}
  </div>
  <div className="panel-note">Faixa da Ásia (00–07 UTC). Na janela de Londres (02–05h de Nova York), o primeiro M5 que fura a máxima ou a mínima e fecha de volta dentro dá a entrada contra a varredura no candle seguinte; alvo no outro lado da faixa, um setup por dia. Backtest de 1 ano: 54 operações, 52% chegaram ao TP1, +148,6 pips com 3 pips de spread, positivo nas duas metades do ano. A margem é pequena: zera com spread perto de 6 pips, e as vendas ganharam (+182) enquanto as compras perderam (−34). Observe em conta demo antes de usar dinheiro. Não é ordem; confira preço e spread na Exness.</div>
 </section>;
}
