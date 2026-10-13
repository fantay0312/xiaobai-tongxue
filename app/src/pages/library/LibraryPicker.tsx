import { useEffect, useState } from 'react';
import { Check, ChevronRight, Search, Settings2 } from 'lucide-react';
import { Button, Dialog, Empty, Input, Skeleton } from '../../components/ui';
import { FileTypeIcon, formatSize } from '../../components/preview';
import { listLibrary, libraryPath, visibleLibraryEntries, type LibraryEntry, type LibrarySnapshot } from '../../lib/fileLibrary';
import s from './library.module.css';

const LIMIT = 12;
const USABLE = /\.(pdf|pptx?|docx|md|txt)$/i;

export function LibraryPicker({ selected, onClose, onConfirm, onManage }: { selected: string[]; onClose: () => void; onConfirm: (ids: string[]) => void; onManage: () => void }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const [ids, setIds] = useState(selected);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void listLibrary(controller.signal).then(setSnapshot).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);

  const entries = snapshot?.entries ?? [];
  const visible = visibleLibraryEntries(entries, folder, 'all', query)
    .sort((a, b) => a.kind !== b.kind ? a.kind === 'folder' ? -1 : 1 : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const enter = (id: string | null) => { setFolder(id); setQuery(''); };
  const hint = (entry: LibraryEntry) => entry.phase !== 'ready' ? '正在入库'
    : !USABLE.test(entry.name) ? '这种格式暂不能用于对话'
      : entry.parse?.status === 'completed' ? '已解析 · 直接使用' : '首次使用时解析';

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="从资料库选择"
      description="文件会加入当前对话，已有解析可直接复用。"
      size="lg"
      footer={(
        <div className={s.pickerFoot}>
          <span>已选 {ids.length} / {LIMIT} 份</span>
          <Button variant="ghost" icon={<Settings2 size={15} />} onClick={onManage}>上传 / 管理</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="solid" onClick={() => onConfirm(ids)}>用于当前对话</Button>
        </div>
      )}
    >
      <div className={s.picker}>
        <Input size="sm" leading={<Search size={15} />} aria-label="搜索可用文件" placeholder="搜索文件名" value={query} onChange={(event) => setQuery(event.target.value)} />
        <nav className={s.crumbs} aria-label="文件夹路径">
          <button type="button" onClick={() => enter(null)}>全部文件</button>
          {libraryPath(entries, folder).map((item) => (
            <span key={item.id}><ChevronRight size={13} /><button type="button" onClick={() => enter(item.id)}>{item.name}</button></span>
          ))}
        </nav>
        {error && <p className={s.formError} role="alert">{error}</p>}
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
            const disabled = entry.phase !== 'ready' || !USABLE.test(entry.name) || (!checked && ids.length >= LIMIT);
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
      </div>
    </Dialog>
  );
}
