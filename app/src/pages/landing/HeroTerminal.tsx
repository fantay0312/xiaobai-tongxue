/**
 * 首屏的迷你学习终端：按真实终端的骨架（导轨 52px + 侧栏 + 主区）拼出三个视图，
 * 自动轮播「对话 → 工作台 → 教小白」，导轨跟着点亮。
 * 三个视图叠在同一格里，布局始终按最高的那个占位，演示只切换显隐，窗口高度不会跳。
 * 减弱动效时停在对话的终态；离屏或切后台时暂停；访客点了下方的标签就停在那个视图。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, Menu as MenuIcon, MessageSquare, PanelLeft, PanelLeftClose,
  Plus, Search, Settings, SquarePen, Zap,
} from 'lucide-react';
import { Shimmer } from '../../components/ui';
import {
  IconChat, IconExam, IconFlashcard, IconGrowth, IconGuide, IconLesson, IconLibrary, IconMindmap, IconNote, IconPrep,
  IconQuiz, IconRead, IconReview, IconTeach, IconTodo, IconWriting, type XbIconType,
} from '../../components/ui/icons';
import { Seal } from '../../components/shell/Seal';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { EFFORTS, EFFORT_HINTS, EFFORT_LABELS } from '../../store/modelPrefs';
import { TERMINAL_NAV } from '../learn/shell/views';
import { useInView } from './useInView';
import s from './heroTerminal.module.css';

type ViewId = 'ask' | 'workbench' | 'feynman';

const DEMO_VIEWS: { id: ViewId; label: string; caption: string; sr: string }[] = [
  {
    id: 'ask',
    label: '对话',
    caption: '回答带出处，当场出题',
    sr: '对话视图：左侧按课程排列对话记录；小砚依据两份资料回答，给出带编号的出处、一条公式和一道随堂选择题；输入框里可以选模型和思考强度。',
  },
  {
    id: 'workbench',
    label: '工作台',
    caption: 'AI 就在笔记的光标处',
    sr: '工作台视图：一篇从对话生成的复习笔记。选中一句话会出现润色、扩写、解释、出自测题的浮动条，小砚的解释先作为待确认的建议块出现，接受或丢弃由你决定。',
  },
  {
    id: 'feynman',
    label: '教小白',
    caption: '备课、上课、赴考、复盘',
    sr: '教小白视图：小白的科名、学识与连续天数；一堂课分备课、上课、赴考、批注复盘四站；小白在课上向你追问。',
  },
];

/* ───────── 对话 ───────── */

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

const QUIZ_OPTIONS = ['每个节点都放', '只放在叶子节点', '只放在根节点'];
const QUIZ_ANSWER = 1;
const STUDY_TABS: { label: string; icon: XbIconType }[] = [
  { label: '问小砚', icon: IconChat },
  { label: '带我学', icon: IconGuide },
  { label: '读讲义', icon: IconRead },
  { label: '练一练', icon: IconQuiz },
  { label: '闪卡', icon: IconFlashcard },
  { label: '备课流程', icon: IconPrep },
];
const WELCOME_ACTIONS = [
  { title: '讲讲 B+ 树', detail: '从磁盘读写讲起' },
  { title: '出 5 道选择题', detail: '每道带解析' },
  { title: '做一组闪卡', detail: '按遗忘规律复习' },
  { title: '排一份复习计划', detail: '周五前考完' },
];

