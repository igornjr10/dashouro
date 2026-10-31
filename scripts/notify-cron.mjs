// Schedules the Telegram alerts: Supabase pg_cron calls /api/notify every 5 minutes, Monday to Friday (UTC), through
// pg_net with the access token. Run after the deploy that has /api/notify and the Telegram variables:
//   node --env-file=.env.local scripts/notify-cron.mjs [https://your-site]      (default: the production URL)
//   node --env-file=.env.local scripts/notify-cron.mjs --off                    (removes the schedule)
import postgres from 'postgres';

const url=process.env.POSTGRES_URL_NON_POOLING, token=process.env.AURUM_ACCESS_TOKEN;
if(!url||!token){console.error('POSTGRES_URL_NON_POOLING e AURUM_ACCESS_TOKEN são necessários no ambiente.');process.exit(1)}
// The token is written into the job's SQL text, so only plain characters are accepted.
if(!/^[\w.~-]+$/.test(token)){console.error('AURUM_ACCESS_TOKEN tem caracteres especiais; use só letras, números, - _ . ~');process.exit(1)}
const arg=process.argv[2]??'https://dashouro-sigma.vercel.app';
const sql=postgres(url,{ssl:'require',max:1,onnotice:()=>{}});
try{
 await sql`create extension if not exists pg_cron`;
 await sql`create extension if not exists pg_net`;
 await sql`select cron.unschedule(jobid) from cron.job where jobname='aurum-notify'`;
 if(arg==='--off')console.log('agendamento removido');
 else{
  const endpoint=new URL('/api/notify',arg).toString();
  const headers=JSON.stringify({'X-Aurum-Access':token});
  await sql`select cron.schedule('aurum-notify','*/5 * * * 1-5',${`select net.http_get(url:='${endpoint}',headers:='${headers}'::jsonb,timeout_milliseconds:=30000)`})`;
  console.log('agendado: a cada 5 min, seg–sex (UTC) →',endpoint);
 }
}finally{await sql.end()}
