/**
 * 附加选择器 —— 任何输入区都用这一个对话框挑上下文：
 * 「资料库文件」是上传的原件，「我的内容」是各板块生成的成果（笔记、导图、题目、AI 课、助理成果……）。
 * 多选，返回文件 id 与成果登记键。
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Search, Settings2 } from 'lucide-react';
import { ARTIFACT_LABELS, useArtifacts, type Artifact, type ArtifactKind } from '../../lib/artifacts';
import { libraryPath, listLibrary, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot } from '../../lib/fileLibrary';
import { FileTypeIcon, formatSize } from '../preview';
import { Button, Dialog, Empty, Input, Segmented, Skeleton } from '../ui';
import { ArtifactKindIcon, shortTime } from './kinds';
import type { AttachSelection } from './materials';
import s from './handoff.module.css';

export type AttachTab = 'files' | 'artifacts';

export interface AttachPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string | null;
  /** 已经附加的，打开时预先勾上 */
  selected?: Partial<AttachSelection>;
  /** names：所选资料库文件的 id → 文件名（读得到的那些），供显示小签 */
  onConfirm: (selection: AttachSelection, names: Record<string, string>) => void;
  /** 去资料库上传或整理；不给就不显示入口 */
  onManage?: () => void;
  initialTab?: AttachTab;
  title?: string;
  description?: string;
  confirmLabel?: string;
  fileLimit?: number;
  artifactLimit?: number;
}

const USABLE = /\.(pdf|pptx?|docx|md|txt)$/i;
const KIND_ORDER: ArtifactKind[] = ['note', 'mindmap', 'quiz', 'deck', 'todo-list', 'writing', 'chat-artifact', 'lesson', 'agent-output', 'research-file'];

function fileHint(entry: LibraryEntry): string {
  if (entry.phase !== 'ready') return '正在入库';
  if (!USABLE.test(entry.name)) return '这种格式暂不能作为资料';
  return entry.parse?.status === 'completed' ? '已解析 · 直接使用' : '首次使用时解析';
}

export function AttachPicker(props: AttachPickerProps) {
  // 关着的时候不挂内容：每次打开都从当前已附加的状态开始
  if (!props.open) return null;
  return <PickerDialog {...props} />;
}

