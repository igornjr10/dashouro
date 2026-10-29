// Applies db/supabase/*.sql in order. Run: node --env-file=.env.local scripts/db-migrate.mjs
import {readdirSync,readFileSync} from 'node:fs';
import postgres from 'postgres';

const url=process.env.POSTGRES_URL_NON_POOLING;
if(!url){console.error('POSTGRES_URL_NON_POOLING ausente no ambiente.');process.exit(1)}
const sql=postgres(url,{ssl:'require',max:1,onnotice:()=>{}});
const dir=new URL('../db/supabase/',import.meta.url);
try{
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
  await sql.unsafe(readFileSync(new URL(f,dir),'utf8'));
  console.log('ok',f);
 }
 const t=await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('predictions','trade_checks') order by 1`;
 console.log('tabelas:',t.map(r=>r.table_name).join(', '));
}finally{await sql.end()}
