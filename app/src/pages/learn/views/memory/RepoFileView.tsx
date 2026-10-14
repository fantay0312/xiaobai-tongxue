/**
 * 记忆库里的一个文件：按小节列出条目（不是原始 Markdown），每条带出处、日期，可以置顶、改、删；
 * 「原文」切到 Markdown；底部添一条。MEMORY.md 另外带一份索引，链到其余文件。
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, FileText, FolderOpen, Plus } from 'lucide-react';
import { Badge, Button, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, toast } from '../../../../components/ui';
import { syncXiaobaiRepo } from '../../../../engine/memory-repo/xiaobai';
import {
  ENTRY_TEXT_MAX, addEntries, fileInfo, folderLabel, groupEntries, indexLinks, isSensitiveMemoryText, renderFile, repoOps, topicIdOfPath,
} from '../../../../engine/memoryRepo';
import type { EntrySource, RepoEntry, RepoId, RepoState } from '../../../../engine/memoryRepo';
import { relDay } from '../../../../lib/relDay';
import { MEMORY_LAYERS, memoryRetention, type MemoryLayer } from '../../../../engine/memoryRetention';
import { useAppStore } from '../../../../store/appStore';
import { MemoryRow } from './MemoryRow';
import m from './memory.module.css';
import r from './repo.module.css';

interface Props {
  owner: string | null;
  repo: RepoId;
  state: RepoState;
  path: string;
  /** 手机上把「添一条」吸在底部 */
  dock: boolean;
  /** 每次加一，把光标放进「添一条」 */
  addSignal: number;
  onOpenFile: (path: string) => void;
  /** 这条出处能跳回去时返回跳转函数 */
  jump: (source: EntrySource) => (() => void) | null;
}

const PLACEHOLDER: Record<string, string> = {
  'MEMORY.md': '比如：我是大二，计算机专业',
  'preferences.md': '比如：讲解时先给结论，再展开',
  'goals.md': '比如：十二月前学完操作系统',
  'weak-points.md': '比如：指针和引用总是分不清',
  'mastered.md': '比如：链表的增删已经很熟',
  'habits.md': '比如：一般晚上做题，早上看书',
  'materials.md': '比如：主要看王道的操作系统讲义',
  'teacher.md': '比如：先生开讲前爱先问一句',
  'questions.md': '比如：下一堂想先听听死锁',
};

/** 把文字里的 [[path]] 渲染成可点的链接 */
function withLinks(text: string, repo: RepoId, titles: Record<string, string>, onOpenFile: (path: string) => void): ReactNode {
  const parts = text.split(/\[\[([^\]]+)\]\]/);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (index % 2 === 0
    ? part
    : (
      <button key={index} type="button" className={r.entryLink} title={part} onClick={() => onOpenFile(part)}>
        {fileInfo(repo, part, titles).title}
      </button>
    )));
}

