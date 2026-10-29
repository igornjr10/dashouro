import {checkRouterKey,generateInsight,requestKey,RouterError,FREE_MODEL} from './openrouter';
export type RuntimeEnv = { OPENROUTER_API_KEY?: string; TWELVEDATA_API_KEY?: string };
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
export async function getCandles(env:RuntimeEnv) {
 if(!env.TWELVEDATA_API_KEY) throw new Error('Feed de candles M5 não conectado');
 const q=await fetchData('https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',interval:'5min',outputsize:'100',timezone:'UTC',apikey:env.TWELVEDATA_API_KEY}));
 if(q.status==='error'||!Array.isArray(q.values)||q.meta?.symbol!=='XAU/USD'||q.meta?.interval!=='5min')throw new Error('Feed M5 indisponível. Verifique o acesso ao XAU/USD no provedor.');
 const candles=q.values.map((v:Record<string,string>)=>({time:Date.parse(v.datetime.replace(' ','T')+'Z'),open:number(v.open),high:number(v.high),low:number(v.low),close:number(v.close)})).filter((v:{time:number})=>Number.isFinite(v.time)&&v.time+300000<=Date.now()).sort((a:{time:number},b:{time:number})=>a.time-b.time);
 if(candles.length<50||candles.some((v:{open:number;close:number;high:number;low:number})=>v.low<=0||v.high<Math.max(v.open,v.close)||v.low>Math.min(v.open,v.close)))throw new Error('Histórico M5 insuficiente ou inválido');
 const last=candles.at(-1); const closes=candles.map((v:{close:number})=>v.close); const ema=(n:number)=>{let e=closes.slice(0,n).reduce((a:number,b:number)=>a+b,0)/n;for(const v of closes.slice(n)) e=v*2/(n+1)+e*(1-2/(n+1));return e;};
 return {candles,ema20:ema(20),ema50:ema(50),updatedAt:new Date(last.time+300000).toISOString(),stale:Date.now()-(last.time+300000)>600000,source:'Twelve Data · XAU/USD · M5',url:'https://twelvedata.com',note:'Apenas candles fechados. Fonte independente do gráfico e da corretora.'};
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
async function safe(fn:()=>Promise<unknown>){try{return {ok:true,data:await fn()}}catch(e){return {ok:false,error:e instanceof Error?e.message:'Fonte indisponível'}}}
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function marketApi(request:Request,env:RuntimeEnv):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/api/config'&&request.method==='GET') return response({aiConfigured:!!env.OPENROUTER_API_KEY,provider:'OpenRouter',model:FREE_MODEL,candlesConfigured:!!env.TWELVEDATA_API_KEY});
 if(path==='/api/insight'||path==='/api/openrouter'){
  if(request.method!=='POST')return response({error:'Método inválido'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Origem inválida'},403);
  let key:string;
  try{key=requestKey(request,env.OPENROUTER_API_KEY);if(path==='/api/openrouter')return response(await checkRouterKey(key));}
  catch(e){return response({error:e instanceof RouterError?e.message:'Não foi possível validar a conexão OpenRouter.'},e instanceof RouterError?e.status:502);}
  const [quote,cot,news,fed,candles,calendar]=await Promise.all([safe(getQuote),safe(getCot),safe(()=>getNews('news')),safe(()=>getNews('fed')),safe(()=>getCandles(env)),safe(getCalendar)]);
  if(!quote.ok)return response({error:'Sem cotação verificável, a análise está bloqueada.'},503);
  if((quote.data as {stale:boolean}).stale)return response({error:'Cotação desatualizada. Aguarde dados atuais para analisar.'},503);
  const context={at:new Date().toISOString(),quote,cot,news,fed,candles,calendar};
  try{
   const result=await generateInsight(key,'Você é analista de contexto do ouro para Igor. Responda em português, com no máximo 350 palavras e exatamente quatro parágrafos curtos: Contexto, Evidências, Cenários condicionais e Lacunas. Use somente os dados anexados e cite fonte e data em cada conclusão factual. Notícias são apenas manchetes, não fatos verificados. Não invente preços, eventos, consenso, probabilidades, fluxo, retornos, suportes ou resistências. COT é semanal de futuros, não fluxo spot; a cotação spot não é preço executável. A agenda econômica anexada vem de agregador não oficial e não é validada: use-a só para alertar eventos USD de alto impacto próximos, com horário, nunca para sugerir entrada. Sem candles M5 atuais e agenda econômica validada, declare que timing não pode ser avaliado; não recomende compra, venda ou alvos numéricos. Cite fontes falhas ou desatualizadas, não alegue acesso visual ao TradingView e termine lembrando de validar spread e condições na corretora.',context);
   return response({...result,at:context.at,sources:{quote,cot,news,fed,candles,calendar}});
  }catch(e){return response({error:e instanceof RouterError?e.message:'A conexão com OpenRouter falhou ou excedeu o tempo. Tente mais tarde.'},e instanceof RouterError?e.status:502)}
 }
 const fns:Record<string,()=>Promise<unknown>>={'/api/quote':getQuote,'/api/cot':getCot,'/api/news':()=>getNews('news'),'/api/fed':()=>getNews('fed'),'/api/candles':()=>getCandles(env),'/api/calendar':getCalendar};
 if(!fns[path])return response({error:'Não encontrado'},404);
 if(request.method!=='GET')return response({error:'Método inválido'},405);
 const result=await safe(fns[path]); return response({...result,checkedAt:new Date().toISOString()},result.ok?200:503);
}
