/** 科研台的板块侧栏：课题列表；进入课题后是会话、文件树、文献。手机上同一份内容放进抽屉。 */
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft, BookMarked, ChevronDown, ChevronRight, CircleAlert, CirclePause, Download, Ellipsis, FilePlus2, FileText, FlaskConical, Folder,
  Image as ImageIcon, MessageSquareText, Pencil, Plus, Table2, Target, Terminal, Trash2, Upload,
} from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Spinner } from '../../../../components/ui';
import { extensionOf, isImagePath, type FileMeta, type ResearchProject, type ResearchSession, type SavedPaper } from '../../../../engine/research';
import { SideAction, SideEmpty, SideGroup, SideNavItem, SidePanel } from '../../shell/sidebarSlot';
import type { PanelSelection } from './FilePanel';
import { STATUS_LABELS, buildTree, relativeTime, type TreeNode } from './format';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SMALL = { size: 15, strokeWidth: 1.75 } as const;

export type ProjectAction = 'rename' | 'goal' | 'export' | 'delete';

interface Props {
  projects: ResearchProject[];
  project?: ResearchProject;
  sessions: ResearchSession[];
  files: FileMeta[];
  papers: SavedPaper[];
  /** 每个课题有几个会话，课题列表里显示 */
  sessionCounts: Record<string, number>;
  sessionId: string | null;
  selection: PanelSelection | null;
  onNewProject: () => void;
  onOpenProject: (id: string | null) => void;
  onProjectAction: (action: ProjectAction, project: ResearchProject) => void;
  onNewSession: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onSelect: (selection: PanelSelection) => void;
  onNewFile: () => void;
  onUpload: () => void;
  onDeleteFile: (path: string) => void;
  onRemovePaper: (id: string) => void;
}

function fileIcon(path: string) {
  const ext = extensionOf(path);
  if (isImagePath(path)) return <ImageIcon {...ICON} />;
  if (ext === 'py' || ext === 'r') return <Terminal {...ICON} />;
  if (ext === 'csv' || ext === 'tsv' || ext === 'xlsx') return <Table2 {...ICON} />;
  if (ext === 'bib') return <BookMarked {...ICON} />;
  return <FileText {...ICON} />;
}

function SessionIcon({ status }: { status: ResearchSession['status'] }) {
  if (status === 'running') return <Spinner size={16} />;
  if (status === 'waiting' || status === 'paused') return <CirclePause {...ICON} />;
  if (status === 'error') return <CircleAlert {...ICON} />;
  return <MessageSquareText {...ICON} />;
}

