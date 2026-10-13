import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { listLibrary, libraryPath, visibleLibraryEntries, type LibrarySnapshot } from '../../lib/fileLibrary';
import s from './library.module.css';

export function LibraryPicker({ selected, onClose, onConfirm, onManage }: { selected: string[]; onClose: () => void; onConfirm: (ids: string[]) => void; onManage: () => void }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>();
  const [ids, setIds] = useState(selected);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; closeRef.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { const controller = new AbortController(); void listLibrary(controller.signal).then(setSnapshot).catch((error) => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, []);
  const entries = snapshot?.entries ?? [];
  const visible = visibleLibraryEntries(entries, folder, 'all', query);
  return <div className={s.pickerBackdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') {
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><section className={s.picker} role="dialog" aria-modal="true" aria-label="从资料库选择文件">
    <header><div><h2>从资料库选择</h2><p>文件会加入当前对话，已有解析可直接复用。</p></div><button ref={closeRef} aria-label="关闭文件选择" onClick={onClose}><Icon name="x" size={18} /></button></header>
    <input aria-label="搜索可用文件" placeholder="搜索文件名" value={query} onChange={(event) => setQuery(event.target.value)} />
    <nav className={s.breadcrumbs}><button onClick={() => { setFolder(null); setQuery(''); }}>全部文件</button>{libraryPath(entries, folder).map((item) => <button key={item.id} onClick={() => { setFolder(item.id); setQuery(''); }}> / {item.name}</button>)}</nav>
    {error && <p role="alert">{error}</p>}
    <div className={s.pickerFiles}>{visible.map((entry) => entry.kind === 'folder' ? <button key={entry.id} onClick={() => { setFolder(entry.id); setQuery(''); }}><Icon name="folder" size={18} />{entry.name}<Icon name="chevron-right" size={14} /></button> : <label key={entry.id}>
      <input type="checkbox" disabled={entry.phase !== 'ready' || !/\.(pdf|pptx?|docx|md|txt)$/i.test(entry.name) || !ids.includes(entry.id) && ids.length >= 12} checked={ids.includes(entry.id)} onChange={(event) => setIds((current) => event.target.checked ? [...current,entry.id] : current.filter((id) => id !== entry.id))} />
      <Icon name="file" size={18} /><span>{entry.name}<small>{entry.parse?.status === 'completed' ? '已解析 · 直接使用' : '首次使用时解析'}</small></span>
    </label>)}{snapshot && !visible.length && <p>这里还没有可选文件。</p>}{!snapshot && !error && <p>正在读取资料库…</p>}</div>
    <footer><span>已选 {ids.length} / 12 份</span><button onClick={onManage}>上传 / 管理</button><button onClick={onClose}>取消</button><button className={s.pickerConfirm} onClick={() => onConfirm(ids)}>用于当前对话</button></footer>
  </section></div>;
}
