'use client';
import {useEffect,useRef} from 'react';
import type {Insight,Prediction} from './forecast';

type Candle={time:number;open:number;high:number;low:number;close:number};
type Levels={high2h:number;low2h:number;highWindow:number;lowWindow:number;pdh?:number;pdl?:number;pdc?:number;asiaHigh?:number;asiaLow?:number;londonHigh?:number;londonLow?:number};
type CalEvent={title:string;date:string;impact:'High'|'Medium'};
const SLOT=300000;
const sec=(ms:number)=>Math.floor(ms/1000) as never;
const fmtTime=(t:number,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',...opts}).format(new Date(t*1000));
function emaSeries(c:Candle[],n:number){
 if(c.length<n)return [];
 let e=c.slice(0,n).reduce((a,v)=>a+v.close,0)/n; const out=[{time:sec(c[n-1].time),value:e}];
 for(const v of c.slice(n)){e=v.close*2/(n+1)+e*(1-2/(n+1));out.push({time:sec(v.time),value:e})}
 return out;
}

// Our own M5 chart: the exact candles, levels and predictions the AI works with, drawn on one price scale.
export function MarketChart({candles,levels,insight,predictions,events}:{candles:Candle[];levels:Levels|null;insight:Insight|null;predictions:Prediction[];events:CalEvent[]}){
 const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const el=box.current; if(!el||!candles.length)return;
  let dispose=()=>{}; let cancelled=false;
  import('lightweight-charts').then(({createChart,createSeriesMarkers,CandlestickSeries,LineSeries,HistogramSeries,LineStyle})=>{
   if(cancelled)return;
   const chart=createChart(el,{autoSize:true,
    layout:{background:{color:'#111516'},textColor:'#87918e',fontSize:11},
    grid:{vertLines:{color:'rgba(255,255,255,0.035)'},horzLines:{color:'rgba(255,255,255,0.035)'}},
    rightPriceScale:{borderColor:'#252c2b'},
    timeScale:{borderColor:'#252c2b',timeVisible:true,secondsVisible:false,rightOffset:4,tickMarkFormatter:(t:number)=>fmtTime(t,{hour:'2-digit',minute:'2-digit'})},
    localization:{locale:'pt-BR',timeFormatter:(t:number)=>fmtTime(t,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
   });
   const lastOpen=candles.at(-1)!.time;
   const refTime=insight?.reference?Date.parse(insight.reference.time):null;
   const horizonEnd=refTime&&insight?refTime+insight.horizonHours*3600000:null;
   const upcoming=events.filter(e=>{const t=Date.parse(e.date);return t>=candles[0].time&&t<=lastOpen+4*3600000});
   // Whitespace bars extend the time axis into the future so the horizon band and upcoming events have somewhere to sit.
   const futureEnd=Math.max(horizonEnd||0,...upcoming.map(e=>Date.parse(e.date)),lastOpen);
   const future:{time:never}[]=[]; for(let t=lastOpen+SLOT;t<=futureEnd;t+=SLOT)future.push({time:sec(t)});

   const band=chart.addSeries(HistogramSeries,{priceScaleId:'band',color:'rgba(216,184,117,0.07)',priceLineVisible:false,lastValueVisible:false});
   chart.priceScale('band').applyOptions({scaleMargins:{top:0,bottom:0},visible:false});
   if(refTime&&horizonEnd){const pts=[];for(let t=refTime;t<horizonEnd;t+=SLOT)pts.push({time:sec(t),value:1});band.setData(pts)}

   const ev=chart.addSeries(HistogramSeries,{priceScaleId:'band',priceLineVisible:false,lastValueVisible:false});
   const evSlots=upcoming.map(e=>({...e,slot:Math.floor(Date.parse(e.date)/SLOT)*SLOT})).sort((a,b)=>a.slot-b.slot);
   ev.setData([...new Map(evSlots.map(e=>[e.slot,{time:sec(e.slot),value:1,color:e.impact==='High'?'rgba(200,134,126,0.28)':'rgba(216,184,117,0.18)'}])).values()]);
   createSeriesMarkers(ev,evSlots.map(e=>({time:sec(e.slot),position:'aboveBar' as const,shape:'square' as const,size:0.6,color:e.impact==='High'?'#c8867e':'#d8b875',text:e.title.length>18?e.title.slice(0,17)+'…':e.title})));

   const price=chart.addSeries(CandlestickSeries,{upColor:'#7ac5a7',downColor:'#c8867e',borderVisible:false,wickUpColor:'#7ac5a7',wickDownColor:'#c8867e',priceFormat:{type:'price',precision:2,minMove:0.01}});
   price.setData([...candles.map(c=>({time:sec(c.time),open:c.open,high:c.high,low:c.low,close:c.close})),...future]);
   const line=(n:number,color:string)=>chart.addSeries(LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false}).setData(emaSeries(candles,n));
   line(20,'#d8b875'); line(50,'#6f8fb8');

   if(levels){
    const lv=(p:number,title:string,color:string)=>price.createPriceLine({price:p,color,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title});
    lv(levels.high2h,'máx 2h','#7f8c86'); lv(levels.low2h,'mín 2h','#7f8c86');
    // Day levels replace the window extremes, which mostly repeat the current session range.
    if(levels.pdh===undefined){
     if(levels.highWindow!==levels.high2h)lv(levels.highWindow,'máx janela','#56605c');
     if(levels.lowWindow!==levels.low2h)lv(levels.lowWindow,'mín janela','#56605c');
    }
    const day:[keyof Levels,string,string][]=[['pdh','máx ontem','#9b7fc4'],['pdl','mín ontem','#9b7fc4'],['pdc','fech ontem','#6f5a8f'],['asiaHigh','máx Ásia','#4f9aa8'],['asiaLow','mín Ásia','#4f9aa8'],['londonHigh','máx Londres','#b08a4f'],['londonLow','mín Londres','#b08a4f']];
    for(const [k,title,color] of day){const p=levels[k];if(typeof p==='number')price.createPriceLine({price:p,color,lineWidth:1,lineStyle:LineStyle.LargeDashed,axisLabelVisible:true,title})}
   }
   if(insight?.invalidation)price.createPriceLine({price:insight.invalidation.price,color:'#e0604f',lineWidth:2,lineStyle:LineStyle.Solid,axisLabelVisible:true,title:'invalida '+insight.invalidation.condition});

   // A prediction is pinned to the last closed bar it was made on; only bars inside the window can carry a marker.
   const first=candles[0].time;
   const marks=predictions.map(p=>{const t=Date.parse(p.refTime)-SLOT;return {p,t}}).filter(({t})=>t>=first&&t<=lastOpen).sort((a,b)=>a.t-b.t).map(({p,t})=>{
    const r=p.result&&p.result!=='unchecked'?(p.result.hit?' ✓':' ✗'):'';
    return p.bias==='alta'?{time:sec(t),position:'belowBar' as const,shape:'arrowUp' as const,color:'#7ac5a7',text:'Alta'+r}
     :p.bias==='baixa'?{time:sec(t),position:'aboveBar' as const,shape:'arrowDown' as const,color:'#c8867e',text:'Baixa'+r}
     :{time:sec(t),position:'aboveBar' as const,shape:'circle' as const,color:'#d8b875',text:'Neutro'+r};
   });
   createSeriesMarkers(price,marks);
   chart.timeScale().fitContent();
   dispose=()=>chart.remove();
  });
  return()=>{cancelled=true;dispose()};
 },[candles,levels,insight,predictions,events]);
 return <div className="chart-surface own-chart" ref={box}/>;
}

