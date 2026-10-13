/** Authenticated SSE transport shared by the normal gateway and isolated deployments. */
export function createLearningAnswerRouter({service,resolveOwner,reserveCalls,send,readJson,hasJsonContentType}) {
  return {async handle(req,res,pathname) {
    const owner=await resolveOwner(req,res);if(!owner)return;
    if(pathname==='/api/learning/status'&&req.method==='GET')return send(res,200,{available:!!service,streaming:!!service,generativeUi:!!service,reasoning:!!service});
    if(pathname!=='/api/learning/answer'||req.method!=='POST')return send(res,404,{error:'not-found'});
    if(!service)return send(res,503,{error:'learning-unavailable'});
    if(!hasJsonContentType(req))return send(res,415,{error:'json-required'});
    if(req.headers.origin){
      try {if(new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'invalid-origin'});}
      catch {return send(res,403,{error:'invalid-origin'});}
    }
    if(!await reserveCalls(owner,res,1))return;
    const controller=new AbortController();
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};
    res.on('close',disconnected);
    const emit=async(event,data)=>{
      if(res.destroyed||controller.signal.aborted)return;
      if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const input=await readJson(req,128000);
      const result=await service.answer(owner,input,controller.signal,emit);
      console.log('[learning-answer]',JSON.stringify(result));
    }catch(error){
      if(!controller.signal.aborted){
        const code=['learning-ui-invalid','model-output-truncated','model-stream-incomplete','study-busy','study-selection-invalid','study-material-required'].includes(error.message)?error.message:'learning-answer-failed';
        if(res.headersSent)await emit('error',{code});
        else send(res,error.message==='body-too-large'?413:error.status||502,{error:code});
      }
    }finally{res.off('close',disconnected);if(!res.writableEnded)res.end();}
  }};
}
