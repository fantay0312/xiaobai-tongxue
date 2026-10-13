import { useState, type FormEvent } from 'react';
import {
  ArrowRight, BookOpen, ChevronRight, ClipboardList, FileText, FolderOpen, GraduationCap, Image, Layers, Library, Mic, Network,
  NotebookText, Plus, Presentation, Search, StickyNote, Table2, Trash2, Users, Video, X, type LucideIcon,
} from 'lucide-react';
import { Button, Empty, IconButton, Input, Textarea } from '../../components/ui';
import type { NotebookSource } from '../../engine/notebookSources';
import { STUDIO_LABELS, type StudyArtifact, type StudioKind } from '../../engine/studyStudio';
import n from './notebook.module.css';

export type StudioToolId = StudioKind | 'guided' | 'read' | 'practice' | 'cards';

const STUDIO_TOOLS: { id: StudioToolId; title: string; icon: LucideIcon; description: string }[] = [
  { id: 'guided', title: '带我学', icon: GraduationCap, description: '概念、例子、自测、反思' },
  { id: 'mindmap', title: '思维导图', icon: Network, description: '梳理章节之间的关系' },
  { id: 'report', title: '学习报告', icon: FileText, description: '摘要与出处放在一起' },
  { id: 'slides', title: '演示课件', icon: Presentation, description: '分页讲解，可导出' },
  { id: 'cards', title: '闪卡', icon: Layers, description: '先回忆，再翻面核对' },
  { id: 'practice', title: '自测练习', icon: ClipboardList, description: '找到还没懂的地方' },
  { id: 'table', title: '资料表格', icon: Table2, description: '并排比较要点与来源' },
  { id: 'infographic', title: '知识信息图', icon: Image, description: '把长材料整理成一张图' },
  { id: 'audio', title: '语音导读', icon: Mic, description: '用浏览器朗读要点' },
  { id: 'video', title: '字幕视频', icon: Video, description: '无配音的字幕视频' },
];

const SOURCE_KIND: Record<string, { label: string; icon: LucideIcon }> = {
  asset: { label: '原文件摘录', icon: FileText },
  library: { label: '资料库文件', icon: FileText },
  text: { label: '补充文本', icon: StickyNote },
  example: { label: '课程例子', icon: BookOpen },
};
const LECTURE_KIND = { label: '课程讲义', icon: BookOpen };

