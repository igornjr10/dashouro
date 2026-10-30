import type {Candle} from './indicators';

// Technical summary in the style of a "buy/sell gauge": each moving average and oscillator votes buy, sell or neutral
// on completed bars, and the vote balance gives the label. Pure arithmetic on the provider's candles; nothing is estimated.
type Vote='compra'|'venda'|'neutro';
type Signal={name:string;value:number;vote:Vote};
const round=(v:number,d=2)=>Math.round(v*10**d)/10**d;
const sma=(v:number[],n:number)=>v.slice(-n).reduce((a,b)=>a+b,0)/n;
function emaSeries(v:number[],n:number){let e=v.slice(0,n).reduce((a,b)=>a+b,0)/n;const out=[e];for(const x of v.slice(n)){e=x*2/(n+1)+e*(1-2/(n+1));out.push(e)}return out}
function rsi(c:number[],n=14){let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n}return l===0?100:100-100/(1+g/l)}
// Slow %K: the average of the last k fast %K values, each over an n-bar window.
function stoch(b:Candle[],n=14,k=3){
 let sum=0;
 for(let j=0;j<k;j++){const end=b.length-j, w=b.slice(end-n,end), hi=Math.max(...w.map(x=>x.high)), lo=Math.min(...w.map(x=>x.low));sum+=hi===lo?50:(w.at(-1)!.close-lo)/(hi-lo)*100}
 return sum/k;
}
function adx(b:Candle[],n=14){
 const tr:number[]=[],pdm:number[]=[],mdm:number[]=[];
 for(let i=1;i<b.length;i++){const up=b[i].high-b[i-1].high,dn=b[i-1].low-b[i].low;tr.push(Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close)));pdm.push(up>dn&&up>0?up:0);mdm.push(dn>up&&dn>0?dn:0)}
 const smooth=(v:number[])=>{let s=v.slice(0,n).reduce((a,x)=>a+x,0);const out=[s];for(const x of v.slice(n)){s=s-s/n+x;out.push(s)}return out};
 const t=smooth(tr),p=smooth(pdm),m=smooth(mdm);
 const pdi=p.map((x,i)=>100*x/t[i]),mdi=m.map((x,i)=>100*x/t[i]),dx=pdi.map((x,i)=>x+mdi[i]===0?0:100*Math.abs(x-mdi[i])/(x+mdi[i]));
 let a=dx.slice(0,n).reduce((s,x)=>s+x,0)/n; for(const x of dx.slice(n))a=(a*(n-1)+x)/n;
 return {adx:a,pdi:pdi.at(-1)!,mdi:mdi.at(-1)!};
}
const label=(score:number)=>score>=0.5?'Compra forte':score>=0.1?'Compra':score<=-0.5?'Venda forte':score<=-0.1?'Venda':'Neutro';
const tally=(s:Signal[])=>{const buy=s.filter(x=>x.vote==='compra').length,sell=s.filter(x=>x.vote==='venda').length;return {buy,sell,neutral:s.length-buy-sell,score:s.length?round((buy-sell)/s.length):0}};

export function gauge(b:Candle[]){
 if(b.length<35)return null;
 const c=b.map(x=>x.close), last=c.at(-1)!;
 const maVote=(v:number):Vote=>Math.abs(last-v)<last*0.00005?'neutro':last>v?'compra':'venda';
 const mas:Signal[]=[];
 for(const n of [5,10,20,50,100,200])if(c.length>=n){const s=sma(c,n),e=emaSeries(c,n).at(-1)!;mas.push({name:`MM${n} simples`,value:round(s),vote:maVote(s)},{name:`MM${n} exponencial`,value:round(e),vote:maVote(e)})}
 const r=rsi(c), st=stoch(b), e12=emaSeries(c,12), e26=emaSeries(c,26);
 const macdLine=e12.slice(-e26.length).map((x,i)=>x-e26[i]), macd=macdLine.at(-1)!, signal=emaSeries(macdLine,9).at(-1)!;
 const tp=b.map(x=>(x.high+x.low+x.close)/3), tp20=tp.slice(-20), mtp=tp20.reduce((a,x)=>a+x,0)/20, md=tp20.reduce((a,x)=>a+Math.abs(x-mtp),0)/20, cci=md===0?0:(tp.at(-1)!-mtp)/(0.015*md);
 const w=b.slice(-14), hi=Math.max(...w.map(x=>x.high)), lo=Math.min(...w.map(x=>x.low)), wr=hi===lo?-50:(hi-last)/(hi-lo)*-100;
 const roc=(last/c.at(-11)!-1)*100, ad=adx(b), e13=emaSeries(c,13).at(-1)!, power=b.at(-1)!.high-e13+(b.at(-1)!.low-e13);
 const band=(v:number,buy:number,sell:number):Vote=>v>buy?'compra':v<sell?'venda':'neutro';
 const osc:Signal[]=[
  {name:'RSI (14)',value:round(r),vote:band(r,55,45)},
  {name:'Estocástico (14,3)',value:round(st),vote:band(st,55,45)},
  {name:'MACD (12,26,9)',value:round(macd-signal,3),vote:macd>signal?'compra':macd<signal?'venda':'neutro'},
  {name:'CCI (20)',value:round(cci),vote:band(cci,100,-100)},
  {name:'Williams %R (14)',value:round(wr),vote:band(wr,-45,-55)},
  {name:'ROC (10)',value:round(roc,3),vote:band(roc,0.01,-0.01)},
  {name:'ADX (14)',value:round(ad.adx),vote:ad.adx<20?'neutro':ad.pdi>ad.mdi?'compra':'venda'},
  {name:'Força touro/urso (13)',value:round(power),vote:band(power,0,0)},
 ];
 const m=tally(mas), o=tally(osc), all=tally([...mas,...osc]);
 return {summary:{...all,label:label(all.score)},movingAverages:{...m,label:label(m.score),items:mas},oscillators:{...o,label:label(o.score),items:osc}};
}

// Buying vs selling pressure from where each candle closed inside its range (no volume exists for spot gold).
export function pressure(b:Candle[],n=24){
 const w=b.slice(-n); let buy=0,sell=0,up=0;
 for(const x of w){const r=x.high-x.low;if(r>0){buy+=(x.close-x.low)/r;sell+=(x.high-x.close)/r}if(x.close>x.open)up++}
 const total=buy+sell;
 return {bars:w.length,buyPct:total?Math.round(buy/total*100):50,sellPct:total?Math.round(sell/total*100):50,bullishCandles:up,bearishCandles:w.filter(x=>x.close<x.open).length};
}
