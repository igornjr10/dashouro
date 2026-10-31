import {crtSetups} from './crt';
import {indicators,intraday,intradayLevels,type Candle} from './indicators';
import {gauge,pressure} from './sentiment';

// Bitcoin read-only view from Coinbase Exchange public candles: free, no key, real traded volume, and no Twelve Data
// credits (the gold feeds already use about half of the free daily quota). 300 bars per request.
const BASE='https://api.exchange.coinbase.com/products/BTC-USD';
const UA='Aurum dashboard (personal; https://dashouro-sigma.vercel.app)';

// Coinbase refuses some cloud addresses (HTTP 403 from Vercel), so Kraken and then Bitstamp (both BTC/USD spot with
// real volume, public, no key) take over; the response names the exchange actually used.
type Src={name:string;pair:string;url:string};
export const SOURCES:Record<'coinbase'|'kraken'|'bitstamp',Src>={
 coinbase:{name:'Coinbase',pair:'BTC-USD',url:'https://exchange.coinbase.com/trade/BTC-USD'},
 kraken:{name:'Kraken',pair:'XBT/USD',url:'https://pro.kraken.com/app/trade/btc-usd'},
 bitstamp:{name:'Bitstamp',pair:'BTC/USD',url:'https://www.bitstamp.net/markets/btc/usd/'},
};
const getJson=async(url:string,name:string)=>{const r=await fetch(url,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(name+' respondeu HTTP '+r.status);return r.json()};
const raw:Record<keyof typeof SOURCES,(g:number)=>Promise<Candle[]>>={
 // [time (s), low, high, open, close, volume], newest first.
 coinbase:async g=>(await getJson(`${BASE}/candles?granularity=${g}`,'Coinbase') as number[][]).map(([t,l,h,o,c])=>({time:t*1000,open:o,high:h,low:l,close:c})),
 // [time (s), open, high, low, close, vwap, volume, count] as strings, oldest first, up to 720 bars.
 kraken:async g=>{const j=await getJson(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${g/60}`,'Kraken') as {error:string[];result:Record<string,(string|number)[][]>};if(j.error?.length)throw new Error('Kraken: '+j.error[0]);const rows=Object.entries(j.result).find(([k])=>k!=='last')?.[1]??[];return rows.slice(-300).map(([t,o,h,l,c])=>({time:Number(t)*1000,open:Number(o),high:Number(h),low:Number(l),close:Number(c)}))},
 bitstamp:async g=>(await getJson(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=${g}&limit=300`,'Bitstamp') as {data:{ohlc:{timestamp:string;open:string;high:string;low:string;close:string}[]}}).data.ohlc.map(b=>({time:Number(b.timestamp)*1000,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)})),
};
// Completed, well-formed bars only, oldest first.
function clean(rows:Candle[],g:number){
 const now=Date.now();
 return rows.filter(b=>Number.isFinite(b.time)&&b.time+g*1000<=now&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)).sort((a,b)=>a.time-b.time);
}
// The exchange that answered last is tried first, so M5, M15 and H1 normally come from the same one.
let preferred:keyof typeof SOURCES='coinbase';
async function series(g:300|900|3600):Promise<{bars:Candle[];src:keyof typeof SOURCES}>{
 const order=[preferred,...(['coinbase','kraken','bitstamp'] as const).filter(k=>k!==preferred)];
 const errors:string[]=[];
 for(const k of order){
  try{const bars=clean(await raw[k](g),g);if(bars.length<60)throw new Error(SOURCES[k].name+' sem candles suficientes');preferred=k;return {bars,src:k}}
  catch(e){errors.push(e instanceof Error?e.message:String(e))}
 }
 throw new Error('Sem candles de BTC: '+errors.join('; '));
}

