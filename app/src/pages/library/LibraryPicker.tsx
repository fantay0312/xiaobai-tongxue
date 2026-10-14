import { useEffect, useState } from 'react';
import { Check, ChevronRight, Search, Settings2 } from 'lucide-react';
import { Button, Dialog, Empty, Input, Segmented, Skeleton } from '../../components/ui';
import { ArtifactTypeIcon, FileTypeIcon, formatSize } from '../../components/preview';
import { listLibrary, libraryPath, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot } from '../../lib/fileLibrary';
import { ARTIFACT_LABELS, useArtifacts } from '../../lib/artifacts';
// 终端一加载就会引入这个选择器：顺带登记工作台成果，并让自动保存在后台待命
import '../../lib/artifactProviders/studyData';
import { recordLibraryUse, saveArtifactToLibrary, useLibrarySync } from '../../lib/librarySync';
import { logActivity } from '../../engine/activityLog';
import { useAuthStore } from '../../store/authStore';
import { useLibraryParsePolling } from '../../hooks/useLibraryParsePolling';
import { isParsing } from '../../lib/libraryParsing';
import { ORIGIN_LABELS } from './generated';
import s from './library.module.css';

const LIMIT = 12;
const USABLE = /\.(pdf|pptx?|docx|md|txt)$/i;
type Tab = 'files' | 'made';

