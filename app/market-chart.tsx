'use client';
import {useEffect,useRef,useState} from 'react';
import type {Insight,Prediction} from './forecast';

type Candle={time:number;open:number;high:number;low:number;close:number};
type Levels={high2h:number;low2h:number;highWindow:number;lowWindow:number;pdh?:number;pdl?:number;pdc?:number;asiaHigh?:number;asiaLow?:number;londonHigh?:number;londonLow?:number};
type CalEvent={title:string;date:string;impact:'High'|'Medium'};
export type ChartPlan={side:'buy'|'sell';entry:number;sl:number;tps:{name:string;price:number}[];layer:{from:number;to:number}|null};
type Tf='5'|'15'|'60';
const TF_MS:Record<Tf,number>={'5':300000,'15':900000,'60':3600000};
const LAYERS=[['ema','EMAs'],['levels','Níveis'],['sessions','Sessões'],['predictions','Previsões'],['events','Agenda'],['plan','Plano']] as const;
type Layer=typeof LAYERS[number][0];
const DEFAULT_ON:Record<Layer,boolean>={ema:true,levels:true,sessions:true,predictions:true,events:true,plan:true};
// Session shading uses the same UTC hours as the trading rules.
const sessionColor=(t:number)=>{const h=new Date(t).getUTCHours();return h>=13&&h<21?'rgba(155,127,196,0.07)':h>=7&&h<13?'rgba(216,184,117,0.07)':'rgba(79,154,168,0.07)'};
const sec=(ms:number)=>Math.floor(ms/1000) as never;
const fmtTime=(t:number,opts:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',...opts}).format(new Date(t*1000));
const n2=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
function emaSeries(c:Candle[],n:number){
 if(c.length<n)return [];
 let e=c.slice(0,n).reduce((a,v)=>a+v.close,0)/n; const out=[{time:sec(c[n-1].time),value:e}];
 for(const v of c.slice(n)){e=v.close*2/(n+1)+e*(1-2/(n+1));out.push({time:sec(v.time),value:e})}
 return out;
}
const loadLayers=():Record<Layer,boolean>=>{try{return {...DEFAULT_ON,...JSON.parse(localStorage.getItem('aurum-chart-layers')||'{}')}}catch{return DEFAULT_ON}};

// Our own chart: the exact candles, levels, predictions and plan the AI and the rules work with, on one price scale.
export function MarketChart({series,levels,insight,predictions,events,plan}:{series:Record<Tf,Candle[]|null>;levels:Levels|null;insight:Insight|null;predictions:Prediction[];events:CalEvent[];plan:ChartPlan|null}){
 const box=useRef<HTMLDivElement>(null);
 const [tf,setTf]=useState<Tf>('5'),[on,setOn]=useState<Record<Layer,boolean>>(DEFAULT_ON),[ohlc,setOhlc]=useState<Candle|null>(null);
 // Mount-time read of this browser's layer choices.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setOn(loadLayers());try{const t=localStorage.getItem('aurum-chart-tf');if(t==='5'||t==='15'||t==='60')setTf(t)}catch{}},[]);
 const toggle=(k:Layer)=>setOn(o=>{const n={...o,[k]:!o[k]};try{localStorage.setItem('aurum-chart-layers',JSON.stringify(n))}catch{}return n});
 const pickTf=(t:Tf)=>{setTf(t);try{localStorage.setItem('aurum-chart-tf',t)}catch{}};
 const candles=series[tf]??[], step=TF_MS[tf];
 useEffect(()=>{
  const el=box.current; if(!el||!candles.length)return;
  let dispose=()=>{}; let cancelled=false;
  import('lightweight-charts').then(({createChart,createSeriesMarkers,CandlestickSeries,LineSeries,HistogramSeries,LineStyle,CrosshairMode})=>{
   if(cancelled)return;
   const chart=createChart(el,{autoSize:true,
    layout:{background:{color:'#111516'},textColor:'#87918e',fontSize:11},
    grid:{vertLines:{color:'rgba(255,255,255,0.03)'},horzLines:{color:'rgba(255,255,255,0.03)'}},
    crosshair:{mode:CrosshairMode.Normal},
    rightPriceScale:{borderColor:'#252c2b',scaleMargins:{top:0.08,bottom:0.08}},
    timeScale:{borderColor:'#252c2b',timeVisible:true,secondsVisible:false,rightOffset:6,tickMarkFormatter:(t:number)=>fmtTime(t,{hour:'2-digit',minute:'2-digit'})},
    localization:{locale:'pt-BR',timeFormatter:(t:number)=>fmtTime(t,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
   });
   const slot=(ms:number)=>Math.floor(ms/step)*step;
   const lastOpen=candles.at(-1)!.time;
   const refTime=insight?.reference?Date.parse(insight.reference.time):null;
   const horizonEnd=refTime&&insight?refTime+insight.horizonHours*3600000:null;
   const upcoming=on.events?events.filter(e=>{const t=Date.parse(e.date);return t>=candles[0].time&&t<=lastOpen+4*3600000}):[];
   // Whitespace bars extend the time axis into the future so the horizon band and upcoming events have somewhere to sit.
   const futureEnd=Math.max(on.predictions&&horizonEnd||0,...upcoming.map(e=>Date.parse(e.date)),lastOpen);
   const future:{time:never}[]=[]; for(let t=lastOpen+step;t<=futureEnd+step;t+=step)future.push({time:sec(t)});

   if(on.sessions){
    const sess=chart.addSeries(HistogramSeries,{priceScaleId:'sess',priceLineVisible:false,lastValueVisible:false});
    chart.priceScale('sess').applyOptions({scaleMargins:{top:0,bottom:0},visible:false});
    sess.setData([...candles.map(c=>({time:sec(c.time),value:1,color:sessionColor(c.time)})),...future.map(f=>({time:f.time,value:1,color:sessionColor(Number(f.time)*1000)}))]);
   }
   const band=chart.addSeries(HistogramSeries,{priceScaleId:'band',color:'rgba(216,184,117,0.10)',priceLineVisible:false,lastValueVisible:false});
   chart.priceScale('band').applyOptions({scaleMargins:{top:0,bottom:0},visible:false});
   if(on.predictions&&refTime&&horizonEnd){const pts=[];for(let t=slot(refTime);t<horizonEnd;t+=step)pts.push({time:sec(t),value:1});band.setData(pts)}

   const ev=chart.addSeries(HistogramSeries,{priceScaleId:'band',priceLineVisible:false,lastValueVisible:false});
   const evSlots=upcoming.map(e=>({...e,slot:slot(Date.parse(e.date))})).sort((a,b)=>a.slot-b.slot);
   ev.setData([...new Map(evSlots.map(e=>[e.slot,{time:sec(e.slot),value:1,color:e.impact==='High'?'rgba(200,134,126,0.28)':'rgba(216,184,117,0.18)'}])).values()]);
   createSeriesMarkers(ev,evSlots.map(e=>({time:sec(e.slot),position:'aboveBar' as const,shape:'square' as const,size:0.6,color:e.impact==='High'?'#c8867e':'#d8b875',text:e.title.length>18?e.title.slice(0,17)+'…':e.title})));

   const price=chart.addSeries(CandlestickSeries,{upColor:'#7ac5a7',downColor:'#c8867e',borderVisible:false,wickUpColor:'#7ac5a7',wickDownColor:'#c8867e',priceFormat:{type:'price',precision:2,minMove:0.01}});
   price.setData([...candles.map(c=>({time:sec(c.time),open:c.open,high:c.high,low:c.low,close:c.close})),...future]);
   if(on.ema){const line=(n:number,color:string)=>chart.addSeries(LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false}).setData(emaSeries(candles,n));line(20,'#d8b875');line(50,'#6f8fb8')}

   const lv=(p:number,title:string,color:string,style=LineStyle.Dashed,width:1|2=1)=>price.createPriceLine({price:p,color,lineWidth:width,lineStyle:style,axisLabelVisible:true,title});
   if(on.levels&&levels){
    lv(levels.high2h,'máx 2h','#7f8c86'); lv(levels.low2h,'mín 2h','#7f8c86');
    const day:[keyof Levels,string,string][]=[['pdh','máx ontem','#9b7fc4'],['pdl','mín ontem','#9b7fc4'],['pdc','fech ontem','#6f5a8f'],['asiaHigh','máx Ásia','#4f9aa8'],['asiaLow','mín Ásia','#4f9aa8'],['londonHigh','máx Londres','#b08a4f'],['londonLow','mín Londres','#b08a4f']];
    for(const [k,title,color] of day){const p=levels[k];if(typeof p==='number')lv(p,title,color,LineStyle.LargeDashed)}
   }
   if(on.predictions&&insight?.invalidation)lv(insight.invalidation.price,'invalida '+insight.invalidation.condition,'#e0604f',LineStyle.Solid,2);
   // The buy/sell plan from the last check: entry, the session-capped SL, the TP ladder and the protection layer zone.
   if(on.plan&&plan){
    lv(plan.entry,(plan.side==='buy'?'compra':'venda')+' '+n2(plan.entry),'#e8edeb',LineStyle.Solid,1);
    lv(plan.sl,'SL','#e0604f',LineStyle.Solid,2);
    plan.tps.forEach(t=>lv(t.price,t.name,'#2fa57e',LineStyle.Solid,1));
    if(plan.layer){lv(plan.layer.from,'camada','#d8b875',LineStyle.Dotted);lv(plan.layer.to,'camada','#d8b875',LineStyle.Dotted)}
   }

   // A prediction is pinned to the bar it was made on; only bars inside the window can carry a marker.
   if(on.predictions){
    const first=candles[0].time;
    const marks=predictions.map(p=>({p,t:slot(Date.parse(p.refTime)-300000)})).filter(({t})=>t>=first&&t<=lastOpen).sort((a,b)=>a.t-b.t).map(({p,t})=>{
     const r=p.result&&p.result!=='unchecked'?(p.result.hit?' ✓':' ✗'):'';
     return p.bias==='alta'?{time:sec(t),position:'belowBar' as const,shape:'arrowUp' as const,color:'#7ac5a7',text:'Alta'+r}
      :p.bias==='baixa'?{time:sec(t),position:'aboveBar' as const,shape:'arrowDown' as const,color:'#c8867e',text:'Baixa'+r}
      :{time:sec(t),position:'aboveBar' as const,shape:'circle' as const,color:'#d8b875',text:'Neutro'+r};
    });
    createSeriesMarkers(price,marks);
   }
   // OHLC readout follows the crosshair and falls back to the last closed bar.
   const byTime=new Map(candles.map(c=>[Math.floor(c.time/1000),c]));
   chart.subscribeCrosshairMove(p=>setOhlc(p.time?byTime.get(Number(p.time))??null:null));
   // Open on the most recent ~8h so candles stay readable; scroll or zoom out for the rest.
   const visible=Math.round(8*3600000/step);
   chart.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-visible),to:candles.length+future.length+4});
   dispose=()=>chart.remove();
  });
  return()=>{cancelled=true;dispose()};
 },[candles,step,levels,insight,predictions,events,plan,on]);
 const bar=ohlc??candles.at(-1)??null, change=bar?bar.close-bar.open:0;
 return <div className="own-chart-wrap">
  <div className="chart-toolbar">
   <div className="timeframes">{(['5','15','60'] as Tf[]).map(t=><button key={t} className={tf===t?'on':''} disabled={!series[t]?.length} onClick={()=>pickTf(t)}>{t==='60'?'H1':'M'+t}</button>)}</div>
   <div className="layer-toggles">{LAYERS.map(([k,l])=><button key={k} className={on[k]?'on':''} aria-pressed={on[k]} onClick={()=>toggle(k)}>{l}</button>)}</div>
  </div>
  {bar&&<div className="ohlc">{fmtTime(Math.floor(bar.time/1000),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · A <b>{n2(bar.open)}</b> M <b>{n2(bar.high)}</b> m <b>{n2(bar.low)}</b> F <b className={change>=0?'green':'red'}>{n2(bar.close)}</b> <span className={change>=0?'green':'red'}>{change>=0?'+':''}{n2(change)} ({change>=0?'+':''}{Math.round(change/0.1)} pips)</span></div>}
  <div className="chart-surface own-chart" ref={box}/>
  {on.sessions&&<div className="session-legend"><span><i style={{background:'rgba(79,154,168,0.5)'}}/>Ásia</span><span><i style={{background:'rgba(216,184,117,0.5)'}}/>Londres</span><span><i style={{background:'rgba(155,127,196,0.5)'}}/>Nova York</span><span className="muted">horário de Brasília</span></div>}
 </div>;
}

type Intraday={previousDay:{high:number;low:number;close:number;date:string}|null;today:{open:number;high:number;low:number}|null;sessions:{key:string;name:string;high:number;low:number;status:string}[];h1:{trend:string;ema20:number;ema50:number;rsi14:number;change24h:number|null}|null;note:string};
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
