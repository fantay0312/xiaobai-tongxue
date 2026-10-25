import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Clock, CloudUpload, Download, Ellipsis, Eye, Files, Folder, FolderInput, FolderOpen, FolderPlus,
  GraduationCap, HardDrive, Layers, LayoutGrid, List, ListChecks, ListFilter, MessageSquarePlus, Minus, Network, NotebookPen, Pencil, RefreshCw, RotateCcw,
  ScanText, Search, Sparkles, Star, Trash2, TriangleAlert, Upload, Waypoints, X,
} from 'lucide-react';
import {
  Badge, Button, Dialog, Empty, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger,
  Segmented, Skeleton, Spinner, cx, toast, type Tone,
} from '../../components/ui';
import { IconLibrary } from '../../components/ui/icons';
import { ArtifactTypeIcon, FilePreview, FileTypeIcon, extensionOf, fileTone, formatSize, kindLabel } from '../../components/preview';
import { SideAction, SideEmpty, SideGroup, SideNavItem, SidePanel, SidebarPortal, useSidebarSlot } from '../learn/shell/sidebarSlot';
import { useAuthStore } from '../../store/authStore';
import { isCurrentAccount } from '../../lib/api';
import { useLibraryParsePolling } from '../../hooks/useLibraryParsePolling';
import {
  createFolder, detachLibraryCourse, downloadLibraryFile, importLibraryFile, libraryPath, listLibrary, parseLibraryFile, purgeLibraryEntry,
  prepareLibrarySources, readLibrarySources, updateLibraryEntry, uploadLibraryFile, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot,
} from '../../lib/fileLibrary';
import { ARTIFACT_LABELS, artifactContent, useArtifacts, type Artifact, type ArtifactKind, type ArtifactOrigin } from '../../lib/artifacts';
import { refreshStudyArtifacts } from '../../lib/artifactProviders/studyData';
import { runCrossAction } from '../../lib/crossActions';
import {
  GENERATED_FOLDER, LIBRARY_CHANGED_EVENT, artifactFileName, reconcileLibraryCopies, recordLibraryUse, requestLibrarySync, saveArtifactToLibrary, useLibrarySync,
  type LibraryUse,
} from '../../lib/librarySync';
import { streamModel } from '../../lib/modelGateway';
import { logActivity } from '../../engine/activityLog';
import { studyData, useStudyData } from '../../store/studyData';
import { getTopic } from '../../data';
import { createCustomCourse, listCustomCourses, type AssetRole, type CustomCourse } from '../../lib/customContent';
import { saveBlob } from '../../lib/notebookMedia';
import {
  CopyBadge, FileMake, MadeDetails, ORIGIN_LABELS, ORIGIN_ORDER, OriginChip, SyncControl, UsedIn, copyState, localSummary, originIcon,
  type CopyState, type FileMakeAction, type OriginId,
} from './generated';
import s from './library.module.css';

const ProjectCompiler = lazy(() => import('../custom-content'));

type Filter = 'all' | 'generated' | 'recent' | 'favorites' | 'trash';
/** 列表里的一行：上传的条目，或一份生成的内容 */
type Row =
  | { type: 'entry'; id: string; name: string; updatedAt: string; entry: LibraryEntry }
  | { type: 'made'; id: string; name: string; updatedAt: string; made: Artifact };
type KindFilter = 'any' | 'folder' | 'doc' | 'slide' | 'image' | 'media' | 'other' | ArtifactKind;
type Location = { view: string; params?: Record<string, string>; topicId?: string };
type FormKind = 'folder' | 'rename' | 'move' | 'course' | 'purge';
type Notice = { text: string; tone: 'warn' | 'bad' };

const PARSEABLE = /\.(pdf|pptx?|docx|md|txt)$/i;
const LIVE_PARSE = ['starting', 'pending', 'processing', 'finalizing'];
const BLOCKED_TEXT = '请先保存当前校订，或等待操作完成。';
const ROLES: { value: AssetRole; label: string }[] = [
  { value: 'lecture', label: '讲义课件' }, { value: 'reading', label: '阅读材料' }, { value: 'lab', label: '实验练习' }, { value: 'syllabus', label: '课程大纲' },
];
const CATEGORIES: { value: Filter; label: string; short: string }[] = [
  { value: 'all', label: '全部', short: '全部' },
  { value: 'generated', label: '生成的内容', short: '生成的' },
  { value: 'recent', label: '最近', short: '最近' },
  { value: 'favorites', label: '收藏', short: '收藏' },
  { value: 'trash', label: '回收站', short: '回收站' },
];
const categoryIcon = (value: Filter, active: boolean) => value === 'all' ? <IconLibrary size={16} active={active} />
  : value === 'generated' ? <Sparkles size={16} strokeWidth={1.75} />
  : value === 'recent' ? <Clock size={16} strokeWidth={1.75} />
    : value === 'favorites' ? <Star size={16} strokeWidth={1.75} />
      : <Trash2 size={16} strokeWidth={1.75} />;

const formatDate = (iso: string) => Number.isFinite(Date.parse(iso))
  ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  : '—';

const NO_COURSE = '未归入课程';
const KIND_LABELS: Record<Exclude<KindFilter, 'any' | ArtifactKind>, string> = { folder: '文件夹', doc: '文档', slide: '课件', image: '图片', media: '音视频', other: '其他文件' };
const kindName = (kind: KindFilter) => (kind === 'any' ? '全部类型' : kind in KIND_LABELS ? KIND_LABELS[kind as keyof typeof KIND_LABELS] : ARTIFACT_LABELS[kind as ArtifactKind] ?? '生成的内容');
function fileGroup(entry: LibraryEntry): KindFilter {
  if (entry.kind === 'folder') return 'folder';
  const tone = fileTone(entry.name, entry.contentType);
  if (tone === 'pdf' || tone === 'doc' || tone === 'text') return 'doc';
  if (tone === 'slide' || tone === 'image') return tone;
  return tone === 'video' || tone === 'audio' ? 'media' : 'other';
}
const TIP_KEY = 'xiaobai-library-unified-tip';
const tipDismissed = () => { try { return localStorage.getItem(TIP_KEY) === 'off'; } catch { return true; } };

