/**
 * 第一章「学」：学习终端。
 * 上方一条页签切换五个复刻的终端界面：互动回答 / 资料与出处 / 带我学 / 读讲义 / 深入答疑；
 * 下方是模型与思考强度、默认折叠的思考过程；章末列齐本章全部能力。
 */
import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Clock, Code2, FileText, Folder, FolderOpen, ListChecks, Mic,
  MessageCircleQuestion, Presentation, Quote, RotateCw, ScanText, Send, Sigma, Star, Telescope, Trash2, Type, X,
} from 'lucide-react';
import { Button, EffortSlider, Segmented, Spinner, TabPanel, Tabs } from '../../components/ui';
import {
  IconChat, IconFlashcard, IconGuide, IconLibrary, IconModel, IconQuiz, IconRead, IconSpark,
} from '../../components/ui/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { EFFORTS, EFFORT_HINTS, EFFORT_LABELS } from '../../store/modelPrefs';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './learn.module.css';

const SECTION = sectionById('learn');

/* ════════ 小件 ════════ */

/** 小砚的头像：墨块上一个字 */
function Avatar() {
  return <span className={s.avatar} aria-hidden="true">砚</span>;
}

function Ask({ children }: { children: ReactNode }) {
  return <p className={s.ask}>{children}</p>;
}

/** 回答头：头像 + 名字 + 一枚小签 */
function ReplyHead({ meta }: { meta?: ReactNode }) {
  return (
    <div className={s.replyHead}>
      <Avatar />
      <strong>小砚</strong>
      {meta && <span className={s.replyMeta}>{meta}</span>}
    </div>
  );
}

const M = ({ children }: { children: ReactNode }) => <i className={s.var}>{children}</i>;

/* ════════ 01 互动回答 ════════ */

type FormId = 'quiz' | 'card' | 'table' | 'plan' | 'steps' | 'chart';

const QUIZ = {
  question: '在 B+ 树里做范围查询，最省事的做法是？',
  options: ['每个值都从根查一次', '找到起点，顺着叶子链表往后读', '把整棵树遍历一遍'],
  answer: 1,
};

function QuizForm() {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div>
      <p className={s.formTitle}>{QUIZ.question}</p>
      <div className={s.quizOptions}>
        {QUIZ.options.map((option, index) => {
          const state = picked === null ? undefined : index === QUIZ.answer ? 'right' : index === picked ? 'wrong' : 'rest';
          return (
            <button
              key={option}
              type="button"
              className={s.quizOption}
              data-state={state}
              disabled={picked !== null}
              onClick={() => setPicked(index)}
            >
              <b>{'ABC'[index]}</b>
              <span>{option}</span>
              {state === 'right' && <Check size={16} strokeWidth={2.2} aria-label="正确答案" />}
              {state === 'wrong' && <X size={16} strokeWidth={2.2} aria-label="你的选择" />}
            </button>
          );
        })}
      </div>
      <p className={s.formFoot} aria-live="polite">
        {picked === null && '选一个试试。'}
        {picked !== null && (picked === QUIZ.answer
          ? '答对了。叶子连成链表，找到起点后一路读下去就行。'
          : '再想想：叶子之间有链表相连，不必回到根。')}
        {picked !== null && (
          <button type="button" className={s.linkButton} onClick={() => setPicked(null)}>
            <RotateCw size={13} strokeWidth={2} />
            再来一次
          </button>
        )}
      </p>
    </div>
  );
}

function CardForm() {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={s.cardForm}>
      <button
        type="button"
        className={s.flashcard}
        data-flipped={flipped || undefined}
        aria-label={flipped ? '翻面卡背面，点击翻回问题' : '翻面卡正面，点击看答案'}
        onClick={() => setFlipped((value) => !value)}
      >
        <span className={s.face}>
          <small>问题</small>
          B+ 树的非叶子节点里存什么？
        </span>
        <span className={`${s.face} ${s.faceBack}`}>
          <small>答案</small>
          只存键和指向子节点的指针，不存数据，所以一个节点放得下更多键。
        </span>
      </button>
      <p className={s.formFoot}>点一下卡片翻面。</p>
    </div>
  );
}

function TableForm() {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col"><span className={s.srOnly}>对比项</span></th>
            <th scope="col">B 树</th>
            <th scope="col">B+ 树</th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row">数据放在</th><td>所有节点</td><td>只在叶子</td></tr>
          <tr><th scope="row">范围查询</th><td>中序遍历，上下来回</td><td>顺着叶子链表读</td></tr>
          <tr><th scope="row">单节点键数</th><td>较少</td><td>更多，树更矮</td></tr>
        </tbody>
      </table>
    </div>
  );
}

const PLAN = [
  { title: '读第 7 章，跟小砚把要点过一遍', minutes: 40 },
  { title: '做 10 道选择题，错题留进题目集', minutes: 30 },
  { title: '给小白讲一遍，再看批注补漏', minutes: 25 },
];

