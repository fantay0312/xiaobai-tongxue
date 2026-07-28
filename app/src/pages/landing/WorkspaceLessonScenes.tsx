import { useState } from 'react';
import { Link } from 'react-router-dom';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { DEMO } from './landingData';
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

function ClassroomDock() {
  return (
    <div className={s.classroomDock} aria-label="讲解舱输入区示意">
      <p>把这一点讲给小白听……</p>
      <span><Icon name="image" size={14} />图片</span>
      <span><Icon name="camera" size={14} />拍照</span>
      <span><Icon name="mic" size={14} />语音</span>
      <span className={s.sendAction}><Icon name="send" size={14} />讲给小白</span>
    </div>
  );
}

export function TeachScene({
  motionMode,
  reducedMotion,
}: {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
}) {
  const playing = motionMode === 'playing';
  return (
    <section className={`${s.scene} ${s.boardScene}`} data-motion={motionMode}>
      <SceneHeading
        eyebrow="讲解舱 · 带偏分支"
        title={`你正在讲：${DEMO.title}`}
        note="回放 3 轮"
      />
      <div className={s.classroom}>
        <aside className={s.pupilStage}>
          <XiaobaiAvatar
            mood="confused"
            level={1}
            size={118}
            variant="board"
            speaking={playing}
          />
          <strong>小白</strong>
          <small>好奇型 · 有些困惑</small>
        </aside>
        <div className={s.boardStream}>
          <article className={s.teacherLine}>
            <span>你 · 2</span>
            <p>{DEMO.teachLine}</p>
          </article>
          <article className={`${s.pupilLine} ${s.misconceptionLine}`}>
            <span>小白 · 2</span>
            <p aria-label="小白提出常见误区">
              <DemoTypewriter
                text={DEMO.misconceptionLine}
                motionMode={motionMode}
                reducedMotion={reducedMotion}
                startDelay={700}
              />
            </p>
          </article>
          <article className={s.teacherLine}>
            <span>你 · 3</span>
            <p>{DEMO.adoptedTeacherLine}</p>
          </article>
          <article className={`${s.pupilLine} ${s.branchOutcomeLine}`}>
            <span>小白 · 3</span>
            <p aria-label="小白被带偏后的回答">
              <DemoTypewriter
                text={DEMO.adoptedStudentLine}
                motionMode={motionMode}
                reducedMotion={reducedMotion}
                startDelay={2900}
              />
            </p>
          </article>
        </div>
      </div>
      <ClassroomDock />
    </section>
  );
}

export function ReteachScene({
  motionMode,
  reducedMotion,
}: {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
}) {
  const playing = motionMode === 'playing';
  return (
    <section className={`${s.scene} ${s.boardScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="重讲验证" title="回到刚才讲岔的地方" note="模式：再讲" />
      <p className={s.modeBanner}>上次被带偏的地方，这次要把它讲明白。</p>
      <div className={s.reteachBoard}>
        <XiaobaiAvatar
          mood="aha"
          level={1}
          size={104}
          variant="board"
          speaking={playing}
        />
        <div>
          <span>你重新讲了一遍</span>
          <blockquote>{DEMO.correctedTeacherLine}</blockquote>
          <p>
            <DemoTypewriter
              text="这回我明白了：字数和 Token 数不能直接画等号，得先看词表怎么切。"
              motionMode={motionMode}
              reducedMotion={reducedMotion}
              startDelay={700}
            />
          </p>
        </div>
      </div>
      <div className={s.reteachFoot}>
        <strong><Icon name="circle-check" size={17} />误区已纠正</strong>
        <Link to="/study">去课程书架实际开讲 <Icon name="arrow-right" size={15} /></Link>
      </div>
    </section>
  );
}
