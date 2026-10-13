/**
 * 舞台上的五种幕：幻灯片、白板、测验、互动模拟、项目实践。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, GraduationCap, ListPlus, Target, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Badge, Button, cx, toast } from '../../../../components/ui';
import {
  optionLetter, plainText, sameAnswer, xiaobaiAttempt,
  type BoardStroke, type InteractiveScene, type LessonQuestion, type LessonScene, type PblScene, type QuizScene, type SlideScene, type WhiteboardScene,
} from '../../../../engine/lessonStudio';
import { studyData } from '../../../../store/studyData';
import { Formula, InteractiveFrame, MermaidFigure } from './figures';
import type { AdhocLine } from './usePlayback';
import s from './player.module.css';

export interface SceneStageProps {
  scene: LessonScene;
  /** 已显示的要点 / 板书笔数；整幕显示时为 Infinity */
  reveal: number;
  owner: string | null;
  topicId?: string;
  /** 小白当前的学习水平，决定他答题的正确率 */
  xiaobaiLevel: 1 | 2 | 3 | 4 | 5;
  say: (lines: AdhocLine[]) => void;
  /** 测验全部答完 */
  onQuizDone: () => void;
  /** 去讲解舱教小白；没有打开课程时不提供 */
  onTeach?: () => void;
  onOpenTodos: () => void;
}

export function SceneStage(props: SceneStageProps) {
  const { scene } = props;
  switch (scene.type) {
    case 'slide': return <SlideView scene={scene} reveal={props.reveal} />;
    case 'whiteboard': return <BoardView scene={scene} reveal={props.reveal} />;
    case 'quiz': return <QuizView key={scene.id} {...props} scene={scene} />;
    case 'interactive': return <InteractiveView scene={scene} />;
    case 'pbl': return <PblView {...props} scene={scene} />;
  }
}

function SlideView({ scene, reveal }: { scene: SlideScene; reveal: number }) {
  const figure = scene.figure;
  return (
    <div className={cx(s.slide, figure && s.slideSplit)}>
      <ul className={s.bullets}>
        {scene.bullets.map((bullet, index) => (
          <li key={index} data-shown={index < reveal} data-fresh={index === reveal - 1 || undefined}>
            <CoachMarkdown text={bullet} className={s.md} />
          </li>
        ))}
      </ul>
      {figure && (
        <figure className={s.figure}>
          {figure.kind === 'mermaid' && <MermaidFigure code={figure.content} />}
          {figure.kind === 'formula' && <div className={s.figureFormula}><Formula tex={figure.content} /></div>}
          {figure.kind === 'code' && <pre className={s.figureCode}>{figure.content}</pre>}
          {figure.caption && <figcaption>{figure.caption}</figcaption>}
        </figure>
      )}
    </div>
  );
}

