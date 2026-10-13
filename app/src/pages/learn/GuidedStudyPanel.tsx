import { Link } from 'react-router';
import { useEffect, useRef } from 'react';
import type { Topic } from '../../types';
import { completeStudyScene, restoreGuidedProgress, sceneQuestionContext, studyScenes, type GuidedProgress } from '../../engine/guidedStudy';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Icon } from '../../components/ui/Icon';
import s from './learn.module.css';
import g from './guided.module.css';

export function GuidedStudyPanel({ topic, saved, onSave, onAsk, includeSelfTests = true }: {
  topic: Topic; saved?: GuidedProgress; onSave: (value: GuidedProgress) => void;
  onAsk: (text: string) => void;
  includeSelfTests?: boolean;
}) {
  const scenes = studyScenes(topic, includeSelfTests);
  const progress = restoreGuidedProgress(scenes, saved);
  const index = Math.max(0, scenes.findIndex((item) => item.id === progress.activeId));
  const active = scenes[index];
  const stepsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const reveal = () => stepsRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [active?.id]);
  if (!active) return null;
  const answer = active.kind === 'quiz' ? progress.answers[active.id] : undefined;
  const answered = answer !== undefined;
  const finished = progress.completed.includes(active.id);
  const ready = active.kind === 'quiz' ? answered : active.kind === 'reflect' ? !!progress.reflection.trim() : true;
  const labels = { explain: '读懂概念', example: '跟着例子', quiz: '检查理解', reflect: '整理自己的解释' };
  const complete = () => onSave(completeStudyScene(progress, scenes));
  return <div className={g.panel}>
    <div className={s.sectionHeading}><div><h2>一起把「{topic.title}」学明白</h2><p>小砚带你读、练、整理理解。随时可以停下来提问。</p></div><span>{index + 1} / {scenes.length}</span></div>
    <nav ref={stepsRef} className={g.steps} aria-label="本课学习步骤">{scenes.map((scene, i) => <button key={scene.id} aria-current={scene.id === active.id ? 'step' : undefined} onClick={() => onSave({ ...progress, activeId: scene.id })} title={scene.title}><span>{progress.completed.includes(scene.id) ? <Icon name="check" size={13} /> : progress.skipped.includes(scene.id) ? '–' : i + 1}</span><span>{scene.title}</span></button>)}</nav>
    <article className={g.scene}>
      <div className={g.sceneLabel}><Icon name={active.kind === 'quiz' ? 'circle-help' : 'book-open'} size={16} />{labels[active.kind]}<span>小砚 · 学习引导</span></div>
      <h3>{active.title}</h3>
      <CoachMarkdown text={active.body} />
      {active.kind === 'quiz' && <>
        <div className={s.options}>{active.options.map((option, i) => <button key={i} className={s.option} disabled={answered} data-result={answered ? i === active.answer ? 'right' : answer === i ? 'wrong' : undefined : undefined} onClick={() => onSave({ ...progress, answers: { ...progress.answers, [active.id]: i } })}><span>{String.fromCharCode(65 + i)}</span>{option}</button>)}</div>
        {answered && <div className={s.answerFeedback} role="status" data-correct={answer === active.answer}><strong>{answer === active.answer ? '判断正确，继续检验你的解释。' : '这处理解还需要补一补。'}</strong><CoachMarkdown text={active.explanation || '回到讲义核对，也可以带着这道题问小砚。'} /></div>}
      </>}
      {active.kind === 'reflect' && <label className={g.reflection}>我现在的理解<textarea aria-label="用自己的话解释" value={progress.reflection} maxLength={2000} rows={5} placeholder="写一个你自己的例子，也记下还不确定的地方…" onChange={(event) => onSave({ ...progress, reflection: event.target.value, completed: progress.completed.filter((id) => id !== active.id) })} /></label>}
      <button className={s.textButton} onClick={() => { onSave({ ...progress, returnId: active.id }); onAsk(sceneQuestionContext(active)); }}><Icon name="message" size={15} />这里没弄懂，问问小砚</button>
    </article>
    <div className={g.actions}><button className={s.softButton} disabled={index === 0} onClick={() => onSave({ ...progress, activeId: scenes[index - 1].id })}>上一步</button><button className={s.textButton} disabled={active.kind === 'reflect'} onClick={() => onSave(completeStudyScene(progress, scenes, true))}>先跳过，稍后回来</button><button className={s.primaryButton} disabled={!ready || finished && active.kind === 'reflect'} onClick={complete}>{active.kind === 'reflect' ? finished ? '解释已保存' : '保存我的解释' : active.kind === 'quiz' ? '看过反馈，继续' : '我读过了，继续'}<Icon name="arrow-right" size={14} /></button></div>
    {active.kind === 'reflect' && finished && <div className={g.finish} role="status"><strong>这轮整理已保存。</strong><p>已确认 {progress.completed.length} 个步骤，还有 {scenes.length - progress.completed.length} 个未完成{progress.skipped.length ? `（其中跳过 ${progress.skipped.length} 个）` : ''}。完成步骤不等于已经掌握；你可以回看，也可以试着讲给小白。</p><Link className={s.primaryButton} to={`/teach/${encodeURIComponent(topic.topicId)}`}>教小白，检验理解<Icon name="graduation" size={16} /></Link></div>}
    <p className={s.footnote}>学习位置和解释保存在当前浏览器，按账号分开。这里的记录不计入小白的课堂成绩。</p>
  </div>;
}
