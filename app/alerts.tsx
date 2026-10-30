'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {Bell,BellOff} from 'lucide-react';
import {levelNames,type Insight,type Level} from './forecast';
import type {CrtSetup} from './crt';

type CalEvent={title:string;date:string;impact:'High'|'Medium'};
type Alert={at:number;title:string;body:string};
const KEY='aurum-alerts';
// Levels worth a break alert intraday; EMAs and window extremes move too often to be useful.
const WATCH:Level[]=['high2h','low2h','pdh','pdl','pdc','asiaHigh','asiaLow','londonHigh','londonLow'];
const EVENT_LEAD=15*60000;
const num=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const clock=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'}).format(new Date(t));

export function useAlerts({price,levels,insight,events,now,crt}:{price:number|null;levels:Partial<Record<Level,number>>|null;insight:Insight|null;events:CalEvent[];now:number;crt?:CrtSetup|null}){
 const [enabled,setEnabled]=useState(false),[log,setLog]=useState<Alert[]>([]),[permission,setPermission]=useState<string>('default');
 const prev=useRef<number|null>(null), fired=useRef(new Set<string>());
 // Mount-time read of this browser's alert preference and notification permission.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{try{setEnabled(localStorage.getItem(KEY)==='on')}catch{}if(typeof Notification!=='undefined')setPermission(Notification.permission)},[]);
 const push=useCallback((key:string,title:string,body:string)=>{
  if(fired.current.has(key))return; fired.current.add(key);
  setLog(l=>[{at:Date.now(),title,body},...l].slice(0,10));
  try{if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(title,{body,tag:key})}catch{}
 },[]);
 // Price crossings: compares the previous and current spot quote against each watched level.
 useEffect(()=>{
  if(!enabled||price===null||!levels){prev.current=price;return}
  const p0=prev.current; prev.current=price; if(p0===null||p0===price)return;
  const lines:[string,string,number][]=WATCH.flatMap(k=>typeof levels[k]==='number'?[[k,levelNames[k],levels[k]!] as [string,string,number]]:[]);
  if(insight?.invalidation)lines.push(['invalidation','invalidação da previsão de 4h ('+levelNames[insight.invalidation.level]+')',insight.invalidation.price]);
  if(insight?.short?.invalidation)lines.push(['invalidation1h','invalidação da previsão de 1h ('+levelNames[insight.short.invalidation.level]+')',insight.short.invalidation.price]);
  for(const [k,name,l] of lines){
   const up=p0<l&&price>=l, down=p0>l&&price<=l;
   if(up||down)push(`${k}:${l}:${up?'up':'down'}`,`XAU/USD ${up?'rompeu acima':'rompeu abaixo'} da ${name}`,`Nível ${num(l)} · preço ${num(price)} (Gold API spot)`);
  }
 },[enabled,price,levels,insight,push]);
 // Upcoming high-impact USD events, once each, 15 minutes ahead.
 useEffect(()=>{
  if(!enabled||!now)return;
  for(const e of events){const t=Date.parse(e.date);if(e.impact==='High'&&t>now&&t-now<=EVENT_LEAD)push('event:'+e.title+':'+e.date,'Evento USD de alto impacto em '+Math.ceil((t-now)/60000)+' min',`${e.title} às ${clock(t)}`)}
 },[enabled,now,events,push]);
 // CRT: one alert when the sweep is confirmed and one when the M5 entry fires, per reference candle.
 useEffect(()=>{
  if(!enabled||!crt||!crt.side)return;
  const word=crt.side==='sell'?'venda':'compra';
  if(crt.status==='aguardando-quebra')push('crt:'+crt.b.start+':sweep','CRT: varredura confirmada para '+word,crt.detail);
  if(crt.status==='entrada'&&crt.entry)push('crt:'+crt.b.start+':entry','CRT: entrada de '+word+' em '+crt.entry.price,'SL '+crt.entry.sl+' ('+crt.entry.slPips+' pips) · '+crt.entry.tps.map(t=>t.name+' '+t.price).join(' · '));
 },[enabled,crt,push]);
 const toggle=useCallback(async()=>{
  const next=!enabled;
  if(next&&typeof Notification!=='undefined'&&Notification.permission==='default'){try{setPermission(await Notification.requestPermission())}catch{}}
  setEnabled(next); try{localStorage.setItem(KEY,next?'on':'off')}catch{}
 },[enabled]);
 return {enabled,toggle,log,permission};
}

export function AlertsPanel({enabled,toggle,log,permission}:ReturnType<typeof useAlerts>){
 return <section className="panel alerts-panel">
  <div className="panel-heading"><h2>{enabled?<Bell size={17}/>:<BellOff size={17}/>}Alertas de preço e agenda</h2><button className={'button'+(enabled?' gold-button':'')} onClick={toggle}>{enabled?'Alertas ativos':'Ativar alertas'}</button></div>
  {enabled&&permission==='denied'&&<div className="panel-note">O navegador bloqueou notificações deste site. Os alertas aparecem só aqui na página; libere nas configurações do site para receber fora dela.</div>}
  {log.length>0?<div className="alert-list">{log.map((a,i)=><div key={i} className="alert-row"><span className="micro">{clock(a.at)}</span><div><strong>{a.title}</strong><small>{a.body}</small></div></div>)}</div>
   :<div className="panel-note">{enabled?'Nenhum alerta ainda. ':'Desligado. '}Avisa quando o preço rompe a máxima ou mínima de ontem, das sessões de Ásia e Londres, das últimas 2h ou a invalidação da previsão, e 15 minutos antes de eventos USD de alto impacto. Também avisa quando um CRT confirma a varredura e quando dispara a entrada no M5.</div>}
  <div className="panel-note">Usa a cotação spot da Gold API, atualizada a cada 30 s com o painel aberto. Pode diferir do preço da Exness. Com a aba fechada, nenhum alerta é enviado.</div>
 </section>;
}
