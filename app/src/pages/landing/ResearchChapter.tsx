/**
 * 第五章「研」：科研台。左边是一个课题的文件树，右边是一次会话的时间线：
 * 目标 → 计划 → 检索到的文献 → 运行 Python 前的审批（可以真点）→ 代码输出与结论。
 * 界面件照着 pages/learn/views/research 的真实样子做，文献条目是 OpenAlex、Europe PMC、arXiv 上真实存在的论文。
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowUp, BookMarked, BookOpenText, Check, ChevronRight, CircleCheck, CircleDashed, CircleDot, CirclePause, CircleSlash,
  ClipboardList, Cpu, Download, ExternalLink, FilePlus2, FileSearch, FileText, Folder, FolderTree, GitFork, HardDrive, Image as ImageIcon,
  MessageSquareText, Paperclip, RotateCcw, Search, Shield, ShieldAlert, ShieldCheck, ShieldQuestion, SquareSlash, Table2, Target, Terminal, Zap,
} from 'lucide-react';
import { Badge, Button, Segmented, Shimmer, Spinner } from '../../components/ui';
import { IconSpark } from '../../components/ui/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Caps } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './research.module.css';

const ICON = { size: 15, strokeWidth: 1.75 } as const;

/* ── 时间线里的固定内容 ── */

type Mode = 'ask' | 'risky' | 'auto';

/** 与 ResearchComposer 的 PERMISSION_OPTIONS 同名同义 */
const MODES: { value: Mode; label: string; short: string; hint: string }[] = [
  { value: 'ask', label: '每步询问', short: '每步问', hint: '检索、读文献、写文件、运行代码前都先问你' },
  { value: 'risky', label: '仅高风险询问', short: '高风险问', hint: '覆盖或删除文件、运行 Python、首次访问某个文献来源时问你' },
  { value: 'auto', label: '全自动', short: '全自动', hint: '不再逐步询问，过程仍完整记录在时间线里' },
];

/** 检索「spacing effect forgetting curve」实际能取到的三篇 */
const PAPERS = [
  {
    title: 'Distributed practice in verbal recall tasks: A review and quantitative synthesis',
    meta: 'Nicholas J. Cepeda, Harold Pashler, Edward Vul 等 · 2006 · Psychological Bulletin',
    source: 'OpenAlex',
    id: 'doi:10.1037/0033-2909.132.3.354',
    short: 'Cepeda 等 2006 · Psychological Bulletin',
  },
  {
    title: "Replication and Analysis of Ebbinghaus' Forgetting Curve",
    meta: 'Jaap M. J. Murre, Joeri Dros · 2015 · PLOS ONE',
    source: 'Europe PMC',
    id: 'doi:10.1371/journal.pone.0120644',
    short: 'Murre, Dros 2015 · PLOS ONE',
  },
  {
    title: 'Unbounded Human Learning: Optimal Scheduling for Spaced Repetition',
    meta: 'Siddharth Reddy, Igor Labutov, Siddhartha Banerjee 等 · 2016 · arXiv',
    source: 'arXiv',
    id: 'arXiv:1602.07032',
    short: 'Reddy 等 2016 · arXiv:1602.07032',
  },
];

const CODE = `import numpy as np, pandas as pd
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

df = pd.read_csv("data/recall.csv")
rate = df.groupby("interval_days")["recalled"].mean()
f = lambda t, s: np.exp(-t / s)
(s,), _ = curve_fit(f, rate.index, rate.values, p0=[5])
print(f"n={len(df)}  s={s:.1f} days")

plt.plot(rate.index, rate.values, "o", label="observed")
plt.plot(rate.index, f(rate.index, s), label="fit")
plt.savefig("figures/fig1.png", dpi=150)`;

const STDOUT = 'n=412  s=9.4 days';

/* ── 课题文件 ── */

interface TreeFile { name: string; icon: typeof FileText; fresh?: boolean }
interface TreeDir { dir: string; files: TreeFile[] }

