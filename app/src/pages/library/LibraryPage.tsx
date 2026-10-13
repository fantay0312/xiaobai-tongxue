import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { useAuthStore } from '../../store/authStore';
import { isCurrentAccount } from '../../lib/api';
import { createFolder, downloadLibraryFile, importLibraryFile, parseLibraryFile, detachLibraryCourse, purgeLibraryEntry, libraryPath, listLibrary, updateLibraryEntry, uploadLibraryFile, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot } from '../../lib/fileLibrary';
import { createCustomCourse, listCustomCourses, type AssetRole, type CustomCourse } from '../../lib/customContent';
import { saveBlob } from '../../lib/notebookMedia';
import s from './library.module.css';

const ProjectCompiler = lazy(() => import('../custom-content'));
type Filter = 'all' | 'recent' | 'favorites' | 'trash';
const formatSize = (bytes?: number) => bytes === undefined ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const formatDate = (iso: string) => Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export default function LibraryPage({ onLeaveGuardChange, onUseInConversation }: { onLeaveGuardChange?: (value: boolean) => void; onUseInConversation?: (ids: string[]) => Promise<void> }) {
  const owner = useAuthStore((state) => state.user);
  return <LibrarySession key={owner ?? 'anonymous'} owner={owner} onLeaveGuardChange={onLeaveGuardChange} onUseInConversation={onUseInConversation} />;
}

