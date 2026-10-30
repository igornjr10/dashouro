import {nyOffsetHours} from './crt';

// Official US release calendars: BLS (CPI, jobs, PPI, JOLTS), BEA (GDP, PCE, trade) and the Fed (FOMC statements).
// BLS refuses automated retrieval after a few requests, so every source is fetched at most once per 6 hours per
// instance (and the /api/calendar response is CDN-cached); a refused source is reported, never worked around.
export type OfficialEvent={title:string;date:string;impact:'High'|'Medium';source:'BLS'|'BEA'|'Fed';url:string};
type SourceState={ok:boolean;error?:string;count:number};
const H=3_600_000;
const UA='Aurum dashboard (personal, low-frequency; https://dashouro-sigma.vercel.app)';
const URLS={
 BLS:'https://www.bls.gov/schedule/news_release/bls.ics',
 BEA:'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics',
 Fed:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
};
const PAGES={BLS:'https://www.bls.gov/schedule/news_release/',BEA:'https://www.bea.gov/news/schedule',Fed:URLS.Fed};

// Release names that move gold; anything else from these calendars is left out.
const RULES:{source:'BLS'|'BEA';match:RegExp;impact:'High'|'Medium';title:string}[]=[
 {source:'BLS',match:/^Consumer Price Index/i,impact:'High',title:'CPI (inflação ao consumidor)'},
 {source:'BLS',match:/^Employment Situation/i,impact:'High',title:'Payroll / desemprego (Employment Situation)'},
 {source:'BLS',match:/^Producer Price Index/i,impact:'Medium',title:'PPI (inflação ao produtor)'},
 {source:'BLS',match:/^Job Openings and Labor Turnover/i,impact:'Medium',title:'JOLTS (vagas de emprego)'},
 {source:'BLS',match:/^Employment Cost Index/i,impact:'Medium',title:'ECI (custo do trabalho)'},
 {source:'BEA',match:/^GDP \((Advance|Second|Third)/i,impact:'High',title:'PIB dos EUA'},
 {source:'BEA',match:/^Personal Income and Outlays/i,impact:'High',title:'PCE / renda e gastos pessoais'},
 {source:'BEA',match:/^U\.S\. International Trade in Goods and Services/i,impact:'Medium',title:'Balança comercial'},
];

async function text(url:string){
 const r=await fetch(url,{headers:{'User-Agent':UA,Accept:'text/calendar,text/html;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('HTTP '+r.status);
 const t=await r.text();
 if(/<title>Access Denied<\/title>/i.test(t))throw new Error('acesso automático recusado pelo site');
 return t;
}

// Minimal iCalendar reader: unfolds lines, reads SUMMARY and DTSTART (UTC "Z" or New York local time).
function parseIcs(ics:string){
 const body=ics.replace(/\r?\n[ \t]/g,'');
 return body.split('BEGIN:VEVENT').slice(1).map(e=>{
  const summary=(e.match(/^SUMMARY[^:\n]*:(.*)$/m)?.[1]??'').replace(/\\,/g,',').replace(/\\;/g,';').trim();
  const m=e.match(/^DTSTART([^:\n]*):(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/m);
  if(!m)return null;
  const [,params,y,mo,d,hh='08',mi='30',,z]=m;
  let t=Date.UTC(+y,+mo-1,+d,+hh,+mi);
  // Date-only or local times are New York wall clock; shift to UTC with that day's offset.
  if(!z){t-=nyOffsetHours(t)*H;if(/VALUE=DATE(?!-TIME)/.test(params))t=Date.UTC(+y,+mo-1,+d,8,30)-nyOffsetHours(t)*H}
  return {summary,time:t};
 }).filter((x):x is {summary:string;time:number}=>!!x&&!!x.summary);
}

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
// FOMC page: "2026 FOMC Meetings" sections list "March 17-18*" or "April/May 30-1". The statement is at 14:00 NY on
// the last day; '*' marks meetings with projections (and a press conference either way at 14:30).
function parseFomc(html:string){
 const out:{title:string;time:number}[]=[];
 for(const sec of html.split(/(?=\d{4} FOMC Meetings)/).slice(1)){
  const year=+sec.slice(0,4);
  const plain=sec.slice(0,30000).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  for(const m of plain.matchAll(/\b([A-Z][a-z]+)(?:\/([A-Z][a-z]+))? (\d{1,2})-(\d{1,2})(\*?)/g)){
   const first=MONTHS.indexOf(m[1].toLowerCase()); if(first<0)continue;
   const last=m[2]?MONTHS.indexOf(m[2].toLowerCase()):first; if(last<0)continue;
   const local=Date.UTC(year,last,+m[4],14,0);
   out.push({title:'FOMC: decisão de juros do Fed'+(m[5]?' (com projeções)':''),time:local-nyOffsetHours(local)*H});
  }
 }
 return out;
}

let cache:{at:number;events:OfficialEvent[];sources:Record<string,SourceState>}|null=null;
export async function getOfficialCalendar(){
 if(cache&&Date.now()-cache.at<6*H)return cache;
 const sources:Record<string,SourceState>={};
 const events:OfficialEvent[]=[];
 await Promise.all((['BLS','BEA'] as const).map(async src=>{
  try{
   const list=parseIcs(await text(URLS[src]));
   let n=0;
   for(const e of list){const rule=RULES.find(r=>r.source===src&&r.match.test(e.summary));if(rule){events.push({title:rule.title+(e.summary.includes(',')?' · '+e.summary.slice(e.summary.lastIndexOf(',')+1).trim():''),date:new Date(e.time).toISOString(),impact:rule.impact,source:src,url:PAGES[src]});n++}}
   sources[src]={ok:true,count:n};
  }catch(e){sources[src]={ok:false,count:0,error:e instanceof Error?e.message:'falhou'}}
 }));
 try{const f=parseFomc(await text(URLS.Fed));f.forEach(e=>events.push({title:e.title,date:new Date(e.time).toISOString(),impact:'High',source:'Fed',url:PAGES.Fed}));sources.Fed={ok:true,count:f.length}}
 catch(e){sources.Fed={ok:false,count:0,error:e instanceof Error?e.message:'falhou'}}
 events.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 // Keep a refused source's previous events rather than dropping them for 6 hours.
 if(cache)for(const s of ['BLS','BEA','Fed'] as const)if(!sources[s].ok){events.push(...cache.events.filter(e=>e.source===s));sources[s].count=cache.events.filter(e=>e.source===s).length}
 cache={at:Date.now(),events:events.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)),sources};
 return cache;
}