const isDir = (node: TreeDir | TreeFile): node is TreeDir => 'dir' in node;

/** 文件树照课题里实际有的文件长出来：运行前没有 code/ 与 figures/ */
function tree(done: boolean): (TreeDir | TreeFile)[] {
  const nodes: (TreeDir | TreeFile)[] = [
    { dir: 'code', files: done ? [{ name: 'fit_curve.py', icon: Terminal, fresh: true }] : [] },
    { dir: 'data', files: [{ name: 'recall.csv', icon: Table2 }] },
    { dir: 'figures', files: done ? [{ name: 'fig1.png', icon: ImageIcon, fresh: true }] : [] },
    { dir: 'notes', files: [{ name: 'screening.md', icon: FileText }] },
    { name: 'references.bib', icon: BookMarked },
    ...(done ? [{ name: 'report.md', icon: FileText, fresh: true }] : []),
  ];
  return nodes.filter((node) => !isDir(node) || node.files.length > 0);
}


/* ── 状态 ── */

type Phase = 'ask' | 'deny' | 'running' | 'done' | 'denied';
type Grant = 'once' | 'session';

/** 审批前依次出现的几步：用户的话、计划、读文件、检索、审批卡 */
const STEPS = 5;

function Plan({ phase }: { phase: Phase }) {
  const finished = phase === 'done';
  const items: { text: string; status: 'done' | 'active' | 'pending' }[] = [
    { text: '读入 data/recall.csv，检查字段与缺失值', status: 'done' },
    { text: '检索间隔重复与遗忘曲线的研究', status: 'done' },
    { text: '拟合指数遗忘曲线并画图', status: finished ? 'done' : 'active' },
    { text: '对照文献写 report.md', status: finished ? 'done' : 'pending' },
  ];
  const doneCount = items.filter((item) => item.status === 'done').length;
  const Icons = { done: CircleCheck, active: CircleDot, pending: CircleDashed } as const;
  return (
    <section className={s.plan} aria-label="计划清单">
      <div className={s.planHead}>
        <ClipboardList {...ICON} aria-hidden="true" />
        <strong>计划</strong>
        <span className={s.planCount}>{doneCount}/{items.length}</span>
        <span className={s.planTrack} aria-hidden="true"><i style={{ transform: `scaleX(${doneCount / items.length})` }} /></span>
        {finished && <span className={s.planNow}>全部完成</span>}
      </div>
      <ol className={s.planItems}>
        {items.map((item) => {
          const Icon = Icons[item.status];
          return (
            <li key={item.text} data-status={item.status}>
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>{item.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 一次工具调用的标题行（时间线里的 ToolCard 头） */
function ToolHead({ icon: Icon, name, what, state, time, tone = 'ok' }: {
  icon: typeof Search; name: string; what: string; state: ReactNode; time?: string; tone?: 'ok' | 'denied' | 'running';
}) {
  return (
    <div className={s.toolHead} data-tone={tone}>
      <span className={s.toolIcon}><Icon {...ICON} /></span>
      <span className={s.toolName}>{name}</span>
      <span className={s.toolWhat}>{what}</span>
      <span className={s.toolState}>
        {tone === 'running'
          ? <><Spinner size={13} /><Shimmer>进行中</Shimmer></>
          : tone === 'denied'
            ? <><span>{state}</span><CircleSlash size={14} strokeWidth={1.75} className={s.warnMark} /></>
            : <><span>{state}</span><Check size={14} strokeWidth={2} className={s.okMark} /></>}
      </span>
      {time && <span className={s.toolTime}>{time}</span>}
    </div>
  );
}

function Papers() {
  return (
    <ol className={s.papers}>
      {PAPERS.map((paper, index) => (
        <li key={paper.id} className={s.paper}>
          <span className={s.paperNo}>{index + 1}</span>
          <div className={s.paperMain}>
            <div className={s.paperTop}>
              <span className={s.paperTitle}>
                {paper.title}
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <Badge tone="outline">{paper.source}</Badge>
            </div>
            <p className={s.paperMeta}>{paper.meta}</p>
            <p className={s.paperId}>{paper.id}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 遗忘曲线：回忆率随间隔天数下降，点是观测值，线是拟合的 exp(-t/9.4) */
const OBSERVED: [number, number][] = [[1, 0.91], [2, 0.8], [4, 0.66], [7, 0.46], [14, 0.25], [21, 0.12], [30, 0.06]];
const X = (t: number) => 44 + (t / 30) * 252;
const Y = (v: number) => 150 - v * 128;
const FIT = Array.from({ length: 31 }, (_, t) => `${t ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(Math.exp(-t / 9.4)).toFixed(1)}`).join(' ');

function Chart() {
  return (
    <figure className={s.figure}>
      <svg viewBox="0 0 310 186" role="img" aria-label="遗忘曲线：回忆率从间隔 1 天的 0.91 降到 30 天的 0.06，拟合的记忆稳定度为 9.4 天">
        <text x="44" y="12" className={s.chartTitle}>Forgetting curve (s = 9.4 d)</text>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1="44" x2="296" y1={Y(v)} y2={Y(v)} className={v === 0 ? s.chartAxis : s.chartGrid} />
            <text x="36" y={Y(v) + 4} textAnchor="end" className={s.chartTick}>{v}</text>
          </g>
        ))}
        {[0, 7, 14, 21, 30].map((t) => (
          <text key={t} x={X(t)} y="168" textAnchor="middle" className={s.chartTick}>{t}</text>
        ))}
        <text x="296" y="184" textAnchor="end" className={s.chartTick}>days</text>
        <path d={FIT} className={s.chartFit} />
        {OBSERVED.map(([t, v]) => <circle key={t} cx={X(t)} cy={Y(v)} r="4" className={s.chartDot} />)}
      </svg>
      <figcaption>figures/fig1.png</figcaption>
    </figure>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    // 代码在自己的框里横向滚动，不撑宽整页
    <pre className={s.code} tabIndex={0} aria-label={label}><code>{code}</code></pre>
  );
}

function Approval({ phase, onGrant, onDeny, onDenyOpen, onBack }: {
  phase: Phase;
  onGrant: (grant: Grant) => void;
  onDeny: (reason: string) => void;
  onDenyOpen: () => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onDeny(reason.trim());
  };
  return (
    <section className={s.approval} aria-label="等待批准">
      <header className={s.approvalHead}>
        <span className={s.approvalIcon}><ShieldAlert size={17} strokeWidth={1.75} /></span>
        <div>
          <strong>运行 Python：code/fit_curve.py</strong>
          <span>运行 Python · 需要你的批准</span>
        </div>
      </header>
      <CodeBlock code={CODE} label="待批准运行的代码" />
      {phase === 'deny' ? (
        <form className={s.approvalDeny} onSubmit={submit}>
          <input
            className={s.denyInput}
            autoFocus
            value={reason}
            maxLength={200}
            placeholder="告诉助手为什么不行，或者该怎么改"
            aria-label="拒绝的理由"
            onChange={(change) => setReason(change.target.value)}
          />
          <div className={s.approvalActions}>
            <Button type="submit" variant="danger" size="sm">拒绝</Button>
            <Button variant="ghost" size="sm" onClick={onBack}>返回</Button>
          </div>
        </form>
      ) : (
        <>
          <div className={s.approvalActions}>
            <Button variant="solid" size="sm" onClick={() => onGrant('once')}>允许一次</Button>
            <Button variant="soft" size="sm" onClick={() => onGrant('session')}>本次会话都允许</Button>
            <Button variant="ghost" size="sm" onClick={onDenyOpen}>拒绝并说明</Button>
          </div>
          <p className={s.approvalTip}>选一个，时间线会接着往下走。</p>
        </>
      )}
    </section>
  );
}

function Final() {
  return (
    <section className={s.final} aria-label="结论">
      <header className={s.finalHead}>
        <span className={s.finalMark}><IconSpark size={16} /></span>
        <strong>结论</strong>
      </header>
      <p className={s.finalText}>
        {'回忆率随间隔按指数下降，拟合出的记忆稳定度约 9.4 天：隔一周还能想起不到一半。曲线形状与 Murre 和 Dros 复现的艾宾浩斯遗忘曲线一致 [2]；'
          + '分散复习优于集中复习的结论见 [1]，按遗忘曲线安排复习间隔的调度方法见 [3]。'}
      </p>
      <div className={s.finalPart}>
        <h4>产出的文件</h4>
        <div className={s.chips}>
          {['report.md', 'figures/fig1.png', 'code/fit_curve.py'].map((path) => (
            <span key={path} className={s.chip}><FileText size={14} strokeWidth={1.75} /><span>{path}</span></span>
          ))}
        </div>
      </div>
      <div className={s.finalPart}>
        <h4>用到的文献</h4>
        <ol className={s.sources}>
          {PAPERS.map((paper) => (
            <li key={paper.id}>
              <Check size={14} strokeWidth={2} className={s.okMark} />
              <span>{paper.short}</span>
            </li>
          ))}
        </ol>
        <p className={s.sourcesNote}>每条都能在本次的检索记录里找到。对不上的来源会标黄，提醒你核对原文。</p>
      </div>
    </section>
  );
}

/** 左栏：课题 → 会话 → 文件树 → 文献（ResearchNav 的课题页） */
function ProjectNav({ phase }: { phase: Phase }) {
  const done = phase === 'done';
  const nodes = tree(done);
  const fileCount = nodes.reduce((sum, node) => sum + (isDir(node) ? node.files.length : 1), 0);
  return (
    <div className={s.nav} role="group" aria-label="课题、会话与文件">
      <div className={s.navTitle}>
        <strong>遗忘曲线与间隔重复</strong>
        <span className={s.navAction}><MessageSquareText size={14} strokeWidth={1.75} />新会话</span>
      </div>
      <ul className={s.navGroup}>
        <li><ArrowLeft {...ICON} /><span>全部课题</span><em>3</em></li>
        <li><Target {...ICON} /><span>课题目标</span></li>
      </ul>
      <p className={s.navLabel}>会话</p>
      <ul className={s.navGroup}>
        <li data-current>
          {phase === 'ask' || phase === 'deny' ? <CirclePause {...ICON} /> : phase === 'running' ? <Spinner size={15} /> : <MessageSquareText {...ICON} />}
          <span>拟合我的遗忘曲线</span>
        </li>
        <li><MessageSquareText {...ICON} /><span>间隔重复文献综述</span></li>
      </ul>
      <p className={s.navLabel}>文件 · {fileCount}</p>
      <ul className={s.navGroup} aria-label="课题文件">
        {nodes.map((node) => (isDir(node) ? (
          <li key={node.dir} className={s.dirRow}>
            <div className={s.dirName}><Folder size={14} strokeWidth={1.75} />{node.dir}</div>
            <ul>
              {node.files.map((file) => (
                <li key={file.name} data-fresh={file.fresh || undefined}>
                  <file.icon {...ICON} /><span>{file.name}</span>{file.fresh && <i className={s.freshDot} aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <li key={node.name} data-fresh={node.fresh || undefined}>
            <node.icon {...ICON} /><span>{node.name}</span>{node.fresh && <i className={s.freshDot} aria-hidden="true" />}
          </li>
        )))}
      </ul>
      <p className={s.navLabel}>文献 · 3</p>
      <ul className={s.navGroup}>
        {PAPERS.map((paper) => <li key={paper.id}><BookMarked {...ICON} /><span>{paper.short.split(' · ')[0]}</span></li>)}
      </ul>
      <p className={s.navFoot}>课题、会话和文件保存在这台设备的浏览器里</p>
    </div>
  );
}

/** 手机：文件树收成一行课题条 + 文件签 */
function CompactNav({ phase }: { phase: Phase }) {
  const files = tree(phase === 'done').flatMap((node) => (isDir(node) ? node.files.map((file) => ({ ...file, name: `${node.dir}/${file.name}` })) : [node]));
  return (
    <div className={s.compact}>
      <div className={s.compactBar}>
        <FolderTree size={16} strokeWidth={1.75} />
        <strong>遗忘曲线与间隔重复</strong>
        <ChevronRight size={14} strokeWidth={1.75} />
        <span>拟合我的遗忘曲线</span>
      </div>
      <ul className={s.compactFiles} aria-label={`课题文件 · ${files.length}`}>
        {files.map((file) => (
          <li key={file.name} data-fresh={file.fresh || undefined}><file.icon size={13} strokeWidth={1.75} />{file.name}</li>
        ))}
      </ul>
    </div>
  );
}

function StatusRow() {
  const items: { label: string; tone: 'ok' | 'warn' }[] = [
    { label: '模型可用', tone: 'ok' },
    { label: '文献检索已连接', tone: 'ok' },
    { label: 'Python 可用', tone: 'ok' },
    { label: '文件存在本浏览器', tone: 'warn' },
  ];
  return (
    <p className={s.status} aria-label="当前可用的能力">
      {items.map((item) => <span key={item.label} data-tone={item.tone}><i aria-hidden="true" />{item.label}</span>)}
    </p>
  );
}

function Composer({ phase, mode, onMode }: { phase: Phase; mode: Mode; onMode: (mode: Mode) => void }) {
  const current = MODES.find((item) => item.value === mode) ?? MODES[1];
  const ModeIcon = mode === 'ask' ? ShieldQuestion : mode === 'auto' ? Zap : ShieldCheck;
  return (
    <div className={s.composer}>
      <div className={s.box}>
        <p className={s.placeholder}>
          {phase === 'ask' || phase === 'deny'
            ? '助手在等你批准上面的操作…'
            : phase === 'running' ? '助手正在工作，可以随时停止' : '描述一个研究任务；输入 / 用技能，@ 附带文件'}
        </p>
        <div className={s.toolbar}>
          <span className={s.toolGlyph} aria-hidden="true"><Paperclip size={17} strokeWidth={1.75} /></span>
          <span className={s.toolGlyph} aria-hidden="true"><SquareSlash size={17} strokeWidth={1.75} /></span>
          <Segmented
            className={s.modes}
            size="sm"
            label="权限模式"
            value={mode}
            onChange={onMode}
            options={MODES.map((item) => ({
              value: item.value,
              title: item.hint,
              label: <><span className={s.modeLong}>{item.label}</span><span className={s.modeShort}>{item.short}</span></>,
            }))}
          />
          <span className={s.send} aria-hidden="true"><ArrowUp size={18} strokeWidth={2.25} /></span>
        </div>
      </div>
      <p className={s.modeHint} aria-live="polite">
        <ModeIcon size={14} strokeWidth={1.75} aria-hidden="true" />
        <span><strong>{current.label}</strong>：{current.hint}</span>
      </p>
      <StatusRow />
    </div>
  );
}

function Session() {
  const reduced = useReducedMotion();
  const [ref, visible] = useInView<HTMLDivElement>(0.2);
  const [shown, setShown] = useState(1);
  const [phase, setPhase] = useState<Phase>('ask');
  const [grant, setGrant] = useState<Grant>('once');
  const [denyReason, setDenyReason] = useState('');
  const [mode, setMode] = useState<Mode>('risky');
  const steps = reduced ? STEPS : shown;

  /* 进入视口后一步步把时间线放出来，停在审批卡上等你点 */
  useEffect(() => {
    if (reduced || !visible || shown >= STEPS) return undefined;
    const timer = window.setTimeout(() => setShown((value) => value + 1), shown === 1 ? 500 : 750);
    return () => window.clearTimeout(timer);
  }, [reduced, visible, shown]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const timer = window.setTimeout(() => setPhase('done'), reduced ? 0 : 1300);
    return () => window.clearTimeout(timer);
  }, [phase, reduced]);

  const allow = (value: Grant) => {
    setGrant(value);
    setPhase('running');
  };
  const deny = (reason: string) => {
    setDenyReason(reason);
    setPhase('denied');
  };
  const reset = () => {
    setPhase('ask');
    setDenyReason('');
  };

  const resolved = phase === 'running' || phase === 'done' || phase === 'denied';
  return (
    <div ref={ref} className={`${base.panel} ${s.desk}`}>
      <ProjectNav phase={phase} />
      <CompactNav phase={phase} />

      <div className={s.console}>
        <header className={s.bar}>
          <strong>遗忘曲线与间隔重复</strong>
          <span>拟合我的遗忘曲线</span>
        </header>

        <div className={s.feed} role="log" aria-label="科研会话">
          {steps >= 1 && (
            <div className={s.turn} data-enter>
              <span className={s.turnMark} aria-hidden="true">›</span>
              <div className={s.turnBody}>
                <p>用 data/recall.csv 拟合我的遗忘曲线，再找几篇间隔重复的研究对照一下。</p>
                <div className={s.chips}>
                  <span className={s.chip} data-static><Paperclip size={13} strokeWidth={1.75} /><span>data/recall.csv</span></span>
                  <span className={s.chip} data-static><Paperclip size={13} strokeWidth={1.75} /><span>认知心理学·第 6 章 记忆.pdf</span></span>
                </div>
              </div>
            </div>
          )}

          {steps >= 2 && <div data-enter><Plan phase={phase} /></div>}

          {steps >= 3 && (
            <div className={s.tool} data-enter>
              <ToolHead icon={FileSearch} name="读文件" what="data/recall.csv" state="412 行 · 3 列" time="0.1 s" />
            </div>
          )}

          {steps >= 4 && (
            <div data-enter>
              <p className={s.approvalDone} data-tone="ok">
                <ShieldCheck size={15} strokeWidth={1.75} />
                <span>已允许一次 · 检索文献：spacing effect forgetting curve</span>
              </p>
              <div className={s.tool} data-open>
                <ToolHead icon={Search} name="检索文献" what="spacing effect forgetting curve" state="3 篇" time="1.4 s" />
                <div className={s.toolBody}>
                  <Papers />
                  <p className={s.note}>经网关访问 OpenAlex、arXiv、Europe PMC、Crossref，发送的只有检索式。</p>
                </div>
              </div>
            </div>
          )}

          {steps >= 5 && (
            <div aria-live="polite" data-enter>
              {!resolved ? (
                <Approval
                  phase={phase}
                  onGrant={allow}
                  onDeny={deny}
                  onDenyOpen={() => setPhase('deny')}
                  onBack={() => setPhase('ask')}
                />
              ) : phase === 'denied' ? (
                <div className={s.after}>
                  <p className={s.approvalDone} data-tone="bad">
                    <CircleSlash size={15} strokeWidth={1.75} />
                    <span>{`已拒绝${denyReason ? `：${denyReason}` : ''}`} · 运行 Python：code/fit_curve.py</span>
                  </p>
                  <div className={s.tool}>
                    <ToolHead icon={Terminal} name="运行 Python" what="code/fit_curve.py" state="没有批准" tone="denied" />
                  </div>
                  <p className={s.note}>这一步没有运行。你的说明会交给助手，它据此调整下一步。</p>
                </div>
              ) : (
                <div className={s.after}>
                  <p className={s.approvalDone} data-tone="ok">
                    <ShieldCheck size={15} strokeWidth={1.75} />
                    <span>{grant === 'session' ? '已允许（本次会话不再询问）' : '已允许一次'} · 运行 Python：code/fit_curve.py</span>
                  </p>
                  <div className={s.tool} data-open>
                    {phase === 'running'
                      ? <ToolHead icon={Terminal} name="运行 Python" what="code/fit_curve.py" state="" tone="running" />
                      : <ToolHead icon={Terminal} name="运行 Python" what="code/fit_curve.py" state="成功 · 1 张图" time="2.4 s" />}
                    <div className={s.toolBody}>
                      <CodeBlock code={CODE} label="运行的代码" />
                      {phase === 'done' && (
                        <>
                          <p className={s.detailLabel}>标准输出</p>
                          <pre className={s.stdout}>{STDOUT}</pre>
                          <Chart />
                          <p className={s.note}>在这台设备的浏览器里运行，用时 2.4 s。代码和数据没有离开浏览器。</p>
                        </>
                      )}
                    </div>
                  </div>
                  {phase === 'done' && (
                    <>
                      <div className={s.tool}>
                        <ToolHead icon={FilePlus2} name="写文件" what="report.md" state="新建 · 1,284 字" time="0.1 s" />
                      </div>
                      <Final />
                    </>
                  )}
                </div>
              )}
              {(phase === 'done' || phase === 'denied') && (
                <div className={s.replay}>
                  <Button variant="ghost" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={reset}>回到审批这一步</Button>
                </div>
              )}
            </div>
          )}
        </div>

        <Composer phase={phase} mode={mode} onMode={setMode} />
      </div>
    </div>
  );
}

export function ResearchChapter() {
  const meta = sectionById('research');
  return (
    <section id={meta.id} className={base.chapter} aria-labelledby="research-title">
      <div className={base.wrap}>
        <ChapterHead
          no={meta.no!}
          glyph={meta.glyph!}
          name={meta.label}
          titleId="research-title"
          title="先给你看计划，再查文献、跑代码"
          lead="科研台按编码助手的方式做研究：一个课题一套文件，一段会话一条时间线。助手先列计划再动手；写文件、运行代码、访问新的文献来源之前，按你选的权限档位先问你。"
        />

        <div className={`${base.chapterBody} ${base.stage}`} data-reveal>
          <Session />
        </div>

        <Caps
          label="科研台的全部能力"
          items={[
            { icon: FolderTree, title: '课题、会话与文件', text: '一个课题一套文件（笔记、数据、代码、图、报告），可以开多段会话；设了课题目标，每轮都对照它。' },
            { icon: ClipboardList, title: '先出计划', text: '用 /plan 只出计划书，批准、修改或放弃后再执行；执行时置顶的计划清单随进度打勾。' },
            { icon: Shield, title: '三档权限', text: '每步询问、仅高风险询问、全自动；每次审批可以允许一次、本次会话都允许，或拒绝并说明。' },
            { icon: Search, title: '真实文献检索', text: '经网关查 OpenAlex、arXiv、Europe PMC、Crossref，也可点名 PubMed、Semantic Scholar；发出去的只有检索式。' },
            { icon: BookOpenText, title: '引用只用检到的', text: '结论里的文献逐条与检索记录核对，对不上的标黄提醒；保存的文献自动写进 references.bib。' },
            { icon: Terminal, title: '浏览器里跑 Python', text: '带 numpy、pandas、scipy、matplotlib；代码和数据不上传服务器，画的图存进 figures/。' },
            { icon: GitFork, title: '并行助手', text: '题目较宽时派出几个并行助手，分头检索、阅读，再把结果汇总回来。' },
            { icon: SquareSlash, title: '技能指令', text: '/survey 文献综述、/idea 选题探索、/analyze 数据分析、/reproduce 复现实验、/review 完整性审查、/write 写作。' },
            { icon: Paperclip, title: '附带资料', text: '用 @ 附上课题文件、别的板块生成的内容或资料库文档；报告、笔记和脚本也会出现在资料库。' },
            { icon: Cpu, title: '模型跟随全局设置', text: '科研台用你在设置里选的模型线路，不用单独配置。' },
            { icon: HardDrive, title: '存在本浏览器', text: '课题、会话和文件按账号保存在这台设备的浏览器里，换设备不会带过去。' },
            { icon: Download, title: '导出课题', text: '整个课题导出为压缩包，附一份文件来历清单 PROVENANCE.md，写明每个文件出自哪一步。' },
          ]}
        />
      </div>
    </section>
  );
}
