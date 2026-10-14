/**
 * 第三章「工作台」：六件工具同在一张台面上；笔记里 AI 就在光标处，结果先成建议块再由人决定；
 * 任何内容都能「发送到」别的工具；生成的东西都进资料库「我生成的」。
 * 全是静态复刻，不引入工作台的真实运行时。
 */
import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent } from 'react';
import {
  ArrowUp, BookOpenCheck, Check, Cloud, Folder, Forward, GitBranch, Heading2, ListChecks, ListTree,
  Monitor, PackagePlus, Sigma, Slash, Table, TextCursorInput,
} from 'lucide-react';
import { Badge, Button } from '../../components/ui';
import {
  IconAgent, IconChat, IconClassroom, IconFlashcard, IconLibrary, IconMindmap, IconNote, IconQuiz, IconSpark, IconTodo, IconWriting,
  type XbIconProps,
} from '../../components/ui/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import base from './landing.module.css';
import s from './practice.module.css';

type ToolId = 'notes' | 'mindmap' | 'quiz' | 'flashcards' | 'todos' | 'writing';

interface Tool {
  id: ToolId;
  name: string;
  icon: ComponentType<XbIconProps>;
  count: number;
  /** 问小砚「正在看」的那一条 */
  seeing: string;
  question: string;
  answer: string;
}

/** 名字、顺序与图标同工作台（views/workbench/shared.tsx 的 TOOLS） */
const TOOLS: readonly Tool[] = [
  {
    id: 'notes', name: '笔记', icon: IconNote, count: 12, seeing: '笔记《B+ 树为什么适合做索引》',
    question: '这篇还漏了什么？',
    answer: '没写非叶子节点只存键、不存数据。补上这一句，扇出为什么高就说通了。',
  },
  {
    id: 'mindmap', name: '思维导图', icon: IconMindmap, count: 3, seeing: '思维导图《第 7 章 索引》',
    question: '哈希这一支怎么展开？',
    answer: '分成「等值查询快」和「不支持范围查询」两点，正好和 B+ 树的叶子链表对照着看。',
  },
  {
    id: 'quiz', name: '题目集', icon: IconQuiz, count: 5, seeing: '题目集《索引练习题》',
    question: '这道题为什么不选 C？',
    answer: '非叶子节点之间没有横向指针，只有叶子节点连成了链表，所以只能沿着叶子往后读。',
  },
  {
    id: 'flashcards', name: '闪卡', icon: IconFlashcard, count: 4, seeing: '闪卡《数据库 · 第 7 章》',
    question: '这张卡我老是记混，怎么办？',
    answer: '把 B 树和 B+ 树放在同一张卡的正反面对比：数据存在哪里、叶子之间连不连。',
  },
  {
    id: 'todos', name: '待办', icon: IconTodo, count: 6, seeing: '待办 · 今天',
    question: '今天先做哪一件？',
    answer: '先复习到期的闪卡，再给小白讲一遍索引。整理笔记可以放到晚上。',
  },
  {
    id: 'writing', name: '作文与翻译', icon: IconWriting, count: 2, seeing: '翻译练习《叶子链表》',
    question: 'which 指代的是什么？',
    answer: '指前面整句「叶子节点用指针相连」这件事，所以谓语用单数 makes。',
  },
];

/* ── 笔记：选中文字 → 浮动条 → 建议块 → 接受或丢弃 ── */
type TextAction = 'polish' | 'expand' | 'explain';
type CrossMade = 'flashcards' | 'quiz';

const SELECTED = '叶子节点连成链表';

/** 润色、扩写替换选中的文字；解释插在下方（与 workbench/ai.ts 的 REPLACING 一致） */
const SUGGESTIONS: Record<TextAction, { label: string; text: string; replaces: boolean }> = {
  polish: { label: '润色', text: '叶子节点按键的顺序用指针串成一条链表', replaces: true },
  expand: { label: '扩写', text: '叶子节点按键的顺序连成链表，每个叶子都指着下一个叶子', replaces: true },
  explain: { label: '解释', text: '范围查询先从根往下找到起点，之后沿着叶子之间的指针往右读，不用每读一页都回到根节点。', replaces: false },
};

