import type {Candle} from './indicators';
import {nyOffsetHours,rulePlan,type RuleEntry} from './crt';

// Asian-range sweep in the London killzone, same model as strategy/aurum_strategy/scalp.py (asia_sweep), the only
// scalping setup that stayed positive in both halves of the one-year M5 backtest. Asian range = 00–07 UTC. Between
// 02:00 and 05:00 New York (and not before 07 UTC) the first M5 bar that trades through the Asian high or low and
// closes back inside gives a trade against the sweep: entry at the next bar's open, invalidation at the sweep wick,
// target the other side of the range. Igor's rules (rulePlan) set the stop, ladder and layer. One setup per day.
const H=3_600_000, M5=300_000, DAY=86_400_000;
const round=(v:number)=>Math.round(v*100)/100;
const hm=(t:number)=>new Date(t).toISOString().slice(11,16);

export type ScalpSetup={
 day:number; asia:{high:number;low:number;bars:number}|null; window:{from:number;to:number};
 status:'asia-formando'|'aguardando'|'entrada'|'descartado'|'encerrado'|'sem-dados';
 side:'buy'|'sell'|null; sweep:{time:number;wick:number}|null; detail:string; entry?:RuleEntry;
};

export function asiaSweep(m5:Candle[],now=Date.now()):ScalpSetup{
 const day=Math.floor(now/DAY)*DAY, off=nyOffsetHours(day+8*H)*H;
 const window={from:Math.max(day+2*H-off,day+7*H),to:day+5*H-off};
 const base={day,window,side:null,sweep:null} as const;
 // Spot gold is closed from Friday ~21 UTC to Sunday ~22 UTC; the feed still prints flat placeholder bars then.
 if([0,6].includes(new Date(day).getUTCDay()))return {...base,asia:null,status:'sem-dados',detail:'Fim de semana: o ouro não negocia, não há faixa da Ásia nem setup hoje. Volta na segunda.'};
 const asiaBars=m5.filter(b=>b.time>=day&&b.time<day+7*H);
 if(!asiaBars.length)return {...base,asia:null,status:'sem-dados',detail:'Sem candles M5 da sessão asiática de hoje (fim de semana ou feed indisponível).'};
 // Detection uses the raw extremes (as the backtest does); only the displayed range is rounded.
 const hi=Math.max(...asiaBars.map(b=>b.high)), lo=Math.min(...asiaBars.map(b=>b.low));
 const asia={high:round(hi),low:round(lo),bars:asiaBars.length};
 if(now<day+7*H)return {...base,asia,status:'asia-formando',detail:`Faixa da Ásia em formação até 07:00 UTC. Depois, observar a varredura da máxima ou da mínima entre ${hm(window.from)} e ${hm(window.to)} UTC.`};
 // Same completeness rule as the backtest: at least 80% of the 84 Asian M5 bars.
 if(asiaBars.length<7*H/M5*0.8)return {...base,asia,status:'sem-dados',detail:`Só ${asiaBars.length} candles M5 na sessão asiática: faixa incompleta, setup não avaliado hoje.`};
 for(let i=0;i<m5.length;i++){
  const b=m5[i];
  if(b.time<window.from||b.time>=window.to)continue;
  const inside=b.close>lo&&b.close<hi;
  const side=b.high>hi&&inside?'sell':b.low<lo&&inside?'buy':null;
  if(!side)continue;
  const next=m5[i+1], time=next?next.time:b.time+M5, price=next?next.open:b.close;
  const wick=side==='sell'?b.high:b.low, target=side==='sell'?lo:hi;
  const sweep={time:b.time,wick:round(wick)}, word=side==='sell'?'venda':'compra';
  const r=rulePlan(side,time,price,wick,target,'Outro lado da Ásia');
  if('skip' in r)return {...base,asia,side,sweep,status:'descartado',detail:`Varreu a ${side==='sell'?'máxima':'mínima'} da Ásia às ${hm(b.time)} UTC e fechou dentro, mas ${r.skip}.`};
  return {...base,asia,side,sweep,status:'entrada',entry:r.entry,detail:`Varreu a ${side==='sell'?'máxima':'mínima'} da Ásia às ${hm(b.time)} UTC e fechou dentro: ${word} em ${r.entry.price} com stop de ${r.entry.slPips} pips, alvo no outro lado da faixa (${round(target)}).`};
 }
 if(now>=window.to)return {...base,asia,status:'encerrado',detail:`A janela de Londres (${hm(window.from)}–${hm(window.to)} UTC) terminou sem varredura da faixa da Ásia: sem setup hoje.`};
 return {...base,asia,status:'aguardando',detail:now<window.from?`Faixa da Ásia fechada. A janela de Londres abre às ${hm(window.from)} UTC.`:`Na janela de Londres até ${hm(window.to)} UTC: aguardando um M5 que fure a máxima ou a mínima da Ásia e feche de volta dentro.`};
}