export function LibraryPicker({ selected, onClose, onConfirm, onManage, selectedArtifacts, onConfirmArtifacts }: {
  selected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
  onManage: () => void;
  /** 当前对话已经带上的成果键 */
  selectedArtifacts?: string[];
  /** 选中的生成内容（成果键）。不提供时，选中的成果会先存一份云端副本，再并入 onConfirm 的文件 id */
  onConfirmArtifacts?: (keys: string[]) => void;
}) {
  const owner = useAuthStore((state) => state.user);
  const artifacts = useArtifacts(owner);
  const sync = useLibrarySync(owner);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const parseWarning = useLibraryParsePolling(snapshot, setSnapshot, owner);
  const [ids, setIds] = useState(selected);
  const [keys, setKeys] = useState<string[]>(selectedArtifacts ?? []);
  const [tab, setTab] = useState<Tab>('files');
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void listLibrary(controller.signal).then(setSnapshot).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);

  const entries = snapshot?.entries ?? [];
  const visible = visibleLibraryEntries(entries, folder, 'all', query)
    .sort((a, b) => a.kind !== b.kind ? a.kind === 'folder' ? -1 : 1 : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const needle = query.trim().toLocaleLowerCase();
  const made = artifacts.filter((item) => !needle || [item.title, item.summary, item.topicTitle, ARTIFACT_LABELS[item.kind]].some((field) => field?.toLocaleLowerCase().includes(needle)));
  const total = ids.length + keys.length;
  const enter = (id: string | null) => { setFolder(id); setQuery(''); };
  const hint = (entry: LibraryEntry) => entry.phase !== 'ready' ? '正在入库'
    : !USABLE.test(entry.name) ? '这种格式暂不能用于对话'
      : entry.parse?.status === 'completed' ? '已解析 · 直接使用'
        : isParsing(entry.parse?.status) ? '正在解析 · 完成后自动更新'
          : entry.parse?.status === 'failed' || entry.parse?.status === 'cancelled' ? '解析未完成 · 在资料库重试' : '首次使用时解析';
  /** 没有直接接成果的通道时，成果要靠云端副本进入对话：读不到资料库就用不了 */
  const madeBlocked = !onConfirmArtifacts && !snapshot;

  const confirm = () => {
    if (working) return;
    const pickedMade = artifacts.filter((item) => keys.includes(item.key));
    const note = () => {
      for (const item of pickedMade) recordLibraryUse(owner, item.key, { kind: 'chat', label: '用于对话', open: { view: 'ask' } });
      const added = entries.filter((entry) => ids.includes(entry.id) && !selected.includes(entry.id));
      for (const entry of added) recordLibraryUse(owner, entry.id, { kind: 'chat', label: '用于对话', open: { view: 'ask' } });
      const names = [...added.map((entry) => entry.name), ...pickedMade.map((item) => item.title)];
      if (names.length) {
        logActivity(owner, {
          source: 'library',
          summary: names.length === 1 ? `把《${names[0]}》用于对话` : `把 ${names.length} 份资料用于对话：${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}`,
          signal: 'interest',
        });
      }
    };
    if (!pickedMade.length || onConfirmArtifacts) {
      note();
      if (onConfirmArtifacts) onConfirmArtifacts(pickedMade.map((item) => item.key));
      onConfirm(ids);
      return;
    }
    // 终端还不能直接接成果：先各存一份云端副本，再按文件加入
    setWorking(true);
    setError('');
    void (async () => {
      try {
        const copies: string[] = [];
        for (const item of pickedMade) copies.push((await saveArtifactToLibrary(owner, item.key)).fileId);
        note();
        onConfirm([...new Set([...ids, ...copies])]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '没有存上，请稍后重试。');
        setWorking(false);
      }
    })();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !working) onClose(); }}
      title="从资料库选择"
      description="上传的文件和在应用里生成的内容，都可以加入当前对话。"
      size="lg"
      footer={(
        <div className={s.pickerFoot}>
          <span>已选 {total} / {LIMIT} 份</span>
          <Button variant="ghost" icon={<Settings2 size={15} />} disabled={working} onClick={onManage}>上传 / 管理</Button>
          <Button variant="outline" disabled={working} onClick={onClose}>取消</Button>
          <Button variant="solid" loading={working} onClick={confirm}>用于当前对话</Button>
        </div>
      )}
    >
      <div className={s.picker}>
        <Segmented
          size="sm"
          block
          label="选择范围"
          value={tab}
          onChange={(next) => { setTab(next); setQuery(''); }}
          options={[
            { value: 'files', label: `上传的文件${ids.length ? ` · ${ids.length}` : ''}` },
            { value: 'made', label: `生成的内容${keys.length ? ` · ${keys.length}` : ''}` },
          ]}
        />
        <Input
          size="sm"
          leading={<Search size={15} />}
          aria-label={tab === 'files' ? '搜索可用文件' : '搜索生成的内容'}
          placeholder={tab === 'files' ? '搜索文件名' : '搜索笔记、导图、题目、闪卡…'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {tab === 'files' && (
          <nav className={s.crumbs} aria-label="文件夹路径">
            <button type="button" onClick={() => enter(null)}>全部</button>
            {libraryPath(entries, folder).map((item) => (
              <span key={item.id}><ChevronRight size={13} /><button type="button" onClick={() => enter(item.id)}>{item.name}</button></span>
            ))}
          </nav>
        )}
        {error && <p className={s.formError} role="alert">{error}</p>}
        {parseWarning && <p className={s.formError} role="status">{parseWarning}</p>}

        {tab === 'files' && (
          <div className={s.pickerList}>
            {visible.map((entry) => {
              if (entry.kind === 'folder') {
                return (
                  <button key={entry.id} type="button" className={s.pickerRow} onClick={() => enter(entry.id)}>
                    <span className={s.pickerLead} aria-hidden="true" />
                    <FileTypeIcon name={entry.name} folder size={32} />
                    <span className={s.pickerText}><strong>{entry.name}</strong><small>文件夹</small></span>
                    <ChevronRight size={15} className={s.pickerArrow} />
                  </button>
                );
              }
              const checked = ids.includes(entry.id);
              const disabled = entry.phase !== 'ready' || !USABLE.test(entry.name) || (!checked && total >= LIMIT);
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={disabled}
                  className={s.pickerRow}
                  onClick={() => setIds((current) => checked ? current.filter((id) => id !== entry.id) : [...current, entry.id])}
                >
                  <span className={s.check} data-checked={checked}>{checked && <Check size={12} strokeWidth={3} />}</span>
                  <FileTypeIcon name={entry.name} mimeType={entry.contentType} size={32} />
                  <span className={s.pickerText}><strong>{entry.name}</strong><small>{hint(entry)}</small></span>
                  <span className={s.pickerSize}>{formatSize(entry.byteSize)}</span>
                </button>
              );
            })}
            {snapshot && !visible.length && (
              <Empty
                title={query ? '没有匹配的文件' : '这里还没有可选文件'}
                description={query ? '换个关键词试试。' : '先到资料库上传 PDF、PPT、Word、Markdown 或文本文件。'}
                action={<Button variant="outline" onClick={onManage}>去资料库上传</Button>}
              />
            )}
            {!snapshot && !error && (
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
        )}

        {tab === 'made' && (
          <div className={s.pickerList}>
            {madeBlocked && made.length > 0 && <p className={s.pickerNote}>资料库暂时连不上，生成的内容要先存到云端才能加入对话，请稍后再试。</p>}
            {made.map((item) => {
              const checked = keys.includes(item.key);
              const copy = sync.copies[item.key];
              const stored = !!copy && !copy.removed;
              const disabled = madeBlocked || (!checked && total >= LIMIT);
              return (
                <button
                  key={item.key}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={disabled}
                  className={s.pickerRow}
                  onClick={() => setKeys((current) => checked ? current.filter((key) => key !== item.key) : [...current, item.key])}
                >
                  <span className={s.check} data-checked={checked}>{checked && <Check size={12} strokeWidth={3} />}</span>
                  <ArtifactTypeIcon kind={item.kind} size={32} />
                  <span className={s.pickerText}>
                    <strong>{item.title}</strong>
                    <small>{[ARTIFACT_LABELS[item.kind], ORIGIN_LABELS[item.origin.section], item.summary].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className={s.pickerSize}>{stored ? '已存云端' : '本机'}</span>
                </button>
              );
            })}
            {!made.length && (
              <Empty
                title={query ? '没有匹配的内容' : '还没有生成的内容'}
                description={query ? '换个关键词试试。' : '在对话、工作台、AI 课堂、助理和科研台里做出来的笔记、导图、题目、闪卡，都会出现在这里。'}
              />
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
