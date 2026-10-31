import type {Candle} from './indicators';
import {scoreSignal} from './signals';
import type {Bias} from './indicators';
import type {TradeCheck} from './trade-check';
import {scoreEntry,type CallEntry} from './entry-outcome';

export type StoreEnv={SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;AURUM_ACCESS_TOKEN?:string};
const FLAT=0.0015;

export const storeEnabled=(env:StoreEnv)=>!!(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY&&env.AURUM_ACCESS_TOKEN);
// Constant-time comparison so the access token cannot be guessed byte by byte from response timing.
export function authorized(request:Request,env:StoreEnv){
 const got=request.headers.get('X-Aurum-Access')||'', want=env.AURUM_ACCESS_TOKEN||'';
 if(!want||got.length!==want.length)return false;
 let d=0; for(let i=0;i<want.length;i++)d|=got.charCodeAt(i)^want.charCodeAt(i);
 return d===0;
}
// PostgREST over fetch: works on the Edge runtime without a database driver. The service key never leaves the server.
async function rest(env:StoreEnv,path:string,init:RequestInit={}){
 const r=await fetch(env.SUPABASE_URL!.replace(/\/$/,'')+'/rest/v1/'+path,{...init,signal:AbortSignal.timeout(8000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY!,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=minimal',...init.headers}});
 if(!r.ok)throw new Error('Banco respondeu HTTP '+r.status);
 return r.status===204||r.headers.get('content-length')==='0'?null:r.json();
}

// Telegram alerts: records the alert key and answers whether this call was the first (true) or it was already sent.
export async function claimAlert(env:StoreEnv,key:string){
 const r=await rest(env,'notifications?on_conflict=key',{method:'POST',body:JSON.stringify({key}),headers:{Prefer:'resolution=ignore-duplicates,return=representation'}}) as unknown[]|null;
 return !!r?.length;
}
export function releaseAlert(env:StoreEnv,key:string){
 return rest(env,'notifications?key=eq.'+encodeURIComponent(key),{method:'DELETE'});
}
export function savePrediction(env:StoreEnv,b:Bias&{entry?:CallEntry|null},ref:{price:number;time:string},model:string){
 return rest(env,'predictions',{method:'POST',body:JSON.stringify({entry:b.entry??null,entry_status:b.entry?'aberta':null,bias:b.bias,confidence:b.confidence,horizon_hours:b.horizonHours,ref_price:ref.price,ref_time:ref.time,invalidation_level:b.invalidation?.level??null,invalidation_price:b.invalidation?.price??null,drivers:b.drivers,model})});
}
export function saveCheck(env:StoreEnv,c:TradeCheck,model?:string){
 return rest(env,'trade_checks',{method:'POST',body:JSON.stringify({side:c.side,verdict:c.verdict,passed:c.passed,total:c.total,price:c.price,stop_price:c.references.stop.price,stop_name:c.references.stop.name,target_price:c.references.target?.price??null,target_name:c.references.target?.name??null,rr:c.references.rr,block:c.block,checks:c.checks,model:model??null})});
}

type Row={id:string;created_at:string;bias:'alta'|'baixa'|'neutro';confidence:string;horizon_hours:number;ref_price:number;ref_time:string;status:string;result_price:number|null;result_move:number|null;hit:boolean|null;model:string|null;invalidation_level:string|null;invalidation_price:number|null};
// Scores pending predictions against the M5 close at horizon end. Runs whenever history is read, so any open device keeps the log current.
// Replays open suggested entries on the latest M5 bars (same rules as the browser log); entries the window no longer
// covers keep their last status.
async function scoreEntries(env:StoreEnv,candles:Candle[]){
 const open=await rest(env,'predictions?entry_final=eq.false&entry=not.is.null&select=id,entry,ref_time,entry_status&limit=100',{headers:{Prefer:''}}) as {id:string;entry:CallEntry;ref_time:string;entry_status:string|null}[];
 await Promise.all(open.map(p=>{
  const o=scoreEntry(p.entry,Date.parse(p.ref_time),candles);
  if(!o||(o.status===p.entry_status&&!o.final))return null;
  return rest(env,'predictions?id=eq.'+p.id,{method:'PATCH',body:JSON.stringify({entry_status:o.status,entry_good:o.good,entry_final:o.final})});
 }));
}
async function scorePending(env:StoreEnv,candles:Candle[]){
 if(!candles.length)return;
 await scoreEntries(env,candles).catch(()=>{});
 const lastClose=candles.at(-1)!.time+300000, first=candles[0].time+300000;
 const pending=await rest(env,'predictions?status=eq.pending&select=id,bias,horizon_hours,ref_price,ref_time&order=ref_time.asc&limit=100',{headers:{Prefer:''}}) as Row[];
 await Promise.all(pending.map(p=>{
  const expiry=Date.parse(p.ref_time)+p.horizon_hours*3600000;
  if(expiry>lastClose)return null;
  const patch=(body:object)=>rest(env,'predictions?id=eq.'+p.id,{method:'PATCH',body:JSON.stringify({...body,scored_at:new Date().toISOString()})});
  if(expiry<first)return patch({status:'unchecked'});
  const exit=candles.find(c=>c.time+300000>=expiry)!.close, move=exit-Number(p.ref_price);
  const hit=p.bias==='alta'?move>0:p.bias==='baixa'?move<0:Math.abs(move)<Number(p.ref_price)*FLAT;
  return patch({status:'scored',result_price:exit,result_move:Math.round(move*100)/100,hit});
 }));
}
export async function history(env:StoreEnv,candles:Candle[]|null){
 if(candles)await scorePending(env,candles).catch(()=>{});
 const [predictions,checks,scored,entries]=await Promise.all([
  rest(env,'predictions?select=*&order=created_at.desc&limit=50',{headers:{Prefer:''}}),
  rest(env,'trade_checks?select=id,created_at,side,verdict,passed,total,price,stop_price,stop_name,target_price,target_name,rr,block,model&order=created_at.desc&limit=30',{headers:{Prefer:''}}),
  rest(env,'predictions?status=eq.scored&select=bias,confidence,hit,horizon_hours&order=created_at.desc&limit=1000',{headers:{Prefer:''}}),
  rest(env,'predictions?entry_final=eq.true&entry_good=not.is.null&select=entry_good&limit=1000',{headers:{Prefer:''}}),
 ]) as [Row[],unknown[],{bias:string;confidence:string;hit:boolean;horizon_hours:number}[],{entry_good:boolean}[]];
 const rate=(rows:{hit:boolean}[])=>({total:rows.length,hits:rows.filter(r=>r.hit).length});
 const group=(k:'bias'|'confidence'|'horizon_hours')=>Object.fromEntries([...new Set(scored.map(r=>r[k]))].map(v=>[v,rate(scored.filter(r=>r[k]===v))]));
 return {predictions,checks,stats:{overall:rate(scored),byBias:group('bias'),byConfidence:group('confidence'),byHorizon:group('horizon_hours'),entries:rate(entries.map(r=>({hit:r.entry_good})))}};
}

type SignalRow={id:string;side:'buy'|'sell';entry:number;sl:number;adjusted_sl:number|null;signal_time:string;status:string;my_status:string};
// Returns the stored row, or null when this dedupe key was already saved (the same Telegram message forwarded twice).
export async function saveSignal(env:StoreEnv,row:Record<string,unknown>){
 const r=await rest(env,'signals?on_conflict=dedupe_key',{method:'POST',body:JSON.stringify(row),headers:{Prefer:'resolution=ignore-duplicates,return=representation'}}) as unknown[]|null;
 return r?.[0]??null;
}
// Scores open signals twice: as posted, and with Igor's session-capped SL when the signal's SL was wider.
export async function scoreSignals(env:StoreEnv,bars:Candle[]){
 if(!bars.length)return;
 const open=await rest(env,"signals?or=(status.eq.open,my_status.eq.open)&select=id,side,entry,sl,adjusted_sl,signal_time,status,my_status&limit=100",{headers:{Prefer:''}}) as SignalRow[];
 await Promise.all(open.map(s=>{
  const base={side:s.side,entry:Number(s.entry),signalTime:Date.parse(s.signal_time)};
  const theirs=scoreSignal({...base,sl:Number(s.sl)},bars), mine=s.adjusted_sl===null?theirs:scoreSignal({...base,sl:Number(s.adjusted_sl)},bars);
  const patch:Record<string,unknown>={max_pips:theirs.maxPips,tp1_at:theirs.tp1At};
  if(s.status==='open'&&theirs.status!=='open')Object.assign(patch,{status:theirs.status,result_pips:theirs.resultPips,closed_at:theirs.closedAt});
  if(s.my_status==='open'&&mine.status!=='open')Object.assign(patch,{my_status:mine.status,my_result_pips:mine.resultPips,my_closed_at:mine.closedAt});
  return rest(env,'signals?id=eq.'+s.id,{method:'PATCH',body:JSON.stringify(patch)});
 }));
}
type Closed={status:string;result_pips:number|null;my_status:string;my_result_pips:number|null};
export async function signalHistory(env:StoreEnv){
 const [list,closed]=await Promise.all([
  rest(env,'signals?select=id,created_at,source,side,entry,sl,tps,signal_time,session,sl_pips,adjusted_sl,checks,status,max_pips,result_pips,my_status,my_result_pips&order=signal_time.desc&limit=30',{headers:{Prefer:''}}),
  rest(env,'signals?select=status,result_pips,my_status,my_result_pips&order=signal_time.desc&limit=1000',{headers:{Prefer:''}}),
 ]) as [unknown[],Closed[]];
 // TP1 then a stop at break-even is a win by the partner's own rule, so "SL" only counts stops before TP1.
 const stats=(pick:(r:Closed)=>[string,number|null])=>{
  const rows=closed.map(pick).filter(([s])=>s!=='open');
  const by=(k:string)=>rows.filter(([s])=>s===k).length;
  return {closed:rows.length,sl:by('sl'),tp1:by('tp1'),tp2:by('tp2'),tp3:by('tp3'),expired:by('expired'),pips:Math.round(rows.reduce((a,[,p])=>a+(p??0),0))};
 };
 return {list,stats:{theirs:stats(r=>[r.status,r.result_pips]),mine:stats(r=>[r.my_status,r.my_result_pips])}};
}
