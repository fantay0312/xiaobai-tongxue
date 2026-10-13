/**
 * 首屏的迷你学习终端：用真实界面的零件拼出一轮问答，并自动演一遍。
 * 布局始终按「全部内容」占位，演示只切换显隐，所以窗口高度不会跳。
 * 减弱动效时直接停在终态；离屏或切后台时暂停。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowUp, Bot, Check, ChevronDown, ChevronRight, FileText, Folder, FolderOpen,
  GraduationCap, Layers, Library, Plus, Presentation, Search, SquarePen, Zap,
} from 'lucide-react';
import { Shimmer } from '../../components/ui';
import { Seal } from '../../components/shell/Seal';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { EFFORTS, EFFORT_HINTS, EFFORT_LABELS } from '../../store/modelPrefs';
import { useInView } from './useInView';
import s from './heroTerminal.module.css';

const QUESTION = '为什么 B+ 树比二叉搜索树更适合做磁盘索引？';

type Segment = { text: string } | { cite: number };
const ANSWER: Segment[] = [
  { text: '磁盘每读一块都慢，所以树要尽量矮。B+ 树一个节点能放几百个键，上亿条记录也只有三四层' },
  { cite: 1 },
  { text: '；数据都放在叶子上，叶子之间连成链表，范围查询顺着读就行' },
  { cite: 2 },
  { text: '。' },
];
const segmentLength = (segment: Segment) => ('cite' in segment ? 1 : segment.text.length);
const ANSWER_OFFSETS = ANSWER.map((_, index) => ANSWER.slice(0, index).reduce((sum, item) => sum + segmentLength(item), 0));
const ANSWER_LENGTH = ANSWER.reduce((sum, item) => sum + segmentLength(item), 0);

const LOGS = ['B+ 树为什么适合磁盘', 'KMP 的 next 数组怎么来', '教小白 · 第 7 讲 索引'];
const VIEWS = [
  { icon: Layers, label: '工作台' },
  { icon: Bot, label: '助理任务' },
  { icon: Presentation, label: 'AI 课堂' },
  { icon: Library, label: '资料库' },
];
const SUGGESTIONS = ['讲讲 B+ 树', '出 5 道选择题', '排一份复习计划'];
const QUIZ_OPTIONS = ['每个节点都放', '只放在叶子节点', '只放在根节点'];
const QUIZ_ANSWER = 1;

interface Scene {
  /** 输入框里已打出的字数 */
  typed: number;
  sent: boolean;
  thinking: boolean;
  /** 回答已流出的字数 */
  streamed: number;
  formula: boolean;
  quiz: boolean;
  picked: boolean;
  effortOpen: boolean;
  /** EFFORTS 下标 */
  effort: number;
}

const START: Scene = {
  typed: 0, sent: false, thinking: false, streamed: 0, formula: false, quiz: false, picked: false, effortOpen: false, effort: 2,
};
const FINAL: Scene = {
  typed: 0, sent: true, thinking: false, streamed: ANSWER_LENGTH, formula: true, quiz: true, picked: true, effortOpen: false, effort: 3,
};

/** 演示时间线：打字 → 发送 → 查资料 → 流出回答 → 公式 → 随堂一问 → 调思考强度 → 停留后重来。 */
function useDemo(playing: boolean): Scene {
  const [scene, setScene] = useState<Scene>(START);

  useEffect(() => {
    if (!playing) return undefined;
    let alive = true;
    let timer = 0;
    const wait = (ms: number) => new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(alive), ms);
    });
    const patch = (next: Partial<Scene>) => setScene((prev) => ({ ...prev, ...next }));

    const run = async () => {
      while (alive) {
        setScene(START);
        if (!(await wait(1100))) return;
        for (let count = 1; count <= QUESTION.length; count += 1) {
          patch({ typed: count });
          if (!(await wait(48))) return;
        }
        if (!(await wait(460))) return;
        patch({ typed: 0, sent: true, thinking: true });
        if (!(await wait(1200))) return;
        patch({ thinking: false });
        for (let count = 2; count < ANSWER_LENGTH + 2; count += 2) {
          patch({ streamed: Math.min(count, ANSWER_LENGTH) });
          if (!(await wait(34))) return;
        }
        if (!(await wait(260))) return;
        patch({ formula: true });
        if (!(await wait(700))) return;
        patch({ quiz: true });
        if (!(await wait(1300))) return;
        patch({ picked: true });
        if (!(await wait(1300))) return;
        patch({ effortOpen: true });
        if (!(await wait(700))) return;
        patch({ effort: 3 });
        if (!(await wait(1500))) return;
        patch({ effortOpen: false });
        if (!(await wait(6000))) return;
      }
    };
    void run();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [playing]);

  return scene;
}