function PlanForm() {
  const [done, setDone] = useState<readonly boolean[]>([true, false, false]);
  return (
    <div className={s.plan}>
      {PLAN.map((item, index) => (
        <button
          key={item.title}
          type="button"
          role="checkbox"
          aria-checked={done[index]}
          className={s.planItem}
          onClick={() => setDone((prev) => prev.map((value, at) => (at === index ? !value : value)))}
        >
          <i aria-hidden="true">{done[index] && <Check size={12} strokeWidth={3} />}</i>
          <span>第 {index + 1} 天 · {item.title}</span>
          <small>{item.minutes} 分钟</small>
        </button>
      ))}
      <p className={s.formFoot}>勾掉做完的一项。进度只存在这台设备的浏览器里。</p>
    </div>
  );
}

function StepsForm() {
  return (
    <ol className={s.steps}>
      <li>
        <span>每个节点最多 <M>m</M> 个孩子，<M>h</M> 层最多放下</span>
        <b className={s.math}><M>m</M><sup><M>h</M></sup></b>
      </li>
      <li>
        <span>要装下 <M>N</M> 条记录，需要</span>
        <b className={s.math}><M>m</M><sup><M>h</M></sup> ≥ <M>N</M></b>
      </li>
      <li>
        <span>两边取对数，得到树高</span>
        <b className={s.math}><M>h</M> ≥ log<sub><M>m</M></sub> <M>N</M></b>
      </li>
    </ol>
  );
}

const BARS = [
  { name: '二叉搜索树', value: 27 },
  { name: 'B+ 树（m = 200）', value: 4 },
];

function ChartForm() {
  return (
    <figure className={s.chart}>
      <figcaption className={s.formTitle}>存一亿条记录，各要几层</figcaption>
      {BARS.map((bar, index) => (
        <div key={bar.name} className={s.bar}>
          <span>{bar.name}</span>
          <div className={s.barTrack}>
            <i data-accent={index === 1 || undefined} style={{ '--w': bar.value / 27 } as CSSProperties} />
            <b>{bar.value} 层</b>
          </div>
        </div>
      ))}
    </figure>
  );
}

const FORMS: { value: FormId; label: string; ask: string; view: ComponentType; plain: ReactNode[] }[] = [
  {
    value: 'quiz', label: '自测题', ask: '考我一道范围查询的题', view: QuizForm,
    plain: ['在 B+ 树里做范围查询，最省事的做法是？', 'A. 每个值都从根查一次；B. 找到起点，顺着叶子链表往后读；C. 把整棵树遍历一遍。', '答案是 B：叶子按键的大小连成链表，找到起点后一路读下去。'],
  },
  {
    value: 'card', label: '翻面卡', ask: '把这个要点做成卡片', view: CardForm,
    plain: ['问：B+ 树的非叶子节点里存什么？', '答：只存键和指向子节点的指针，不存数据，所以一个节点放得下更多键。'],
  },
  {
    value: 'table', label: '对比', ask: 'B 树和 B+ 树差在哪？', view: TableForm,
    plain: ['B 树把数据放在所有节点里，范围查询要中序遍历、上下来回。', 'B+ 树只把数据放在叶子，范围查询顺着叶子链表读；单个节点放的键更多，树更矮。'],
  },
  {
    value: 'plan', label: '学习安排', ask: '三天复习完这一章', view: PlanForm,
    plain: PLAN.map((item, index) => `第 ${index + 1} 天：${item.title}（${item.minutes} 分钟）。`),
  },
  {
    value: 'steps', label: '分步推导', ask: '树高是怎么算出来的？', view: StepsForm,
    plain: [
      <>每个节点最多 <M>m</M> 个孩子，<M>h</M> 层最多放下 <M>m</M><sup><M>h</M></sup> 条记录。</>,
      <>要装下 <M>N</M> 条记录，需要 <M>m</M><sup><M>h</M></sup> ≥ <M>N</M>，两边取对数得 <M>h</M> ≥ log<sub><M>m</M></sub> <M>N</M>。</>,
    ],
  },
  {
    value: 'chart', label: '图表', ask: '和二叉搜索树比，差多少？', view: ChartForm,
    plain: ['存一亿条记录，二叉搜索树大约要 27 层，m = 200 的 B+ 树只要 4 层。'],
  },
];

/** 十三种数据卡片：名字与 genui/library.tsx 的组件一一对应 */
const KINDS = ['概念讲解', '分步推导', '公式', '代码逐行讲', '对比', '数据表', '图表', '知识结构图', '时间线', '易错提醒', '自测题', '翻面卡', '学习安排'];

function AnswerStage() {
  const [form, setForm] = useState<FormId>('quiz');
  const [plain, setPlain] = useState(false);
  const current = FORMS.find((item) => item.value === form) ?? FORMS[0];
  const FormView = current.view;
  return (
    <div className={`${base.panel} ${s.answer}`}>
      <Segmented
        value={form}
        onChange={(value) => { setForm(value); setPlain(false); }}
        options={FORMS.map(({ value, label }) => ({ value, label }))}
        label="回答的形式"
        block
        className={s.formTabs}
      />
      <Ask>{current.ask}</Ask>
      <ReplyHead meta={plain ? '纯文字' : '互动回答'} />
      <div className={s.formBody} key={`${form}:${plain}`}>
        {plain
          ? <div className={s.plainText}>{current.plain.map((line, index) => <p key={index}>{line}</p>)}</div>
          : <FormView />}
      </div>
      <div className={s.answerFoot}>
        <button type="button" className={s.linkButton} aria-pressed={plain} onClick={() => setPlain((value) => !value)}>
          <Type size={14} strokeWidth={2} />
          {plain ? '显示互动内容' : '显示纯文字'}
        </button>
      </div>
    </div>
  );
}

