import type {Candle} from './indicators';

// CRT (Candle Range Theory), same model as strategy/aurum_strategy/setups.py and backtested there:
// H4 candles on the New York clock (opening 01, 05, 09, 13, 17, 21). When candle B, opening at 01, 05 or 09 NY,
// sweeps the high or low of candle A and closes back inside A's range, the bias is towards A's other side.
// Entry on M5 during the following H4 at the first close beyond the previous 2 bars; the stop sits beyond those
// bars and the trade is skipped when that is wider than Igor's session cap.
const H=3_600_000, M5=300_000, PIP=0.1, SWING=2, BUFFER=3, MIN_SL=10, TP=[20,50,80];
const round=(v:number)=>Math.round(v*100)/100;

function nthSundayUtc(year:number,month:number,n:number){const d=new Date(Date.UTC(year,month,1));d.setUTCDate(1+(7-d.getUTCDay())%7+(n-1)*7);return d.getTime()}
// US daylight time: 2nd Sunday of March 02:00 to 1st Sunday of November 02:00 local.
export function nyOffsetHours(t:number){const y=new Date(t).getUTCFullYear();return t>=nthSundayUtc(y,2,2)+7*H&&t<nthSundayUtc(y,10,1)+6*H?-4:-5}
const nyHour=(t:number)=>new Date(t+nyOffsetHours(t)*H).getUTCHours();
const capFor=(t:number)=>{const h=new Date(t).getUTCHours();return h>=13&&h<21?50:30};

type Box={start:number;nyHour:number;high:number;low:number;open:number;close:number;bars:number};
// Groups M5 into H4 boxes aligned to 01:00 NY. Partial boxes are kept (the latest one is still forming).
export function h4Boxes(m5:Candle[]):Box[]{
 const groups=new Map<number,Candle[]>();
 for(const b of m5){const local=b.time+nyOffsetHours(b.time)*H;const start=b.time-(((new Date(local).getUTCHours()-1)%4+4)%4)*H-new Date(local).getUTCMinutes()*60_000;(groups.get(start)??groups.set(start,[]).get(start)!).push(b)}
 return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([start,g])=>({start,nyHour:nyHour(start),high:Math.max(...g.map(x=>x.high)),low:Math.min(...g.map(x=>x.low)),open:g[0].open,close:g.at(-1)!.close,bars:g.length}));
}

export type CrtSetup={
 a:{start:number;high:number;low:number};
 b:{start:number;nyHour:number;high:number;low:number;close:number;complete:boolean};
 sweep:'alta'|'baixa'|null;               // which side of A was purged
 side:'buy'|'sell'|null;
 status:'b-formando'|'sem-setup'|'aguardando-quebra'|'entrada'|'descartado'|'expirado';
 detail:string;
 entry?:{time:number;price:number;sl:number;slPips:number;unit:'pips'|'usd';tps:{name:string;price:number}[];target:number;layer:{from:number;to:number}|null};
};
export type RuleEntry=NonNullable<CrtSetup['entry']>;

// Igor's rules on a structural trade (shared with lib/scalp.ts, same as strategy trades.plan): stop 3 pips beyond the
// invalidation, skipped when wider than the session cap, widened to 10 pips minimum; TP1 must fit before the target;
// 20/50/80 ladder capped at the target; protection layer 10–20 pips against when the stop leaves room for it.
export function rulePlan(side:'buy'|'sell',time:number,price:number,inval:number,target:number,targetName:string):{entry:RuleEntry}|{skip:string}{
 const d=side==='buy'?1:-1;
 let sl=inval-d*BUFFER*PIP, slPips=Math.round(Math.abs(price-sl)/PIP);
 const cap=capFor(time), room=(target-price)*d/PIP;
 if(slPips>cap)return {skip:`o stop técnico seria de ${slPips} pips, acima do seu limite de ${cap}`};
 if(room<TP[0])return {skip:`só ${Math.round(room)} pips até o alvo (menos que o TP1)`};
 if(slPips<MIN_SL){slPips=MIN_SL;sl=price-d*MIN_SL*PIP}
 const at=(p:number)=>round(price+d*p*PIP), finalPips=Math.min(TP[2],room);
 const tps=[...TP.filter(p=>p<finalPips).map((p,j)=>({name:'TP'+(j+1),price:at(p)})),{name:finalPips<TP[2]?targetName:'TP3',price:at(finalPips)}].slice(0,3);
 const to=Math.min(20,slPips-5);
 return {entry:{time,price:round(price),sl:round(sl),slPips,unit:'pips',tps,target:round(target),layer:to>=10?{from:at(-10),to:at(-to)}:null}};
}

