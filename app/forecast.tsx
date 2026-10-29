'use client';
import {useState,useEffect,useMemo,useCallback} from 'react';
import {AlertTriangle,ArrowDownRight,ArrowUpRight,Minus,Target,Trash2} from 'lucide-react';

export type Level='high2h'|'low2h'|'highWindow'|'lowWindow'|'ema20'|'ema50'|'pdh'|'pdl'|'pdc'|'asiaHigh'|'asiaLow'|'londonHigh'|'londonLow';
export type Insight={
 bias:'alta'|'baixa'|'neutro'; confidence:'baixa'|'media'|'alta'; horizonHours:number;
 drivers:{text:string;source:string}[];
 invalidation:{level:Level;condition:'acima'|'abaixo';price:number}|null;
 analysis:string; model:string; at:string; eventSoon:boolean;
 reference:{price:number;time:string;source:string}|null;
};
type Candle={time:number;close:number};
type Result={price:number;move:number;hit:boolean}|'unchecked';
export type Prediction={at:string;bias:Insight['bias'];confidence:Insight['confidence'];horizonHours:number;refPrice:number;refTime:string;model:string;result?:Result};

const KEY='aurum-predictions';
// A move under 0.15% counts as flat: neutral calls hit inside that band, directional calls only need the right sign.
const FLAT=0.0015;
export const levelNames:Record<Level,string>={high2h:'máxima das últimas 2h',low2h:'mínima das últimas 2h',highWindow:'máxima da janela M5',lowWindow:'mínima da janela M5',ema20:'EMA 20',ema50:'EMA 50',pdh:'máxima de ontem',pdl:'mínima de ontem',pdc:'fechamento de ontem',asiaHigh:'máxima da Ásia',asiaLow:'mínima da Ásia',londonHigh:'máxima de Londres',londonLow:'mínima de Londres'};
const biasNames={alta:'Alta',baixa:'Baixa',neutro:'Neutro'};
const confNames={baixa:'baixa',media:'média',alta:'alta'};
const num=(v:number,d=2)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const time=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v));

function score(p:Prediction,candles:Candle[]|null):Result|undefined{
 if(!candles?.length)return undefined;
 const expiry=Date.parse(p.refTime)+p.horizonHours*3600000, closeOf=(c:Candle)=>c.time+300000;
 if(closeOf(candles.at(-1)!)<expiry)return undefined;
 if(closeOf(candles[0])>expiry)return 'unchecked';
 const exit=candles.find(c=>closeOf(c)>=expiry)!.close, move=exit-p.refPrice;
 const hit=p.bias==='alta'?move>0:p.bias==='baixa'?move<0:Math.abs(move)<p.refPrice*FLAT;
 return {price:exit,move,hit};
}
const load=():Prediction[]|null=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(s)?s:[]}catch{return null}};
const store=(list:Prediction[])=>{try{localStorage.setItem(KEY,JSON.stringify(list))}catch{}};

export function usePredictions(candles:Candle[]|null){
 const [saved,setSaved]=useState<Prediction[]>([]);
 // Mount-time read of this browser's prediction log.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setSaved(load()||[])},[]);
 const list=useMemo(()=>saved.map(p=>p.result?p:{...p,result:score(p,candles)}),[saved,candles]);
 // Persist results as soon as they are scored, because the M5 window only covers the last ~8h.
 useEffect(()=>{if(list.some((p,i)=>p.result&&!saved[i].result))store(list)},[list,saved]);
 const add=useCallback((i:Insight)=>{if(!i.reference)return;const p:Prediction={at:i.at,bias:i.bias,confidence:i.confidence,horizonHours:i.horizonHours,refPrice:i.reference.price,refTime:i.reference.time,model:i.model};setSaved(s=>{const n=[p,...(load()??s)].slice(0,50);store(n);return n})},[]);
 const clear=useCallback(()=>{store([]);setSaved([])},[]);
 return {list,add,clear};
}

