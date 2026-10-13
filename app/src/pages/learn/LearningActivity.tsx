import { useEffect, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import type { LearningRun } from '../../lib/learningAnswer';
import styles from './intelligent.module.css';

export function LearningActivity({run}:{run:LearningRun}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(run.status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[run.status]);
  const seconds=Math.max(0,Math.floor((run.status==='running'?now-run.startedAt:run.elapsedMs)/1000));
  const current=run.steps.find((step)=>step.status==='running');
  const title=run.status==='running'?current?.label||'正在连接学习服务':run.status==='complete'?'已完成':run.status==='stopped'?'已停止':'本次回答未完成';
  return <details className={styles.activity} data-state={run.status}>
    <summary><span className={styles.activityMark}>{run.status==='running'?<span className={styles.pulse}/>:<Icon name={run.status==='complete'?'check':'pause'} size={14}/>}</span><span>{title}</span><time>{seconds} 秒</time><Icon name="chevron-down" size={13}/></summary>
    <div className={styles.steps}>{run.steps.map((step)=><div key={step.id} data-state={step.status}><Icon name={step.status==='done'?'check':step.status==='error'?'x':'clock'} size={13}/><span>{step.label}</span></div>)}<p>显示资料检索与生成进度。</p></div>
  </details>;
}
