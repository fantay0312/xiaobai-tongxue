import { useState, type CSSProperties } from 'react';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { DEMO } from './landingData';
import { getTeachJourneySnapshot, type TeachDemoOutcome } from './landingTeachDemo';
import { DemoTypewriter } from './DemoTypewriter';
import type { DemoMotionMode } from './useLearningDemo';
import s from './WorkspaceScenes.module.css';

function SceneHeading({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  note: string;
}) {
  return (
    <header className={s.sceneHeading}>
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <p>{note}</p>
    </header>
  );
}

export function ExamScene({
  motionMode,
  reducedMotion,
  teachOutcome,
}: {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  teachOutcome: TeachDemoOutcome;
}) {
  const playing = motionMode === 'playing';
  const journey = getTeachJourneySnapshot(teachOutcome);
  const passed = journey.branch === 'passed';
  const open = journey.branch === 'open';
  return (
    <section className={`${s.scene} ${s.examScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="赴考 · 第 3 题" title="小白正在独自作答" note="先生不得代答" />
      <ol className={s.examBeats} aria-label="亮题、心声、落笔、判定">
        {['亮题', '心声', '落笔', '判定'].map((label, index) => (
          <li key={label} style={{ '--beat': index } as CSSProperties}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      <div className={s.examDesk}>
        <div className={s.examPupil}>
          <XiaobaiAvatar
            mood={journey.exam.mood}
            level={1}
            size={112}
            variant="paper"
            speaking={playing}
          />
          <small>小白 · 考场内</small>
        </div>
        <article className={s.examPaper}>
          <span>题目 3 / 5</span>
          <h4>{DEMO.examQuestion}</h4>
          <blockquote>
            <DemoTypewriter
              text={journey.exam.whisper}
              motionMode={motionMode}
              reducedMotion={reducedMotion}
              startDelay={950}
            />
          </blockquote>
          <p className={`${s.examVerdict} ${passed ? s.examVerdictPassed : open ? s.examVerdictOpen : ''}`}>
            <Icon name={passed ? 'circle-check' : open ? 'circle-help' : 'circle-x'} size={17} />
            {journey.exam.verdict}
          </p>
        </article>
      </div>
    </section>
  );
}

export function ReviewScene({
  motionMode,
  teachOutcome,
}: {
  motionMode: DemoMotionMode;
  teachOutcome: TeachDemoOutcome;
}) {
  const journey = getTeachJourneySnapshot(teachOutcome);
  const passed = journey.branch === 'passed';
  const open = journey.branch === 'open';
  return (
    <section className={`${s.scene} ${s.reviewScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="灯下批注" title={journey.review.title} note={journey.review.note} />
      <div className={s.reviewGrid}>
        <article className={s.scoreStub}>
          <span>{journey.review.resultLabel}</span>
          <strong>{journey.review.resultValue}</strong>
          {journey.review.resultUnit ? <small>{journey.review.resultUnit}</small> : null}
          <p>{journey.review.resultSummary}</p>
        </article>
        <article className={`${s.blindReport} ${passed ? s.resolvedReport : open ? s.openReport : ''}`}>
          <span>{journey.review.findingLabel}</span>
          <h4>{journey.review.findingTitle}</h4>
          <p>{journey.review.findingEvidence}</p>
          <strong>
            <Icon name={passed ? 'circle-check' : open ? 'circle-help' : 'swords'} size={16} />
            {journey.review.action}
          </strong>
        </article>
      </div>
      <ol className={s.eventTape}>
        {journey.review.events.map(([label, detail]) => (
          <li key={label}><time>{label}</time><span>{detail}</span></li>
        ))}
      </ol>
      <p className={s.persistenceNote}>
        课后长期保留的是这类结构化事件；课堂关闭后，不把整段对话冒充永久录像。
      </p>
    </section>
  );
}

export function RemedyScene({
  motionMode,
  onInteract,
  teachOutcome,
}: {
  motionMode: DemoMotionMode;
  onInteract: () => void;
  teachOutcome: TeachDemoOutcome;
}) {
  const [picked, setPicked] = useState(1);
  const correct = picked === 1;
  const journey = getTeachJourneySnapshot(teachOutcome);
  const options = ['一整块', DEMO.remedyAnswer, '一个字母一块', '直接丢掉'];
  return (
    <section className={`${s.scene} ${s.remedyScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="补学微路径" title={journey.remedy.title} note={journey.remedy.note} />
      <div className={s.remedyGrid}>
        <article className={s.microLesson}>
          <span>1 · 输入</span>
          <pre>{DEMO.remedyCode}</pre>
          <p>同样的字数，常见搭配切得整，生僻内容切得碎。</p>
        </article>
        <article className={s.predictionQuiz}>
          <span>2 · 预测</span>
          <h4>{DEMO.remedyQuestion}</h4>
          <div>
            {options.map((option, index) => (
              <button
                className={picked === index ? (correct ? s.optionCorrect : s.optionWrong) : ''}
                key={option}
                type="button"
                onClick={() => { onInteract(); setPicked(index); }}
                onFocus={onInteract}
              >
                {option}
              </button>
            ))}
          </div>
          <p>{correct ? '答对了。新词没有现成整块，只能继续拆小。' : '再看一眼上面的三个切分例子。'}</p>
        </article>
      </div>
      <div className={s.outputStep}>
        <span>3 · 输出</span>
        <p>{journey.remedy.output}</p>
        <strong>
          <Icon name="arrow-right" size={15} />
          {journey.branch === 'passed' ? '下一步：迁移复述' : '下一步：再讲'}
        </strong>
      </div>
    </section>
  );
}
