'use client';
import {Gauge as GaugeIcon} from 'lucide-react';

type Vote='compra'|'venda'|'neutro';
type Group={buy:number;sell:number;neutral:number;score:number;label:string;items?:{name:string;value:number;vote:Vote}[]};
type G={summary:Group;movingAverages:Group&{items:{name:string;value:number;vote:Vote}[]};oscillators:Group&{items:{name:string;value:number;vote:Vote}[]}};
export type Sentiment={m5:G|null;h1:G|null;pressure:{bars:number;buyPct:number;sellPct:number;bullishCandles:number;bearishCandles:number}};

// Diverging scale: two poles and a neutral gray middle; the label text always carries the reading, never color alone.
const ZONES=[{label:'Venda forte',color:'#d9574a'},{label:'Venda',color:'#8f4a43'},{label:'Neutro',color:'#4a5351'},{label:'Compra',color:'#2f6e58'},{label:'Compra forte',color:'#2fa57e'}];
const voteName={compra:'Compra',venda:'Venda',neutro:'Neutro'};
const R=78, CX=100, CY=92, GAP=0.035;
const pt=(a:number,r=R)=>[CX+r*Math.cos(a),CY-r*Math.sin(a)];
function arc(a0:number,a1:number){const [x0,y0]=pt(a0),[x1,y1]=pt(a1);return `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}`}

function Meter({title,g}:{title:string;g:G|null}){
 if(!g)return <div className="meter"><small>{title}</small><p className="muted">Sem dados suficientes.</p></div>;
 const s=g.summary, angle=Math.PI/2-s.score*Math.PI/2, [nx,ny]=pt(angle,R-16);
 return <div className="meter">
  <small>{title}</small>
  <svg viewBox="0 0 200 104" role="img" aria-label={`${title}: ${s.label}. ${s.buy} compra, ${s.sell} venda, ${s.neutral} neutro.`}>
   {ZONES.map((z,i)=>{const a0=Math.PI-i*Math.PI/5-GAP/2*(i>0?1:0), a1=Math.PI-(i+1)*Math.PI/5+GAP/2*(i<4?1:0);
    return <path key={z.label} d={arc(a0,a1)} stroke={z.color} strokeWidth={14} fill="none" opacity={z.label===s.label?1:0.45}><title>{z.label}</title></path>})}
   <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round"/>
   <circle cx={CX} cy={CY} r={5} fill="var(--text)" stroke="var(--panel)" strokeWidth={2}/>
   <text x={14} y={102} className="meter-end">VENDA</text><text x={186} y={102} textAnchor="end" className="meter-end">COMPRA</text>
  </svg>
  <strong>{s.label}</strong>
  <em>{s.buy} compra · {s.sell} venda · {s.neutral} neutro</em>
  <div className="meter-split"><span>Médias móveis: <b>{g.movingAverages.label}</b> ({g.movingAverages.buy}/{g.movingAverages.sell}/{g.movingAverages.neutral})</span><span>Osciladores: <b>{g.oscillators.label}</b> ({g.oscillators.buy}/{g.oscillators.sell}/{g.oscillators.neutral})</span></div>
 </div>;
}

function Table({title,g}:{title:string;g:G}){
 return <table className="sent-table"><caption>{title}</caption><thead><tr><th>Indicador</th><th>Valor</th><th>Sinal</th></tr></thead>
  <tbody>{[...g.oscillators.items,...g.movingAverages.items].map(i=><tr key={i.name}><td>{i.name}</td><td>{i.value.toLocaleString('pt-BR')}</td><td className={i.vote==='compra'?'green':i.vote==='venda'?'red':'muted'}>{voteName[i.vote]}</td></tr>)}</tbody></table>;
}

export function SentimentCard({s}:{s:Sentiment|null}){
 if(!s)return null;
 const p=s.pressure;
 return <section className="panel sentiment-card">
  <div className="panel-heading"><h2><GaugeIcon size={17}/>Força compradora × vendedora</h2><span className="micro">RESUMO TÉCNICO · CANDLES FECHADOS</span></div>
  <div className="meters"><Meter title="M5 · CURTO PRAZO" g={s.m5}/><Meter title="H1 · TENDÊNCIA DO DIA" g={s.h1}/></div>
  <div className="pressure">
   <div className="pressure-head"><span>Pressão nos últimos {p.bars} candles M5 (~{Math.round(p.bars*5/60)}h)</span><span>{p.bullishCandles} de alta · {p.bearishCandles} de baixa</span></div>
   <div className="pressure-bar" role="img" aria-label={`Compradores ${p.buyPct}%, vendedores ${p.sellPct}%`}>
    <div className="pressure-buy" style={{flexBasis:p.buyPct+'%'}} title={`Compradores ${p.buyPct}%`}/><div className="pressure-sell" style={{flexBasis:p.sellPct+'%'}} title={`Vendedores ${p.sellPct}%`}/>
   </div>
   <div className="pressure-legend"><span>Compradores <b>{p.buyPct}%</b></span><span>Vendedores <b>{p.sellPct}%</b></span></div>
  </div>
  <details className="sent-details"><summary>Ver todos os indicadores</summary><div className="sent-tables">{s.m5&&<Table title="M5" g={s.m5}/>}{s.h1&&<Table title="H1" g={s.h1}/>}</div></details>
  <div className="panel-note">Cada média móvel e oscilador vota compra, venda ou neutro; o saldo dá o rótulo. A pressão mede onde cada candle fechou dentro da própria faixa (perto da máxima = compradores). É leitura técnica dos candles da Twelve Data, não votos de pessoas nem fluxo de ordens: o ouro spot não tem volume centralizado.</div>
 </section>;
}
