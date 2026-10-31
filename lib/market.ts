import {checkRouterKey,generateInsight,requestKey,RouterError,FREE_MODEL} from './openrouter';
import {indicators,intraday,intradayLevels,parseDualBias,type Candle,type Indicators,type Intraday} from './indicators';
import {checkTrade} from './trade-check';
import {alerts,sendAlerts} from './notify';
import {authorized,claimAlert,releaseAlert,history,saveCheck,savePrediction,saveSignal,scoreSignals,signalHistory,storeEnabled,type StoreEnv} from './store';
import {parseSignal,ruleCheck} from './signals';
import {gauge,pressure} from './sentiment';
import {crtSetups} from './crt';
import {asiaSweep} from './scalp';
import {getOfficialCalendar} from './official-calendar';
import {getBtcCandles,getBtcQuote} from './btc';
import {checkBtc} from './btc-check';
import type {CallEntry} from './entry-outcome';
// Saving is best effort: a database failure never blocks the analysis the user asked for.
const persist=async(env:RuntimeEnv,request:Request,write:()=>Promise<unknown>)=>{
 if(!storeEnabled(env)||!authorized(request,env))return false;
 try{await write();return true}catch{return false}
};
export type RuntimeEnv = { OPENROUTER_API_KEY?: string; TWELVEDATA_API_KEY?: string; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_WEBHOOK_SECRET?: string; TELEGRAM_OWNER_ID?: string } & StoreEnv;
const links = {
 quote: 'https://api.gold-api.com/price/XAU',
 cot: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?' + new URLSearchParams({'$where':"cftc_contract_market_code='088691'",'$order':'report_date_as_yyyy_mm_dd DESC','$limit':'2','$select':'report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,open_interest_all'}),
 news: 'https://news.google.com/rss/search?q=gold+prices+Federal+Reserve+when:3d&hl=en-US&gl=US&ceid=US:en',
 fed: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
 btc: 'https://news.google.com/rss/search?q=bitcoin+price+OR+crypto+market+when:2d&hl=en-US&gl=US&ceid=US:en',
 calendar: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
};
async function fetchData(url:string, json=true): Promise<any> {
 let r:Response; try { r = await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:json?'application/json':'application/rss+xml,application/xml,text/xml'}}); } catch { throw new Error('Não foi possível alcançar a fonte. Tente atualizar.'); }
 if(!r.ok) throw new Error('Fonte respondeu HTTP '+r.status);
 return json ? r.json() : r.text();
}
function number(v:unknown) { if(v===null || v===undefined || v==='' || !Number.isFinite(Number(v))) throw new Error('Dado numérico inválido'); return Number(v); }
export async function getQuote() {
 const q=await fetchData(links.quote);
 if(q.symbol!=='XAU'||q.currency!=='USD'||number(q.price)<=0) throw new Error('Cotação inválida');
 const time=Date.parse(q.updatedAt); if(!Number.isFinite(time)||time>Date.now()+60000) throw new Error('Data da cotação inválida');
 return {price:q.price,updatedAt:new Date(time).toISOString(),stale:Date.now()-time>120000,source:'Gold API',url:'https://gold-api.com',unit:'USD / onça troy',kind:'Referência spot; não é o preço executável da corretora'};
}
export async function getCot() {
 const rows=await fetchData(links.cot); if(!Array.isArray(rows)||!rows.length) throw new Error('Relatório não disponível');
 const vals=rows.map(r=>({date:r.report_date_as_yyyy_mm_dd,long:number(r.m_money_positions_long_all),short:number(r.m_money_positions_short_all),openInterest:number(r.open_interest_all)}));
 const v=vals[0];const age=Date.now()-Date.parse(v.date+'Z');if(!Number.isFinite(age)||age<0||v.long<0||v.short<0)throw new Error('Relatório inválido');
 return {...v,net:v.long-v.short,delta:vals[1]?v.long-v.short-(vals[1].long-vals[1].short):null,stale:age>12*86400000,source:'CFTC · Managed Money · COMEX',url:'https://publicreporting.cftc.gov/d/72hh-3qpy',frequency:'Semanal',note:'Futuros apenas. Posições de terça, normalmente publicadas na sexta. Não representa fluxo ao vivo nem sinal M5.'};
}
function clean(s:string) {return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();}
export async function getNews(kind:'news'|'fed'|'btc') {
 const xml=await fetchData(links[kind],false); const items=[...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].slice(0,8).map(m=>{
  const tag=(s:string)=>clean(m[1].match(new RegExp('<'+s+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+s+'>','i'))?.[1]||'');
  return {title:tag('title'),url:tag('link'),date:tag('pubDate'),publisher:tag('source')||(kind==='fed'?'Federal Reserve':'Google News')};
 }).filter(i=>i.title&&/^https:\/\//.test(i.url)&&Number.isFinite(Date.parse(i.date))&&Date.parse(i.date)<=Date.now()+60000);
 if(!items.length) throw new Error('Nenhuma notícia válida retornada');
 return {items,source:kind==='fed'?'Federal Reserve':kind==='btc'?'Google News · Bitcoin e cripto':'Google News · agregador',url:kind==='fed'?'https://www.federalreserve.gov/newsevents.htm':'https://news.google.com',fetchedAt:new Date().toISOString()};
}
// Candles only change when an M5 bar closes; refetch after the next close (+20s provider latency) to protect the API quota.
const nextClose=()=>Math.floor(Date.now()/300000)*300000+320000;
let candlesCache:{until:number;data:unknown}|null=null;
async function getSeries(env:RuntimeEnv,interval:'5min'|'15min'|'1h',size:number,barMs:number):Promise<Candle[]>{
 const q=await fetchData('https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',interval,outputsize:String(size),timezone:'UTC',apikey:env.TWELVEDATA_API_KEY!}));
 if(q.status==='error'||!Array.isArray(q.values)||q.meta?.symbol!=='XAU/USD'||q.meta?.interval!==interval)throw new Error('Feed '+(interval==='1h'?'H1':interval==='15min'?'M15':'M5')+' indisponível. Verifique o acesso ao XAU/USD no provedor.');
 const candles:Candle[]=q.values.map((v:Record<string,string>)=>({time:Date.parse(v.datetime.replace(' ','T')+'Z'),open:number(v.open),high:number(v.high),low:number(v.low),close:number(v.close)})).filter((v:Candle)=>Number.isFinite(v.time)&&v.time+barMs<=Date.now()).sort((a:Candle,b:Candle)=>a.time-b.time);
 if(candles.length<50||candles.some(v=>v.low<=0||v.high<Math.max(v.open,v.close)||v.low>Math.min(v.open,v.close)))throw new Error('Histórico '+(interval==='1h'?'H1':interval==='15min'?'M15':'M5')+' insuficiente ou inválido');
 return candles;
}
// H1 bars feed the day/session levels and the higher-timeframe trend; one fetch per hour per instance (~24/day).
// M15 for the chart only, refetched after each 15-minute close (~96 calls/day).
let m15Cache:{until:number;data:Candle[]}|null=null;
async function getM15(env:RuntimeEnv){
 if(m15Cache&&Date.now()<m15Cache.until)return m15Cache.data;
 const data=await getSeries(env,'15min',200,900000);
 m15Cache={until:Math.floor(Date.now()/900000)*900000+920000,data};
 return data;
}
let h1Cache:{until:number;data:Candle[]}|null=null;
async function getH1(env:RuntimeEnv){
 if(h1Cache&&Date.now()<h1Cache.until)return h1Cache.data;
 const data=await getSeries(env,'1h',120,3600000);
 h1Cache={until:Math.floor(Date.now()/3600000)*3600000+3620000,data};
 return data;
}
export async function getCandles(env:RuntimeEnv) {
 if(!env.TWELVEDATA_API_KEY) throw new Error('Feed de candles M5 não conectado');
 if(candlesCache&&Date.now()<candlesCache.until)return candlesCache.data;
 // One credit per call regardless of size, so ~25h of M5 costs the same as 8h.
 const [candles,h1,m15]=await Promise.all([getSeries(env,'5min',300,300000),getH1(env).catch(()=>null),getM15(env).catch(()=>null)]);
 const day=h1?intraday(h1,candles):null; const ind=indicators(candles); ind.levels={...ind.levels,...intradayLevels(day)};
 const last=candles.at(-1)!;
 const data={candles,ema20:ind.levels.ema20,ema50:ind.levels.ema50,indicators:ind,intraday:day,chart:{m15,h1},crt:crtSetups(candles).slice(-3),scalp:asiaSweep(candles),sentiment:{m5:gauge(candles),h1:h1?gauge(h1):null,pressure:pressure(candles)},intradayError:h1?null:'Candles H1 indisponíveis: níveis do dia e tendência H1 fora desta análise.',updatedAt:new Date(last.time+300000).toISOString(),stale:Date.now()-(last.time+300000)>600000,source:'Twelve Data · XAU/USD · M5',url:'https://twelvedata.com',note:'Apenas candles fechados. Fonte independente do gráfico e da corretora.'};
 // If the provider has not published the bar that just closed yet, retry in 30s instead of holding stale data for 5 min.
 const behind=last.time+300000<Math.floor(Date.now()/300000)*300000;
 candlesCache={until:behind?Date.now()+30000:nextClose(),data};
 return data;
}
// The aggregator asks clients to poll sparingly; one fetch per instance every 15 minutes.
let calendarCache:{at:number;data:unknown}|null=null;
// Official BLS/BEA/Fed releases first; the aggregator only fills what the official calendars do not cover (Census
// retail sales, ISM, jobless claims...) and anything at the same minute as an official release is dropped as a duplicate.
export async function getCalendar() {
 if(calendarCache&&Date.now()-calendarCache.at<900000)return calendarCache.data;
 const [agg,off]=await Promise.all([fetchData(links.calendar).catch(()=>null),getOfficialCalendar().catch(()=>null)]);
 if(!Array.isArray(agg)&&!off)throw new Error('Agenda indisponível');
 const now=Date.now();
 const official=(off?.events??[]).filter(e=>{const t=Date.parse(e.date);return t>=now-2*86400000&&t<=now+14*86400000}).map(e=>({title:e.title,date:e.date,impact:e.impact,forecast:'',previous:'',official:true,source:e.source,url:e.url}));
 const aggregator=(Array.isArray(agg)?agg:[]).filter(r=>r?.country==='USD'&&(r.impact==='High'||r.impact==='Medium')&&typeof r.title==='string'&&Number.isFinite(Date.parse(r.date)))
  .map(r=>({title:String(r.title),date:new Date(Date.parse(r.date)).toISOString(),impact:r.impact as 'High'|'Medium',forecast:typeof r.forecast==='string'?r.forecast:'',previous:typeof r.previous==='string'?r.previous:'',official:false,source:'agregador',url:'https://www.forexfactory.com/calendar'}))
  .filter(e=>!official.some(o=>Math.abs(Date.parse(o.date)-Date.parse(e.date))<10*60000));
 const events=[...official,...aggregator].sort((x,y)=>Date.parse(x.date)-Date.parse(y.date));
 const st=off?.sources??{};
 const data={events,sources:st,source:'Oficial: BLS, BEA e Fed · complemento: ForexFactory (agregador)',url:'https://www.bls.gov/schedule/news_release/',fetchedAt:new Date().toISOString(),
  verified:!!(st.BLS?.ok&&st.BEA?.ok&&st.Fed?.ok),
  note:'Horários oficiais do BLS (CPI, Payroll, PPI, JOLTS), BEA (PIB, PCE, balança) e Fed (FOMC). Os demais eventos vêm de agregador não oficial, sem valores realizados.'+(Object.entries(st).filter(([,v])=>!v.ok).map(([k,v])=>' '+k+' indisponível ('+v.error+').').join(''))};
 calendarCache={at:Date.now(),data};
 return data;
}
const CALL=`{"bias":"alta"|"baixa"|"neutro","confidence":"baixa"|"media"|"alta","drivers":[{"text":"motivo curto","source":"fonte e data"}],"invalidation":{"level":"<uma chave de candlesM5.indicators.levels>","condition":"acima"|"abaixo"}|null}`;
const PROMPT=`Escreva TODO o texto (analysis e drivers) em português do Brasil, nunca em inglês. Você é analista de contexto do ouro (XAU/USD) para Igor, que opera scalping e day trade. Responda SOMENTE com um objeto JSON válido, sem nenhum texto fora dele, no formato {"short":${CALL},"long":${CALL},"analysis":"texto"}.
São duas leituras independentes do viés de direção mais provável, nenhuma é sinal de entrada:
- short = próxima 1 hora (scalping). Baseie-o principalmente no curto prazo: candlesM5.indicators (trend, rsi14, ema20Slope1h, change1h, atr14), candlesM5.sentiment.m5 e candlesM5.sentiment.pressure (últimos 24 candles M5), e a distância até os níveis mais próximos. Um repique ou uma correção contra a tendência H1 deve aparecer aqui quando o M5 e o momento de 1h mostrarem isso; não copie a tendência do H1.
- long = próximas 4 horas (day trade). Baseie-o principalmente em candlesM5.intraday.h1, candlesM5.sentiment.h1, change4h, previousDay, today e sessions (faixas de Ásia, Londres e Nova York de hoje).
Os dois podem discordar, e isso é informação útil: diga na análise quando discordam e por quê.
Calibração de cada um: se os sinais do seu prazo conflitarem ou candlesM5.indicators for null, use "neutro" com confiança "baixa". short só tem confiança "alta" quando trend, ema20Slope1h, change1h, sentiment.m5 e pressure apontarem para o mesmo lado e o rsi14 estiver entre 25 e 75; contra a tendência M5 a confiança máxima é "media". long só tem confiança "alta" quando h1.trend, sentiment.h1, change4h e trend concordarem; contra a tendência H1 a confiança máxima é "media". Se highImpactUsdWithin1h for true, o short tem confiança máxima "media"; se highImpactUsdWithin4h for true, o long também, e o evento deve aparecer nos drivers.
drivers: até 3 por leitura, do mais forte para o mais fraco, cada um com fonte e data. invalidation: para alta, condition "abaixo" e um nível abaixo do preço; para baixa, "acima" e um nível acima; para neutro, null. Informe só a chave do nível, nunca um preço; para o short prefira níveis próximos (high2h, low2h, ema20).
analysis: português, até 160 palavras, quatro parágrafos curtos separados por linha em branco: Contexto, Evidências (1h e 4h), Cenários condicionais e Lacunas. Cada driver com no máximo 15 palavras. Diga onde o preço está em relação aos níveis do dia. COT é semanal de futuros e notícias são só manchetes: contexto secundário. Cite fonte e data em cada conclusão factual. Use apenas números presentes nos dados anexados; não invente preços, eventos, consenso, probabilidades, fluxo, suportes ou resistências. Na agenda, eventos com official=true vêm do BLS, BEA ou Fed (horários oficiais); os demais vêm de agregador não oficial. Use a agenda para alertar eventos USD próximos. Não recomende compra, venda, entrada, stop ou alvo. A cotação spot não é preço executável. Não alegue acesso visual ao TradingView. Termine lembrando de validar spread e condições na corretora.`;
const CHECK_PROMPT=`Escreva TODO o texto em português do Brasil, nunca em inglês. Você explica para Igor a avaliação de uma operação em XAU/USD que ele está considerando (check.side: buy = compra, sell = venda). O veredito em check.verdict foi calculado por regras fixas e NÃO pode ser alterado nem contestado: favoravel, ressalvas, desfavoravel ou nao-operar. Responda SOMENTE com JSON válido: {"summary":"uma frase em português explicando o veredito","pros":["até 3 pontos a favor"],"cons":["até 3 pontos contra ou riscos"],"context":"até 80 palavras sobre notícias, Fed e COT que reforçam ou enfraquecem a operação, citando fonte e data"}.
Use só números presentes nos dados. Não invente preços, alvos, probabilidades ou eventos. Não diga para comprar nem vender: descreva os fatores e deixe a decisão com ele. Notícias são só manchetes; COT é semanal; na agenda, official=true é horário oficial (BLS/BEA/Fed) e o resto é agregador. Se check.eventWarning existir, ele deve aparecer em cons.
Igor opera scalping e day trade com regras próprias, já aplicadas em check.plan: 1 pip = 0,10 USD; SL máximo de 30 pips na Ásia e em Londres e 50 em Nova York; TP1 20, TP2 40–50 e TP3 80+ pips; camada de proteção com mesmo lote e mesmo SL quando a operação está 10–20 pips contra; no TP1 o SL vai para o ponto de equilíbrio. Fale em pips, use os preços de check.plan e aponte em cons se o stop técnico não coube no limite da sessão, se há um nível antes do TP1, ou se o prejuízo com a camada (check.plan.layer.lossAtSlPips) for alto.`;
function parseExplanation(text:string){
 const s=text.replace(/```(?:json)?/g,''); const a=s.indexOf('{'), b=s.lastIndexOf('}');
 try{
  const j=JSON.parse(s.slice(a,b+1)); const list=(v:unknown)=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).slice(0,3):[];
  if(typeof j.summary!=='string')return null;
  return {summary:j.summary.trim(),pros:list(j.pros),cons:list(j.cons),context:typeof j.context==='string'?j.context.trim():''};
 }catch{return null}
}
type Sentiment={m5:ReturnType<typeof gauge>;h1:ReturnType<typeof gauge>;pressure:ReturnType<typeof pressure>};
// The model gets only the labels and counts, not every indicator value.
const summarize=(s:Sentiment)=>({m5:s.m5&&{label:s.m5.summary.label,buy:s.m5.summary.buy,sell:s.m5.summary.sell,neutral:s.m5.summary.neutral},h1:s.h1&&{label:s.h1.summary.label,buy:s.h1.summary.buy,sell:s.h1.summary.sell,neutral:s.h1.summary.neutral},pressure:s.pressure});
// Bitcoin variants of the two prompts: same structure and rules, BTC context (no COT, Fear & Greed instead), USD distances.
const BTC_PROMPT=PROMPT.replace('analista de contexto do ouro (XAU/USD)','analista de contexto do Bitcoin (BTC/USD)')
 .replace('COT é semanal de futuros e notícias são só manchetes: contexto secundário.','Notícias são só manchetes e fearGreed (índice Medo e Ganância da alternative.me, 0 a 100, diário) é sentimento de varejo: contexto secundário. O Bitcoin negocia 24 horas, inclusive no fim de semana; distâncias em USD.')
 .replace('A cotação spot não é preço executável.','A cotação é o último negócio na Coinbase, não o preço da corretora.');
const BTC_CHECK_PROMPT=`Escreva TODO o texto em português do Brasil, nunca em inglês. Você explica para Igor a avaliação de uma operação em BTC/USD que ele está considerando (check.side: buy = compra, sell = venda). O veredito em check.verdict foi calculado por regras fixas e NÃO pode ser alterado nem contestado: favoravel, ressalvas, desfavoravel ou nao-operar. Responda SOMENTE com JSON válido: {"summary":"uma frase em português explicando o veredito","pros":["até 3 pontos a favor"],"cons":["até 3 pontos contra ou riscos"],"context":"até 80 palavras sobre notícias de Bitcoin e cripto, o índice Medo e Ganância (fearGreed) e a agenda dos EUA, citando fonte e data"}.
Use só números presentes nos dados; distâncias em USD (check.references). Não invente preços, alvos, probabilidades ou eventos. Não diga para comprar nem vender: descreva os fatores e deixe a decisão com ele. Notícias são só manchetes; fearGreed é sentimento diário de varejo; na agenda, official=true é horário oficial (BLS/BEA/Fed). Se check.eventWarning existir, ele deve aparecer em cons. As regras de pips do ouro não valem para o Bitcoin.`;
async function safe(fn:()=>Promise<unknown>){try{return {ok:true,data:await fn()}}catch(e){return {ok:false,error:e instanceof Error?e.message:'Fonte indisponível'}}}
// H1 bars before the M5 window plus the M5 window: enough history to score signals up to ~5 days old.
async function scoringBars(env:RuntimeEnv):Promise<Candle[]>{
 const [m5,h1]=await Promise.all([safe(()=>getCandles(env)),getH1(env).catch(()=>[] as Candle[])]);
 const m=m5.ok?(m5.data as {candles:Candle[]}).candles:[];
 return [...h1.filter(b=>!m.length||b.time+3600000<=m[0].time),...m];
}
// Parses, checks against Igor's rules and the current market, and stores (when allowed). Shared by paste and Telegram.
async function processSignal(env:RuntimeEnv,text:string,source:'paste'|'telegram',signalTime:number,dedupeKey:string,canSave:boolean){
 const p=parseSignal(text);
 if('error' in p)return {ok:false as const,error:p.error};
 const s=p.signal, rules=ruleCheck(s,signalTime);
 // The market checklist only means something while the signal is fresh.
 const fresh=Date.now()-signalTime<30*60000;
 let market:ReturnType<typeof checkTrade>|null=null;
 if(fresh){const [c,cal]=await Promise.all([safe(()=>getCandles(env)),safe(getCalendar)]);
  if(c.ok){const d=c.data as {indicators:Indicators;intraday:Intraday|null;stale:boolean};market=checkTrade(s.side,d.indicators,d.intraday,cal.ok?(cal.data as {events:{title:string;date:string;impact:string}[]}).events:[],d.stale)
   // A late entry far from the signal price changes the whole risk; more than 10 pips away is flagged.
   const gap=Math.round(Math.abs(d.indicators.close-s.entry)/0.1);
   rules.checks.push({key:'entry-gap',label:'Preço atual perto da entrada do sinal (até 10 pips)',ok:gap<=10,detail:`último fechamento M5 ${d.indicators.close} · ${gap} pips da entrada`})}}
 let saved=false,duplicate=false;
 if(canSave){
  try{const row=await saveSignal(env,{source,dedupe_key:dedupeKey,raw:text.slice(0,2000),side:s.side,entry:s.entry,sl:s.sl,tps:s.tps,signal_time:new Date(signalTime).toISOString(),session:rules.session,sl_pips:rules.slPips,adjusted_sl:rules.adjustedSl,checks:[...rules.checks,...(market?.checks??[])]});saved=!!row;duplicate=!row}catch{}
 }
 return {ok:true as const,signal:s,rules,market:market&&{verdict:market.verdict,block:market.block,passed:market.passed,total:market.total,checks:market.checks,eventWarning:market.eventWarning},fresh,saved,duplicate,signalTime:new Date(signalTime).toISOString()};
}
const verdictText:Record<string,string>={favoravel:'Favorável',ressalvas:'Com ressalvas',desfavoravel:'Desfavorável','nao-operar':'Não operar agora'};
function telegramReply(r:Awaited<ReturnType<typeof processSignal>>){
 if(!r.ok)return '⚠️ '+r.error;
 const s=r.signal, rl=r.rules, f=(v:number)=>v.toFixed(2).replace('.',',');
 return [
  `${s.side==='buy'?'🟢 COMPRA':'🔴 VENDA'} ${f(s.entry)} · sessão ${rl.session}`,
  `SL do sinal: ${f(s.sl)} (${rl.slPips} pips) ${rl.slPips<=rl.cap?'✅ dentro do limite':`❌ acima do seu limite de ${rl.cap}`}`,
  rl.adjustedSl!==null?`➡️ SL pelas suas regras: ${f(rl.adjustedSl)}`:'',
  `TP1 ${f(rl.ladder.tp1)} · TP2 ${f(rl.ladder.tp2)} · TP3 ${f(rl.ladder.tp3)} (20/50/80 pips)`,
  r.market?`Mercado: ${verdictText[r.market.verdict]} (${r.market.passed}/${r.market.total})${r.market.block?' · '+r.market.block:''}`:'Mercado: sinal antigo, checklist ao vivo não aplicado.',
  r.market?.eventWarning?`⚠️ ${r.market.eventWarning.title} em ${r.market.eventWarning.minutes} min`:'',
  r.saved?'💾 Registrado; o resultado será acompanhado.':r.duplicate?'ℹ️ Este sinal já estava registrado.':'',
  'Não é ordem. Confira preço e spread na Exness.'
 ].filter(Boolean).join('\n');
}
// ttl>0 lets the Vercel CDN share a successful response across visitors; errors are never cached.
const response=(data:unknown,status=200,ttl=0)=>Response.json(data,{status,headers:{'Cache-Control':ttl>0&&status===200?`public, max-age=0, s-maxage=${ttl}`:'private, no-store'}});
// Edge functions must start responding within ~25s, but free models can take 30–60s. Slow AI routes answer at once with a
// stream that sends a space every 5s and then the JSON (leading whitespace is valid JSON). The real status goes in the body
// as `status` and errors keep their `error` field, so clients check `error` rather than the HTTP code.
// Entry for a directional call, from the same fixed rules as the buy/sell check (price at the M5 close, structural stop,
// Igor's ladder and layer for gold; USD stop and target for Bitcoin), with that check's verdict. Neutral calls get none.
function entryOf(r:ReturnType<typeof checkTrade>|ReturnType<typeof checkBtc>):CallEntry{
 const base={side:r.side,price:r.price,sl:r.references.stop.price,verdict:r.verdict,passed:r.passed,total:r.total,block:r.block,rr:r.references.rr};
 if('plan' in r)return {...base,risk:r.plan.slPips,unit:'pips',tps:r.plan.tps.map(t=>({name:t.name,price:t.price})),layer:r.plan.layer?{from:r.plan.layer.from,to:r.plan.layer.to}:null};
 return {...base,risk:r.references.risk,unit:'usd',tps:r.references.target?[{name:'Alvo',price:r.references.target.price}]:[],layer:null};
}
function withEntries<T extends {bias:string}>(calls:T[],run:(side:'buy'|'sell')=>CallEntry){
 const memo:Partial<Record<'buy'|'sell',CallEntry>>={};
 for(const c of calls){const side=c.bias==='alta'?'buy':c.bias==='baixa'?'sell':null;(c as T&{entry:CallEntry|null}).entry=side?memo[side]??=run(side):null}
}
type BtcData={candles:Candle[];indicators:Indicators;intraday:Intraday|null;sentiment:Sentiment;fearGreed:unknown;updatedAt:string;stale:boolean;source:string};
// Bitcoin analysis: same dual 1h/4h call and server caps as gold, with Coinbase candles, crypto news and Fear & Greed.
// Not stored: the prediction table and scoreboard are gold-only.
async function insightBtc(env:RuntimeEnv,key:string){
 const [quote,news,candles,calendar]=await Promise.all([safe(getBtcQuote),safe(()=>getNews('btc')),safe(getBtcCandles),safe(getCalendar)]);
 if(!quote.ok||(quote.data as {stale:boolean}).stale)return response({error:'Sem cotação atual de BTC, a análise está bloqueada.'},503);
 const c=candles.ok?candles.data as BtcData:null, ind=c&&!c.stale?c.indicators:null;
 const at=new Date().toISOString(), events=calendar.ok?(calendar.data as {events:{impact:string;date:string}[]}).events:[];
 const highWithin=(ms:number)=>events.some(e=>e.impact==='High'&&Date.parse(e.date)>Date.now()&&Date.parse(e.date)<Date.now()+ms);
 const event1h=highWithin(3600000), eventSoon=highWithin(4*3600000);
 const candlesM5=c?{indicators:ind,intraday:ind?c.intraday:null,sentiment:ind?summarize(c.sentiment):null,recent:c.candles.slice(-24),updatedAt:c.updatedAt,stale:c.stale,source:c.source}:candles;
 const context={at,asset:'BTC/USD',quote,news,fearGreed:c?.fearGreed??null,candlesM5,calendar,highImpactUsdWithin1h:event1h,highImpactUsdWithin4h:eventSoon};
 try{
  const result=await generateInsight(key,BTC_PROMPT,context,true);
  const dual=parseDualBias(result.text,ind,{event1h,event4h:eventSoon},{m5:ind?.trend,h1:ind?c?.intraday?.h1?.trend:undefined});
  if(!dual)return response({error:result.truncated?'A resposta ficou incompleta. Nenhuma análise parcial será apresentada; tente novamente.':'O modelo não devolveu as duas previsões no formato exigido. Nada foi apresentado; tente novamente.'},502);
  if(ind&&c)withEntries([dual.short,dual.long],side=>entryOf(checkBtc(side,c.indicators,c.intraday,events as {title:string;date:string;impact:string}[],c.stale)));
  const reference=ind&&c?{price:ind.close,time:c.updatedAt,source:'Coinbase · fechamento M5'}:null;
  return response({...dual.long,short:dual.short,model:result.model,provider:result.provider,at,reference,eventSoon,event1h,indicators:ind,saved:false,asset:'btc'});
 }catch(e){return response({error:e instanceof RouterError?e.message:'A conexão com OpenRouter falhou ou excedeu o tempo. Tente mais tarde.'},e instanceof RouterError?e.status:502)}
}
async function checkBtcRoute(request:Request,env:RuntimeEnv,side:'buy'|'sell'){
 const [candles,calendar]=await Promise.all([safe(getBtcCandles),safe(getCalendar)]);
 if(!candles.ok)return response({error:'Sem candles M5 de BTC, a operação não pode ser avaliada.'},503);
 const c=candles.data as BtcData;
 const events=calendar.ok?(calendar.data as {events:{title:string;date:string;impact:string}[]}).events:[];
 const check=checkBtc(side,c.indicators,c.intraday,events,c.stale);
 const base={...check,at:new Date().toISOString(),candlesAt:c.updatedAt,calendarOk:calendar.ok};
 let key:string; try{key=requestKey(request,env.OPENROUTER_API_KEY)}catch{return response({...base,explanation:null,explanationError:'Conecte o OpenRouter para receber a explicação da IA.'})}
 const news=await safe(()=>getNews('btc'));
 try{
  const r=await generateInsight(key,BTC_CHECK_PROMPT,{check,intraday:c.intraday,news,fearGreed:c.fearGreed,calendar},true);
  return response({...base,explanation:parseExplanation(r.text),model:r.model});
 }catch(e){return response({...base,explanation:null,explanationError:e instanceof RouterError?e.message:'A IA não respondeu; o checklist acima continua válido.'})}
}
const SLOW=new Set(['/api/insight','/api/check']);
function heartbeat(work:()=>Promise<Response>):Response{
 const enc=new TextEncoder();
 const body=new ReadableStream<Uint8Array>({async start(ctrl){
  const tick=setInterval(()=>ctrl.enqueue(enc.encode(' ')),5000);
  try{const r=await work();const j=await r.json() as Record<string,unknown>;ctrl.enqueue(enc.encode(JSON.stringify({...j,status:r.status})))}
  catch{ctrl.enqueue(enc.encode(JSON.stringify({error:'Falha inesperada ao gerar a análise.',status:500})))}
  finally{clearInterval(tick);ctrl.close()}
 }});
 return new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
}
export async function marketApi(request:Request,env:RuntimeEnv):Promise<Response>{
 const p=new URL(request.url).pathname;
 // Cheap rejections (method, origin) stay synchronous so they keep their real HTTP status.
 if(SLOW.has(p)&&request.method==='POST'&&request.headers.get('origin')===new URL(request.url).origin)return heartbeat(()=>route(request,env));
 return route(request,env);
}
async function route(request:Request,env:RuntimeEnv):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/api/config'&&request.method==='GET') return response({aiConfigured:!!env.OPENROUTER_API_KEY,provider:'OpenRouter',model:FREE_MODEL,candlesConfigured:!!env.TWELVEDATA_API_KEY,dbConfigured:storeEnabled(env)});
 if(path==='/api/history'){
  if(request.method!=='GET')return response({error:'Método inválido'},405);
  if(!storeEnabled(env))return response({error:'Banco de dados não configurado.'},503);
  if(!authorized(request,env))return response({error:'Senha de acesso inválida.'},401);
  const candles=await safe(()=>getCandles(env));
  try{
   await scoreSignals(env,await scoringBars(env)).catch(()=>{});
   const [h,sig]=await Promise.all([history(env,candles.ok?(candles.data as {candles:Candle[]}).candles:null),signalHistory(env)]);
   return response({...h,signals:sig});
  }
  catch{return response({error:'Não foi possível ler o histórico no banco.'},502)}
 }
 if(path==='/api/signal'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Origem inválida'},403);
  let body:{text?:unknown;time?:unknown}; try{body=await request.json()}catch{return response({error:'Corpo inválido'},400)}
  const text=typeof body.text==='string'?body.text.trim():'';
  if(!text||text.length>2000)return response({error:'Cole o texto do sinal (até 2000 caracteres).'},400);
  // Optional posting time (ISO) for signals pasted later; defaults to now, never in the future.
  const t=typeof body.time==='string'?Date.parse(body.time):NaN, signalTime=Number.isFinite(t)&&t<=Date.now()?t:Date.now();
  const canSave=storeEnabled(env)&&authorized(request,env);
  const r=await processSignal(env,text,'paste',signalTime,'paste:'+signalTime+':'+text.replace(/\s+/g,' ').slice(0,120),canSave);
  return response(r,r.ok?200:422);
 }
 if(path==='/api/telegram'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  // Telegram sends this header on every webhook call when setWebhook was given a secret_token.
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return response({error:'Não autorizado'},401);
  type TgMsg={message_id:number;date:number;text?:string;caption?:string;chat:{id:number};from?:{id:number};forward_origin?:{date:number;chat?:{id:number};message_id?:number}};
  let update:{message?:TgMsg}; try{update=await request.json()}catch{return response({ok:true})}
  const m=update.message; if(!m)return response({ok:true});
  const send=(text:string)=>fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:m.chat.id,text,reply_parameters:{message_id:m.message_id}}),signal:AbortSignal.timeout(8000)}).catch(()=>{});
  // Until the owner is configured the bot only tells the sender their id; afterwards it ignores everyone else.
  if(!env.TELEGRAM_OWNER_ID){await send(`Seu ID do Telegram é ${m.from?.id}. Coloque-o em TELEGRAM_OWNER_ID na Vercel para ativar o robô.`);return response({ok:true})}
  if(String(m.from?.id)!==env.TELEGRAM_OWNER_ID)return response({ok:true});
  const text=(m.text||m.caption||'').trim();
  if(!text){await send('Encaminhe a mensagem do sinal (texto).');return response({ok:true})}
  const o=m.forward_origin, signalTime=(o?.date??m.date)*1000;
  const key=o?.chat&&o.message_id?`tg:${o.chat.id}:${o.message_id}`:`tg:${m.chat.id}:${m.message_id}`;
  await send(telegramReply(await processSignal(env,text,'telegram',signalTime,key,storeEnabled(env))));
  return response({ok:true});
 }
 // Telegram alerts for gold, called every 5 minutes by the database scheduler (scripts/notify-cron.mjs) with the access token.
 if(path==='/api/notify'){
  if(!storeEnabled(env)||!authorized(request,env))return response({error:'Não autorizado'},401);
  if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_OWNER_ID)return response({error:'Telegram não configurado (TELEGRAM_BOT_TOKEN e TELEGRAM_OWNER_ID).'},503);
  // Read through the CDN: the panel and the scheduler share one cached candle response, so alerts add no Twelve Data calls.
  const get=async(p:string)=>{const r=await fetch(new URL(p,request.url),{signal:AbortSignal.timeout(20000)});const j=await r.json() as {ok:boolean;data:unknown;error?:string};if(!j.ok)throw new Error(j.error||p+' indisponível');return j.data};
  const [candles,calendar]=await Promise.all([safe(()=>get('/api/candles')),safe(()=>get('/api/calendar'))]);
  if(!candles.ok)return response({error:'Sem candles M5 para os alertas.'},503);
  const msgs=alerts(candles.data as Parameters<typeof alerts>[0],calendar.ok?(calendar.data as {events:Parameters<typeof alerts>[1]}).events:[],Date.now());
  const tg=async(text:string)=>{const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_OWNER_ID,text}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Telegram respondeu HTTP '+r.status)};
  try{return response({ok:true,sent:await sendAlerts(msgs,k=>claimAlert(env,k),tg,k=>releaseAlert(env,k).then(()=>{}))})}
  catch(e){return response({error:e instanceof Error?e.message:'Falha ao enviar alertas.'},502)}
 }
 if(path==='/api/check'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Origem inválida'},403);
  const side=new URL(request.url).searchParams.get('side');
  if(side!=='buy'&&side!=='sell')return response({error:'Lado inválido'},400);
  if(new URL(request.url).searchParams.get('asset')==='btc')return checkBtcRoute(request,env,side);
  const [candles,calendar]=await Promise.all([safe(()=>getCandles(env)),safe(getCalendar)]);
  if(!candles.ok)return response({error:'Sem candles M5, a operação não pode ser avaliada.'},503);
  const c=candles.data as {indicators:Indicators;intraday:Intraday|null;stale:boolean;updatedAt:string};
  const events=calendar.ok?(calendar.data as {events:{title:string;date:string;impact:string}[]}).events:[];
  const check=checkTrade(side,c.indicators,c.intraday,events,c.stale);
  const base={...check,at:new Date().toISOString(),candlesAt:c.updatedAt,calendarOk:calendar.ok};
  // The explanation is optional: without an OpenRouter key the checklist still answers.
  const done=async(extra:Record<string,unknown>,model?:string)=>response({...base,...extra,model,saved:await persist(env,request,()=>saveCheck(env,check,model))});
  let key:string; try{key=requestKey(request,env.OPENROUTER_API_KEY)}catch{return done({explanation:null,explanationError:'Conecte o OpenRouter para receber a explicação da IA.'})}
  const [quote,cot,news,fed]=await Promise.all([safe(getQuote),safe(getCot),safe(()=>getNews('news')),safe(()=>getNews('fed'))]);
  try{
   const r=await generateInsight(key,CHECK_PROMPT,{check,intraday:c.intraday,quote,cot,news,fed,calendar},true);
   return done({explanation:parseExplanation(r.text)},r.model);
  }catch(e){return done({explanation:null,explanationError:e instanceof RouterError?e.message:'A IA não respondeu; o checklist acima continua válido.'})}
 }
 if(path==='/api/insight'||path==='/api/openrouter'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Origem inválida'},403);
  let key:string;
  try{key=requestKey(request,env.OPENROUTER_API_KEY);if(path==='/api/openrouter')return response(await checkRouterKey(key));}
  catch(e){return response({error:e instanceof RouterError?e.message:'Não foi possível validar a conexão OpenRouter.'},e instanceof RouterError?e.status:502);}
  if(new URL(request.url).searchParams.get('asset')==='btc')return insightBtc(env,key);
  const [quote,cot,news,fed,candles,calendar]=await Promise.all([safe(getQuote),safe(getCot),safe(()=>getNews('news')),safe(()=>getNews('fed')),safe(()=>getCandles(env)),safe(getCalendar)]);
  if(!quote.ok)return response({error:'Sem cotação verificável, a análise está bloqueada.'},503);
  if((quote.data as {stale:boolean}).stale)return response({error:'Cotação desatualizada. Aguarde dados atuais para analisar.'},503);
  const c=candles.ok?candles.data as {candles:Candle[];indicators:Indicators;intraday:Intraday|null;sentiment:Sentiment;updatedAt:string;stale:boolean;source:string}:null;
  const ind=c&&!c.stale?c.indicators:null;
  const at=new Date().toISOString(), events=calendar.ok?(calendar.data as {events:{impact:string;date:string}[]}).events:[];
  const highWithin=(ms:number)=>events.some(e=>e.impact==='High'&&Date.parse(e.date)>Date.now()&&Date.parse(e.date)<Date.now()+ms);
  const event1h=highWithin(3600000), eventSoon=highWithin(4*3600000);
  // The model gets computed indicators plus the last 2h of bars, not the full window: fewer tokens, faster free-model replies.
  const candlesM5=c?{indicators:ind,intraday:ind?c.intraday:null,sentiment:ind?summarize(c.sentiment):null,recent:c.candles.slice(-24),updatedAt:c.updatedAt,stale:c.stale,source:c.source}:candles;
  const context={at,quote,cot,news,fed,candlesM5,calendar,highImpactUsdWithin1h:event1h,highImpactUsdWithin4h:eventSoon};
  try{
   const result=await generateInsight(key,PROMPT,context,true);
   const dual=parseDualBias(result.text,ind,{event1h,event4h:eventSoon},{m5:ind?.trend,h1:ind?c?.intraday?.h1?.trend:undefined});
   if(!dual)return response({error:result.truncated?'A resposta ficou incompleta. Nenhuma análise parcial será apresentada; tente novamente.':'O modelo não devolveu as duas previsões no formato exigido. Nada foi apresentado; tente novamente.'},502);
   if(ind&&c)withEntries([dual.short,dual.long],side=>entryOf(checkTrade(side,c.indicators,c.intraday,events as {title:string;date:string;impact:string}[],c.stale)));
   const reference=ind&&c?{price:ind.close,time:c.updatedAt,source:'Twelve Data · fechamento M5'}:null;
   // Each horizon is stored and scored on its own, so the scoreboard can compare the 1h and 4h hit rates.
   const saved=reference?await persist(env,request,()=>Promise.all([savePrediction(env,dual.short,reference,result.model),savePrediction(env,dual.long,reference,result.model)])):false;
   // Top-level fields keep the 4h call so the chart, alerts and older clients work unchanged; `short` carries the 1h call.
   return response({...dual.long,short:dual.short,model:result.model,provider:result.provider,at,reference,eventSoon,event1h,indicators:ind,saved});
  }catch(e){return response({error:e instanceof RouterError?e.message:'A conexão com OpenRouter falhou ou excedeu o tempo. Tente mais tarde.'},e instanceof RouterError?e.status:502)}
 }
 // Bitcoin read-only view (Coinbase), separate paths so the gold responses and their CDN entries stay unchanged.
 if((path==='/api/btc/candles'||path==='/api/btc/quote'||path==='/api/btc/news')&&request.method==='GET'){
  const result=await safe(path==='/api/btc/candles'?getBtcCandles:path==='/api/btc/news'?()=>getNews('btc'):getBtcQuote);
  return response({...result,checkedAt:new Date().toISOString()},result.ok?200:503,path==='/api/btc/candles'?Math.max(1,Math.ceil((nextClose()-Date.now())/1000)):0);
 }
 const fns:Record<string,()=>Promise<unknown>>={'/api/quote':getQuote,'/api/cot':getCot,'/api/news':()=>getNews('news'),'/api/fed':()=>getNews('fed'),'/api/candles':()=>getCandles(env),'/api/calendar':getCalendar};
 if(!fns[path])return response({error:'Não encontrado'},404);
 if(request.method!=='GET')return response({error:'Método inválido'},405);
 // The CDN keeps candles exactly as long as this instance's cache, including the short retry window.
 const ttl=path==='/api/candles'?Math.max(1,Math.ceil(((candlesCache?.until??nextClose())-Date.now())/1000)):path==='/api/calendar'?900:0;
 const result=await safe(fns[path]); return response({...result,checkedAt:new Date().toISOString()},result.ok?200:503,ttl);
}