const CROSS_DONE: Record<CrossMade, string> = { flashcards: '闪卡做好了，放进了《数据库 · 第 7 章》。', quiz: '题目出好了，放进了《索引练习题》。' };

type NoteState =
  | { phase: 'select'; action: TextAction }
  | { phase: 'replaced' | 'inserted'; action: TextAction }
  | { phase: 'discarded' };

function NotesPane({ onOpen }: { onOpen: (tool: ToolId) => void }) {
  const [note, setNote] = useState<NoteState>({ phase: 'select', action: 'explain' });
  const [made, setMade] = useState<CrossMade | null>(null);
  const action = note.phase === 'select' ? note.action : null;
  const selecting = action !== null;
  const current = action ? SUGGESTIONS[action] : null;
  const replaced = note.phase === 'replaced' ? SUGGESTIONS[note.action].text : null;
  const inserted = note.phase === 'inserted' ? SUGGESTIONS[note.action].text : null;

  const run = (next: TextAction) => { setMade(null); setNote({ phase: 'select', action: next }); };
  const reset = () => { setMade(null); setNote({ phase: 'select', action: 'explain' }); };
  const status = note.phase === 'replaced' ? '已替换选中的文字。'
    : note.phase === 'inserted' ? '已插入到下方。'
      : note.phase === 'discarded' ? '已丢弃，正文没有变。'
        : made ? CROSS_DONE[made] : '';

  return (
    <>
      <PaneHead title="B+ 树为什么适合做索引" meta="已保存 · 186 字" send />
      <div className={s.doc}>
        <p>磁盘一次读一整页。B+ 树的非叶子节点一页能放下很多分支，所以树很矮，查一次要读的页就少。</p>

        {selecting && (
          <div className={s.selBar} role="toolbar" aria-label="对选中的文字用 AI">
            <span className={s.selSpark} aria-hidden="true"><IconSpark size={15} /></span>
            {(Object.keys(SUGGESTIONS) as TextAction[]).map((id) => (
              <button
                key={id}
                type="button"
                className={s.selBtn}
                aria-pressed={action === id && !made}
                onClick={() => run(id)}
              >
                {SUGGESTIONS[id].label}
              </button>
            ))}
            <i className={s.selSep} aria-hidden="true" />
            <button type="button" className={s.selBtn} aria-pressed={made === 'flashcards'} onClick={() => setMade('flashcards')}>
              <IconFlashcard size={15} />做成闪卡
            </button>
            <button type="button" className={s.selBtn} aria-pressed={made === 'quiz'} onClick={() => setMade('quiz')}>
              <IconQuiz size={15} />出题
            </button>
          </div>
        )}

        <p>
          {selecting
            ? <mark className={s.selected}>{SELECTED}</mark>
            : replaced
              ? <ins className={s.merged}>{replaced}</ins>
              : SELECTED}
          ，范围查询找到起点以后，顺着往后读就行。
        </p>

        {inserted && <p className={s.mergedBlock}>{inserted}</p>}

        {action && current && !made && (
          <section className={s.suggest} aria-label={`AI 建议：${current.label}`}>
            <div className={s.suggestHead}>
              <span className={s.selSpark} aria-hidden="true"><IconSpark size={15} /></span>
              <strong>{current.label}</strong>
              <span>待你确认</span>
            </div>
            <p>{current.text}</p>
            <div className={s.suggestFoot}>
              {current.replaces && (
                <Button variant="solid" size="sm" onClick={() => setNote({ phase: 'replaced', action })}>
                  接受替换
                </Button>
              )}
              <Button
                variant={current.replaces ? 'soft' : 'solid'}
                size="sm"
                onClick={() => setNote({ phase: 'inserted', action })}
              >
                插入到下方
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNote({ phase: 'discarded' })}>丢弃</Button>
            </div>
          </section>
        )}

        <p className={s.slashHint}>
          另起一行输入 <kbd>/</kbd>，续写、列提纲、生成表格、写公式都在菜单里。
        </p>
      </div>

      <p className={s.status} aria-live="polite">
        {status}
        {made && selecting && (
          <button type="button" className={s.textLink} onClick={() => onOpen(made)}>打开</button>
        )}
        {!selecting && <button type="button" className={s.textLink} onClick={reset}>重新选中这段</button>}
      </p>
    </>
  );
}

