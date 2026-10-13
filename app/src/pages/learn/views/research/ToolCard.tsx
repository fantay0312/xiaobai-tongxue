/** 时间线里的一次工具调用：一行摘要，点开看参数、结果、代码与输出、文献行、差异。 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  BookMarked, BookOpenText, Check, ChevronRight, CircleAlert, CircleSlash, ExternalLink, FileMinus, FilePen, FilePlus2, FileSearch, FileText,
  FolderOpen, FolderTree, GitFork, ListChecks, Search, Target, Terminal, Wrench, type LucideIcon,
} from 'lucide-react';
import { Badge, Shimmer, Spinner } from '../../../../components/ui';
import { CodeBlock } from '../../../../components/rich';
import { describeCall, formatBytes, parseArgs, readFile, toolLabel, type PaperRow, type ResearchEvent, type ToolView, type WorkerLane } from '../../../../engine/research';
import { PAPER_SOURCE_LABELS, type PaperSource } from '../../../../lib/researchConnectors';
import { duration, lineDiff, prettyJson } from './format';
import r from './research.module.css';

type ToolEvent = Extract<ResearchEvent, { type: 'tool' }>;

const ICON = { size: 15, strokeWidth: 1.75 } as const;

const TOOL_ICONS: Record<string, LucideIcon> = {
  update_plan: ListChecks,
  search_papers: Search,
  read_paper: BookOpenText,
  save_paper: BookMarked,
  list_files: FolderTree,
  read_file: FileSearch,
  write_file: FilePlus2,
  edit_file: FilePen,
  delete_file: FileMinus,
  run_python: Terminal,
  read_library_file: FolderOpen,
  spawn_workers: GitFork,
  set_goal: Target,
};

function errorOf(event: ToolEvent): string {
  if (!event.result) return '';
  const parsed = parseArgs(event.result);
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  const error = typeof parsed.error === 'string' ? parsed.error : '';
  return event.status === 'denied' ? `没有批准${reason && reason !== '未说明理由' ? `：${reason}` : ''}` : error;
}

/** 卡片标题右侧的一句结果 */
function resultSummary(event: ToolEvent): string {
  if (event.status === 'running') return '';
  if (event.status === 'denied' || event.status === 'error') {
    const view = event.view;
    if (view?.kind === 'python' && !view.ok) return view.durationMs ? '运行出错' : '没有运行';
    return errorOf(event).slice(0, 60) || '没有成功';
  }
  const view = event.view;
  if (!view) {
    if (event.name === 'update_plan') {
      const parsed = parseArgs(event.result ?? '');
      return typeof parsed.total === 'number' ? `${parsed.done ?? 0}/${parsed.total} 完成` : '';
    }
    return '';
  }
  switch (view.kind) {
    case 'papers': return `${view.total} 篇`;
    case 'paper': return view.fullText ? `正文 ${view.chars} 字${view.truncated ? '，未读完' : ''}` : '只有摘要';
    case 'saved': return `文献列表共 ${view.total} 篇`;
    case 'python': return [view.ok ? '成功' : '出错', view.figures.length ? `${view.figures.length} 张图` : '', view.files.length ? `${view.files.length} 个文件` : ''].filter(Boolean).join(' · ');
    case 'write': return `${view.created ? '新建' : '已覆盖'} · ${view.chars} 字`;
    case 'edit': return `替换 ${view.count} 处`;
    case 'read': return `${view.chars} 字${view.truncated ? '，分段读取' : ''}`;
    case 'files': return `${view.files.length} 个文件`;
    case 'delete': return '已删除';
    case 'library': return `${view.chars} 字${view.truncated ? '，节选' : ''}`;
    case 'libraryList': return `${view.files.length} 个文件`;
    default: return '';
  }
}

/** 课题里的一张图：从浏览器存储里取出来显示 */
export function WorkspaceImage({ owner, projectId, path, onOpen }: { owner: string | null; projectId: string; path: string; onOpen?: (path: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setMissing(false);
    void readFile(owner, projectId, path).then((file) => {
      if (!alive) return;
      if (file && file.meta.encoding === 'dataurl') setSrc(file.content);
      else setMissing(true);
    });
    return () => { alive = false; };
  }, [owner, projectId, path]);
  if (missing) return <span className={r.figureMissing}>{path}（图已不在）</span>;
  const image = src ? <img src={src} alt={path} loading="lazy" /> : <span className={r.figureLoading} />;
  return onOpen
    ? <button type="button" className={r.figure} onClick={() => onOpen(path)} title={`打开 ${path}`}>{image}<span>{path}</span></button>
    : <figure className={r.figure}>{image}<figcaption>{path}</figcaption></figure>;
}