// Evaluates every A/B pair whose B opens at 01, 05 or 09 NY within the M5 window; the last items are the most recent.
// rules=false (Bitcoin): same detection, but no gold pip caps or ladder; the entry shows the structural stop and the
// CRT target, with distances in USD.
export function crtSetups(m5:Candle[],now=Date.now(),rules=true):CrtSetup[]{
 const boxes=h4Boxes(m5), out:CrtSetup[]=[];
 const index=new Map(m5.map((b,i)=>[b.time,i]));
 for(let k=1;k<boxes.length;k++){
  const a=boxes[k-1], b=boxes[k];
  if(![1,5,9].includes(b.nyHour)||b.start-a.start!==4*H||a.bars<40)continue;
  // B counts as closed once its last M5 bars are in, or 15 min after its close if the provider skipped some.
  const complete=now>=b.start+4*H&&(b.bars>=46||now>=b.start+4*H+15*60_000);
  const base={a:{start:a.start,high:round(a.high),low:round(a.low)},b:{start:b.start,nyHour:b.nyHour,high:round(b.high),low:round(b.low),close:round(b.close),complete}};
  if(!complete){out.push({...base,sweep:b.high>a.high?'alta':b.low<a.low?'baixa':null,side:null,status:'b-formando',detail:'H4 de referência em formação: observar se varre a máxima ou a mínima do anterior e fecha de volta dentro.'});continue}
  const up=b.high>a.high, down=b.low<a.low, inside=b.close>a.low&&b.close<a.high;
  if(!inside||up===down){out.push({...base,sweep:up?'alta':down?'baixa':null,side:null,status:'sem-setup',detail:!inside?'O H4 fechou fora da faixa do anterior: não é CRT.':up&&down?'Varreu os dois lados: não é CRT.':'Não varreu nenhum lado: não é CRT.'});continue}
  const side=up?'sell':'buy', target=side==='sell'?a.low:a.high;
  const setup:CrtSetup={...base,sweep:up?'alta':'baixa',side,status:'aguardando-quebra',detail:`Varreu a ${up?'máxima':'mínima'} e fechou dentro. Aguardando quebra de estrutura no M5 a favor da ${side==='sell'?'venda':'compra'} até ${new Date(b.start+8*H).toISOString().slice(11,16)} UTC.`};
  const startI=index.get(b.start+4*H);
  if(startI!==undefined)for(let i=Math.max(startI,SWING);i<m5.length;i++){
   const bar=m5[i];
   if(bar.time>=b.start+8*H)break;
   const prev=m5.slice(i-SWING,i);
   const broke=side==='sell'?bar.close<Math.min(...prev.map(p=>p.low)):bar.close>Math.max(...prev.map(p=>p.high));
   if(!broke)continue;
   // The entry is the next bar's open; while that bar has not printed, the break's close is the reference.
   const next=m5[i+1], time=next?next.time:bar.time+M5, price=next?next.open:bar.close;
   const inval=side==='sell'?Math.max(...prev.map(p=>p.high),bar.high):Math.min(...prev.map(p=>p.low),bar.low);
   if(!rules){
    setup.status='entrada';
    setup.entry={time,price:round(price),sl:round(inval),slPips:Math.round(Math.abs(price-inval)),unit:'usd',tps:[{name:'Alvo CRT',price:round(target)}],target:round(target),layer:null};
    setup.detail=`Quebra de estrutura no M5: ${side==='sell'?'venda':'compra'} em ${round(price)}, invalidação em ${round(inval)} (${Math.round(Math.abs(price-inval))} USD). Alvo CRT em ${round(target)}.`;
    break;
   }
   const r=rulePlan(side,time,price,inval,target,'Alvo CRT');
   if('skip' in r){setup.status='descartado';setup.detail=`Quebra no M5 às ${new Date(bar.time).toISOString().slice(11,16)} UTC, mas ${r.skip}.`;break}
   setup.status='entrada';
   setup.entry=r.entry;
   setup.detail=`Quebra de estrutura no M5: ${side==='sell'?'venda':'compra'} em ${round(price)} com stop de ${r.entry.slPips} pips. Alvo CRT em ${round(target)}.`;
   break;
  }
  if(setup.status==='aguardando-quebra'&&now>=b.start+8*H){setup.status='expirado';setup.detail='O H4 seguinte terminou sem quebra de estrutura no M5: setup expirado.'}
  out.push(setup);
 }
 return out;
}
