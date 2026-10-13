/**
 * 右侧面板：预览与编辑选中的课题文件，或查看一篇已保存的文献。
 * Markdown 可切换编辑；CSV 显示成表；图片直接看；.py 高亮并可运行；.bib 排成文献列表。每个文件都带来历与下载。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, AtSign, BookMarked, Download, Ellipsis, ExternalLink, Eye, FileText, History, Pencil, Play, Trash2, X,
} from 'lucide-react';
import { Badge, Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Spinner, toast } from '../../../../components/ui';
import { SendTo } from '../../../../components/handoff';
import { CodeBlock } from '../../../../components/rich';
import {
  ACTOR_LABELS, WorkspaceError, baseName, downloadFile, extensionOf, formatBytes, isImagePath, localBibtex, readFile, runProjectPython, writeFile,
  type FileMeta, type PythonView, type ResearchProject, type SavedPaper,
} from '../../../../engine/research';
import { PAPER_SOURCE_LABELS } from '../../../../lib/researchConnectors';
import { WorkspaceImage } from './ToolCard';
import { WorkspaceMarkdown } from './WorkspaceMarkdown';
import { clock, duration, parseBib, parseCsv } from './format';
import r from './research.module.css';

export type PanelSelection = { kind: 'list' } | { kind: 'file'; path: string } | { kind: 'paper'; id: string };

interface Props {
  owner: string | null;
  project: ResearchProject;
  files: FileMeta[];
  papers: SavedPaper[];
  selection: PanelSelection;
  /** 没有常驻侧栏时，面板自己带文件列表和返回 */
  withList: boolean;
  pythonReady: boolean;
  onSelect: (selection: PanelSelection) => void;
  onClose: () => void;
  onMention: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onRemovePaper: (id: string) => void;
  onNewFile: () => void;
  onUpload: () => void;
}

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function CsvTable({ text, delimiter }: { text: string; delimiter: string }) {
  const { rows, total } = useMemo(() => parseCsv(text, delimiter), [text, delimiter]);
  if (!rows.length) return <p className={r.panelEmpty}>这份表格是空的。</p>;
  const [head, ...body] = rows;
  return (
    <>
      <div className={r.tableWrap}>
        <table className={r.table}>
          <thead><tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>{head.map((_cell, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={r.panelNote}>共 {Math.max(0, total - 1)} 行、{head.length} 列{total > rows.length ? `，只显示前 ${rows.length - 1} 行` : ''}。</p>
    </>
  );
}

function BibList({ text }: { text: string }) {
  const entries = useMemo(() => parseBib(text), [text]);
  if (!entries.length) return <pre className={r.pre}>{text || '（空）'}</pre>;
  return (
    <ol className={r.bibList}>
      {entries.map((entry) => (
        <li key={entry.key}>
          <p className={r.bibTitle}>{entry.fields.title ?? entry.key}</p>
          <p className={r.bibMeta}>
            {[entry.fields.author?.replace(/\s+and\s+/g, ', '), entry.fields.year, entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.howpublished].filter(Boolean).join(' · ')}
          </p>
          <p className={r.bibMeta}>
            <code>{entry.key}</code>
            {entry.fields.doi && <a href={`https://doi.org/${entry.fields.doi}`} target="_blank" rel="noreferrer noopener">doi:{entry.fields.doi}</a>}
            {!entry.fields.doi && entry.fields.url && <a href={entry.fields.url} target="_blank" rel="noreferrer noopener">链接</a>}
          </p>
        </li>
      ))}
    </ol>
  );
}

function RunOutput({ view, owner, projectId, onOpenFile }: { view: PythonView; owner: string | null; projectId: string; onOpenFile: (path: string) => void }) {
  return (
    <section className={r.runOutput} data-ok={view.ok || undefined} aria-label="运行结果">
      <h4>{view.ok ? '运行完成' : view.durationMs ? '运行出错' : '没有运行'}{view.durationMs ? ` · ${duration(view.durationMs)}` : ''}</h4>
      {view.stdout && <pre className={r.pre}>{view.stdout}</pre>}
      {view.result && <pre className={r.pre}>{view.result}</pre>}
      {view.error && <pre className={r.pre} data-tone="bad">{view.error}</pre>}
      {!view.stdout && !view.result && !view.error && !view.figures.length && <p className={r.panelNote}>没有输出。</p>}
      {view.figures.length > 0 && (
        <div className={r.figures}>
          {view.figures.map((path) => <WorkspaceImage key={path} owner={owner} projectId={projectId} path={path} onOpen={onOpenFile} />)}
        </div>
      )}
      {view.files.length > 0 && <p className={r.panelNote}>写出的文件：{view.files.join('、')}</p>}
    </section>
  );
}

function Provenance({ meta }: { meta: FileMeta }) {
  const entries = [...meta.provenance].reverse();
  return (
    <details className={r.provenance}>
      <summary>
        <History size={14} strokeWidth={1.75} />
        <span>来历</span>
        <em>{entries[0] ? `${ACTOR_LABELS[entries[0].actor]} · ${clock(entries[0].at)}` : '没有记录'}</em>
      </summary>
      <ol>
        {entries.map((entry, index) => (
          <li key={index}>
            <strong>{ACTOR_LABELS[entry.actor]}{entry.action === 'create' ? '创建' : '修改'}</strong>
            <span>
              {[entry.tool, entry.sessionTitle ? `会话「${entry.sessionTitle}」` : '', entry.turn ? `第 ${entry.turn} 轮` : '', entry.note].filter(Boolean).join(' · ')}
            </span>
            <time>{clock(entry.at)}</time>
          </li>
        ))}
      </ol>
    </details>
  );
}

function FileView({ owner, project, files, meta, pythonReady, onSelect, onMention, onDeleteFile, onRenameFile, head }: {
  owner: string | null; project: ResearchProject; files: FileMeta[]; meta: FileMeta; pythonReady: boolean;
  onSelect: Props['onSelect']; onMention: Props['onMention']; onDeleteFile: Props['onDeleteFile']; onRenameFile: Props['onRenameFile'];
  head: (title: ReactNode, actions: ReactNode) => ReactNode;
}) {
  const { path } = meta;
  const ext = extensionOf(path);
  const text = meta.encoding === 'utf8';
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<PythonView | null>(null);

  useEffect(() => {
    let alive = true;
    setMissing(false);
    void readFile(owner, project.id, path).then((file) => {
      if (!alive) return;
      if (file) setContent(file.content);
      else { setContent(null); setMissing(true); }
    });
    return () => { alive = false; };
    // updatedAt 变了（助手改了文件）就重读
  }, [owner, project.id, path, meta.updatedAt]);
  useEffect(() => { setEditing(false); setRun(null); }, [path]);

  const save = async () => {
    setSaving(true);
    try {
      await writeFile(owner, project.id, { path, content: draft, provenance: { actor: 'user', tool: '手动编辑' } });
      setContent(draft);
      setEditing(false);
      toast.success('已保存');
    } catch (error) {
      toast.error(error instanceof WorkspaceError ? error.message : '没有保存成功');
    } finally {
      setSaving(false);
    }
  };

  const runCode = async () => {
    if (content === null || running) return;
    setRunning(true);
    try {
      const result = await runProjectPython(owner, project.id, { code: content, figureStem: baseName(path), provenance: { tool: '手动运行', note: `运行 ${path}` }, author: 'user' });
      setRun(result.view);
      if (result.saveErrors.length) toast.error(result.saveErrors[0]);
    } catch {
      toast.error('运行没有完成');
    } finally {
      setRunning(false);
    }
  };

  const origin = { section: 'research' as const, label: `科研台：${project.title}`, open: { view: 'research', params: { project: project.id, file: path } } };
  const editable = text && content !== null;

  const actions = (
    <>
      {editable && !editing && ext === 'py' && (
        <Button variant="solid" size="sm" icon={<Play size={14} strokeWidth={1.75} />} loading={running} disabled={!pythonReady} title={pythonReady ? undefined : '这个浏览器里没有可用的 Python 环境'} onClick={() => void runCode()}>
          运行
        </Button>
      )}
      {editable && (editing ? (
        <>
          <Button variant="solid" size="sm" loading={saving} onClick={() => void save()}>保存</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>取消</Button>
        </>
      ) : (
        <IconButton label="编辑" size="sm" onClick={() => { setDraft(content ?? ''); setEditing(true); }}><Pencil {...ICON} /></IconButton>
      ))}
      {editable && !editing && <SendTo owner={owner} text={content ?? ''} title={`${project.title} · ${baseName(path)}`} origin={origin} align="end" />}
      <Menu>
        <MenuTrigger asChild><IconButton label="更多操作" size="sm"><Ellipsis {...ICON} /></IconButton></MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Download {...ICON} />} onSelect={() => { void downloadFile(owner, project.id, path).then((done) => { if (!done) toast.error('文件内容已不在这台设备上'); }); }}>下载</MenuItem>
          <MenuItem icon={<AtSign {...ICON} />} onSelect={() => onMention(path)}>附到输入框</MenuItem>
          <MenuItem icon={<Pencil {...ICON} />} onSelect={() => onRenameFile(path)}>重命名或移动</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 {...ICON} />} danger onSelect={() => onDeleteFile(path)}>删除</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );

  let body: ReactNode;
  if (missing) body = <p className={r.panelEmpty}>这个文件的内容已不在这台设备上（可能清理过浏览器数据）。可以删除这条记录后重新生成。</p>;
  else if (content === null) body = <p className={r.panelLoading}><Spinner size={15} />正在打开…</p>;
  else if (editing) {
    body = <textarea className={r.editor} value={draft} spellCheck={false} aria-label={`编辑 ${path}`} onChange={(event) => setDraft(event.target.value)} />;
  } else if (!text) {
    body = isImagePath(path)
      ? <div className={r.imageView}><img src={content} alt={path} /></div>
      : <p className={r.panelEmpty}>这是二进制文件（{meta.mime}，{formatBytes(meta.size)}），不能直接预览，可以下载后查看。</p>;
  } else if (ext === 'md' || ext === 'markdown') {
    body = <div className={r.docView}><WorkspaceMarkdown owner={owner} projectId={project.id} text={content} files={files} baseDir={dirOf(path)} /></div>;
  } else if (ext === 'csv' || ext === 'tsv') {
    body = <CsvTable text={content} delimiter={ext === 'tsv' ? '\t' : ','} />;
  } else if (ext === 'bib') {
    body = <BibList text={content} />;
  } else if (ext === 'svg') {
    body = <div className={r.imageView}><img src={`data:image/svg+xml;utf8,${encodeURIComponent(content)}`} alt={path} /></div>;
  } else {
    const language = ext === 'py' ? 'python' : ext === 'json' || ext === 'jsonl' ? 'json' : ext === 'tex' ? 'latex' : ext === 'r' ? 'r' : ext === 'yaml' || ext === 'yml' ? 'yaml' : '';
    body = (
      <>
        {language ? <CodeBlock code={content} language={language} /> : <pre className={r.pre} data-plain>{content || '（空文件）'}</pre>}
        {ext === 'py' && !pythonReady && <p className={r.panelNote}>这个浏览器里没有可用的 Python 环境，脚本暂时不能运行。</p>}
      </>
    );
  }

  return (
    <>
      {head(
        <span className={r.panelTitle}>
          <FileText {...ICON} />
          <span title={path}>{path}</span>
          {editing && <Badge tone="accent">编辑中</Badge>}
          {!editing && editable && (ext === 'md' || ext === 'markdown') && <Eye size={14} strokeWidth={1.75} className={r.panelTitleHint} aria-hidden="true" />}
        </span>,
        actions,
      )}
      <div className={r.panelBody} data-editing={editing || undefined}>
        {body}
        {run && !editing && <RunOutput view={run} owner={owner} projectId={project.id} onOpenFile={(target) => onSelect({ kind: 'file', path: target })} />}
      </div>
      <footer className={r.panelFoot}>
        <span>{formatBytes(meta.size)} · 改于 {clock(meta.updatedAt)}</span>
        <Provenance meta={meta} />
      </footer>
    </>
  );
}

function PaperView({ paper, onRemove, head }: { paper: SavedPaper; onRemove: () => void; head: (title: ReactNode, actions: ReactNode) => ReactNode }) {
  const bib = useMemo(() => localBibtex([paper]), [paper]);
  return (
    <>
      {head(
        <span className={r.panelTitle}><BookMarked {...ICON} /><span>文献</span></span>,
        <IconButton label="从文献列表移除" size="sm" onClick={onRemove}><Trash2 {...ICON} /></IconButton>,
      )}
      <div className={r.panelBody}>
        <article className={r.paperView}>
          <h3>{paper.title}</h3>
          <p className={r.paperMeta}>{paper.authors.join(', ') || '作者未知'}</p>
          <p className={r.paperBadges}>
            <Badge tone="outline">{PAPER_SOURCE_LABELS[paper.source] ?? paper.source}</Badge>
            {paper.year && <Badge>{paper.year}</Badge>}
            {paper.venue && <Badge>{paper.venue}</Badge>}
            {typeof paper.citedBy === 'number' && <Badge>被引 {paper.citedBy}</Badge>}
          </p>
          {paper.note && <p className={r.paperNote}><span>保存时的备注</span>{paper.note}</p>}
          {paper.abstract ? <p className={r.paperAbstractFull}>{paper.abstract}</p> : <p className={r.panelNote}>连接器没有返回这篇文献的摘要。</p>}
          <p className={r.paperActions}>
            <Button asChild variant="soft" size="sm" iconRight={<ExternalLink size={14} strokeWidth={1.75} />}><a href={paper.url} target="_blank" rel="noreferrer noopener">文献页面</a></Button>
            {paper.doi && <Button asChild variant="ghost" size="sm"><a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer noopener">doi:{paper.doi}</a></Button>}
            {paper.openAccessUrl && <Button asChild variant="ghost" size="sm"><a href={paper.openAccessUrl} target="_blank" rel="noreferrer noopener">开放全文</a></Button>}
          </p>
          <CodeBlock code={bib} language="bibtex" />
          <p className={r.panelNote}>保存于 {clock(paper.savedAt)}。书目信息来自文献连接器取回的字段，引用前请核对。</p>
        </article>
      </div>
    </>
  );
}

export function FilePanel({
  owner, project, files, papers, selection, withList, pythonReady, onSelect, onClose, onMention, onDeleteFile, onRenameFile, onRemovePaper, onNewFile, onUpload,
}: Props) {
  const head = (title: ReactNode, actions: ReactNode) => (
    <header className={r.panelHead}>
      {withList && selection.kind !== 'list' && (
        <IconButton label="返回文件列表" size="sm" onClick={() => onSelect({ kind: 'list' })}><ArrowLeft {...ICON} /></IconButton>
      )}
      {title}
      <span className={r.panelActions}>
        {actions}
        <IconButton label="关闭面板" size="sm" onClick={onClose}><X {...ICON} /></IconButton>
      </span>
    </header>
  );

  const meta = selection.kind === 'file' ? files.find((file) => file.path === selection.path) : undefined;
  const paper = selection.kind === 'paper' ? papers.find((item) => item.id === selection.id) : undefined;

  if (meta) {
    return (
      <FileView
        key={meta.path}
        owner={owner} project={project} files={files} meta={meta} pythonReady={pythonReady}
        onSelect={onSelect} onMention={onMention} onDeleteFile={onDeleteFile} onRenameFile={onRenameFile} head={head}
      />
    );
  }
  if (paper) return <PaperView paper={paper} onRemove={() => onRemovePaper(paper.id)} head={head} />;

  return (
    <>
      {head(
        <span className={r.panelTitle}><FileText {...ICON} /><span>课题文件</span></span>,
        <>
          <Button variant="soft" size="sm" onClick={onNewFile}>新建</Button>
          <Button variant="ghost" size="sm" onClick={onUpload}>上传</Button>
        </>,
      )}
      <div className={r.panelBody}>
        {selection.kind !== 'list' && <p className={r.panelEmpty}>这个文件已经不在了。</p>}
        {files.length === 0 && <p className={r.panelEmpty}>还没有文件。助手产出的笔记、表格、代码、图和报告会出现在这里；也可以自己新建或上传数据。</p>}
        {files.length > 0 && (
          <ul className={r.panelList}>
            {files.map((file) => (
              <li key={file.path}>
                <button type="button" onClick={() => onSelect({ kind: 'file', path: file.path })}>
                  <FileText size={15} strokeWidth={1.75} />
                  <span>{file.path}</span>
                  <em>{formatBytes(file.size)}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
        {papers.length > 0 && (
          <>
            <h4 className={r.panelGroup}>文献 · {papers.length}</h4>
            <ul className={r.panelList}>
              {papers.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onSelect({ kind: 'paper', id: item.id })}>
                    <BookMarked size={15} strokeWidth={1.75} />
                    <span>{item.title}</span>
                    <em>{item.year ?? ''}</em>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
