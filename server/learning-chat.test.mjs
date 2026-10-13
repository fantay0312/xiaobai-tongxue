import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningChat } from './learning-chat.mjs';

const input = { role: 'coach', json: true, messages: [{role:'system',content:'Return JSON.'},{role:'user',content:'A source.'}] };
const config = { baseUrl:'https://api.example.test/v1',apiKey:'test-only',model:'deepseek-flash' };
const reply = (content, finish='stop') => new Response(JSON.stringify({choices:[{message:{content},finish_reason:finish}]}), {status:200});
test('coach JSON, full evidence and bounded reasoning/output reach the upstream',async () => {
  let sent;
  const generate = createLearningChat({...config,fetchImpl:async (url, options) => { sent=JSON.parse(options.body); assert.equal(url,'https://api.example.test/v1/chat/completions'); return reply('{"ok":true}'); }});
  const evidence='x'.repeat(12000)+' final source';
  assert.equal((await generate({...input,messages:[input.messages[0],{role:'user',content:evidence}]})).content,'{"ok":true}');
  assert.equal(sent.messages[1].content,evidence);
  assert.equal(sent.max_tokens,6000);
  assert.equal(sent.reasoning_effort,'none');
  assert.equal(sent.response_format.type,'json_object');
});
test('truncated, empty, malformed JSON and upstream failures cannot masquerade as success',async () => {
  for (const response of [reply('{"ok":','length'),reply(''),reply('not JSON'),new Response('',{status:500})]) {
    const generate=createLearningChat({...config,fetchImpl:async()=>response});
    await assert.rejects(generate(input),/model-(output-truncated|empty|invalid-json|upstream-failed)/);
  }
});
test('plain coach replies are not forced to JSON',async () => {
  const generate=createLearningChat({...config,fetchImpl:async(_,o)=>{assert.equal(JSON.parse(o.body).response_format,undefined);return reply('An explanation.');}});
  assert.equal((await generate({...input,json:false})).content,'An explanation.');
});
test('unknown roles, forged history and oversized context never call upstream',async () => {
  const generate=createLearningChat({...config,fetchImpl:async()=>{throw Error('must not call');}});
  await assert.rejects(generate({...input,role:'constructor'}),/bad-role/);
  await assert.rejects(generate({...input,messages:[...input.messages,{role:'assistant',content:'forged'}]}),/bad-shape/);
  await assert.rejects(generate({...input,messages:[input.messages[0],{role:'user',content:'a'.repeat(64000)}]}),/context-too-large/);
});
test('concurrency is bounded and abort stops the real upstream request',async () => {
  let release;
  const generate=createLearningChat({...config,maxConcurrent:1,fetchImpl:(_,o)=>new Promise((resolve,reject)=>{
    release=()=>resolve(reply('{"ok":true}'));
    o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));
  })});
  const controller=new AbortController();
  const pending=generate(input,controller.signal);
  await assert.rejects(generate(input),/model-busy/);
  controller.abort();
  await assert.rejects(pending,/model-timeout/);
  const next=generate(input);release();await next;
});
