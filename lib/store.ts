import type {Candle} from './indicators';
import type {Bias} from './indicators';
import type {TradeCheck} from './trade-check';

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

export function savePrediction(env:StoreEnv,b:Bias,ref:{price:number;time:string},model:string){
 return rest(env,'predictions',{method:'POST',body:JSON.stringify({bias:b.bias,confidence:b.confidence,horizon_hours:b.horizonHours,ref_price:ref.price,ref_time:ref.time,invalidation_level:b.invalidation?.level??null,invalidation_price:b.invalidation?.price??null,drivers:b.drivers,model})});
}
export function saveCheck(env:StoreEnv,c:TradeCheck,model?:string){
 return rest(env,'trade_checks',{method:'POST',body:JSON.stringify({side:c.side,verdict:c.verdict,passed:c.passed,total:c.total,price:c.price,stop_price:c.references.stop.price,stop_name:c.references.stop.name,target_price:c.references.target?.price??null,target_name:c.references.target?.name??null,rr:c.references.rr,block:c.block,checks:c.checks,model:model??null})});
}

type Row={id:string;created_at:string;bias:'alta'|'baixa'|'neutro';confidence:string;horizon_hours:number;ref_price:number;ref_time:string;status:string;result_price:number|null;result_move:number|null;hit:boolean|null;model:string|null;invalidation_level:string|null;invalidation_price:number|null};
// Scores pending predictions against the M5 close at horizon end. Runs whenever history is read, so any open device keeps the log current.
async function scorePending(env:StoreEnv,candles:Candle[]){
 if(!candles.length)return;
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
 const [predictions,checks,scored]=await Promise.all([
  rest(env,'predictions?select=*&order=created_at.desc&limit=50',{headers:{Prefer:''}}),
  rest(env,'trade_checks?select=id,created_at,side,verdict,passed,total,price,stop_price,stop_name,target_price,target_name,rr,block,model&order=created_at.desc&limit=30',{headers:{Prefer:''}}),
  rest(env,'predictions?status=eq.scored&select=bias,confidence,hit&order=created_at.desc&limit=1000',{headers:{Prefer:''}}),
 ]) as [Row[],unknown[],{bias:string;confidence:string;hit:boolean}[]];
 const rate=(rows:{hit:boolean}[])=>({total:rows.length,hits:rows.filter(r=>r.hit).length});
 const group=(k:'bias'|'confidence')=>Object.fromEntries([...new Set(scored.map(r=>r[k]))].map(v=>[v,rate(scored.filter(r=>r[k]===v))]));
 return {predictions,checks,stats:{overall:rate(scored),byBias:group('bias'),byConfidence:group('confidence')}};
}
