import type {Candle} from './indicators';

// Igor's convention for gold: 1 pip = 0.10 USD.
export const PIP=0.1;
export const LADDER={tp1:20,tp2:50,tp3:80};
const EXPIRE_MS=24*3600000;
const round=(v:number)=>Math.round(v*100)/100;
const num=(s:string)=>Number(s.replace(',','.'));

export type ParsedSignal={side:'buy'|'sell';entry:number;sl:number;tps:number[];slLabeled:boolean};
// Reads the partner's format: "Gold buy 4019 / SL 4014 / TP 4025 / TP 4030 / TP 4100". The SL may come unlabeled
// ("Gold sell 4033 / 4038 / Tp 4028") and "T0" is a common typo for "TP". Updates such as "tp1 for 20 pips" are not signals.
export function parseSignal(text:string):{signal:ParsedSignal}|{error:string}{
 const t=text.toLowerCase().replace(/\bt0\b/g,'tp').replace(/[|•]/g,' ');
 const head=t.match(/\b(buy|sell|compra|venda)\b(?:\s*(?:now|agora|limit|stop))?\s*[@:]?\s*(\d{3,5}(?:[.,]\d+)?)/);
 if(!head)return {error:'Não encontrei um sinal (compra/venda com preço). Atualizações como "tp1 for 20 pips" não são sinais.'};
 const side=head[1]==='buy'||head[1]==='compra'?'buy':'sell', entry=num(head[2]);
 const rest=t.slice((head.index??0)+head[0].length);
 const tps=[...rest.matchAll(/\b(?:tp|take\s*profit|alvo)\s*(?:\d\b)?\s*[:@=-]?\s*(\d{3,5}(?:[.,]\d+)?)/g)].map(m=>num(m[1]));
 let sl=rest.match(/\b(?:sl|stop\s*loss|stop)\s*[:@=-]?\s*(\d{3,5}(?:[.,]\d+)?)/)?.[1];
 const slLabeled=!!sl;
 // Unlabeled SL: the first bare number line after the entry that is not a TP line.
 if(!sl)sl=rest.split('\n').map(l=>l.trim()).find(l=>/^\d{3,5}(?:[.,]\d+)?$/.test(l));
 if(!sl)return {error:'Não encontrei o stop (SL) do sinal.'};
 const stop=num(sl);
 if(side==='buy'?stop>=entry:stop<=entry)return {error:`SL ${stop} está do lado errado para uma ${side==='buy'?'compra':'venda'} em ${entry}.`};
 const valid=tps.filter(p=>side==='buy'?p>entry:p<entry);
 if(!valid.length)return {error:'Não encontrei alvos (TP) válidos no sinal.'};
 return {signal:{side,entry,sl:stop,tps:valid,slLabeled}};
}

export function sessionAt(t:number){const h=new Date(t).getUTCHours();return h>=13&&h<21?{key:'ny',name:'Nova York',cap:50}:h>=7&&h<13?{key:'london',name:'Londres',cap:30}:{key:'asia',name:'Ásia',cap:30}}

// Checks the signal against Igor's rules at the moment it was posted.
export function ruleCheck(s:ParsedSignal,signalTime:number){
 const session=sessionAt(signalTime), dir=s.side==='buy'?1:-1;
 const slPips=Math.round(Math.abs(s.entry-s.sl)/PIP), firstTpPips=Math.round(Math.abs(s.tps[0]-s.entry)/PIP);
 const checks=[
  {key:'sl-cap',label:`SL dentro do seu limite da sessão ${session.name} (${session.cap} pips)`,ok:slPips<=session.cap,detail:`SL do sinal a ${slPips} pips`},
  {key:'tp1',label:'Primeiro TP do sinal a pelo menos 20 pips',ok:firstTpPips>=LADDER.tp1,detail:`primeiro TP a ${firstTpPips} pips`},
 ];
 return {session:session.name,cap:session.cap,slPips,firstTpPips,checks,
  // Following the rules strictly: when the signal's SL is wider than the cap, use the cap instead.
  adjustedSl:slPips>session.cap?round(s.entry-dir*session.cap*PIP):null,
  ladder:{tp1:round(s.entry+dir*LADDER.tp1*PIP),tp2:round(s.entry+dir*LADDER.tp2*PIP),tp3:round(s.entry+dir*LADDER.tp3*PIP)}};
}

export type Outcome={status:'open'|'sl'|'tp1'|'tp2'|'tp3'|'expired';maxPips:number;resultPips:number|null;closedAt:string|null;tp1At:string|null};
// Replays bars after the signal: TP1 (+20) moves the stop to break-even, so a later stop-out closes at the best rung reached
// and does not count as SL. When one bar touches both the stop and TP1 before TP1 was reached, the stop is assumed first (conservative).
export function scoreSignal(s:{side:'buy'|'sell';entry:number;sl:number;signalTime:number},bars:Candle[],now=Date.now()):Outcome{
 const dir=s.side==='buy'?1:-1, pips=(p:number)=>(p-s.entry)*dir/PIP;
 let max=0,tp1At:string|null=null;
 const rung=()=>max>=LADDER.tp3?'tp3':max>=LADDER.tp2?'tp2':max>=LADDER.tp1?'tp1':null;
 const close=(status:Outcome['status'],result:number|null,t:number):Outcome=>({status,maxPips:round(max),resultPips:result===null?null:round(result),closedAt:new Date(t).toISOString(),tp1At});
 const after=bars.filter(b=>b.time+300000>s.signalTime).sort((a,b)=>a.time-b.time);
 // The signal counts as filled only once a bar trades through the entry price; until then nothing is scored.
 const fill=after.findIndex(b=>b.low<=s.entry&&b.high>=s.entry);
 if(fill<0)return now-s.signalTime>EXPIRE_MS?close('expired',null,now):{status:'open',maxPips:0,resultPips:null,closedAt:null,tp1At:null};
 for(const b of after.slice(fill)){
  const fav=pips(s.side==='buy'?b.high:b.low), adv=pips(s.side==='buy'?b.low:b.high);
  const stopPips=tp1At?0:pips(s.sl);
  if(adv<=stopPips){
   if(!tp1At)return close('sl',pips(s.sl),b.time);
   const r=rung()!; return close(r,LADDER[r],b.time);
  }
  max=Math.max(max,fav);
  if(!tp1At&&max>=LADDER.tp1)tp1At=new Date(b.time).toISOString();
  if(max>=LADDER.tp3)return close('tp3',LADDER.tp3,b.time);
 }
 if(now-s.signalTime>EXPIRE_MS){const r=rung();return close(r??'expired',r?LADDER[r]:null,now)}
 return {status:'open',maxPips:round(max),resultPips:null,closedAt:null,tp1At};
}
