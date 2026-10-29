export type Candle = { time:number; open:number; high:number; low:number; close:number };
export const LEVELS = ['high2h','low2h','highWindow','lowWindow','ema20','ema50','pdh','pdl','pdc','asiaHigh','asiaLow','londonHigh','londonLow'] as const;
export type Level = typeof LEVELS[number];
const round = (v:number, d=2) => Math.round(v*10**d)/10**d;
function emaSeries(values:number[], n:number) {
 let e=values.slice(0,n).reduce((a,b)=>a+b,0)/n; const out:number[]=[e];
 for(const v of values.slice(n)){e=v*2/(n+1)+e*(1-2/(n+1));out.push(e)}
 return out;
}
// Wilder RSI and ATR over 14 bars, computed from completed M5 candles only.
function rsi(closes:number[], n=14) {
 let gain=0, loss=0;
 for(let i=1;i<=n;i++){const d=closes[i]-closes[i-1];if(d>0)gain+=d;else loss-=d}
 gain/=n; loss/=n;
 for(let i=n+1;i<closes.length;i++){const d=closes[i]-closes[i-1];gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n}
 return loss===0?100:100-100/(1+gain/loss);
}
function atr(c:Candle[], n=14) {
 const tr=c.slice(1).map((v,i)=>Math.max(v.high-v.low,Math.abs(v.high-c[i].close),Math.abs(v.low-c[i].close)));
 let a=tr.slice(0,n).reduce((x,y)=>x+y,0)/n; for(const v of tr.slice(n)) a=(a*(n-1)+v)/n;
 return a;
}
export function indicators(c:Candle[]) {
 const closes=c.map(v=>v.close), last=closes.at(-1)!;
 const e20=emaSeries(closes,20), e50=emaSeries(closes,50), ema20=e20.at(-1)!, ema50=e50.at(-1)!;
 const change=(bars:number)=>closes.length>bars?{usd:round(last-closes.at(-1-bars)!),pct:round((last/closes.at(-1-bars)!-1)*100,3)}:null;
 const recent=c.slice(-24);
 const levels:Record<string,number>={
  high2h:Math.max(...recent.map(v=>v.high)), low2h:Math.min(...recent.map(v=>v.low)),
  highWindow:Math.max(...c.map(v=>v.high)), lowWindow:Math.min(...c.map(v=>v.low)), ema20, ema50
 };
 const trend=ema20>ema50&&last>ema20?'alta':ema20<ema50&&last<ema20?'baixa':'misto';
 return {
  close:round(last), trend, rsi14:round(rsi(closes),1), atr14:round(atr(c)),
  ema20Slope1h:e20.length>12?round(ema20-e20.at(-13)!):null,
  change1h:change(12), change4h:change(48),
  levels:Object.fromEntries(Object.entries(levels).map(([k,v])=>[k,round(v)])) as Partial<Record<Level,number>>,
  windowHours:round(c.length*5/60,1),
  note:'Calculado no servidor a partir dos candles M5 fechados da Twelve Data. high2h/low2h = últimos 24 candles; highWindow/lowWindow = janela inteira.'
 };
}
export type Indicators = ReturnType<typeof indicators>;

