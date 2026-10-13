/**
 * 科研台：学习终端里的科研工作台。
 * 用一句话描述研究任务，科研助手会计划、检索文献、读论文、写并运行分析代码，把笔记、表格、图和报告写进课题文件；
 * 每一步思考、检索、运行和写入都留在时间线里，高风险动作先问你。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Dialog as RDialog } from 'radix-ui';
import {
  ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleDot, CircleMinus, Download, Ellipsis, FolderOpen, Pencil, Play, Plus, Square, Target, Trash2,
} from 'lucide-react';
import { Badge, Button, Dialog, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Sheet, Textarea, toast } from '../../../components/ui';
import { IconResearch } from '../../../components/ui/icons';
import {
  LIMITS, STARTERS, WorkspaceError, answerApproval, answerQuestion, continueSession, createProject, deleteFile, exportProjectZip, extensionOf,
  isImagePath, isSessionLive, isTextPath, normalizePath, parseInput, reconcileSessions, removeProject, removeSession, renameFile, resolvePlan,
  sendTurn, setProjectGoal, stopSession, writeFile,
  type Attachment, type PlanItem, type ResearchProject, type TurnMode,
} from '../../../engine/research';
import '../../../lib/artifactProviders/research';
import { researchStore, useResearchData, useResearchTrimmed } from '../../../store/researchStore';
import { ownerKey } from '../../../store/studyData';
import { SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import { useMediaQuery } from '../shell/views';
import { FilePanel, type PanelSelection } from './research/FilePanel';
import { ResearchComposer } from './research/ResearchComposer';
import { ResearchNav, type ProjectAction } from './research/ResearchNav';
import { Transcript } from './research/Transcript';
import { STATUS_LABELS } from './research/format';
import { useWorkbenchStatus } from './research/useWorkbenchStatus';
import r from './research/research.module.css';
import type { TerminalViewProps } from './types';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const lastKey = (owner: string | null) => `xiaobai-research-last:${ownerKey(owner)}`;

type DialogState =
  | { kind: 'new-project' }
  | { kind: 'rename-project'; project: ResearchProject }
  | { kind: 'goal'; project: ResearchProject }
  | { kind: 'delete-project'; project: ResearchProject }
  | { kind: 'new-file' }
  | { kind: 'rename-file'; path: string }
  | { kind: 'delete-file'; path: string };

const PLAN_ICONS = { pending: CircleDashed, active: CircleDot, done: CircleCheck, skipped: CircleMinus } as const;

/** 置顶的计划清单：助手用 update_plan 维护 */
function PlanBar({ plan, open, onOpen }: { plan: PlanItem[]; open: boolean; onOpen: (open: boolean) => void }) {
  if (!plan.length) return null;
  const done = plan.filter((item) => item.status === 'done' || item.status === 'skipped').length;
  const active = plan.find((item) => item.status === 'active') ?? plan.find((item) => item.status === 'pending');
  return (
    <section className={r.plan} data-open={open || undefined} aria-label="计划清单">
      <button type="button" className={r.planToggle} aria-expanded={open} onClick={() => onOpen(!open)}>
        {open ? <ChevronDown size={15} strokeWidth={1.75} /> : <ChevronRight size={15} strokeWidth={1.75} />}
        <strong>计划</strong>
        <span className={r.planCount}>{done}/{plan.length}</span>
        <span className={r.planTrack} aria-hidden="true"><i style={{ width: `${(done / plan.length) * 100}%` }} /></span>
        {!open && active && <span className={r.planNow}>{done === plan.length ? '全部完成' : active.text}</span>}
      </button>
      {open && (
        <ol className={r.planItems}>
          {plan.map((item) => {
            const Icon = PLAN_ICONS[item.status];
            return (
              <li key={item.id} data-status={item.status}>
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Welcome({ project, onPick }: { project?: ResearchProject; onPick: (text: string) => void }) {
  return (
    <div className={r.welcome}>
      <span className={r.welcomeMark}><IconResearch size={26} /></span>
      <h1>{project ? project.title : '科研台'}</h1>
      <ol className={r.welcomeLines}>
        <li>用一句话描述研究任务，助手先列计划，再检索文献、读论文、写并运行分析代码。</li>
        <li>笔记、表格、图和报告都写进课题文件，每一步思考、检索、运行和写入都留在时间线里。</li>
        <li>覆盖文件、运行代码、访问新的文献来源前会先问你；引用只来自实际检索到的文献。</li>
      </ol>
      <div className={r.starters}>
        {STARTERS.map((starter) => (
          <button key={starter.title} type="button" className={r.starter} onClick={() => onPick(starter.fill)}>
            <strong>{starter.title}</strong>
            <span>{starter.hint}</span>
            <code>{starter.fill.split(' ')[0]}</code>
          </button>
        ))}
      </div>
    </div>
  );
}

function uploadTarget(name: string): string {
  const ext = extensionOf(name);
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'file';
  if (isImagePath(name)) return `figures/${clean}`;
  if (ext === 'py' || ext === 'r' || ext === 'ipynb') return `code/${clean}`;
  if (ext === 'md' || ext === 'markdown') return `notes/${clean}`;
  if (ext === 'bib') return clean;
  return `data/${clean}`;
}

const readAsText = (file: File) => file.text();
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export default function ResearchView({ owner }: TerminalViewProps) {
  const data = useResearchData(owner);
  const trimmed = useResearchTrimmed();
  const hasSidebar = useSidebarSlot() !== null;
  const phone = useMediaQuery('(max-width: 760px)');
  const [params] = useSearchParams();
  const { status } = useWorkbenchStatus();

  const [projectId, setProjectId] = useState<string | null>(() => {
    try { return localStorage.getItem(lastKey(owner)); } catch { return null; }
  });
  /** 用户在某个课题里明确选的会话；sessionId 为 null 表示「新会话」 */
  const [choice, setChoice] = useState<{ projectId: string; sessionId: string | null } | null>(null);
  const [panel, setPanel] = useState<PanelSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exporting, setExporting] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const project = data.projects.find((item) => item.id === projectId);
  const sessions = useMemo(() => data.sessions.filter((item) => item.projectId === project?.id), [data.sessions, project?.id]);
  const sessionId = project ? (choice?.projectId === project.id ? choice.sessionId : sessions[0]?.id ?? null) : null;
  const session = sessions.find((item) => item.id === sessionId);
  const files = project ? data.files[project.id] ?? [] : [];
  const papers = project ? data.papers[project.id] ?? [] : [];
  const live = !!session && isSessionLive(session.id) && (session.status === 'running' || session.status === 'waiting');
  const pendingQuestion = live ? session?.events.findLast((event) => event.type === 'question' && event.status === 'pending') : undefined;
  const pendingApproval = live && !!session?.events.some((event) => event.type === 'approval' && event.status === 'pending');
  const resumable = !!session && !live && (session.status === 'paused' || session.status === 'error');
  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of data.sessions) counts[item.projectId] = (counts[item.projectId] ?? 0) + 1;
    return counts;
  }, [data.sessions]);

  /* 一轮开始时把计划清单展开（手机上屏幕小，保持收起，只看当前一步） */
  useEffect(() => { setPlanOpen(live && !phone); }, [live, phone, session?.id]);

  /* 刷新后接管被打断的会话 */
  useEffect(() => { reconcileSessions(owner); }, [owner]);

  /* 深链：?view=research&project=<id>&file=<path> */
  const deepProject = params.get('project');
  const deepFile = params.get('file');
  useEffect(() => {
    if (!deepProject || !researchStore.getProject(owner, deepProject)) return;
    setProjectId(deepProject);
    const path = deepFile ? normalizePath(deepFile) : null;
    if (path) setPanel({ kind: 'file', path });
  }, [owner, deepProject, deepFile]);

  useEffect(() => {
    try {
      if (project) localStorage.setItem(lastKey(owner), project.id);
    } catch { /* 记不住上次打开的课题不影响使用 */ }
  }, [owner, project]);

  /* 时间线贴底：用户往上翻时不打扰 */
  const lastEvent = session?.events[session.events.length - 1];
  const tick = `${session?.id ?? ''}:${session?.events.length ?? 0}:${lastEvent && 'text' in lastEvent ? lastEvent.text.length : 0}:${session?.status ?? ''}`;
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [tick]);
  useEffect(() => { stick.current = true; }, [session?.id]);
  const onScroll = () => {
    const node = scrollRef.current;
    if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, []);

  const openProject = (id: string | null) => {
    setProjectId(id);
    setPanel(null);
    if (id === null) {
      try { localStorage.removeItem(lastKey(owner)); } catch { /* 忽略 */ }
    } else setNavOpen(false);
  };
  const newSession = () => {
    if (project) setChoice({ projectId: project.id, sessionId: null });
    setNavOpen(false);
    focusComposer();
  };
  const selectPanel = (selection: PanelSelection) => {
    setPanel(selection);
    setNavOpen(false);
  };

  /* ── 发送 ── */
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (session && pendingQuestion) {
      answerQuestion(session.id, pendingQuestion.id, text);
      setDraft('');
      return;
    }
    if (live) return;
    const parsed = parseInput(text);
    if (parsed.skill?.mode === 'clear') {
      setDraft('');
      newSession();
      return;
    }
    if (parsed.skill?.needsArg && !parsed.arg) {
      toast(`在 /${parsed.skill.name} 后面写上${parsed.skill.argHint}`);
      return;
    }
    const target = project ?? createProject(owner, (parsed.arg || text).split('\n')[0].slice(0, 28));
    // 没有模型时 /goal 不必经过助手：原话直接存为目标
    if (parsed.skill?.mode === 'goal' && status && !status.model) {
      setProjectGoal(owner, target.id, { objective: parsed.arg.slice(0, 600), criteria: [] });
      setProjectId(target.id);
      setDraft('');
      toast.success('已保存为课题目标', { description: '现在没有可用的模型，没有整理验收标准；可以在「课题目标」里自己补充。' });
      return;
    }
    const targetSession = session ?? researchStore.createSession(owner, target.id, '新会话');
    const mode: TurnMode = parsed.skill?.mode ?? 'normal';
    const sent = sendTurn(owner, {
      sessionId: targetSession.id,
      display: text,
      prompt: parsed.skill?.build ? parsed.skill.build(parsed.arg) : text,
      ...(parsed.skill ? { command: parsed.skill.name } : {}),
      mode,
      attachments,
    });
    if (!sent) return;
    setProjectId(target.id);
    setChoice({ projectId: target.id, sessionId: targetSession.id });
    setDraft('');
    setAttachments([]);
    stick.current = true;
  };

  /* ── 课题与文件操作 ── */
  const exportProject = async (target: ResearchProject) => {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportProjectZip(owner, target);
      toast.success(`已导出 ${count} 个文件`, { description: '压缩包里附了一份文件来历清单 PROVENANCE.md。' });
    } catch {
      toast.error('导出没有成功，请再试一次');
    } finally {
      setExporting(false);
    }
  };
  const projectAction = (action: ProjectAction, target: ResearchProject) => {
    if (action === 'export') void exportProject(target);
    else if (action === 'rename') setDialog({ kind: 'rename-project', project: target });
    else if (action === 'goal') setDialog({ kind: 'goal', project: target });
    else setDialog({ kind: 'delete-project', project: target });
  };
  const deleteSession = (id: string) => {
    removeSession(owner, id);
    if (choice?.sessionId === id) setChoice(null);
    toast('已删除这次会话', { description: '课题文件不受影响。' });
  };
  const removePaper = (id: string) => {
    if (!project) return;
    researchStore.removePaper(owner, project.id, id);
    if (panel?.kind === 'paper' && panel.id === id) setPanel(hasSidebar ? null : { kind: 'list' });
    toast('已从文献列表移除', { description: 'references.bib 会在下次保存文献时更新。' });
  };
  const mentionFile = (path: string) => {
    setAttachments((current) => (current.some((item) => item.kind === 'file' && item.path === path) ? current : [...current, { kind: 'file' as const, path }].slice(0, 8)));
    if (phone) setPanel(null);
    focusComposer();
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!project || !picked.length) return;
    let saved = 0;
    for (const file of picked.slice(0, 12)) {
      const path = uploadTarget(file.name);
      try {
        const text = isTextPath(path) && !isImagePath(path);
        if (!text && file.size > LIMITS.binaryBytes) throw new WorkspaceError(`${file.name} 超过 ${LIMITS.binaryBytes / 1024 / 1024} MB，没有上传`);
        await writeFile(owner, project.id, {
          path,
          content: text ? await readAsText(file) : await readAsDataUrl(file),
          encoding: text ? 'utf8' : 'dataurl',
          provenance: { actor: 'user', tool: '上传' },
        });
        saved += 1;
      } catch (error) {
        toast.error(error instanceof WorkspaceError ? error.message : `${file.name} 没有上传成功`);
      }
    }
    if (saved) toast.success(`已放进课题文件：${saved} 个`, { description: '数据在 data/，代码在 code/，都只保存在这个浏览器里。' });
  };

  const nav = (
    <ResearchNav
      projects={data.projects}
      project={project}
      sessions={sessions}
      files={files}
      papers={papers}
      sessionCounts={sessionCounts}
      sessionId={sessionId}
      selection={panel}
      onNewProject={() => setDialog({ kind: 'new-project' })}
      onOpenProject={openProject}
      onProjectAction={projectAction}
      onNewSession={newSession}
      onOpenSession={(id) => { if (project) setChoice({ projectId: project.id, sessionId: id }); setNavOpen(false); }}
      onDeleteSession={deleteSession}
      onSelect={selectPanel}
      onNewFile={() => setDialog({ kind: 'new-file' })}
      onUpload={() => uploadRef.current?.click()}
      onDeleteFile={(path) => setDialog({ kind: 'delete-file', path })}
      onRemovePaper={removePaper}
    />
  );

  const panelNode = project && panel && (
    <FilePanel
      owner={owner}
      project={project}
      files={files}
      papers={papers}
      selection={panel}
      withList={!hasSidebar}
      pythonReady={!!status?.python}
      onSelect={setPanel}
      onClose={() => setPanel(null)}
      onMention={mentionFile}
      onDeleteFile={(path) => setDialog({ kind: 'delete-file', path })}
      onRenameFile={(path) => setDialog({ kind: 'rename-file', path })}
      onRemovePaper={removePaper}
      onNewFile={() => setDialog({ kind: 'new-file' })}
      onUpload={() => uploadRef.current?.click()}
    />
  );

  const empty = !session || session.events.length === 0;

  return (
    <div className={r.root} data-panel={panelNode && !phone ? 'open' : undefined}>
      <SidebarPortal>{nav}</SidebarPortal>
      {!hasSidebar && (
        <Sheet open={navOpen} onOpenChange={setNavOpen} title="科研台" side="left" width={320} className={r.navSheet}>
          {nav}
        </Sheet>
      )}
      <input ref={uploadRef} type="file" multiple hidden onChange={(event) => void onUpload(event)} />

      <div className={r.console}>
        <header className={r.bar}>
          {hasSidebar ? (
            <div className={r.barTitle}>
              {project ? (
                <>
                  <strong title={project.title}>{project.title}</strong>
                  {session?.title !== project.title && <span title={session?.title}>{session ? session.title : '新会话'}</span>}
                </>
              ) : (
                <strong>科研台</strong>
              )}
            </div>
          ) : (
            // 没有常驻侧栏（手机、侧栏收起）：标题本身就是打开课题、会话与文件导航的入口
            <button type="button" className={r.barSwitch} aria-label="课题、会话与文件" onClick={() => setNavOpen(true)}>
              <span className={r.barTitle}>
                <strong>{project ? project.title : '科研台'}</strong>
                {project && session?.title !== project.title && <span>{session ? session.title : '新会话'}</span>}
              </span>
              <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          {session && session.status !== 'idle' && (
            <Badge tone={session.status === 'error' ? 'bad' : session.status === 'running' ? 'accent' : 'warn'} dot>
              {live || session.status === 'paused' || session.status === 'error' ? STATUS_LABELS[session.status] : STATUS_LABELS.paused}
            </Badge>
          )}
          <span className={r.barActions}>
            {live && (
              <Button variant="outline" size="sm" icon={<Square size={11} strokeWidth={0} fill="currentColor" />} onClick={() => session && stopSession(session.id)}>停止</Button>
            )}
            {project && (
              <Button
                variant={panel ? 'soft' : 'ghost'}
                size="sm"
                icon={<FolderOpen size={15} strokeWidth={1.75} />}
                aria-pressed={!!panel}
                onClick={() => setPanel(panel ? null : { kind: 'list' })}
              >
                文件{files.length ? ` ${files.length}` : ''}
              </Button>
            )}
            {project && (
              <Menu>
                <MenuTrigger asChild><IconButton label="课题操作"><Ellipsis size={18} strokeWidth={1.75} /></IconButton></MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<Plus {...ICON} />} onSelect={newSession}>新会话</MenuItem>
                  <MenuItem icon={<Target {...ICON} />} onSelect={() => projectAction('goal', project)}>目标与验收标准</MenuItem>
                  <MenuItem icon={<Download {...ICON} />} onSelect={() => projectAction('export', project)}>导出课题（zip）</MenuItem>
                  <MenuItem icon={<Pencil {...ICON} />} onSelect={() => projectAction('rename', project)}>重命名课题</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 {...ICON} />} danger onSelect={() => projectAction('delete', project)}>删除课题</MenuItem>
                </MenuContent>
              </Menu>
            )}
          </span>
        </header>

        {trimmed && <p className={r.trimmed} role="status">这个浏览器的本地空间不够了，较早会话的详细记录已被精简。课题文件不受影响，建议导出不再需要的课题后删除。</p>}
        {session && <PlanBar plan={session.plan} open={planOpen} onOpen={setPlanOpen} />}

        <div className={r.scroll} ref={scrollRef} onScroll={onScroll}>
          {empty ? (
            <Welcome project={project} onPick={(text) => { setDraft(text); focusComposer(); }} />
          ) : (
            project && session && (
              <Transcript
                owner={owner}
                project={project}
                session={session}
                files={files}
                live={live}
                onOpenFile={(path) => setPanel({ kind: 'file', path })}
                onApproval={(eventId, answer) => answerApproval(session.id, eventId, answer)}
                onAnswer={(eventId, answer) => answerQuestion(session.id, eventId, answer)}
                onPlan={(eventId, action, edited) => { stick.current = true; resolvePlan(owner, session.id, eventId, action, edited); }}
              />
            )
          )}
        </div>

        <div className={r.dock}>
          {resumable && session && (
            <div className={r.resume} role="status">
              <span>{session.status === 'error' ? '这一轮没有完成。' : '这一轮停在半路，已写入的文件都在。'}</span>
              <Button variant="soft" size="sm" icon={<Play size={14} strokeWidth={1.75} />} onClick={() => { stick.current = true; continueSession(owner, session.id); }}>
                {session.status === 'error' ? '重试' : '继续'}
              </Button>
            </div>
          )}
          <ResearchComposer
            owner={owner}
            input={draft}
            onInput={setDraft}
            attachments={attachments}
            onAttachments={setAttachments}
            files={files}
            permission={project?.permission ?? 'risky'}
            onPermission={(mode) => {
              if (project) researchStore.patchProject(owner, project.id, { permission: mode });
              else toast('权限模式按课题保存，发出第一个任务后再调整');
            }}
            busy={live}
            answering={!!pendingQuestion}
            awaitingApproval={pendingApproval}
            status={status}
            onSubmit={submit}
            onStop={() => session && stopSession(session.id)}
            onClear={newSession}
            inputRef={inputRef}
          />
        </div>
      </div>

      {panelNode && (phone ? (
        <RDialog.Root open onOpenChange={(open) => { if (!open) setPanel(null); }}>
          <RDialog.Portal>
            <RDialog.Content className={r.fullSheet} aria-describedby={undefined} onOpenAutoFocus={(event) => event.preventDefault()}>
              <RDialog.Title className={r.srOnly}>课题文件</RDialog.Title>
              {panelNode}
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>
      ) : (
        <aside className={r.side} aria-label="文件预览">{panelNode}</aside>
      ))}

      <Dialogs
        owner={owner}
        dialog={dialog}
        project={project}
        onClose={() => setDialog(null)}
        onProjectCreated={(created) => { setProjectId(created.id); setChoice({ projectId: created.id, sessionId: null }); setPanel(null); setNavOpen(false); focusComposer(); }}
        onProjectDeleted={(id) => { if (projectId === id) openProject(null); }}
        onFileOpened={(path) => setPanel({ kind: 'file', path })}
        onFileGone={(path) => { if (panel?.kind === 'file' && panel.path === path) setPanel(hasSidebar ? null : { kind: 'list' }); }}
      />
    </div>
  );
}