interface AskScene {
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
const ASK_START: AskScene = {
  typed: 0, sent: false, thinking: false, streamed: 0, formula: false, quiz: false, picked: false, effortOpen: false, effort: 2,
};
const ASK_FINAL: AskScene = {
  typed: 0, sent: true, thinking: false, streamed: ANSWER_LENGTH, formula: true, quiz: true, picked: true, effortOpen: false, effort: 3,
};

/* ───────── 工作台 ───────── */

const WB_TOOLS: { name: string; icon: XbIconType }[] = [
  { name: '笔记', icon: IconNote },
  { name: '思维导图', icon: IconMindmap },
  { name: '题目集', icon: IconQuiz },
  { name: '闪卡', icon: IconFlashcard },
  { name: '待办', icon: IconTodo },
  { name: '作文与翻译', icon: IconWriting },
];
const WB_TEXT_ACTIONS = ['润色', '扩写', '解释', '出自测题'];
const WB_PICK = 2;

interface WbScene {
  selected: boolean;
  bar: boolean;
  pressed: boolean;
  working: boolean;
  suggestion: boolean;
}
const WB_START: WbScene = { selected: false, bar: false, pressed: false, working: false, suggestion: false };
const WB_FINAL: WbScene = { selected: true, bar: true, pressed: true, working: false, suggestion: true };

/* ───────── 教小白 ───────── */

const STATIONS: { name: string; icon: XbIconType; status: string[] }[] = [
  { name: '备课', icon: IconPrep, status: ['已备好', '已备好', '已备好'] },
  { name: '上课', icon: IconLesson, status: ['小白在听你讲', '讲完了', '讲完了'] },
  { name: '赴考', icon: IconExam, status: ['下课后小白独立答卷', '小白正在答卷', '最近一卷 86 分'] },
  { name: '批注复盘', icon: IconReview, status: ['看小白哪里没懂', '看小白哪里没懂', '去看批注'] },
];

/** 今日课业：名字同 engine/quests.ts */
const QUESTS: [title: string, done: boolean][] = [['给小白上一课', true], ['送小白赴考', true], ['复习到期闪卡', false]];

interface FyScene {
  /** 0：在上课；1：在赴考；2：考完待复盘 */
  step: 0 | 1 | 2;
  bubble: boolean;
}
const FY_START: FyScene = { step: 0, bubble: true };
const FY_FINAL: FyScene = { step: 2, bubble: true };

/* ───────── 时间线 ───────── */

interface Demo {
  view: ViewId;
  ask: AskScene;
  wb: WbScene;
  fy: FyScene;
}
const FINAL: Demo = { view: 'ask', ask: ASK_FINAL, wb: WB_FINAL, fy: FY_FINAL };

/** 一步：先改画面，再停若干毫秒 */
type Step = [apply: (demo: Demo) => Demo, holdMs: number];
interface Part { view: ViewId; steps: Step[] }

const askPatch = (patch: Partial<AskScene>) => (demo: Demo): Demo => ({ ...demo, ask: { ...demo.ask, ...patch } });
const wbPatch = (patch: Partial<WbScene>) => (demo: Demo): Demo => ({ ...demo, wb: { ...demo.wb, ...patch } });
const fyPatch = (patch: Partial<FyScene>) => (demo: Demo): Demo => ({ ...demo, fy: { ...demo.fy, ...patch } });

/** 开场：对话的终态先停一会儿，首屏一打开就是满的 */
const PART_HOLD: Part = { view: 'ask', steps: [[() => FINAL, 3400]] };

const PART_WORKBENCH: Part = {
  view: 'workbench',
  steps: [
    [(demo) => ({ ...demo, view: 'workbench', wb: WB_START }), 1200],
    [wbPatch({ selected: true }), 450],
    [wbPatch({ bar: true }), 1000],
    [wbPatch({ pressed: true, working: true }), 1400],
    [wbPatch({ working: false, suggestion: true }), 3200],
  ],
};

const PART_FEYNMAN: Part = {
  view: 'feynman',
  steps: [
    [(demo) => ({ ...demo, view: 'feynman', fy: FY_START }), 2400],
    [fyPatch({ step: 1 }), 1600],
    [fyPatch({ step: 2 }), 3000],
  ],
};

const PART_ASK: Part = {
  view: 'ask',
  steps: [
    [(demo) => ({ ...demo, view: 'ask', ask: ASK_START }), 1300],
    ...Array.from({ length: QUESTION.length }, (_, index): Step => [
      askPatch({ typed: index + 1 }),
      index === QUESTION.length - 1 ? 460 : 48,
    ]),
    [askPatch({ typed: 0, sent: true, thinking: true }), 1200],
    ...Array.from({ length: Math.ceil(ANSWER_LENGTH / 2) }, (_, index): Step => [
      askPatch({ thinking: false, streamed: Math.min((index + 1) * 2, ANSWER_LENGTH) }),
      34,
    ]),
    [askPatch({ formula: true }), 700],
    [askPatch({ quiz: true }), 1300],
    [askPatch({ picked: true }), 1300],
    [askPatch({ effortOpen: true }), 700],
    [askPatch({ effort: 3 }), 1500],
    [askPatch({ effortOpen: false }), 3600],
  ],
};

const LOOP: Part[] = [PART_WORKBENCH, PART_FEYNMAN, PART_ASK];
const partLength = (part: Part) => part.steps.reduce((sum, [, ms]) => sum + ms, 0);

interface Progress {
  view: ViewId;
  ms: number;
  /** 每进入一段就换一次，进度条据此重新开始 */
  key: number;
}

/** 演示时间线：对话终态 → 工作台 → 教小白 → 对话从头演一遍 → 回到工作台……  */
function useDemo(playing: boolean): [Demo, Progress | null] {
  const [demo, setDemo] = useState<Demo>(FINAL);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!playing) {
      setProgress(null);
      return undefined;
    }
    let alive = true;
    let timer = 0;
    let key = 0;
    const wait = (ms: number) => new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(alive), ms);
    });
    const play = async (part: Part) => {
      key += 1;
      setProgress({ view: part.view, ms: partLength(part), key });
      for (const [apply, ms] of part.steps) {
        setDemo(apply);
        if (!(await wait(ms))) return false;
      }
      return true;
    };
    const run = async () => {
      if (!(await play(PART_HOLD))) return;
      while (alive) {
        for (const part of LOOP) {
          if (!(await play(part))) return;
        }
      }
    };
    void run();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [playing]);

  return [demo, progress];
}