/** 没有模型时退回本地摘录，并在正文里标明 */
async function summarise(text: string, title: string, signal: AbortSignal): Promise<{ body: string; local: boolean }> {
  try {
    const result = await streamModel({
      messages: [
        { role: 'system', content: '你是学习助手。把用户给的资料整理成一份中文学习摘要：先用两三句话说清它讲什么，再列 5 到 8 条要点，最后列 2 到 3 个值得追问的问题。用 Markdown，不要寒暄。' },
        { role: 'user', content: `资料《${title}》：\n\n${text.slice(0, 12_000)}` },
      ],
      maxTokens: 1200,
      temperature: 0.3,
      signal,
    });
    if (result.text.trim()) return { body: result.text.trim(), local: false };
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return { body: localSummary(text), local: true };
}

function parseBadge(entry: LibraryEntry): { tone: Tone; label: string; live?: boolean } | null {
  if (entry.kind !== 'file') return null;
  const status = entry.parse?.status;
  if (status === 'completed') return { tone: 'ok', label: '已解析' };
  if (status === 'failed') return { tone: 'bad', label: '解析失败' };
  if (status === 'cancelled') return { tone: 'warn', label: '解析已取消' };
  if (status && LIVE_PARSE.includes(status)) return { tone: 'accent', label: '解析中', live: true };
  return PARSEABLE.test(entry.name) ? { tone: 'outline', label: '未解析' } : null;
}

/**
 * 侧栏挂载位是否真的可见。侧栏收起时外壳只是把它隐藏，挂载位还在；
 * 这时仍把导航放进去就谁也点不到，所以按实际尺寸判断，并跟随展开 / 收起变化。
 */
function useDockedSidebar(): boolean {
  const slot = useSidebarSlot();
  const [visible, setVisible] = useState(() => !!slot && slot.getClientRects().length > 0);
  // 每次渲染后核对一次：侧栏展开 / 收起会让外壳连同本页重渲染
  useLayoutEffect(() => { setVisible(!!slot && slot.getClientRects().length > 0); });
  // 再用尺寸观察兜底（例如窗口变窄后侧栏被样式隐藏）
  useEffect(() => {
    if (!slot) return;
    const observer = new ResizeObserver(() => setVisible(slot.getClientRects().length > 0));
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);
  return visible;
}

export interface LibraryPageProps {
  onLeaveGuardChange?: (value: boolean) => void;
  /** 把资料库文件加入当前对话 */
  onUseInConversation?: (ids: string[]) => Promise<void>;
  /** 把生成的内容直接作为来源加入当前对话。终端提供时优先用它；没有就先存一份云端副本，再按文件加入 */
  onUseArtifacts?: (keys: string[]) => void;
  /** 切换终端视图。不传时直接改路由参数，效果相同 */
  onView?: (view: string, params?: Record<string, string>) => void;
}

export default function LibraryPage(props: LibraryPageProps) {
  const owner = useAuthStore((state) => state.user);
  return <LibrarySession key={owner ?? 'anonymous'} owner={owner} {...props} />;
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

function LibrarySession({ owner, onLeaveGuardChange, onUseInConversation, onUseArtifacts, onView }: LibraryPageProps & { owner: string | null }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const parseWarning = useLibraryParsePolling(snapshot, setSnapshot, owner);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [progress, setProgress] = useState('');
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() => (params.get('tab') === 'generated' ? 'generated' : 'all'));
  const [originFilter, setOriginFilter] = useState<'any' | OriginId>('any');
  const [kindFilter, setKindFilter] = useState<KindFilter>('any');
  const [grouped, setGrouped] = useState(false);
  const [making, setMaking] = useState<FileMakeAction | null>(null);
  const [savingMade, setSavingMade] = useState(false);
  const [tip, setTip] = useState(() => !tipDismissed());
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

  /** 终端侧栏可用：导航放进侧栏，主区不再自带左栏 */
  const docked = useDockedSidebar();

  // 生成的内容：各板块登记的成果，加上它们在云端的副本状态
  const artifacts = useArtifacts(owner);
  const sync = useLibrarySync(owner);
  const study = useStudyData(owner);
  // 工作台数据一变就让登记处马上重读，不等它自己的轮询
  useEffect(() => { refreshStudyArtifacts(); }, [study]);
  useEffect(() => { requestLibrarySync(); }, [artifacts]);

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
  // 自动保存在云端新增或替换了副本：稍等一下再刷新列表
  useEffect(() => {
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!busyRef.current) void reload().catch(() => {}); }, 2500);
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChange);
    return () => { window.removeEventListener(LIBRARY_CHANGED_EVENT, onChange); window.clearTimeout(timer); };
  }, []);
  /** 上一次看到的解析状态：从进行中变成完成时记一条学习行为 */
  const parseSeen = useRef(new Map<string, string>());
  useEffect(() => {
    if (!snapshot) return;
    reconcileLibraryCopies(owner, snapshot.entries);
    for (const entry of snapshot.entries) {
      const status = entry.parse?.status;
      if (!status) continue;
      const before = parseSeen.current.get(entry.id);
      if (before && before !== 'completed' && status === 'completed') {
        logActivity(owner, { source: 'library', summary: `资料《${entry.name}》解析完成，可以用来提问和生成内容`, signal: 'neutral', ref: { kind: 'library-file', id: entry.id, title: entry.name } });
      }
      parseSeen.current.set(entry.id, status);
    }
  }, [snapshot]);

  const entries = snapshot?.entries ?? [];
  const folders = entries.filter((entry) => entry.kind === 'folder' && !entry.deletedAt);
  const path = libraryPath(entries, folderId);
  const courseTitle = (id: string) => courses.find((course) => course.id === id)?.title;
  const canPreview = (entry: LibraryEntry) => entry.kind === 'file' && !entry.deletedAt && entry.phase === 'ready';

  /* ── 一张列表，两种来历 ── */
  const liveFiles = useMemo(() => (snapshot ? new Set(snapshot.entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt).map((entry) => entry.id)) : null), [snapshot]);
  /** 云端副本对应哪份成果（成果还在的才算） */
  const copyOwner = new Map<string, Artifact>();
  for (const item of artifacts) {
    const copy = sync.copies[item.key];
    if (copy && !copy.removed) copyOwner.set(copy.fileId, item);
  }
  const needle = query.trim().toLocaleLowerCase();
  // 平铺的视图（搜索、最近）里，成果和它的云端副本只列一次
  const flat = !!needle || filter === 'recent';
  const showMade = filter === 'generated' || filter === 'recent' || (filter === 'all' && (!folderId || !!needle));
  const entryRows: Row[] = (filter === 'generated' ? [] : visibleLibraryEntries(entries, folderId, filter, query))
    .filter((entry) => !(flat && (copyOwner.has(entry.id) || (filter === 'recent' && entry.kind === 'folder'))))
    .map((entry) => ({ type: 'entry', id: entry.id, name: entry.name, updatedAt: entry.updatedAt, entry }));
  const madeRows: Row[] = (showMade ? artifacts : [])
    .filter((item) => !needle || [item.title, item.summary, item.topicTitle, ARTIFACT_LABELS[item.kind], ORIGIN_LABELS[item.origin.section]].some((field) => field?.toLocaleLowerCase().includes(needle)))
    .map((made) => ({ type: 'made', id: made.key, name: made.title, updatedAt: made.updatedAt, made }));
  /** 当前范围内的全部行（还没按来源、类型筛） */
  const scoped = [...entryRows, ...madeRows];
  const rowOrigin = (row: Row): OriginId => (row.type === 'made' ? row.made.origin.section : copyOwner.get(row.id)?.origin.section ?? 'upload');
  const rowKind = (row: Row): KindFilter => (row.type === 'made' ? row.made.kind : fileGroup(row.entry));
  const isFolder = (row: Row) => row.type === 'entry' && row.entry.kind === 'folder';
  const originCounts = new Map<OriginId, number>();
  for (const row of scoped) { if (!isFolder(row)) originCounts.set(rowOrigin(row), (originCounts.get(rowOrigin(row)) ?? 0) + 1); }
  const byOrigin = scoped.filter((row) => originFilter === 'any' || (!isFolder(row) && rowOrigin(row) === originFilter));
  const kindCounts = new Map<KindFilter, number>();
  for (const row of byOrigin) kindCounts.set(rowKind(row), (kindCounts.get(rowKind(row)) ?? 0) + 1);
  const rows = byOrigin
    .filter((row) => kindFilter === 'any' || rowKind(row) === kindFilter)
    .sort((a, b) => (!flat && isFolder(a) !== isFolder(b) ? (isFolder(a) ? -1 : 1)
      : sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  const filtering = originFilter !== 'any' || kindFilter !== 'any';
  const courseOf = (row: Row): string => {
    if (row.type === 'made') return (row.made.topicId && getTopic(row.made.topicId)?.course) || row.made.topicTitle || NO_COURSE;
    const linked = row.entry.courseImports?.[0]?.courseId
      ?? libraryPath(entries, row.entry.kind === 'folder' ? row.entry.id : row.entry.parentId).find((folder) => folder.sourceCourseId)?.sourceCourseId;
    return (linked && courseTitle(linked)) || NO_COURSE;
  };
  const groups: { label: string; rows: Row[] }[] = [];
  if (grouped) {
    for (const row of rows) {
      const label = courseOf(row);
      const group = groups.find((item) => item.label === label);
      if (group) group.rows.push(row); else groups.push({ label, rows: [row] });
    }
    groups.sort((a, b) => (a.label === NO_COURSE ? 1 : b.label === NO_COURSE ? -1 : a.label.localeCompare(b.label, 'zh-CN')));
  } else {
    groups.push({ label: '', rows });
  }

  const picked = entries.filter((entry) => selected.includes(entry.id));
  const pickedMade = artifacts.filter((item) => selected.includes(item.key));
  const previewRows = rows.filter((row) => row.type === 'made' || canPreview(row.entry));
  const preview = entries.find((entry) => entry.id === previewId && canPreview(entry)) ?? null;
  const previewMade = !preview && previewId ? artifacts.find((item) => item.key === previewId) ?? null : null;
  const previewIndex = preview || previewMade ? previewRows.findIndex((row) => row.id === previewId) : -1;
  const usable = (targets: LibraryEntry[]) => targets.length > 0 && targets.length <= 12 && targets.every((entry) => entry.kind === 'file' && entry.phase === 'ready');
  /** 生成的内容能不能加入对话：终端直接接成果，或者能按文件加入 */
  const canSendMade = !!onUseArtifacts || (!!onUseInConversation && !!snapshot);
  const canSend = picked.length + pickedMade.length > 0
    && picked.every((entry) => entry.kind === 'file' && entry.phase === 'ready')
    && (picked.length ? !!onUseInConversation : true) && (pickedMade.length ? canSendMade : true);
  /** 一段对话最多带 12 份：超了不禁用按钮，点了说明原因 */
  const sendPicked = () => {
    if (picked.length + pickedMade.length > 12) { toast('一段对话最多带 12 份，少选几份再试。'); return; }
    sendToConversation(picked.map((entry) => entry.id), pickedMade.map((item) => item.key));
  };
  /** 还没有云端副本、或副本落后的份数 */
  const pendingCopies = artifacts.filter((item) => { const state = copyState(sync, item, liveFiles); return state === 'local' || state === 'stale'; }).length;

  const browse = (id: string | null, nextFilter: Filter = 'all') => {
    if (busy || courseBlocked) { warn(BLOCKED_TEXT); return; }
    setProject(null); setNotice(null); setFolderId(id); setFilter(nextFilter); setQuery(''); setSelected([]); setPreviewId(null); setForm(null);
    setOriginFilter('any'); setKindFilter('any');
  };
  /** 跳到某个终端位置：成果所在的板块、来源，或资料库里的另一份 */
  const openLocation = (target: Location) => {
    if (busy || courseBlocked) { warn(BLOCKED_TEXT); return; }
    if (target.view === 'library') {
      const file = target.params?.file ? entries.find((entry) => entry.id === target.params?.file) : undefined;
      if (file) { setFilter('all'); setFolderId(file.parentId); setQuery(''); setOriginFilter('any'); setKindFilter('any'); setPreviewId(canPreview(file) ? file.id : null); }
      else if (target.params?.artifact) setPreviewId(target.params.artifact);
      else if (target.params?.file) toast.error('这份文件已经不在资料库里了。');
      return;
    }
    setPreviewId(null);
    const search = { ...(target.view === 'ask' ? {} : { view: target.view }), ...target.params };
    if (target.topicId) navigate(`/prep/${encodeURIComponent(target.topicId)}?${new URLSearchParams(search).toString()}`);
    else if (onView) onView(target.view, target.params);
    else setParams(search);
  };
  const run = async (action: () => Promise<void>, success: string | (() => string)) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      await action();
      if (valid()) { await reload(); toast.success(typeof success === 'function' ? success() : success); setForm(null); setSelected([]); }
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
    const done: LibraryEntry[] = [];
    try {
      for (const file of files) {
        if (!snapshot || file.size > snapshot.maxFileBytes) throw new Error(`“${file.name}”超过单文件大小限制。已上传 ${count} 份。`);
        setUploading({ name: file.name, done: count, total: files.length });
        done.push(await uploadLibraryFile(file, folderId, requestRef.current!.signal));
        count += 1;
      }
    } finally {
      if (valid()) setUploading(null);
      if (done.length) {
        logActivity(owner, {
          source: 'library',
          summary: done.length === 1 ? `上传了资料《${done[0].name}》` : `上传了 ${done.length} 份资料：${done.slice(0, 3).map((entry) => entry.name).join('、')}${done.length > 3 ? ' 等' : ''}`,
          signal: 'interest',
          ref: { kind: 'library-file', id: done[0].id, title: done[0].name },
        });
      }
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
    setDestination(next === 'course' ? targets[0]?.courseImports?.[0]?.courseId ?? folders.find((folder) => folder.id === folderId)?.sourceCourseId ?? courses[0]?.id ?? '__new__' : next === 'folder' ? folderId ?? '' : '');
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
    if (form === 'folder') void run(async () => { await createFolder(name, destination || null); }, '文件夹已创建。');
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
  const parse = (entry: LibraryEntry) => {
    let message = '解析已启动，完成后会自动更新。';
    void run(async () => {
      const state = await parseLibraryFile(entry.id, requestRef.current?.signal, true);
      if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || '解析未完成，请重试。');
      if (state.status === 'completed') message = '已有解析已复用，现在可以直接使用。';
    }, () => message);
  };
  /** 记下「用在了对话里」：服务端不记这个，写进本机的使用记录和学习行为日志 */
  const noteUse = (targets: { id: string; title: string }[]) => {
    if (!targets.length) return;
    for (const target of targets) recordLibraryUse(owner, target.id, { kind: 'chat', label: '用于对话', open: { view: 'ask' } });
    logActivity(owner, {
      source: 'library',
      summary: targets.length === 1 ? `把《${targets[0].title}》用于对话` : `把 ${targets.length} 份资料用于对话：${targets.slice(0, 3).map((target) => target.title).join('、')}${targets.length > 3 ? ' 等' : ''}`,
      signal: 'interest',
      ref: { kind: targets[0].id.includes(':') ? 'artifact' : 'library-file', id: targets[0].id, title: targets[0].title },
    });
  };
  /** ids 是资料库文件，keys 是生成的内容；两者可以一起选 */
  const sendToConversation = (ids: string[], keys: string[] = []) => {
    const files = entries.filter((entry) => ids.includes(entry.id));
    const made = artifacts.filter((item) => keys.includes(item.key));
    const targets = [...files.map((entry) => ({ id: entry.id, title: entry.name })), ...made.map((item) => ({ id: item.key, title: item.title }))];
    if (!targets.length) return;
    if (!made.length) { noteUse(targets); setPreviewId(null); void onUseInConversation?.(ids); return; }
    // 只选了生成的内容、终端又能直接接：不必经过云端
    if (!files.length && onUseArtifacts) { noteUse(targets); setPreviewId(null); setSelected([]); onUseArtifacts(made.map((item) => item.key)); return; }
    if (!onUseInConversation) return;
    // 其余情况：给每份成果存一份云端副本，再和文件一起按文件加入对话
    void run(async () => {
      const copies: string[] = [];
      for (const [index, item] of made.entries()) {
        if (valid()) setProgress(`正在把《${item.title}》存到资料库（${index + 1} / ${made.length}）…`);
        copies.push((await saveArtifactToLibrary(owner, item.key)).fileId);
      }
      if (!valid()) return;
      noteUse(targets);
      setPreviewId(null);
      await onUseInConversation([...ids, ...copies]);
    }, '已加入当前对话。');
  };
  /** 用户主动把成果存到云端（或更新已有副本） */
  const saveMade = (targets: Artifact[]) => {
    if (!targets.length || savingMade) return;
    setSavingMade(true);
    void (async () => {
      let saved = 0;
      try {
        for (const item of targets) { if ((await saveArtifactToLibrary(owner, item.key)).changed) saved += 1; }
        if (!valid()) return;
        toast.success(targets.length === 1
          ? (saved ? `已把《${targets[0].title}》存到资料库「${GENERATED_FOLDER}」。` : '云端那份已经是最新的。')
          : `已保存 ${saved} 份${saved < targets.length ? `，另外 ${targets.length - saved} 份云端已是最新` : ''}。`);
        setSelected((current) => current.filter((id) => !targets.some((item) => item.key === id)));
      } catch (error) {
        if (valid()) toast.error(error instanceof Error ? error.message : '没有存上，请稍后重试。');
      } finally {
        if (valid()) setSavingMade(false);
      }
    })();
  };
  const exportMade = (targets: Artifact[]) => void (async () => {
    let count = 0;
    for (const item of targets) {
      const content = await artifactContent(owner, item.key).catch(() => null);
      if (!content) continue;
      saveBlob(artifactFileName(content.filename, item.title), new Blob([content.text], { type: 'text/markdown;charset=utf-8' }));
      count += 1;
    }
    if (!valid()) return;
    if (count) toast.success(count === 1 ? '已导出到下载目录。' : `已导出 ${count} 份。`); else toast.error('这份内容已经不在了。');
  })();
  /** 用一份上传的资料就地生成闪卡、导图、题目，或存一份摘要笔记 */
  const makeFromFile = (entry: LibraryEntry, action: FileMakeAction) => {
    if (making) return;
    const controller = new AbortController();
    setMaking(action);
    void (async () => {
      try {
        const { sources } = entry.parse?.status === 'completed'
          ? await readLibrarySources([entry.id], '', controller.signal)
          : await prepareLibrarySources([entry.id], controller.signal);
        const text = sources.map((source) => source.content).filter(Boolean).join('\n\n').slice(0, 24_000);
        if (!text.trim()) throw new Error('这份资料里没有读到文字，换一份文字版的试试。');
        const base = entry.name.replace(/\.[^.]+$/, '');
        const origin: ArtifactOrigin = { section: 'workbench', label: `资料库：${entry.name}`, open: { view: 'library', params: { file: entry.id } } };
        let made: { title: string; open: Location; local: boolean };
        if (action === 'summary-note') {
          const summary = await summarise(text, base, controller.signal);
          const noteTitle = `${base} · 摘要`;
          try {
            const result = await runCrossAction(owner, 'save-note', { text: summary.body, title: noteTitle, origin, signal: controller.signal });
            made = { title: result.title, open: result.open, local: summary.local };
          } catch {
            // 跨板块动作还不可用时直接写进工作台笔记，结果一样
            const note = studyData.saveNote(owner, { title: noteTitle, body: summary.body, tags: ['摘要'] });
            made = { title: note.title, open: { view: 'workbench', params: { tool: 'notes', id: note.id } }, local: summary.local };
          }
        } else {
          const result = await runCrossAction(owner, action, { text, title: base, origin, signal: controller.signal });
          made = { title: result.title, open: result.open, local: result.method === 'local' };
        }
        const verb = action === 'make-flashcards' ? '生成闪卡' : action === 'make-mindmap' ? '生成导图' : action === 'make-quiz' ? '出题' : '摘要笔记';
        recordLibraryUse(owner, entry.id, { kind: 'workbench', label: `${verb}《${made.title}》`, open: made.open });
        logActivity(owner, { source: 'library', summary: `用资料《${entry.name}》${verb === '摘要笔记' ? '存了一份摘要笔记' : verb}`, signal: 'interest', ref: { kind: 'library-file', id: entry.id, title: entry.name } });
        if (!valid()) return;
        const target = made.open;
        toast.success(`${verb}《${made.title}》已放进工作台${made.local ? '（本地演示）' : ''}`, { action: { label: '打开', onClick: () => openLocation(target) } });
        if (entry.parse?.status !== 'completed' && !busyRef.current) void reload().catch(() => {});
      } catch (error) {
        if (valid()) toast.error(error instanceof Error ? error.message : '没有生成出来，请稍后重试。');
      } finally {
        if (alive.current) setMaking(null);
      }
    })();
  };
  const dismissTip = () => { setTip(false); try { localStorage.setItem(TIP_KEY, 'off'); } catch { /* 记不住也没关系 */ } };

  // 从别处带着 ?file= / ?artifact= 进来：直接打开那一份
  const linkedFile = params.get('file');
  const linkedArtifact = params.get('artifact');
  const linkDone = useRef('');
  useEffect(() => {
    const token = `${linkedFile ?? ''}|${linkedArtifact ?? ''}`;
    if (token === '|' || linkDone.current === token) return;
    if (linkedArtifact && artifacts.some((item) => item.key === linkedArtifact)) { linkDone.current = token; setPreviewId(linkedArtifact); }
    else if (linkedFile && snapshot) { linkDone.current = token; openLocation({ view: 'library', params: { file: linkedFile } }); }
  }, [linkedFile, linkedArtifact, snapshot, artifacts]);

  const allVisible = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const someVisible = rows.some((row) => selected.includes(row.id));
  const title = project ? '解析与学习' : filter === 'generated' ? '生成的内容' : filter === 'recent' ? '最近' : filter === 'favorites' ? '收藏' : filter === 'trash' ? '回收站' : path.at(-1)?.name ?? '全部';
  const counts: Partial<Record<Filter, number>> = { generated: artifacts.length, favorites: entries.filter((entry) => entry.favorite && !entry.deletedAt).length, trash: entries.filter((entry) => entry.deletedAt).length };
  const dropTarget = !project && filter !== 'trash' && !preview && !form;

  /** 文件夹树：用终端侧栏的共用行，缩进最多两级 */
  const renderFolders = (parent: string | null, depth = 0): ReactNode => depth > 64 ? null : folders
    .filter((entry) => entry.parentId === parent)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((entry) => {
      const hasChildren = folders.some((child) => child.parentId === entry.id);
      const expanded = !collapsed.includes(entry.id);
      const current = folderId === entry.id && !project;
      return (
        <div key={entry.id} className={s.folderBranch}>
          <SideNavItem
            icon={current ? <FolderOpen size={16} strokeWidth={1.75} /> : <Folder size={16} strokeWidth={1.75} />}
            label={entry.name}
            title={entry.name}
            active={current}
            indent={depth === 0 ? undefined : depth === 1 ? 1 : 2}
            trailing={hasChildren ? (
              <IconButton
                label={`${expanded ? '收起' : '展开'} ${entry.name}`}
                size="sm"
                tip={false}
                aria-expanded={expanded}
                onClick={() => setCollapsed((list) => expanded ? [...list, entry.id] : list.filter((id) => id !== entry.id))}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </IconButton>
            ) : undefined}
            onClick={() => browse(entry.id)}
          />
          {hasChildren && expanded && renderFolders(entry.id, depth + 1)}
        </div>
      );
    });
  const newFolder = () => { if (project) browse(folderId); startForm('folder'); };
  const storageNote = `${snapshot?.storage === 'cloud' ? '账号私有存储' : snapshot?.storage === 'local' ? '本机服务存储' : '正在连接存储'}${snapshot ? ` · 单文件上限 ${formatSize(snapshot.maxFileBytes)}` : ''}`;
  const canUpload = !busy && !!snapshot && filter !== 'trash' && !project;

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
  const madeMeta = (made: Artifact) => [ARTIFACT_LABELS[made.kind], made.summary].filter(Boolean).join(' · ');
  /** 来源和打开位置是同一处时，不再单列「查看来源」 */
  const originTarget = (made: Artifact) => (made.origin.open && JSON.stringify(made.origin.open) !== JSON.stringify(made.open) ? made.origin.open : undefined);

  const renderMadeMenu = (made: Artifact, state: CopyState) => {
    const source = originTarget(made);
    return (
      <Menu modal={false}>
        <MenuTrigger asChild>
          <IconButton label={`${made.title} 的更多操作`} size="sm" tip={false}><Ellipsis size={16} /></IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<ArrowUpRight size={15} />} onSelect={() => openLocation(made.open)}>打开</MenuItem>
          <MenuItem icon={<Eye size={15} />} onSelect={() => setPreviewId(made.key)}>预览</MenuItem>
          {canSendMade && <MenuItem icon={<MessageSquarePlus size={15} />} disabled={busy} onSelect={() => sendToConversation([], [made.key])}>用于当前对话</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={<CloudUpload size={15} />} disabled={state === 'syncing' || savingMade} onSelect={() => saveMade([made])}>{state === 'local' ? '存一份到云端' : '更新云端副本'}</MenuItem>
          <MenuItem icon={<Download size={15} />} onSelect={() => exportMade([made])}>导出</MenuItem>
          {source && <MenuItem icon={<Waypoints size={15} />} onSelect={() => openLocation(source)}>查看来源</MenuItem>}
        </MenuContent>
      </Menu>
    );
  };

  const renderRow = (row: Row) => {
    const checked = selected.includes(row.id);
    if (row.type === 'made') {
      const { made } = row;
      const state = copyState(sync, made, liveFiles);
      return (
        <div key={row.id} role="listitem" className={s.row} data-selected={checked}>
          <CheckBox label={`选择 ${made.title}`} checked={checked} onChange={() => toggle(row.id)} />
          <button type="button" className={s.rowMain} onClick={() => setPreviewId(made.key)}>
            <ArtifactTypeIcon kind={made.kind} size={36} />
            <span className={s.rowText}>
              <strong>{made.title}</strong>
              <small>{madeMeta(made)}<span className={s.metaDate}> · {formatDate(made.updatedAt)}</span></small>
              {/* 窄屏没有来源和状态列，标记跟在名称下面 */}
              <span className={s.rowBadgesInline}><OriginChip origin={made.origin.section} title={made.origin.label} /><CopyBadge state={state} /></span>
            </span>
          </button>
          <span className={s.colOrigin}><OriginChip origin={made.origin.section} title={made.origin.label} /></span>
          <span className={cx(s.rowBadges, s.colStatus)}><CopyBadge state={state} /></span>
          <time className={s.colDate}>{formatDate(made.updatedAt)}</time>
          <span className={s.rowActions}>
            <IconButton label={`打开 ${made.title}`} size="sm" tip={false} className={s.hideNarrow} onClick={() => openLocation(made.open)}><ArrowUpRight size={15} /></IconButton>
            {renderMadeMenu(made, state)}
          </span>
        </div>
      );
    }
    const { entry } = row;
    const origin = entry.kind === 'folder' ? null : rowOrigin(row);
    return (
      <div key={row.id} role="listitem" className={s.row} data-selected={checked}>
        <CheckBox label={`选择 ${entry.name}`} checked={checked} onChange={() => toggle(entry.id)} />
        <button type="button" className={s.rowMain} onClick={() => open(entry)}>
          <FileTypeIcon name={entry.name} mimeType={entry.contentType} folder={entry.kind === 'folder'} size={36} />
          <span className={s.rowText}>
            <strong>{entry.name}</strong>
            <small>{entryMeta(entry)}<span className={s.metaDate}> · {formatDate(entry.updatedAt)}</span></small>
            {/* 窄屏没有状态列，状态标记跟在名称下面 */}
            <span className={s.rowBadgesInline}>{renderBadges(entry)}</span>
          </span>
        </button>
        <span className={s.colOrigin}>{origin ? <OriginChip origin={origin} title={origin === 'upload' ? undefined : '生成内容的云端副本'} /> : '—'}</span>
        <span className={cx(s.rowBadges, s.colStatus)}>{renderBadges(entry)}</span>
        <time className={s.colDate}>{formatDate(entry.updatedAt)}</time>
        <span className={s.rowActions}>
          {canPreview(entry) && <IconButton label={`预览 ${entry.name}`} size="sm" tip={false} className={s.hideNarrow} onClick={() => setPreviewId(entry.id)}><Eye size={15} /></IconButton>}
          {!entry.deletedAt && renderStar(entry)}
          {renderMenu(entry)}
        </span>
      </div>
    );
  };

  const renderCard = (row: Row) => {
    const checked = selected.includes(row.id);
    if (row.type === 'made') {
      const { made } = row;
      const state = copyState(sync, made, liveFiles);
      return (
        <div key={row.id} role="listitem" className={s.card} data-selected={checked}>
          <div className={s.cardTop}>
            <CheckBox label={`选择 ${made.title}`} checked={checked} onChange={() => toggle(row.id)} />
            <span className={s.rowActions}>{renderMadeMenu(made, state)}</span>
          </div>
          <button type="button" className={s.cardMain} onClick={() => setPreviewId(made.key)}>
            <ArtifactTypeIcon kind={made.kind} size={48} />
            <strong>{made.title}</strong>
            <small className={s.cardSummary}>{madeMeta(made)}</small>
            <small>{formatDate(made.updatedAt)}</small>
          </button>
          <div className={s.cardBadges}><OriginChip origin={made.origin.section} title={made.origin.label} /><CopyBadge state={state} /></div>
        </div>
      );
    }
    const { entry } = row;
    return (
      <div key={row.id} role="listitem" className={s.card} data-selected={checked}>
        <div className={s.cardTop}>
          <CheckBox label={`选择 ${entry.name}`} checked={checked} onChange={() => toggle(entry.id)} />
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
    );
  };

  const groupHead = (group: { label: string; rows: Row[] }) => grouped && (
    <div className={s.groupHead} role="presentation">
      <GraduationCap size={15} strokeWidth={1.75} />
      <strong>{group.label}</strong>
      <span>{group.rows.length} 项</span>
    </div>
  );

  const renderList = () => (
    <div className={s.list} role="list" aria-label={title}>
      <div className={s.listHead}>
        <CheckBox label="选择当前列表全部项目" checked={allVisible} mixed={!allVisible && someVisible} onChange={() => setSelected(allVisible ? [] : rows.map((row) => row.id))} />
        <span>名称</span>
        <span className={s.colOrigin}>来源</span>
        <span className={s.colStatus}>状态</span>
        <span className={s.colDate}>最近更新</span>
        <span />
      </div>
      {groups.map((group) => (
        <Fragment key={group.label}>
          {groupHead(group)}
          {group.rows.map(renderRow)}
        </Fragment>
      ))}
    </div>
  );

  const renderGrid = () => (
    <div role="list" aria-label={title}>
      {groups.map((group) => (
        <Fragment key={group.label}>
          {groupHead(group)}
          <div className={s.grid}>{group.rows.map(renderCard)}</div>
        </Fragment>
      ))}
    </div>
  );

  const clearFilters = () => { setOriginFilter('any'); setKindFilter('any'); };
  const renderEmpty = () => {
    if (query) return <Empty icon={<Search size={22} strokeWidth={1.75} />} title="没有匹配的项目" description="换个关键词试试。上传的文件和生成的内容是一起搜的。" action={<Button variant="outline" onClick={() => setQuery('')}>清除搜索</Button>} />;
    if (filtering) return <Empty icon={<ListFilter size={22} strokeWidth={1.75} />} title="没有符合筛选的项目" description="换一个来源或类型，或者看全部。" action={<Button variant="outline" onClick={clearFilters}>清除筛选</Button>} />;
    if (filter === 'trash') return <Empty icon={<Trash2 size={22} strokeWidth={1.75} />} title="回收站是空的" description="移入回收站的文件会留在这里，可以恢复或彻底删除。" />;
    if (filter === 'favorites') return <Empty icon={<Star size={22} strokeWidth={1.75} />} title="还没有收藏" description="在文件上点星标，常用资料就会出现在这里。" />;
    if (filter === 'generated') {
      return (
        <Empty
          icon={<Sparkles size={22} strokeWidth={1.75} />}
          title="还没有生成的内容"
          description="在对话、工作台、AI 课堂、助理和科研台里做出来的笔记、导图、题目、闪卡，都会自动出现在这里。"
          action={(
            <>
              <Button variant="solid" onClick={() => openLocation({ view: 'workbench' })}>去工作台</Button>
              <Button variant="outline" onClick={() => openLocation({ view: 'ask' })}>去对话</Button>
            </>
          )}
        />
      );
    }
    if (folderId) {
      return (
        <Empty
          className={s.dropHint}
          icon={<CloudUpload size={22} strokeWidth={1.75} />}
          title="这个文件夹还是空的"
          description={<><span className={s.mouseOnly}>把文件拖到这里，或点上传。</span><span className={s.touchOnly}>点「上传文件」从手机里选。</span></>}
          action={<Button variant="solid" icon={<Upload size={15} />} disabled={!canUpload} onClick={() => inputRef.current?.click()}>上传文件</Button>}
        />
      );
    }
    return (
      <Empty
        className={s.dropHint}
        icon={<CloudUpload size={22} strokeWidth={1.75} />}
        title="资料库还是空的"
        description={<>你上传的文件，和在应用里生成的笔记、导图、题目、闪卡，都会出现在这里。<span className={s.mouseOnly}>把文件拖进来，或点上传。</span><span className={s.touchOnly}>点「上传文件」从手机里选。</span></>}
        action={(
          <>
            <Button variant="solid" icon={<Upload size={15} />} disabled={!canUpload} onClick={() => inputRef.current?.click()}>上传文件</Button>
            <Button variant="outline" icon={<FolderPlus size={15} />} disabled={busy || !snapshot} onClick={() => startForm('folder')}>新建文件夹</Button>
          </>
        )}
      />
    );
  };

  /** 这份文件被用在哪儿：课程引用来自服务端，对话和就地生成来自本机记录 */
  const usesOfFile = (entry: LibraryEntry): LibraryUse[] => [
    ...(entry.courseImports ?? []).map((link): LibraryUse => ({ kind: 'course', label: `课程：${courseTitle(link.courseId) ?? '学习项目'}`, at: link.at })),
    ...(sync.uses[entry.id] ?? []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const renderDetails = (entry: LibraryEntry) => {
    const parsed = parseBadge(entry);
    const status = entry.parse?.status;
    return (
      <div className={s.details}>
        <dl className={s.facts}>
          <div><dt>位置</dt><dd>{['资料库', ...libraryPath(entries, entry.parentId).map((item) => item.name)].join(' / ')}</dd></div>
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
              : status === 'failed' || status === 'cancelled' ? `解析未完成，可重试。${entry.parse?.error ?? ''}`
                : status && LIVE_PARSE.includes(status) ? '正在解析，完成后状态会自动更新。'
                  : PARSEABLE.test(entry.name) ? '尚未解析。解析后可以用它提问、生成讲解和练习。'
                    : '这种格式可以保存在资料库，暂不能解析。可解析 PDF、PPT、PPTX、DOCX、MD、TXT。'}
          </p>
          {PARSEABLE.test(entry.name) && (
            <Button variant="soft" size="sm" icon={<ScanText size={14} />} disabled={busy || !!status && LIVE_PARSE.includes(status)} onClick={() => parse(entry)}>
              {status === 'completed' ? '重新解析' : status && LIVE_PARSE.includes(status) ? '解析中…' : status === 'failed' || status === 'cancelled' ? '重试解析' : '开始解析'}
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
        {copyOwner.has(entry.id) && (
          <section className={s.detailCard}>
            <header>
              <h3>生成内容的副本</h3>
              <Button variant="soft" size="sm" iconRight={<ArrowUpRight size={14} />} onClick={() => { const made = copyOwner.get(entry.id); if (made) openLocation(made.open); }}>打开原件</Button>
            </header>
            <p>这是《{copyOwner.get(entry.id)?.title}》存在云端的一份，原件在{ORIGIN_LABELS[copyOwner.get(entry.id)?.origin.section ?? 'workbench']}里；原件改动后，这份会跟着更新。</p>
          </section>
        )}
        <FileMake
          making={making}
          disabled={busy || !PARSEABLE.test(entry.name)}
          hint={PARSEABLE.test(entry.name)
            ? `直接用它做成闪卡、导图、练习题，或存一份摘要笔记，结果放进工作台。${status === 'completed' ? '' : '还没解析的会先解析，要等一会儿。'}`
            : '这种格式暂时不能用来生成。PDF、PPT、Word、Markdown、文本可以。'}
          onMake={(action) => makeFromFile(entry, action)}
        />
        <section className={s.detailCard}>
          <header>
            <h3>被用于</h3>
          </header>
          <UsedIn uses={usesOfFile(entry)} empty="还没有用在对话、课程或生成的内容里。" onJump={openLocation} />
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
      {/* 有侧栏挂载位时，导航整块放进终端侧栏；没有时（手机、侧栏收起）主区顶部放一条简版导航 */}
      {docked && (
        <SidebarPortal>
          <SidePanel
            title="资料库"
            action={<SideAction icon={<Upload size={16} strokeWidth={1.75} />} disabled={!canUpload} onClick={() => inputRef.current?.click()}>上传文件</SideAction>}
            footer={storageNote}
          >
            <SideGroup label="分类">
              {CATEGORIES.map(({ value, label }) => {
                const active = filter === value && !folderId && !project;
                return <SideNavItem key={value} icon={categoryIcon(value, active)} label={label} meta={counts[value] || undefined} active={active} onClick={() => browse(null, value)} />;
              })}
            </SideGroup>
            <SideGroup label="文件夹" action={<IconButton label="新建文件夹" size="sm" disabled={busy} onClick={() => { newFolder(); setDestination(''); }}><FolderPlus size={15} /></IconButton>}>
              {folders.length ? renderFolders(null) : <SideEmpty>按课程或主题建文件夹，资料更好找。</SideEmpty>}
            </SideGroup>
          </SidePanel>
        </SidebarPortal>
      )}

      <main className={s.main}>
        <div className={s.inner}>
          <header className={s.header}>
            <div className={s.heading}>
              <h1>{title}</h1>
              {!project && (snapshot || rows.length > 0) && <span>{rows.length} 项</span>}
            </div>
            {!project && (
              <div className={s.headerTools}>
                <Input
                  size="sm"
                  wrapClassName={s.search}
                  leading={<Search size={15} />}
                  trailing={query ? <button type="button" className={s.clearSearch} aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button> : undefined}
                  aria-label="搜索资料库"
                  placeholder="搜索资料"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button variant="ghost" className={s.toolButton} icon={<GraduationCap size={16} />} aria-label={picked.length ? '解析所选文件' : '学习项目'} disabled={busy} onClick={() => startForm('course')}>
                  <span>{picked.length ? '解析所选文件' : '学习项目'}</span>
                </Button>
                {!docked && <IconButton label="新建文件夹" variant="outline" disabled={busy} onClick={() => startForm('folder')}><FolderPlus size={16} /></IconButton>}
                <Button variant="outline" icon={<Upload size={15} />} disabled={!canUpload} onClick={() => inputRef.current?.click()}>上传文件</Button>
              </div>
            )}
          </header>

          {!docked && (
            <div className={s.quickNav}>
              <div className={s.quickCats}>
                <Segmented size="sm" label="资料库分类" value={filter} onChange={(value) => browse(null, value)} options={CATEGORIES.map(({ value, short }) => ({ value, label: short }))} />
              </div>
              <Menu modal={false}>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" className={s.folderButton} aria-label="文件夹" icon={<Folder size={15} strokeWidth={1.75} />} iconRight={<ChevronDown size={13} />}><span>文件夹</span></Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<Files size={15} />} checked={!folderId && filter === 'all' && !project} onSelect={() => browse(null)}>全部</MenuItem>
                  {folders
                    .map((folder) => ({ id: folder.id, path: libraryPath(entries, folder.id).map((entry) => entry.name).join(' / ') }))
                    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
                    .map((folder) => (
                      <MenuItem key={folder.id} icon={<Folder size={15} />} checked={folderId === folder.id && !project} onSelect={() => browse(folder.id)}>{folder.path}</MenuItem>
                    ))}
                  <MenuSeparator />
                  <MenuItem icon={<FolderPlus size={15} />} disabled={busy} onSelect={newFolder}>新建文件夹</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          )}

          {tip && !project && (
            <div className={s.tip} role="note">
              <Sparkles size={15} strokeWidth={1.75} />
              <span>你上传的文件，和在对话、工作台、AI 课堂、助理、科研台里生成的内容，现在都在这一处。</span>
              <IconButton label="知道了" size="sm" tip={false} onClick={dismissTip}><X size={14} /></IconButton>
            </div>
          )}
          {!snapshot && loadFailed && rows.length > 0 && !project && (
            <div className={s.banner} data-tone="warn" role="status">
              <TriangleAlert size={16} strokeWidth={1.75} />
              <span>文件服务暂时连不上，上传的文件先看不到；生成的内容保存在这台设备上，照常可用。</span>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={reconnect}>重新连接</Button>
            </div>
          )}
          {snapshot?.syncWarning && (
            <div className={s.banner} data-tone="warn" role="status">
              <TriangleAlert size={16} strokeWidth={1.75} />
              <span>{snapshot.syncWarning}</span>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={reconnect}>重试同步</Button>
            </div>
          )}
          {parseWarning && <div className={s.banner} data-tone="warn" role="status"><TriangleAlert size={16} /><span>{parseWarning}</span></div>}
          {notice && !form && !(!snapshot && loadFailed && rows.length > 0) && (
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
                    <button type="button" onClick={() => browse(null)}>全部</button>
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
                    <SyncControl owner={owner} sync={sync} pending={pendingCopies} reachable={!!snapshot} />
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

                {filter !== 'trash' && (scoped.length > 0 || filtering) && (
                  <div className={s.filterBar}>
                    <div className={s.chips} role="radiogroup" aria-label="按来源筛选">
                      <button type="button" role="radio" aria-checked={originFilter === 'any'} className={s.chip} onClick={() => setOriginFilter('any')}>
                        全部来源<i>{scoped.filter((row) => !isFolder(row)).length}</i>
                      </button>
                      {ORIGIN_ORDER.filter((origin) => originCounts.has(origin) || originFilter === origin).map((origin) => (
                        <button key={origin} type="button" role="radio" aria-checked={originFilter === origin} className={s.chip} onClick={() => { setOriginFilter(origin); setKindFilter('any'); }}>
                          {origin === 'upload' ? <Files size={14} /> : originIcon(origin, 14)}{origin === 'upload' ? '我上传的' : ORIGIN_LABELS[origin]}<i>{originCounts.get(origin) ?? 0}</i>
                        </button>
                      ))}
                    </div>
                    <Menu modal={false}>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="sm" className={s.filterButton} data-on={kindFilter !== 'any' || grouped || undefined} aria-label="类型与分组" icon={<ListFilter size={15} strokeWidth={1.75} />} iconRight={<ChevronDown size={13} />}>
                          <span>{kindFilter === 'any' ? (grouped ? '按课程分组' : '类型') : kindName(kindFilter)}</span>
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuLabel>类型</MenuLabel>
                        <MenuItem checked={kindFilter === 'any'} onSelect={() => setKindFilter('any')}>全部类型</MenuItem>
                        {[...kindCounts.keys()].sort((a, b) => kindName(a).localeCompare(kindName(b), 'zh-CN')).map((kind) => (
                          <MenuItem key={kind} checked={kindFilter === kind} shortcut={kindFilter === kind ? undefined : String(kindCounts.get(kind) ?? 0)} onSelect={() => setKindFilter(kind)}>{kindName(kind)}</MenuItem>
                        ))}
                        <MenuSeparator />
                        <MenuLabel>排列</MenuLabel>
                        <MenuItem icon={<GraduationCap size={15} />} checked={grouped} onSelect={() => setGrouped((value) => !value)}>按课程分组</MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                )}

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
                  {!snapshot && loadFailed && !rows.length && (
                    <Empty
                      icon={<HardDrive size={22} strokeWidth={1.75} />}
                      title="连接你的资料库"
                      description="文件服务准备好后，这里会显示你上传的文件，以及在应用里生成的内容。"
                      action={<Button variant="solid" icon={<RefreshCw size={15} />} onClick={reconnect}>重新连接</Button>}
                    />
                  )}
                  {!snapshot && !loadFailed && rows.length > 0 ? null : rows.length > 0 && (layout === 'list' ? renderList() : renderGrid())}
                  {snapshot && !rows.length && renderEmpty()}
                </div>
              </>
            )}
          {!docked && <p className={s.storageNote}><HardDrive size={14} strokeWidth={1.75} /><span>{storageNote}</span></p>}
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
                    {(onUseInConversation || onUseArtifacts) && <Button variant="ghost" size="sm" icon={<MessageSquarePlus size={14} />} disabled={busy || !canSend} onClick={sendPicked}><span className={s.longLabel}>用于当前对话</span><span className={s.shortLabel}>用于对话</span></Button>}
                    {pickedMade.length > 0
                      ? (
                        // 选中了生成的内容：文件夹操作不适用，换成它们自己的动作
                        <>
                          <Button variant="ghost" size="sm" icon={<CloudUpload size={14} />} loading={savingMade} disabled={busy} onClick={() => saveMade(pickedMade)}><span className={s.longLabel}>存一份到云端</span><span className={s.shortLabel}>存云端</span></Button>
                          <Button variant="ghost" size="sm" icon={<Download size={14} />} disabled={busy} onClick={() => exportMade(pickedMade)}>导出</Button>
                        </>
                      )
                      : (
                        <>
                          <Button variant="ghost" size="sm" icon={<GraduationCap size={14} />} disabled={busy || !usable(picked)} onClick={() => startForm('course')}>加入课程</Button>
                          <Button variant="ghost" size="sm" icon={<Pencil size={14} />} disabled={busy || selected.length !== 1} onClick={() => startForm('rename')}>重命名</Button>
                          <Button variant="ghost" size="sm" icon={<FolderInput size={14} />} disabled={busy} onClick={() => startForm('move')}>移动</Button>
                          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => updateMany({ trashed: true }, '已移入回收站，可随时恢复。')}><span className={s.longLabel}>移入回收站</span><span className={s.shortLabel}>回收站</span></Button>
                        </>
                      )}
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
          <strong>松开文件，上传到{path.at(-1)?.name ?? '资料库'}</strong>
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
          {(shown === 'move' || shown === 'folder') && (
            <OptionList
              label="目标位置"
              value={destination}
              onChange={setDestination}
              options={[
                { value: '', label: '资料库', hint: '根目录', icon: <Files size={16} strokeWidth={1.75} /> },
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
          onPrev={previewIndex > 0 ? () => setPreviewId(previewRows[previewIndex - 1].id) : undefined}
          onNext={previewIndex >= 0 && previewIndex < previewRows.length - 1 ? () => setPreviewId(previewRows[previewIndex + 1].id) : undefined}
          position={previewIndex >= 0 ? { index: previewIndex, total: previewRows.length } : undefined}
          onUseInConversation={onUseInConversation ? () => sendToConversation([preview.id]) : undefined}
          loadParsedText={preview.parse?.status === 'completed'
            ? async () => (await readLibrarySources([preview.id])).sources.map((source) => source.content).filter(Boolean).join('\n\n')
            : undefined}
          status={(() => { const parsed = parseBadge(preview); return parsed ? <Badge tone={parsed.tone} dot={parsed.live}>{parsed.label}</Badge> : null; })()}
          details={renderDetails(preview)}
          noteOwner={owner}
          menuItems={PARSEABLE.test(preview.name) ? (
            <>
              <MenuLabel>用这份资料生成</MenuLabel>
              <MenuItem icon={<Layers size={15} />} disabled={!!making || busy} onSelect={() => makeFromFile(preview, 'make-flashcards')}>生成闪卡</MenuItem>
              <MenuItem icon={<Network size={15} />} disabled={!!making || busy} onSelect={() => makeFromFile(preview, 'make-mindmap')}>生成导图</MenuItem>
              <MenuItem icon={<ListChecks size={15} />} disabled={!!making || busy} onSelect={() => makeFromFile(preview, 'make-quiz')}>出题</MenuItem>
              <MenuItem icon={<NotebookPen size={15} />} disabled={!!making || busy} onSelect={() => makeFromFile(preview, 'summary-note')}>存摘要为笔记</MenuItem>
            </>
          ) : undefined}
        />
      )}

      {previewMade && (() => {
        const made = previewMade;
        const state = copyState(sync, made, liveFiles);
        const copy = sync.copies[made.key];
        const copyEntry = copy && state !== 'local' ? entries.find((entry) => entry.id === copy.fileId) : undefined;
        const source = originTarget(made);
        return (
          <FilePreview
            // 成果正文一律是 Markdown，按 Markdown 渲染和导出
            file={{ id: made.key, name: artifactFileName(undefined, made.title), mimeType: 'text/markdown' }}
            title={made.title}
            subtitle={[ARTIFACT_LABELS[made.kind], made.topicTitle, `更新于 ${formatDate(made.updatedAt)}`].filter(Boolean).join(' · ')}
            icon={<ArtifactTypeIcon kind={made.kind} size={36} />}
            load={async () => {
              const content = await artifactContent(owner, made.key);
              if (!content) throw new Error('这份内容已经不在了，可能已被删除。');
              return new Blob([content.text], { type: 'text/markdown' });
            }}
            onClose={() => setPreviewId(null)}
            onPrev={previewIndex > 0 ? () => setPreviewId(previewRows[previewIndex - 1].id) : undefined}
            onNext={previewIndex >= 0 && previewIndex < previewRows.length - 1 ? () => setPreviewId(previewRows[previewIndex + 1].id) : undefined}
            position={previewIndex >= 0 ? { index: previewIndex, total: previewRows.length } : undefined}
            primaryAction={{ label: '打开', icon: <ArrowUpRight size={15} />, onClick: () => openLocation(made.open) }}
            onUseInConversation={canSendMade ? () => sendToConversation([], [made.key]) : undefined}
            downloadLabel="导出"
            status={<><OriginChip origin={made.origin.section} title={made.origin.label} /><CopyBadge state={state} /></>}
            menuItems={(
              <>
                <MenuItem icon={<CloudUpload size={15} />} disabled={state === 'syncing' || savingMade} onSelect={() => saveMade([made])}>{state === 'local' ? '存一份到云端' : '更新云端副本'}</MenuItem>
                {source && <MenuItem icon={<Waypoints size={15} />} onSelect={() => openLocation(source)}>查看来源</MenuItem>}
              </>
            )}
            details={(
              <MadeDetails
                artifact={made}
                state={state}
                copy={copy}
                copyPath={copyEntry ? libraryPath(entries, copyEntry.parentId).map((item) => item.name).join(' / ') : undefined}
                uses={sync.uses[made.key] ?? []}
                saving={savingMade}
                formatDate={formatDate}
                onSave={() => saveMade([made])}
                onShowCopy={copyEntry ? () => openLocation({ view: 'library', params: { file: copyEntry.id } }) : undefined}
                onOrigin={source ? () => openLocation(source) : undefined}
                onJump={openLocation}
              />
            )}
          />
        );
      })()}
    </div>
  );
}
