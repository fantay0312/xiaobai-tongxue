import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { DemoTypewriter } from './DemoTypewriter';
import { DEMO } from './landingData';
import {
  getTeachJourneySnapshot,
  type TeachDemoSessionSummary,
} from './landingTeachDemo';
import type { DemoMotionMode } from './useLearningDemo';
import shared from './WorkspaceScenes.module.css';
import s from './WorkspaceReteachScene.module.css';

interface WorkspaceReteachSceneProps {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  session: TeachDemoSessionSummary;
}

const FAILED_PATH = ['误区留痕', '补学一段', '重新讲明', '再送考'] as const;
const PASSED_PATH = ['当场纠正', '独立答稳', '换个例子', '迁移复述'] as const;
const OPEN_PATH = ['小白追问', '等待举例', '补齐依据', '再送考'] as const;

export function ReteachScene({
  motionMode,
  reducedMotion,
  session,
}: WorkspaceReteachSceneProps) {
  const journey = getTeachJourneySnapshot(session.outcome);
  const passed = journey.branch === 'passed';
  const open = journey.branch === 'open';
  const playing = motionMode === 'playing';
  const path = passed ? PASSED_PATH : open ? OPEN_PATH : FAILED_PATH;
  const currentStepIndex = passed ? path.length - 1 : path.length - 2;
  const examples = passed ? DEMO.transferExamples : DEMO.tokenExamples;
  const priorLine = session.teacherLine || (open ? '还缺一个能说明词表切法的对比例子。' : DEMO.adoptedTeacherLine);
  const teacherLine = passed
    ? '换个例子也成立：模型先查词表里有没有现成整块，再决定拆成几个 Token。'
    : open
      ? '把“今天天气不错”和“魑魅魍魉”并排讲一次，说明为什么一个更整、一个更碎。'
      : DEMO.correctedTeacherLine;
  const pupilLine = passed
    ? '我能迁移了：不能看字数或单词数，要先看词表里有没有现成整块。'
    : open
      ? '我看到还缺哪一步了。补完这个对比，我再自己判断新词会怎么切。'
      : '这回我明白了：字数和 Token 数不能直接画等号，得先看词表怎么切。';
  const stateClass = open ? s.stateOpen : passed ? s.statePassed : s.stateCorrected;

  return (
    <section
      className={`${shared.scene} ${shared.boardScene} ${s.scene}`}
      data-motion={motionMode}
      data-reteach-branch={journey.branch}
    >
      <header className={`${shared.sceneHeading} ${s.heading}`}>
        <div>
          <span>{passed ? '迁移复述 · 终幕' : open ? '补齐依据 · 终幕' : '重讲验证 · 终幕'}</span>
          <h3>{journey.reteach.title}</h3>
        </div>
        <p>第 {Math.max(2, session.turn)} 轮 · {passed ? '巩固' : open ? '待补完' : '补学后重讲'}</p>
      </header>

      <div className={s.topline}>
        <p>{journey.reteach.banner}</p>
        <span className={stateClass}>
          <Icon name={open ? 'circle-help' : 'circle-check'} size={16} />
          {journey.reteach.result}
        </span>
      </div>

      <ol className={s.path} aria-label="本轮纠错路径">
        {path.map((step, index) => (
          <li
            className={index === currentStepIndex ? s.pathCurrent : ''}
            key={step}
            aria-current={index === currentStepIndex ? 'step' : undefined}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      <div className={s.board}>
        <aside className={s.pupil} aria-label="小白当前状态">
          <span className={s.pupilLabel}>学生席 · {open ? '等待补讲' : '复述中'}</span>
          <XiaobaiAvatar
            mood={open ? 'curious' : 'aha'}
            level={1}
            size={112}
            variant="board"
            speaking={playing}
          />
          <strong>小白 · {open ? '还在琢磨' : '转过弯了'}</strong>
          <small>{open ? '等一个能独立判断的例子' : '正在把规则换到新例子上'}</small>
        </aside>

        <div className={s.lesson}>
          <div className={`${s.prior} ${passed ? s.priorPassed : open ? s.priorOpen : s.priorWrong}`}>
            <span>{passed ? '上一轮的关键判断' : open ? '上一轮还缺的依据' : '上一次讲岔的原话'}</span>
            {passed || open ? <p>{priorLine}</p> : <del>{priorLine}</del>}
          </div>

          <blockquote className={s.teacherLine}>
            <span>{passed ? '你 · 迁移复述' : open ? '粉笔提示 · 还需讲出' : '你 · 重新讲明'}</span>
            <p>{teacherLine}</p>
          </blockquote>

          <figure className={`${s.comparison} ${open ? s.comparisonPending : ''}`}>
            <figcaption>
              <span>{open ? '待补上的粉笔对照' : passed ? '换一组词也能独立判断' : '判断依据落到例子上'}</span>
              <small>{passed ? '词表里已有整块，新词则继续拆分' : '常见搭配更容易成块，低频组合更容易切碎'}</small>
            </figcaption>
            <div className={s.exampleRows}>
              {examples.map((example) => (
                <div className={s.exampleRow} key={example.source}>
                  <span>{example.label}</span>
                  <code>{example.source}</code>
                  <Icon name="arrow-right" size={14} aria-hidden="true" />
                  <p>
                    {example.pieces.map((piece) => <b key={piece}>{piece}</b>)}
                  </p>
                </div>
              ))}
            </div>
          </figure>

          <div className={`${s.reply} ${open ? s.replyOpen : ''}`}>
            <span>小白 · {open ? '指出还缺什么' : '用自己的话复述'}</span>
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
      </div>

      <footer className={s.receipt}>
        <div>
          <span className={s.receiptMark} aria-hidden="true">
            <Icon name={open ? 'circle-help' : 'check'} size={18} />
          </span>
          <p>
            <strong>{open ? '复讲待补' : passed ? '迁移答稳' : '复讲验讫'}</strong>
            <small>{open ? '补完后再形成正式记录' : '规则、例子和小白复述会一起留下证据'}</small>
          </p>
        </div>
        <Link to="/study">
          去课程书架实际开讲
          <Icon name="arrow-right" size={15} />
        </Link>
      </footer>
    </section>
  );
}

export default ReteachScene;
