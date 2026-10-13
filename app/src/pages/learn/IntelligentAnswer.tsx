import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createLibrary, createParser, defineComponent, Renderer } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { learningUiText, type LearningInteraction, type LearningUi } from '../../../../server/shared/learning-ui.mjs';
import type { StudySource } from '../../engine/studyWorkspace';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Icon } from '../../components/ui/Icon';
import styles from './intelligent.module.css';

interface Context { sources:StudySource[];interaction:LearningInteraction;onChange:(id:string,state:LearningInteraction[string])=>void;onAsk:(text:string)=>void;onSource:(source:StudySource)=>void;onSave:(text:string)=>void; }
const AnswerContext=createContext<Context>({sources:[],interaction:{},onChange:()=>{},onAsk:()=>{},onSource:()=>{},onSave:()=>{}});
const base={id:z.string(),title:z.string(),sourceIds:z.array(z.string())};

export function LearningSources({sources,onSource}:{sources:StudySource[];onSource:(source:StudySource)=>void}) {
  return <details className={styles.sourceList}><summary><Icon name="files" size={13}/>{sources.length} 处来源<Icon name="chevron-down" size={12}/></summary><div>{sources.map((source,index)=><button key={source.id} onClick={()=>onSource(source)}><span>[{index+1}]</span>{source.title}</button>)}</div></details>;
}

function SourceLinks({ids}:{ids:string[]}) {
  const context=useContext(AnswerContext);
  return <div className={styles.sources}>{ids.map((id)=>{const index=context.sources.findIndex((source)=>source.id===id);const source=context.sources[index];return source&&<button key={id} onClick={()=>context.onSource(source)} title={source.title}><Icon name="file" size={12}/>来源 {index+1}<span>{source.title}</span></button>;})}</div>;
}
const Concept=defineComponent({name:'Concept',description:'A sourced explanation',props:z.object({item:z.object({...base,type:z.literal('concept'),body:z.string()})}),component:({props:{item}})=><section className={styles.concept}><h3>{item.title}</h3><CoachMarkdown text={item.body}/><SourceLinks ids={item.sourceIds}/></section>});
const Comparison=defineComponent({name:'Comparison',description:'A sourced side-by-side comparison',props:z.object({item:z.object({...base,type:z.literal('comparison'),columns:z.array(z.string()),rows:z.array(z.object({label:z.string(),values:z.array(z.string())}))})}),component:({props:{item}})=><section className={styles.comparison}><h3>{item.title}</h3><div className={styles.tableScroll}><table><thead><tr><th scope="col">比较维度</th>{item.columns.map((column,i)=><th scope="col" key={i}>{column}</th>)}</tr></thead><tbody>{item.rows.map((row,i)=><tr key={i}><th scope="row">{row.label}</th>{row.values.map((value,j)=><td key={j}>{value}</td>)}</tr>)}</tbody></table></div><SourceLinks ids={item.sourceIds}/></section>});
const Quiz=defineComponent({name:'Quiz',description:'An interactive self-check',props:z.object({item:z.object({...base,type:z.literal('quiz'),question:z.string(),options:z.array(z.string()),answerIndex:z.number(),explanation:z.string()})}),component:function StudyQuiz({props:{item}}){
  const context=useContext(AnswerContext),state=context.interaction[item.id]||{};
  const correct=state.choice===item.answerIndex;
  return <section className={styles.quiz} aria-label={item.title}><div className={styles.blockHeading}><Icon name="circle-help" size={18}/><h3>{item.title}</h3><span>自主练习</span></div><p className={styles.question}>{item.question}</p><div className={styles.options}>{item.options.map((option,index)=><button key={index} aria-pressed={state.choice===index} disabled={state.revealed} data-result={state.revealed?(index===item.answerIndex?'correct':index===state.choice?'wrong':undefined):undefined} onClick={()=>context.onChange(item.id,{choice:index,revealed:false})}><span>{String.fromCharCode(65+index)}</span>{option}{state.revealed&&index===item.answerIndex&&<Icon name="check" size={16}/>}</button>)}</div>
    {state.revealed?<div className={styles.feedback} data-correct={correct} role="status"><strong>{correct?'回答正确':'再看一遍这个概念'}</strong><CoachMarkdown text={item.explanation}/><button onClick={()=>context.onChange(item.id,{revealed:false})}>重新作答</button>{!correct&&<button onClick={()=>context.onAsk(`请讲解这道题的关键概念：${item.question}`)}>请小砚讲解<Icon name="arrow-right" size={13}/></button>}</div>:<button className={styles.checkAnswer} disabled={state.choice===undefined} onClick={()=>context.onChange(item.id,{...state,revealed:true})}>检查答案<Icon name="arrow-right" size={14}/></button>}
    <SourceLinks ids={item.sourceIds}/></section>;
}});
const Flashcard=defineComponent({name:'Flashcard',description:'A question with a revealable answer',props:z.object({item:z.object({...base,type:z.literal('flashcard'),front:z.string(),back:z.string()})}),component:function StudyFlashcard({props:{item}}){
  const context=useContext(AnswerContext),revealed=context.interaction[item.id]?.revealed;
  return <section className={styles.flashcard}><h3>{item.title}</h3><p className={styles.question}>{item.front}</p>{revealed&&<div className={styles.flashAnswer}><CoachMarkdown text={item.back}/></div>}<button className={styles.checkAnswer} aria-expanded={!!revealed} onClick={()=>context.onChange(item.id,{revealed:!revealed})}>{revealed?'收起答案':'想好了，查看答案'}<Icon name="chevron-down" size={14}/></button><SourceLinks ids={item.sourceIds}/></section>;
}});
const Plan=defineComponent({name:'Plan',description:'A checklist learning plan with locally saved progress',props:z.object({item:z.object({...base,type:z.literal('plan'),steps:z.array(z.object({title:z.string(),detail:z.string(),minutes:z.number()}))})}),component:function StudyPlan({props:{item}}){
  const context=useContext(AnswerContext),checked=context.interaction[item.id]?.checked||[];
  return <section className={styles.plan}><div className={styles.blockHeading}><Icon name="route" size={18}/><h3>{item.title}</h3><span>{checked.length}/{item.steps.length} 完成</span></div><div className={styles.planSteps}>{item.steps.map((step,index)=><label key={index} data-done={checked.includes(index)}><input type="checkbox" checked={checked.includes(index)} onChange={(event)=>context.onChange(item.id,{checked:event.target.checked?[...checked,index]:checked.filter((value)=>value!==index)})}/><span><strong>{step.title}</strong><small>{step.detail}</small></span><time>{step.minutes} 分钟</time></label>)}</div><div className={styles.planFooter}><span>勾选仅记录学习进度</span><button onClick={()=>context.onSave(`${item.title}\n\n${item.steps.map((step,index)=>`${checked.includes(index)?'☑':'☐'} ${step.title}（${step.minutes} 分钟）\n${step.detail}`).join('\n\n')}`)}><Icon name="notebook" size={13}/>保存计划到便笺</button></div><SourceLinks ids={item.sourceIds}/></section>;
}});
const LearningAnswer=defineComponent({name:'LearningAnswer',description:'A sourced interactive learning response',props:z.object({children:z.array(z.union([Concept.ref,Comparison.ref,Quiz.ref,Flashcard.ref,Plan.ref]))}),component:({props,renderNode})=><div className={styles.blocks}>{props.children.map((child,index)=><div key={index}>{renderNode(child)}</div>)}</div>});
const learningUiLibrary=createLibrary({root:'LearningAnswer',components:[LearningAnswer,Concept,Comparison,Quiz,Flashcard,Plan]});