function ProjectMenu({ project, onAction }: { project: ResearchProject; onAction: Props['onProjectAction'] }) {
  return (
    <Menu>
      <MenuTrigger asChild><IconButton label="课题操作" size="sm" tip={false}><Ellipsis {...SMALL} /></IconButton></MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<Target {...SMALL} />} onSelect={() => onAction('goal', project)}>目标与验收标准</MenuItem>
        <MenuItem icon={<Pencil {...SMALL} />} onSelect={() => onAction('rename', project)}>重命名</MenuItem>
        <MenuItem icon={<Download {...SMALL} />} onSelect={() => onAction('export', project)}>导出课题（zip）</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 {...SMALL} />} danger onSelect={() => onAction('delete', project)}>删除课题</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function ResearchNav({
  projects, project, sessions, files, papers, sessionCounts, sessionId, selection,
  onNewProject, onOpenProject, onProjectAction, onNewSession, onOpenSession, onDeleteSession, onSelect, onNewFile, onUpload, onDeleteFile, onRemovePaper,
}: Props) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => setClosed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const indent = depth === 0 ? undefined : depth === 1 ? 1 : 2;
    if (!node.file) {
      const open = !closed.has(node.path);
      return (
        <div key={node.path}>
          <SideNavItem
            icon={open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
            label={<><Folder size={14} strokeWidth={1.75} style={{ marginRight: 6, verticalAlign: '-2px' }} />{node.name}</>}
            meta={node.children.length}
            indent={indent}
            onClick={() => toggle(node.path)}
          />
          {open && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    const path = node.path;
    return (
      <SideNavItem
        key={path}
        icon={fileIcon(path)}
        label={node.name}
        indent={indent}
        title={path}
        active={selection?.kind === 'file' && selection.path === path}
        onClick={() => onSelect({ kind: 'file', path })}
        trailing={(
          <IconButton label={`删除 ${node.name}`} size="sm" tip={false} onClick={() => onDeleteFile(path)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>
        )}
      />
    );
  };

  if (!project) {
    return (
      <SidePanel
        title="科研台"
        action={<SideAction icon={<Plus {...ICON} />} onClick={onNewProject}>新建课题</SideAction>}
        footer="课题、会话和文件保存在这台设备的浏览器里"
      >
        <SideGroup label="课题">
          {projects.length === 0 && <SideEmpty>还没有课题。新建一个，或直接在右边写下研究任务。</SideEmpty>}
          {projects.map((item) => (
            <SideNavItem
              key={item.id}
              icon={<FlaskConical {...ICON} />}
              label={item.title}
              sub={`${relativeTime(item.updatedAt)}${sessionCounts[item.id] ? ` · ${sessionCounts[item.id]} 个会话` : ''}`}
              title={item.goal?.objective ?? item.title}
              onClick={() => onOpenProject(item.id)}
              trailing={<ProjectMenu project={item} onAction={onProjectAction} />}
            />
          ))}
        </SideGroup>
      </SidePanel>
    );
  }

  const tree = buildTree(files);
  return (
    <SidePanel
      title={project.title}
      action={<SideAction icon={<Plus {...ICON} />} onClick={onNewSession}>新会话</SideAction>}
      footer="课题、会话和文件保存在这台设备的浏览器里"
    >
      <SideGroup>
        <SideNavItem icon={<ArrowLeft {...ICON} />} label="全部课题" meta={projects.length} onClick={() => onOpenProject(null)} trailing={<ProjectMenu project={project} onAction={onProjectAction} />} />
        <SideNavItem
          icon={<Target {...ICON} />}
          label={project.goal ? '课题目标' : '设定课题目标'}
          sub={project.goal?.objective}
          title={project.goal?.objective}
          onClick={() => onProjectAction('goal', project)}
        />
      </SideGroup>

      <SideGroup label="会话">
        {sessions.length === 0 && <SideEmpty>还没有会话，写下第一个任务就会开始。</SideEmpty>}
        {sessions.map((session) => (
          <SideNavItem
            key={session.id}
            icon={<SessionIcon status={session.status} />}
            label={session.title}
            sub={`${relativeTime(session.updatedAt)}${session.status !== 'idle' ? ` · ${STATUS_LABELS[session.status]}` : session.turns ? ` · ${session.turns} 轮` : ''}`}
            active={session.id === sessionId}
            onClick={() => onOpenSession(session.id)}
            trailing={(
              <IconButton label="删除会话" size="sm" tip={false} onClick={() => onDeleteSession(session.id)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>
            )}
          />
        ))}
      </SideGroup>

      <SideGroup
        label={`文件${files.length ? ` · ${files.length}` : ''}`}
        action={(
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <IconButton label="新建文件" size="sm" onClick={onNewFile}><FilePlus2 {...SMALL} /></IconButton>
            <IconButton label="上传数据或文本文件" size="sm" onClick={onUpload}><Upload {...SMALL} /></IconButton>
          </span>
        )}
      >
        {files.length === 0 && <SideEmpty>助手产出的笔记、表格、代码、图和报告会出现在这里。</SideEmpty>}
        {tree.map((node) => renderNode(node, 0))}
      </SideGroup>

      <SideGroup label={`文献${papers.length ? ` · ${papers.length}` : ''}`}>
        {papers.length === 0 && <SideEmpty>助手保存的文献会列在这里，并写进 references.bib。</SideEmpty>}
        {papers.map((paper) => (
          <SideNavItem
            key={paper.id}
            icon={<BookMarked {...ICON} />}
            label={paper.title}
            sub={[paper.authors[0] ? `${paper.authors[0]}${paper.authors.length > 1 ? ' 等' : ''}` : '', paper.year].filter(Boolean).join(' · ')}
            title={paper.title}
            active={selection?.kind === 'paper' && selection.id === paper.id}
            onClick={() => onSelect({ kind: 'paper', id: paper.id })}
            trailing={(
              <IconButton label="移除文献" size="sm" tip={false} onClick={() => onRemovePaper(paper.id)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>
            )}
          />
        ))}
      </SideGroup>
    </SidePanel>
  );
}
