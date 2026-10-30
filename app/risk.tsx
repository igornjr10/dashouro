'use client';
import {useState,useEffect,useMemo,useCallback} from 'react';
import {Lock,ShieldAlert,Trash2,Unlock} from 'lucide-react';

// Igor's convention: 1 pip = 0.10 USD and 1 standard lot = 100 oz, so 1 pip = 10 USD per lot.
const USD_PER_PIP_LOT=10;
export type DayTrade={at:number;side:'buy'|'sell';pips:number;lots:number;note:string};
export type RiskSettings={maxLossUsd:number;maxTrades:number;maxStopsInRow:number;riskUsd:number};
const DEFAULTS:RiskSettings={maxLossUsd:0,maxTrades:6,maxStopsInRow:2,riskUsd:0};
const num=(v:number,d=2)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const hm=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const dayKey=(t:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(t));
const read=<T,>(k:string,fallback:T):T=>{try{const v=localStorage.getItem(k);return v?{...fallback,...JSON.parse(v)}:fallback}catch{return fallback}};
const readList=(k:string):DayTrade[]=>{try{const v=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(v)?v:[]}catch{return []}};
const write=(k:string,v:unknown)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};

// Lot size for a risk budget. With the protection layer (same lot, same SL, entered 15 pips against on average),
// both positions stop out together: the loss is lots × (SL + SL − 15) pips, so the lot must be smaller.
export function lotFor(riskUsd:number,slPips:number,withLayer:boolean){
 if(!(riskUsd>0)||!(slPips>0))return 0;
 const pips=withLayer?Math.max(slPips,2*slPips-15):slPips;
 return Math.floor(riskUsd/(pips*USD_PER_PIP_LOT)*100)/100;
}

export function useRiskDay(now:number){
 const day=now?dayKey(now):'';
 const [settings,setSettingsState]=useState<RiskSettings>(DEFAULTS),[trades,setTrades]=useState<DayTrade[]>([]),[override,setOverride]=useState(false);
 // Mount-time and day-change read of this browser's journal; each Brasília day has its own list.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setSettingsState(read('aurum-risk-settings',DEFAULTS));if(day){setTrades(readList('aurum-day-'+day));setOverride(localStorage.getItem('aurum-day-override')===day)}},[day]);
 const setSettings=useCallback((s:RiskSettings)=>{setSettingsState(s);write('aurum-risk-settings',s)},[]);
 const add=useCallback((t:DayTrade)=>setTrades(l=>{const n=[...l,t];write('aurum-day-'+dayKey(t.at),n);return n}),[]);
 const remove=useCallback((i:number)=>setTrades(l=>{const n=l.filter((_,j)=>j!==i);if(day)write('aurum-day-'+day,n);return n}),[day]);
 const unlock=useCallback(()=>{setOverride(true);try{localStorage.setItem('aurum-day-override',day)}catch{}},[day]);
 const summary=useMemo(()=>{
  const usd=trades.reduce((a,t)=>a+t.pips*t.lots*USD_PER_PIP_LOT,0), pips=trades.reduce((a,t)=>a+t.pips,0);
  let streak=0; for(let i=trades.length-1;i>=0&&trades[i].pips<0;i--)streak++;
  const reasons:string[]=[];
  if(settings.maxLossUsd>0&&usd<=-settings.maxLossUsd)reasons.push(`perda do dia de ${num(-usd)} USD atingiu o limite de ${num(settings.maxLossUsd)}`);
  if(settings.maxTrades>0&&trades.length>=settings.maxTrades)reasons.push(`${trades.length} operações: limite de ${settings.maxTrades} por dia`);
  if(settings.maxStopsInRow>0&&streak>=settings.maxStopsInRow)reasons.push(`${streak} stops seguidos`);
  const nearLoss=settings.maxLossUsd>0&&usd<0&&-usd>=settings.maxLossUsd*0.7&&!reasons.length;
  return {usd,pips,streak,wins:trades.filter(t=>t.pips>0).length,losses:trades.filter(t=>t.pips<0).length,reasons,nearLoss};
 },[trades,settings]);
 const locked=summary.reasons.length>0&&!override;
 return {settings,setSettings,trades,add,remove,summary,locked,override,unlock};
}

