import type { KeyboardEvent } from 'react';
import { ArrowRight, Check, CircleHelp, Layers, ListChecks, NotebookPen, RotateCcw, X } from 'lucide-react';
import { Button, Progress, cx } from '../../../components/ui';
import type { LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { useAnswer, useBlockState } from './context';
import { BlockCard, Md } from './parts';
import styles from './genui.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function QuizBlock({ item }: { item: LearningUiBlockOf<'quiz'> }) {
  const { onAsk } = useAnswer();
  const [state, setState] = useBlockState(item.id);
  const revealed = state.revealed === true;
  const correct = state.choice === item.answerIndex;
  return (
    <BlockCard item={item} icon={<CircleHelp {...ICON} />} meta={revealed ? (correct ? '答对了' : '未答对') : '单选'}>
      <Md text={item.question} className={styles.question} />
      <div className={styles.options} role="group" aria-label="选项">
        {item.options.map((option, index) => {
          const result = revealed ? (index === item.answerIndex ? 'correct' : index === state.choice ? 'wrong' : 'rest') : undefined;
          return (
            <button
              key={index}
              type="button"
              className={styles.option}
              aria-pressed={state.choice === index}
              disabled={revealed}
              data-result={result}
              onClick={() => setState({ choice: index, revealed: false })}
            >
              <span className={styles.optionKey}>
                {result === 'correct' ? <Check size={14} strokeWidth={2.25} /> : result === 'wrong' ? <X size={14} strokeWidth={2.25} /> : String.fromCharCode(65 + index)}
              </span>
              <Md text={option} tight />
            </button>
          );
        })}
      </div>
      {revealed ? (
        <div className={styles.feedback} data-correct={correct} role="status">
          <strong>{correct ? '回答正确' : `正确答案是 ${String.fromCharCode(65 + item.answerIndex)}`}</strong>
          <Md text={item.explanation} />
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => setState({ revealed: false })}>重新作答</Button>
            {!correct && (
              <Button size="sm" variant="soft" iconRight={<ArrowRight size={14} strokeWidth={1.75} />} onClick={() => onAsk(`请讲解这道题的关键概念：${item.question}`)}>
                请小砚讲解
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button variant="solid" disabled={state.choice === undefined} onClick={() => setState({ ...state, revealed: true })}>检查答案</Button>
          {state.choice === undefined && <span className={styles.hint}>先选一个再检查</span>}
        </div>
      )}
    </BlockCard>
  );
}

export function FlashcardBlock({ item }: { item: LearningUiBlockOf<'flashcard'> }) {
  const [state, setState] = useBlockState(item.id);
  const flipped = state.revealed === true;
  const flip = () => setState({ revealed: !flipped });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flip();
    }
  };
  return (
    <BlockCard item={item} icon={<Layers {...ICON} />} meta={flipped ? '答案面' : '问题面'}>
      <div
        className={styles.flip}
        data-flipped={flipped}
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={flipped ? '当前是答案面，点击翻回问题' : '当前是问题面，先想一想再点击看答案'}
        onClick={flip}
        onKeyDown={onKeyDown}
      >
        <div className={styles.flipInner}>
          <div className={cx(styles.face, styles.faceFront)} aria-hidden={flipped}>
            <span className={styles.faceLabel}>问</span>
            <Md text={item.front} />
          </div>
          <div className={cx(styles.face, styles.faceBack)} aria-hidden={!flipped}>
            <span className={styles.faceLabel}>答</span>
            <Md text={item.back} />
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant={flipped ? 'ghost' : 'soft'} icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={flip}>
          {flipped ? '翻回问题' : '想好了，翻面'}
        </Button>
      </div>
    </BlockCard>
  );
}

export function PlanBlock({ item }: { item: LearningUiBlockOf<'plan'> }) {
  const { onSave } = useAnswer();
  const [state, setState] = useBlockState(item.id);
  const checked = state.checked ?? [];
  const total = item.steps.reduce((sum, step) => sum + step.minutes, 0);
  const left = item.steps.reduce((sum, step, index) => (checked.includes(index) ? sum : sum + step.minutes), 0);
  const toggle = (index: number) => setState({ checked: checked.includes(index) ? checked.filter((value) => value !== index) : [...checked, index] });
  const save = () => onSave(`${item.title}\n\n${item.steps.map((step, index) => `${checked.includes(index) ? '[x]' : '[ ]'} ${step.title}（${step.minutes} 分钟）\n${step.detail}`).join('\n\n')}`);
  return (
    <BlockCard item={item} icon={<ListChecks {...ICON} />} meta={`${checked.length}/${item.steps.length} 完成`}>
      <div className={styles.planProgress}>
        <Progress value={checked.length} max={item.steps.length} tone={checked.length === item.steps.length ? 'ok' : 'accent'} label="计划完成进度" />
        <span>{left ? `还需约 ${left} 分钟` : `共 ${total} 分钟，已全部完成`}</span>
      </div>
      <ul className={styles.planList}>
        {item.steps.map((step, index) => {
          const done = checked.includes(index);
          return (
            <li key={index}>
              <button type="button" className={styles.planItem} role="checkbox" aria-checked={done} onClick={() => toggle(index)}>
                <span className={styles.check} aria-hidden="true">{done && <Check size={13} strokeWidth={2.5} />}</span>
                <span className={styles.planText}>
                  <strong>{step.title}</strong>
                  <Md text={step.detail} tight />
                </span>
                <span className={styles.minutes}>{step.minutes} 分钟</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <Button size="sm" variant="soft" icon={<NotebookPen size={14} strokeWidth={1.75} />} onClick={save}>保存到便笺</Button>
        <span className={styles.hint}>这是建议安排，勾选只记录在本机</span>
      </div>
    </BlockCard>
  );
}