const nextClose=()=>Math.floor(Date.now()/300000)*300000+320000;
let cache:{until:number;data:unknown}|null=null;
export async function getBtcCandles(){
 if(cache&&Date.now()<cache.until)return cache.data;
 const m5s=await series(300);
 const [m15,h1,fearGreed]=await Promise.all([series(900).then(r=>r.bars).catch(()=>null),series(3600).then(r=>r.bars).catch(()=>null),getFearGreed().catch(()=>null)]);
 const m5=m5s.bars, src=SOURCES[m5s.src];
 const day=h1?intraday(h1,m5):null, ind=indicators(m5);
 ind.levels={...ind.levels,...intradayLevels(day)};
 const last=m5.at(-1)!;
 const data={candles:m5,indicators:ind,intraday:day,chart:{m15,h1},crt:crtSetups(m5,Date.now(),false).slice(-3),
  sentiment:{m5:gauge(m5),h1:h1?gauge(h1):null,pressure:pressure(m5)},fearGreed,
  updatedAt:new Date(last.time+300000).toISOString(),stale:Date.now()-(last.time+300000)>600000,
  source:`${src.name} · ${src.pair} · M5`,url:src.url,asset:'btc',exchange:src.name,
  note:`Candles fechados da ${src.name} (volume real negociado nessa bolsa). Leitura de mercado: as regras de SL/TP do ouro não se aplicam ao Bitcoin.`};
 cache={until:nextClose(),data};
 return data;
}

// Crypto Fear & Greed index (alternative.me): daily retail-sentiment score 0–100 built from volatility, volume,
// social media and dominance. Cached for an hour; the index itself only updates once a day.
let fgCache:{at:number;data:unknown}|null=null;
export async function getFearGreed(){
 if(fgCache&&Date.now()-fgCache.at<3_600_000)return fgCache.data;
 const r=await fetch('https://api.alternative.me/fng/?limit=2',{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('alternative.me respondeu HTTP '+r.status);
 const j=await r.json() as {data?:{value:string;value_classification:string;timestamp:string}[]};
 const [now,prev]=j.data??[];
 if(!now||!Number.isFinite(Number(now.value)))throw new Error('Índice Medo e Ganância indisponível');
 const pt:Record<string,string>={'Extreme Fear':'Medo extremo','Fear':'Medo','Neutral':'Neutro','Greed':'Ganância','Extreme Greed':'Ganância extrema'};
 const data={value:Number(now.value),label:pt[now.value_classification]??now.value_classification,previous:prev?Number(prev.value):null,date:new Date(Number(now.timestamp)*1000).toISOString(),source:'alternative.me · Crypto Fear & Greed',url:'https://alternative.me/crypto/fear-and-greed-index/'};
 fgCache={at:Date.now(),data};
 return data;
}

// Last trade; same fallback order as the candles. Kraken's ticker carries no timestamp, so its time is the fetch time.
export async function getBtcQuote(){
 const tries:[keyof typeof SOURCES,()=>Promise<{price:number;t:number}>][]=[
  ['coinbase',async()=>{const j=await getJson(`${BASE}/ticker`,'Coinbase') as {price?:string;time?:string};return {price:Number(j.price),t:Date.parse(j.time??'')}}],
  ['bitstamp',async()=>{const j=await getJson('https://www.bitstamp.net/api/v2/ticker/btcusd/','Bitstamp') as {last?:string;timestamp?:string};return {price:Number(j.last),t:Number(j.timestamp)*1000}}],
  ['kraken',async()=>{const j=await getJson('https://api.kraken.com/0/public/Ticker?pair=XBTUSD','Kraken') as {error:string[];result:Record<string,{c:string[]}>};const v=Object.values(j.result??{})[0];return {price:Number(v?.c?.[0]),t:Date.now()}}],
 ];
 const errors:string[]=[];
 for(const [k,get] of tries){
  try{
   const {price,t}=await get(), src=SOURCES[k];
   if(!(price>0)||!Number.isFinite(t))throw new Error('Cotação de BTC inválida ('+src.name+')');
   return {price,updatedAt:new Date(t).toISOString(),stale:Date.now()-t>120000,source:src.name,url:src.url,unit:'USD',kind:`Último negócio na ${src.name}; não é o preço da sua corretora`};
  }catch(e){errors.push(e instanceof Error?e.message:String(e))}
 }
 throw new Error('Sem cotação de BTC: '+errors.join('; '));
}
