import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, LayoutGrid, List, Plus, Search, Star, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../components/ui';
import { TOPICS, type ReaderSummary } from './types';
import { readerApi } from './api';
import s from './reading.module.css';

export function Shelf({ documents, onOpen, onAdd, onExport, onReview, onConnect, onSample, onRestore }: {
  documents: ReaderSummary[]; onOpen: (id: string) => void; onAdd: () => void; onExport: () => void;
  onReview: () => void; onConnect: () => void; onSample: () => void; onRestore: (id: string) => void;
}) {
  const [search, setSearch] = useState(''); const [topic, setTopic] = useState('all');
  const [sort, setSort] = useState('recent'); const [filter, setFilter] = useState('all'); const [grid, setGrid] = useState(true);
  const [found, setFound] = useState<ReaderSummary[]>([]);
  useEffect(() => {
    if (!search.trim()) { setFound([]); return; }
    const abort = new AbortController();
    const timer = setTimeout(() => { void readerApi<{ documents: ReaderSummary[] }>('/search-library', { query: search.slice(0, 200) }, 'POST', abort.signal).then((data) => { if (!abort.signal.aborted) setFound(data.documents); }).catch(() => {}); }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search]);
  const active = documents.filter((doc) => !doc.deleted);
  const results = useMemo(() => [...documents, ...found.filter((hit) => !documents.some((doc) => doc.id === hit.id))].filter((doc) => (filter === 'trash' ? doc.deleted : !doc.deleted)
    && (topic === 'all' || doc.topic === topic) && (filter !== 'favorite' || doc.favorite)
    && (filter !== 'reading' || doc.progress > 0 && doc.progress < 0.95) && (filter !== 'done' || doc.progress >= 0.95)
    && (filter !== 'agent' || doc.agent) && (filter !== 'short' || (doc.wordCount || 0) < 4500)
    && (filter !== 'long' || (doc.wordCount || 0) >= 20250)
    && (found.some((hit) => hit.id === doc.id) || `${doc.title} ${doc.author} ${doc.tags.join(' ')} ${'blocks' in doc ? JSON.stringify(doc) : ''}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => sort === 'topic' ? a.topic.localeCompare(b.topic) : sort === 'title' ? a.title.localeCompare(b.title) : sort === 'length' ? (a.wordCount || 0) - (b.wordCount || 0) : sort === 'color' ? color(a.topic) - color(b.topic) : b.updatedAt - a.updatedAt), [documents, found, search, topic, filter, sort]);
  return <div className={s.shelf}>
    <header className={s.shelfHead}><div><h1>你的书架</h1><p>好问题，从读到的那一行开始。</p></div><Button variant="solid" icon={<Plus size={16} />} onClick={onAdd}>添加阅读</Button></header>
    {documents.length === 0 ? <div className={s.empty}>
      <h2>划下有疑问的一句，<br /><em>让答案留在页边。</em></h2>
      <p>文章、论文、PDF，和你一直想读的长文。</p>
      <Button variant="solid" onClick={onAdd}>粘贴链接或导入文件</Button><Button variant="ghost" onClick={onSample}>先读一篇示例</Button>
    </div> : <>
      <div className={s.shelfTools}>
        <label className={s.search}><Search size={16} /><input aria-label="搜索书架" placeholder="搜索文章、笔记和高亮…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="筛选阅读" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">所有阅读</option><option value="reading">阅读中</option><option value="favorite">收藏</option><option value="done">已读</option><option value="short">短读 · 10 分钟内</option><option value="long">长读 · 45 分钟以上</option><option value="agent">Agent 添加</option><option value="trash">回收站</option></select>
        <select aria-label="书架排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最近阅读</option><option value="topic">按主题</option><option value="color">按颜色</option><option value="length">按篇幅</option><option value="title">按标题</option></select>
        <IconButton label={grid ? '切换列表' : '切换书架'} onClick={() => setGrid(!grid)}>{grid ? <List size={18} /> : <LayoutGrid size={18} />}</IconButton>
      </div>
      <div className={s.topics} role="group" aria-label="阅读主题"><button type="button" data-active={topic === 'all'} onClick={() => setTopic('all')}>全部 <span>{active.length}</span></button>{Object.entries(TOPICS).filter(([key]) => active.some((doc) => doc.topic === key)).map(([key, label]) => <button type="button" key={key} data-active={topic === key} onClick={() => setTopic(key)}>{label} <span>{active.filter((doc) => doc.topic === key).length}</span></button>)}</div>
      <div className={grid ? s.bookcase : s.list}>
        {results.map((doc) => <div key={doc.id} className={s.bookWrap}>
          <button type="button" className={s.book} data-color={color(doc.topic)} onClick={() => onOpen(doc.id)} aria-label={`阅读 ${doc.title}`}>
            <div className={s.cover}>{doc.cover ? <img src={doc.cover} alt="" /> : <><span className={s.coverTopic}>{TOPICS[doc.topic] || '阅读'}</span><strong>{doc.title}</strong><span className={s.coverAuthor}>{doc.author || '阅读 · 批注 · 思考'}</span><span className={s.coverLine} /></>}</div>
            <div className={s.bookInfo}><strong>{doc.title}</strong><span>{doc.favorite && <Star size={12} fill="currentColor" />}{doc.agent ? 'Agent 添加 · ' : ''}{doc.progress >= 0.95 ? '已读' : `${Math.round(doc.progress * 100)}%`}{doc.tags.length ? ` · ${doc.tags.slice(0, 2).join(' / ')}` : ''}</span></div>
          </button>{doc.deleted && <Button size="sm" variant="ghost" onClick={() => onRestore(doc.id)}>恢复到书架</Button>}
        </div>)}
      </div>
      {!results.length && <p className={s.hint}>没有匹配的阅读，试试其他关键词或主题。</p>}
    </>}
    <footer className={s.shelfFooter}><Button variant="ghost" icon={<BookOpen size={15} />} onClick={onReview}>每日回顾</Button><Button variant="ghost" icon={<Download size={15} />} onClick={onExport}>导出所有笔记</Button><Button variant="ghost" onClick={onConnect}>连接 Agent</Button><Button variant="ghost" onClick={onSample}>经典阅读与示例</Button>{documents.some((d) => d.deleted) && <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setFilter('trash')}>回收站</Button>}</footer>
  </div>;
}
function color(topic: string) { return Math.max(0, Object.keys(TOPICS).indexOf(topic)) % 8; }