export function SourcesPanel({ sources, selected, onSelect, onPreview, onAdd, onLibrary, onDelete, onPickLibrary }: {
  sources: NotebookSource[]; selected: NotebookSource[]; onSelect: (ids: string[]) => void; onPreview: (source: NotebookSource) => void;
  onAdd: (title: string, content: string) => void; onLibrary: () => void; onDelete: (id: string) => void;
  onPickLibrary?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [search, setSearch] = useState('');
  const selectedIds = new Set(selected.map((item) => item.id));
  const all = sources.length > 0 && selected.length === sources.length;

  const submitText = () => {
    if (!content.trim()) return;
    onAdd(title.trim() || '补充资料', content.trim());
    setContent('');
    setTitle('');
    setAdding(false);
  };
  const searchWeb = (event: FormEvent) => {
    event.preventDefault();
    if (search.trim()) window.open(`https://cn.bing.com/search?q=${encodeURIComponent(search.trim())}`, '_blank', 'noopener,noreferrer');
  };
  const toggle = (id: string, checked: boolean) => onSelect(
    checked ? [...selected.map((item) => item.id), id] : selected.filter((item) => item.id !== id).map((item) => item.id),
  );

  return (
    <div className={n.panelBody}>
      <div className={n.addRow}>
        {onPickLibrary && (
          <Button variant="soft" block icon={<FolderOpen size={16} strokeWidth={1.75} />} onClick={onPickLibrary}>
            从资料库选择
          </Button>
        )}
        <Button variant="soft" block aria-expanded={adding} icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setAdding((value) => !value)}>
          补充文字
        </Button>
      </div>

      {adding && (
        <div className={n.sourceForm}>
          <Input size="sm" aria-label="资料标题" value={title} maxLength={120} placeholder="资料标题" onChange={(event) => setTitle(event.target.value)} />
          <Textarea aria-label="补充资料正文" value={content} maxLength={16000} rows={5} placeholder="粘贴笔记、网页正文或字幕…" onChange={(event) => setContent(event.target.value)} />
          <div className={n.formActions}>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>取消</Button>
            <Button variant="solid" size="sm" onClick={submitText}>加入当前学习</Button>
          </div>
        </div>
      )}

      <form className={n.webSearch} onSubmit={searchWeb}>
        <Input
          size="sm"
          aria-label="网页检索关键词"
          value={search}
          maxLength={200}
          placeholder="搜索网页资料，选好后粘贴正文"
          leading={<Search size={15} strokeWidth={1.75} />}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search.trim() && (
          <IconButton type="submit" label="在新页面搜索" variant="soft" tip="left">
            <ArrowRight size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </form>

      {sources.length > 0 ? (
        <>
          <div className={n.selectionBar}>
            <span>已选 {selected.length} / {sources.length} 份</span>
            <label>
              全选
              <input type="checkbox" className={n.check} checked={all} onChange={() => onSelect(all ? [] : sources.map((source) => source.id))} />
            </label>
          </div>
          <ul className={n.sourceList}>
            {sources.map((source) => {
              const kind = SOURCE_KIND[source.kind] ?? LECTURE_KIND;
              const checked = selectedIds.has(source.id);
              return (
                <li key={source.id} className={n.sourceRow} data-selected={checked || undefined}>
                  <span className={n.sourceIcon}><kind.icon size={16} strokeWidth={1.75} /></span>
                  <button type="button" className={n.sourceTitle} title={`查看正文：${source.title}`} onClick={() => onPreview(source)}>
                    <span>{source.title}</span>
                    <small>{kind.label}</small>
                  </button>
                  {source.kind === 'text' && (
                    <IconButton label={`移除资料：${source.title}`} size="sm" tip="left" className={n.rowAction} onClick={() => onDelete(source.id)}>
                      <X size={14} strokeWidth={1.75} />
                    </IconButton>
                  )}
                  <input type="checkbox" className={n.check} aria-label={`使用资料：${source.title}`} checked={checked} onChange={(event) => toggle(source.id, event.target.checked)} />
                </li>
              );
            })}
          </ul>
          <p className={n.footnote}>勾选的资料供本轮学习使用。点标题查看正文；文件项展示已解析的摘录。</p>
        </>
      ) : (
        <Empty
          icon={<Library size={22} strokeWidth={1.75} />}
          title="还没有资料"
          description="加入讲义、课件或一段文字，小砚就能依据它回答和整理。"
          action={<Button variant="soft" size="sm" onClick={onLibrary}>打开资料库</Button>}
        />
      )}

      {sources.length > 0 && (
        <button type="button" className={n.inlineLink} onClick={onLibrary}>
          在资料库管理文件
          <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

export function StudioPanel({ artifacts, onCreate, onOpen, onDelete, onNote, busy, sourceCount, activeView, onRead, onPrepare, onSources, canPrepare = true }: {
  artifacts: StudyArtifact[]; onCreate: (kind: StudioToolId) => void; onOpen: (id: string) => void; onDelete: (id: string) => void;
  onNote: () => void; busy: boolean; sourceCount: number; activeView: string; onRead: () => void; onPrepare: () => void;
  /** 没有勾选资料时，引导去选资料 */
  onSources: () => void;
  canPrepare?: boolean;
}) {
  return (
    <div className={n.panelBody}>
      {sourceCount > 0 ? (
        <>
          <button type="button" className={n.readRow} onClick={onRead}>
            <BookOpen size={16} strokeWidth={1.75} />
            <span>阅读所选的 {sourceCount} 份资料</span>
            <ChevronRight size={15} strokeWidth={1.75} />
          </button>
          <h3 className={n.sectionTitle}>用所选资料创建</h3>
          <div className={n.toolGrid}>
            {STUDIO_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={n.tool}
                aria-pressed={activeView === tool.id}
                aria-busy={busy || undefined}
                onClick={() => { if (!busy) onCreate(tool.id); }}
              >
                <span className={n.toolIcon}><tool.icon size={17} strokeWidth={1.75} /></span>
                <strong>{tool.title}</strong>
                <small>{tool.description}</small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Empty
          icon={<Library size={22} strokeWidth={1.75} />}
          title="先选好资料"
          description="导图、课件、闪卡都依据你勾选的资料生成。"
          action={<Button variant="solid" size="sm" onClick={onSources}>选择资料</Button>}
        />
      )}

      <h3 className={n.sectionTitle}>
        已保存的产物
        {artifacts.length > 0 && <span>{artifacts.length}</span>}
      </h3>
      {artifacts.length > 0 ? (
        <ul className={n.artifactList}>
          {[...artifacts].reverse().map((artifact) => {
            const ArtifactIcon = STUDIO_TOOLS.find((tool) => tool.id === artifact.kind)?.icon ?? FileText;
            return (
              <li key={artifact.id}>
                <button type="button" className={n.artifactItem} onClick={() => onOpen(artifact.id)}>
                  <span className={n.sourceIcon}><ArtifactIcon size={16} strokeWidth={1.75} /></span>
                  <span className={n.artifactText}>
                    <span>{artifact.title}</span>
                    <small>{STUDIO_LABELS[artifact.kind]} · {artifact.sources.length} 份来源 · {artifact.method === 'model' ? '小砚整理' : '资料摘编'}</small>
                  </span>
                </button>
                <IconButton label={`删除产物：${artifact.title}`} size="sm" tip="left" className={n.rowAction} onClick={() => onDelete(artifact.id)}>
                  <Trash2 size={14} strokeWidth={1.75} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={n.footnote}>第一次整理后，报告、导图和课件会收在这里。</p>
      )}

      <div className={n.panelFooter}>
        <Button variant="soft" size="sm" icon={<NotebookText size={15} strokeWidth={1.75} />} onClick={onNote}>学习便笺</Button>
        {canPrepare && (
          <Button variant="soft" size="sm" icon={<Users size={15} strokeWidth={1.75} />} onClick={onPrepare}>备课与回讲</Button>
        )}
      </div>
    </div>
  );
}