/** 板书保留行首的序号，只去掉 Markdown 记号 */
const chalkText = (text: string) => text.replace(/(\*\*|__|`|\$)/g, '').trim();

function StrokeView({ stroke, fresh }: { stroke: BoardStroke; fresh: boolean }) {
  return (
    <div className={s.stroke} data-kind={stroke.kind} data-fresh={fresh || undefined}>
      {stroke.kind === 'formula' && <Formula tex={stroke.content} />}
      {stroke.kind === 'diagram' && <MermaidFigure code={stroke.content} />}
      {stroke.kind === 'text' && <p className={s.chalk}>{chalkText(stroke.content)}</p>}
      {stroke.kind === 'highlight' && <p className={s.chalkMark}>{chalkText(stroke.content)}</p>}
    </div>
  );
}

function BoardView({ scene, reveal }: { scene: WhiteboardScene; reveal: number }) {
  const shown = Math.min(scene.strokes.length, reveal);
  const endRef = useRef<HTMLDivElement>(null);
  const stepping = Number.isFinite(reveal);
  // 新写的一笔滚进视野
  useEffect(() => {
    if (stepping) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [shown, stepping]);
  return (
    <div className={s.board}>
      {scene.strokes.slice(0, shown).map((stroke, index) => (
        <StrokeView key={index} stroke={stroke} fresh={stepping && index === shown - 1} />
      ))}
      {stepping && shown < scene.strokes.length && <span className={s.boardPen} aria-hidden="true" />}
      <div ref={endRef} />
    </div>
  );
}

/** 选项多是短文本或代码字面量（如 [3]），只有带公式、行内代码或强调记号时才走 Markdown */
function OptionText({ text }: { text: string }) {
  return /[$`]|\*\*|\\\(/.test(text) ? <CoachMarkdown text={text} className={s.md} /> : <>{text}</>;
}

interface QuestionState { picked: number[]; done: boolean; by?: 'user' | 'xiaobai'; correct?: boolean }

function QuizView({ scene, xiaobaiLevel, say, onQuizDone, onTeach }: SceneStageProps & { scene: QuizScene }) {
  const [states, setStates] = useState<Record<string, QuestionState>>({});
  const total = scene.questions.length;
  const doneCount = scene.questions.filter((question) => states[question.id]?.done).length;
  const xiaobaiMissed = scene.questions.some((question) => states[question.id]?.by === 'xiaobai' && states[question.id]?.correct === false);
  const reported = useRef(false);

  useEffect(() => {
    if (doneCount === total && total > 0 && !reported.current) {
      reported.current = true;
      onQuizDone();
    }
  }, [doneCount, total, onQuizDone]);

  const settle = (question: LessonQuestion, picked: number[], by: 'user' | 'xiaobai', lead?: AdhocLine) => {
    const correct = sameAnswer(picked, question.answer);
    setStates((current) => ({ ...current, [question.id]: { picked, done: true, by, correct } }));
    const key = question.type === 'truefalse' ? `「${question.options[question.answer[0]]}」` : question.answer.map(optionLetter).join('、');
    const verdict = by === 'xiaobai'
      ? (correct ? '小白答对了。' : `小白这次没答对，正确答案是 ${key}。`)
      : (correct ? '答对了。' : `这题选 ${key}。`);
    say([...(lead ? [lead] : []), { speaker: 'teacher', text: `${verdict}${plainText(question.explanation)}`, kind: 'react' }]);
  };

  const pick = (question: LessonQuestion, index: number) => {
    const state = states[question.id];
    if (state?.done) return;
    if (question.type !== 'multiple') {
      settle(question, [index], 'user');
      return;
    }
    const picked = state?.picked ?? [];
    const next = picked.includes(index) ? picked.filter((value) => value !== index) : [...picked, index].sort((a, b) => a - b);
    setStates((current) => ({ ...current, [question.id]: { picked: next, done: false } }));
  };

  const askXiaobai = (question: LessonQuestion) => {
    const attempt = xiaobaiAttempt(question, xiaobaiLevel);
    settle(question, attempt.answer, 'xiaobai', { speaker: 'xiaobai', text: attempt.line, kind: 'interject' });
  };

  return (
    <div className={s.quiz}>
      {scene.questions.map((question, order) => {
        const state = states[question.id] ?? { picked: [], done: false };
        return (
          <section key={question.id} className={s.question} aria-label={`第 ${order + 1} 题`}>
            <header className={s.questionHead}>
              <span className={s.questionNo}>{order + 1}</span>
              <div className={s.stem}><CoachMarkdown text={question.stem} className={s.md} /></div>
              <Badge tone="outline">{question.type === 'multiple' ? '多选' : question.type === 'truefalse' ? '判断' : '单选'}</Badge>
            </header>
            <div className={s.options} role="group" aria-label="选项">
              {question.options.map((option, index) => {
                const picked = state.picked.includes(index);
                const right = state.done && question.answer.includes(index);
                const wrong = state.done && picked && !right;
                return (
                  <button
                    key={index}
                    type="button"
                    className={s.option}
                    data-picked={picked || undefined}
                    data-right={right || undefined}
                    data-wrong={wrong || undefined}
                    aria-pressed={picked}
                    disabled={state.done}
                    onClick={() => pick(question, index)}
                  >
                    <i className={s.optionKey}>
                      {right ? <Check size={14} strokeWidth={2.4} /> : wrong ? <X size={14} strokeWidth={2.4} /> : optionLetter(index)}
                    </i>
                    <span className={s.optionText}><OptionText text={option} /></span>
                    {state.done && picked && <span className={s.optionBy}>{state.by === 'xiaobai' ? '小白的选择' : '你的选择'}</span>}
                  </button>
                );
              })}
            </div>
            {!state.done && (
              <div className={s.questionActions}>
                {question.type === 'multiple' && (
                  <Button variant="solid" size="sm" disabled={!state.picked.length} onClick={() => settle(question, state.picked, 'user')}>提交</Button>
                )}
                <Button variant="ghost" size="sm" icon={<GraduationCap size={15} strokeWidth={1.75} />} onClick={() => askXiaobai(question)}>让小白来答</Button>
              </div>
            )}
            {state.done && (
              <div className={s.explain} data-correct={state.correct}>
                <strong>{state.by === 'xiaobai' ? (state.correct ? '小白答对了' : '小白答错了') : state.correct ? '答对了' : '再想想'}</strong>
                <CoachMarkdown text={question.explanation} className={s.md} />
              </div>
            )}
          </section>
        );
      })}
      {xiaobaiMissed && (
        <div className={s.teachCard}>
          <div>
            <strong>小白没弄懂这一节</strong>
            <p>{onTeach ? '听懂不算数，能把他讲明白才算。去讲解舱教他一遍，他会再去考一次。' : '打开一门课之后，就可以到讲解舱亲自教他。'}</p>
          </div>
          {onTeach && <Button variant="solid" icon={<GraduationCap size={16} strokeWidth={1.75} />} onClick={onTeach}>给小白讲这一节</Button>}
        </div>
      )}
      {doneCount === total && total > 0 && !xiaobaiMissed && (
        <p className={s.quizDone}><CheckCircle2 size={16} strokeWidth={1.75} />这一幕的题做完了。</p>
      )}
    </div>
  );
}

function InteractiveView({ scene }: { scene: InteractiveScene }) {
  return (
    <div className={s.interactive}>
      <p className={s.lead}>{scene.instructions}</p>
      <InteractiveFrame html={scene.html} title={scene.title} />
    </div>
  );
}

function PblView({ scene, owner, topicId, onOpenTodos }: SceneStageProps & { scene: PblScene }) {
  const [pushed, setPushed] = useState(false);
  const push = () => {
    for (const milestone of [...scene.milestones].reverse()) {
      studyData.addTodo(owner, { text: `${scene.title}：${milestone.title}`, origin: 'agent', ...(topicId ? { topicId } : {}) });
    }
    setPushed(true);
    toast.success(`已把 ${scene.milestones.length} 个里程碑加入待办`, { action: { label: '去看看', onClick: onOpenTodos } });
  };
  return (
    <div className={s.pbl}>
      <div className={s.pblMain}>
        <div className={s.pblBrief}><CoachMarkdown text={scene.brief} className={s.md} /></div>
        <div className={s.deliverable}>
          <Target size={16} strokeWidth={1.75} />
          <div><small>交付物</small><span>{scene.deliverable}</span></div>
        </div>
        {scene.rubric.length > 0 && (
          <dl className={s.rubric}>
            {scene.rubric.map((item, index) => (
              <div key={index}>
                <dt>{item.criterion}</dt>
                <dd>{item.levels || '按完成质量评价'}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className={s.pblSide}>
        <h4>里程碑</h4>
        <ol className={s.milestones}>
          {scene.milestones.map((item, index) => (
            <li key={index}>
              <span>{index + 1}</span>
              <div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div>
            </li>
          ))}
        </ol>
        <Button variant={pushed ? 'soft' : 'solid'} block icon={pushed ? <Check size={16} strokeWidth={1.75} /> : <ListPlus size={16} strokeWidth={1.75} />} disabled={pushed} onClick={push}>
          {pushed ? '已加入待办' : '把里程碑加入待办'}
        </Button>
      </div>
    </div>
  );
}