function PickerDialog({
  onOpenChange, owner, selected, onConfirm, onManage, initialTab = 'files',
  title = '添加上下文', description = '资料库里的文件，和你在各处做出来的内容，都可以带进来。', confirmLabel = '添加',
  fileLimit = 12, artifactLimit = 8,
}: AttachPickerProps) {
  const [tab, setTab] = useState<AttachTab>(initialTab);
  const [fileIds, setFileIds] = useState<string[]>(() => [...(selected?.fileIds ?? [])]);
  const [artifactKeys, setArtifactKeys] = useState<string[]>(() => [...(selected?.artifactKeys ?? [])]);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const [libraryError, setLibraryError] = useState(false);
  const artifacts = useArtifacts(owner);

  useEffect(() => {
    const controller = new AbortController();
    void listLibrary(controller.signal).then(setSnapshot).catch(() => { if (!controller.signal.aborted) setLibraryError(true); });
    return () => controller.abort();
  }, []);

  const entries = snapshot?.entries ?? [];
  const files = visibleLibraryEntries(entries, folder, 'all', query)
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  const enter = (id: string | null) => { setFolder(id); setQuery(''); };

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matched = needle
      ? artifacts.filter((item) => `${item.title} ${item.summary ?? ''} ${item.topicTitle ?? ''} ${item.origin.label ?? ''}`.toLocaleLowerCase().includes(needle))
      : artifacts;
    const byKind = new Map<ArtifactKind, Artifact[]>();
    for (const item of matched) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    return KIND_ORDER.flatMap((kind) => (byKind.has(kind) ? [{ kind, items: byKind.get(kind)! }] : []));
  }, [artifacts, query]);

  const toggleFile = (id: string) => setFileIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const toggleArtifact = (key: string) => setArtifactKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  const total = fileIds.length + artifactKeys.length;
  const confirm = () => onConfirm(
    { fileIds, artifactKeys },
    Object.fromEntries(entries.filter((entry) => fileIds.includes(entry.id)).map((entry) => [entry.id, entry.name])),
  );

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={(
        <div className={s.foot}>
          <span>已选 {fileIds.length} 份文件 · {artifactKeys.length} 份内容</span>
          {onManage && <Button variant="ghost" icon={<Settings2 size={15} strokeWidth={1.75} />} onClick={onManage}>上传 / 管理</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="solid" disabled={total === 0 && !(selected?.fileIds?.length || selected?.artifactKeys?.length)} onClick={confirm}>{confirmLabel}</Button>
        </div>
      )}
    >
      <div className={s.picker}>
        <div className={s.pickerTools}>
          <Segmented
            label="内容来源"
            value={tab}
            onChange={(next) => { setTab(next); setQuery(''); }}
            options={[
              { value: 'files', label: fileIds.length ? `资料库文件 ${fileIds.length}` : '资料库文件' },
              { value: 'artifacts', label: artifactKeys.length ? `我的内容 ${artifactKeys.length}` : '我的内容' },
            ]}
          />
          <Input
            wrapClassName={s.pickerSearch}
            size="sm"
            leading={<Search size={15} strokeWidth={1.75} />}
            aria-label={tab === 'files' ? '搜索文件' : '搜索我的内容'}
            placeholder={tab === 'files' ? '搜索文件名' : '搜索标题、课程或来源'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {tab === 'files' ? (
          <>
            {!libraryError && (
              <nav className={s.crumbs} aria-label="文件夹路径">
                <button type="button" onClick={() => enter(null)}>全部文件</button>
                {libraryPath(entries, folder).map((item) => (
                  <span key={item.id}><ChevronRight size={13} /><button type="button" onClick={() => enter(item.id)}>{item.name}</button></span>
                ))}
              </nav>
            )}
            <div className={s.list}>
              {libraryError && (
                <Empty
                  title="资料库现在连不上"
                  description="登录并联网后可以选择上传的文件。你做出来的笔记、导图、题目等仍然可以直接带进来。"
                  action={<Button variant="outline" onClick={() => setTab('artifacts')}>看看我的内容</Button>}
                />
              )}
              {files.map((entry) => {
                if (entry.kind === 'folder') {
                  return (
                    <button key={entry.id} type="button" className={s.row} onClick={() => enter(entry.id)}>
                      <span className={s.lead} aria-hidden="true" />
                      <FileTypeIcon name={entry.name} folder size={32} />
                      <span className={s.rowText}><strong>{entry.name}</strong><small>文件夹</small></span>
                      <ChevronRight size={15} className={s.rowArrow} />
                    </button>
                  );
                }
                const checked = fileIds.includes(entry.id);
                const disabled = entry.phase !== 'ready' || !USABLE.test(entry.name) || (!checked && fileIds.length >= fileLimit);
                return (
                  <button key={entry.id} type="button" role="checkbox" aria-checked={checked} disabled={disabled} className={s.row} onClick={() => toggleFile(entry.id)}>
                    <span className={s.check} data-checked={checked}>{checked && <Check size={12} strokeWidth={3} />}</span>
                    <FileTypeIcon name={entry.name} mimeType={entry.contentType} size={32} />
                    <span className={s.rowText}><strong>{entry.name}</strong><small>{fileHint(entry)}</small></span>
                    <span className={s.rowMeta}>{formatSize(entry.byteSize)}</span>
                  </button>
                );
              })}
              {snapshot && !files.length && (
                <Empty
                  title={query ? '没有匹配的文件' : '这里还没有可选文件'}
                  description={query ? '换个关键词试试。' : '先到资料库上传 PDF、PPT、Word、Markdown 或文本文件。'}
                  action={onManage ? <Button variant="outline" onClick={onManage}>去资料库上传</Button> : undefined}
                />
              )}
              {!snapshot && !libraryError && (
                <div className={s.skeletons} role="status" aria-label="正在读取资料库">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index}>
                      <Skeleton width={32} height={32} radius="var(--r-md)" />
                      <span><Skeleton width={`${52 - index * 6}%`} height={13} /><Skeleton width="24%" height={11} /></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={s.list}>
            {groups.map((group) => (
              <section key={group.kind} aria-label={ARTIFACT_LABELS[group.kind]}>
                <p className={s.groupLabel}>{ARTIFACT_LABELS[group.kind]}<i>{group.items.length}</i></p>
                {group.items.map((item) => {
                  const checked = artifactKeys.includes(item.key);
                  const disabled = !checked && artifactKeys.length >= artifactLimit;
                  const meta = [item.topicTitle, item.summary ?? item.origin.label].filter(Boolean).join(' · ');
                  return (
                    <button key={item.key} type="button" role="checkbox" aria-checked={checked} disabled={disabled} className={s.row} onClick={() => toggleArtifact(item.key)}>
                      <span className={s.check} data-checked={checked}>{checked && <Check size={12} strokeWidth={3} />}</span>
                      <span className={s.kindIcon}><ArtifactKindIcon kind={item.kind} /></span>
                      <span className={s.rowText}><strong>{item.title || '未命名'}</strong>{meta && <small>{meta}</small>}</span>
                      <span className={s.rowMeta}>{shortTime(item.updatedAt)}</span>
                    </button>
                  );
                })}
              </section>
            ))}
            {!groups.length && (
              <Empty
                title={query ? '没有匹配的内容' : '还没有做出来的内容'}
                description={query ? '换个关键词试试。' : '在对话里把回答存成笔记、做成闪卡，或让助理、AI 课堂生成内容后，这里就能选到。'}
              />
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
