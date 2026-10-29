'use client';
import {useState} from 'react';
import {AlertTriangle,Check,Loader2,TrendingDown,TrendingUp,X} from 'lucide-react';

type Side='buy'|'sell';
type Ref={name:string;price:number};
type Result={
 side:Side; verdict:'favoravel'|'ressalvas'|'desfavoravel'|'nao-operar'; block:string|null; passed:number; total:number;
 checks:{key:string;label:string;ok:boolean;detail:string}[]; price:number; atr:number; at:string; candlesAt:string;
 references:{stop:Ref;target:Ref|null;risk:number;reward:number|null;rr:number|null};
 eventWarning:{title:string;minutes:number}|null; note:string;
 explanation:{summary:string;pros:string[];cons:string[];context:string}|null; explanationError?:string; model?:string;
};
const verdicts={favoravel:'Favorável',ressalvas:'Com ressalvas',desfavoravel:'Desfavorável','nao-operar':'Não operar agora'};
const sideName={buy:'compra',sell:'venda'};
const num=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const time=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'}).format(new Date(v));

export function TradeButtons({busy,onCheck}:{busy:Side|null;onCheck:(s:Side)=>void}){
 return <div className="trade-buttons">
  <button className="button trade-buy" disabled={!!busy} onClick={()=>onCheck('buy')}>{busy==='buy'?<Loader2 size={16} className="spin"/>:<TrendingUp size={16}/>}Avaliar compra</button>
  <button className="button trade-sell" disabled={!!busy} onClick={()=>onCheck('sell')}>{busy==='sell'?<Loader2 size={16} className="spin"/>:<TrendingDown size={16}/>}Avaliar venda</button>
 </div>;
}

export function useTradeCheck(getKey:()=>string){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState<Side|null>(null),[error,setError]=useState('');
 const run=async(side:Side)=>{
  setBusy(side);setError('');setResult(null);
  try{const key=getKey();const r=await fetch('/api/check?side='+side,{method:'POST',headers:key?{'X-Aurum-OpenRouter-Key':key}:{}});const j=await r.json() as Result&{error?:string};if(!r.ok)throw new Error(j.error);setResult(j)}
  catch(e){setError(e instanceof Error?e.message:'Falha ao avaliar a operação.')}
  finally{setBusy(null)}
 };
 return {result,busy,error,run,clear:()=>{setResult(null);setError('')}};
}

export function TradeResult({result,error,onClose,onPlan}:{result:Result|null;error:string;onClose:()=>void;onPlan:(r:Result)=>void}){
 if(!result&&!error)return null;
 if(!result)return <section className="panel trade-result"><div className="panel-heading"><h2>Avaliação da operação</h2><button className="icon-button" aria-label="Fechar avaliação" onClick={onClose}><X size={16}/></button></div><p className="analysis-text">{error}</p></section>;
 const {references:ref}=result, ex=result.explanation;
 return <section className="panel trade-result">
  <div className="panel-heading"><h2>{result.side==='buy'?<TrendingUp size={17}/>:<TrendingDown size={17}/>}Avaliação de {sideName[result.side]} · XAU/USD</h2><button className="icon-button" aria-label="Fechar avaliação" onClick={onClose}><X size={16}/></button></div>
  <div className={'verdict verdict-'+result.verdict}>
   <div><small>VEREDITO DAS REGRAS</small><strong>{verdicts[result.verdict]}</strong><em>{result.block?`Bloqueado: ${result.block}`:`${result.passed} de ${result.total} critérios a favor`}</em></div>
   <div className="verdict-refs">
    <div><small>Preço (fech. M5)</small><strong>{num(result.price)}</strong></div>
    <div><small>Stop técnico</small><strong>{num(ref.stop.price)}</strong><em>{ref.stop.name} · risco {num(ref.risk)}</em></div>
    <div><small>Alvo técnico</small><strong>{ref.target?num(ref.target.price):'—'}</strong><em>{ref.target?`${ref.target.name} · ${num(ref.reward!)}`:'sem nível na janela'}</em></div>
    <div><small>Risco/retorno</small><strong>{ref.rr===null?'—':num(ref.rr)}</strong></div>
   </div>
  </div>
  {result.eventWarning&&<div className="bias-warning"><AlertTriangle size={14}/>{result.eventWarning.title} em {result.eventWarning.minutes} min (agenda de agregador).</div>}
  <div className="check-list">{result.checks.map(c=><div key={c.key} className="check-row">{c.ok?<Check size={15} className="green"/>:<X size={15} className="red"/>}<div><strong>{c.label}</strong><small>{c.detail}</small></div></div>)}</div>
  {ex?<div className="trade-explain"><p>{ex.summary}</p>
   <div className="pros-cons">{ex.pros.length>0&&<div><small>A favor</small><ul>{ex.pros.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}{ex.cons.length>0&&<div><small>Contra / riscos</small><ul>{ex.cons.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}</div>
   {ex.context&&<p className="trade-context">{ex.context}</p>}</div>
   :<div className="panel-note">{result.explanationError||'A IA não devolveu uma explicação no formato esperado; o checklist acima continua válido.'}</div>}
  <div className="trade-actions"><button className="button" onClick={()=>onPlan(result)}>Levar para o cálculo de risco</button></div>
  <div className="panel-note">{result.note} Candles de {time(result.candlesAt)}.{result.model?` Explicação: ${result.model}.`:''} A decisão e a execução são suas.</div>
 </section>;
}