/* ════════ 02 资料与出处 ════════ */

type ParseState = 'done' | 'running' | 'idle';

const FILES: { name: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; parse: ParseState; meta: string }[] = [
  { name: '数据结构·第 7 章.pdf', icon: FileText, parse: 'done', meta: '已解析 · 直接使用' },
  { name: '索引讲义.pptx', icon: Presentation, parse: 'done', meta: '已解析 · 直接使用' },
  { name: '往年试卷.docx', icon: FileText, parse: 'running', meta: '正在解析 · 完成后自动更新' },
  { name: '课堂笔记.md', icon: FileText, parse: 'idle', meta: '首次使用时解析' },
];

const PARSE_BADGE: Record<ParseState, string> = { done: '已解析', running: '解析中', idle: '未解析' };

/** 回答里的每句结论各对应一份资料里的一段原文 */
const CLAIMS = [
  {
    file: 0,
    text: 'B+ 树把数据都放在叶子，叶子之间按键的大小用指针连成有序链表。',
    excerpt: 'B+ 树的全部记录都存放在叶子结点中，非叶子结点只起索引作用；叶子结点按关键字大小用指针顺序链接。',
  },
  {
    file: 1,
    text: '范围查询只要从根找到下界所在的叶子，再沿链表往后读，读过上界就停。',
    excerpt: '范围查询：先定位下界所在叶子，再顺着叶子链表扫描，直到关键字超过上界。',
  },
];

const TREE = [
  { label: '全部', icon: Folder },
  { label: '最近', icon: Clock },
  { label: '收藏', icon: Star },
];
const FOLDERS = ['数据结构', '操作系统', '我生成的'];