export function PaperRows({ papers }: { papers: PaperRow[] }) {
  if (!papers.length) return <p className={r.detailEmpty}>没有命中的文献。</p>;
  return (
    <ul className={r.paperRows}>
      {papers.map((paper) => (
        <li key={paper.id} className={r.paperRow}>
          <div className={r.paperTop}>
            <a className={r.paperTitle} href={paper.url} target="_blank" rel="noreferrer noopener">
              {paper.title}
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
            <Badge tone="outline">{PAPER_SOURCE_LABELS[paper.source as PaperSource] ?? paper.source}</Badge>
          </div>
          <p className={r.paperMeta}>
            {[
              paper.authors.length > 3 ? `${paper.authors.slice(0, 3).join(', ')} 等` : paper.authors.join(', '),
              paper.year,
              paper.venue,
              typeof paper.citedBy === 'number' ? `被引 ${paper.citedBy}` : '',
            ].filter(Boolean).join(' · ')}
          </p>
          {paper.abstract && <p className={r.paperAbstract}>{paper.abstract}</p>}
          <p className={r.paperLinks}>
            {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer noopener">doi:{paper.doi}</a>}
            {!paper.doi && <span>{paper.id}</span>}
            {paper.openAccessUrl && <a href={paper.openAccessUrl} target="_blank" rel="noreferrer noopener">开放全文</a>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const rows = lineDiff(before, after);
  return (
    <div className={r.diff} role="group" aria-label="改动对比">
      {rows.map((row, index) => (
        <div key={index} className={r.diffRow} data-kind={row.kind}>
          <span aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>
          <code>{row.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}

const LANE_LABELS: Record<WorkerLane['status'], string> = { queued: '排队中', running: '进行中', done: '完成', error: '未完成' };

function Lanes({ lanes }: { lanes: WorkerLane[] }) {
  return (
    <div className={r.lanes}>
      {lanes.map((lane) => (
        <section key={lane.id} className={r.lane} data-status={lane.status}>
          <header className={r.laneHead}>
            {lane.status === 'running' ? <Spinner size={14} /> : lane.status === 'done' ? <Check {...ICON} /> : lane.status === 'error' ? <CircleAlert {...ICON} /> : <GitFork {...ICON} />}
            <strong>{lane.title}</strong>
            <span>{LANE_LABELS[lane.status]}{lane.steps ? ` · ${lane.steps} 步` : ''}</span>
          </header>
          {lane.trail.length > 0 && (
            <ol className={r.laneTrail}>
              {lane.trail.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          )}
          {lane.summary
            ? <p className={r.laneSummary}>{lane.summary}</p>
            : lane.status === 'running' && <p className={r.laneSummary}><Shimmer>正在检索与阅读…</Shimmer></p>}
          {lane.sources && lane.sources.length > 0 && (
            <ul className={r.laneSources}>
              {lane.sources.map((source, index) => <li key={index}>{source}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className={r.detailLabel}>{children}</p>;
}

function ViewDetail({ view, onOpenFile }: { view: ToolView; onOpenFile: (path: string) => void }) {
  switch (view.kind) {
    case 'papers':
      return <PaperRows papers={view.papers} />;
    case 'paper':
      return (
        <>
          <PaperRows papers={[view.paper]} />
          <p className={r.detailNote}>
            {view.fullText
              ? `本次读入正文 ${view.chars} 字${view.truncated ? '；正文没有读完或取回的正文不完整' : ''}。`
              : '没有取到开放获取的正文，助手只读到了摘要。'}
          </p>
        </>
      );
    case 'saved':
      return <PaperRows papers={[view.paper]} />;
    case 'python':
      return (
        <>
          <CodeBlock code={view.code} language="python" />
          {view.savedAs && <FileChips paths={[view.savedAs]} onOpenFile={onOpenFile} label="脚本已保存" />}
          {view.stdout && (<><Label>标准输出</Label><pre className={r.pre}>{view.stdout}</pre></>)}
          {view.result && (<><Label>返回值</Label><pre className={r.pre}>{view.result}</pre></>)}
          {view.error && (<><Label>报错</Label><pre className={r.pre} data-tone="bad">{view.error}</pre></>)}
          {view.stderr && !view.error && (<><Label>标准错误</Label><pre className={r.pre}>{view.stderr}</pre></>)}
          {view.files.length > 0 && <FileChips paths={view.files} onOpenFile={onOpenFile} label="写出的文件" />}
          {!view.stdout && !view.error && !view.result && !view.figures.length && <p className={r.detailEmpty}>没有输出。</p>}
          <p className={r.detailNote}>在这台设备的浏览器里运行{view.durationMs ? `，用时 ${duration(view.durationMs)}` : ''}。</p>
        </>
      );
    case 'write':
      return (
        <>
          <FileChips paths={[view.path]} onOpenFile={onOpenFile} />
          {view.before !== undefined ? <Diff before={view.before} after={view.after} /> : <pre className={r.pre}>{view.after}</pre>}
          {view.chars > view.after.length && <p className={r.detailNote}>只显示开头部分，全文 {view.chars} 字。</p>}
        </>
      );
    case 'edit':
      return (
        <>
          <FileChips paths={[view.path]} onOpenFile={onOpenFile} />
          <Diff before={view.oldText} after={view.newText} />
        </>
      );
    case 'read':
      return (
        <>
          <FileChips paths={[view.path]} onOpenFile={onOpenFile} />
          <pre className={r.pre}>{view.excerpt}</pre>
        </>
      );
    case 'files':
      return view.files.length ? (
        <ul className={r.fileRows}>
          {view.files.map((file) => (
            <li key={file.path}>
              <button type="button" onClick={() => onOpenFile(file.path)}><FileText size={14} strokeWidth={1.75} />{file.path}</button>
              <span>{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : <p className={r.detailEmpty}>课题里还没有文件。</p>;
    case 'delete':
      return <p className={r.detailNote}>已删除 {view.path}。</p>;
    case 'library':
      return (
        <>
          <Label>{view.title}</Label>
          <pre className={r.pre}>{view.excerpt}</pre>
          {view.truncated && <p className={r.detailNote}>读入的是节选，不是全文（共 {view.chars} 字）。</p>}
        </>
      );
    case 'libraryList':
      return view.files.length ? (
        <ul className={r.fileRows}>
          {view.files.map((file) => <li key={file.id}><span><FileText size={14} strokeWidth={1.75} />{file.name}</span><span>{file.status}</span></li>)}
        </ul>
      ) : <p className={r.detailEmpty}>资料库里还没有文件。</p>;
    default:
      return null;
  }
}

export function FileChips({ paths, onOpenFile, label }: { paths: string[]; onOpenFile: (path: string) => void; label?: string }) {
  return (
    <div className={r.chips}>
      {label && <span className={r.chipsLabel}>{label}</span>}
      {paths.map((path) => (
        <button key={path} type="button" className={r.chip} onClick={() => onOpenFile(path)} title={`打开 ${path}`}>
          <FileText size={14} strokeWidth={1.75} />
          <span>{path}</span>
        </button>
      ))}
    </div>
  );
}

export function ToolCard({ event, owner, projectId, onOpenFile }: { event: ToolEvent; owner: string | null; projectId: string; onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[event.name] ?? Wrench;
  const what = describeCall(event.name, event.args);
  const summary = resultSummary(event);
  const running = event.status === 'running';
  const figures = event.view?.kind === 'python' ? event.view.figures : [];
  const showLive = running && !!event.live;
  const error = event.status === 'error' || event.status === 'denied' ? errorOf(event) : '';

  return (
    <div className={r.tool} data-status={event.status} data-open={open || undefined}>
      <button type="button" className={r.toolHead} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={r.toolIcon}><Icon {...ICON} /></span>
        <span className={r.toolName}>{toolLabel(event.name)}</span>
        {what && <span className={r.toolWhat}>{what}</span>}
        <span className={r.toolState}>
          {running
            ? <><Spinner size={13} /><Shimmer>进行中</Shimmer></>
            : event.status === 'done'
              ? <>{summary && <span>{summary}</span>}<Check size={14} strokeWidth={2} className={r.okMark} /></>
              : event.status === 'denied'
                ? <><span>{summary}</span><CircleSlash size={14} strokeWidth={1.75} className={r.warnMark} /></>
                : <><span>{summary}</span><CircleAlert size={14} strokeWidth={1.75} className={r.badMark} /></>}
        </span>
        {event.ms !== undefined && !running && <span className={r.toolTime}>{duration(event.ms)}</span>}
        <ChevronRight size={14} strokeWidth={1.75} className={r.toolChevron} aria-hidden="true" />
      </button>

      {showLive && !open && <pre className={r.pre} data-live>{event.live}</pre>}
      {event.lanes && event.lanes.length > 0 && <Lanes lanes={event.lanes} />}
      {figures.length > 0 && (
        <div className={r.figures}>
          {figures.map((path) => <WorkspaceImage key={path} owner={owner} projectId={projectId} path={path} onOpen={onOpenFile} />)}
        </div>
      )}

      {open && (
        <div className={r.toolBody}>
          {error && <p className={r.toolError}>{error}</p>}
          {event.view
            ? <ViewDetail view={event.view} onOpenFile={onOpenFile} />
            : (
              <>
                <Label>参数</Label>
                <pre className={r.pre}>{prettyJson(event.args)}</pre>
                {event.live && running && (<><Label>实时输出</Label><pre className={r.pre}>{event.live}</pre></>)}
                {event.result && !running && (<><Label>结果</Label><pre className={r.pre}>{prettyJson(event.result)}</pre></>)}
              </>
            )}
        </div>
      )}
    </div>
  );
}
