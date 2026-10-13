import { useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import type { NotebookSource } from '../../engine/notebookSources';
import { STUDIO_LABELS, type StudyArtifact, type StudioKind } from '../../engine/studyStudio';
import type { IconName } from '../../components/ui/Icon';
import n from './notebook.module.css';

const STUDIO_TOOLS: { id: StudioKind | 'guided' | 'read' | 'practice' | 'cards'; title: string; icon: IconName; color: string; description: string }[] = [
  { id: 'audio', title: '语音导读', icon: 'mic', color: 'blue', description: '听一遍资料要点' },
  { id: 'slides', title: '演示课件', icon: 'presentation', color: 'pink', description: '分页讲解，可导出' },
  { id: 'video', title: '视频导读', icon: 'play', color: 'green', description: '生成无声字幕视频' },
  { id: 'mindmap', title: '思维导图', icon: 'route', color: 'violet', description: '梳理材料章节关系' },
  { id: 'report', title: '学习报告', icon: 'file', color: 'pink', description: '摘要与出处放在一起' },
  { id: 'cards', title: '闪卡', icon: 'library', color: 'orange', description: '回忆，再翻面核对' },
  { id: 'practice', title: '自测练习', icon: 'clipboard', color: 'cyan', description: '找到还没懂的地方' },
  { id: 'infographic', title: '知识信息图', icon: 'image', color: 'orange', description: '把长材料整理成图' },
  { id: 'table', title: '资料表格', icon: 'clipboard', color: 'blue', description: '并排比较要点与来源' },
  { id: 'guided', title: '带我学', icon: 'graduation', color: 'violet', description: '概念、例子、自测、反思' },
];

export function SourcesPanel({ sources, selected, onSelect, onPreview, onAdd, onLibrary, onDelete, onPickLibrary }: {
  sources: NotebookSource[]; selected: NotebookSource[]; onSelect: (ids: string[]) => void; onPreview: (source: NotebookSource) => void;
  onAdd: (title: string, content: string) => void; onLibrary: () => void; onDelete: (id: string) => void;
  onPickLibrary?: () => void;
}) {
  const [adding, setAdding] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [search, setSearch] = useState('');
  const all = sources.length > 0 && selected.length === sources.length;
  return <div className={n.sourcesBody}>
    {onPickLibrary && <button className={n.addSource} onClick={onPickLibrary}><Icon name="files" size={18} />从资料库选择</button>}
    <button className={n.addSource} onClick={() => setAdding((value) => !value)} aria-expanded={adding}><Icon name="plus" size={18} />补充文字</button>
    {adding && <div className={n.sourceForm}>
      <input aria-label="资料标题" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="资料标题" />
      <textarea aria-label="补充资料正文" value={content} onChange={(event) => setContent(event.target.value)} maxLength={16000} rows={5} placeholder="粘贴笔记、网页正文或字幕…" />
      <button disabled={!content.trim()} onClick={() => { onAdd(title.trim() || '补充资料', content.trim()); setContent(''); setTitle(''); setAdding(false); }}>加入当前学习</button>
      <button onClick={onLibrary}>打开资料库管理文件<Icon name="arrow-right" size={14} /></button>
    </div>}
    <form className={n.webSearch} onSubmit={(event) => { event.preventDefault(); if (search.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(search.trim())}`, '_blank', 'noopener,noreferrer'); }}><label>查找网页资料<input aria-label="网页检索关键词" value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} placeholder="输入主题或关键词" /></label><button type="submit" aria-label="在浏览器搜索网页" title="在新页面搜索，选好后可粘贴正文加入资料" disabled={!search.trim()}><Icon name="arrow-right" size={17} /></button></form>
    <div className={n.sourceSelection}><span>{selected.length} / {sources.length} 份已选</span><label>全选<input type="checkbox" checked={all} onChange={() => onSelect(all ? [] : sources.map((source) => source.id))} /></label></div>
    <div className={n.sourceList}>{sources.map((source) => <div className={n.sourceRow} key={source.id} data-selected={selected.some((item) => item.id === source.id) || undefined}>
      <Icon name={source.kind === 'asset' ? 'file' : source.kind === 'text' ? 'notebook' : 'book-open'} size={18} />
      <button className={n.sourceTitle} onClick={() => onPreview(source)} title={source.title}>{source.title}<small>{source.kind === 'asset' ? '原文件摘录' : source.kind === 'text' ? '补充文本' : source.kind === 'example' ? '课程例子' : '课程讲义'}</small></button>
      <input type="checkbox" aria-label={`使用资料：${source.title}`} checked={selected.some((item) => item.id === source.id)} onChange={(event) => onSelect(event.target.checked ? [...selected.map((item) => item.id), source.id] : selected.filter((item) => item.id !== source.id).map((item) => item.id))} />
      {source.kind === 'text' && <button className={n.removeSource} title="移除此课补充文本" aria-label={`移除资料：${source.title}`} onClick={() => onDelete(source.id)}><Icon name="x" size={12} /></button>}
    </div>)}</div>
    {!sources.length && <p className={n.quiet}>加入资料后，就能围绕它提问和整理内容。</p>}
    <p className={n.sourceFootnote}>勾选的资料供本轮学习使用。点击标题查看正文；文件项展示已解析摘录。</p>
  </div>;
}

export function StudioPanel({ artifacts, onCreate, onOpen, onDelete, onNote, busy, sourceCount, activeView, onRead, onPrepare, canPrepare = true }: {
  artifacts: StudyArtifact[]; onCreate: (kind: typeof STUDIO_TOOLS[number]['id']) => void; onOpen: (id: string) => void; onDelete: (id: string) => void;
  onNote: () => void; busy: boolean; sourceCount: number; activeView: string; onRead: () => void; onPrepare: () => void; canPrepare?: boolean;
}) {
  return <div className={n.studioBody}>
    <div className={n.studioIntro}><strong>创建学习内容</strong><p>围绕当前项目中勾选的资料。</p><button onClick={onRead}><Icon name="book-open" size={15} />阅读所选资料<Icon name="arrow-right" size={14} /></button></div>
    <div className={n.studioGrid}>{STUDIO_TOOLS.map((tool) => <button key={tool.id} title={tool.description} data-color={tool.color} aria-pressed={activeView === tool.id} onClick={() => onCreate(tool.id)} disabled={busy || sourceCount === 0}><Icon name={tool.icon} size={21} /><span>{tool.title}</span></button>)}</div>
    {sourceCount === 0 && <p className={n.quiet}>先在左侧勾选资料。</p>}
    <div className={n.savedHeading}><h3>已保存的产物</h3><span>{artifacts.length}</span></div>
    {!artifacts.length && <p className={n.quiet}>第一次整理后，报告、导图和课件会收在这里。</p>}
    <div className={n.artifactList}>{[...artifacts].reverse().map((artifact) => <div key={artifact.id}><button onClick={() => onOpen(artifact.id)}><Icon name={STUDIO_TOOLS.find((tool) => tool.id === artifact.kind)?.icon ?? 'file'} size={19} /><span>{artifact.title}<small>{STUDIO_LABELS[artifact.kind]} · {artifact.sources.length} 份来源 · {artifact.method === 'model' ? 'AI 整理' : '资料摘编'}</small></span><Icon name="chevron-right" size={13} /></button><button aria-label={`删除产物：${artifact.title}`} onClick={() => onDelete(artifact.id)}><Icon name="trash" size={13} /></button></div>)}</div>
    <div className={n.studioFooter}><button onClick={onNote}><Icon name="notebook" size={17} />学习便笺</button>{canPrepare && <button onClick={onPrepare}>备课与回讲<Icon name="arrow-right" size={14} /></button>}</div>
  </div>;
}