type Intraday={previousDay:{high:number;low:number;close:number;date:string}|null;today:{open:number;high:number;low:number}|null;sessions:{key:string;name:string;high:number;low:number;status:string}[];h1:{trend:string;ema20:number;ema50:number;rsi14:number;change24h:number|null}|null;note:string};
const n2=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const trendClass=(t:string)=>t==='alta'?'green':t==='baixa'?'red':'gold-text';
export function DayContext({day,error}:{day:Intraday|null;error:string|null}){
 if(!day)return error?<div className="panel-note">{error}</div>:null;
 return <div className="day-context">
  {day.h1&&<div><small>Tendência H1</small><strong className={trendClass(day.h1.trend)}>{day.h1.trend}</strong><em>RSI {n2(day.h1.rsi14)}{day.h1.change24h!==null&&` · 24h ${day.h1.change24h>0?'+':''}${n2(day.h1.change24h)}`}</em></div>}
  {day.previousDay&&<div><small>Ontem ({day.previousDay.date.slice(8,10)}/{day.previousDay.date.slice(5,7)})</small><strong>{n2(day.previousDay.low)} – {n2(day.previousDay.high)}</strong><em>fechamento {n2(day.previousDay.close)}</em></div>}
  {day.sessions.map(s=><div key={s.key}><small>{s.name} · {s.status}</small><strong>{n2(s.low)} – {n2(s.high)}</strong><em>amplitude {n2(s.high-s.low)}</em></div>)}
  <p className="day-note">{day.note}</p>
 </div>;
}