function learningUiProgram(ui:LearningUi) {
  const names={concept:'Concept',comparison:'Comparison',quiz:'Quiz',flashcard:'Flashcard',plan:'Plan'};
  return `root = LearningAnswer([${ui.blocks.map((block)=>`${names[block.type]}(${JSON.stringify(block)})`).join(',')}])`;
}

export function IntelligentAnswer({ui,sources,interaction,onChange,onAsk,onSource,onSave}:{ui:LearningUi;sources:StudySource[];interaction:LearningInteraction;onChange:Context['onChange'];onAsk:Context['onAsk'];onSource:Context['onSource'];onSave:Context['onSave']}) {
  const [plain,setPlain]=useState(false),[rendererError,setRendererError]=useState(false);
  const program=useMemo(()=>learningUiProgram(ui),[ui]);
  const valid=useMemo(()=>{const parsed=createParser(learningUiLibrary.toJSONSchema(),'LearningAnswer').parse(program);return Boolean(parsed.root)&&!parsed.meta.errors?.length&&!parsed.meta.unresolved?.length;},[program]);
  const onError=useCallback((errors:{severity?:string}[])=>{if(errors.some((error)=>error.severity!=='warning'))setRendererError(true);},[]);
  return <AnswerContext.Provider value={{sources,interaction,onChange,onAsk,onSource,onSave}}><div className={styles.answer}>
    <CoachMarkdown text={plain?learningUiText(ui):ui.summary}/>
    {!plain&&valid&&!rendererError&&<Renderer response={program} library={learningUiLibrary} onError={onError} publishObservability={false}/>}
    {!plain&&(!valid||rendererError)&&<><p role="status">互动内容暂时无法显示，以下是文字版本。</p><CoachMarkdown text={learningUiText(ui)}/></>}
    <div className={styles.answerFooter}><button onClick={()=>setPlain(!plain)}><Icon name={plain?'grid':'file'} size={13}/>{plain?'显示互动内容':'显示纯文字'}</button></div>
    {!!ui.followUps.length&&<div className={styles.followUps} aria-label="继续探索">{ui.followUps.map((question,index)=><button key={index} onClick={()=>onAsk(question)}>{question}<Icon name="arrow-right" size={14}/></button>)}</div>}
  </div></AnswerContext.Provider>;
}
