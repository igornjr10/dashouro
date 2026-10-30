import type {Indicators,Intraday,Level} from './indicators';

export type Side='buy'|'sell';
type Check={key:string;label:string;ok:boolean;detail:string};
const names:Partial<Record<Level,string>>={high2h:'máxima 2h',low2h:'mínima 2h',highWindow:'máxima da janela M5',lowWindow:'mínima da janela M5',pdh:'máxima de ontem',pdl:'mínima de ontem',pdc:'fechamento de ontem',asiaHigh:'máxima da Ásia',asiaLow:'mínima da Ásia',londonHigh:'máxima de Londres',londonLow:'mínima de Londres'};
const round=(v:number)=>Math.round(v*100)/100;
const BLOCK_MS=30*60000, WARN_MS=4*3600000, AFTER_MS=15*60000;
// Igor's gold convention: 1 pip = 0.10 USD; 1 standard lot = 100 oz, so 1 pip = 10 USD per lot.
const PIP=0.1, USD_PER_PIP_LOT=10, STOP_BUFFER=3, MIN_SL=25;
// UTC session hours, same approximation as the intraday levels; 21–24h UTC counts as Asia (Sydney/Tokyo open).
function sessionAt(now:number){const h=new Date(now).getUTCHours();return h>=13&&h<21?{key:'ny',name:'Nova York'}:h>=7&&h<13?{key:'london',name:'Londres'}:{key:'asia',name:'Ásia'}}

