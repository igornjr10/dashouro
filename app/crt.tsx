'use client';
import {Crosshair} from 'lucide-react';

export type CrtSetup={
 a:{start:number;high:number;low:number};
 b:{start:number;nyHour:number;high:number;low:number;close:number;complete:boolean};
 sweep:'alta'|'baixa'|null; side:'buy'|'sell'|null;
 status:'b-formando'|'sem-setup'|'aguardando-quebra'|'entrada'|'descartado'|'expirado';
 detail:string;
 entry?:{time:number;price:number;sl:number;slPips:number;tps:{name:string;price:number}[];target:number;layer:{from:number;to:number}|null};
};
const num=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const brt=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const hm=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const STATUS:Record<CrtSetup['status'],{label:string;cls:string}>={
 'b-formando':{label:'Observando',cls:''},'sem-setup':{label:'Sem setup',cls:'muted'},'aguardando-quebra':{label:'Varredura confirmada',cls:'gold-text'},
 'entrada':{label:'Entrada',cls:'green'},'descartado':{label:'Fora das regras',cls:'red'},'expirado':{label:'Expirado',cls:'muted'},
};

// The setup that matters now: an entry or a confirmed sweep wins over the newest reference candle still forming.
export function currentCrt(list:CrtSetup[]|undefined):CrtSetup|null{
 if(!list?.length)return null;
 const live=[...list].reverse().find(s=>s.status==='entrada'||s.status==='aguardando-quebra');
 return live??list.at(-1)!;
}

export function CrtCard({list}:{list:CrtSetup[]|undefined}){
 const s=currentCrt(list);
 if(!s)return null;
 const st=STATUS[s.status], e=s.entry, sell=s.side==='sell';
 return <section className="panel crt-card">
  <div className="panel-heading"><h2><Crosshair size={17}/>CRT · H4 das {String(s.b.nyHour).padStart(2,'0')}h de Nova York ({hm(s.b.start)} Brasília)</h2><span className={'status-pill '+(s.status==='entrada'?'good':'')}>{st.label}</span></div>
  <div className="crt-body">
   <div className="crt-range">
    <div><small>CRT HIGH (H4 anterior)</small><strong>{num(s.a.high)}</strong>{s.sweep==='alta'&&<em className="red">varrida</em>}</div>
    <div><small>CRT LOW (H4 anterior)</small><strong>{num(s.a.low)}</strong>{s.sweep==='baixa'&&<em className="green">varrida</em>}</div>
    <div><small>H4 de referência</small><strong>{num(s.b.low)} – {num(s.b.high)}</strong><em>{s.b.complete?`fechou em ${num(s.b.close)}`:'em formação'}</em></div>
   </div>
   <p className={'crt-detail '+st.cls}>{s.detail}</p>
   {e&&<div className="rule-plan">
    <div className="rule-row"><small>{sell?'Venda':'Compra'} · {brt(e.time)}</small><strong>{num(e.price)}</strong><em>preço de abertura após a quebra no M5 (Twelve Data)</em></div>
    <div className="rule-row rule-sl"><small>SL</small><strong>{num(e.sl)}</strong><em>{e.slPips} pips · {num(e.slPips*10)} USD por lote</em></div>
    {e.tps.map(t=><div key={t.name} className="rule-row rule-tp"><small>{t.name}</small><strong>{num(t.price)}</strong><em>{Math.round(Math.abs(t.price-e.price)/0.1)} pips{t.name==='TP1'?' · depois, SL no BE':''}</em></div>)}
    {e.layer&&<div className="rule-row rule-layer"><small>Camada de proteção</small><strong>{num(e.layer.from)} – {num(e.layer.to)}</strong><em>mesmo lote, mesmo SL</em></div>}
   </div>}
  </div>
  <div className="panel-note">CRT: o H4 que abre às 01h, 05h ou 09h de Nova York varre a máxima ou a mínima do H4 anterior e fecha de volta dentro; a entrada é no M5, na primeira quebra de estrutura a favor, durante o H4 seguinte. Backtest de 90 dias (ago–out/2026): 14 entradas, 71% chegaram ao TP1, +122,6 pips sem spread. Amostra pequena: ainda não é vantagem comprovada. Não é ordem; confira preço e spread na Exness.</div>
 </section>;
}
