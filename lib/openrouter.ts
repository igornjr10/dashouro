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
export async function generateInsight(key:string,instructions:string,context:unknown,json=false){
 const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(90000),
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'X-OpenRouter-Title':'Aurum'},
  // Free models are often reasoning models whose thinking counts against max_tokens (one spent ~2.9k of 4k thinking and
  // ran out mid-answer). Cap the thinking where supported and leave ample room for the answer.
  body:JSON.stringify({model:FREE_MODEL,max_tokens:8000,reasoning:{max_tokens:1500,exclude:true},stream:false,...(json?{response_format:{type:'json_object'}}:{}),
   provider:{max_price:{prompt:0,completion:0},data_collection:'deny'},
   messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(context)}]})
 });
 if(!r.ok)throw routerFailure(r.status);
 const j=await r.json() as {error?:{code?:number};model?:string;usage?:{completion_tokens?:number;completion_tokens_details?:{reasoning_tokens?:number}};choices?:Array<{finish_reason?:string;message?:{content?:string}}>};
 if(j.error)throw routerFailure(j.error.code||502);
 const choice=j.choices?.[0];
 const used=j.usage?.completion_tokens, thinking=j.usage?.completion_tokens_details?.reasoning_tokens;
 const text=choice?.message?.content;
 // A cut-off reply can still hold a complete JSON object; hand it to the caller's parser and fail only if it cannot be read.
 if(choice?.finish_reason==='length'&&typeof text==='string'&&text.includes('{')&&text.includes('}'))return {text,model:j.model||FREE_MODEL,provider:'OpenRouter',truncated:true};
 if(choice?.finish_reason==='length')throw new RouterError('A resposta ficou incompleta. Nenhuma análise parcial será apresentada.'+(used?` (${j.model||'modelo'}: ${used} tokens, ${thinking??'?'} de raciocínio)`:''));
 if(typeof text!=='string'||!text.trim())throw new RouterError('O modelo não retornou uma análise. Tente novamente mais tarde.');
 return {text,model:j.model||FREE_MODEL,provider:'OpenRouter',truncated:false};
}
