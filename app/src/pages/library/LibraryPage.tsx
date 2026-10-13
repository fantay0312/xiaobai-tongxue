import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Check, ChevronRight, Clock, CloudUpload, Download, Ellipsis, Eye, Files, Folder, FolderInput, FolderOpen, FolderPlus,
  GraduationCap, HardDrive, LayoutGrid, List, MessageSquarePlus, Minus, Pencil, RefreshCw, RotateCcw, ScanText, Search, Star,
  Trash2, TriangleAlert, Upload, X,
} from 'lucide-react';
import {
  Badge, Button, Dialog, Empty, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
  Segmented, Skeleton, Spinner, cx, toast, type Tone,
} from '../../components/ui';
import { FilePreview, FileTypeIcon, extensionOf, formatSize, kindLabel } from '../../components/preview';
import { useAuthStore } from '../../store/authStore';
import { isCurrentAccount } from '../../lib/api';
import {
  createFolder, detachLibraryCourse, downloadLibraryFile, importLibraryFile, libraryPath, listLibrary, parseLibraryFile, purgeLibraryEntry,
  readLibrarySources, updateLibraryEntry, uploadLibraryFile, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot,
} from '../../lib/fileLibrary';
import { createCustomCourse, listCustomCourses, type AssetRole, type CustomCourse } from '../../lib/customContent';
import { saveBlob } from '../../lib/notebookMedia';
import s from './library.module.css';

const ProjectCompiler = lazy(() => import('../custom-content'));

type Filter = 'all' | 'recent' | 'favorites' | 'trash';
type FormKind = 'folder' | 'rename' | 'move' | 'course' | 'purge';
type Notice = { text: string; tone: 'warn' | 'bad' };

const PARSEABLE = /\.(pdf|pptx?|docx|md|txt)$/i;
const LIVE_PARSE = ['starting', 'pending', 'processing', 'finalizing'];
const BLOCKED_TEXT = '请先保存当前校订，或等待操作完成。';
const ROLES: { value: AssetRole; label: string }[] = [
  { value: 'lecture', label: '讲义课件' }, { value: 'reading', label: '阅读材料' }, { value: 'lab', label: '实验练习' }, { value: 'syllabus', label: '课程大纲' },
];
const CATEGORIES = [
  { value: 'all', label: '全部文件', icon: Files },
  { value: 'recent', label: '最近', icon: Clock },
  { value: 'favorites', label: '收藏', icon: Star },
  { value: 'trash', label: '回收站', icon: Trash2 },
] as const;

const formatDate = (iso: string) => Number.isFinite(Date.parse(iso))
  ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  : '—';

function parseBadge(entry: LibraryEntry): { tone: Tone; label: string; live?: boolean } | null {
  if (entry.kind !== 'file') return null;
  const status = entry.parse?.status;
  if (status === 'completed') return { tone: 'ok', label: '已解析' };
  if (status === 'failed') return { tone: 'bad', label: '解析失败' };
  if (status === 'cancelled') return { tone: 'warn', label: '解析已取消' };
  if (status && LIVE_PARSE.includes(status)) return { tone: 'accent', label: '解析中', live: true };
  return PARSEABLE.test(entry.name) ? { tone: 'outline', label: '未解析' } : null;
}

export default function LibraryPage({ onLeaveGuardChange, onUseInConversation }: { onLeaveGuardChange?: (value: boolean) => void; onUseInConversation?: (ids: string[]) => Promise<void> }) {
  const owner = useAuthStore((state) => state.user);
  return <LibrarySession key={owner ?? 'anonymous'} owner={owner} onLeaveGuardChange={onLeaveGuardChange} onUseInConversation={onUseInConversation} />;
}

function CheckBox({ checked, mixed, label, onChange, className }: { checked: boolean; mixed?: boolean; label: string; onChange: () => void; className?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={mixed ? 'mixed' : checked} aria-label={label} className={cx(s.check, className)} onClick={onChange}>
      {mixed ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  );
}

function OptionList({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: ReactNode; hint?: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className={s.options}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} className={s.option} onClick={() => onChange(option.value)}>
          {option.icon}
          <span className={s.optionText}>{option.label}{option.hint && <small>{option.hint}</small>}</span>
          {option.value === value && <Check size={16} className={s.optionCheck} />}
        </button>
      ))}
    </div>
  );
}

