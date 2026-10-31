// Suggested entry of a directional forecast and how it played out; shared by the server (database scoring) and the
// browser log, so both report the same result.
export type CallEntry={side:'buy'|'sell';price:number;sl:number;risk:number;unit:'pips'|'usd';tps:{name:string;price:number}[];layer:{from:number;to:number}|null;verdict:string;passed:number;total:number;block:string|null;rr:number|null};
// final: stopped, at the last target, or 24h old.
export type Outcome={status:string;good:boolean|null;final:boolean};
type Bar={time:number;high:number;low:number};

const DAY=24*3600000;
// Replays the M5 bars after the reference close (`start`, ms): the stop counts first when a bar touches both; after TP1
// the stop moves to the entry (TP1 then break-even counts as TP1, Igor's rule). Undefined when the bars no longer
// reach back to the start.
export function scoreEntry(e:CallEntry|null|undefined,start:number,bars:Bar[]|null):Outcome|undefined{
 if(!e||!bars?.length||bars[0].time>start)return undefined;
 const d=e.side==='buy'?1:-1;
 let reached=0;
 const hit=(n:number)=>({status:n?e.tps[n-1].name:'SL',good:n>0,final:true});
 for(const b of bars){
  if(b.time<start)continue;
  if(b.time-start>=DAY)return {status:reached?e.tps[reached-1].name:'expirou',good:reached?true:null,final:true};
  const stop=reached?e.price:e.sl;
  if(d>0?b.low<=stop:b.high>=stop)return hit(reached);
  while(reached<e.tps.length&&(d>0?b.high>=e.tps[reached].price:b.low<=e.tps[reached].price))reached++;
  if(e.tps.length&&reached===e.tps.length)return hit(reached);
 }
 return {status:reached?e.tps[reached-1].name+' · aberta':'aberta',good:reached?true:null,final:false};
}
