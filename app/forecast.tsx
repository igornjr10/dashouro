'use client';
import {useState,useEffect,useMemo,useCallback} from 'react';
import type {SignalHistory} from './signals';
import {AlertTriangle,ArrowDownRight,ArrowUpRight,Minus,Target,Trash2} from 'lucide-react';

export type Level='high2h'|'low2h'|'highWindow'|'lowWindow'|'ema20'|'ema50'|'pdh'|'pdl'|'pdc'|'asiaHigh'|'asiaLow'|'londonHigh'|'londonLow';
type Call={
 bias:'alta'|'baixa'|'neutro'; confidence:'baixa'|'media'|'alta'; horizonHours:number;
 drivers:{text:string;source:string}[];
 invalidation:{level:Level;condition:'acima'|'abaixo';price:number}|null;
};
// Top-level fields are the 4h call; `short` is the 1h call (absent in answers from before the split).
export type Insight=Call&{
 short?:Call; event1h?:boolean;
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

type Rate={total:number;hits:number};
export type CheckRow={id:string;created_at:string;side:'buy'|'sell';verdict:string;passed:number;total:number;price:number;stop_price:number;target_price:number|null;rr:number|null;block:string|null};
type Remote={list:Prediction[];checks:CheckRow[];signals:SignalHistory|null;stats:{overall:Rate;byBias:Record<string,Rate>;byConfidence:Record<string,Rate>;byHorizon?:Record<string,Rate>}};
type ServerRow={created_at:string;bias:Prediction['bias'];confidence:Prediction['confidence'];horizon_hours:number;ref_price:number;ref_time:string;model:string|null;status:string;result_price:number|null;result_move:number|null;hit:boolean|null};
const fromServer=(r:ServerRow):Prediction=>({at:r.created_at,bias:r.bias,confidence:r.confidence,horizonHours:r.horizon_hours,refPrice:Number(r.ref_price),refTime:r.ref_time,model:r.model||'',
 result:r.status==='pending'?undefined:r.status==='unchecked'?'unchecked':{price:Number(r.result_price),move:Number(r.result_move),hit:!!r.hit}});

// With an access token the database is the source of truth (scored on the server); without one, the browser log stays as before.
export function usePredictions(candles:Candle[]|null,access=''){
 const [saved,setSaved]=useState<Prediction[]>([]),[remote,setRemote]=useState<Remote|null>(null),[syncError,setSyncError]=useState('');
 // Mount-time read of this browser's prediction log.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setSaved(load()||[])},[]);
 const sync=useCallback(async()=>{
  if(!access){setRemote(null);setSyncError('');return}
  try{const r=await fetch('/api/history',{headers:{'X-Aurum-Access':access},cache:'no-store'});const j=await r.json() as {error?:string;predictions:ServerRow[];checks:CheckRow[];stats:Remote['stats'];signals?:SignalHistory};if(!r.ok)throw new Error(j.error);
   setRemote({list:(j.predictions as ServerRow[]).map(fromServer),checks:j.checks,stats:j.stats,signals:j.signals??null});setSyncError('')}
  catch(e){setRemote(null);setSyncError(e instanceof Error?e.message:'Falha ao ler o histórico.')}
 },[access]);
 // Re-sync when the token changes and on each M5 refresh, which is when the server can score pending predictions.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{sync()},[sync,candles]);
 const local=useMemo(()=>saved.map(p=>p.result?p:{...p,result:score(p,candles)}),[saved,candles]);
 // Persist results as soon as they are scored, because the M5 window only covers the last ~8h.
 useEffect(()=>{if(local.some((p,i)=>p.result&&!saved[i].result))store(local)},[local,saved]);
 const add=useCallback((i:Insight&{saved?:boolean})=>{
  if(!i.reference)return;if(i.saved){sync();return}
  const ref=i.reference, mk=(c:Call):Prediction=>({at:i.at,bias:c.bias,confidence:c.confidence,horizonHours:c.horizonHours,refPrice:ref.price,refTime:ref.time,model:i.model});
  const fresh=i.short?[mk(i.short),mk(i)]:[mk(i)];
  setSaved(s=>{const n=[...fresh,...(load()??s)].slice(0,50);store(n);return n});
 },[sync]);
 const clear=useCallback(()=>{store([]);setSaved([])},[]);
 return {list:remote?remote.list:local,remote,syncError,sync,add,clear};
}

const BiasIcon=({bias,size=22}:{bias:Insight['bias'];size?:number})=>bias==='alta'?<ArrowUpRight size={size}/>:bias==='baixa'?<ArrowDownRight size={size}/>:<Minus size={size}/>;

function CallCard({c,title,event}:{c:Call;title:string;event:boolean}){
 const inv=c.invalidation;
 return <div className={'bias-card bias-'+c.bias}>
  <div className="bias-main"><BiasIcon bias={c.bias} size={30}/><div><small>{title}</small><strong>{biasNames[c.bias]}</strong></div></div>
  <div className="bias-facts">
   <div><small>Confiança</small><strong>{confNames[c.confidence]}</strong></div>
   <div><small>Invalida se</small><strong>{inv?`fechar ${inv.condition} de ${num(inv.price)}`:'—'}</strong>{inv&&<em>{levelNames[inv.level]}</em>}</div>
  </div>
  {event&&<div className="bias-warning"><AlertTriangle size={14}/>Evento USD de alto impacto neste prazo: confiança limitada a média.</div>}
  {c.drivers.length>0&&<ol className="bias-drivers">{c.drivers.map((d,i)=><li key={i}>{d.text}<small>{d.source}</small></li>)}</ol>}
 </div>;
}

export function Forecast({insight}:{insight:Insight}){
 const s=insight.short, split=s&&s.bias!==insight.bias;
 return <div className="forecast">
  <div className="bias-pair">
   {s&&<CallCard c={s} title="SCALPING · PRÓXIMA 1H (M5)" event={!!insight.event1h}/>}
   <CallCard c={insight} title={`DAY TRADE · PRÓXIMAS ${insight.horizonHours}H (H1)`} event={insight.eventSoon}/>
  </div>
  {split&&<div className="bias-split">Os prazos discordam: {biasNames[s.bias].toLowerCase()} na próxima hora contra {biasNames[insight.bias].toLowerCase()} nas próximas 4h. Movimento contra a tendência maior costuma ser mais curto.</div>}
  <p className="analysis-text" aria-live="polite">{insight.analysis}</p>
  <div className="panel-note">Viés probabilístico, não sinal de entrada. Indicadores calculados no servidor; níveis vêm dos candles da Twelve Data, não do modelo. {insight.reference?`Preço de referência ${num(insight.reference.price)} (${insight.reference.source}, ${time(insight.reference.time)}).`:'Sem candles M5 atuais: viés forçado a neutro.'}</div>
 </div>;
}

const verdictNames:Record<string,string>={favoravel:'Favorável',ressalvas:'Com ressalvas',desfavoravel:'Desfavorável','nao-operar':'Não operar'};
const pct=(r?:Rate)=>r&&r.total?`${Math.round(r.hits/r.total*100)}% (${r.hits}/${r.total})`:'—';
function AccessForm({onSave}:{onSave:(v:string)=>void}){
 return <form className="access-form" onSubmit={e=>{e.preventDefault();const v=(e.currentTarget.elements.namedItem('access') as HTMLInputElement).value.trim();if(v)onSave(v)}}>
  <input name="access" type="password" autoComplete="current-password" placeholder="Senha de acesso ao banco" required/>
  <button type="submit" className="button">Sincronizar</button>
 </form>;
}
export function Scoreboard({predictions,clear,dbConfigured,access,setAccess}:{predictions:ReturnType<typeof usePredictions>;clear:()=>void;dbConfigured:boolean;access:string;setAccess:(v:string)=>void}){
 const {list,remote,syncError}=predictions;
 const done=list.filter(p=>p.result&&p.result!=='unchecked') as (Prediction&{result:{price:number;move:number;hit:boolean}})[];
 const hits=done.filter(p=>p.result.hit).length, pending=list.filter(p=>!p.result).length;
 const total=remote?remote.stats.overall:{total:done.length,hits};
 return <section className="panel scoreboard">
  <div className="panel-heading"><h2><Target size={17}/>Placar das previsões</h2>
   {remote?<span className="status-pill good">Banco sincronizado</span>:list.length>0&&<button className="icon-button" aria-label="Apagar histórico de previsões deste navegador" onClick={clear}><Trash2 size={15}/></button>}
  </div>
  {dbConfigured&&!remote&&<div className="access-box">{syncError&&access?<p className="connection-error">{syncError}</p>:<p className="small muted">Digite a senha de acesso para salvar previsões e avaliações no banco e ver o mesmo placar em qualquer aparelho.</p>}<AccessForm onSave={setAccess}/></div>}
  {list.length===0?<div className="panel-note">Nenhuma previsão registrada{remote?' no banco':' neste navegador'}. Cada análise gerada entra aqui e é conferida quando o horizonte vence.</div>:<>
   <div className="score-summary">
    <div><small>Acertos</small><strong>{total.total?`${total.hits} de ${total.total}`:'—'}</strong></div>
    <div><small>Taxa</small><strong>{total.total?`${Math.round(total.hits/total.total*100)}%`:'—'}</strong></div>
    <div><small>Aguardando</small><strong>{pending}</strong></div>
    {remote&&<><div><small>1h (scalping)</small><strong>{pct(remote.stats.byHorizon?.['1'])}</strong></div><div><small>4h (day trade)</small><strong>{pct(remote.stats.byHorizon?.['4'])}</strong></div><div><small>Confiança alta</small><strong>{pct(remote.stats.byConfidence.alta)}</strong></div><div><small>Confiança média</small><strong>{pct(remote.stats.byConfidence.media)}</strong></div><div><small>Confiança baixa</small><strong>{pct(remote.stats.byConfidence.baixa)}</strong></div></>}
   </div>
   <div className="score-list">{list.slice(0,8).map((p,i)=><div key={i} className="score-row">
    <span className={'bias-chip bias-'+p.bias}><BiasIcon bias={p.bias} size={13}/>{biasNames[p.bias]}</span>
    <span className="score-when">{time(p.at)} · {p.horizonHours}h · conf. {confNames[p.confidence]}</span>
    <span className="score-result">{!p.result?'aguardando':p.result==='unchecked'?'não conferida':<>{num(p.refPrice)} → {num(p.result.price)} <b className={p.result.hit?'green':'red'}>{p.result.hit?'acertou':'errou'}</b></>}</span>
   </div>)}</div>
  </>}
  {remote&&remote.checks.length>0&&<><div className="score-subhead">Últimas avaliações de compra e venda</div><div className="score-list">{remote.checks.slice(0,8).map(c=><div key={c.id} className="score-row">
   <span className={'bias-chip bias-'+(c.side==='buy'?'alta':'baixa')}>{c.side==='buy'?'Compra':'Venda'}</span>
   <span className="score-when">{time(c.created_at)} · {c.passed}/{c.total} critérios · preço {num(Number(c.price))}</span>
   <span className="score-result">{verdictNames[c.verdict]||c.verdict}</span>
  </div>)}</div></>}
  <div className="panel-note">Conferido com o fechamento M5 da Twelve Data no fim do horizonte. Alta/baixa acertam com o sinal certo; neutro acerta se o preço variar menos de 0,15%. {remote?'No banco, a conferência é feita pelo servidor sempre que algum aparelho abre o painel dentro de ~8h após o vencimento.':'Previsões com mais de ~8h sem conferência ficam como “não conferida”.'} {total.total<20&&'Com menos de 20 previsões conferidas, a taxa ainda não diz muito.'}{remote&&<> <button className="text-button" onClick={()=>setAccess('')}>Sair do banco neste aparelho</button></>}</div>
 </section>;
}
