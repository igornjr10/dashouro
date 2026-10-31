import type {Indicators,Intraday,Level} from './indicators';

// Bitcoin buy/sell check: the same market checklist as gold, but distances in USD and scaled by the M5 ATR, because
// Igor's gold rules (1 pip = 0.10 USD, 30/50 pip stops, 20/50/80 targets) do not translate to BTC.
type Check={key:string;label:string;ok:boolean;detail:string};
const names:Partial<Record<Level,string>>={high2h:'máxima 2h',low2h:'mínima 2h',highWindow:'máxima da janela M5',lowWindow:'mínima da janela M5',pdh:'máxima de ontem',pdl:'mínima de ontem',pdc:'fechamento de ontem',asiaHigh:'máxima da Ásia',asiaLow:'mínima da Ásia',londonHigh:'máxima de Londres',londonLow:'mínima de Londres'};
const round=(v:number)=>Math.round(v*100)/100;
const BLOCK_MS=30*60000, AFTER_MS=15*60000, WARN_MS=4*3600000;
const usd=(v:number)=>Math.round(v).toLocaleString('pt-BR');

export function checkBtc(side:'buy'|'sell',ind:Indicators,day:Intraday|null,events:{title:string;date:string;impact:string}[],stale:boolean,now=Date.now()){
 const buy=side==='buy', price=ind.close, atr=ind.atr14, d=buy?1:-1, want=buy?'alta':'baixa';
 const levels=(Object.entries(ind.levels) as [Level,number][]).filter(([k,v])=>k in names&&typeof v==='number'&&Math.abs(v-price)>=atr*0.3);
 const ahead=levels.filter(([,v])=>buy?v>price:v<price).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 const behind=levels.filter(([,v])=>(buy?v<price:v>price)&&Math.abs(v-price)>=atr).sort((a,b)=>Math.abs(a[1]-price)-Math.abs(b[1]-price))[0];
 // Structural stop beyond the nearest protecting level (plus 10% of ATR), else 2× ATR; target the next level, else 3× ATR.
 const stopPrice=behind?behind[1]-d*atr*0.1:price-d*2*atr, stopName=behind?names[behind[0]]!:'2× ATR';
 const targetPrice=ahead?ahead[1]:price+d*3*atr, targetName=ahead?names[ahead[0]]!:'3× ATR';
 const risk=Math.abs(price-stopPrice), reward=Math.abs(targetPrice-price), rr=risk>0?round(reward/risk):null;
 const nextEvent=events.filter(e=>e.impact==='High'&&Date.parse(e.date)>now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
 const until=nextEvent?Date.parse(nextEvent.date)-now:null;
 const justOut=events.filter(e=>e.impact==='High'&&now-Date.parse(e.date)>=0&&now-Date.parse(e.date)<AFTER_MS)[0];
 const checks:Check[]=[
  {key:'m5',label:'Tendência M5 a favor',ok:ind.trend===want,detail:`M5 em ${ind.trend}`},
  {key:'h1',label:'Tendência H1 a favor',ok:day?.h1?.trend===want,detail:day?.h1?`H1 em ${day.h1.trend}`:'H1 indisponível'},
  {key:'momentum',label:'Momento da última hora a favor',ok:!!ind.change1h&&(buy?ind.change1h.usd>0:ind.change1h.usd<0),detail:ind.change1h?`${ind.change1h.usd>0?'+':''}${usd(ind.change1h.usd)} USD em 1h (${ind.change1h.pct}%)`:'sem dado'},
  {key:'rsi',label:buy?'RSI sem sobrecompra':'RSI sem sobrevenda',ok:buy?ind.rsi14<70:ind.rsi14>30,detail:`RSI 14 em ${ind.rsi14}`},
  {key:'room',label:'Espaço até o próximo nível (2× ATR)',ok:!ahead||Math.abs(ahead[1]-price)>=2*atr,detail:ahead?`${targetName} a ${usd(Math.abs(ahead[1]-price))} USD (${round(Math.abs(ahead[1]-price)/atr)}× ATR de ${usd(atr)})`:'nenhum nível próximo na direção'},
  {key:'rr',label:'Risco/retorno de pelo menos 1,5',ok:rr!==null&&rr>=1.5,detail:rr===null?'sem stop técnico':`${rr} (stop na ${stopName}, alvo na ${targetName})`},
 ];
 const passed=checks.filter(c=>c.ok).length;
 const block=stale?'Candles desatualizados.':justOut?`${justOut.title} saiu há ${Math.floor((now-Date.parse(justOut.date))/60000)} min.`:until!==null&&until<=BLOCK_MS?`${nextEvent!.title} em ${Math.ceil(until/60000)} min.`:null;
 const eventAhead=!block&&until!==null&&until<=WARN_MS;
 const verdict=block?'nao-operar':passed>=5&&!eventAhead?'favoravel':passed>=3?'ressalvas':'desfavoravel';
 return {
  side,verdict,block,passed,total:checks.length,checks,price,atr,asset:'btc' as const,
  references:{stop:{level:behind?.[0]??null,name:stopName,price:round(stopPrice),pips:Math.round(risk)},target:{level:ahead?.[0]??null,name:targetName,price:round(targetPrice)},risk:round(risk),reward:round(reward),rr},
  eventWarning:eventAhead?{title:nextEvent!.title,date:nextEvent!.date,minutes:Math.ceil(until/60000)}:null,
  note:'Bitcoin: distâncias em USD, a partir do fechamento M5 da bolsa de BTC (Coinbase, Kraken ou Bitstamp). Stop além do nível de proteção mais próximo (ou 2× ATR) e alvo no próximo nível (ou 3× ATR). As regras de pips do ouro não se aplicam. Não é ordem nem garantia de resultado.'
 };
}