function SourcesStage() {
  const [picked, setPicked] = useState<readonly boolean[]>([true, true, false, false]);
  const [open, setOpen] = useState<number | null>(0);
  const count = picked.filter(Boolean).length;
  const claims = CLAIMS.filter((claim) => picked[claim.file]);
  const skipped = CLAIMS.filter((claim) => !picked[claim.file]);
  const shown = open !== null && picked[open] ? open : null;
  const shownIndex = claims.findIndex((claim) => claim.file === shown);
  const toggle = (index: number) => setPicked((prev) => prev.map((value, at) => (at === index ? !value : value)));
  const cite = (file: number) => setOpen((value) => (value === file ? null : file));

  return (
    <div className={s.sourcesStage}>
      {/* 资料库：左边文件夹树，右边当前文件夹里的文件与解析状态 */}
      <div className={`${base.panel} ${s.library}`}>
        <div className={s.libHead}>
          <IconLibrary size={16} />
          <strong>资料库</strong>
          <span className={s.crumb}>/ 数据结构</span>
          <span className={s.libCount}>{count} 份用于这次对话</span>
        </div>
        <div className={s.libBody}>
          <nav className={s.tree} aria-label="资料库目录（示意）">
            {TREE.map(({ label, icon: Icon }) => (
              <span key={label} className={s.treeItem}><Icon size={15} strokeWidth={1.75} />{label}</span>
            ))}
            <span className={s.treeLabel}>文件夹</span>
            {FOLDERS.map((name, index) => (
              <span key={name} className={s.treeItem} data-on={index === 0 || undefined}>
                {index === 0 ? <FolderOpen size={15} strokeWidth={1.75} /> : <Folder size={15} strokeWidth={1.75} />}
                {name}
              </span>
            ))}
            <span className={s.treeItem}><Trash2 size={15} strokeWidth={1.75} />回收站</span>
          </nav>
          <div className={s.files} role="group" aria-label="勾选这次对话要用的资料">
            {FILES.map((file, index) => {
              const Icon = file.icon;
              return (
                <button
                  key={file.name}
                  type="button"
                  role="checkbox"
                  aria-checked={picked[index]}
                  className={s.file}
                  onClick={() => toggle(index)}
                >
                  <i className={s.check} aria-hidden="true">{picked[index] && <Check size={12} strokeWidth={3} />}</i>
                  <Icon size={16} strokeWidth={1.75} />
                  <span className={s.fileText}>
                    <span className={s.fileName}>{file.name}</span>
                    <span className={s.fileMeta}>
                      <span className={s.status} data-tone={file.parse}>{PARSE_BADGE[file.parse]}</span>
                      {file.meta}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 对话：只用勾选的资料作答，每句后面带编号 */}
      <div className={`${base.panel} ${s.cited}`}>
        <Ask>范围查询为什么用 B+ 树更快？</Ask>
        <ReplyHead meta={count ? `依据 ${count} 份资料` : '没选资料 · 直接问模型'} />
        <div aria-live="polite">
          {count === 0 && (
            <p className={s.citedText}>
              B+ 树的数据都在叶子，叶子按顺序连成链表；找到起点后顺着读下去，不用反复回到根。
              <span className={s.citedNote}>没有勾选资料时，小砚直接用模型作答，不标出处。</span>
            </p>
          )}
          {count > 0 && claims.length > 0 && (
            <p className={s.citedText}>
              {claims.map((claim, index) => (
                <span key={claim.file}>
                  {claim.text}
                  <button
                    type="button"
                    className={s.cite}
                    aria-expanded={shown === claim.file}
                    aria-label={`出处 ${index + 1}：${FILES[claim.file].name}`}
                    onClick={() => cite(claim.file)}
                  >
                    {index + 1}
                  </button>
                </span>
              ))}
            </p>
          )}
          {count > 0 && claims.length === 0 && (
            <p className={s.citedText}>勾选的资料里没讲到这一点。可以换几份资料，或者全部取消、直接问模型。</p>
          )}
          {count > 0 && skipped.length > 0 && claims.length > 0 && (
            <p className={s.citedNote}>
              {skipped.map((claim) => `《${FILES[claim.file].name}》`).join('')}没有勾选，这次不用。
            </p>
          )}
          {shown !== null && shownIndex >= 0 && (
            <figure className={s.excerpt}>
              <figcaption>
                <Quote size={14} strokeWidth={2} />
                <span>资料原文 · 出处 {shownIndex + 1}</span>
                <b>{FILES[shown].name}</b>
              </figcaption>
              <blockquote><mark>{CLAIMS[shown].excerpt}</mark></blockquote>
            </figure>
          )}
        </div>
        {claims.length > 0 && (
          <div className={s.sourceChips}>
            <span className={s.sourceLabel}>来源</span>
            {claims.map((claim, index) => (
              <button
                key={claim.file}
                type="button"
                className={s.sourceChip}
                aria-pressed={shown === claim.file}
                onClick={() => cite(claim.file)}
              >
                <i>{index + 1}</i>
                <span>{FILES[claim.file].name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════ 03 带我学 ════════ */

type SceneKind = 'explain' | 'example' | 'quiz' | 'reflect';

const SCENES: { kind: SceneKind; tag: string; step: string; title: string; body: string; ask: string; reply: string }[] = [
  {
    kind: 'explain', tag: '概念', step: '读懂概念', title: 'B+ 树为什么矮',
    body: '非叶子节点只存键和指针，一个节点能放下几百个键。分叉多，树就矮，查一次只要读三四个磁盘块。',
    ask: '为什么分叉多，读盘次数就少？',
    reply: '每往下一层要读一个磁盘块。分叉越多，装下同样多的记录需要的层数越少，读盘次数也就越少。',
  },
  {
    kind: 'example', tag: '例子', step: '跟着例子', title: '在一亿条记录里找 id = 4096',
    body: '从根开始，每层用二分找到 4096 落在哪个区间，顺着指针往下走一层。m = 200 时，走四层就到了叶子。',
    ask: '每层用二分查找，不会更慢吗？',
    reply: '二分发生在已经读进内存的节点里，比读一次磁盘快得多。真正花时间的是层数，也就是读盘次数。',
  },
  {
    kind: 'quiz', tag: '自测', step: '检查理解', title: '检查理解 1',
    body: 'B+ 树做范围查询为什么快？',
    ask: '链表在这里起什么作用？',
    reply: '找到起点以后，下一批记录就在相邻的叶子里。顺着链表读，不用每次从根重新往下找。',
  },
  {
    kind: 'reflect', tag: '反思', step: '整理自己的解释', title: '用自己的话说一遍',
    body: '写一个你自己的例子，也记下还不确定的地方。',
    ask: '我的例子这样写对吗？',
    reply: '先说清楚你要查的是一个值还是一段范围，再说每一步读了哪个节点。写完可以讲给小白听。',
  },
];

const GUIDED_QUIZ = ['叶子按顺序连成链表', '每个节点都存数据', '它是平衡二叉树'];

function GuidedStage() {
  const [index, setIndex] = useState(1);
  const [done, setDone] = useState<readonly number[]>([0]);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const scene = SCENES[index];
  const ready = scene.kind !== 'quiz' || answer !== null;

  const advance = () => {
    setDone((prev) => (prev.includes(index) ? prev : [...prev, index]));
    if (scene.kind === 'reflect') setSaved(true);
    else setIndex(index + 1);
  };
  const restart = () => { setIndex(0); setDone([]); setAnswer(null); setSaved(false); };
  const primary = scene.kind === 'reflect' ? (saved ? '解释已保存' : '保存我的解释') : scene.kind === 'quiz' ? '看过反馈，继续' : '我读过了，继续';

  return (
    <div className={`${base.panel} ${s.guided}`}>
      {asking ? (
        <div className={s.interrupt}>
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} strokeWidth={1.75} />} className={s.returnButton} onClick={() => setAsking(false)}>
            返回刚才的学习步骤
          </Button>
          <Ask>{scene.ask}</Ask>
          <ReplyHead />
          <p className={s.replyText}>{scene.reply}</p>
          <p className={s.paused} aria-live="polite">
            停在第 {index + 1} 步「{scene.step}」，进度已保存。问完点上面的按钮回去。
          </p>
        </div>
      ) : (
        <>
          <nav className={s.stepRail} aria-label="本课学习步骤">
            {SCENES.map((item, at) => (
              <button
                key={item.kind}
                type="button"
                className={s.stepButton}
                aria-current={at === index ? 'step' : undefined}
                data-done={done.includes(at) || undefined}
                onClick={() => setIndex(at)}
              >
                <span className={s.stepDot}>{done.includes(at) ? <Check size={13} strokeWidth={2.4} /> : at + 1}</span>
                <span className={s.stepText}>
                  <small>{item.tag}</small>
                  <span>{item.step}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className={s.scene} key={index}>
            <span className={s.sceneKind}>{scene.tag} · {scene.step}</span>
            <h4 className={s.sceneTitle}>{scene.title}</h4>
            <p className={s.sceneBody}>{scene.body}</p>
            {scene.kind === 'quiz' && (
              <div className={s.quizOptions}>
                {GUIDED_QUIZ.map((option, at) => {
                  const state = answer === null ? undefined : at === 0 ? 'right' : at === answer ? 'wrong' : 'rest';
                  return (
                    <button key={option} type="button" className={s.quizOption} data-state={state} disabled={answer !== null} onClick={() => setAnswer(at)}>
                      <b>{'ABC'[at]}</b>
                      <span>{option}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {scene.kind === 'quiz' && answer !== null && (
              <p className={s.sceneFeedback} role="status" data-correct={answer === 0 || undefined}>
                {answer === 0 ? '判断正确，继续检验你的解释。' : '这处理解还需要补一补：叶子之间的链表才是关键。'}
              </p>
            )}
            {scene.kind === 'reflect' && (
              <div className={s.reflection}>
                <small>我现在的理解</small>
                <p>查一个值，从根往下每层读一个节点；查一段范围，找到起点后顺着叶子往后读。还不确定：删除时什么时候要合并节点。</p>
              </div>
            )}
            {saved && scene.kind === 'reflect' && (
              <p className={s.sceneFeedback} role="status" data-correct>
                这轮整理已保存。完成步骤不等于已经掌握，可以回看，也可以讲给小白听。
              </p>
            )}
          </div>

          <div className={s.sceneActions}>
            <button type="button" className={s.linkButton} onClick={() => setAsking(true)}>
              <MessageCircleQuestion size={15} strokeWidth={1.75} />
              这里没弄懂，问问小砚
            </button>
            <span className={s.sceneButtons}>
              {saved
                ? <Button variant="soft" icon={<RotateCw size={14} strokeWidth={1.9} />} onClick={restart}>从头再走一遍</Button>
                : <Button variant="soft" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一步</Button>}
              <Button variant="solid" disabled={!ready || saved} iconRight={<ArrowRight size={14} strokeWidth={1.9} />} onClick={advance}>
                {primary}
              </Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ════════ 04 读讲义 ════════ */

const LECTURE: { title: string; body: ReactNode }[] = [
  {
    title: '为什么要多路树',
    body: <p>数据放在磁盘上，读一次磁盘比读一次内存慢得多。二叉树太高，一次查找要读几十个块，所以要让每个节点多分几个叉。</p>,
  },
  {
    title: '树有多高',
    body: (
      <>
        <p>每个节点最多 <M>m</M> 个孩子，装下 <M>N</M> 条记录所需的层数满足：</p>
        <p className={s.display}><M>h</M> ≥ log<sub><M>m</M></sub> <M>N</M></p>
        <p>m = 200、N = 一亿时，h 只要 4。</p>
      </>
    ),
  },
  {
    title: 'B+ 树的叶子',
    body: (
      <>
        <p>数据只放在叶子，非叶子节点只做索引；叶子按键的大小连成链表。</p>
        <div className={s.diagram} aria-label="示意图：根节点下有三个叶子，叶子之间用箭头相连" role="img">
          <span className={s.node}>30 | 60</span>
          <span className={s.leaves}>
            <span className={s.node}>10 20</span><i aria-hidden="true">→</i>
            <span className={s.node}>30 45</span><i aria-hidden="true">→</i>
            <span className={s.node}>60 80</span>
          </span>
        </div>
      </>
    ),
  },
  {
    title: '范围查询',
    body: (
      <>
        <p>先找到下界所在的叶子，再顺着链表往后读：</p>
        <pre className={s.code}><code>
          leaf = find_leaf(root, lo){'\n'}
          <span className={s.tkKw}>while</span> leaf <span className={s.tkKw}>and</span> leaf.first &lt;= hi:{'\n'}
          {'    '}<span className={s.tkKw}>yield from</span> leaf.keys_between(lo, hi){'\n'}
          {'    '}leaf = leaf.next  <span className={s.tkCom}># 沿链表走到下一片叶子</span>
        </code></pre>
      </>
    ),
  },
];

function ReadStage() {
  const [index, setIndex] = useState(1);
  const [read, setRead] = useState<readonly number[]>([0]);
  const [asked, setAsked] = useState(false);
  const section = LECTURE[index];
  const last = index === LECTURE.length - 1;
  const markRead = () => {
    setRead((prev) => (prev.includes(index) ? prev : [...prev, index]));
    setAsked(false);
    if (!last) setIndex(index + 1);
  };

  return (
    <div className={`${base.panel} ${s.reading}`}>
      <div className={s.readHead}>
        <div>
          <h4>第 7 章 · B 树与 B+ 树</h4>
          <p>逐段读懂，再用自己的话说出来。</p>
        </div>
        <span>{index + 1} / {LECTURE.length}</span>
      </div>
      <nav className={s.chapterNav} aria-label="讲义段落">
        {LECTURE.map((item, at) => (
          <button
            key={item.title}
            type="button"
            aria-current={at === index ? 'step' : undefined}
            onClick={() => { setIndex(at); setAsked(false); }}
          >
            {read.includes(at) ? <Check size={13} strokeWidth={2.4} aria-label="已读" /> : <span>{at + 1}</span>}
            {item.title}
          </button>
        ))}
      </nav>
      <article className={s.readBody} key={index}>
        <h5>{section.title}</h5>
        {section.body}
      </article>
      <div className={s.readActions}>
        <Button variant="soft" disabled={index === 0} icon={<ArrowLeft size={15} strokeWidth={1.75} />} onClick={() => { setIndex(index - 1); setAsked(false); }}>
          上一段
        </Button>
        <Button variant="solid" iconRight={<Check size={15} strokeWidth={2} />} onClick={markRead}>
          {read.includes(index) ? '已读过' : '标记已读'}{last ? '' : '，读下一段'}
        </Button>
        <button type="button" className={s.linkButton} onClick={() => setAsked(true)}>
          带着这段问小砚
          <ArrowRight size={14} strokeWidth={1.9} />
        </button>
      </div>
      <p className={s.readStatus} aria-live="polite">
        {asked && `「${section.title}」已带进对话：小砚先讲清核心想法，再给一个例子。`}
      </p>
    </div>
  );
}

/* ════════ 05 深入答疑 ════════ */

/** 与 lib/studyTutor.ts 的阶段一致 */
const DEEP_STAGES = ['读取所选资料', '拟定讲解提纲', '核对资料依据', '组织解释与自检题'];

const MODES = [
  { icon: IconChat, label: '直接答疑', hint: '先把疑点讲清，再给例子和自检题' },
  { icon: MessageCircleQuestion, label: '引导思考', hint: '给一点提示，每次只问一个问题' },
  { icon: Telescope, label: '深入答疑', hint: 'DeepTutor 多轮核对资料，耗时更长' },
];

function DeepStage() {
  const reduced = useReducedMotion();
  const [ref, visible] = useInView<HTMLDivElement>(0.3);
  const total = DEEP_STAGES.length;
  const [progress, setProgress] = useState(0);
  const shown = reduced ? total : progress;
  const finished = shown >= total;

  useEffect(() => {
    if (reduced || !visible || progress >= total) return undefined;
    const timer = window.setTimeout(() => setProgress((value) => value + 1), progress === 0 ? 600 : 1100);
    return () => window.clearTimeout(timer);
  }, [reduced, visible, progress, total]);

  return (
    <div className={s.deepStage} ref={ref}>
      <div className={`${base.panel} ${s.modes}`}>
        <span className={base.label}>回答方式</span>
        <ul>
          {MODES.map(({ icon: Icon, label, hint }, index) => (
            <li key={label} data-on={index === 2 || undefined}>
              <Icon size={16} strokeWidth={1.75} />
              <span><strong>{label}</strong><small>{hint}</small></span>
              {index === 2 && <Check size={15} strokeWidth={2.2} aria-label="已选" />}
            </li>
          ))}
        </ul>
        <p className={s.modesNote}>深入答疑暂时不可用时会直接提示，换成另外两种方式。</p>
      </div>

      <div className={`${base.panel} ${s.deepRun}`}>
        <Ask>B+ 树删除时，什么时候向兄弟借键，什么时候合并节点？</Ask>
        <ol className={s.stages}>
          {DEEP_STAGES.map((label, index) => {
            const state = index < shown ? 'done' : index === shown ? 'running' : 'wait';
            return (
              <li key={label} data-state={state}>
                <span className={s.stageMark} aria-hidden="true">
                  {state === 'done' ? <Check size={13} strokeWidth={2.4} /> : state === 'running' ? <Spinner size={13} /> : null}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
        <p className={s.srOnly} aria-live="polite">{finished ? '深入答疑已完成' : `正在${DEEP_STAGES[shown]}`}</p>
        {finished && (
          <div className={s.deepAnswer}>
            <ReplyHead meta="DeepTutor · 核对 3 轮" />
            <p className={s.replyText}>
              删除后节点的键少于下限，先看相邻兄弟：兄弟有富余就借一个过来，同时改掉父节点里的分隔键<sup className={s.citeStatic}>1</sup>。
              兄弟也刚好在下限，就把两个节点合并，再从父节点删掉一个分隔键，必要时一路向上调整<sup className={s.citeStatic}>2</sup>。
            </p>
            <p className={s.selfCheck}><b>自检题</b>兄弟节点也刚好在下限时，为什么不能借？</p>
            <p className={s.deepFoot}>
              <span>来源：数据结构·第 7 章.pdf、索引讲义.pptx，和课程、资料库是同一批文件。</span>
              {!reduced && (
                <button type="button" className={s.linkButton} onClick={() => setProgress(0)}>
                  <RotateCw size={13} strokeWidth={2} />
                  再看一遍
                </button>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════ 页签 ════════ */

type TabId = 'answer' | 'sources' | 'guided' | 'read' | 'deep';

const TABS: {
  value: TabId;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  text: string;
  points: string[];
  view: ComponentType;
}[] = [
  {
    value: 'answer', label: '互动回答', icon: IconChat, view: AnswerStage,
    title: '回答可以动手',
    text: '小砚按问题挑合适的形式。模型只产出数据，卡片由应用自己画，不执行模型给的代码；一键切回纯文字。',
    points: ['LaTeX 公式、代码高亮、mermaid 图直接排好', '互动进度存在当前浏览器，不算进掌握度'],
  },
  {
    value: 'sources', label: '资料与出处', icon: IconLibrary, view: SourcesStage,
    title: '只用你勾的资料',
    text: '左侧图标栏直接打开资料库。文件上传一次、解析一次，课程和对话都能用。给这次对话勾几份，回答就只依据这几份，每句后面跟编号。',
    points: ['点编号，看到对应的原文片段和文件名', '一份都不勾，就直接问模型', 'PDF、Word、PPT 在资料库里可以直接预览'],
  },
  {
    value: 'guided', label: '带我学', icon: IconGuide, view: GuidedStage,
    title: '一步一步带你走',
    text: '一课拆成有类型的步骤：概念、例子、自测、反思。哪一步没懂，就停下来问小砚，问完回到原来那一步。',
    points: ['可以跳过，稍后再回来', '走完步骤不等于学会，最后去讲给小白听'],
  },
  {
    value: 'read', label: '读讲义', icon: IconRead, view: ReadStage,
    title: '逐段读讲义',
    text: '讲义按段落排开，读完一段标一段。公式、代码和图在正文里排好；哪一段读不懂，就带着这段去问。',
    points: ['已读的段落打勾，下次接着读'],
  },
  {
    value: 'deep', label: '深入答疑', icon: Telescope, view: DeepStage,
    title: '难题多核对几轮',
    text: '难一点的问题交给深入答疑：DeepTutor 先读资料、拟提纲，再核对依据，最后给出解释和自检题。轮数有上限，用的还是你勾的那几份文件。',
    points: ['每一阶段的进度都显示出来', '和课程、资料库共用同一批资料'],
  },
];

/* ════════ 模型与思考 ════════ */

/** 示意：思考强度越高，想得越久；极速档不思考 */
const THINK_SECONDS = [0, 3, 8, 19, 41];

function ModelCard({ effort, onEffort }: { effort: number; onEffort: (value: number) => void }) {
  const effortId = EFFORTS[effort];
  return (
    <div className={`${base.panel} ${s.small}`}>
      <div className={s.smallHead}>
        <span className={base.label}>模型与思考强度</span>
        <span className={s.effortNow}>{EFFORT_LABELS[effortId]}</span>
      </div>
      <div className={s.modelRow}>
        <IconModel size={16} />
        <strong>默认模型</strong>
        <span>清单由服务器下发，也能接自己的线路</span>
      </div>
      <EffortSlider value={effort} onChange={onEffort} labels={EFFORTS.map((item) => EFFORT_LABELS[item])} />
      <p className={s.effortHint}>{EFFORT_HINTS[effortId]}</p>
    </div>
  );
}

function ThinkingCard({ effort }: { effort: number }) {
  const [open, setOpen] = useState(false);
  const seconds = THINK_SECONDS[effort] ?? 0;
  const label = seconds ? `已思考 ${seconds} 秒 · 1 个步骤` : '已完成 · 1 个步骤';
  return (
    <div className={`${base.panel} ${s.small}`}>
      <div className={s.smallHead}>
        <span className={base.label}>思考过程</span>
        <span className={s.smallHint}>默认折叠</span>
      </div>
      <button type="button" className={s.thinkToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {seconds ? <IconSpark size={15} /> : <ListChecks size={15} strokeWidth={1.75} />}
        <span>{label}</span>
        <ChevronDown size={15} strokeWidth={1.9} className={s.chevron} />
      </button>
      {open && (
        <div className={s.thought}>
          <p className={s.thoughtStep}><Check size={13} strokeWidth={2.4} />核对所选文件</p>
          {seconds > 0 && (
            <p className={s.thoughtText}>
              问的是范围查询为什么快。第 7 章讲了叶子链表，讲义给了扫描步骤。先给结论，分两句各标出处，最后出一道自测题。
            </p>
          )}
        </div>
      )}
      <p className={s.effortHint}>{open ? '再点一下收起。' : '点开看模型怎么想的。'}</p>
    </div>
  );
}

/* ════════ 本章能力清单 ════════ */

const CAPS: readonly Cap[] = [
  { icon: IconQuiz, title: '互动回答', text: '十三种数据卡片：自测题、翻面卡、对比、学习安排、分步推导、图表等，一键切回纯文字。' },
  { icon: Sigma, title: '公式、代码和图', text: 'LaTeX 公式、代码高亮和 mermaid 图在回答和讲义里直接渲染。' },
  { icon: IconLibrary, title: '统一资料库', text: '左侧图标栏打开文件管理器，用文件夹分组，PDF、Word、PPT 可以预览。' },
  { icon: ScanText, title: '上传一次，解析一次', text: '同一份文件在课程和对话之间复用，不重复解析。' },
  { icon: ListChecks, title: '勾选作答依据', text: '给课程或当前对话选文件，回答只依据选中的那几份；一份不选，就直接问模型。' },
  { icon: Quote, title: '句句有出处', text: '结论后面跟编号，点开就是对应的原文片段和文件名。' },
  { icon: IconGuide, title: '带我学', text: '概念、例子、自测、反思四类步骤；中途可以停下来问，问完回到原处。' },
  { icon: IconRead, title: '读讲义', text: '逐段阅读、标记已读，带着某一段去问小砚。' },
  { icon: Telescope, title: '深入答疑', text: 'DeepTutor 有上限地多轮核对资料再作答，和课程、资料库共用同一批文件。' },
  { icon: MessageCircleQuestion, title: '三种回答方式', text: '直接答疑、引导思考、深入答疑，在输入框里切换。' },
  { icon: IconModel, title: '模型与思考强度', text: '在输入框里选模型；思考强度从极速到最高，最多五档。' },
  { icon: IconSpark, title: '看得到思考过程', text: '回答可以带上模型的思考过程，默认折叠，点开才看。' },
  { icon: Send, title: '发送到工作台', text: '回答里的内容可以发送到笔记、闪卡、导图、题目或待办。' },
  { icon: Mic, title: '朗读与听写', text: '浏览器支持时，回答可以朗读，问题可以说出来转成文字。' },
  { icon: IconFlashcard, title: '进度存在本机', text: '互动进度按账号、课程和对话存在当前浏览器，不算正式掌握度。' },
  { icon: Code2, title: '只出数据、不执行', text: '卡片由应用自己画；模型给的 HTML 和脚本不在页面里运行，互动页面只在隔离的沙箱里打开。' },
];

/* ════════ 本章 ════════ */

export function LearnChapter() {
  const [tab, setTab] = useState<TabId>('answer');
  const [effort, setEffort] = useState(2);
  const tabsRef = useRef<HTMLDivElement>(null);

  /** 手机上页签是一条横向带子：切换后把选中的那个滚进视野，只动这一条，不带动整页 */
  const pick = (value: string) => {
    setTab(value as TabId);
    window.requestAnimationFrame(() => {
      const list = tabsRef.current?.querySelector<HTMLElement>('[role="tablist"]');
      const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!list || !active || list.scrollWidth <= list.clientWidth) return;
      list.scrollTo({ left: Math.max(0, active.offsetLeft - 20), behavior: 'smooth' });
    });
  };

  return (
    <section id={SECTION.id} className={base.chapter} aria-labelledby="chapter-learn">
      <div className={base.wrap}>
        <ChapterHead
          no={SECTION.no ?? '01'}
          glyph={SECTION.glyph ?? '学'}
          name={SECTION.label}
          titleId="chapter-learn"
          title="每一句回答，都从你的资料里来。"
          lead="一门课是一个项目，每次对话是一条工作记录。导师小砚只依据你勾选的资料作答，句句标出处；回答可以是能点能翻的卡片，也可以一步步带你学。"
        />

        <div className={`${base.chapterBody} ${s.tour}`} ref={tabsRef} data-reveal>
          <Tabs value={tab} onValueChange={pick} items={TABS.map(({ value, label, icon: Icon }) => ({ value, label, icon: <Icon size={16} strokeWidth={1.75} /> }))} label="学习终端的功能" className={s.tabBar}>
            {TABS.map(({ value, title, text, points, view: View }) => (
              <TabPanel key={value} value={value} className={s.pane}>
                <div className={s.caption}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  {value === 'answer' && (
                    <ul className={s.kinds} aria-label="十三种数据卡片">
                      {KINDS.map((kind) => <li key={kind}>{kind}</li>)}
                    </ul>
                  )}
                  <ul className={s.checks}>
                    {points.map((point) => (
                      <li key={point}><Check size={15} strokeWidth={2.2} />{point}</li>
                    ))}
                  </ul>
                </div>
                <div className={`${base.stage} ${s.stage}`}>
                  <View />
                </div>
              </TabPanel>
            ))}
          </Tabs>
        </div>

        <div className={`${s.pane} ${s.modelPane}`} data-reveal>
          <div className={s.caption}>
            <h3>用哪个模型、想多深，由你定</h3>
            <p>输入框里选模型和思考强度。回答可以带上模型的思考过程，默认折叠，想看再展开。</p>
          </div>
          <div className={`${base.stage} ${s.stage} ${s.pair}`}>
            <ModelCard effort={effort} onEffort={setEffort} />
            <ThinkingCard effort={effort} />
          </div>
        </div>

        <Caps label="学习终端的全部能力" items={CAPS} />
      </div>
    </section>
  );
}