// Deterministic pre-trade checklist. The verdict comes only from these rules; the model may explain it but never change it.
export function checkTrade(side:Side, ind:Indicators, day:Intraday|null, events:{title:string;date:string;impact:string}[], stale:boolean, now=Date.now()){
 const buy=side==='buy', price=ind.close, atr=ind.atr14, dir=buy?1:-1;
 const at=(pips:number)=>round(price+dir*pips*PIP), pipsTo=(p:number)=>Math.round(Math.abs(p-price)/PIP);
 // Levels closer than 0.3 ATR are where price already sits, not room or protection.
 const levels=(Object.entries(ind.levels) as [Level,number][]).filter(([k,v])=>k in names&&typeof v==='number'&&Math.abs(v-price)>=atr*0.3);
 const ahead=levels.filter(([,v])=>buy?v>price:v<price).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 // A stop inside one ATR would be hit by ordinary M5 noise, so protection levels must sit at least 1× ATR away.
 const behind=levels.filter(([,v])=>(buy?v<price:v>price)&&Math.abs(v-price)>=atr).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 // User rules: SL at most 30 pips in Asia/London, 50 in New York; at least 25 so the 10–20 pip protection layer fits before it.
 const session=sessionAt(now), cap=session.key==='ny'?50:30;
 const techPips=behind?pipsTo(behind[1])+STOP_BUFFER:null;
 const slPips=techPips===null?cap:Math.min(cap,Math.max(MIN_SL,techPips));
 const stop={level:behind?.[0]??null,name:techPips===null?`limite da sessão (${cap} pips)`:techPips>cap?`limite da sessão (${cap} pips); técnico pedia ${techPips}`:techPips<MIN_SL?`mínimo de ${MIN_SL} pips (além da ${names[behind![0]]})`:`${STOP_BUFFER} pips além da ${names[behind![0]]}`,price:round(price-dir*slPips*PIP),pips:slPips};
 const tps=[{name:'TP1',pips:20,price:at(20)},{name:'TP2',pips:45,price:at(45),range:[at(40),at(50)]},{name:'TP3',pips:80,price:at(80)}];
 const target={level:null,name:'TP2 (45 pips)',price:tps[1].price};
 const risk=slPips*PIP, reward=45*PIP, rr=round(reward/risk);
 const layerTo=Math.min(20,slPips-5);
 const layer=layerTo>=10?{from:at(-10),to:at(-layerTo),avg:round(price-dir*7.5*PIP),lossAtSlPips:slPips+(slPips-15)}:null;
 const want=buy?'alta':'baixa';
 const nextEvent=events.filter(e=>e.impact==='High'&&Date.parse(e.date)>now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
 const until=nextEvent?Date.parse(nextEvent.date)-now:null;
 const aheadPips=ahead?pipsTo(ahead[1]):null;
 const checks:Check[]=[
  {key:'m5',label:'Tendência M5 a favor',ok:ind.trend===want,detail:`M5 em ${ind.trend} (EMA20 ${round(ind.levels.ema20!)} · EMA50 ${round(ind.levels.ema50!)})`},
  {key:'h1',label:'Tendência H1 a favor',ok:day?.h1?.trend===want,detail:day?.h1?`H1 em ${day.h1.trend}`:'H1 indisponível'},
  {key:'momentum',label:'Momento da última hora a favor',ok:!!ind.change1h&&(buy?ind.change1h.usd>0:ind.change1h.usd<0),detail:ind.change1h?`${ind.change1h.usd>0?'+':''}${Math.round(ind.change1h.usd/PIP)} pips em 1h`:'sem dado'},
  {key:'rsi',label:buy?'RSI sem sobrecompra':'RSI sem sobrevenda',ok:buy?ind.rsi14<70:ind.rsi14>30,detail:`RSI 14 em ${ind.rsi14}`},
  {key:'tp1',label:'Caminho livre até o TP1 (20 pips)',ok:aheadPips===null||aheadPips>=20,detail:ahead?`${names[ahead[0]]} a ${aheadPips} pips`:'nenhum nível próximo na direção'},
  {key:'stop',label:`Stop técnico cabe no limite da sessão (${cap} pips)`,ok:techPips!==null&&techPips<=cap,detail:techPips===null?'sem nível de proteção atrás do preço':`stop técnico em ${techPips} pips (${names[behind![0]]})`},
 ];
 const passed=checks.filter(c=>c.ok).length;
 // Gold spikes for several minutes after a high-impact release, so the block also covers the 15 min after it.
 const justOut=events.filter(e=>e.impact==='High'&&now-Date.parse(e.date)>=0&&now-Date.parse(e.date)<AFTER_MS).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
 const block=stale?'Candles desatualizados.':justOut?`${justOut.title} saiu há ${Math.floor((now-Date.parse(justOut.date))/60000)} min.`:until!==null&&until<=BLOCK_MS?`${nextEvent!.title} em ${Math.ceil(until/60000)} min.`:null;
 const eventAhead=!block&&until!==null&&until<=WARN_MS;
 // A high-impact release inside the next 4h can erase any technical edge, so it caps the verdict at "ressalvas".
 const verdict=block?'nao-operar':passed>=5&&!eventAhead?'favoravel':passed>=3?'ressalvas':'desfavoravel';
 return {
  side,verdict,block,passed,total:checks.length,checks,price,atr,
  references:{stop,target,risk:round(risk),reward:round(reward),rr},
  plan:{session:session.name,capPips:cap,slPips,tps,layer,usdPerPipPerLot:USD_PER_PIP_LOT,
   management:['No TP1 (20 pips), mover o SL para o ponto de equilíbrio (BE) ou conforme sua preferência.','Se a camada entrar, o BE passa a ser o preço médio das duas entradas.','Operação que bateu o TP1 e depois voltou no stop móvel não conta como SL.']},
  eventWarning:eventAhead?{title:nextEvent!.title,date:nextEvent!.date,minutes:Math.ceil(until/60000)}:null,
  note:'Regras do Igor: 1 pip = 0,10 USD; SL máx. 30 pips (Ásia/Londres) e 50 (Nova York); TP1 20, TP2 40–50, TP3 80+ pips; camada com mesmo lote e mesmo SL a 10–20 pips contra. Preços a partir do fechamento M5 da Twelve Data; o preço e o spread da Exness podem ser diferentes. Não é ordem nem garantia de resultado.'
 };
}
export type TradeCheck=ReturnType<typeof checkTrade>;
