/**
 * 第四章「托」：助理任务的一次运行（目标 → 清单 → 工具调用 → 子代理 → 定时）与 AI 课堂的一幕白板课。
 * 两块都是终端界面的静态复刻：看得见时自动播放，减弱动效时直接给出完整的最终状态。
 * 工具名、角色名、幕类型、导出格式都与终端里的一致（engine/agent、engine/lessonStudio）。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowUpRight, BookOpen, Boxes, CalendarClock, Check, Circle, CircleHelp, Download, FileCode2, FileText,
  Flag, GitFork, Hand, Layers, Library, ListChecks, NotebookPen, Paperclip, Pause, PenLine, Play,
  Presentation, RotateCcw, RotateCw, Search, SkipBack, SkipForward, Square, Target, Users, Volume2,
  Wrench, type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Progress, Shimmer, Spinner } from '../../components/ui';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './delegate.module.css';

/**
 * 一段按拍推进的自动播放：看得见才走，可暂停，可重放；减弱动效时直接停在最后一拍。
 * delays[i] 是从第 i 拍走到第 i+1 拍要等多久。
 */
function useBeats(delays: readonly number[]) {
  const reduced = useReducedMotion();
  const [ref, visible] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const last = delays.length;

  useEffect(() => {
    if (reduced || held || !visible || step >= last) return undefined;
    const timer = window.setTimeout(() => setStep((value) => value + 1), delays[step]);
    return () => window.clearTimeout(timer);
  }, [reduced, held, visible, step, last, delays]);

  const shown = reduced ? last : step;
  return {
    ref,
    step: shown,
    ended: shown >= last,
    held: held && !reduced,
    toggle: () => setHeld((value) => !value),
    replay: () => { setStep(0); setHeld(false); },
  };
}

// ───────────────────────── 助理任务 ─────────────────────────

/** 一次运行的拍点：每一拍出现一件事 */
const RUN_DELAYS = [700, 1100, 900, 1000, 1300, 1300, 900, 1000, 1000, 1000] as const;

const CHECKLIST = [
  { text: '读完第 7 章，理清 B 树的插入与分裂', at: 3 },
  { text: '写一篇复习笔记，做一套闪卡', at: 7 },
  { text: '每周日晚上提醒复盘', at: 10 },
];

/** 写进工作台的成果，at = 第几拍出现 */
const PRODUCED = [
  { kind: '笔记', title: 'B 树的插入与分裂', icon: NotebookPen, at: 5 },
  { kind: '闪卡', title: 'B 树 · 12 张', icon: Layers, at: 6 },
  { kind: '定时任务', title: '复盘 B 树', icon: CalendarClock, at: 9 },
];

const TOOL_ICON = { size: 15, strokeWidth: 1.75 } as const;

/** 时间线上的一行：左侧圆点 + 右侧内容；没轮到的行占着位置但看不见，播放时版面不跳 */
function RunRow({ icon, tone, shown, children }: { icon: ReactNode; tone?: 'accent' | 'ok'; shown: boolean; children: ReactNode }) {
  return (
    <li className={s.item} data-on={shown || undefined} aria-hidden={shown ? undefined : true}>
      <span className={s.node} data-tone={tone}>{icon}</span>
      <div className={s.itemBody}>{children}</div>
    </li>
  );
}