export function RepoFileView({ owner, repo, state, path, dock, addSignal, onOpenFile, jump }: Props) {
  const info = fileInfo(repo, path, state.titles);
  const entries = state.files[path] ?? [];
  const groups = groupEntries(info, entries);
  const sections = info.sections ?? [];
  const [raw, setRaw] = useState(false);
  const [draft, setDraft] = useState('');
  const [section, setSection] = useState(sections[0]?.id ?? '');
  const [freshId, setFreshId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  // addSignal 是点「添加一条记忆」的时刻：刚点完才挂载进来的（从梦境或历史页跳过来）也要聚焦
  const seenSignal = useRef(Date.now() - addSignal < 1500 ? -1 : addSignal);

  const pinMemory = useAppStore((st) => st.pinMemory);
  const editMemory = useAppStore((st) => st.editMemory);
  const deleteMemory = useAppStore((st) => st.deleteMemory);
  const addExplicitMemory = useAppStore((st) => st.addExplicitMemory);

  // 换文件时回到条目视图，小节选回第一个
  useEffect(() => {
    setRaw(false);
    setDraft('');
    setSection(fileInfo(repo, path, {}).sections?.[0]?.id ?? '');
  }, [repo, path]);
  // 侧栏「添加一条记忆」：等输入框出现在页面上再聚焦
  useEffect(() => {
    if (seenSignal.current === addSignal || !addInputRef.current) return;
    seenSignal.current = addSignal;
    addInputRef.current.scrollIntoView({ block: 'center' });
    addInputRef.current.focus();
  });

  /** 小白「先生怎么教」里的条目来自课堂记忆：改动要落到课堂记忆上，上课时才真的生效 */
  const classroomId = (entry: RepoEntry) => (repo === 'xiaobai' && entry.id.startsWith('xb:mem:') ? entry.id.slice('xb:mem:'.length) : null);

  const edit = (entry: RepoEntry, text: string) => {
    if (isSensitiveMemoryText(text)) {
      toast.error('密码、手机号、邮箱这类信息不会存进记忆');
      return false;
    }
    const linked = classroomId(entry);
    if (linked) {
      editMemory(linked, text);
      syncXiaobaiRepo(owner);
      return true;
    }
    if (repoOps.edit(owner, repo, entry.id, { text })) return true;
    toast.error('没保存：内容太短');
    return false;
  };
  const pin = (entry: RepoEntry, pinned: boolean) => {
    const linked = classroomId(entry);
    if (linked) {
      pinMemory(linked, pinned);
      syncXiaobaiRepo(owner);
    } else {
      repoOps.pin(owner, repo, entry.id, pinned);
    }
  };
  const remove = (entry: RepoEntry) => {
    const linked = classroomId(entry);
    if (linked) {
      repoOps.remove(owner, repo, entry.id);
      deleteMemory(linked);
      syncXiaobaiRepo(owner);
      toast('已从课堂记忆里删掉这条');
      return;
    }
    const commit = repoOps.remove(owner, repo, entry.id);
    if (!commit) return;
    toast('已删除这条记忆', { duration: 6000, action: { label: '撤销', onClick: () => { repoOps.revert(owner, repo, commit.id); } } });
  };
  const setLayer = (entry: RepoEntry, retention: MemoryLayer) => {
    repoOps.edit(owner, repo, entry.id, { retention });
    toast(`已改为${MEMORY_LAYERS.find(item => item.id === retention)!.label}`);
  };
  const layerItems = (entry: RepoEntry) => MEMORY_LAYERS.map(layer => (
    <MenuItem key={layer.id} checked={memoryRetention(entry, path).layer === layer.id} onSelect={() => setLayer(entry, layer.id)}>{layer.label}</MenuItem>
  ));

  const draftText = draft.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draftText) return;
    if (isSensitiveMemoryText(draftText)) {
      toast.error('密码、手机号、邮箱这类信息不会存进记忆');
      return;
    }
    if (repo === 'xiaobai' && path === 'teacher.md') {
      // 写给小白的话走课堂记忆，上课时他才会用上
      addExplicitMemory(draftText, {});
      syncXiaobaiRepo(owner);
      setDraft('');
      toast.success('小白记下了');
      return;
    }
    const topicId = topicIdOfPath(path);
    const [saved] = addEntries(owner, repo, [{
      path, text: draftText, ...(section ? { section } : {}),
      source: { type: 'user', label: '我添加的', ...(topicId ? { topicId, ref: { kind: 'topic', id: topicId, title: info.title } } : {}) },
    }], 'user', `我添了一条：${draftText.slice(0, 24)}`);
    if (!saved) {
      toast.error(draftText.length < 2 ? '太短了，写具体一点' : '这件事已经记着了，没有重复记');
      return;
    }
    setDraft('');
    setFreshId(saved.id);
    toast.success(`已记到「${info.title}」`);
  };

  const sectionMenu = sections.length > 1 ? (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline" iconRight={<ChevronDown size={14} strokeWidth={1.75} />}>
          {sections.find((entry) => entry.id === section)?.label ?? '小节'}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>记到哪一节</MenuLabel>
        {sections.map((entry) => (
          <MenuItem key={entry.id} checked={entry.id === section} onSelect={() => setSection(entry.id)}>{entry.label}</MenuItem>
        ))}
      </MenuContent>
    </Menu>
  ) : null;
  const addInput = (
    <Input
      ref={addInputRef}
      wrapClassName={m.addInput}
      leading={<Plus size={16} strokeWidth={1.75} />}
      value={draft}
      maxLength={ENTRY_TEXT_MAX}
      placeholder={PLACEHOLDER[path] ?? `在「${info.title}」里添一条`}
      aria-label={`在「${info.title}」里添一条`}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
  const links = path === 'MEMORY.md' ? indexLinks(state) : [];

  return (
    <div className={r.file}>
      <div className={r.toolbar}>
        <span className={r.path}><FileText size={13} strokeWidth={1.75} />{path}</span>
        <Button size="sm" variant={raw ? 'soft' : 'ghost'} aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
          {raw ? '回到条目' : '原文'}
        </Button>
      </div>

      {raw ? (
        <pre className={r.raw}>{renderFile(state, path)}</pre>
      ) : groups.length > 0 ? (
        <div className={m.groups}>
          {groups.map((group) => (
            <div key={group.section?.id ?? 'none'} className={m.group} role="group" aria-label={group.section?.label ?? info.title}>
              {group.section && (
                <div className={m.groupHead}>
                  <h3>{group.section.label}</h3>
                  <span className={m.count}>{group.entries.length}</span>
                </div>
              )}
              <ul className={m.rows}>
                {group.entries.map((entry) => {
                  const back = jump(entry.source);
                  return (
                    <MemoryRow
                      key={entry.id}
                      text={entry.text}
                      display={withLinks(entry.text, repo, state.titles, onOpenFile)}
                      pinned={Boolean(entry.pinned)}
                      fresh={freshId === entry.id}
                      maxLength={ENTRY_TEXT_MAX}
                      confirmDelete={classroomId(entry) !== null}
                      onEdit={(text) => edit(entry, text)}
                      onPin={(pinned) => pin(entry, pinned)}
                      onDelete={() => remove(entry)}
                      menuExtra={layerItems(entry)}
                      extra={<Menu><MenuTrigger asChild><Button size="sm" variant="ghost">调整记忆层级</Button></MenuTrigger><MenuContent>{layerItems(entry)}</MenuContent></Menu>}
                      meta={(
                        <>
                          {back ? (
                            <button type="button" className={r.sourceChip} title="回到它被记下的地方" onClick={back}>
                              <span>{entry.source.label}</span>
                              <ArrowUpRight size={12} strokeWidth={1.75} />
                            </button>
                          ) : (
                            <span className={r.sourceChip}><span>{entry.source.label}</span></span>
                          )}
                          <span>{relDay(entry.addedAt)}</span>
                          <Badge>{memoryRetention(entry, path).active ? MEMORY_LAYERS.find(layer => layer.id === memoryRetention(entry, path).layer)!.label : '已淡出回答'}</Badge>
                          {(entry.seen ?? 1) > 1 && <span>提到 {entry.seen} 次</span>}
                          {entry.author === 'dream' && <Badge tone="accent">做梦整理</Badge>}
                          {entry.edited && <Badge>我改过</Badge>}
                        </>
                      )}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className={r.emptyFile}>这个文件还空着。{info.hint}</p>
      )}

      {!raw && links.length > 0 && (
        <section className={m.section} aria-labelledby="repo-index-title">
          <div className={m.sectionHead}>
            <div>
              <h2 id="repo-index-title">索引</h2>
              <p>其余的细节在这些文件里，用到时才取。</p>
            </div>
          </div>
          <ul className={r.index}>
            {links.map((link) => (
              <li key={link.path}>
                <button type="button" className={r.indexLink} onClick={() => onOpenFile(link.path)}>
                  {link.folder ? <FolderOpen size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
                  <strong>{link.folder ? `${folderLabel(link.folder)} · ` : ''}{link.title}</strong>
                  <code>{link.path}</code>
                  <em>{link.count} 条</em>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!raw && (dock ? (
        <form className={m.dock} onSubmit={submit}>
          {draftText && sectionMenu && <div className={m.dockOpts}>{sectionMenu}</div>}
          <div className={m.dockRow}>
            {addInput}
            <Button type="submit" variant="solid" disabled={!draftText}>记下</Button>
          </div>
        </form>
      ) : (
        <form className={m.add} onSubmit={submit}>
          {addInput}
          <div className={m.addSide}>
            {sectionMenu}
            <Button type="submit" variant="solid" disabled={!draftText}>记下</Button>
          </div>
        </form>
      ))}
    </div>
  );
}