function LibrarySession({ owner, onLeaveGuardChange, onUseInConversation }: { owner: string | null; onLeaveGuardChange?: (value: boolean) => void; onUseInConversation?: (ids: string[]) => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null); const [filter, setFilter] = useState<Filter>('all'); const [query, setQuery] = useState(''); const [sort, setSort] = useState<'updated' | 'name'>('updated'); const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<string[]>([]); const [previewId, setPreviewId] = useState<string | null>(null); const [previewText, setPreviewText] = useState('');
  const [form, setForm] = useState<'folder' | 'rename' | 'move' | 'course' | 'purge' | null>(null); const [name, setName] = useState(''); const [destination, setDestination] = useState(''); const [courses, setCourses] = useState<CustomCourse[]>([]);
  const [project, setProject] = useState<{ key: number; courseId: string; assetIds: string[] } | null>(null);
  const [courseBlocked, setCourseBlocked] = useState(false); const [dragging, setDragging] = useState(false);
  const [role, setRole] = useState<AssetRole>('lecture'); const [newCourseTitle, setNewCourseTitle] = useState('');
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null); const requestRef = useRef<AbortController | null>(null); const alive = useRef(true);
  const valid = () => isCurrentAccount(owner, useAuthStore.getState(), alive.current);
  const reload = async () => { const next = await listLibrary(requestRef.current?.signal); if (valid()) setSnapshot(next); };
  useEffect(() => { alive.current = true; const controller = new AbortController(); requestRef.current = controller; void listCustomCourses(controller.signal).then((next) => { if (valid()) setCourses(next); }).catch(() => {}); void reload().catch((error) => { if (valid() && !controller.signal.aborted) setNotice(error.message); }); return () => { alive.current = false; controller.abort(); }; }, []);
  useEffect(() => { onLeaveGuardChange?.(busy || courseBlocked); return () => onLeaveGuardChange?.(false); }, [busy, courseBlocked, onLeaveGuardChange]);
  const entries = snapshot?.entries ?? []; const folders = entries.filter((entry) => entry.kind === 'folder' && !entry.deletedAt);
  const path = libraryPath(entries, folderId); const preview = entries.find((entry) => entry.id === previewId) ?? null;
  const visible = visibleLibraryEntries(entries, folderId, filter, query).sort((a, b) => a.kind !== b.kind ? a.kind === 'folder' ? -1 : 1 : sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const picked = entries.filter((entry) => selected.includes(entry.id));
  const browse = (id: string | null, nextFilter: Filter = 'all') => { if (busy || courseBlocked) { setNotice('请先保存当前校订，或等待操作完成。'); return; } setProject(null); setNotice(''); setFolderId(id); setFilter(nextFilter); setQuery(''); setSelected([]); setPreviewId(null); setPreviewText(''); setForm(null); };
  const run = async (action: () => Promise<void>, success: string) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setNotice(''); try { await action(); if (valid()) { await reload(); setNotice(success); setForm(null); setSelected([]); } } catch (error) { if (valid()) { setNotice(error instanceof Error ? error.message : '操作未完成。'); await reload().catch(() => {}); } } finally { busyRef.current = false; if (valid()) setBusy(false); } };
  const upload = (files: File[]) => void run(async () => {
    let count = 0;
    for (const file of files) { if (!snapshot || file.size > snapshot.maxFileBytes) throw new Error(`“${file.name}”超过单文件大小限制。已上传 ${count} 份。`); setNotice(`正在上传 ${file.name}（${count + 1}/${files.length}）`); await uploadLibraryFile(file, folderId, requestRef.current!.signal); count += 1; }
  }, `已上传 ${files.length} 份文件。`);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const open = (entry: LibraryEntry) => { if (entry.kind === 'folder' && !entry.deletedAt) browse(entry.id); else { setPreviewId(entry.id); setPreviewText(''); } };
  const updateMany = (patch: Parameters<typeof updateLibraryEntry>[1], success: string) => void run(async () => { for (const entry of picked) await updateLibraryEntry(entry.id, patch); }, success);
  const startForm = (next: typeof form) => {
    if (busy || courseBlocked) { setNotice('请先保存当前校订，或等待操作完成。'); return; }
    setForm(next); setName(next === 'rename' ? picked[0]?.name ?? '' : '');
    setDestination(next === 'course' ? picked[0]?.courseImports?.[0]?.courseId ?? folders.find((folder) => folder.id === folderId)?.sourceCourseId ?? courses[0]?.id ?? '__new__' : '');
    setNewCourseTitle(path.at(-1)?.name ?? '');
    if (next === 'course') void listCustomCourses().then((nextCourses) => { if (valid()) setCourses(nextCourses); }).catch(() => { if (valid()) setNotice('项目服务暂不可用。文件已保存在资料库，可稍后重试。'); });
  };
  const startProject = () => void run(async () => {
    if (picked.length > 12) throw new Error('每个课题最多使用 12 份文件，请减少选择。');
    if (picked.some((entry) => entry.kind !== 'file' || entry.phase !== 'ready' || !/\.(pdf|pptx?|docx|md|txt)$/i.test(entry.name))) throw new Error('请选择 PDF、PPT、PPTX、DOCX、MD 或 TXT 文件进行解析。');
    const course = destination === '__new__' ? await createCustomCourse(newCourseTitle.trim()) : courses.find((item) => item.id === destination);
    if (!course) throw new Error('请选择学习项目，或创建一个新项目。');
    setDestination(course.id);
    setCourses((current) => current.some((item) => item.id === course.id) ? current : [...current, course]);
    const assetIds: string[] = [];
    for (const entry of picked) {
      if (valid()) setNotice(`正在将 ${entry.name} 加入 ${course.title}…`);
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
  const allVisible = visible.length > 0 && visible.every((entry) => selected.includes(entry.id));
  const title = project ? '解析与学习' : filter === 'recent' ? '最近文件' : filter === 'favorites' ? '收藏' : filter === 'trash' ? '回收站' : path.at(-1)?.name ?? '全部文件';
  const renderFolders = (parent: string | null, depth = 0): React.ReactNode => depth > 64 ? null : folders.filter((entry) => entry.parentId === parent).map((entry) => <div key={entry.id}><button className={s.folderLink} style={{ paddingLeft: 12 + depth * 14 }} aria-current={folderId === entry.id && !project ? 'page' : undefined} onClick={() => browse(entry.id)}><Icon name="folder" size={16} /><span>{entry.name}</span></button>{renderFolders(entry.id, depth + 1)}</div>);
  return <div className={s.page} onDragOver={(event) => { if (!project && filter !== 'trash') { event.preventDefault(); setDragging(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { if (project || filter === 'trash') return; event.preventDefault(); setDragging(false); if (!busy && snapshot) upload(Array.from(event.dataTransfer.files)); }}>
    <aside className={s.navigation}><h2>资料库</h2><button className={s.newFolder} onClick={() => { browse(folderId); startForm('folder'); }} disabled={busy}><Icon name="plus" size={17} />新建文件夹</button><nav aria-label="资料库分类">{([['all','全部文件','library'],['recent','最近','clock'],['favorites','收藏','star'],['trash','回收站','trash']] as const).map(([value,label,icon]) => <button key={value} aria-current={filter === value && !folderId && !project ? 'page' : undefined} onClick={() => browse(null, value)}><Icon name={icon} size={17} />{label}</button>)}</nav><div className={s.folderHeading}><span>文件夹</span><button aria-label="新建文件夹" onClick={() => startForm('folder')} disabled={busy}><Icon name="plus" size={14} /></button></div><div className={s.folderTree}>{renderFolders(null)}</div><p className={s.storage}>{snapshot?.storage === 'cloud' ? '账号私有存储' : snapshot?.storage === 'local' ? '本机服务存储' : '正在连接存储'}</p></aside>
    <main className={s.main}>
      <header className={s.header}><h1>{title}</h1>{!project && <div className={s.headerTools}><label className={s.search}><Icon name="search" size={16} /><input aria-label="搜索资料库" placeholder="搜索文件或文件夹" value={query} onChange={(event) => setQuery(event.target.value)} /></label><details className={s.newMenu}><summary>新建<Icon name="chevron-down" size={13} /></summary><div><button disabled={busy || !snapshot} onClick={() => inputRef.current?.click()}><Icon name="upload" size={16} />上传文件</button><button disabled={busy} onClick={() => startForm('folder')}><Icon name="folder" size={16} />新建文件夹</button></div></details></div>}</header>
      {snapshot?.syncWarning && <p className={s.notice} role="status">{snapshot.syncWarning}<button onClick={() => void reload().catch((error) => setNotice(error.message))}>重试同步</button></p>}
      {notice && <div className={s.notice} role="status"><span>{notice}</span><button aria-label="关闭资料库提示" onClick={() => setNotice('')}><Icon name="x" size={14} /></button></div>}
      {project ? <section className={s.projectWorkspace}>
        <div className={s.projectBar}><button onClick={() => browse(folderId)}><Icon name="arrow-left" size={15} />返回资料库</button><span>{courses.find((course) => course.id === project.courseId)?.title} · 文件解析 → 生成课题 → 校订 → 开始学习</span></div>
        <Suspense fallback={<p>正在打开项目工作台…</p>}><ProjectCompiler key={project.key} embedded compilerOnly initialCourseId={project.courseId} initialAssetIds={project.assetIds} onLeaveGuardChange={setCourseBlocked} /></Suspense>
      </section> : <>
        <nav className={s.breadcrumbs} aria-label="文件夹路径"><button onClick={() => browse(null)}>全部文件</button>{path.map((entry) => <span key={entry.id}><Icon name="chevron-right" size={12} /><button onClick={() => browse(entry.id)}>{entry.name}</button></span>)}</nav>
        {!snapshot && <div className={s.empty}><Icon name="library" size={32} /><h2>连接你的资料库</h2><p>文件服务准备好后，这里会显示你保存的文件和分组。</p><button onClick={() => void reload().catch((error) => setNotice(error.message))}>重新连接</button></div>}
        {snapshot && <>
          {filter !== 'trash' && <div className={s.quickActions}><button disabled={busy} onClick={() => inputRef.current?.click()}><Icon name="upload" size={22} /><strong>上传文件</strong><small>保存原件，稍后整理</small></button><button disabled={busy} onClick={() => startForm('folder')}><Icon name="folder" size={22} /><strong>新建文件夹</strong><small>按课程、主题或项目分组</small></button><button disabled={busy} onClick={() => startForm('course')}><Icon name="graduation" size={22} /><strong>{picked.length ? '解析所选文件' : '学习项目'}</strong><small>{picked.length ? '生成讲解、练习与学习课题' : '继续解析、校订或新建项目'}</small></button></div>}
          <div className={s.toolbar}><span>{selected.length ? `已选 ${selected.length} 项` : `${visible.length} 个项目`}</span>{selected.length > 0 && <div className={s.selectionTools}>{filter === 'trash' ? <><button disabled={busy} onClick={() => updateMany({ trashed: false }, '已恢复所选项目。')}>恢复</button><button disabled={busy} onClick={() => startForm('purge')}>彻底删除</button></> : <><button disabled={busy || selected.length !== 1} onClick={() => startForm('rename')}>重命名</button><button disabled={busy} onClick={() => startForm('move')}>移动</button><button disabled={busy || picked.some((entry) => entry.kind !== 'file' || entry.phase !== 'ready') || picked.length > 12} onClick={() => startForm('course')}>加入课程</button>{onUseInConversation && <button disabled={busy || picked.length > 12 || picked.some((entry) => entry.kind !== 'file' || entry.phase !== 'ready')} onClick={() => void onUseInConversation(picked.map((entry) => entry.id))}>用于当前对话</button>}<button disabled={busy} onClick={() => updateMany({ trashed: true }, '已移入回收站，可随时恢复。')}>移入回收站</button></>}</div>}<select aria-label="资料库排序" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">最近更新</option><option value="name">名称</option></select><button aria-label="列表视图" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><Icon name="clipboard" size={17} /></button><button aria-label="网格视图" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><Icon name="grid" size={17} /></button></div>
          {form && <form className={s.inlineForm} onSubmit={(event) => { event.preventDefault(); submitForm(); }}>
            <strong>{form === 'folder' ? '新建文件夹' : form === 'rename' ? '重命名' : form === 'course' ? picked.length ? `将 ${picked.length} 份文件加入课程` : '打开学习项目' : form === 'purge' ? '彻底删除所选项目？' : '移动到'}</strong>
            {form === 'folder' || form === 'rename' ? <input autoFocus aria-label="项目名称" value={name} maxLength={180} onChange={(event) => setName(event.target.value)} placeholder="输入名称" /> : form === 'purge' ? <p>资料库中的原件删除后无法恢复。已有学习课题和解析记录会保留。{picked.some((entry) => entry.sourceAssetId) ? '旧课程原件仍由原项目保存，这里移除的是资料库引用。' : ''}</p> : <select aria-label="目标位置" value={destination} onChange={(event) => setDestination(event.target.value)}>
              <option value={form === 'course' ? '__new__' : ''}>{form === 'course' ? '＋ 新建学习项目' : '全部文件（根目录）'}</option>
              {form === 'course' ? courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>) : folders.filter((folder) => !selected.includes(folder.id)).map((folder) => <option key={folder.id} value={folder.id}>{libraryPath(entries, folder.id).map((entry) => entry.name).join(' / ')}</option>)}
            </select>}
            {form === 'course' && destination === '__new__' && <input aria-label="新项目名称" placeholder="项目名称，例如：线性代数" maxLength={120} value={newCourseTitle} onChange={(event) => setNewCourseTitle(event.target.value)} />}
            {form === 'course' && picked.length > 0 && <select aria-label="文件用途" value={role} onChange={(event) => setRole(event.target.value as AssetRole)}><option value="lecture">讲义 / 课件</option><option value="reading">阅读材料</option><option value="lab">实验 / 练习</option><option value="syllabus">课程大纲</option></select>}
            <button type="submit" disabled={busy || ((form === 'folder' || form === 'rename') && !name.trim()) || form === 'course' && (!destination || destination === '__new__' && newCourseTitle.trim().length < 2)}>{form === 'course' ? picked.length ? '加入项目' : '打开项目' : form === 'purge' ? '确认彻底删除' : '确认'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>取消</button>
          </form>}
          <div className={s.fileArea}><div className={`${s.entries} ${layout === 'grid' ? s.grid : ''}`}>{layout === 'list' && <div className={s.tableHead}><input type="checkbox" aria-label="选择当前列表全部项目" checked={allVisible} onChange={() => setSelected(allVisible ? [] : visible.map((entry) => entry.id))} /><span>名称</span><span>类型 / 来源</span><span>大小</span><span>最近更新</span><span /></div>}{visible.map((entry) => <div key={entry.id} className={s.entry} data-selected={selected.includes(entry.id)}><input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} /><button className={s.entryName} onClick={() => open(entry)}><span className={s.fileIcon} data-folder={entry.kind === 'folder'}><Icon name={entry.kind === 'folder' ? 'folder' : 'file'} size={21} /></span><span>{entry.name}{entry.phase !== 'ready' && <small>{entry.phase === 'purging' ? '正在彻底删除' : '正在入库'}</small>}</span></button><span className={s.entryType}>{entry.kind === 'folder' ? '文件夹' : entry.name.split('.').at(-1)?.toUpperCase() || '文件'}{entry.courseImports?.length ? <small>已用于 {entry.courseImports.length} 门课程</small> : null}</span><span className={s.entrySize}>{entry.kind === 'folder' ? '—' : formatSize(entry.byteSize)}</span><time className={s.entryDate}>{formatDate(entry.updatedAt)}</time><button className={s.favorite} aria-label={`${entry.favorite ? '取消收藏' : '收藏'} ${entry.name}`} disabled={busy || !!entry.deletedAt} onClick={() => void run(async () => { await updateLibraryEntry(entry.id, { favorite: !entry.favorite }); }, entry.favorite ? '已取消收藏。' : '已收藏。')}><Icon name="star" size={16} fill={entry.favorite ? 'currentColor' : 'none'} /></button></div>)}</div>{!visible.length && <div className={s.empty}><Icon name={filter === 'trash' ? 'trash' : 'folder'} size={32} /><h2>{query ? '没有匹配的项目' : filter === 'trash' ? '回收站是空的' : '这里还没有文件'}</h2><p>{query ? '换个关键词试试。' : '上传文件或新建文件夹，开始整理你的学习资料。'}</p></div>}</div>
        </>}
        {preview && <section className={s.preview}><header><h2>{preview.name}</h2><button aria-label="关闭文件详情" onClick={() => setPreviewId(null)}><Icon name="x" size={16} /></button></header><p>{preview.kind === 'folder' ? '文件夹' : `${formatSize(preview.byteSize)} · ${preview.contentType || '文件'}`} · {formatDate(preview.updatedAt)}</p>{!preview.deletedAt && preview.kind === 'file' && preview.phase === 'ready' && <div><button onClick={() => void run(async () => { const blob = await downloadLibraryFile(preview.id); if (valid()) saveBlob(preview.name, blob); }, '下载已准备。')}><Icon name="download" size={16} />下载原件</button><button disabled={busy} onClick={() => { setSelected([preview.id]); setForm("course"); setDestination(preview.courseImports?.[0]?.courseId ?? courses[0]?.id ?? "__new__"); }}>加入课程</button>{/\.(txt|md|json|csv|log)$/i.test(preview.name) && (preview.byteSize ?? 0) < 262144 && <button onClick={() => void run(async () => { const text = await (await downloadLibraryFile(preview.id)).text(); if (valid()) setPreviewText(text); }, '已读取文本。')}>预览文本</button>}</div>}{preview.kind === 'file' && !preview.deletedAt && <div className={s.fileConnections}><p>解析状态：{preview.parse?.status === 'completed' ? '已完成，可直接用于提问和生成内容' : preview.parse?.status === 'failed' ? '失败，可重试' : preview.parse?.status ?? '尚未解析'}</p><button disabled={busy} onClick={() => void run(async () => { await parseLibraryFile(preview.id, undefined, true); }, '解析已启动，使用时会自动读取最新状态。')}>解析 / 重试</button>{onUseInConversation && <button onClick={() => void onUseInConversation([preview.id])}>用于当前对话</button>}{preview.courseImports?.map((link) => <p key={link.courseId}>{courses.find((course) => course.id === link.courseId)?.title ?? '学习项目'}<button disabled={busy} onClick={() => void run(async () => { await detachLibraryCourse(preview.id, link.courseId); }, '已移除课程引用，原件仍在资料库。')}>移除课程引用</button></p>)}</div>}{previewText && <pre>{previewText}</pre>}</section>}
      </>}
      <input ref={inputRef} hidden type="file" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) upload(files); }} />
      {dragging && <div className={s.dropOverlay}>松开文件，上传到{path.at(-1)?.name ?? '全部文件'}</div>}
    </main>
  </div>;
}
