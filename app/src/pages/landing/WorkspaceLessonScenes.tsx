import { useState } from 'react';
import { Link } from 'react-router';
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

export function PrepScene({
  motionMode,
  onInteract,
}: {
  motionMode: DemoMotionMode;
  onInteract: () => void;
}) {
  const [picked, setPicked] = useState<number>(DEMO.prepAnswerIndex);
  const correct = picked === DEMO.prepAnswerIndex;
  return (
    <section className={`${s.scene} ${s.paperScene}`} data-motion={motionMode}>
      <SceneHeading
        eyebrow="备课 · 摸底快测"
        title="先看看哪一处最容易讲岔"
        note={`第二波 · 第 ${DEMO.prepStep} / ${DEMO.prepTotal} 题`}
      />
      <div className={s.prepGrid}>
        <article className={s.quizSheet}>
          <pre>{DEMO.prepCode}</pre>
          <h4>{DEMO.prepQuestion}</h4>
          <div className={s.options}>
            {DEMO.prepOptions.map((option, index) => (
              <button
                className={picked === index ? (correct ? s.optionCorrect : s.optionWrong) : ''}
                key={option}
                type="button"
                onClick={() => { onInteract(); setPicked(index); }}
                onFocus={onInteract}
              >
                <span>{String.fromCharCode(65 + index)}</span>{option}
              </button>
            ))}
          </div>
          <p className={correct ? s.answerRight : s.answerWrong}>
            {correct ? '答对了。高频组合更容易在词表里成为整块。' : '再想想：BPE 合并看的是出现频率。'}
          </p>
        </article>
        <aside className={s.taskCard}>
          <span>教学任务卡</span>
          <h4>{DEMO.prepResult}</h4>
          <p>{DEMO.taskCard}</p>
          <ul>
            <li><Icon name="route" size={15} />讲课路线已展开</li>
            <li><Icon name="book-open" size={15} />错题相关讲义默认展开</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}

export function ReteachScene({
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
  const teacherLine = passed
    ? '换个新例子：英文生僻新词没有现成整块，也会被拆小；所以不能按单词数推 Token 数。'
    : open
      ? '这一步还没完成：回到讲解舱，用常见搭配和生僻新词补一个对比例子。'
      : DEMO.correctedTeacherLine;
  const pupilLine = passed
    ? '我能迁移了：中文生僻词和英文新词都一样，要先看词表里有没有现成整块。'
    : open
      ? '我还在等这个对比例子。补齐以后，我再用新词试着自己判断。'
      : '这回我明白了：字数和 Token 数不能直接画等号，得先看词表怎么切。';
  return (
    <section className={`${s.scene} ${s.boardScene}`} data-motion={motionMode}>
      <SceneHeading
        eyebrow={passed ? '迁移复述' : open ? '待补完' : '重讲验证'}
        title={journey.reteach.title}
        note={passed ? '模式：巩固' : open ? '模式：等待补充' : '模式：再讲'}
      />
      <p className={s.modeBanner}>{journey.reteach.banner}</p>
      <div className={s.reteachBoard}>
        <XiaobaiAvatar
          mood={open ? 'curious' : 'aha'}
          level={1}
          size={104}
          variant="board"
          speaking={playing}
        />
        <div>
          <span>{passed ? '你做了一次迁移复述' : open ? '还缺一个对比例子' : '你重新讲了一遍'}</span>
          <blockquote>{teacherLine}</blockquote>
          <p>
            <DemoTypewriter
              text={pupilLine}
              motionMode={motionMode}
              reducedMotion={reducedMotion}
              startDelay={700}
            />
          </p>
        </div>
      </div>
      <div className={s.reteachFoot}>
        <strong className={open ? s.reteachPending : undefined}>
          <Icon name={open ? 'circle-help' : 'circle-check'} size={17} />{journey.reteach.result}
        </strong>
        <Link to="/study">去课程书架实际开讲 <Icon name="arrow-right" size={15} /></Link>
      </div>
    </section>
  );
}