/* ───────── 对话框：新建/重命名课题、目标、删除确认、新建/重命名文件 ───────── */

function Dialogs({ owner, dialog, project, onClose, onProjectCreated, onProjectDeleted, onFileOpened, onFileGone }: {
  owner: string | null;
  dialog: DialogState | null;
  project?: ResearchProject;
  onClose: () => void;
  onProjectCreated: (project: ResearchProject) => void;
  onProjectDeleted: (id: string) => void;
  onFileOpened: (path: string) => void;
  onFileGone: (path: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError('');
    setBusy(false);
    if (!dialog) return;
    if (dialog.kind === 'new-project') { setTitle(''); setObjective(''); setCriteria(''); }
    if (dialog.kind === 'rename-project') setTitle(dialog.project.title);
    if (dialog.kind === 'goal') { setObjective(dialog.project.goal?.objective ?? ''); setCriteria((dialog.project.goal?.criteria ?? []).join('\n')); }
    if (dialog.kind === 'new-file') setPath('notes/untitled.md');
    if (dialog.kind === 'rename-file') setPath(dialog.path);
  }, [dialog]);

  const criteriaList = () => criteria.split('\n').map((line) => line.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean).slice(0, 8);
  const open = (kind: DialogState['kind']) => dialog?.kind === kind;
  const change = (next: boolean) => { if (!next) onClose(); };

  const createNew = () => {
    if (!title.trim()) { setError('给课题起个名字'); return; }
    const created = createProject(owner, title, objective);
    if (objective.trim()) setProjectGoal(owner, created.id, { objective: objective.trim().slice(0, 600), criteria: criteriaList() });
    onClose();
    onProjectCreated(created);
  };

  const saveFile = async () => {
    if (!project || !dialog) return;
    const normalized = normalizePath(path);
    if (!normalized) { setError('路径不合法：用相对路径，如 notes/ideas.md，不能包含 .. 或特殊符号'); return; }
    setBusy(true);
    try {
      if (dialog.kind === 'rename-file') {
        const next = await renameFile(owner, project.id, dialog.path, normalized);
        onFileGone(dialog.path);
        onFileOpened(next);
      } else {
        if (researchStore.files(owner, project.id).some((file) => file.path === normalized)) { setError('这个位置已经有同名文件'); return; }
        if (!isTextPath(normalized)) { setError('这里只能新建文本文件（.md、.txt、.csv、.py、.bib 等）'); return; }
        await writeFile(owner, project.id, { path: normalized, content: '', provenance: { actor: 'user', tool: '新建' } });
        onFileOpened(normalized);
      }
      onClose();
    } catch (failure) {
      setError(failure instanceof WorkspaceError ? failure.message : '没有保存成功');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open('new-project')}
        onOpenChange={change}
        title="新建课题"
        description="一个课题有自己的会话、文件和文献列表，都保存在这台设备的浏览器里。"
        size="sm"
        footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="solid" onClick={createNew}>创建</Button></>}
      >
        <form className={r.form} onSubmit={(event) => { event.preventDefault(); createNew(); }}>
          <Field label="课题名称" error={error}>
            <Input autoFocus value={title} maxLength={60} placeholder="如：图神经网络做交通流量预测" onChange={(event) => { setTitle(event.target.value); setError(''); }} />
          </Field>
          <Field label="目标（可选）" hint="之后每一轮助手都会对照它；也可以稍后用 /goal 设定。">
            <Textarea value={objective} rows={3} maxLength={600} placeholder="想回答什么问题，或者要产出什么" onChange={(event) => setObjective(event.target.value)} />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={open('rename-project')}
        onOpenChange={change}
        title="重命名课题"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="solid" disabled={!title.trim()} onClick={() => { if (dialog?.kind === 'rename-project') researchStore.patchProject(owner, dialog.project.id, { title: title.trim().slice(0, 60) }); onClose(); }}>保存</Button>
          </>
        )}
      >
        <Input autoFocus value={title} maxLength={60} aria-label="课题名称" onChange={(event) => setTitle(event.target.value)} />
      </Dialog>

      <Dialog
        open={open('goal')}
        onOpenChange={change}
        title="课题目标与验收标准"
        description="助手每一轮都会看到它，并据此判断做完了没有。"
        size="md"
        footer={(
          <>
            {dialog?.kind === 'goal' && dialog.project.goal && (
              <Button variant="ghost" onClick={() => { setProjectGoal(owner, dialog.project.id, null); onClose(); }}>清除目标</Button>
            )}
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button
              variant="solid"
              disabled={!objective.trim()}
              onClick={() => { if (dialog?.kind === 'goal') setProjectGoal(owner, dialog.project.id, { objective: objective.trim().slice(0, 600), criteria: criteriaList() }); onClose(); }}
            >
              保存
            </Button>
          </>
        )}
      >
        <div className={r.form}>
          <Field label="目标">
            <Textarea autoFocus value={objective} rows={3} maxLength={600} placeholder="要回答的问题，或要产出的东西" onChange={(event) => setObjective(event.target.value)} />
          </Field>
          <Field label="验收标准" hint="一行一条，最多 8 条。写成能检验的话，如「综述覆盖近五年不少于 10 篇文献并带 DOI」。">
            <Textarea value={criteria} rows={5} placeholder={'report.md 里的每个数字都能在 data/ 或代码输出中找到\n每条引用都带 DOI 或 arXiv 号'} onChange={(event) => setCriteria(event.target.value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={open('delete-project')}
        onOpenChange={change}
        title="删除这个课题？"
        description={dialog?.kind === 'delete-project' ? `「${dialog.project.title}」的会话记录、文件和文献列表都会从这个浏览器里删除，不能恢复。需要留底请先导出。` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (dialog?.kind !== 'delete-project') return;
                const id = dialog.project.id;
                setBusy(true);
                void removeProject(owner, id).finally(() => { onProjectDeleted(id); onClose(); toast('课题已删除'); });
              }}
            >
              删除
            </Button>
          </>
        )}
      />

      <Dialog
        open={open('new-file') || open('rename-file')}
        onOpenChange={change}
        title={dialog?.kind === 'rename-file' ? '重命名或移动文件' : '新建文件'}
        description="路径相对于课题根目录。常用目录：notes/ 笔记，data/ 数据，code/ 代码，figures/ 图。"
        size="sm"
        footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="solid" loading={busy} onClick={() => void saveFile()}>{dialog?.kind === 'rename-file' ? '保存' : '创建'}</Button></>}
      >
        <form onSubmit={(event) => { event.preventDefault(); void saveFile(); }}>
          <Field label="文件路径" error={error}>
            <Input autoFocus value={path} maxLength={160} spellCheck={false} onChange={(event) => { setPath(event.target.value); setError(''); }} />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={open('delete-file')}
        onOpenChange={change}
        title="删除这个文件？"
        description={dialog?.kind === 'delete-file' ? `${dialog.path} 会从课题里删除，不能恢复。` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dialog?.kind !== 'delete-file' || !project) return;
                const target = dialog.path;
                void deleteFile(owner, project.id, target).then(() => { onFileGone(target); toast(`已删除 ${target}`); });
                onClose();
              }}
            >
              删除
            </Button>
          </>
        )}
      />
    </>
  );
}