const BiasIcon=({bias,size=22}:{bias:Insight['bias'];size?:number})=>bias==='alta'?<ArrowUpRight size={size}/>:bias==='baixa'?<ArrowDownRight size={size}/>:<Minus size={size}/>;

export function Forecast({insight}:{insight:Insight}){
 const inv=insight.invalidation;
 return <div className="forecast">
  <div className={'bias-card bias-'+insight.bias}>
   <div className="bias-main"><BiasIcon bias={insight.bias} size={30}/><div><small>VIÉS DE DIREÇÃO · PRÓXIMAS {insight.horizonHours}H</small><strong>{biasNames[insight.bias]}</strong></div></div>
   <div className="bias-facts">
    <div><small>Confiança</small><strong>{confNames[insight.confidence]}</strong></div>
    <div><small>Preço de referência</small><strong>{insight.reference?num(insight.reference.price):'—'}</strong></div>
    <div><small>Invalida se</small><strong>{inv?`fechar ${inv.condition} de ${num(inv.price)}`:'—'}</strong>{inv&&<em>{levelNames[inv.level]}</em>}</div>
   </div>
  </div>
  {insight.eventSoon&&<div className="bias-warning"><AlertTriangle size={14}/>Evento USD de alto impacto nas próximas 4h. Confiança limitada a média.</div>}
  {insight.drivers.length>0&&<ol className="bias-drivers">{insight.drivers.map((d,i)=><li key={i}>{d.text}<small>{d.source}</small></li>)}</ol>}
  <p className="analysis-text" aria-live="polite">{insight.analysis}</p>
  <div className="panel-note">Viés probabilístico, não sinal de entrada. Indicadores calculados no servidor; níveis vêm dos candles da Twelve Data, não do modelo. {insight.reference?`Referência: ${insight.reference.source}, ${time(insight.reference.time)}.`:'Sem candles M5 atuais: viés forçado a neutro.'}</div>
 </div>;
}

export function Scoreboard({list,clear}:{list:Prediction[];clear:()=>void}){
 const done=list.filter(p=>p.result&&p.result!=='unchecked') as (Prediction&{result:{price:number;move:number;hit:boolean}})[];
 const hits=done.filter(p=>p.result.hit).length, pending=list.filter(p=>!p.result).length;
 return <section className="panel scoreboard">
  <div className="panel-heading"><h2><Target size={17}/>Placar das previsões</h2>{list.length>0&&<button className="icon-button" aria-label="Apagar histórico de previsões" onClick={clear}><Trash2 size={15}/></button>}</div>
  {list.length===0?<div className="panel-note">Nenhuma previsão registrada neste navegador. Cada análise gerada entra aqui e é conferida quando o horizonte vence.</div>:<>
   <div className="score-summary">
    <div><small>Acertos</small><strong>{done.length?`${hits} de ${done.length}`:'—'}</strong></div>
    <div><small>Taxa</small><strong>{done.length?`${Math.round(hits/done.length*100)}%`:'—'}</strong></div>
    <div><small>Aguardando</small><strong>{pending}</strong></div>
   </div>
   <div className="score-list">{list.slice(0,8).map((p,i)=><div key={i} className="score-row">
    <span className={'bias-chip bias-'+p.bias}><BiasIcon bias={p.bias} size={13}/>{biasNames[p.bias]}</span>
    <span className="score-when">{time(p.at)} · {p.horizonHours}h · conf. {confNames[p.confidence]}</span>
    <span className="score-result">{!p.result?'aguardando':p.result==='unchecked'?'não conferida':<>{num(p.refPrice)} → {num(p.result.price)} <b className={p.result.hit?'green':'red'}>{p.result.hit?'acertou':'errou'}</b></>}</span>
   </div>)}</div>
   <div className="panel-note">Conferido com o fechamento M5 da Twelve Data no fim do horizonte. Alta/baixa acertam com o sinal certo; neutro acerta se o preço variar menos de 0,15%. Previsões com mais de ~8h sem conferência ficam como “não conferida”. {done.length<20&&'Com menos de 20 previsões conferidas, a taxa ainda não diz muito.'}</div>
  </>}
 </section>;
}
