'use client';
import {useState,useEffect} from 'react';
import {Check,ClipboardList,Loader2,Send,X} from 'lucide-react';

const num=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const when=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v));

// Same UTC session hours as the server rules; shown in Brasília time (UTC−3).
const SESSIONS=[{key:'asia',name:'Ásia',from:21,to:7,cap:30,brt:'18:00 – 04:00'},{key:'london',name:'Londres',from:7,to:13,cap:30,brt:'04:00 – 10:00'},{key:'ny',name:'Nova York',from:13,to:21,cap:50,brt:'10:00 – 18:00'}];
function current(now:number){
 const h=new Date(now).getUTCHours();
 const s=h>=13&&h<21?SESSIONS[2]:h>=7&&h<13?SESSIONS[1]:SESSIONS[0];
 const end=new Date(now); end.setUTCMinutes(0,0,0); end.setUTCHours(s.to); if(end.getTime()<=now)end.setUTCDate(end.getUTCDate()+1);
 return {s,left:end.getTime()-now};
}
const ITEMS=['Li as regras do dia','Conferi a agenda (eventos USD de alto impacto)','Defini lote e risco máximo do dia','Sei o SL máximo da sessão em que vou operar'];

export function RulesCard({now}:{now:number}){
 const [done,setDone]=useState<boolean[]>(ITEMS.map(()=>false));
 const day=now?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(now)):'';
 // The checklist resets every Brasília day: each day has its own key.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(!day)return;try{const v=JSON.parse(localStorage.getItem('aurum-daily-'+day)||'null');setDone(Array.isArray(v)?v:ITEMS.map(()=>false))}catch{}},[day]);
 const toggle=(i:number)=>setDone(d=>{const n=d.map((v,j)=>j===i?!v:v);try{localStorage.setItem('aurum-daily-'+day,JSON.stringify(n))}catch{}return n});
 if(!now)return null;
 const {s,left}=current(now), hh=Math.floor(left/3600000), mm=Math.floor(left%3600000/60000);
 return <section className="panel rules-card">
  <div className="rules-now">
   <div><small>SESSÃO AGORA</small><strong>{s.name}</strong><em>{s.brt} (Brasília) · termina em {hh}h{String(mm).padStart(2,'0')}</em></div>
   <div><small>SL MÁXIMO AGORA</small><strong className="red">{s.cap} pips</strong><em>{num(s.cap*0.1)} USD no preço · {num(s.cap*10)} USD por lote</em></div>
   <div><small>ALVOS</small><strong className="green">20 · 40–50 · 80+</strong><em>TP1 · TP2 · TP3 em pips · no TP1, SL no BE</em></div>
   <div><small>CAMADA</small><strong className="gold-text">10–20 pips contra</strong><em>mesmo lote, mesmo SL</em></div>
  </div>
  <div className="rules-sessions">{SESSIONS.map(x=><span key={x.key} className={x.key===s.key?'on':''}>{x.name} {x.brt} · SL {x.cap}</span>)}</div>
  <div className="rules-check"><ClipboardList size={15}/>{ITEMS.map((t,i)=><label key={i}><input type="checkbox" checked={done[i]} onChange={()=>toggle(i)}/>{t}</label>)}{done.every(Boolean)&&<span className="green">Pronto para operar.</span>}</div>
 </section>;
}

type Rules={session:string;cap:number;slPips:number;firstTpPips:number;adjustedSl:number|null;ladder:{tp1:number;tp2:number;tp3:number};checks:{key:string;label:string;ok:boolean;detail:string}[]};
type Result={ok:true;signal:{side:'buy'|'sell';entry:number;sl:number;tps:number[]};rules:Rules;market:{verdict:string;block:string|null;passed:number;total:number;checks:{key:string;label:string;ok:boolean;detail:string}[];eventWarning:{title:string;minutes:number}|null}|null;fresh:boolean;saved:boolean;duplicate:boolean;signalTime:string};
export type SignalRow={id:string;source:string;side:'buy'|'sell';entry:number;sl:number;adjusted_sl:number|null;signal_time:string;session:string;sl_pips:number;status:string;max_pips:number|null;result_pips:number|null;my_status:string;my_result_pips:number|null};
type Stats={closed:number;sl:number;tp1:number;tp2:number;tp3:number;expired:number;pips:number};
export type SignalHistory={list:SignalRow[];stats:{theirs:Stats;mine:Stats}};
const verdicts:Record<string,string>={favoravel:'Favorável',ressalvas:'Com ressalvas',desfavoravel:'Desfavorável','nao-operar':'Não operar agora'};
const statusName:Record<string,string>={open:'em aberto',sl:'SL',tp1:'TP1',tp2:'TP2',tp3:'TP3',expired:'expirou sem TP1'};
const CheckRow=({c}:{c:{label:string;ok:boolean;detail:string}})=><div className="check-row">{c.ok?<Check size={15} className="green"/>:<X size={15} className="red"/>}<div><strong>{c.label}</strong><small>{c.detail}</small></div></div>;

function StatsBox({title,s}:{title:string;s:Stats}){
 const wins=s.tp1+s.tp2+s.tp3;
 return <div className="signal-stats"><small>{title}</small><strong>{s.closed?`${Math.round(wins/s.closed*100)}% com TP1+`:'—'}</strong><em>{s.closed} fechados · {s.sl} SL · TP1 {s.tp1} · TP2 {s.tp2} · TP3 {s.tp3} · {s.pips>0?'+':''}{s.pips} pips</em></div>;
}

