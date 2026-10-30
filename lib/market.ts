import {checkRouterKey,generateInsight,requestKey,RouterError,FREE_MODEL} from './openrouter';
import {indicators,intraday,intradayLevels,parseBias,type Candle,type Indicators,type Intraday} from './indicators';
import {checkTrade} from './trade-check';
import {authorized,history,saveCheck,savePrediction,storeEnabled,type StoreEnv} from './store';
// Saving is best effort: a database failure never blocks the analysis the user asked for.
const persist=async(env:RuntimeEnv,request:Request,write:()=>Promise<unknown>)=>{
 if(!storeEnabled(env)||!authorized(request,env))return false;
 try{await write();return true}catch{return false}
};
export type RuntimeEnv = { OPENROUTER_API_KEY?: string; TWELVEDATA_API_KEY?: string } & StoreEnv;
const links = {
 quote: 'https://api.gold-api.com/price/XAU',
 cot: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?' + new URLSearchParams({'$where':"cftc_contract_market_code='088691'",'$order':'report_date_as_yyyy_mm_dd DESC','$limit':'2','$select':'report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,open_interest_all'}),
 news: 'https://news.google.com/rss/search?q=gold+prices+Federal+Reserve+when:3d&hl=en-US&gl=US&ceid=US:en',
 fed: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
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
export async function getNews(kind:'news'|'fed') {
 const xml=await fetchData(links[kind],false); const items=[...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].slice(0,8).map(m=>{
  const tag=(s:string)=>clean(m[1].match(new RegExp('<'+s+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+s+'>','i'))?.[1]||'');
  return {title:tag('title'),url:tag('link'),date:tag('pubDate'),publisher:tag('source')||(kind==='fed'?'Federal Reserve':'Google News')};
 }).filter(i=>i.title&&/^https:\/\//.test(i.url)&&Number.isFinite(Date.parse(i.date))&&Date.parse(i.date)<=Date.now()+60000);
 if(!items.length) throw new Error('Nenhuma notícia válida retornada');
 return {items,source:kind==='fed'?'Federal Reserve':'Google News · agregador',url:kind==='fed'?'https://www.federalreserve.gov/newsevents.htm':'https://news.google.com',fetchedAt:new Date().toISOString()};
}
// Candles only change when an M5 bar closes; refetch after the next close (+20s provider latency) to protect the API quota.
const nextClose=()=>Math.floor(Date.now()/300000)*300000+320000;
let candlesCache:{until:number;data:unknown}|null=null;
async function getSeries(env:RuntimeEnv,interval:'5min'|'1h',size:number,barMs:number):Promise<Candle[]>{
 const q=await fetchData('https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',interval,outputsize:String(size),timezone:'UTC',apikey:env.TWELVEDATA_API_KEY!}));
 if(q.status==='error'||!Array.isArray(q.values)||q.meta?.symbol!=='XAU/USD'||q.meta?.interval!==interval)throw new Error('Feed '+(interval==='1h'?'H1':'M5')+' indisponível. Verifique o acesso ao XAU/USD no provedor.');
 const candles:Candle[]=q.values.map((v:Record<string,string>)=>({time:Date.parse(v.datetime.replace(' ','T')+'Z'),open:number(v.open),high:number(v.high),low:number(v.low),close:number(v.close)})).filter((v:Candle)=>Number.isFinite(v.time)&&v.time+barMs<=Date.now()).sort((a:Candle,b:Candle)=>a.time-b.time);
 if(candles.length<50||candles.some(v=>v.low<=0||v.high<Math.max(v.open,v.close)||v.low>Math.min(v.open,v.close)))throw new Error('Histórico '+(interval==='1h'?'H1':'M5')+' insuficiente ou inválido');
 return candles;
}
// H1 bars feed the day/session levels and the higher-timeframe trend; one fetch per hour per instance (~24/day).
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
 const [candles,h1]=await Promise.all([getSeries(env,'5min',100,300000),getH1(env).catch(()=>null)]);
 const day=h1?intraday(h1,candles):null; const ind=indicators(candles); ind.levels={...ind.levels,...intradayLevels(day)};
 const last=candles.at(-1)!;
 const data={candles,ema20:ind.levels.ema20,ema50:ind.levels.ema50,indicators:ind,intraday:day,intradayError:h1?null:'Candles H1 indisponíveis: níveis do dia e tendência H1 fora desta análise.',updatedAt:new Date(last.time+300000).toISOString(),stale:Date.now()-(last.time+300000)>600000,source:'Twelve Data · XAU/USD · M5',url:'https://twelvedata.com',note:'Apenas candles fechados. Fonte independente do gráfico e da corretora.'};
 candlesCache={until:nextClose(),data};
 return data;
}
// The aggregator asks clients to poll sparingly; one fetch per instance every 15 minutes.
let calendarCache:{at:number;data:unknown}|null=null;
export async function getCalendar() {
 if(calendarCache&&Date.now()-calendarCache.at<900000)return calendarCache.data;
 const rows=await fetchData(links.calendar); if(!Array.isArray(rows))throw new Error('Agenda indisponível');
 const events=rows.filter(r=>r?.country==='USD'&&(r.impact==='High'||r.impact==='Medium')&&typeof r.title==='string'&&Number.isFinite(Date.parse(r.date)))
  .map(r=>({title:String(r.title),date:new Date(Date.parse(r.date)).toISOString(),impact:r.impact as 'High'|'Medium',forecast:typeof r.forecast==='string'?r.forecast:'',previous:typeof r.previous==='string'?r.previous:''}))
  .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 const data={events,source:'ForexFactory · agregador (faireconomy)',url:'https://www.forexfactory.com/calendar',fetchedAt:new Date().toISOString(),note:'Semana atual, eventos USD de impacto alto e médio. Horários e previsões de agregador não oficial; sem valores realizados. Confirme no Fed, BLS ou BEA.'};
 calendarCache={at:Date.now(),data};
 return data;
}
const PROMPT=`Você é analista de contexto do ouro (XAU/USD) para Igor. Responda SOMENTE com um objeto JSON válido, sem nenhum texto fora dele, no formato {"bias":"alta"|"baixa"|"neutro","confidence":"baixa"|"media"|"alta","horizonHours":1-4,"drivers":[{"text":"motivo curto","source":"fonte e data"}],"invalidation":{"level":"<uma chave de candlesM5.indicators.levels>","condition":"acima"|"abaixo"}|null,"analysis":"texto"}.
bias é o viés de direção mais provável do preço nas próximas horizonHours horas (1 a 4), não um sinal de entrada. Baseie-o principalmente em candlesM5.indicators (trend, rsi14, ema20Slope1h, change1h, change4h, atr14, levels) e em candlesM5.intraday: h1 (tendência H1, que tem peso maior que o M5), previousDay (máxima, mínima e fechamento do dia anterior), today e sessions (faixas de Ásia, Londres e Nova York de hoje). Diga onde o preço está em relação a esses níveis do dia. COT é semanal de futuros e notícias são só manchetes: use-os como contexto secundário.
Calibração: se os sinais técnicos conflitarem ou candlesM5.indicators for null, use "neutro" com confiança "baixa". Se a tendência H1 contrariar o viés, a confiança máxima é "media". Só use confiança "alta" quando trend, h1.trend, ema20Slope1h, change1h e change4h apontarem para o mesmo lado e o rsi14 estiver entre 25 e 75. Se highImpactUsdWithin4h for true, a confiança máxima é "media" e o evento deve aparecer nos drivers.
drivers: até 3, do mais forte para o mais fraco, cada um com fonte e data. invalidation: para alta, condition "abaixo" e um nível abaixo do preço; para baixa, "acima" e um nível acima; para neutro, null. Informe só a chave do nível, nunca um preço.
analysis: português, até 250 palavras, quatro parágrafos curtos separados por linha em branco: Contexto, Evidências, Cenários condicionais e Lacunas. Cite fonte e data em cada conclusão factual. Use apenas números presentes nos dados anexados; não invente preços, eventos, consenso, probabilidades, fluxo, suportes ou resistências. A agenda econômica vem de agregador não oficial: use-a só para alertar eventos USD próximos. Não recomende compra, venda, entrada, stop ou alvo, e diga que o timing de entrada não é avaliado sem agenda econômica oficial. A cotação spot não é preço executável. Não alegue acesso visual ao TradingView. Termine lembrando de validar spread e condições na corretora.`;
const CHECK_PROMPT=`Você explica para Igor a avaliação de uma operação em XAU/USD que ele está considerando (check.side: buy = compra, sell = venda). O veredito em check.verdict foi calculado por regras fixas e NÃO pode ser alterado nem contestado: favoravel, ressalvas, desfavoravel ou nao-operar. Responda SOMENTE com JSON válido: {"summary":"uma frase em português explicando o veredito","pros":["até 3 pontos a favor"],"cons":["até 3 pontos contra ou riscos"],"context":"até 80 palavras sobre notícias, Fed e COT que reforçam ou enfraquecem a operação, citando fonte e data"}.
Use só números presentes nos dados. Não invente preços, alvos, probabilidades ou eventos. Não diga para comprar nem vender: descreva os fatores e deixe a decisão com ele. Notícias são só manchetes; COT é semanal; a agenda é de agregador não oficial. Se check.eventWarning existir, ele deve aparecer em cons.
Igor opera scalping e day trade com regras próprias, já aplicadas em check.plan: 1 pip = 0,10 USD; SL máximo de 30 pips na Ásia e em Londres e 50 em Nova York; TP1 20, TP2 40–50 e TP3 80+ pips; camada de proteção com mesmo lote e mesmo SL quando a operação está 10–20 pips contra; no TP1 o SL vai para o ponto de equilíbrio. Fale em pips, use os preços de check.plan e aponte em cons se o stop técnico não coube no limite da sessão, se há um nível antes do TP1, ou se o prejuízo com a camada (check.plan.layer.lossAtSlPips) for alto.`;
function parseExplanation(text:string){
 const s=text.replace(/```(?:json)?/g,''); const a=s.indexOf('{'), b=s.lastIndexOf('}');
 try{
  const j=JSON.parse(s.slice(a,b+1)); const list=(v:unknown)=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).slice(0,3):[];
  if(typeof j.summary!=='string')return null;
  return {summary:j.summary.trim(),pros:list(j.pros),cons:list(j.cons),context:typeof j.context==='string'?j.context.trim():''};
 }catch{return null}
}
async function safe(fn:()=>Promise<unknown>){try{return {ok:true,data:await fn()}}catch(e){return {ok:false,error:e instanceof Error?e.message:'Fonte indisponível'}}}
// ttl>0 lets the Vercel CDN share a successful response across visitors; errors are never cached.
const response=(data:unknown,status=200,ttl=0)=>Response.json(data,{status,headers:{'Cache-Control':ttl>0&&status===200?`public, max-age=0, s-maxage=${ttl}`:'private, no-store'}});
export async function marketApi(request:Request,env:RuntimeEnv):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/api/config'&&request.method==='GET') return response({aiConfigured:!!env.OPENROUTER_API_KEY,provider:'OpenRouter',model:FREE_MODEL,candlesConfigured:!!env.TWELVEDATA_API_KEY,dbConfigured:storeEnabled(env)});
 if(path==='/api/history'){
  if(request.method!=='GET')return response({error:'Método inválido'},405);
  if(!storeEnabled(env))return response({error:'Banco de dados não configurado.'},503);
  if(!authorized(request,env))return response({error:'Senha de acesso inválida.'},401);
  const candles=await safe(()=>getCandles(env));
  try{return response(await history(env,candles.ok?(candles.data as {candles:Candle[]}).candles:null))}
  catch{return response({error:'Não foi possível ler o histórico no banco.'},502)}
 }
 if(path==='/api/check'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Origem inválida'},403);
  const side=new URL(request.url).searchParams.get('side');
  if(side!=='buy'&&side!=='sell')return response({error:'Lado inválido'},400);
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
  const [quote,cot,news,fed,candles,calendar]=await Promise.all([safe(getQuote),safe(getCot),safe(()=>getNews('news')),safe(()=>getNews('fed')),safe(()=>getCandles(env)),safe(getCalendar)]);
  if(!quote.ok)return response({error:'Sem cotação verificável, a análise está bloqueada.'},503);
  if((quote.data as {stale:boolean}).stale)return response({error:'Cotação desatualizada. Aguarde dados atuais para analisar.'},503);
  const c=candles.ok?candles.data as {candles:Candle[];indicators:Indicators;intraday:Intraday|null;updatedAt:string;stale:boolean;source:string}:null;
  const ind=c&&!c.stale?c.indicators:null;
  const at=new Date().toISOString(), horizonEnd=Date.now()+4*3600000;
  const eventSoon=calendar.ok&&(calendar.data as {events:{impact:string;date:string}[]}).events.some(e=>e.impact==='High'&&Date.parse(e.date)>Date.now()&&Date.parse(e.date)<horizonEnd);
  // The model gets computed indicators plus the last 2h of bars, not the full window: fewer tokens, faster free-model replies.
  const candlesM5=c?{indicators:ind,intraday:ind?c.intraday:null,recent:c.candles.slice(-24),updatedAt:c.updatedAt,stale:c.stale,source:c.source}:candles;
  const context={at,quote,cot,news,fed,candlesM5,calendar,highImpactUsdWithin4h:eventSoon};
  try{
   const result=await generateInsight(key,PROMPT,context,true);
   const bias=parseBias(result.text,ind,eventSoon,ind?c?.intraday?.h1?.trend:undefined);
   if(!bias)return response({error:'O modelo não devolveu a previsão no formato exigido. Nada foi apresentado; tente novamente.'},502);
   const reference=ind&&c?{price:ind.close,time:c.updatedAt,source:'Twelve Data · fechamento M5'}:null;
   const saved=reference?await persist(env,request,()=>savePrediction(env,bias,reference,result.model)):false;
   return response({...bias,model:result.model,provider:result.provider,at,reference,eventSoon,indicators:ind,saved});
  }catch(e){return response({error:e instanceof RouterError?e.message:'A conexão com OpenRouter falhou ou excedeu o tempo. Tente mais tarde.'},e instanceof RouterError?e.status:502)}
 }
 const fns:Record<string,()=>Promise<unknown>>={'/api/quote':getQuote,'/api/cot':getCot,'/api/news':()=>getNews('news'),'/api/fed':()=>getNews('fed'),'/api/candles':()=>getCandles(env),'/api/calendar':getCalendar};
 if(!fns[path])return response({error:'Não encontrado'},404);
 if(request.method!=='GET')return response({error:'Método inválido'},405);
 const ttl=path==='/api/candles'?Math.ceil((nextClose()-Date.now())/1000):path==='/api/calendar'?900:0;
 const result=await safe(fns[path]); return response({...result,checkedAt:new Date().toISOString()},result.ok?200:503,ttl);
}
