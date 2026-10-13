import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createLearningAnswerRouter} from './learning-answer-router.mjs';

test('learning transport retains auth, quota, streamed errors and disconnect cancellation',async(t)=>{
  let calls=0,allowed=true,aborted=false,started;
  const startedPromise=new Promise(resolve=>{started=resolve;});
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const router=createLearningAnswerRouter({
    service:{answer:async(_owner,input,signal,emit)=>{
      calls++;await emit('stage',{id:'model',label:'Generating',status:'running'});
      if(input.cancel){started();await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return {};}
      if(input.error)throw new Error('internal-secret-must-not-be-exposed');
      await emit('done',{text:'answer',sources:[]});return {model:'test'};
    }},
    resolveOwner:async(req,res)=>{if(!req.headers['x-test-user']){send(res,401,{error:'login-required'});return null;}return{id:'owner'};},
    reserveCalls:async(_owner,res)=>{if(!allowed)send(res,429,{error:'rate-limited'});return allowed;},
    send,hasJsonContentType:req=>req.headers['content-type']==='application/json',
    readJson:async req=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);},
  });
  const server=http.createServer((req,res)=>void router.handle(req,res,req.url));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json','X-Test-User':'owner',Origin:base};
  const call=(body={},extra={})=>fetch(`${base}/api/learning/answer`,{method:'POST',headers,...extra,body:JSON.stringify(body)});
  assert.equal((await fetch(`${base}/api/learning/status`)).status,401);
  assert.equal((await call({}, {headers:{...headers,Origin:'https://unrelated.test'}})).status,403);
  allowed=false;assert.equal((await call()).status,429);assert.equal(calls,0);allowed=true;
  assert.match(await (await call()).text(),/event: done/);
  const error=await(await call({error:true})).text();assert.match(error,/learning-answer-failed/);assert.doesNotMatch(error,/internal-secret/);
  const controller=new AbortController();
  const response=await call({cancel:true},{signal:controller.signal});await startedPromise;controller.abort();
  await response.text().catch(()=>{});
  for(let i=0;i<20&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(aborted,true);
});
