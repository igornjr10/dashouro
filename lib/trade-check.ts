import type {Indicators,Intraday,Level} from './indicators';

export type Side='buy'|'sell';
type Check={key:string;label:string;ok:boolean;detail:string};
const names:Partial<Record<Level,string>>={high2h:'máxima 2h',low2h:'mínima 2h',highWindow:'máxima da janela M5',lowWindow:'mínima da janela M5',pdh:'máxima de ontem',pdl:'mínima de ontem',pdc:'fechamento de ontem',asiaHigh:'máxima da Ásia',asiaLow:'mínima da Ásia',londonHigh:'máxima de Londres',londonLow:'mínima de Londres'};
const round=(v:number)=>Math.round(v*100)/100;
const BLOCK_MS=30*60000, WARN_MS=4*3600000;

// Deterministic pre-trade checklist. The verdict comes only from these rules; the model may explain it but never change it.
export function checkTrade(side:Side, ind:Indicators, day:Intraday|null, events:{title:string;date:string;impact:string}[], stale:boolean, now=Date.now()){
 const buy=side==='buy', price=ind.close, atr=ind.atr14;
 // Levels closer than 0.3 ATR are where price already sits, not room or protection.
 const levels=(Object.entries(ind.levels) as [Level,number][]).filter(([k,v])=>k in names&&typeof v==='number'&&Math.abs(v-price)>=atr*0.3);
 const ahead=levels.filter(([,v])=>buy?v>price:v<price).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 // A stop inside one ATR would be hit by ordinary M5 noise, so protection levels must sit at least 1× ATR away.
 const behind=levels.filter(([,v])=>(buy?v<price:v>price)&&Math.abs(v-price)>=atr).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 const target=ahead?{level:ahead[0],name:names[ahead[0]]!,price:round(ahead[1])}:null;
 const stop=behind?{level:behind[0],name:names[behind[0]]!,price:round(behind[1])}:{level:null,name:'2× ATR',price:round(buy?price-2*atr:price+2*atr)};
 const risk=Math.abs(price-stop.price), reward=target?Math.abs(target.price-price):null, rr=reward!==null&&risk>0?round(reward/risk):null;
 const want=buy?'alta':'baixa';
 const nextEvent=events.filter(e=>e.impact==='High'&&Date.parse(e.date)>now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
 const until=nextEvent?Date.parse(nextEvent.date)-now:null;
 const checks:Check[]=[
  {key:'m5',label:'Tendência M5 a favor',ok:ind.trend===want,detail:`M5 em ${ind.trend} (EMA20 ${round(ind.levels.ema20!)} · EMA50 ${round(ind.levels.ema50!)})`},
  {key:'h1',label:'Tendência H1 a favor',ok:day?.h1?.trend===want,detail:day?.h1?`H1 em ${day.h1.trend}`:'H1 indisponível'},
  {key:'momentum',label:'Momento da última hora a favor',ok:!!ind.change1h&&(buy?ind.change1h.usd>0:ind.change1h.usd<0),detail:ind.change1h?`${ind.change1h.usd>0?'+':''}${ind.change1h.usd} USD em 1h`:'sem dado'},
  {key:'rsi',label:buy?'RSI sem sobrecompra':'RSI sem sobrevenda',ok:buy?ind.rsi14<70:ind.rsi14>30,detail:`RSI 14 em ${ind.rsi14}`},
  {key:'room',label:'Espaço até o próximo nível',ok:!target||Math.abs(target.price-price)>=2*atr,detail:target?`${target.name} a ${round(Math.abs(target.price-price))} USD (${round(Math.abs(target.price-price)/atr)}× ATR)`:'nenhum nível próximo na direção'},
  {key:'rr',label:'Relação risco/retorno de pelo menos 1,5',ok:rr===null||rr>=1.5,detail:rr===null?'sem alvo técnico na janela':`${rr} (stop técnico na ${stop.name})`},
 ];
 const passed=checks.filter(c=>c.ok).length;
 const block=stale?'Candles desatualizados.':until!==null&&until<=BLOCK_MS?`${nextEvent!.title} em ${Math.ceil(until/60000)} min.`:null;
 const eventAhead=!block&&until!==null&&until<=WARN_MS;
 // A high-impact release inside the next 4h can erase any technical edge, so it caps the verdict at "ressalvas".
 const verdict=block?'nao-operar':passed>=5&&!eventAhead?'favoravel':passed>=3?'ressalvas':'desfavoravel';
 return {
  side,verdict,block,passed,total:checks.length,checks,price,atr,
  references:{stop,target,risk:round(risk),reward:reward===null?null:round(reward),rr},
  eventWarning:eventAhead?{title:nextEvent!.title,date:nextEvent!.date,minutes:Math.ceil(until/60000)}:null,
  note:'Referências técnicas a partir dos candles M5 e H1 da Twelve Data. Preço e spread da Exness podem ser diferentes. Não é ordem nem garantia de resultado.'
 };
}
export type TradeCheck=ReturnType<typeof checkTrade>;
