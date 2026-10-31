import {crtSetups} from './crt';
import {indicators,intraday,intradayLevels,type Candle} from './indicators';
import {gauge,pressure} from './sentiment';

// Bitcoin read-only view from Coinbase Exchange public candles: free, no key, real traded volume, and no Twelve Data
// credits (the gold feeds already use about half of the free daily quota). 300 bars per request.
const BASE='https://api.exchange.coinbase.com/products/BTC-USD';
const UA='Aurum dashboard (personal; https://dashouro-sigma.vercel.app)';

async function series(granularity:300|900|3600):Promise<Candle[]>{
 const r=await fetch(`${BASE}/candles?granularity=${granularity}`,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('Coinbase respondeu HTTP '+r.status);
 const rows=await r.json() as number[][];
 if(!Array.isArray(rows)||!rows.length)throw new Error('Coinbase sem candles de BTC');
 const now=Date.now();
 // Rows are [time (s), low, high, open, close, volume], newest first; keep completed bars only.
 return rows.map(([t,l,h,o,c])=>({time:t*1000,open:o,high:h,low:l,close:c}))
  .filter(b=>Number.isFinite(b.time)&&b.time+granularity*1000<=now&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close))
  .sort((a,b)=>a.time-b.time);
}

const nextClose=()=>Math.floor(Date.now()/300000)*300000+320000;
let cache:{until:number;data:unknown}|null=null;
export async function getBtcCandles(){
 if(cache&&Date.now()<cache.until)return cache.data;
 const [m5,m15,h1,fearGreed]=await Promise.all([series(300),series(900).catch(()=>null),series(3600).catch(()=>null),getFearGreed().catch(()=>null)]);
 if(m5.length<60)throw new Error('Histórico M5 de BTC insuficiente');
 const day=h1?intraday(h1,m5):null, ind=indicators(m5);
 ind.levels={...ind.levels,...intradayLevels(day)};
 const last=m5.at(-1)!;
 const data={candles:m5,indicators:ind,intraday:day,chart:{m15,h1},crt:crtSetups(m5,Date.now(),false).slice(-3),
  sentiment:{m5:gauge(m5),h1:h1?gauge(h1):null,pressure:pressure(m5)},fearGreed,
  updatedAt:new Date(last.time+300000).toISOString(),stale:Date.now()-(last.time+300000)>600000,
  source:'Coinbase · BTC-USD · M5',url:'https://exchange.coinbase.com/trade/BTC-USD',asset:'btc',
  note:'Candles fechados da Coinbase (volume real negociado nessa bolsa). Leitura de mercado: as regras de SL/TP do ouro não se aplicam ao Bitcoin.'};
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

export async function getBtcQuote(){
 const r=await fetch(`${BASE}/ticker`,{headers:{'User-Agent':UA,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('Coinbase respondeu HTTP '+r.status);
 const j=await r.json() as {price?:string;time?:string};
 const price=Number(j.price), t=Date.parse(j.time??'');
 if(!(price>0)||!Number.isFinite(t))throw new Error('Cotação de BTC inválida');
 return {price,updatedAt:new Date(t).toISOString(),stale:Date.now()-t>120000,source:'Coinbase',url:'https://exchange.coinbase.com/trade/BTC-USD',unit:'USD',kind:'Último negócio na Coinbase; não é o preço da sua corretora'};
}