/** 一张工具卡：名字 + 参数摘要 + 状态，下面一句结果 */
function ToolCard({ name, args, running, ms, result, children }: {
  name: string;
  args: string;
  running: boolean;
  ms: string;
  result?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.tool} data-running={running || undefined}>
      <div className={s.toolHead}>
        <span className={s.toolName}>{name}</span>
        <span className={s.toolArgs}>{args}</span>
        <span className={s.toolState}>
          {running
            ? <><Spinner size={13} /><Shimmer>执行中</Shimmer></>
            : <>{ms}<Check size={14} strokeWidth={2} className={s.okMark} /></>}
        </span>
      </div>
      {(result || children) && (
        <div className={s.toolFoot}>
          {result && <p className={s.toolResult}>{result}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

function Chip({ icon: Icon, kind, title }: { icon: LucideIcon; kind: string; title: string }) {
  return (
    <span className={s.chip}>
      <span className={s.chipIcon}><Icon size={13} strokeWidth={1.75} /></span>
      <span className={s.chipKind}>{kind}</span>
      <span className={s.chipTitle}>{title}</span>
      <ArrowUpRight size={13} strokeWidth={1.75} className={s.chipArrow} />
    </span>
  );
}

/** 子代理泳道：标题 + 依次调用过的工具 + 成果 */
function Lane({ title, brief, trail, step, doneAt, chip }: {
  title: string;
  brief: string;
  trail: { name: string; at: number }[];
  step: number;
  doneAt: number;
  chip: (typeof PRODUCED)[number];
}) {
  const done = step >= doneAt;
  return (
    <div className={s.lane} data-done={done || undefined}>
      <div className={s.laneHead}>
        <strong>{title}</strong>
        {done ? <Badge className={s.tag} tone="ok" dot>完成</Badge> : <Shimmer className={s.laneState}>进行中</Shimmer>}
      </div>
      <p className={s.laneBrief}>{brief}</p>
      <ol className={s.trail} aria-label="已调用的工具">
        {trail.map((item) => <li key={item.name} data-on={step >= item.at || undefined}>{item.name}</li>)}
      </ol>
      <div className={s.laneChip} data-on={done || undefined}>
        <Chip icon={chip.icon} kind={chip.kind} title={chip.title} />
      </div>
    </div>
  );
}

function AgentRun() {
  const { ref, step, ended, held, toggle, replay } = useBeats(RUN_DELAYS);
  const doneCount = CHECKLIST.filter((item) => step >= item.at).length;
  const produced = PRODUCED.filter((item) => step >= item.at);
  const status = ended
    ? { label: '已完成', tone: 'ok' as const }
    : held ? { label: '已停止', tone: 'neutral' as const } : { label: '进行中', tone: 'accent' as const };

  const action = ended
    ? <Button variant="soft" size="sm" icon={<RotateCw size={14} strokeWidth={1.75} />} onClick={replay}>重新运行</Button>
    : held
      ? <Button variant="solid" size="sm" icon={<Play size={14} strokeWidth={2} />} onClick={toggle}>继续推进</Button>
      : <Button variant="outline" size="sm" icon={<Square size={12} strokeWidth={2} />} onClick={toggle}>停止</Button>;

  return (
    <div ref={ref} className={`${base.panel} ${s.run}`}>
      <header className={s.runHead}>
        <div className={s.runHeading}>
          <div className={s.badges}>
            <Badge className={s.tag} tone={status.tone} dot>{status.label}</Badge>
            <Badge className={s.tag} tone="outline">目标模式</Badge>
            <Badge className={s.tag} tone="outline">子代理</Badge>
          </div>
          <h4 className={s.runTitle}>B 树：复习笔记、闪卡与每周复盘</h4>
          <p className={s.runMeta}>
            <span>第 1 轮 · {step} 步</span>
            <span>课程：数据结构</span>
            <span>2 份附件</span>
          </p>
        </div>
        <div className={s.runAction}>{action}</div>
      </header>

      {/* 目标：一段话 + 附上的资料库文件与自己生成的内容 */}
      <div className={s.goalBox}>
        <p>把第 7 章 B 树整理成复习笔记，做一套闪卡，每周日晚上提醒我复盘。</p>
        <div className={s.context}>
          <span className={s.ctx}><BookOpen size={13} strokeWidth={1.75} /><span>数据结构</span></span>
          <span className={s.ctx}><Paperclip size={13} strokeWidth={1.75} /><span>第 7 章 B 树.pdf</span></span>
          <span className={s.ctx}><ListChecks size={13} strokeWidth={1.75} /><span>我生成的 · 第 6 章题目集</span></span>
        </div>
      </div>

      <section className={s.checklist} aria-label="目标清单">
        <div className={s.checkHead}>
          <span>目标清单</span>
          <span className={s.checkCount}>{doneCount} / {CHECKLIST.length}</span>
        </div>
        <Progress value={doneCount} max={CHECKLIST.length} tone={doneCount === CHECKLIST.length ? 'ok' : 'accent'} label="目标进度" />
        <ul className={s.checkList}>
          {CHECKLIST.map((item) => {
            const done = step >= item.at;
            return (
              <li key={item.text} data-done={done || undefined}>
                <span className={s.checkMark}>{done ? <Check size={12} strokeWidth={2.6} /> : <Circle size={12} strokeWidth={1.75} />}</span>
                <span>{item.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <ol className={s.timeline} aria-label="执行过程">
        <RunRow icon={<FileText {...TOOL_ICON} />} tone={step === 1 ? 'accent' : undefined} shown={step >= 1}>
          <ToolCard name="阅读资料" args="第 7 章 B 树.pdf" running={step < 2} ms="1.2s" result="第 7 章 B 树 · 读了 18432 字" />
        </RunRow>
        <RunRow icon={<Target {...TOOL_ICON} />} shown={step >= 3}>
          <p className={s.notice}>更新目标清单 · 1/3 项完成</p>
        </RunRow>
        <RunRow icon={<GitFork {...TOOL_ICON} />} tone={step >= 4 && step < 6 ? 'accent' : undefined} shown={step >= 4}>
          <ToolCard name="派出子代理" args="2 个子代理并行" running={step < 6} ms="38.4s">
            <div className={s.lanes}>
              <Lane
                title="复习笔记"
                brief="按插入、分裂、删除三节写，配例子"
                trail={[{ name: '检索资料', at: 4 }, { name: '保存笔记', at: 5 }]}
                step={step}
                doneAt={5}
                chip={PRODUCED[0]}
              />
              <Lane
                title="闪卡"
                brief="一卡一问，避开第 6 章已经会的"
                trail={[{ name: '阅读我的内容', at: 4 }, { name: '生成闪卡', at: 6 }]}
                step={step}
                doneAt={6}
                chip={PRODUCED[1]}
              />
            </div>
          </ToolCard>
        </RunRow>
        <RunRow icon={<Target {...TOOL_ICON} />} shown={step >= 7}>
          <p className={s.notice}>更新目标清单 · 2/3 项完成</p>
        </RunRow>
        <RunRow icon={<CalendarClock {...TOOL_ICON} />} tone={step === 8 ? 'accent' : undefined} shown={step >= 8}>
          <ToolCard name="创建定时任务" args="复盘 B 树 · 每周 20:00" running={step < 9} ms="0.3s" result="每周日 20:00 · 只在应用打开时执行">
            <div className={s.toolChip} data-on={step >= 9 || undefined}>
              <Chip icon={CalendarClock} kind="定时任务" title="复盘 B 树" />
            </div>
          </ToolCard>
        </RunRow>
        <RunRow icon={<Flag {...TOOL_ICON} />} tone="ok" shown={step >= 10}>
          <div className={s.summary}>
            <span className={s.summaryLabel}>任务小结</span>
            <p>笔记和 12 张闪卡已写进工作台，复盘排在每周日 20:00。关着应用时不会运行，错过的下次打开补跑一次。</p>
          </div>
        </RunRow>
      </ol>

      <section className={s.produced} aria-label="已写入工作台">
        <h5 aria-live="polite">已写入工作台 <span>{produced.length} 项</span></h5>
        <div className={s.chips}>
          {PRODUCED.map((item) => (
            <span key={item.title} className={s.producedChip} data-on={step >= item.at || undefined} aria-hidden={step >= item.at ? undefined : true}>
              <Chip icon={item.icon} kind={item.kind} title={item.title} />
            </span>
          ))}
        </div>
        <p className={s.libraryNote}><Library size={14} strokeWidth={1.75} />同时存进资料库「我生成的」。</p>
      </section>
    </div>
  );
}

// ───────────────────────── AI 课堂 ─────────────────────────

type Speaker = 'teacher' | 'xiaobai' | 'acheng';

const FACE: Record<Speaker | 'user', string> = { teacher: '砚', xiaobai: '白', acheng: '澄', user: '我' };
const NAME: Record<Speaker, string> = { teacher: '小砚', xiaobai: '小白', acheng: '阿澄' };

/** 这一幕的口播与插话；board = 讲到这句时白板上已经写了几笔 */
const LINES: { who: Speaker; text: string; board: number }[] = [
  { who: 'teacher', text: '先记规则：一个节点最多放两个键。', board: 1 },
  { who: 'teacher', text: '现在往右边插入 50，这个节点就装了三个键。', board: 2 },
  { who: 'xiaobai', text: '那为什么是 40 上去，不是 50？', board: 2 },
  { who: 'teacher', text: '取中间的键，分出去的两半一样大，树才平衡。', board: 3 },
  { who: 'acheng', text: '父节点要是也满了，就接着往上分！', board: 3 },
  { who: 'teacher', text: '对，一直分到根。根一分裂，树就长高一层。', board: 3 },
];
const LINE_DELAYS = [2400, 2600, 2400, 2800, 2400] as const;

const SCENES: { type: string; icon: LucideIcon; title: string }[] = [
  { type: '幻灯片', icon: Presentation, title: '为什么要多路平衡' },
  { type: '幻灯片', icon: Presentation, title: 'B 树的定义' },
  { type: '白板', icon: PenLine, title: '插入 50 之后' },
  { type: '测验', icon: CircleHelp, title: '会不会分裂' },
  { type: '互动模拟', icon: Boxes, title: '动手插入' },
  { type: '白板', icon: PenLine, title: '删除与合并' },
  { type: '测验', icon: CircleHelp, title: '综合练习' },
  { type: '项目实践', icon: Target, title: '给成绩表建索引' },
];
const CURRENT_SCENE = 2;

function Face({ who, size }: { who: Speaker | 'user'; size: 'sm' | 'md' }) {
  return <span className={s.face} data-speaker={who} data-size={size} aria-hidden="true">{FACE[who]}</span>;
}

function Classroom() {
  const { ref, step, ended, held, toggle, replay } = useBeats(LINE_DELAYS);
  const line = LINES[step];
  const playing = !ended && !held;
  const [exportNote, setExportNote] = useState('');

  const onExport = (label: string) =>
    setExportNote(`进入终端后，在课堂右上角「导出」里选 ${label}，文件直接下载到本机。`);

  return (
    <div ref={ref} className={`${base.panel} ${s.lesson}`}>
      <header className={s.lessonHead}>
        <div className={s.lessonHeading}>
          <h4>B 树：节点满了怎么办</h4>
          <p className={s.runMeta}>
            <span>有基础 · 标准 8 幕</span>
            <span className={s.withIcon}><Paperclip size={12} strokeWidth={1.75} />第 7 章 B 树.pdf</span>
          </p>
        </div>
        <div className={s.exports}>
          <Button variant="outline" size="sm" icon={<Download size={14} strokeWidth={1.75} />} aria-label="导出 PPTX" onClick={() => onExport('「导出 PPTX」')}>PPTX</Button>
          <Button variant="outline" size="sm" icon={<FileCode2 size={14} strokeWidth={1.75} />} aria-label="导出交互式 HTML" onClick={() => onExport('「导出交互式 HTML」')}>HTML</Button>
        </div>
      </header>
      <p className={s.exportNote} aria-live="polite" data-on={exportNote ? true : undefined}>{exportNote}</p>

      <section className={s.stageCard} aria-label={`第 ${CURRENT_SCENE + 1} 幕：插入 50 之后`}>
        <i className={s.stageProgress} style={{ '--p': (step + 1) / LINES.length } as CSSProperties} aria-hidden="true" />
        <div className={s.stageHead}>
          <span className={s.sceneChip}><PenLine size={13} strokeWidth={1.75} />白板</span>
          <strong>插入 50 之后</strong>
          <span className={s.sceneCount}>03 / 08</span>
        </div>

        {/* 白板：老师边讲边写的三笔 */}
        <div className={s.board}>
          <p className={s.chalk} data-on={line.board >= 1 || undefined}>每个节点最多放 2 个键</p>
          <div className={s.tree} data-on={line.board >= 2 || undefined} role="img" aria-label="一棵 B 树：根节点 20，左孩子 10，右孩子 30、40，正在插入 50">
            <div className={s.key}><b>20</b></div>
            <div className={s.kids}>
              <div className={s.kid}><div className={s.key}><b>10</b></div></div>
              <div className={s.kid}><div className={s.key} data-full={line.board >= 3 || undefined}><b>30</b><b data-mid>40</b><b data-new>50</b></div></div>
            </div>
          </div>
          <p className={s.chalkMark} data-on={line.board >= 3 || undefined}>放不下了：中间的 40 上移到父节点</p>
        </div>
      </section>

      {/* 讲台圆桌：当前这句话 + 老师与两位同学 */}
      <div className={s.table}>
        <div className={s.bubble} data-speaker={line.who} aria-live="polite">
          <span className={s.bubbleWho}>
            <Face who={line.who} size="sm" />
            {NAME[line.who]}
            {playing && <span className={s.wave} aria-hidden="true"><i /><i /><i /><i /></span>}
          </span>
          <p key={step}>{line.text}</p>
        </div>
        <ul className={s.mates} aria-label="课堂成员">
          <li data-speaking={line.who === 'teacher' || undefined}><Face who="teacher" size="md" /><span>小砚<small>主讲</small></span></li>
          <li data-speaking={line.who === 'xiaobai' || undefined}><Face who="xiaobai" size="md" /><span>小白<small>爱问为什么</small></span></li>
          <li data-speaking={line.who === 'acheng' || undefined}><Face who="acheng" size="md" /><span>阿澄<small>抢答快</small></span></li>
          <li><Face who="user" size="md" /><span>我<small>在听</small></span></li>
        </ul>
      </div>

      <div className={s.transport}>
        <div className={s.keys}>
          <span className={s.ghostKey} aria-hidden="true"><SkipBack size={16} strokeWidth={1.75} /></span>
          <button
            type="button"
            className={s.playBtn}
            aria-label={ended ? '再上一遍' : playing ? '暂停' : '播放'}
            onClick={ended ? replay : toggle}
          >
            {ended ? <RotateCcw size={17} strokeWidth={2} /> : playing ? <Pause size={17} strokeWidth={2} /> : <Play size={17} strokeWidth={2} />}
          </button>
          <span className={s.ghostKey} aria-hidden="true"><SkipForward size={16} strokeWidth={1.75} /></span>
        </div>
        <span className={s.opt}><Volume2 size={15} strokeWidth={1.75} />朗读 · 浏览器语音 · 1×</span>
        <span className={s.opt} data-strong><Hand size={15} strokeWidth={1.75} />举手提问</span>
      </div>

      <ol className={s.rail} aria-label="这堂课的 8 幕">
        {SCENES.map((scene, index) => (
          <li key={scene.title} data-current={index === CURRENT_SCENE || undefined} data-done={index < CURRENT_SCENE || undefined}>
            <span className={s.railTop}><scene.icon size={12} strokeWidth={1.75} /><span>{scene.type}</span><b>{index + 1}</b></span>
            <span className={s.railTitle}>{scene.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────────── 章节 ─────────────────────────

const CAPS: readonly Cap[] = [
  { icon: Target, title: '给目标就开工', text: '写下要办的事，小砚拆成步骤、调用工具去做，每一步都看得见。' },
  { icon: Wrench, title: '工具直接写进工作台', text: '保存笔记、生成思维导图、题目集、闪卡，添加待办，批改作文，翻译。' },
  { icon: ListChecks, title: '目标模式', text: '维护一份目标清单逐项打勾；一轮步数用完自动续跑，最多 3 轮。' },
  { icon: GitFork, title: '子代理', text: '互不依赖的子任务交给 2 到 4 个子代理并行，各走一条泳道。' },
  { icon: CalendarClock, title: '定时任务', text: '一次、每天或每周到点开工；只在应用打开时运行，错过的下次打开补跑一次。' },
  { icon: Search, title: '先读资料再动手', text: '检索、阅读课程资料、附上的资料库文件和你生成的内容。' },
  { icon: Presentation, title: '一键生成课程', text: '写一个主题或附上文件，先出大纲再逐幕生成，短课 5 幕到长课 12 幕。' },
  { icon: Boxes, title: '五种幕', text: '幻灯片、白板、测验、互动模拟、项目实践，按需勾选；学习者水平分零基础、有基础、备考冲刺。' },
  { icon: Users, title: '多角色授课', text: '小砚主讲，小白爱问为什么，阿澄抢答快；你可以随时举手提问。' },
  { icon: Volume2, title: '白板与朗读', text: '老师边讲边写板书，用浏览器自带语音朗读，语速可调。' },
  { icon: Download, title: '导出 PPTX 与 HTML', text: 'PPTX 能在 PowerPoint、WPS 里接着改；HTML 是单个文件，测验和互动都能用。' },
  { icon: Library, title: '成果进资料库', text: '任务记录与课程存在当前浏览器、按账号分开；成果另存一份到资料库「我生成的」。' },
];

export function DelegateChapter() {
  const meta = sectionById('delegate');
  return (
    <section id="delegate" className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="chapter-delegate">
      <div className={base.wrap}>
        <ChapterHead
          no={meta.no ?? '04'}
          glyph={meta.glyph ?? '托'}
          name={meta.label}
          titleId="chapter-delegate"
          title="整件事，可以直接交出去。"
          lead="有些事不必一步步点。说清目标，交给小砚去办；想系统学一个主题，让 AI 课堂备好一整节。两边都能附上资料库里的文件和你生成的内容。"
        />

        <div className={`${base.chapterBody} ${s.feature}`}>
          <div className={s.copy}>
            <div className={base.sticky} data-reveal>
              <span className={base.label}>助理任务</span>
              <h3 className={s.copyTitle}>说一个目标，小砚自己办完</h3>
              <p className={s.copyLead}>她把事情拆成步骤，一步步调用工具：读资料、写笔记、出题、做闪卡。每一步的结果直接写进工作台，点开就能用。</p>
              <ul className={`${base.points} ${s.points}`}>
                <li><strong>目标模式</strong><span>列一份目标清单逐项打勾；一轮步数用完自动续跑，最多 3 轮。</span></li>
                <li><strong>子代理</strong><span>互不依赖的事拆给 2 到 4 个子代理同时做。</span></li>
                <li><strong>定时任务</strong><span>每天、每周或某个时刻自动开工。只在应用打开时运行，错过的下次打开补跑一次。</span></li>
              </ul>
            </div>
          </div>
          <div className={`${base.stage} ${s.stageWrap}`} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
            <AgentRun />
          </div>
        </div>

        <div className={`${s.feature} ${s.featureFlip}`}>
          <div className={s.copy}>
            <div className={base.sticky} data-reveal>
              <span className={base.label}>AI 课堂</span>
              <h3 className={s.copyTitle}>给一个主题，上一整节课</h3>
              <p className={s.copyLead}>写一个主题，或附上资料库里的文件，先出大纲再逐幕生成。小砚主讲，小白和阿澄在旁边提问、抢答，你随时可以举手。</p>
              <ul className={`${base.points} ${s.points}`}>
                <li><strong>白板与朗读</strong><span>老师边讲边写板书，用浏览器自带的语音朗读，语速可调。</span></li>
                <li><strong>五种幕</strong><span>幻灯片、白板、测验、互动模拟、项目实践。</span></li>
                <li><strong>导出</strong><span>PPTX 能在 PowerPoint、WPS 里接着改；HTML 是单个文件，测验和互动都能用。</span></li>
              </ul>
            </div>
          </div>
          <div className={`${base.stage} ${s.stageWrap}`} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
            <Classroom />
          </div>
        </div>

        <Caps label="助理任务与 AI 课堂的全部能力" items={CAPS} />
      </div>
    </section>
  );
}
