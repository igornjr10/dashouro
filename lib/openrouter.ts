export const FREE_MODEL = 'openrouter/free';

export class RouterError extends Error {
 constructor(message:string, public status=502){super(message)}
}
export function routerFailure(status:number):RouterError {
 const messages:Record<number,string>={
  401:'Chave OpenRouter inválida ou revogada. Conecte novamente.',
  402:'O OpenRouter recusou a cota desta chave. O Aurum não usará modelos pagos.',
  403:'OpenRouter bloqueou esta solicitação. Confira as permissões da conta.',
  404:'Nenhum modelo gratuito elegível está disponível agora. Tente mais tarde.',
  429:'Limite gratuito atingido. Aguarde a renovação da cota antes de tentar novamente.',
  503:'Modelos gratuitos temporariamente indisponíveis. Tente mais tarde.'
 };
 return new RouterError(messages[status]||'OpenRouter indisponível. Nenhuma análise foi gerada.',status>=400&&status<600?status:502);
}
export function requestKey(request:Request, serverKey?:string):string {
 const key=request.headers.get('X-Aurum-OpenRouter-Key')?.trim()||serverKey?.trim();
 if(!key)throw new RouterError('Conecte sua chave OpenRouter para gerar uma análise real.',503);
 if(!/^sk-or-v1-[A-Za-z0-9_-]{20,256}$/.test(key))throw new RouterError('Formato de chave OpenRouter inválido.',400);
 return key;
}
export async function checkRouterKey(key:string){
 const r=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw routerFailure(r.status);
 const j=await r.json() as {data?:{free_model_daily_requests?:{used:number;limit:number;remaining:number}}};
 if(!j.data)throw new RouterError('Não foi possível validar a conexão.');
 const q=j.data.free_model_daily_requests;
 const quota=q&&[q.used,q.limit,q.remaining].every(v=>Number.isFinite(v)&&v>=0)?q:null;
 return {connected:true,provider:'OpenRouter',model:FREE_MODEL,quota};
}
export async function generateInsight(key:string,instructions:string,context:unknown){
 const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(60000),
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'X-OpenRouter-Title':'Aurum'},
  body:JSON.stringify({model:FREE_MODEL,max_tokens:1200,stream:false,
   provider:{max_price:{prompt:0,completion:0},data_collection:'deny'},
   messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(context)}]})
 });
 if(!r.ok)throw routerFailure(r.status);
 const j=await r.json() as {error?:{code?:number};model?:string;choices?:Array<{finish_reason?:string;message?:{content?:string}}>};
 if(j.error)throw routerFailure(j.error.code||502);
 const choice=j.choices?.[0];
 if(choice?.finish_reason==='length')throw new RouterError('A resposta ficou incompleta. Nenhuma análise parcial será apresentada.');
 const text=choice?.message?.content;
 if(typeof text!=='string'||!text.trim())throw new RouterError('O modelo não retornou uma análise. Tente novamente mais tarde.');
 return {text,model:j.model||FREE_MODEL,provider:'OpenRouter'};
}
