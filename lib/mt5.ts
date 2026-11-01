import type {CrtSetup,RuleEntry} from './crt';
import type {ScalpSetup} from './scalp';

// Plain-text plan for the MT5 drawer (mt5/AurumPlano.mq5), which has no JSON parser: one record per line, fields split
// by "|", prices with a dot, times in Unix seconds (UTC). Same setups as the panel; nothing here places orders.
//   AURUM|1|<last M5 close time>|<last close>|<stale 0/1>
//   ASIA|<range start>|<range end>|<high>|<low>
//   PLAN|<id>|<label>|<buy/sell>|<entry time>|<entry>|<sl>|<sl pips>|<TP1:price,TP2:price,...>|<layer from>|<layer to>|<detail>
//   INFO|<label>|<status>|<detail>
type Data={candles:{time:number;close:number}[];stale?:boolean;scalp?:ScalpSetup;crt?:CrtSetup[]};
const DAY=86_400_000;
const clean=(s:string)=>s.replace(/[|\r\n]+/g,' ').trim();
const sec=(t:number)=>Math.floor(t/1000);

function plan(id:string,label:string,side:'buy'|'sell',e:RuleEntry,detail:string){
 return ['PLAN',id,label,side,sec(e.time),e.price,e.sl,e.slPips,e.tps.map(t=>`${clean(t.name)}:${t.price}`).join(','),e.layer?.from??'',e.layer?.to??'',clean(detail)].join('|');
}

export function mt5Plan(d:Data,now=Date.now()):string{
 const last=d.candles.at(-1);
 const out=[['AURUM',1,last?sec(last.time+300_000):0,last?.close??0,d.stale?1:0].join('|')];
 const s=d.scalp;
 if(s?.asia)out.push(['ASIA',sec(s.day),sec(s.day+7*3_600_000),s.asia.high,s.asia.low].join('|'));
 if(s){
  out.push(['INFO','Scalping Ásia',s.status,clean(s.detail)].join('|'));
  if(s.entry&&s.side)out.push(plan('scalp-'+sec(s.day),'Scalping Ásia',s.side,s.entry,s.detail));
 }
 // CRT entries from the last 24 hours; older ones are history, not plans.
 for(const c of d.crt??[])if(c.entry&&c.side&&c.entry.unit==='pips'&&now-c.entry.time<DAY)out.push(plan('crt-'+sec(c.b.start),'CRT',c.side,c.entry,c.detail));
 const lastCrt=d.crt?.at(-1);
 if(lastCrt)out.push(['INFO','CRT',lastCrt.status,clean(lastCrt.detail)].join('|'));
 return out.join('\n')+'\n';
}