// Exness server time is GMT+0, so UTC days match the broker's daily candles. Session hours are UTC approximations.
const SESSIONS=[['asia','Ásia',0,7],['london','Londres',7,13],['ny','Nova York',13,21]] as const;
type Range={high:number;low:number};
const range=(bars:Candle[]):Range|null=>bars.length?{high:round(Math.max(...bars.map(v=>v.high))),low:round(Math.min(...bars.map(v=>v.low)))}:null;
// h1: completed H1 bars; m5: completed M5 bars. M5 fills the gap after the last completed hour so today's ranges are current.
export function intraday(h1:Candle[], m5:Candle[], now=Date.now()) {
 const lastH1=h1.at(-1)?.time??0;
 const bars=[...h1,...m5.filter(v=>v.time>=lastH1+3600000)];
 const dayStart=Math.floor(now/86400000)*86400000;
 const today=bars.filter(v=>v.time>=dayStart);
 // Previous trading day: the latest UTC day before today that has bars (skips weekends).
 const prevStart=[...bars].reverse().find(v=>v.time<dayStart);
 const prevDayStart=prevStart?Math.floor(prevStart.time/86400000)*86400000:null;
 const prev=prevDayStart===null?[]:bars.filter(v=>v.time>=prevDayStart&&v.time<prevDayStart+86400000);
 const hour=(now-dayStart)/3600000;
 const sessions=SESSIONS.filter(([, , from])=>hour>=from).map(([key,name,from,to])=>{
  const r=range(today.filter(v=>v.time>=dayStart+from*3600000&&v.time<dayStart+to*3600000));
  return r&&{key,name,...r,status:hour>=to?'encerrada':'em andamento'};
 }).filter(Boolean) as {key:string;name:string;high:number;low:number;status:string}[];
 const closes=h1.map(v=>v.close);
 const h1Trend=closes.length>=50?(()=>{const e20=emaSeries(closes,20).at(-1)!,e50=emaSeries(closes,50).at(-1)!,last=closes.at(-1)!;
  return {trend:e20>e50&&last>e20?'alta':e20<e50&&last<e20?'baixa':'misto',ema20:round(e20),ema50:round(e50),rsi14:round(rsi(closes),1),change24h:closes.length>24?round(last-closes.at(-25)!):null}})():null;
 const pd=range(prev);
 return {
  previousDay:pd&&{...pd,close:round(prev.at(-1)!.close),date:new Date(prevDayStart!).toISOString().slice(0,10)},
  today:today.length?{open:round(today[0].open),...range(today)!}:null,
  sessions, h1:h1Trend,
  note:'Dias em UTC (horário do servidor Exness, GMT+0). Sessões aproximadas em UTC: Ásia 00–07h, Londres 07–13h, Nova York 13–21h. H1 da Twelve Data, apenas barras fechadas.'
 };
}
export type Intraday = ReturnType<typeof intraday>;
export function intradayLevels(d:Intraday|null):Partial<Record<Level,number>> {
 if(!d)return {};
 const s=(k:string)=>d.sessions.find(v=>v.key===k);
 return Object.fromEntries(Object.entries({pdh:d.previousDay?.high,pdl:d.previousDay?.low,pdc:d.previousDay?.close,asiaHigh:s('asia')?.high,asiaLow:s('asia')?.low,londonHigh:s('london')?.high,londonLow:s('london')?.low}).filter(([,v])=>typeof v==='number'));
}

export type Bias = {
 bias:'alta'|'baixa'|'neutro'; confidence:'baixa'|'media'|'alta'; horizonHours:number;
 drivers:{text:string;source:string}[];
 invalidation:{level:Level;condition:'acima'|'abaixo';price:number}|null;
 analysis:string;
};
const conf=['baixa','media','alta'] as const;
// Parses the model's JSON, rejects anything outside the allowed shape and resolves invalidation levels to computed prices so no number comes from the model.
export function parseBias(text:string, ind:Indicators|null, capConfidence:boolean, h1Trend?:string):Bias|null {
 const s=text.replace(/```(?:json)?/g,''); const a=s.indexOf('{'), b=s.lastIndexOf('}');
 if(a<0||b<=a)return null;
 let j:any; try{j=JSON.parse(s.slice(a,b+1))}catch{return null}
 if(!['alta','baixa','neutro'].includes(j?.bias)||!conf.includes(j?.confidence)||typeof j?.analysis!=='string'||!j.analysis.trim())return null;
 const drivers=Array.isArray(j.drivers)?j.drivers.filter((d:any)=>typeof d?.text==='string'&&d.text.trim()&&typeof d?.source==='string').slice(0,3).map((d:any)=>({text:d.text.trim(),source:d.source.trim()})):[];
 let bias:Bias['bias']=j.bias, confidence:Bias['confidence']=j.confidence;
 const horizonHours=Math.min(4,Math.max(1,Math.round(Number(j.horizonHours)||1)));
 if(!ind){bias='neutro';confidence='baixa'}
 const againstH1=(bias==='alta'&&h1Trend==='baixa')||(bias==='baixa'&&h1Trend==='alta');
 if((capConfidence||againstH1)&&confidence==='alta')confidence='media';
 let invalidation:Bias['invalidation']=null;
 const inv=j.invalidation, want=bias==='alta'?'abaixo':bias==='baixa'?'acima':null;
 if(ind&&want&&inv&&LEVELS.includes(inv.level)&&inv.condition===want){
  const price=ind.levels[inv.level as Level];
  if(typeof price==='number'&&(want==='abaixo'?price<ind.close:price>ind.close))invalidation={level:inv.level,condition:want,price};
 }
 return {bias,confidence,horizonHours,drivers,invalidation,analysis:j.analysis.trim()};
}
