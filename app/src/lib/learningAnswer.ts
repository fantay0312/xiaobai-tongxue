import { API_BASE, gatewayFetch } from './api';
import type { NotebookSource } from '../engine/notebookSources';
import type { StudyMessage, StudySource } from '../engine/studyWorkspace';
import { tutorMemoryHints } from '../engine/tutorMemory';
import type { Effort } from '../store/modelPrefs';
import { validateLearningUi, type LearningUi } from '../../../server/shared/learning-ui.mjs';

export interface LearningStep { id:string;label:string;status:'running'|'done'|'stopped'|'error';at:number; }
export interface LearningRun { status:'running'|'complete'|'stopped'|'failed';startedAt:number;elapsedMs:number;steps:LearningStep[]; }
export type LearningEvent =
  | { type: 'stage'; id: string; label: string; status: 'running' | 'done' }
  | { type: 'text'; text: string }
  /** 思考过程，累计全文；只有选了思考强度时才会收到 */
  | { type: 'reasoning'; text: string }
  | { type: 'sources'; sources: StudySource[] }
  | { type: 'done'; text: string; ui?: LearningUi; sources: StudySource[]; model?: string; effort?: Effort };

export interface LearningAnswerInput {
  question: string;
  topicId: string;
  sources: NotebookSource[];
  history: StudyMessage[];
  mode: string;
  format: 'auto' | 'text';
  /** null 或省略 = 服务器默认模型 */
  model?: string | null;
  effort?: Effort;
  /** 账号标识，用来取小砚对这位学习者的记忆 */
  owner?: string | null;
  signal: AbortSignal;
  onEvent: (event: LearningEvent) => void;
}

const EFFORT_VALUES: readonly string[] = ['none', 'low', 'medium', 'high', 'max'];
const STAGE_ID = /^[a-z-]{1,24}$/;
const MAX_STAGE_EVENTS = 40;

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

/** 小砚的记忆要点：最多 8 条、每条 200 字。读取失败不影响提问。 */
function memoryHints(owner: string | null | undefined, topicId: string): string[] {
  try {
    return tutorMemoryHints(owner ?? null, topicId && topicId !== 'library' ? topicId : undefined, 8)
      .filter((line) => typeof line === 'string' && line.trim())
      .slice(0, 8)
      .map((line) => line.trim().slice(0, 200));
  } catch {
    return [];
  }
}

export async function streamLearningAnswer(input: LearningAnswerInput) {
  const memory = memoryHints(input.owner, input.topicId);
  const response=await gatewayFetch(`${API_BASE}/learning/answer`,{method:'POST',headers:{'Content-Type':'application/json'},signal:input.signal,
    body:JSON.stringify({question:input.question,topicId:input.topicId||'library',selection:learningSelection(input.sources,input.topicId),
      history:input.history.slice(-6).map(({role,text})=>({role,text:text.slice(0,700)})),mode:input.mode,format:input.format,
      ...(input.model ? { model: input.model.slice(0, 120) } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(memory.length ? { memory } : {})})});
  if (!response.ok || !response.body) throw new Error(`learning-http-${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('learning-stream-required');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',finished=false,stageEvents=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};input.signal.addEventListener('abort',abort,{once:true});
  try {
    while(!finished){
      if(input.signal.aborted) throw new DOMException('Stopped','AbortError');
      const {done,value}=await reader.read();if(done)break;
      buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      if(buffer.length>256000)throw new Error('learning-stream-too-large');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const type=raw.split('\n').find((line)=>line.startsWith('event:'))?.slice(6).trim();
        const payload=raw.split('\n').filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trimStart()).join('\n');
        if(!payload)continue;
        const data=JSON.parse(payload);
        if(type==='error')throw new Error(data.code||'learning-failed');
        if(type==='stage'){
          // 步骤 id 不再限死三种，但格式和总数都有上限
          if(typeof data.id==='string'&&STAGE_ID.test(data.id)&&typeof data.label==='string'&&['running','done'].includes(data.status)&&(stageEvents+=1)<=MAX_STAGE_EVENTS)
            input.onEvent({type,id:data.id,label:data.label.slice(0,80),status:data.status});
        }
        else if(type==='text'&&typeof data.text==='string')input.onEvent({type,text:data.text.slice(0,16000)});
        else if(type==='reasoning'&&typeof data.text==='string')input.onEvent({type,text:data.text.slice(0,24000)});
        else if(type==='sources'&&Array.isArray(data.sources))input.onEvent({type,sources:data.sources});
        else if(type==='done'){
          if(typeof data.text!=='string'||!Array.isArray(data.sources))throw new Error('learning-invalid-answer');
          const ui=data.ui?validateLearningUi(data.ui,data.sources):undefined;
          input.onEvent({type,text:data.text,ui,sources:data.sources,
            ...(typeof data.model==='string'?{model:data.model.slice(0,120)}:{}),
            ...(EFFORT_VALUES.includes(data.effort)?{effort:data.effort as Effort}:{})});
          finished=true;
        }
      }
    }
    if(input.signal.aborted)throw new DOMException('Stopped','AbortError');
    if(!finished)throw new Error('learning-stream-incomplete');
  } finally {input.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
