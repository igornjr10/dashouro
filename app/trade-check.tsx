'use client';
import {useState} from 'react';
import {AlertTriangle,Check,Loader2,TrendingDown,TrendingUp,X} from 'lucide-react';

type Side='buy'|'sell';
type Ref={name:string;price:number};
type Result={
 side:Side; verdict:'favoravel'|'ressalvas'|'desfavoravel'|'nao-operar'; block:string|null; passed:number; total:number;
 checks:{key:string;label:string;ok:boolean;detail:string}[]; price:number; atr:number; at:string; candlesAt:string;
 references:{stop:Ref&{pips?:number};target:Ref|null;risk:number;reward:number|null;rr:number|null};
 plan?:{session:string;capPips:number;slPips:number;usdPerPipPerLot:number;management:string[];
  tps:{name:string;pips:number;price:number;range?:number[]}[];
  layer:{from:number;to:number;avg:number;lossAtSlPips:number}|null};
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

export function useTradeCheck(getHeaders:()=>Record<string,string>,onSaved:()=>void){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState<Side|null>(null),[error,setError]=useState('');
 const run=async(side:Side)=>{
  setBusy(side);setError('');setResult(null);
  try{const r=await fetch('/api/check?side='+side,{method:'POST',headers:getHeaders()});const j=await r.json() as Result&{error?:string;saved?:boolean};if(!r.ok)throw new Error(j.error);setResult(j);if(j.saved)onSaved()}
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
    <div><small>Risco/retorno até o TP2</small><strong>{ref.rr===null?'—':num(ref.rr)}</strong></div>
   </div>
  </div>
  {result.plan&&<div className="rule-plan">
   <div className="rule-row rule-sl"><small>SL · sessão {result.plan.session} (máx. {result.plan.capPips} pips)</small><strong>{num(ref.stop.price)}</strong><em>{result.plan.slPips} pips · {ref.stop.name} · {num(result.plan.slPips*result.plan.usdPerPipPerLot)} USD por lote</em></div>
   {result.plan.tps.map(t=><div key={t.name} className="rule-row rule-tp"><small>{t.name} · {t.range?'40–50':t.name==='TP3'?'80+':t.pips} pips</small><strong>{t.range?`${num(t.range[0])} – ${num(t.range[1])}`:num(t.price)}</strong><em>{num(t.pips*result.plan!.usdPerPipPerLot)} USD por lote{t.name==='TP1'?' · depois, SL no BE':''}</em></div>)}
   {result.plan.layer?<div className="rule-row rule-layer"><small>Camada de proteção (mesmo lote, mesmo SL)</small><strong>{num(result.plan.layer.from)} – {num(result.plan.layer.to)}</strong><em>preço médio ≈ {num(result.plan.layer.avg)} · se o SL bater com as duas: −{result.plan.layer.lossAtSlPips} pips ({num(result.plan.layer.lossAtSlPips*result.plan.usdPerPipPerLot)} USD por lote)</em></div>
    :<div className="rule-row rule-layer"><small>Camada de proteção</small><strong>—</strong><em>o SL está perto demais para caber a camada de 10–20 pips</em></div>}
   <ul className="rule-steps">{result.plan.management.map((m,i)=><li key={i}>{m}</li>)}</ul>
  </div>}
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