function PaneHead({ title, meta, send }: { title: string; meta: string; send?: boolean }) {
  return (
    <div className={s.paneHead}>
      <strong>{title}</strong>
      <span>{meta}</span>
      {send && <span className={s.sendMark} aria-hidden="true"><Forward size={15} strokeWidth={1.75} /></span>}
    </div>
  );
}

/* ── 思维导图：大纲与图同一份 ── */
function MindPane() {
  return (
    <>
      <PaneHead title="第 7 章 索引" meta="6 个节点" send />
      <div className={s.mindBody}>
        <ul className={s.outline} aria-label="大纲">
          <li>索引
            <ul>
              <li>B 树</li>
              <li data-on>B+ 树
                <ul>
                  <li>高扇出</li>
                  <li>叶子链表</li>
                </ul>
              </li>
              <li>哈希</li>
            </ul>
          </li>
        </ul>
        <svg className={s.map} viewBox="0 0 340 196" role="img" aria-label="思维导图：索引分出 B 树、B+ 树和哈希，B+ 树再分出高扇出与叶子链表">
          <g className={s.mapLinks}>
            <path d="M78 98 C110 98 106 34 138 34" />
            <path d="M78 98 C110 98 106 98 138 98" />
            <path d="M78 98 C110 98 106 162 138 162" />
            <path d="M204 98 C228 98 224 70 248 70" />
            <path d="M204 98 C228 98 224 126 248 126" />
          </g>
          <g className={s.mapRoot}>
            <rect x="14" y="80" width="64" height="36" rx="10" />
            <text x="46" y="103">索引</text>
          </g>
          <g className={s.mapNode}>
            <rect x="138" y="19" width="58" height="30" rx="9" />
            <text x="167" y="39">B 树</text>
            <rect x="138" y="147" width="58" height="30" rx="9" />
            <text x="167" y="167">哈希</text>
          </g>
          <g className={s.mapNodeOn}>
            <rect x="138" y="83" width="66" height="30" rx="9" />
            <text x="171" y="103">B+ 树</text>
          </g>
          <g className={s.mapLeaf}>
            <rect x="248" y="56" width="78" height="28" rx="8" />
            <text x="287" y="75">高扇出</text>
            <rect x="248" y="112" width="78" height="28" rx="8" />
            <text x="287" y="131">叶子链表</text>
          </g>
        </svg>
      </div>
      <div className={s.nodeAi}>
        <span><IconSpark size={15} />选中「B+ 树」</span>
        <ul aria-label="节点上的 AI">
          <li>AI 展开子节点</li>
          <li>补充说明</li>
          <li>精简这一支</li>
          <li>重排</li>
        </ul>
      </div>
    </>
  );
}

/* ── 题目集：做一道单选 ── */
const OPTIONS = [
  '每读一个键都回到根节点重新查找',
  '沿着叶子节点之间的指针往后读',
  '在非叶子节点里逐层向右移动',
  '把整棵树读进内存再筛选',
];
const RIGHT = 1;

function QuizPane() {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <>
      <PaneHead title="索引练习题" meta="第 2 / 8 题 · 单选" send />
      <p className={s.stem}>B+ 树做范围查询，找到起点以后怎么往下读？</p>
      <div className={s.options} role="radiogroup" aria-label="选项">
        {OPTIONS.map((option, index) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={picked === index}
            className={s.option}
            data-result={answered ? (index === RIGHT ? 'right' : picked === index ? 'wrong' : undefined) : undefined}
            onClick={() => setPicked(index)}
          >
            <b>{'ABCD'[index]}</b>
            <span>{option}</span>
          </button>
        ))}
      </div>
      <div className={s.verdict} aria-live="polite">
        {answered ? (
          <>
            <Badge tone={picked === RIGHT ? 'ok' : 'bad'} className={s.badge}>{picked === RIGHT ? '答对了' : '答错了 · 已进错题本'}</Badge>
            <p>叶子节点按键的顺序连成链表，找到起点后顺着指针读，不必回到根节点。</p>
          </>
        ) : (
          <p className={s.muted}>选一个答案，看解析。错题本 2 道，可以出一套巩固卷，或者做成闪卡。</p>
        )}
      </div>
    </>
  );
}