function LibrarySession({ owner, onLeaveGuardChange, onUseInConversation }: { owner: string | null; onLeaveGuardChange?: (value: boolean) => void; onUseInConversation?: (ids: string[]) => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [progress, setProgress] = useState('');
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState<FormKind | null>(null);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [courses, setCourses] = useState<CustomCourse[]>([]);
  const [project, setProject] = useState<{ key: number; courseId: string; assetIds: string[] } | null>(null);
  const [courseBlocked, setCourseBlocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [role, setRole] = useState<AssetRole>('lecture');
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const lastForm = useRef<FormKind>('folder');
  /** 对话框由行内操作打开（而不是批量操作条） */
  const rowForm = useRef(false);

  const valid = () => isCurrentAccount(owner, useAuthStore.getState(), alive.current);
  const warn = (text: string) => setNotice({ text, tone: 'warn' });
  const fail = (error: unknown, fallback = '操作未完成。') => setNotice({ text: error instanceof Error ? error.message : fallback, tone: 'bad' });
  const reload = async () => {
    const next = await listLibrary(requestRef.current?.signal);
    if (valid()) { setSnapshot(next); setLoadFailed(false); }
  };
  const reconnect = () => {
    setNotice(null); setLoadFailed(false);
    void reload().catch((error) => { if (valid()) { fail(error); setLoadFailed(true); } });
  };

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    void listCustomCourses(controller.signal).then((next) => { if (valid()) setCourses(next); }).catch(() => {});
    void reload().catch((error) => { if (valid() && !controller.signal.aborted) { fail(error); setLoadFailed(true); } });
    return () => { alive.current = false; controller.abort(); };
  }, []);
  useEffect(() => { onLeaveGuardChange?.(busy || courseBlocked); return () => onLeaveGuardChange?.(false); }, [busy, courseBlocked, onLeaveGuardChange]);

  const entries = snapshot?.entries ?? [];
  const folders = entries.filter((entry) => entry.kind === 'folder' && !entry.deletedAt);
  const path = libraryPath(entries, folderId);
  const visible = visibleLibraryEntries(entries, folderId, filter, query).sort((a, b) => a.kind !== b.kind ? a.kind === 'folder' ? -1 : 1 : sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const picked = entries.filter((entry) => selected.includes(entry.id));
  const canPreview = (entry: LibraryEntry) => entry.kind === 'file' && !entry.deletedAt && entry.phase === 'ready';
  const previewList = visible.filter(canPreview);
  const preview = entries.find((entry) => entry.id === previewId && canPreview(entry)) ?? null;
  const previewIndex = preview ? previewList.findIndex((entry) => entry.id === preview.id) : -1;
  const usable = (targets: LibraryEntry[]) => targets.length > 0 && targets.length <= 12 && targets.every((entry) => entry.kind === 'file' && entry.phase === 'ready');
  const courseTitle = (id: string) => courses.find((course) => course.id === id)?.title;

  // 有文件在解析时定时刷新状态，最多跟 5 分钟
  const parsing = entries.some((entry) => !entry.deletedAt && entry.parse && LIVE_PARSE.includes(entry.parse.status));
  useEffect(() => {
    if (!parsing) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 75) { window.clearInterval(timer); return; }
      if (!busyRef.current) void reload().catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [parsing]);

  const browse = (id: string | null, nextFilter: Filter = 'all') => {
    if (busy || courseBlocked) { warn(BLOCKED_TEXT); return; }
    setProject(null); setNotice(null); setFolderId(id); setFilter(nextFilter); setQuery(''); setSelected([]); setPreviewId(null); setForm(null);
  };
  const run = async (action: () => Promise<void>, success: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      await action();
      if (valid()) { await reload(); toast.success(success); setForm(null); setSelected([]); }
    } catch (error) {
      if (valid()) {
        fail(error);
        // 预览器打开时页面横幅被浮层挡住，改用轻提示
        if (previewId && !form) toast.error(error instanceof Error ? error.message : '操作未完成。');
        await reload().catch(() => {});
      }
    } finally {
      busyRef.current = false;
      if (valid()) { setBusy(false); setProgress(''); }
    }
  };
  const upload = (files: File[]) => void run(async () => {
    let count = 0;
    try {
      for (const file of files) {
        if (!snapshot || file.size > snapshot.maxFileBytes) throw new Error(`“${file.name}”超过单文件大小限制。已上传 ${count} 份。`);
        setUploading({ name: file.name, done: count, total: files.length });
        await uploadLibraryFile(file, folderId, requestRef.current!.signal);
        count += 1;
      }
    } finally {
      if (valid()) setUploading(null);
    }
  }, `已上传 ${files.length} 份文件。`);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const open = (entry: LibraryEntry) => {
    if (entry.kind === 'folder' && !entry.deletedAt) browse(entry.id);
    else if (canPreview(entry)) setPreviewId(entry.id);
    else toggle(entry.id);
  };
  const updateMany = (patch: Parameters<typeof updateLibraryEntry>[1], success: string) => void run(async () => { for (const entry of picked) await updateLibraryEntry(entry.id, patch); }, success);
  /** targets 缺省为当前勾选；行内操作传入单个条目，并把它设为勾选 */
  const startForm = (next: FormKind, targets: LibraryEntry[] = picked) => {
    if (busy || courseBlocked) { warn(BLOCKED_TEXT); return; }
    rowForm.current = targets !== picked;
    if (targets !== picked) setSelected(targets.map((entry) => entry.id));
    setNotice(null); setForm(next); setName(next === 'rename' ? targets[0]?.name ?? '' : '');
    setDestination(next === 'course' ? targets[0]?.courseImports?.[0]?.courseId ?? folders.find((folder) => folder.id === folderId)?.sourceCourseId ?? courses[0]?.id ?? '__new__' : '');
    setNewCourseTitle(path.at(-1)?.name ?? '');
    if (next === 'course') void listCustomCourses().then((nextCourses) => { if (valid()) setCourses(nextCourses); }).catch(() => { if (valid()) warn('项目服务暂不可用。文件已保存在资料库，可稍后重试。'); });
  };
  const startProject = () => void run(async () => {
    if (picked.length > 12) throw new Error('每个课题最多使用 12 份文件，请减少选择。');
    if (picked.some((entry) => entry.kind !== 'file' || entry.phase !== 'ready' || !PARSEABLE.test(entry.name))) throw new Error('请选择 PDF、PPT、PPTX、DOCX、MD 或 TXT 文件进行解析。');
    const course = destination === '__new__' ? await createCustomCourse(newCourseTitle.trim()) : courses.find((item) => item.id === destination);
    if (!course) throw new Error('请选择学习项目，或创建一个新项目。');
    setDestination(course.id);
    setCourses((current) => current.some((item) => item.id === course.id) ? current : [...current, course]);
    const assetIds: string[] = [];
    for (const entry of picked) {
      if (valid()) setProgress(`正在将 ${entry.name} 加入 ${course.title}…`);
      const imported = await importLibraryFile(entry.id, course.id, role);
      assetIds.push(imported.assetId);
    }
    if (valid()) { setProject({ key: Date.now(), courseId: course.id, assetIds }); setPreviewId(null); }
  }, picked.length ? '文件已关联到项目，已有解析直接复用。' : '已打开项目工作台。');
  const submitForm = () => {
    if (form === 'folder') void run(async () => { await createFolder(name, folderId); }, '文件夹已创建。');
    if (form === 'rename' && picked[0]) void run(async () => { await updateLibraryEntry(picked[0].id, { name }); }, '名称已更新。');
    if (form === 'move') updateMany({ parentId: destination || null }, '已移动到新位置。');
    if (form === 'course') startProject();
    if (form === 'purge') void run(async () => { for (const entry of picked) await purgeLibraryEntry(entry.id); }, '已从资料库彻底删除。');
  };
  const closeForm = () => {
    if (busy) return;
    setForm(null); setNotice(null);
    if (rowForm.current) setSelected([]);
  };
  const toggleFavorite = (entry: LibraryEntry) => void run(async () => { await updateLibraryEntry(entry.id, { favorite: !entry.favorite }); }, entry.favorite ? '已取消收藏。' : '已收藏。');
  const download = (entry: LibraryEntry) => void run(async () => { const blob = await downloadLibraryFile(entry.id); if (valid()) saveBlob(entry.name, blob); }, '下载已准备。');
  const parse = (entry: LibraryEntry) => void run(async () => { await parseLibraryFile(entry.id, undefined, true); }, '解析已启动，使用时会自动读取最新状态。');
  const sendToConversation = (ids: string[]) => { setPreviewId(null); void onUseInConversation?.(ids); };

  const allVisible = visible.length > 0 && visible.every((entry) => selected.includes(entry.id));
  const someVisible = visible.some((entry) => selected.includes(entry.id));
  const title = project ? '解析与学习' : filter === 'recent' ? '最近文件' : filter === 'favorites' ? '收藏' : filter === 'trash' ? '回收站' : path.at(-1)?.name ?? '全部文件';
  const counts: Partial<Record<Filter, number>> = { favorites: entries.filter((entry) => entry.favorite && !entry.deletedAt).length, trash: entries.filter((entry) => entry.deletedAt).length };
  const dropTarget = !project && filter !== 'trash' && !preview && !form;

  const renderFolders = (parent: string | null, depth = 0): ReactNode => depth > 64 ? null : folders
    .filter((entry) => entry.parentId === parent)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((entry) => {
      const hasChildren = folders.some((child) => child.parentId === entry.id);
      const expanded = !collapsed.includes(entry.id);
      const current = folderId === entry.id && !project;
      return (
        <div key={entry.id}>
          <div className={s.treeRow} style={{ paddingLeft: depth * 14 }}>
            {hasChildren
              ? (
                <button type="button" className={s.treeToggle} aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'} ${entry.name}`} onClick={() => setCollapsed((list) => expanded ? [...list, entry.id] : list.filter((id) => id !== entry.id))}>
                  <ChevronRight size={14} />
                </button>
              )
              : <span className={s.treeToggle} aria-hidden="true" />}
            <button type="button" className={s.navItem} aria-current={current ? 'page' : undefined} onClick={() => browse(entry.id)}>
              {current ? <FolderOpen size={16} strokeWidth={1.75} /> : <Folder size={16} strokeWidth={1.75} />}
              <span>{entry.name}</span>
            </button>
          </div>
          {hasChildren && expanded && renderFolders(entry.id, depth + 1)}
        </div>
      );
    });

  const renderBadges = (entry: LibraryEntry) => {
    const parsed = parseBadge(entry);
    return (
      <>
        {entry.phase !== 'ready' && <Badge tone="warn" dot>{entry.phase === 'purging' ? '正在彻底删除' : '正在入库'}</Badge>}
        {parsed && <Badge tone={parsed.tone} dot={parsed.live}>{parsed.label}</Badge>}
        {entry.courseImports?.length ? <Badge>用于 {entry.courseImports.length} 门课程</Badge> : null}
      </>
    );
  };

  const renderMenu = (entry: LibraryEntry) => {
    const ready = canPreview(entry);
    return (
      <Menu modal={false}>
        <MenuTrigger asChild>
          <IconButton label={`${entry.name} 的更多操作`} size="sm" tip={false}><Ellipsis size={16} /></IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          {entry.deletedAt
            ? (
              <>
                <MenuItem icon={<RotateCcw size={15} />} disabled={busy} onSelect={() => void run(async () => { await updateLibraryEntry(entry.id, { trashed: false }); }, '已恢复。')}>恢复</MenuItem>
                <MenuItem icon={<Trash2 size={15} />} danger disabled={busy} onSelect={() => startForm('purge', [entry])}>彻底删除</MenuItem>
              </>
            )
            : (
              <>
                {ready && <MenuItem icon={<Eye size={15} />} onSelect={() => setPreviewId(entry.id)}>预览</MenuItem>}
                {ready && <MenuItem icon={<Download size={15} />} disabled={busy} onSelect={() => download(entry)}>下载原件</MenuItem>}
                {ready && onUseInConversation && <MenuItem icon={<MessageSquarePlus size={15} />} onSelect={() => sendToConversation([entry.id])}>用于当前对话</MenuItem>}
                {ready && <MenuItem icon={<GraduationCap size={15} />} disabled={busy} onSelect={() => startForm('course', [entry])}>加入课程</MenuItem>}
                {ready && PARSEABLE.test(entry.name) && <MenuItem icon={<ScanText size={15} />} disabled={busy} onSelect={() => parse(entry)}>{entry.parse?.status === 'completed' ? '重新解析' : '解析'}</MenuItem>}
                {ready && <MenuSeparator />}
                <MenuItem icon={<Pencil size={15} />} disabled={busy} onSelect={() => startForm('rename', [entry])}>重命名</MenuItem>
                <MenuItem icon={<FolderInput size={15} />} disabled={busy} onSelect={() => startForm('move', [entry])}>移动</MenuItem>
                <MenuItem icon={<Star size={15} />} disabled={busy} onSelect={() => toggleFavorite(entry)}>{entry.favorite ? '取消收藏' : '收藏'}</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={15} />} danger disabled={busy} onSelect={() => void run(async () => { await updateLibraryEntry(entry.id, { trashed: true }); }, '已移入回收站，可随时恢复。')}>移入回收站</MenuItem>
              </>
            )}
        </MenuContent>
      </Menu>
    );
  };

  const renderStar = (entry: LibraryEntry) => (
    <IconButton
      label={`${entry.favorite ? '取消收藏' : '收藏'} ${entry.name}`}
      size="sm"
      tip={false}
      className={s.star}
      data-on={entry.favorite || undefined}
      disabled={busy || !!entry.deletedAt}
      onClick={() => toggleFavorite(entry)}
    >
      <Star size={15} fill={entry.favorite ? 'currentColor' : 'none'} />
    </IconButton>
  );

  const entryMeta = (entry: LibraryEntry) => entry.kind === 'folder' ? '文件夹' : [extensionOf(entry.name).toUpperCase() || '文件', formatSize(entry.byteSize)].join(' · ');

  const renderList = () => (
    <div className={s.list} role="list" aria-label={title}>
      <div className={s.listHead}>
        <CheckBox label="选择当前列表全部项目" checked={allVisible} mixed={!allVisible && someVisible} onChange={() => setSelected(allVisible ? [] : visible.map((entry) => entry.id))} />
        <span>名称</span>
        <span className={s.colStatus}>状态</span>
        <span className={s.colSize}>大小</span>
        <span className={s.colDate}>最近更新</span>
        <span />
      </div>
      {visible.map((entry) => (
        <div key={entry.id} role="listitem" className={s.row} data-selected={selected.includes(entry.id)}>
          <CheckBox label={`选择 ${entry.name}`} checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} />
          <button type="button" className={s.rowMain} onClick={() => open(entry)}>
            <FileTypeIcon name={entry.name} mimeType={entry.contentType} folder={entry.kind === 'folder'} size={36} />
            <span className={s.rowText}>
              <strong>{entry.name}</strong>
              <small>{entryMeta(entry)} · {formatDate(entry.updatedAt)}</small>
              {/* 窄屏没有状态列，状态标记跟在名称下面 */}
              <span className={s.rowBadgesInline}>{renderBadges(entry)}</span>
            </span>
          </button>
          <span className={cx(s.rowBadges, s.colStatus)}>{renderBadges(entry)}</span>
          <span className={s.colSize}>{entry.kind === 'folder' ? '—' : formatSize(entry.byteSize)}</span>
          <time className={s.colDate}>{formatDate(entry.updatedAt)}</time>
          <span className={s.rowActions}>
            {canPreview(entry) && <IconButton label={`预览 ${entry.name}`} size="sm" tip={false} className={s.hideNarrow} onClick={() => setPreviewId(entry.id)}><Eye size={15} /></IconButton>}
            {!entry.deletedAt && renderStar(entry)}
            {renderMenu(entry)}
          </span>
        </div>
      ))}
    </div>
  );

  const renderGrid = () => (
    <div className={s.grid} role="list" aria-label={title}>
      {visible.map((entry) => (
        <div key={entry.id} role="listitem" className={s.card} data-selected={selected.includes(entry.id)}>
          <div className={s.cardTop}>
            <CheckBox label={`选择 ${entry.name}`} checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} />
            <span className={s.rowActions}>{!entry.deletedAt && renderStar(entry)}{renderMenu(entry)}</span>
          </div>
          <button type="button" className={s.cardMain} onClick={() => open(entry)}>
            <FileTypeIcon name={entry.name} mimeType={entry.contentType} folder={entry.kind === 'folder'} size={48} />
            <strong>{entry.name}</strong>
            <small>{entryMeta(entry)}</small>
            <small>{formatDate(entry.updatedAt)}</small>
          </button>
          <div className={s.cardBadges}>{renderBadges(entry)}</div>
        </div>
      ))}
    </div>
  );

  const renderEmpty = () => {
    if (query) return <Empty icon={<Search size={22} strokeWidth={1.75} />} title="没有匹配的项目" description="换个关键词试试。" action={<Button variant="outline" onClick={() => setQuery('')}>清除搜索</Button>} />;
    if (filter === 'trash') return <Empty icon={<Trash2 size={22} strokeWidth={1.75} />} title="回收站是空的" description="移入回收站的文件会留在这里，可以恢复或彻底删除。" />;
    if (filter === 'favorites') return <Empty icon={<Star size={22} strokeWidth={1.75} />} title="还没有收藏" description="在文件上点星标，常用资料就会出现在这里。" />;
    return (
      <Empty
        className={s.dropHint}
        icon={<CloudUpload size={22} strokeWidth={1.75} />}
        title="这里还没有文件"
        description="把文件拖到这里，或点上传。PDF、Word、PPT、图片、音视频都可以保存和预览。"
        action={(
          <>
            <Button variant="solid" icon={<Upload size={15} />} disabled={busy} onClick={() => inputRef.current?.click()}>上传文件</Button>
            <Button variant="outline" icon={<FolderPlus size={15} />} disabled={busy} onClick={() => startForm('folder')}>新建文件夹</Button>
          </>
        )}
      />
    );
  };

  const renderDetails = (entry: LibraryEntry) => {
    const parsed = parseBadge(entry);
    const status = entry.parse?.status;
    return (
      <div className={s.details}>
        <dl className={s.facts}>
          <div><dt>位置</dt><dd>{['全部文件', ...libraryPath(entries, entry.parentId).map((item) => item.name)].join(' / ')}</dd></div>
          <div><dt>类型</dt><dd>{kindLabel(entry.name, entry.contentType)}</dd></div>
          <div><dt>大小</dt><dd>{formatSize(entry.byteSize)}</dd></div>
          <div><dt>加入时间</dt><dd>{formatDate(entry.createdAt)}</dd></div>
          <div><dt>最近更新</dt><dd>{formatDate(entry.updatedAt)}</dd></div>
        </dl>
        <section className={s.detailCard}>
          <header>
            <h3>解析</h3>
            {parsed && <Badge tone={parsed.tone} dot={parsed.live}>{parsed.label}</Badge>}
          </header>
          <p>
            {status === 'completed' ? '已完成，可直接用于提问和生成内容。'
              : status === 'failed' ? `解析失败，可重试。${entry.parse?.error ?? ''}`
                : status && LIVE_PARSE.includes(status) ? '正在解析，完成后状态会自动更新。'
                  : PARSEABLE.test(entry.name) ? '尚未解析。解析后可以用它提问、生成讲解和练习。'
                    : '这种格式可以保存在资料库，暂不能解析。可解析 PDF、PPT、PPTX、DOCX、MD、TXT。'}
          </p>
          {PARSEABLE.test(entry.name) && (
            <Button variant="soft" size="sm" icon={<ScanText size={14} />} disabled={busy} onClick={() => parse(entry)}>
              {status === 'completed' ? '重新解析' : status === 'failed' ? '重试解析' : '开始解析'}
            </Button>
          )}
        </section>
        <section className={s.detailCard}>
          <header>
            <h3>学习项目</h3>
            <Button variant="soft" size="sm" icon={<GraduationCap size={14} />} disabled={busy} onClick={() => startForm('course', [entry])}>加入课程</Button>
          </header>
          {entry.courseImports?.length
            ? entry.courseImports.map((link) => (
              <div key={link.courseId} className={s.linkRow}>
                <GraduationCap size={16} strokeWidth={1.75} />
                <span>{courseTitle(link.courseId) ?? '学习项目'}</span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await detachLibraryCourse(entry.id, link.courseId); }, '已移除课程引用，原件仍在资料库。')}>移除课程引用</Button>
              </div>
            ))
            : <p>还没有加入学习项目。加入后可以生成课题、校订，再开始学习。</p>}
        </section>
      </div>
    );
  };

  // 对话框关闭动画期间沿用上一次的表单，标题和内容不跳变
  if (form) lastForm.current = form;
  const shown = form ?? lastForm.current;
  const formTitle = shown === 'folder' ? '新建文件夹' : shown === 'rename' ? '重命名' : shown === 'course' ? picked.length ? `将 ${picked.length} 份文件加入课程` : '打开学习项目' : shown === 'purge' ? '彻底删除所选项目？' : '移动到';
  const submitDisabled = busy || ((form === 'folder' || form === 'rename') && !name.trim()) || (form === 'course' && (!destination || (destination === '__new__' && newCourseTitle.trim().length < 2)));

  return (
    <div
      className={s.page}
      onDragOver={(event) => { if (dropTarget && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => { if (!dropTarget) return; event.preventDefault(); setDragging(false); if (!busy && snapshot) upload(Array.from(event.dataTransfer.files)); }}
    >
      <aside className={s.side}>
        <h2 className={s.sideTitle}>资料库</h2>
        <nav className={s.categories} aria-label="资料库分类">
          {CATEGORIES.map(({ value, label, icon: CategoryIcon }) => (
            <button key={value} type="button" className={s.navItem} aria-current={filter === value && !folderId && !project ? 'page' : undefined} onClick={() => browse(null, value)}>
              <CategoryIcon size={16} strokeWidth={1.75} />
              <span>{label}</span>
              {counts[value] ? <em>{counts[value]}</em> : null}
            </button>
          ))}
        </nav>
        <div className={s.treeHead}>
          <span>文件夹</span>
          <IconButton label="新建文件夹" size="sm" disabled={busy} onClick={() => { if (project) browse(folderId); startForm('folder'); }}><FolderPlus size={15} /></IconButton>
        </div>
        <div className={s.tree}>
          {folders.length ? renderFolders(null) : <p className={s.treeEmpty}>按课程或主题建文件夹，资料更好找。</p>}
        </div>
        <p className={s.storage}>
          <HardDrive size={14} strokeWidth={1.75} />
          <span>
            {snapshot?.storage === 'cloud' ? '账号私有存储' : snapshot?.storage === 'local' ? '本机服务存储' : '正在连接存储'}
            {snapshot ? ` · 单文件上限 ${formatSize(snapshot.maxFileBytes)}` : ''}
          </span>
        </p>
      </aside>

      <main className={s.main}>
        <div className={s.inner}>
          <header className={s.header}>
            <div className={s.heading}>
              <h1>{title}</h1>
              {!project && snapshot && <span>{visible.length} 项</span>}
            </div>
            {!project && (
              <div className={s.headerTools}>
                <Input
                  size="sm"
                  wrapClassName={s.search}
                  leading={<Search size={15} />}
                  trailing={query ? <button type="button" className={s.clearSearch} aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button> : undefined}
                  aria-label="搜索资料库"
                  placeholder="搜索文件或文件夹"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button variant="ghost" className={s.toolButton} icon={<GraduationCap size={16} />} aria-label={picked.length ? '解析所选文件' : '学习项目'} disabled={busy} onClick={() => startForm('course')}>
                  <span>{picked.length ? '解析所选文件' : '学习项目'}</span>
                </Button>
                <IconButton label="新建文件夹" variant="outline" disabled={busy} onClick={() => startForm('folder')}><FolderPlus size={16} /></IconButton>
                <Button variant="solid" icon={<Upload size={15} />} disabled={busy || !snapshot || filter === 'trash'} onClick={() => inputRef.current?.click()}>上传</Button>
              </div>
            )}
          </header>

          {snapshot?.syncWarning && (
            <div className={s.banner} data-tone="warn" role="status">
              <TriangleAlert size={16} strokeWidth={1.75} />
              <span>{snapshot.syncWarning}</span>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={reconnect}>重试同步</Button>
            </div>
          )}
          {notice && !form && (
            <div className={s.banner} data-tone={notice.tone} role="alert">
              <TriangleAlert size={16} strokeWidth={1.75} />
              <span>{notice.text}</span>
              <IconButton label="关闭资料库提示" size="sm" tip={false} onClick={() => setNotice(null)}><X size={14} /></IconButton>
            </div>
          )}
          {(uploading || (busy && progress)) && (
            <div className={s.progress} role="status">
              <Spinner size={16} />
              <div className={s.progressText}>
                <strong>{uploading ? `正在上传 ${uploading.name}` : progress}</strong>
                {uploading && <span>{uploading.done + 1} / {uploading.total}</span>}
              </div>
              {uploading && <div className={s.progressBar}><i style={{ width: `${Math.max(6, (uploading.done / uploading.total) * 100)}%` }} /></div>}
            </div>
          )}

          {project
            ? (
              <section className={s.project}>
                <div className={s.projectBar}>
                  <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => browse(folderId)}>返回资料库</Button>
                  <strong>{courseTitle(project.courseId)}</strong>
                  <ol className={s.steps}><li>文件解析</li><li>生成课题</li><li>校订</li><li>开始学习</li></ol>
                </div>
                <Suspense fallback={<div className={s.projectLoading} role="status"><Spinner size={16} />正在打开项目工作台…</div>}>
                  <ProjectCompiler key={project.key} embedded compilerOnly initialCourseId={project.courseId} initialAssetIds={project.assetIds} onLeaveGuardChange={setCourseBlocked} />
                </Suspense>
              </section>
            )
            : (
              <>
                <div className={s.toolbar}>
                  <nav className={s.crumbs} aria-label="文件夹路径">
                    <button type="button" onClick={() => browse(null)}>全部文件</button>
                    {filter !== 'all'
                      ? <span><ChevronRight size={13} /><b>{title}</b></span>
                      : path.map((entry, index) => (
                        <span key={entry.id}>
                          <ChevronRight size={13} />
                          {index === path.length - 1 ? <b>{entry.name}</b> : <button type="button" onClick={() => browse(entry.id)}>{entry.name}</button>}
                        </span>
                      ))}
                  </nav>
                  <div className={s.viewTools}>
                    <Segmented size="sm" label="排序方式" value={sort} onChange={setSort} options={[{ value: 'updated', label: '最近更新' }, { value: 'name', label: '名称' }]} />
                    <Segmented
                      size="sm"
                      label="视图"
                      value={layout}
                      onChange={setLayout}
                      options={[{ value: 'list', label: <List size={15} />, title: '列表视图' }, { value: 'grid', label: <LayoutGrid size={15} />, title: '网格视图' }]}
                    />
                  </div>
                </div>

                <div className={s.fileArea}>
                  {!snapshot && !loadFailed && (
                    <div className={s.skeletons} role="status" aria-label="正在读取资料库">
                      {Array.from({ length: 6 }, (_, index) => (
                        <div key={index}>
                          <Skeleton width={36} height={36} radius="var(--r-md)" />
                          <span><Skeleton width={`${46 - index * 4}%`} height={14} /><Skeleton width="22%" height={11} /></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!snapshot && loadFailed && (
                    <Empty
                      icon={<HardDrive size={22} strokeWidth={1.75} />}
                      title="连接你的资料库"
                      description="文件服务准备好后，这里会显示你保存的文件和分组。"
                      action={<Button variant="solid" icon={<RefreshCw size={15} />} onClick={reconnect}>重新连接</Button>}
                    />
                  )}
                  {snapshot && visible.length > 0 && (layout === 'list' ? renderList() : renderGrid())}
                  {snapshot && !visible.length && renderEmpty()}
                </div>
              </>
            )}
        </div>

        {selected.length > 0 && !project && (
          <div className={s.selectionBar} role="toolbar" aria-label="批量操作">
            <span className={s.selectionCount}>已选 {selected.length} 项</span>
            <div className={s.selectionActions}>
              {filter === 'trash'
                ? (
                  <>
                    <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} disabled={busy} onClick={() => updateMany({ trashed: false }, '已恢复所选项目。')}>恢复</Button>
                    <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => startForm('purge')}>彻底删除</Button>
                  </>
                )
                : (
                  <>
                    {onUseInConversation && <Button variant="ghost" size="sm" icon={<MessageSquarePlus size={14} />} disabled={busy || !usable(picked)} onClick={() => sendToConversation(picked.map((entry) => entry.id))}>用于当前对话</Button>}
                    <Button variant="ghost" size="sm" icon={<GraduationCap size={14} />} disabled={busy || !usable(picked)} onClick={() => startForm('course')}>加入课程</Button>
                    <Button variant="ghost" size="sm" icon={<Pencil size={14} />} disabled={busy || selected.length !== 1} onClick={() => startForm('rename')}>重命名</Button>
                    <Button variant="ghost" size="sm" icon={<FolderInput size={14} />} disabled={busy} onClick={() => startForm('move')}>移动</Button>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => updateMany({ trashed: true }, '已移入回收站，可随时恢复。')}>移入回收站</Button>
                  </>
                )}
            </div>
            <IconButton label="取消选择" size="sm" onClick={() => setSelected([])}><X size={15} /></IconButton>
          </div>
        )}
      </main>

      <input ref={inputRef} hidden type="file" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) upload(files); }} />
      {dragging && (
        <div className={s.dropOverlay}>
          <CloudUpload size={30} strokeWidth={1.5} />
          <strong>松开文件，上传到{path.at(-1)?.name ?? '全部文件'}</strong>
          {snapshot && <span>单文件上限 {formatSize(snapshot.maxFileBytes)}</span>}
        </div>
      )}

      <Dialog
        open={form !== null}
        onOpenChange={(next) => { if (!next) closeForm(); }}
        title={formTitle}
        description={shown === 'purge' ? `资料库中的原件删除后无法恢复。已有学习课题和解析记录会保留。${picked.some((entry) => entry.sourceAssetId) ? '旧课程原件仍由原项目保存，这里移除的是资料库引用。' : ''}` : undefined}
        size={shown === 'course' || shown === 'move' ? 'md' : 'sm'}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={closeForm}>取消</Button>
            <Button type="submit" form="library-form" variant={shown === 'purge' ? 'danger' : 'solid'} loading={busy} disabled={submitDisabled}>
              {shown === 'course' ? picked.length ? '加入项目' : '打开项目' : shown === 'purge' ? '确认彻底删除' : '确认'}
            </Button>
          </>
        )}
      >
        <form id="library-form" className={s.form} onSubmit={(event) => { event.preventDefault(); if (!submitDisabled) submitForm(); }}>
          {(shown === 'folder' || shown === 'rename') && (
            <Field label="名称" htmlFor="library-entry-name">
              <Input id="library-entry-name" autoFocus aria-label="项目名称" value={name} maxLength={180} placeholder="输入名称" onChange={(event) => setName(event.target.value)} />
            </Field>
          )}
          {shown === 'move' && (
            <OptionList
              label="目标位置"
              value={destination}
              onChange={setDestination}
              options={[
                { value: '', label: '全部文件', hint: '根目录', icon: <Files size={16} strokeWidth={1.75} /> },
                ...folders.filter((folder) => !selected.includes(folder.id)).map((folder) => ({
                  value: folder.id,
                  label: libraryPath(entries, folder.id).map((entry) => entry.name).join(' / '),
                  icon: <Folder size={16} strokeWidth={1.75} />,
                })),
              ]}
            />
          )}
          {shown === 'course' && (
            <>
              <OptionList
                label="学习项目"
                value={destination}
                onChange={setDestination}
                options={[
                  { value: '__new__', label: '新建学习项目', icon: <FolderPlus size={16} strokeWidth={1.75} /> },
                  ...courses.map((course) => ({ value: course.id, label: course.title, hint: `${course.assetCount} 份资料`, icon: <GraduationCap size={16} strokeWidth={1.75} /> })),
                ]}
              />
              {destination === '__new__' && (
                <Field label="项目名称" htmlFor="library-course-title" hint="至少 2 个字">
                  <Input id="library-course-title" aria-label="新项目名称" placeholder="例如：线性代数" maxLength={120} value={newCourseTitle} onChange={(event) => setNewCourseTitle(event.target.value)} />
                </Field>
              )}
              {picked.length > 0 && (
                <Field label="文件用途">
                  <Segmented size="sm" block label="文件用途" value={role} onChange={setRole} options={ROLES} />
                </Field>
              )}
            </>
          )}
          {shown === 'purge' && (
            <ul className={s.purgeList}>
              {picked.slice(0, 6).map((entry) => <li key={entry.id}>{entry.name}</li>)}
              {picked.length > 6 && <li>等 {picked.length} 项</li>}
            </ul>
          )}
          {busy && progress && <p className={s.formProgress} role="status"><Spinner size={14} />{progress}</p>}
          {notice && <p className={s.formError} data-tone={notice.tone} role="alert">{notice.text}</p>}
        </form>
      </Dialog>

      {preview && (
        <FilePreview
          file={{ id: preview.id, name: preview.name, mimeType: preview.contentType, size: preview.byteSize }}
          load={() => downloadLibraryFile(preview.id)}
          onClose={() => setPreviewId(null)}
          onPrev={previewIndex > 0 ? () => setPreviewId(previewList[previewIndex - 1].id) : undefined}
          onNext={previewIndex >= 0 && previewIndex < previewList.length - 1 ? () => setPreviewId(previewList[previewIndex + 1].id) : undefined}
          position={previewIndex >= 0 ? { index: previewIndex, total: previewList.length } : undefined}
          onUseInConversation={onUseInConversation ? () => sendToConversation([preview.id]) : undefined}
          loadParsedText={preview.parse?.status === 'completed'
            ? async () => (await readLibrarySources([preview.id])).sources.map((source) => source.content).filter(Boolean).join('\n\n')
            : undefined}
          status={(() => { const parsed = parseBadge(preview); return parsed ? <Badge tone={parsed.tone} dot={parsed.live}>{parsed.label}</Badge> : null; })()}
          details={renderDetails(preview)}
          noteOwner={owner}
        />
      )}
    </div>
  );
}
