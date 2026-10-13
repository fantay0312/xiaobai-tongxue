import { API_BASE, gatewayFetch } from './api';
import type { NotebookSource } from '../engine/notebookSources';
import type { StudyMessage, StudySource } from '../engine/studyWorkspace';
import { validateLearningUi, type LearningUi } from '../../../server/shared/learning-ui.mjs';

export interface LearningStep { id:string;label:string;status:'running'|'done'|'stopped'|'error';at:number; }
export interface LearningRun { status:'running'|'complete'|'stopped'|'failed';startedAt:number;elapsedMs:number;steps:LearningStep[]; }
export type LearningEvent = {type:'stage';id:string;label:string;status:'running'|'done'} | {type:'text';text:string} | {type:'sources';sources:StudySource[]} | {type:'done';text:string;ui?:LearningUi;sources:StudySource[]};

export async function learningAnswerAvailable(signal:AbortSignal) {
  try { const response=await gatewayFetch(`${API_BASE}/learning/status`,{signal});return response.ok && (await response.json()).generativeUi===true; } catch {return false;}
}

export function learningSelection(sources:NotebookSource[],topicId:string) {
  return {includeLecture:sources.some((source)=>source.id===`lecture:${topicId}`),
    exampleIndices:sources.filter((source)=>source.kind==='example').map((source)=>Number(source.id.split(':').at(-1))),
    assetIds:sources.filter((source)=>source.kind==='asset').map((source)=>source.assetId),
    libraryFileIds:sources.filter((source)=>source.kind==='library').map((source)=>source.libraryFileId),
    textSources:sources.filter((source)=>source.kind==='text').map(({id,title,content})=>({id,title,content:content.slice(0,4000)}))};
}

export async function streamLearningAnswer(input:{question:string;topicId:string;sources:NotebookSource[];history:StudyMessage[];mode:string;format:'auto'|'text';signal:AbortSignal;onEvent:(event:LearningEvent)=>void}) {
  const response=await gatewayFetch(`${API_BASE}/learning/answer`,{method:'POST',headers:{'Content-Type':'application/json'},signal:input.signal,
    body:JSON.stringify({question:input.question,topicId:input.topicId||'library',selection:learningSelection(input.sources,input.topicId),
      history:input.history.slice(-6).map(({role,text})=>({role,text:text.slice(0,700)})),mode:input.mode,format:input.format})});
  if (!response.ok || !response.body) throw new Error(`learning-http-${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('learning-stream-required');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',finished=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};input.signal.addEventListener('abort',abort,{once:true});
  try {
    while(!finished){
      if(input.signal.aborted) throw new DOMException('Stopped','AbortError');
      const {done,value}=await reader.read();if(done)break;
      buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      if(buffer.length>128000)throw new Error('learning-stream-too-large');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const type=raw.split('\n').find((line)=>line.startsWith('event:'))?.slice(6).trim();
        const payload=raw.split('\n').filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trimStart()).join('\n');
        if(!payload)continue;
        const data=JSON.parse(payload);
        if(type==='error')throw new Error(data.code||'learning-failed');
        if(type==='stage'&&['sources','model','validate'].includes(data.id)&&typeof data.label==='string'&&['running','done'].includes(data.status))input.onEvent({type,...data});
        else if(type==='text'&&typeof data.text==='string')input.onEvent({type,text:data.text.slice(0,16000)});
        else if(type==='sources'&&Array.isArray(data.sources))input.onEvent({type,sources:data.sources});
        else if(type==='done'){
          if(typeof data.text!=='string'||!Array.isArray(data.sources))throw new Error('learning-invalid-answer');
          const ui=data.ui?validateLearningUi(data.ui,data.sources):undefined;
          input.onEvent({type,text:data.text,ui,sources:data.sources});finished=true;
        }
      }
    }
    if(input.signal.aborted)throw new DOMException('Stopped','AbortError');
    if(!finished)throw new Error('learning-stream-incomplete');
  } finally {input.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