/* ───────── 视图零件 ───────── */

const on = (flag: boolean) => flag || undefined;

function StreamedAnswer({ shown, pending }: { shown: number; pending: boolean }) {
  return (
    <p className={s.answer} data-pending={on(pending)}>
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

/** 侧栏：品牌行 + 各视图自己的内容 + 小白的近况卡 */
function Side({ children }: { children: ReactNode }) {
  return (
    <aside className={s.side}>
      <div className={s.brandRow}>
        <Seal className={s.brandSeal} plate="paper" />
        <span>小白同学</span>
        <PanelLeftClose size={16} strokeWidth={1.75} />
      </div>
      {children}
      <div className={s.sideFoot}>
        <div className={s.journey}>
          <XiaobaiAvatar mood="happy" level={2} size={34} />
          <div className={s.journeyText}>
            <strong>小白 · 秀才</strong>
            <span className={s.journeyBar}><i /></span>
            <span>学识第 4 阶 · 连续 6 天</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** 主区顶栏：桌面是面包屑，手机是一行标题 */
function Head({ crumbs, title, children }: { crumbs: string[]; title: string; children?: ReactNode }) {
  return (
    <div className={s.head}>
      <span className={s.headMenu}><PanelLeft size={18} strokeWidth={1.75} /></span>
      <span className={s.crumb}>
        {crumbs.map((item) => (
          <span key={item} className={s.crumbPart}>
            {item}
            <ChevronRight size={14} strokeWidth={1.75} />
          </span>
        ))}
        <strong>{title}</strong>
      </span>
      {children}
    </div>
  );
}

function AskView({ scene }: { scene: AskScene }) {
  const effort = EFFORTS[scene.effort];
  const answering = scene.sent && !scene.thinking;
  return (
    <>
      <Side>
        <div className={s.newChat}><SquarePen size={16} strokeWidth={1.75} />新建对话</div>
        <div className={s.search}>
          <Search size={15} strokeWidth={1.75} />
          <span>搜索课程、对话、功能</span>
          <kbd>⌘K</kbd>
        </div>
        <span className={s.groupLabel}>课程项目<Plus size={14} strokeWidth={1.75} /></span>
        <div className={s.row} data-strong>
          <ChevronDown size={14} strokeWidth={2} />
          <BookOpen size={15} strokeWidth={1.75} />
          <span>数据结构</span>
          <small>3</small>
        </div>
        {['B+ 树与索引', 'KMP 字符串匹配', '栈与队列'].map((topic, index) => (
          <div key={topic} className={s.topic} data-active={on(index === 0)}>{topic}</div>
        ))}
        <div className={s.row}>
          <ChevronRight size={14} strokeWidth={2} />
          <BookOpen size={15} strokeWidth={1.75} />
          <span>操作系统</span>
          <small>5</small>
        </div>
        <span className={s.groupLabel}>本课对话</span>
        {['B+ 树为什么适合磁盘', '叶子链表怎么做范围查询'].map((chat, index) => (
          <div key={chat} className={s.row} data-active={on(index === 0)}>
            <MessageSquare size={15} strokeWidth={1.75} />
            <span>{chat}</span>
          </div>
        ))}
      </Side>

      <div className={s.main}>
        <Head crumbs={['数据结构']} title="B+ 树与索引">
          <span className={s.headChip}><IconLibrary size={15} />资料<b>2</b></span>
          <span className={s.headSolid}><IconTeach size={15} />教小白</span>
        </Head>
        <div className={s.studyTabs}>
          {STUDY_TABS.map(({ label, icon: TabIcon }, index) => (
            <span key={label} className={s.studyTab} data-active={on(index === 0)}>
              <TabIcon size={15} active={index === 0} />
              {label}
            </span>
          ))}
        </div>

        <div className={s.feed}>
          <div className={s.welcome} data-on={on(!scene.sent)}>
            <strong>今天想弄懂什么？</strong>
            <span className={s.welcomeLead}>小砚只依据这门课选中的 2 份资料回答</span>
            <div className={s.welcomeGrid}>
              {WELCOME_ACTIONS.map((item) => (
                <span key={item.title} className={s.welcomeCard}>
                  <b>{item.title}</b>
                  <small>{item.detail}</small>
                </span>
              ))}
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
            <StreamedAnswer shown={answering ? scene.streamed : 0} pending={scene.sent} />
            <div className={s.formula} data-on={on(scene.formula)} data-pending={on(scene.sent)}>
              <span className={s.math}>
                <i>h</i> ≈ ⌈ log<sub><i>m</i></sub> <i>N</i> ⌉
              </span>
              <span className={s.formulaNote}>
                <i>m</i> = 200，<i>N</i> = 10<sup>8</sup> 时 <i>h</i> = 4，最多读 4 次盘
              </span>
            </div>
            <div className={s.sources} data-on={on(scene.formula)} data-pending={on(scene.sent)}>
              <span><b>1</b>数据结构·第 7 章.pdf · p.214</span>
              <span><b>2</b>索引讲义.pptx · 第 12 页</span>
            </div>
            <div className={s.quiz} data-on={on(scene.quiz)} data-pending={on(scene.sent)}>
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
              <span className={s.toolChip}><IconLibrary size={14} />资料 2 份</span>
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
    </>
  );
}

function WorkbenchView({ scene }: { scene: WbScene }) {
  return (
    <>
      <Side>
        <div className={s.sectionTitle}>
          <strong>工作台</strong>
          <span>笔记、导图、测验、闪卡</span>
        </div>
        {WB_TOOLS.map(({ name, icon: ToolIcon }, index) => (
          <div key={name} className={s.row} data-active={on(index === 0)}>
            <ToolIcon size={16} active={index === 0} />
            <span>{name}</span>
          </div>
        ))}
        <span className={s.groupLabel}>笔记 · 3 篇</span>
        {['B+ 树 · 复习笔记', 'KMP 的 next 数组', '栈与队列 · 易错点'].map((note, index) => (
          <div key={note} className={s.topic} data-active={on(index === 0)}>{note}</div>
        ))}
      </Side>

      <div className={s.main}>
        <Head crumbs={['学习终端', '工作台']} title="笔记">
          <span className={s.headChip}><IconChat size={15} />问小砚</span>
        </Head>
        <div className={s.doc}>
          <span className={s.origin}><IconChat size={14} />来自对话「B+ 树为什么适合磁盘」</span>
          <h3 className={s.docTitle}>B+ 树 · 复习笔记</h3>
          <p className={s.docH}>要点</p>
          <ul className={s.docList}>
            <li>节点大、树矮：一个节点放几百个键，三四层就能覆盖上亿条记录。</li>
            <li className={s.docPick}>
              <span className={s.selection} data-on={on(scene.selected)}>数据只放在叶子上，叶子之间连成链表。</span>
              <span className={s.floatBar} data-on={on(scene.bar)}>
                {WB_TEXT_ACTIONS.map((action, index) => (
                  <span key={action} data-pressed={on(scene.pressed && index === WB_PICK)}>{action}</span>
                ))}
              </span>
            </li>
            <li>内部节点只存键，用来导航，不存数据。</li>
          </ul>
          <div className={s.docMore}>
            <p className={s.docH}>易错点</p>
            <ul className={s.docList}>
              <li>B 树的每个节点都存数据，B+ 树只在叶子存，别把两者混在一起。</li>
              <li>树高按 ⌈log<sub>m</sub> N⌉ 估算，m 是一个节点的分叉数，不是键的个数。</li>
            </ul>
          </div>
          <div className={s.suggest} data-on={on(scene.working || scene.suggestion)}>
            <div className={s.suggestHead}>
              <span className={s.tutor}>砚</span>
              <strong>解释</strong>
              {scene.working
                ? <Shimmer className={s.status}>正在解释</Shimmer>
                : <span className={s.status}>待确认的建议</span>}
            </div>
            <p className={s.suggestText} data-on={on(scene.suggestion)}>
              范围查询先找到起点所在的叶子，再顺着链表往后读，不用回到上层节点，读盘次数最少。
            </p>
            <div className={s.suggestActions} data-on={on(scene.suggestion)}>
              <span data-primary>接受</span>
              <span>丢弃</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FeynmanView({ scene }: { scene: FyScene }) {
  const stateOf = (index: number) => {
    const current = scene.step + 1;
    if (index < current) return 'done';
    if (index === current) return 'current';
    return 'todo';
  };
  return (
    <>
      <Side>
        <div className={s.sectionTitle}>
          <strong>教小白</strong>
          <span>4 门课</span>
        </div>
        <span className={s.groupLabel}>该回讲了</span>
        <div className={s.row} data-active><span>B+ 树与索引</span><small>回讲</small></div>
        <span className={s.groupLabel}>讲过的</span>
        <div className={s.row}><span>KMP 字符串匹配</span><small>82%</small></div>
        <div className={s.row}><span>栈与队列</span><small>90%</small></div>
        <span className={s.groupLabel}>还没讲的</span>
        <div className={s.row}><span>红黑树</span></div>
      </Side>

      <div className={s.main}>
        <Head crumbs={['学习终端']} title="教小白" />
        <div className={s.hub}>
          <div className={s.hubHero}>
            <XiaobaiAvatar mood={scene.bubble ? 'curious' : 'happy'} level={2} size={64} />
            <div className={s.hubText}>
              <span className={s.hubStage}><b>秀才</b>初通一艺</span>
              <span className={s.hubXp}>
                <span>学识 · 第 4 阶</span>
                <span className={s.hubBar}><i /></span>
                <span>连续 6 天</span>
              </span>
            </div>
          </div>

          <div className={s.bubble} data-on={on(scene.bubble)}>
            <b>小白</b>
            先生，叶子之间为什么要连成链表？只查一个键的时候也用得上吗？
          </div>

          <div className={s.stationsHead}>
            <strong>一堂课的四站</strong>
            <span>数据结构 · B+ 树与索引</span>
          </div>
          <ol className={s.stations}>
            {STATIONS.map(({ name, icon: StationIcon, status }, index) => {
              const state = stateOf(index);
              return (
                <li key={name} className={s.station} data-state={state}>
                  <span className={s.stationIcon}>
                    <StationIcon size={18} active={state !== 'todo'} />
                  </span>
                  <b>{name}</b>
                  <span>{status[scene.step]}</span>
                  <i className={s.stationDot}>{state === 'done' && <Check size={11} strokeWidth={3} />}</i>
                </li>
              );
            })}
          </ol>

          <div className={s.quests}>
            <div className={s.stationsHead}>
              <strong>今日课业</strong>
              <span>已完成 2 / 3</span>
            </div>
            <ul className={s.questList}>
              {QUESTS.map(([title, done]) => (
                <li key={title} data-done={on(done)}>
                  <i className={s.stationDot}>{done && <Check size={11} strokeWidth={3} />}</i>
                  {title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/* ───────── 外框 ───────── */

const MOBILE_PRIMARY = new Set(['ask', 'workbench', 'feynman', 'classroom']);

export function HeroTerminal() {
  const reducedMotion = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  const [manual, setManual] = useState<ViewId | null>(null);
  const [auto, progress] = useDemo(inView && !reducedMotion && !manual);
  const demo = reducedMotion || manual ? { ...FINAL, view: manual ?? 'ask' } : auto;
  const view = demo.view;
  const current = DEMO_VIEWS.find((item) => item.id === view) ?? DEMO_VIEWS[0];

  return (
    <div className={s.root}>
      <div
        ref={ref}
        id="hero-terminal"
        className={s.window}
        role="tabpanel"
        aria-labelledby={`hero-tab-${view}`}
      >
        <p className={s.srOnly}>{current.sr}</p>
        <div className={s.frame} aria-hidden="true">
          <div className={s.rail}>
            <div className={s.railGroup}>
              {TERMINAL_NAV.map(({ view: id, label, icon: ItemIcon }) => {
                const here = id === view;
                return (
                  <span key={id} className={s.railItem} data-current={on(here)} data-mobile-hidden={on(!MOBILE_PRIMARY.has(id))}>
                    <ItemIcon size={19} active={here} />
                    <span className={s.railLabel}>{label}</span>
                  </span>
                );
              })}
              <span className={`${s.railItem} ${s.railMore}`}>
                <MenuIcon size={19} strokeWidth={1.75} />
                <span className={s.railLabel}>更多</span>
              </span>
            </div>
            <div className={s.railBottom}>
              <span className={s.railItem}><IconGrowth size={19} /></span>
              <span className={s.railItem}><Settings size={19} strokeWidth={1.75} /></span>
              <span className={s.railAvatar}>你</span>
            </div>
          </div>

          <div className={s.views}>
            <div className={s.view} data-on={on(view === 'ask')}><AskView scene={demo.ask} /></div>
            <div className={s.view} data-on={on(view === 'workbench')}><WorkbenchView scene={demo.wb} /></div>
            <div className={s.view} data-on={on(view === 'feynman')}><FeynmanView scene={demo.fy} /></div>
          </div>
        </div>
      </div>

      <div className={s.tabs} role="tablist" aria-label="切换终端视图">
        {DEMO_VIEWS.map((item) => {
          const selected = item.id === view;
          const running = selected && progress?.view === item.id ? progress : null;
          return (
            <button
              key={item.id}
              id={`hero-tab-${item.id}`}
              type="button"
              role="tab"
              className={s.tab}
              aria-selected={selected}
              aria-controls="hero-terminal"
              tabIndex={selected ? 0 : -1}
              onClick={() => setManual(item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const index = DEMO_VIEWS.indexOf(item);
                const next = DEMO_VIEWS[(index + (event.key === 'ArrowRight' ? 1 : DEMO_VIEWS.length - 1)) % DEMO_VIEWS.length];
                setManual(next.id);
                document.getElementById(`hero-tab-${next.id}`)?.focus();
              }}
            >
              <span className={s.tabLabel}>{item.label}</span>
              <span className={s.tabCaption}>{item.caption}</span>
              <span className={s.tabTrack} aria-hidden="true">
                {running && (
                  <i key={running.key} className={s.tabFill} style={{ '--ms': `${running.ms}ms` } as CSSProperties} />
                )}
                {selected && !running && <i className={s.tabFill} data-static />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