function StreamedAnswer({ shown }: { shown: number }) {
  return (
    <p className={s.answer}>
      {ANSWER.map((segment, index) => {
        const visible = Math.max(0, Math.min(segmentLength(segment), shown - ANSWER_OFFSETS[index]));
        if ('cite' in segment) {
          return <sup key={index} className={s.cite} data-on={visible > 0 || undefined}>{segment.cite}</sup>;
        }
        return (
          <span key={index}>
            {segment.text.slice(0, visible)}
            <span className={s.ghost}>{segment.text.slice(visible)}</span>
          </span>
        );
      })}
    </p>
  );
}

export function HeroTerminal() {
  const reducedMotion = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  const demo = useDemo(inView && !reducedMotion);
  const scene = reducedMotion ? FINAL : demo;
  const on = (flag: boolean) => flag || undefined;
  const effort = EFFORTS[scene.effort];
  const answering = scene.sent && !scene.thinking;

  return (
    <div ref={ref} className={s.window}>
      <p className={s.srOnly}>
        学习终端示意：左侧按课程排列对话记录；右侧是一轮问答，小砚依据两份资料回答，
        给出带编号的出处、一条公式和一道随堂选择题；输入框里可以选模型和思考强度。
      </p>
      <div className={s.frame} aria-hidden="true">
        <aside className={s.side}>
          <div className={s.sideHead}>
            <Seal className={s.sideSeal} plate="paper" />
            <span>学习终端</span>
            <SquarePen size={16} strokeWidth={1.75} />
          </div>
          <div className={s.search}>
            <Search size={15} strokeWidth={1.75} />
            搜索课程与对话
          </div>

          <span className={s.groupLabel}>课程</span>
          <div className={s.project} data-open>
            <ChevronDown size={14} strokeWidth={1.75} />
            <FolderOpen size={16} strokeWidth={1.75} />
            数据结构
          </div>
          {LOGS.map((log, index) => (
            <div key={log} className={s.log} data-active={on(index === 0)}>{log}</div>
          ))}
          {['操作系统', '线性代数'].map((name) => (
            <div key={name} className={s.project}>
              <ChevronRight size={14} strokeWidth={1.75} />
              <Folder size={16} strokeWidth={1.75} />
              {name}
            </div>
          ))}

          <span className={s.groupLabel}>工具</span>
          {VIEWS.map(({ icon: ViewIcon, label }) => (
            <div key={label} className={s.project}>
              <ViewIcon size={16} strokeWidth={1.75} />
              {label}
            </div>
          ))}

          <div className={s.sideFoot}>
            <div className={s.journey}>
              <XiaobaiAvatar mood="happy" level={2} size={38} />
              <div className={s.journeyText}>
                <strong>小白 · 秀才</strong>
                <span className={s.journeyBar}><i /></span>
                <span>学识第 4 阶 · 连续 6 天</span>
              </div>
            </div>
          </div>
        </aside>

        <div className={s.main}>
          <div className={s.bar}>
            <span className={s.crumb}>
              <span>数据结构</span>
              <ChevronRight size={14} strokeWidth={1.75} />
              <strong>B+ 树为什么适合磁盘</strong>
            </span>
            <span className={s.barChip}>
              <FileText size={14} strokeWidth={1.75} />
              资料 2 份
            </span>
            <span className={s.barTeach}>
              <GraduationCap size={15} strokeWidth={1.75} />
              <span>讲给小白</span>
            </span>
          </div>

          <div className={s.feed}>
            <div className={s.welcome} data-on={on(!scene.sent)}>
              <strong>今天想弄懂什么？</strong>
              <div className={s.suggestions}>
                {SUGGESTIONS.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>

            <div className={s.turn}>
              <div className={s.ask} data-on={on(scene.sent)}>{QUESTION}</div>

              <div className={s.replyHead} data-on={on(scene.sent)}>
                <span className={s.tutor}>砚</span>
                <strong>小砚</strong>
                {scene.thinking
                  ? <Shimmer className={s.status}>正在查阅 2 份资料…</Shimmer>
                  : <span className={s.status}>查阅了 2 份资料</span>}
              </div>

              <StreamedAnswer shown={answering ? scene.streamed : 0} />

              <div className={s.formula} data-on={on(scene.formula)}>
                <span className={s.math}>
                  <i>h</i> ≈ ⌈ log<sub><i>m</i></sub> <i>N</i> ⌉
                </span>
                <span className={s.formulaNote}>
                  <i>m</i> = 200，<i>N</i> = 10<sup>8</sup> 时 <i>h</i> = 4，最多读 4 次盘
                </span>
              </div>

              <div className={s.sources} data-on={on(scene.formula)}>
                <span><b>1</b>数据结构·第 7 章.pdf · p.214</span>
                <span><b>2</b>索引讲义.pptx · 第 12 页</span>
              </div>

              <div className={s.quiz} data-on={on(scene.quiz)}>
                <div className={s.quizHead}>
                  <span>随堂一问</span>
                  <span>单选</span>
                </div>
                <p className={s.quizQuestion}>B+ 树的数据记录存放在哪里？</p>
                <div className={s.quizOptions}>
                  {QUIZ_OPTIONS.map((option, index) => (
                    <span key={option} className={s.quizOption} data-right={on(scene.picked && index === QUIZ_ANSWER)}>
                      <b>{'ABC'[index]}</b>
                      {option}
                      {index === QUIZ_ANSWER && <Check size={15} strokeWidth={2.2} className={s.quizCheck} />}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={s.dock}>
            <div className={s.effortPop} data-on={on(scene.effortOpen)}>
              <div className={s.effortHead}>
                <Zap size={15} strokeWidth={1.9} />
                <strong>{EFFORT_LABELS[effort]}</strong>
                <span>思考强度</span>
              </div>
              <div className={s.effortTrack} style={{ '--p': scene.effort / (EFFORTS.length - 1) } as CSSProperties}>
                <i className={s.effortFill} />
                {EFFORTS.map((item, index) => (
                  <i
                    key={item}
                    className={s.effortStop}
                    data-on={on(index <= scene.effort)}
                    style={{ '--i': index / (EFFORTS.length - 1) } as CSSProperties}
                  />
                ))}
                <i className={s.effortThumb} />
              </div>
              <p>{EFFORT_HINTS[effort]}</p>
            </div>

            <div className={s.composer} data-typing={on(scene.typed > 0)}>
              <div className={s.input}>
                <span>{QUESTION.slice(0, scene.typed)}</span>
                {scene.typed > 0 && <i className={s.caret} />}
                <span className={s.ghost}>{QUESTION.slice(scene.typed)}</span>
                {scene.typed === 0 && (
                  <span className={s.placeholder}>
                    {scene.sent ? '继续追问，或让小砚出题、做闪卡' : '问小砚这门课里的任何问题'}
                  </span>
                )}
              </div>
              <div className={s.tools}>
                <span className={s.tool}><Plus size={17} strokeWidth={1.75} /></span>
                <span className={s.toolChip}>
                  <FileText size={14} strokeWidth={1.75} />
                  资料 2 份
                </span>
                <span className={s.model} data-open={on(scene.effortOpen)}>
                  <Zap size={14} strokeWidth={1.9} />
                  <span className={s.modelName}>默认模型</span>
                  <em>{EFFORT_LABELS[effort]}</em>
                  <ChevronDown size={14} strokeWidth={1.75} />
                </span>
                <span className={s.send} data-ready={on(scene.typed > 0)}>
                  <ArrowUp size={17} strokeWidth={2.2} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
