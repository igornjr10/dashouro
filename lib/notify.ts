import type {CrtSetup} from './crt';
import type {ScalpSetup} from './scalp';

// Telegram alerts for gold, run every 5 minutes by a scheduler (see scripts/notify-cron.mjs). Each alert has a key and
// is sent once: `claim` records the key in the database and answers false when it was already there.
type Event={title:string;date:string;impact:string};
type Candles={crt?:CrtSetup[];scalp?:ScalpSetup;stale:boolean};
type Msg={key:string;text:string};

const H=3_600_000;
const brt=(t:number)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const num=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const word=(s:'buy'|'sell')=>s==='buy'?'COMPRA':'VENDA';
const plan=(e:NonNullable<ScalpSetup['entry']>)=>[`Entrada ${num(e.price)}`,`SL ${num(e.sl)} (${e.slPips} pips)`,...e.tps.map(t=>`${t.name} ${num(t.price)}`),...(e.layer?[`Camada ${num(e.layer.from)} – ${num(e.layer.to)}`]:[])].join('\n');

export function alerts(c:Candles,events:Event[],now:number):Msg[]{
 const out:Msg[]=[];
 const s=c.scalp;
 if(!c.stale&&s){
  // Summary before the London window: Asian range, CRT state and today's high-impact USD events.
  if(s.asia&&s.status==='aguardando'&&now>=s.window.from-45*60_000&&now<s.window.from){
   const today=events.filter(e=>e.impact==='High'&&Date.parse(e.date)>=now&&Date.parse(e.date)<s.day+24*H);
   const crt=c.crt?.at(-1);
   out.push({key:'summary:'+s.day,text:[`☀️ Ouro · antes de Londres`,`Ásia: máx ${num(s.asia.high)} · mín ${num(s.asia.low)}`,`Janela do scalping: ${brt(s.window.from)} – ${brt(s.window.to)} (Brasília)`,crt?`CRT: ${crt.detail}`:'',today.length?'Alto impacto hoje:\n'+today.map(e=>`• ${brt(Date.parse(e.date))} ${e.title}`).join('\n'):'Sem evento USD de alto impacto hoje.'].filter(Boolean).join('\n')});
  }
  if(s.status==='entrada'&&s.entry&&s.side&&now-s.entry.time<30*60_000)out.push({key:'scalp:'+s.day,text:`⚡ Scalping · ${word(s.side)} XAU/USD\nVarredura da Ásia em Londres\n${plan(s.entry)}\nTP1 → SL no BE. Confira preço e spread na Exness.`});
 }
 // CRT: the sweep once confirmed, then the M5 entry (gold rules only; skipped or expired setups stay silent).
 for(const x of c.stale?[]:(c.crt??[]).slice(-2)){
  if(!x.side)continue;
  if(x.status==='aguardando-quebra')out.push({key:`crt:${x.b.start}:sweep`,text:`🎯 CRT · varredura confirmada para ${word(x.side).toLowerCase()}\n${x.detail}`});
  if(x.status==='entrada'&&x.entry&&x.entry.unit==='pips'&&now-x.entry.time<30*60_000)out.push({key:`crt:${x.b.start}:entry`,text:`🎯 CRT · ${word(x.side)} XAU/USD\n${plan(x.entry)}\nTP1 → SL no BE. Confira preço e spread na Exness.`});
 }
 for(const e of events){
  const t=Date.parse(e.date);
  if(e.impact==='High'&&t>now&&t-now<=20*60_000)out.push({key:`event:${e.title}:${e.date}`,text:`⚠️ ${e.title} às ${brt(t)} (em ${Math.ceil((t-now)/60_000)} min)\nAs avaliações bloqueiam entradas 30 min antes e 15 min depois.`});
 }
 return out;
}

// Claim first so two overlapping runs never send the same alert; a failed send releases the key for the next run.
export async function sendAlerts(msgs:Msg[],claim:(key:string)=>Promise<boolean>,send:(text:string)=>Promise<void>,release:(key:string)=>Promise<void>){
 const sent:string[]=[];
 for(const m of msgs){
  if(!await claim(m.key))continue;
  try{await send(m.text);sent.push(m.key)}catch(e){await release(m.key).catch(()=>{});throw e}
 }
 return sent;
}
