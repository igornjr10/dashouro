'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
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
type LW=typeof import('lightweight-charts');
type Api={lw:LW;chart:import('lightweight-charts').IChartApi;price:import('lightweight-charts').ISeriesApi<'Candlestick'>;ema20:import('lightweight-charts').ISeriesApi<'Line'>;ema50:import('lightweight-charts').ISeriesApi<'Line'>;sess:import('lightweight-charts').ISeriesApi<'Histogram'>;band:import('lightweight-charts').ISeriesApi<'Histogram'>;ev:import('lightweight-charts').ISeriesApi<'Histogram'>;evMarks:import('lightweight-charts').ISeriesMarkersPluginApi<import('lightweight-charts').Time>;priceMarks:import('lightweight-charts').ISeriesMarkersPluginApi<import('lightweight-charts').Time>;lines:import('lightweight-charts').IPriceLine[]};
type Bar=Candle&{live?:boolean};

// Our own chart: the exact candles, levels, predictions and plan the AI and the rules work with, on one price scale.
// The chart is created once and its series are updated in place, so new candles keep the user's zoom and scroll.
export function MarketChart({series,levels,insight,predictions,events,plan,live}:{series:Record<Tf,Candle[]|null>;levels:Levels|null;insight:Insight|null;predictions:Prediction[];events:CalEvent[];plan:ChartPlan|null;live:{price:number;time:number}|null}){
 const box=useRef<HTMLDivElement>(null), api=useRef<Api|null>(null), shownTf=useRef<Tf|null>(null), bars=useRef(new Map<number,Bar>());
 const [ready,setReady]=useState(false),[tf,setTf]=useState<Tf>('5'),[on,setOn]=useState<Record<Layer,boolean>>(DEFAULT_ON),[hover,setHover]=useState<Bar|null>(null),[liveSeen,setLiveSeen]=useState<{key:string;high:number;low:number}|null>(null);
 // Mount-time read of this browser's layer choices.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setOn(loadLayers());try{const t=localStorage.getItem('aurum-chart-tf');if(t==='5'||t==='15'||t==='60')setTf(t)}catch{}},[]);
 const toggle=(k:Layer)=>setOn(o=>{const n={...o,[k]:!o[k]};try{localStorage.setItem('aurum-chart-layers',JSON.stringify(n))}catch{}return n});
 const pickTf=(t:Tf)=>{setTf(t);try{localStorage.setItem('aurum-chart-tf',t)}catch{}};
 const candles=useMemo(()=>series[tf]??[],[series,tf]), step=TF_MS[tf], m5=series['5'];

 // Forming bar for the current slot: closed M5 bars already inside the slot plus the Gold API quotes seen while the page is open.
 const liveBar=useMemo<Bar|null>(()=>{
  const last=candles.at(-1); if(!live||!last)return null;
  const slot=Math.floor(live.time/step)*step; if(slot<=last.time)return null;
  const inside=(m5??[]).filter(b=>b.time>=slot&&b.time<slot+step);
  const seen=liveSeen?.key===tf+':'+slot?liveSeen:null;
  const high=Math.max(live.price,...inside.map(b=>b.high),seen?.high??-Infinity), low=Math.min(live.price,...inside.map(b=>b.low),seen?.low??Infinity);
  return {time:slot,open:inside[0]?.open??last.close,high,low,close:live.price,live:true};
 },[live,candles,step,tf,m5,liveSeen]);
 // Remembers the highest and lowest quote seen in the current slot, so the forming wick does not shrink between quotes.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(!live)return;const key=tf+':'+Math.floor(live.time/step)*step;setLiveSeen(s=>s?.key===key?{key,high:Math.max(s.high,live.price),low:Math.min(s.low,live.price)}:{key,high:live.price,low:live.price})},[live,tf,step]);

 // Create the chart once.
 useEffect(()=>{
  const el=box.current; if(!el)return; let cancelled=false;
  import('lightweight-charts').then(lw=>{
   if(cancelled)return;
   const {createChart,createSeriesMarkers,CandlestickSeries,LineSeries,HistogramSeries,CrosshairMode}=lw;
   const chart=createChart(el,{autoSize:true,
    layout:{background:{color:'#111516'},textColor:'#87918e',fontSize:11},
    grid:{vertLines:{color:'rgba(255,255,255,0.03)'},horzLines:{color:'rgba(255,255,255,0.03)'}},
    crosshair:{mode:CrosshairMode.Normal},
    rightPriceScale:{borderColor:'#252c2b',scaleMargins:{top:0.08,bottom:0.08}},
    timeScale:{borderColor:'#252c2b',timeVisible:true,secondsVisible:false,rightOffset:6,tickMarkFormatter:(t:number)=>fmtTime(t,{hour:'2-digit',minute:'2-digit'})},
    localization:{locale:'pt-BR',timeFormatter:(t:number)=>fmtTime(t,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
   });
   const hidden={priceLineVisible:false,lastValueVisible:false};
   const sess=chart.addSeries(HistogramSeries,{priceScaleId:'sess',...hidden});
   const band=chart.addSeries(HistogramSeries,{priceScaleId:'band',color:'rgba(216,184,117,0.10)',...hidden});
   const ev=chart.addSeries(HistogramSeries,{priceScaleId:'band',...hidden});
   for(const id of ['sess','band'])chart.priceScale(id).applyOptions({scaleMargins:{top:0,bottom:0},visible:false});
   const price=chart.addSeries(CandlestickSeries,{upColor:'#7ac5a7',downColor:'#c8867e',borderVisible:false,wickUpColor:'#7ac5a7',wickDownColor:'#c8867e',priceFormat:{type:'price',precision:2,minMove:0.01}});
   const line=(color:string)=>chart.addSeries(LineSeries,{color,lineWidth:1,crosshairMarkerVisible:false,...hidden});
   api.current={lw,chart,price,ema20:line('#d8b875'),ema50:line('#6f8fb8'),sess,band,ev,evMarks:createSeriesMarkers(ev,[]),priceMarks:createSeriesMarkers(price,[]),lines:[]};
   // OHLC readout follows the crosshair and falls back to the latest bar.
   chart.subscribeCrosshairMove(p=>setHover(p.time?bars.current.get(Number(p.time))??null:null));
   setReady(true);
  });
  return()=>{cancelled=true;api.current?.chart.remove();api.current=null};
 },[]);

 // Update every series in place.
 useEffect(()=>{
  const a=api.current; if(!ready||!a||!candles.length)return;
  const {LineStyle}=a.lw;
  const slot=(ms:number)=>Math.floor(ms/step)*step;
  const all:Bar[]=liveBar?[...candles,liveBar]:candles, lastOpen=all.at(-1)!.time;
  bars.current=new Map(all.map(b=>[Math.floor(b.time/1000),b]));
  const refTime=insight?.reference?Date.parse(insight.reference.time):null;
  const horizonEnd=refTime&&insight?refTime+insight.horizonHours*3600000:null;
  const upcoming=on.events?events.filter(e=>{const t=Date.parse(e.date);return t>=candles[0].time&&t<=lastOpen+4*3600000}):[];
  // Whitespace bars extend the time axis into the future so the horizon band and upcoming events have somewhere to sit.
  const futureEnd=Math.max(on.predictions&&horizonEnd||0,...upcoming.map(e=>Date.parse(e.date)),lastOpen);
  const future:{time:never}[]=[]; for(let t=lastOpen+step;t<=futureEnd+step;t+=step)future.push({time:sec(t)});

  a.price.setData([...all.map(c=>c.live?{time:sec(c.time),open:c.open,high:c.high,low:c.low,close:c.close,color:c.close>=c.open?'rgba(122,197,167,0.45)':'rgba(200,134,126,0.45)',wickColor:'rgba(232,237,235,0.5)'}:{time:sec(c.time),open:c.open,high:c.high,low:c.low,close:c.close}),...future]);
  a.ema20.setData(on.ema?emaSeries(candles,20):[]); a.ema50.setData(on.ema?emaSeries(candles,50):[]);
  a.sess.setData(on.sessions?[...all.map(c=>({time:sec(c.time),value:1,color:sessionColor(c.time)})),...future.map(f=>({time:f.time,value:1,color:sessionColor(Number(f.time)*1000)}))]:[]);
  const pts=[]; if(on.predictions&&refTime&&horizonEnd)for(let t=slot(refTime);t<horizonEnd;t+=step)pts.push({time:sec(t),value:1});
  a.band.setData(pts);
  const evSlots=upcoming.map(e=>({...e,slot:slot(Date.parse(e.date))})).sort((x,y)=>x.slot-y.slot);
  a.ev.setData([...new Map(evSlots.map(e=>[e.slot,{time:sec(e.slot),value:1,color:e.impact==='High'?'rgba(200,134,126,0.28)':'rgba(216,184,117,0.18)'}])).values()]);
  a.evMarks.setMarkers(evSlots.map(e=>({time:sec(e.slot),position:'aboveBar' as const,shape:'square' as const,size:0.6,color:e.impact==='High'?'#c8867e':'#d8b875',text:e.title.length>18?e.title.slice(0,17)+'…':e.title})));

  for(const l of a.lines)a.price.removePriceLine(l); a.lines=[];
  const lv=(p:number,title:string,color:string,style=LineStyle.Dashed,width:1|2=1)=>a.lines.push(a.price.createPriceLine({price:p,color,lineWidth:width,lineStyle:style,axisLabelVisible:true,title}));
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
  const first=candles[0].time;
  a.priceMarks.setMarkers(on.predictions?predictions.map(p=>({p,t:slot(Date.parse(p.refTime)-300000)})).filter(({t})=>t>=first&&t<=lastOpen).sort((x,y)=>x.t-y.t).map(({p,t})=>{
   const r=p.result&&p.result!=='unchecked'?(p.result.hit?' ✓':' ✗'):'';
   return p.bias==='alta'?{time:sec(t),position:'belowBar' as const,shape:'arrowUp' as const,color:'#7ac5a7',text:'Alta'+r}
    :p.bias==='baixa'?{time:sec(t),position:'aboveBar' as const,shape:'arrowDown' as const,color:'#c8867e',text:'Baixa'+r}
    :{time:sec(t),position:'aboveBar' as const,shape:'circle' as const,color:'#d8b875',text:'Neutro'+r};
  }):[]);
  // Only a timeframe change (or the first draw) moves the view; later updates keep the user's zoom and scroll.
  if(shownTf.current!==tf){
   shownTf.current=tf;
   const visible=Math.round(8*3600000/step);
   a.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,all.length-visible),to:all.length+future.length+4});
  }
 },[ready,candles,liveBar,step,tf,levels,insight,predictions,events,plan,on]);

 const bar:Bar|null=hover??liveBar??candles.at(-1)??null, change=bar?bar.close-bar.open:0;
 return <div className="own-chart-wrap">
  <div className="chart-toolbar">
   <div className="timeframes">{(['5','15','60'] as Tf[]).map(t=><button key={t} className={tf===t?'on':''} disabled={!series[t]?.length} onClick={()=>pickTf(t)}>{t==='60'?'H1':'M'+t}</button>)}</div>
   <div className="layer-toggles">{LAYERS.map(([k,l])=><button key={k} className={on[k]?'on':''} aria-pressed={on[k]} onClick={()=>toggle(k)}>{l}</button>)}</div>
  </div>
  {bar&&<div className="ohlc">{bar.live&&<span className="live-tag">AO VIVO · Gold API</span>}{fmtTime(Math.floor(bar.time/1000),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · A <b>{n2(bar.open)}</b> M <b>{n2(bar.high)}</b> m <b>{n2(bar.low)}</b> F <b className={change>=0?'green':'red'}>{n2(bar.close)}</b> <span className={change>=0?'green':'red'}>{change>=0?'+':''}{n2(change)} ({change>=0?'+':''}{Math.round(change/0.1)} pips)</span></div>}
  <div className="chart-surface own-chart" ref={box}/>
  <div className="session-legend">{on.sessions&&<><span><i style={{background:'rgba(79,154,168,0.5)'}}/>Ásia</span><span><i style={{background:'rgba(216,184,117,0.5)'}}/>Londres</span><span><i style={{background:'rgba(155,127,196,0.5)'}}/>Nova York</span></>}<span><i className="lg-live"/>Candle em formação: Gold API a cada 30 s, fora da análise da IA</span><span className="muted">horário de Brasília</span></div>
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
