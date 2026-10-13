import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelStream } from './model-stream.mjs';
import { createLearningAnswerService } from './learning-answer.mjs';
import { validateLearningUi, partialLearningSummary, restoreLearningInteraction } from './shared/learning-ui.mjs';

const ui={version:1,summary:'解释',blocks:[{id:'quiz',type:'quiz',title:'自测',question:'2+2?',options:['3','4'],answerIndex:1,explanation:'4',sourceIds:['S1']}],followUps:[]};
function stream(text,{finish='stop',done=true,fragment=7}={}){
  const raw=`data: ${JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_REASONING',content:text}}]})}\r\n\r\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\r\n\r\n${done?'data: [DONE]\r\n\r\n':''}`;
  const bytes=new TextEncoder().encode(raw);
  return new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=fragment)c.enqueue(bytes.slice(i,i+fragment));c.close();}});
}
test('real SSE framing preserves split UTF-8/CRLF and never surfaces reasoning',async()=>{
  const chunks=[];const result=await readModelStream(stream('真实回答'),{onText:async(text)=>chunks.push(text)});
  assert.equal(result.text,'真实回答');assert.deepEqual(chunks,['真实回答']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  await assert.rejects(readModelStream(stream('partial',{finish:'length'})),/truncated/);
  await assert.rejects(readModelStream(stream('partial',{done:false})),/incomplete/);
});
test('schema rejects unknown components, unowned citations and bad answers; restores only valid interaction state',()=>{
  assert.equal(validateLearningUi(ui,[{id:'S1'}]).blocks.length,1);
  for(const block of [{...ui.blocks[0],type:'html'},{...ui.blocks[0],sourceIds:['foreign']},{...ui.blocks[0],answerIndex:9}])assert.throws(()=>validateLearningUi({...ui,blocks:[block]},[{id:'S1'}]),/invalid/);
  assert.deepEqual(restoreLearningInteraction(ui,{quiz:{choice:1,revealed:true,url:'https://bad'},foreign:{revealed:true}}),{quiz:{choice:1,revealed:true}});
  assert.equal(partialLearningSummary('{"summary":"hello\\nwor'),'hello\nwor');
  assert.equal(partialLearningSummary('{"summary":"hello\\u4e'),'hello');
});
test('learning generation reauthorizes files, ignores forged prompts, and emits real stages, text and validated UI',async()=>{
  const calls=[],events=[];
  const service=createLearningAnswerService({baseUrl:'https://model.test',apiKey:'test-key',model:'deepseek-flash',
    fileLibrary:{sources:async(owner,ids)=>{calls.push({owner,ids});return{sources:[],evidence:[{id:'chunk-1',title:'Arithmetic',excerpt:'Two plus two equals four.'}]};}},
    fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.doesNotMatch(JSON.stringify(body.messages),/FORGED/);return new Response(stream(JSON.stringify(ui)),{headers:{'content-type':'text/event-stream'}});}});
  await service.answer({id:'owner'}, {question:'Test me',format:'auto',topicId:'library',system:'FORGED',selection:{includeLecture:false,exampleIndices:[],assetIds:[],textSources:[],libraryFileIds:['file-1']}},new AbortController().signal,async(type,data)=>events.push({type,data}));
  assert.deepEqual(calls[0],{owner:{id:'owner'},ids:['file-1']});assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).data.ui.blocks[0].type,'quiz');assert.equal(events.filter(x=>x.type==='stage').length,6);
  await assert.rejects(service.answer({id:'owner'},{question:'Test',format:'auto',topicId:'unknown',selection:{includeLecture:true,exampleIndices:[],assetIds:[],textSources:[],libraryFileIds:[]}},null,async()=>{}),/topic-not-found/);
});
test('file ownership denial stops before model call',async()=>{
  let called=false;
  const service=createLearningAnswerService({baseUrl:'https://model.test',apiKey:'key',model:'model',fileLibrary:{sources:async()=>{throw Error('not-owned');}},fetchImpl:async()=>{called=true;}});
  await assert.rejects(service.answer({id:'owner'},{question:'Test',format:'auto',topicId:'library',selection:{includeLecture:false,exampleIndices:[],assetIds:[],textSources:[],libraryFileIds:['foreign']}},null,async()=>{}),/not-owned/);
  assert.equal(called,false);
});