/* ── 闪卡：间隔重复，四档与工作台一致 ── */
const CARDS = [
  { front: 'B+ 树的叶子节点为什么要连成链表？', back: '范围查询找到起点后，顺着链表往后读，不必回到根节点。' },
  { front: 'KMP 的 next 数组记的是什么？', back: '模式串每个前缀里，最长的相等前后缀的长度。' },
  { front: '进程和线程最核心的区别？', back: '进程是资源分配的单位，线程是调度的单位。' },
];

/** 一张复习过两轮、间隔 3 天的卡：重来 10 分钟后，其余按间隔与熟练度推算（store/studyData 的 scheduleCard） */
const RATINGS = [
  { label: '重来', due: '10 分钟后', tone: 'bad' },
  { label: '困难', due: '4 天后', tone: 'warn' },
  { label: '良好', due: '8 天后', tone: 'accent' },
  { label: '简单', due: '10 天后', tone: 'ok' },
] as const;

function FlashPane() {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(12);
  const [lastDue, setLastDue] = useState<string | null>(null);
  const card = CARDS[index % CARDS.length];

  const rate = (due: string) => {
    setLastDue(due);
    setRevealed(false);
    setIndex((value) => value + 1);
    setLeft((value) => (value > 1 ? value - 1 : 12));
  };

  return (
    <>
      <PaneHead title="数据库 · 第 7 章" meta={`今天待复习 ${left} 张`} send />
      <div className={s.card} key={index}>
        <span className={s.cardTag}>{revealed ? '答案' : '问题'}</span>
        <p className={s.cardFront}>{card.front}</p>
        {revealed && <p className={s.cardBack}>{card.back}</p>}
      </div>
      {revealed ? (
        <div className={s.ratings}>
          {RATINGS.map((rating) => (
            <button key={rating.label} type="button" className={s.rating} data-tone={rating.tone} onClick={() => rate(rating.due)}>
              <strong>{rating.label}</strong>
              <span>{rating.due}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={s.deckFoot}>
          <Button variant="solid" onClick={() => setRevealed(true)}>显示答案</Button>
          <span aria-live="polite">{lastDue ? `上一张排到了 ${lastDue}。` : '先在心里答一遍，再看答案。'}</span>
        </div>
      )}
    </>
  );
}

/* ── 待办 ── */
const TODOS = [
  { text: '复习到期的闪卡', due: '今天', agent: false },
  { text: '给小白讲一遍索引', due: '今天', agent: false },
  { text: '整理操作系统第 3 章笔记', due: '周四', agent: true },
];

function TodoPane() {
  const [done, setDone] = useState<readonly boolean[]>([true, false, false]);
  return (
    <>
      <PaneHead title="今天" meta={`${done.filter(Boolean).length} / ${TODOS.length}`} />
      <div className={s.todos}>
        {TODOS.map((todo, index) => (
          <button
            key={todo.text}
            type="button"
            role="checkbox"
            aria-checked={done[index]}
            className={s.todo}
            onClick={() => setDone((prev) => prev.map((value, at) => (at === index ? !value : value)))}
          >
            <i>{done[index] && <Check size={12} strokeWidth={3} />}</i>
            <span>{todo.text}</span>
            {todo.agent && <Badge tone="accent" className={s.badge}>助理添加</Badge>}
            <em>{todo.due}</em>
          </button>
        ))}
      </div>
      <p className={s.paneNote}><IconSpark size={15} />一条做不动，让小砚拆成小步骤；也可以根据最近的学习，排出今天的计划。</p>
    </>
  );
}

/* ── 作文与翻译 ── */
function WritingPane() {
  return (
    <>
      <PaneHead title="叶子链表" meta="翻译练习 · 3 处修改" send />
      <p className={s.source}>叶子节点通过指针相连，便于范围查询。</p>
      <p className={s.draft}>
        The leaf nodes <del>is</del><ins>are</ins> linked by pointers, which <del>make</del><ins>makes</ins> range
        queries <del>more easy</del><ins>easier</ins>.
      </p>
      <p className={s.remark}>主谓一致两处，比较级一处。句子结构没问题。</p>
      <p className={s.paneNote}>作文批改另给总分、亮点、分类问题、逐句建议和一份修改稿。</p>
    </>
  );
}

/* ── 工作台复刻：左工具、中间内容、右问小砚；手机上内容变成横滑卡片带 ── */
function Workbench() {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);
  const release = useRef<number | undefined>(undefined);
  const tool = TOOLS[active];

  useEffect(() => () => window.clearTimeout(release.current), []);

  const sliding = () => {
    const el = strip.current;
    return Boolean(el && el.scrollWidth > el.clientWidth + 1);
  };

  const pick = (index: number) => {
    setActive(index);
    const el = strip.current;
    const card = el?.children[index];
    if (!el || !(card instanceof HTMLElement) || !sliding()) return;
    const inset = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    target.current = index;
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => { target.current = null; }, 900);
    el.scrollTo({
      left: el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left - inset,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  };

  const onScroll = () => {
    const el = strip.current;
    if (!el || !sliding()) return;
    const start = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).paddingLeft) || 0);
    let nearest = 0;
    let distance = Infinity;
    Array.from(el.children).forEach((card, index) => {
      const gap = Math.abs(card.getBoundingClientRect().left - start);
      if (gap < distance) { nearest = index; distance = gap; }
    });
    if (target.current !== null) {
      if (nearest === target.current) target.current = null;
      return;
    }
    setActive(nearest);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (active + step + TOOLS.length) % TOOLS.length;
    pick(next);
    document.getElementById(`practice-tab-${TOOLS[next].id}`)?.focus();
  };

  const open = (id: ToolId) => pick(TOOLS.findIndex((item) => item.id === id));

  return (
    <div className={s.stage} data-reveal>
      <div className={s.bench}>
        <div className={s.rail}>
          <span className={s.railHead}>工作台</span>
          <div className={s.tabs} role="tablist" aria-label="工作台的六件工具" aria-orientation="vertical" onKeyDown={onKey}>
            {TOOLS.map((item, index) => {
              const Icon = item.icon;
              const on = index === active;
              return (
                <button
                  key={item.id}
                  id={`practice-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`practice-pane-${item.id}`}
                  tabIndex={on ? 0 : -1}
                  className={s.tab}
                  onClick={() => pick(index)}
                >
                  <Icon size={16} active={on} />
                  <span>{item.name}</span>
                  <em>{item.count}</em>
                </button>
              );
            })}
          </div>
          <p className={s.counter} aria-hidden="true">{active + 1} / {TOOLS.length} · 左右滑动</p>
        </div>

        <div className={s.panes} ref={strip} onScroll={onScroll}>
          {TOOLS.map((item, index) => (
            <div
              key={item.id}
              id={`practice-pane-${item.id}`}
              role="tabpanel"
              aria-labelledby={`practice-tab-${item.id}`}
              className={s.pane}
              data-active={index === active || undefined}
            >
              {item.id === 'notes' && <NotesPane onOpen={open} />}
              {item.id === 'mindmap' && <MindPane />}
              {item.id === 'quiz' && <QuizPane />}
              {item.id === 'flashcards' && <FlashPane />}
              {item.id === 'todos' && <TodoPane />}
              {item.id === 'writing' && <WritingPane />}
            </div>
          ))}
        </div>

        <aside className={s.ask} aria-label="问小砚">
          <div className={s.askHead}><IconSpark size={16} /><strong>问小砚</strong></div>
          <p className={s.seeing}><span>正在看</span><b>{tool.seeing}</b></p>
          <div className={s.thread} aria-live="polite">
            <p className={s.askQ}>{tool.question}</p>
            <div className={s.askA}>
              <p>{tool.answer}</p>
              <span>{tool.id === 'notes' ? '插入笔记' : '存为笔记'} · 做成闪卡 · 出题</span>
            </div>
          </div>
          <div className={s.askInput} aria-hidden="true">
            <span>就这份{tool.name}问小砚</span>
            <i><ArrowUp size={15} strokeWidth={2} /></i>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── 三个随处可用的小件：斜杠菜单、发送到、我生成的 ── */
const SLASH = [
  { icon: TextCursorInput, label: '续写', hint: '接着上文往下写' },
  { icon: ListChecks, label: '总结上文', hint: '收成几条要点' },
  { icon: ListTree, label: '列提纲', hint: '嵌套列表' },
  { icon: Table, label: '生成表格', hint: '把可对比的内容排成表' },
  { icon: Sigma, label: '写公式', hint: 'LaTeX' },
  { icon: GitBranch, label: '画流程图', hint: 'mermaid' },
  { icon: BookOpenCheck, label: '出自测题', hint: '三道题，带答案' },
];

const SEND: { icon: ComponentType<XbIconProps>; label: string; hint: string; gap?: boolean }[] = [
  { icon: IconNote, label: '存为笔记', hint: '收进工作台的笔记' },
  { icon: IconFlashcard, label: '做成闪卡', hint: '一卡一问，之后按间隔复习' },
  { icon: IconMindmap, label: '整理成导图', hint: '把结构理成一张图' },
  { icon: IconQuiz, label: '出几道题', hint: '出一组自测题' },
  { icon: IconTodo, label: '拆成待办', hint: '列成可以勾掉的步骤' },
  { icon: IconAgent, label: '交给助理', hint: '让小砚接着把事办完', gap: true },
  { icon: IconClassroom, label: '生成 AI 课', hint: '用这段内容排一堂可以播放的课' },
];

const GENERATED = [
  { name: '笔记', count: 12 },
  { name: '思维导图', count: 3 },
  { name: '题目集', count: 5 },
  { name: '闪卡', count: 4 },
  { name: '作文与翻译', count: 2 },
];

function Extras() {
  return (
    <div className={s.extras}>
      <article className={s.extra} data-reveal>
        <h3>输入 /，在光标处生成</h3>
        <p>菜单分 AI 和基础两组。生成的内容同样先成建议块。</p>
        <div className={s.pop} aria-hidden="true">
          <p className={s.popLine}><Heading2 size={14} strokeWidth={1.75} />小结</p>
          <p className={s.popLine}><span className={s.caret}>/</span></p>
          <ul className={s.menu}>
            <li className={s.menuLabel}>AI</li>
            {SLASH.map(({ icon: Icon, label, hint }, index) => (
              <li key={label} data-on={index === 0 || undefined}>
                <Icon size={15} strokeWidth={1.75} />
                <b>{label}</b>
                <small>{hint}</small>
              </li>
            ))}
          </ul>
        </div>
      </article>

      <article className={s.extra} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
        <h3>任何一段，都能发送到</h3>
        <p>对话里的回答、笔记里的一段、AI 课的一幕、助理的成果，都能就地变成别的东西。</p>
        <div className={s.pop} aria-hidden="true">
          <p className={s.popSource}><Forward size={14} strokeWidth={1.75} />对话里的一段回答</p>
          <ul className={s.menu}>
            <li className={s.menuLabel}>发送到</li>
            {SEND.map(({ icon: Icon, label, hint, gap }) => (
              <li key={label} data-gap={gap || undefined}>
                <Icon size={15} />
                <b>{label}</b>
                <small>{hint}</small>
              </li>
            ))}
          </ul>
        </div>
      </article>

      <article className={s.extra} data-reveal style={{ '--reveal-delay': '160ms' } as CSSProperties}>
        <h3>生成的，资料库里都有</h3>
        <p>每一份都自动存进云端「我生成的」，按类型分好文件夹。</p>
        <div className={s.pop} aria-hidden="true">
          <p className={s.popSource}><IconLibrary size={15} />资料库 / 我生成的</p>
          <ul className={s.files}>
            {GENERATED.map((folder) => (
              <li key={folder.name}>
                <Folder size={15} strokeWidth={1.75} />
                <b>{folder.name}</b>
                <small>{folder.count}</small>
              </li>
            ))}
          </ul>
          <dl className={s.where}>
            <div><dt><Cloud size={14} strokeWidth={1.75} />云端</dt><dd>「我生成的」副本，跟着账号</dd></div>
            <div><dt><Monitor size={14} strokeWidth={1.75} />这台浏览器</dt><dd>工作台本身，按账号分开</dd></div>
          </dl>
        </div>
      </article>
    </div>
  );
}

/* ── 功能清单 ── */
const CAPS: readonly Cap[] = [
  { icon: IconNote, title: '笔记', text: '用 Markdown 记要点，编辑、分栏、预览三种看法，能导出 Markdown。' },
  { icon: IconSpark, title: '选中就能改', text: '选中文字出浮动条：润色、扩写、精简、解释、翻译、续写，或做成闪卡、出题、加入导图。' },
  { icon: Slash, title: '斜杠命令', text: '输入 / 出菜单：续写、总结上文、列提纲、生成表格、写公式、画流程图、出自测题。' },
  { icon: Check, title: '先给你看', text: 'AI 的结果先成为建议块，接受了才写进正文，丢弃就什么都不改。' },
  { icon: IconChat, title: '问小砚', text: '右侧的问小砚知道你开着哪一条；回答可以插进笔记、做成闪卡或出题。' },
  { icon: IconMindmap, title: '思维导图', text: '写大纲就是画图；选中节点，AI 可以展开子节点、补充说明、精简这一支或重排。' },
  { icon: IconQuiz, title: '题目集', text: '单选、多选、判断、填空、简答，每题带解析；做错的进错题本，能出巩固卷或做成闪卡。' },
  { icon: IconFlashcard, title: '闪卡', text: '按间隔重复安排复习，分重来、困难、良好、简单四档；卡不住时可以要提示、换个问法。' },
  { icon: IconTodo, title: '待办', text: '列出今天要学的事；小砚能把一条拆成小步骤，或根据最近的学习排今天的计划。' },
  { icon: IconWriting, title: '作文与翻译', text: '作文批改给总分、亮点、分类问题、逐句建议和修改稿；翻译练习给参考译文和逐句讲评。' },
  { icon: PackagePlus, title: '生成学习包', text: '打开一门课或选好资料，一次生成笔记、导图、题目集、闪卡和待办。' },
  { icon: Forward, title: '发送到', text: '任何一段内容都能发送到笔记、闪卡、导图、题目、待办，或交给助理、生成 AI 课。' },
  { icon: IconLibrary, title: '进资料库', text: '生成的笔记、导图、题目集、闪卡和批改都出现在资料库，并自动存一份到云端「我生成的」。' },
  { icon: Monitor, title: '存在这台浏览器', text: '工作台本身存在当前浏览器、按账号分开，不跨设备同步；云端只有「我生成的」那份副本。' },
];

export function PracticeChapter() {
  const { no = '03', glyph = '练', label } = sectionById('practice');
  return (
    <section id="practice" className={base.chapter} aria-labelledby="chapter-practice">
      <div className={base.wrap}>
        <ChapterHead
          no={no}
          glyph={glyph}
          name={label}
          titleId="chapter-practice"
          title="学过的东西，整理在一张台面上。"
          lead="笔记、思维导图、题目集、闪卡、待办、作文与翻译，六件工具放在一起。写笔记时 AI 就在光标处，结果先摆出来给你看，接受了才写进正文。"
        />

        <div className={base.chapterBody}>
          <Workbench />
          <Extras />
          <Caps label="工作台的全部能力" items={CAPS} />
        </div>
      </div>
    </section>
  );
}
