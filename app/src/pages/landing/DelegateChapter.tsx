/** 第四章「托」：助理任务的一次运行、AI 课堂的一页课、资料库的几份文件。 */
import type { CSSProperties } from 'react';
import { Bot, CalendarClock, Check, Download, Presentation, Split } from 'lucide-react';
import { Badge, Spinner } from '../../components/ui';
import { ChapterHead } from './ChapterHead';
import base from './landing.module.css';
import s from './delegate.module.css';

/** 工具名与终端里助理实际调用的一致 */
const SUBTASKS = [
  { who: '子助理 A', task: '整理笔记', tool: 'save_note', result: '笔记《第 7 章 索引结构》' },
  { who: '子助理 B', task: '出选择题', tool: 'create_quiz_set', result: '题目集 · 10 题' },
];

function AgentRun() {
  const delay = (order: number) => ({ '--d': `${order * 260}ms` }) as CSSProperties;
  return (
    <div className={`${base.panel} ${s.run}`}>
      <div className={s.panelHead}>
        <Bot size={17} strokeWidth={1.75} />
        <strong>助理任务</strong>
        <Badge tone="accent" dot>运行中</Badge>
      </div>
      <p className={s.goal}>把第 7 章整理成笔记，再出 10 道选择题，每周日提醒我复盘。</p>

      <ol className={s.log}>
        <li style={delay(1)}>
          <i data-done><Check size={12} strokeWidth={3} /></i>
          <div>
            <code>read_material</code>
            <span>读完 数据结构·第 7 章.pdf</span>
          </div>
        </li>
        <li style={delay(2)}>
          <i data-done><Check size={12} strokeWidth={3} /></i>
          <div>
            <code>spawn_subagents</code>
            <span>拆成 2 个子任务，并行</span>
            <div className={s.lanes}>
              {SUBTASKS.map((sub) => (
                <div key={sub.who} className={s.lane}>
                  <span className={s.laneWho}>
                    <Split size={13} strokeWidth={2} />
                    {sub.who} · {sub.task}
                  </span>
                  <code>{sub.tool}</code>
                  <span className={s.laneResult}>
                    <Check size={13} strokeWidth={2.6} />
                    {sub.result}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </li>
        <li style={delay(3)}>
          <i data-done><Check size={12} strokeWidth={3} /></i>
          <div>
            <code>schedule_task</code>
            <span className={s.withIcon}>
              <CalendarClock size={14} strokeWidth={1.75} />
              每周日 20:00 · 复盘错题
            </span>
          </div>
        </li>
        <li style={delay(4)}>
          <i><Spinner size={13} /></i>
          <div>
            <code>create_mindmap</code>
            <span>正在画这一章的思维导图…</span>
          </div>
        </li>
      </ol>

      <p className={s.runFoot}>结果直接写进工作台：笔记 1 · 题目集 1 · 定时任务 1</p>
    </div>
  );
}

const OUTLINE = ['课件 6 页', '测验 5 题', '互动演示 1 个', '项目任务 1 项'];

function Lesson() {
  return (
    <div className={`${base.panel} ${s.lesson}`}>
      <div className={s.panelHead}>
        <Presentation size={17} strokeWidth={1.75} />
        <strong>AI 课堂</strong>
        <span className={s.exports}>
          <span><Download size={13} strokeWidth={2} />PPTX</span>
          <span><Download size={13} strokeWidth={2} />HTML</span>
        </span>
      </div>

      <div className={s.slide}>
        <span className={s.slideNo}>3 / 6</span>
        <strong>节点满了，怎么分裂？</strong>
        <div className={s.tree} aria-hidden="true">
          <div className={s.node}><b>30</b></div>
          <div className={s.kids}>
            <div className={s.node}><b>10</b><b>20</b></div>
            <div className={s.node}><b>30</b><b>40</b><b data-new>50</b></div>
          </div>
          <span className={s.chalk}>放不下了，中间的键上移</span>
        </div>
      </div>

      <div className={s.voices}>
        <p>
          <span className={s.speaker} data-teacher>师</span>
          <span>
            先看右边这个节点：最多放两个键，现在来了第三个。
            <span className={s.wave} aria-hidden="true"><i /><i /><i /><i /></span>
          </span>
        </p>
        <p>
          <span className={s.speaker}>同</span>
          <span>老师，分裂以后父节点也满了怎么办？</span>
        </p>
      </div>

      <ul className={s.outline} aria-label="这节课包含">
        {OUTLINE.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

const FILES = [
  { type: 'PDF', name: '数据结构·第 7 章.pdf', meta: '38 页', ready: true },
  { type: 'PPT', name: '索引讲义.pptx', meta: '24 页', ready: true },
  { type: 'DOC', name: '往年试卷.docx', meta: '6 页', ready: true },
  { type: 'MD', name: '课堂笔记.md', meta: '解析中', ready: false },
];

export function DelegateChapter() {
  return (
    <section id="delegate" className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="chapter-delegate">
      <div className={base.wrap}>
        <ChapterHead
          no="04"
          glyph="托"
          name="助理与课堂"
          titleId="chapter-delegate"
          title="整件事，可以直接交出去。"
          lead="有些事不必自己一步步点。说清目标，交给助理去办；想系统学一个主题，让 AI 课堂备好一整节。"
        />

        <div className={`${base.chapterBody} ${s.duo}`}>
          <div className={s.col} data-reveal>
            <div className={s.colText}>
              <h3>给一个目标，它自己办完</h3>
              <p>调研、整理、出题。助理分步执行，调用工具把结果写进工作台；能并行，也能定时。</p>
            </div>
            <AgentRun />
          </div>

          <div className={s.col} data-reveal style={{ '--reveal-delay': '90ms' } as CSSProperties}>
            <div className={s.colText}>
              <h3>给一个主题，生成一整节课</h3>
              <p>课件、测验、互动演示、项目任务，由 AI 老师和同学带着白板与语音讲完，可导出 PPTX 或 HTML。</p>
            </div>
            <Lesson />
          </div>
        </div>

        <div className={s.library} data-reveal>
          <div className={s.libraryText}>
            <h3>资料放进来，就是课</h3>
            <p>PDF、PPT、Word、Markdown，上传后原地预览，解析成课程资料。答疑、出题、备课，都从这里取材。</p>
          </div>
          <ul className={`${base.panel} ${s.files}`}>
            {FILES.map((file) => (
              <li key={file.name}>
                <span className={s.fileType}>{file.type}</span>
                <strong>{file.name}</strong>
                <span className={s.fileMeta}>{file.meta}</span>
                {file.ready
                  ? <Badge tone="ok">已解析</Badge>
                  : <span className={s.parsing}><i /></span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