export function RiskCard({risk,lastSl}:{risk:ReturnType<typeof useRiskDay>;lastSl:number|null}){
 const {settings:s,summary:m,trades,locked}=risk;
 const [side,setSide]=useState<'buy'|'sell'>('buy'),[pips,setPips]=useState(''),[lots,setLots]=useState(''),[note,setNote]=useState(''),[sl,setSl]=useState(''),[edit,setEdit]=useState(false);
 const slPips=Number(sl)||lastSl||0;
 const submit=(e:React.FormEvent)=>{e.preventDefault();const p=Number(pips.replace(',','.')),l=Number(lots.replace(',','.'));if(!Number.isFinite(p)||!(l>0))return;risk.add({at:Date.now(),side,pips:p,lots:l,note:note.trim().slice(0,60)});setPips('');setNote('')};
 const field=(k:keyof typeof s,label:string,suffix:string)=><label>{label}<span><input type="number" min="0" step="any" value={s[k]||''} onChange={e=>risk.setSettings({...s,[k]:Number(e.target.value)||0})}/>{suffix}</span></label>;
 return <section className={'panel risk-card'+(locked?' risk-locked':'')}>
  <div className="panel-heading"><h2>{locked?<Lock size={17}/>:<ShieldAlert size={17}/>}Meu dia · risco</h2><span className={'status-pill '+(locked?'':m.nearLoss?'':'good')}>{locked?'Travado':m.nearLoss?'Atenção':'Liberado'}</span></div>
  <div className="risk-now">
   <div><small>Resultado do dia</small><strong className={m.usd>0?'green':m.usd<0?'red':''}>{m.usd>0?'+':''}{num(m.usd)} USD</strong><em>{m.pips>0?'+':''}{num(m.pips,1)} pips · {m.wins} ganhos · {m.losses} stops</em></div>
   <div><small>Operações</small><strong>{trades.length}{s.maxTrades>0?` / ${s.maxTrades}`:''}</strong><em>{m.streak?`${m.streak} stop(s) seguido(s)`:'sem stop seguido'}</em></div>
   <div><small>Perda máxima do dia</small><strong>{s.maxLossUsd>0?`${num(s.maxLossUsd)} USD`:'—'}</strong><em>{s.maxLossUsd>0?`restam ${num(Math.max(0,s.maxLossUsd+Math.min(0,m.usd)))} USD`:'defina abaixo'}</em></div>
  </div>
  {locked&&<div className="risk-alert"><Lock size={15}/><div><strong>Dia travado: {m.reasons.join(' · ')}.</strong><span>As avaliações de compra, venda e sinal ficam bloqueadas até amanhã. Pela sua regra, o melhor agora é parar.</span><button className="text-button" onClick={risk.unlock}><Unlock size={13}/> Entendo o risco, liberar mesmo assim</button></div></div>}
  {risk.override&&m.reasons.length>0&&<div className="risk-alert soft">Trava ignorada hoje: {m.reasons.join(' · ')}.</div>}
  {m.nearLoss&&<div className="risk-alert soft">Você já usou mais de 70% da perda máxima do dia.</div>}

  <div className="risk-lot">
   <h3>Lote pelas suas regras</h3>
   <div className="risk-lot-row">
    <label>Risco por operação<span><input type="number" min="0" step="any" value={s.riskUsd||''} onChange={e=>risk.setSettings({...s,riskUsd:Number(e.target.value)||0})}/>USD</span></label>
    <label>SL<span><input type="number" min="0" step="1" placeholder={lastSl?String(lastSl):'pips'} value={sl} onChange={e=>setSl(e.target.value)}/>pips</span></label>
    <div><small>Sem camada</small><strong>{slPips&&s.riskUsd?num(lotFor(s.riskUsd,slPips,false)):'—'} lote</strong></div>
    <div><small>Com camada (2 posições)</small><strong>{slPips&&s.riskUsd?num(lotFor(s.riskUsd,slPips,true)):'—'} lote cada</strong></div>
   </div>
   <p className="muted small">{lastSl&&!sl?`SL da última avaliação: ${lastSl} pips. `:''}1 pip = 10 USD por lote. Com a camada, as duas posições batem no mesmo SL: o lote é calculado para que a perda somada caiba no risco. Arredondado para baixo em 0,01.</p>
  </div>

  <form className="risk-form" onSubmit={submit}>
   <h3>Registrar operação</h3>
   <div className="risk-form-row">
    <select value={side} onChange={e=>setSide(e.target.value as 'buy'|'sell')}><option value="buy">Compra</option><option value="sell">Venda</option></select>
    <input inputMode="decimal" placeholder="Resultado (pips, ex. -30 ou 20)" value={pips} onChange={e=>setPips(e.target.value)} required/>
    <input inputMode="decimal" placeholder="Lote (ex. 0,05)" value={lots} onChange={e=>setLots(e.target.value)} required/>
    <input placeholder="Origem (CRT, sinal, manual)" value={note} onChange={e=>setNote(e.target.value)}/>
    <button className="button" type="submit">Registrar</button>
   </div>
  </form>
  {trades.length>0&&<div className="score-list">{[...trades].reverse().map((t,ri)=>{const i=trades.length-1-ri;return <div key={t.at} className="score-row">
   <span className={'bias-chip bias-'+(t.side==='buy'?'alta':'baixa')}>{t.side==='buy'?'Compra':'Venda'}</span>
   <span className="score-when">{hm(t.at)} · {num(t.lots)} lote{t.note?` · ${t.note}`:''}</span>
   <span className="score-result"><b className={t.pips>0?'green':t.pips<0?'red':''}>{t.pips>0?'+':''}{num(t.pips,1)} pips · {num(t.pips*t.lots*USD_PER_PIP_LOT)} USD</b> <button className="icon-button" aria-label="Apagar operação" onClick={()=>risk.remove(i)}><Trash2 size={13}/></button></span>
  </div>})}</div>}

  <div className="risk-settings">
   <button className="text-button" onClick={()=>setEdit(v=>!v)}>{edit?'Fechar limites':'Ajustar limites do dia'}</button>
   {edit&&<div className="risk-settings-row">{field('maxLossUsd','Perda máxima do dia','USD')}{field('maxTrades','Máximo de operações','por dia')}{field('maxStopsInRow','Parar depois de','stops seguidos')}</div>}
  </div>
  <div className="panel-note">Registro só neste navegador e zerado a cada dia (horário de Brasília). Os pips são os seus, como saíram na Exness; o USD é pips × lote × 10. A trava é um lembrete forte, não bloqueia a corretora.</div>
 </section>;
}