export function SignalsPanel({getHeaders,history,synced,onSaved}:{getHeaders:()=>Record<string,string>;history:SignalHistory|null;synced:boolean;onSaved:()=>void}){
 const [text,setText]=useState(''),[time,setTime]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
 const submit=async()=>{setBusy(true);setError('');setResult(null);try{
  const r=await fetch('/api/signal',{method:'POST',headers:{'Content-Type':'application/json',...getHeaders()},body:JSON.stringify({text,time:time?new Date(time).toISOString():undefined})});
  const j=await r.json() as Result|{ok:false;error?:string};if(!j.ok)throw new Error(j.error||'Falha ao avaliar o sinal.');setResult(j);if(j.saved)onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Falha ao avaliar o sinal.')}finally{setBusy(false)}};
 const r=result, rl=r?.rules;
 return <>
  <section className="panel signal-input">
   <div className="panel-heading"><h2><Send size={17}/>Avaliar sinal do parceiro</h2><span className="micro">{synced?'SALVA NO BANCO':'SEM BANCO: SÓ AVALIA'}</span></div>
   <div className="signal-form">
    <textarea value={text} onChange={e=>setText(e.target.value)} rows={7} maxLength={2000} placeholder={'Cole o sinal, por exemplo:\nGold buy 4019\nSL 4014\nTP 4025\nTP 4030\nTP 4100'}/>
    <label className="small muted">Horário do sinal (deixe vazio se acabou de chegar)<input type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label>
    <button className="button gold-button" disabled={busy||!text.trim()} onClick={submit}>{busy?<Loader2 size={16} className="spin"/>:<Check size={16}/>}Avaliar pelas minhas regras</button>
    {error&&<p role="alert" className="connection-error">{error}</p>}
   </div>
   {r&&rl&&<div className="signal-result">
    <div className={'verdict '+(r.market?'verdict-'+r.market.verdict:'')}>
     <div><small>{r.signal.side==='buy'?'COMPRA':'VENDA'} · SESSÃO {rl.session.toUpperCase()} · {when(r.signalTime)}</small><strong>{num(r.signal.entry)}</strong><em>{r.market?`Mercado: ${verdicts[r.market.verdict]} (${r.market.passed}/${r.market.total})${r.market.block?' · '+r.market.block:''}`:'Sinal com mais de 30 min: checklist de mercado não aplicado.'}</em></div>
     <div className="verdict-refs">
      <div><small>SL do sinal</small><strong className={rl.slPips<=rl.cap?'':'red'}>{num(r.signal.sl)}</strong><em>{rl.slPips} pips · limite {rl.cap}</em></div>
      {rl.adjustedSl!==null&&<div><small>SL pelas suas regras</small><strong className="gold-text">{num(rl.adjustedSl)}</strong><em>{rl.cap} pips</em></div>}
      <div><small>TP1 · TP2 · TP3</small><strong className="green">{num(rl.ladder.tp1)} · {num(rl.ladder.tp2)} · {num(rl.ladder.tp3)}</strong><em>20 / 50 / 80 pips · TPs do sinal: {r.signal.tps.map(num).join(' · ')}</em></div>
     </div>
    </div>
    {r.market?.eventWarning&&<div className="bias-warning">{r.market.eventWarning.title} em {r.market.eventWarning.minutes} min.</div>}
    <div className="check-list">{rl.checks.map(c=><CheckRow key={c.key} c={c}/>)}{r.market?.checks.map(c=><CheckRow key={c.key} c={c}/>)}</div>
    <div className="panel-note">{r.saved?'Registrado no banco: o resultado será acompanhado com os candles.':r.duplicate?'Este sinal já estava registrado.':synced?'Não foi possível registrar no banco.':'Sincronize o placar com a senha de acesso para registrar e acompanhar.'} Não é ordem; confira preço e spread na Exness.</div>
   </div>}
  </section>
  {history&&<section className="panel signal-history">
   <div className="panel-heading"><h2><ClipboardList size={17}/>Placar do parceiro</h2><span className="micro">{history.list.length} SINAIS RECENTES</span></div>
   <div className="signal-stats-row"><StatsBox title="COMO O SINAL VEIO" s={history.stats.theirs}/><StatsBox title="COM AS SUAS REGRAS (SL DA SESSÃO)" s={history.stats.mine}/></div>
   <div className="score-list">{history.list.slice(0,12).map(s=><div key={s.id} className="score-row">
    <span className={'bias-chip bias-'+(s.side==='buy'?'alta':'baixa')}>{s.side==='buy'?'Compra':'Venda'}</span>
    <span className="score-when">{when(s.signal_time)} · {num(Number(s.entry))} · SL {s.sl_pips}p · {s.session}{s.source==='telegram'?' · Telegram':''}</span>
    <span className="score-result">{statusName[s.status]||s.status}{s.result_pips!==null&&` (${Number(s.result_pips)>0?'+':''}${Number(s.result_pips)})`}{s.adjusted_sl!==null&&s.my_status!==s.status&&<em className="muted"> · suas regras: {statusName[s.my_status]}</em>}</span>
   </div>)}</div>
   <div className="panel-note">Resultado medido pelos candles da Twelve Data, pela escada de 20/50/80 pips: TP1 move o stop para o BE, e TP1 seguido de stop no BE conta como TP1, não como SL. Se um mesmo candle toca o stop e o TP1, conta como stop. A entrada é considerada executada no preço do sinal.</div>
  </section>}
  {!history&&<div className="panel-note">Sincronize o placar (senha de acesso) para registrar sinais e ver o placar do parceiro.</div>}
 </>;
}
