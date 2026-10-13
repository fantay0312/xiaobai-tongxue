import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Bold, Check, Code, Columns2, Download, Eye, Heading2, Italic, List, ListChecks, MessageCircleQuestion, Plus, Quote, Sigma,
  Sparkles, SquarePen, X,
} from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Button, IconButton, MenuItem, Segmented, toast } from '../../../../components/ui';
import { studyData, useStudyData, type StudyNote } from '../../../../store/studyData';
import { DetailHead, GenerateDialog, ICON_SM, OriginBadge, SplitLayout, ToolHead, removeWithUndo, type Entry, type ToolProps } from './shared';
import { ago, clip, countWords, download, safeName, useAutosave, useWorkbenchNav } from './util';
import s from './workbench.module.css';
import n from './notes.module.css';

type Mode = 'edit' | 'split' | 'preview';
type Mark = 'bold' | 'italic' | 'heading' | 'list' | 'todo' | 'quote' | 'code' | 'math';

const exportNote = (note: Pick<StudyNote, 'title' | 'body'>) => {
  const body = /^#\s/.test(note.body.trimStart()) ? note.body : `# ${note.title || '未命名笔记'}\n\n${note.body}`;
  download(`${safeName(note.title)}.md`, body, 'text/markdown');
};

export default function NotesTool(props: ToolProps) {
  const { owner, topic, activeId, onAsk } = props;
  const { go } = useWorkbenchNav();
  const { notes } = useStudyData(owner);
  const [genOpen, setGenOpen] = useState(false);
  // 详情栏够宽才默认分栏；窄的时候先看排好版的预览，新建时再切到编辑
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.innerWidth < 1320 ? 'preview' : 'split'));

  const entries = useMemo<Entry[]>(() => [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((note) => ({
      id: note.id,
      title: note.title,
      origin: note.origin,
      topicId: note.topicId,
      text: `${note.body} ${note.tags.join(' ')}`,
      meta: <>{ago(note.updatedAt)} · {countWords(note.body)} 字{note.tags.length > 0 && ` · ${note.tags.slice(0, 2).join(' ')}`}</>,
    })), [notes]);

  const create = () => {
    const note = studyData.saveNote(owner, { title: '', body: '', ...(topic ? { topicId: topic.topicId } : {}) });
    setMode((current) => (current === 'preview' ? 'edit' : current));
    go('notes', note.id);
  };
  const remove = (id: string) => {
    const note = notes.find((item) => item.id === id);
    if (!note) return;
    removeWithUndo(note.title, () => studyData.removeNote(owner, id), () => studyData.saveNote(owner, note));
    if (activeId === id) go('notes', null, true);
  };

  return (
    <>
      <ToolHead tool="notes">
        <Button variant="soft" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>AI 生成</Button>
        <Button variant="outline" icon={<Plus {...ICON_SM} />} onClick={create}>新建笔记</Button>
      </ToolHead>
      <SplitLayout
        tool="notes"
        entries={entries}
        activeId={activeId}
        topic={topic}
        empty={{
          title: '还没有笔记',
          description: '边学边记，支持 Markdown、公式和代码。也可以让小砚把本课整理成一篇要点笔记。',
          action: (
            <>
              <Button variant="solid" icon={<Plus {...ICON_SM} />} onClick={create}>写第一篇笔记</Button>
              <Button variant="soft" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>AI 生成</Button>
            </>
          ),
        }}
        onRename={(id, title) => {
          const note = notes.find((item) => item.id === id);
          if (note) studyData.saveNote(owner, { ...note, title });
        }}
        onDelete={remove}
        menu={(id) => {
          const note = notes.find((item) => item.id === id);
          return note ? <MenuItem icon={<Download {...ICON_SM} />} onSelect={() => exportNote(note)}>导出 Markdown</MenuItem> : null;
        }}
      >
        {(id) => {
          const note = notes.find((item) => item.id === id);
          return note ? <NoteEditor key={note.id} note={note} owner={owner} mode={mode} onMode={setMode} onAsk={onAsk} /> : null;
        }}
      </SplitLayout>
      <GenerateDialog kind="note" open={genOpen} onOpenChange={setGenOpen} view={props} onCreated={(created) => { setMode('preview'); go('notes', created.id); }} />
    </>
  );
}

function NoteEditor({ note, owner, mode, onMode, onAsk }: {
  note: StudyNote;
  owner: string | null;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onAsk: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(note.tags);
  const [tagText, setTagText] = useState('');
  const [dirty, setDirty] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const draft = useMemo(() => ({ title, body, tags }), [title, body, tags]);

  const save = useCallback((value: typeof draft) => {
    // 已删除的笔记不写回
    if (!studyData.get(owner).notes.some((item) => item.id === note.id)) return;
    studyData.saveNote(owner, { id: note.id, ...value });
    setDirty(false);
  }, [owner, note.id]);
  useAutosave(draft, dirty, save);

  // 助理任务等从外部改了这篇笔记，而我这边没有未保存的改动时，跟上外部内容
  useEffect(() => {
    if (dirty) return;
    setTitle(note.title);
    setBody(note.body);
    setTags(note.tags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.updatedAt]);

  const edit = (next: string) => { setBody(next); setDirty(true); };

  const apply = (mark: Mark) => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const selected = value.slice(a, b);
    let next = value;
    let from = a;
    let to = b;
    const wrap = (left: string, right: string, placeholder: string) => {
      const inner = selected || placeholder;
      next = value.slice(0, a) + left + inner + right + value.slice(b);
      from = a + left.length;
      to = from + inner.length;
    };
    const prefix = (lead: string) => {
      const start = value.lastIndexOf('\n', a - 1) + 1;
      const block = value.slice(start, b);
      const replaced = block.split('\n').map((line) => lead + line).join('\n');
      next = value.slice(0, start) + replaced + value.slice(b);
      from = a + lead.length;
      to = b + replaced.length - block.length;
    };
    if (mark === 'bold') wrap('**', '**', '重点');
    else if (mark === 'italic') wrap('*', '*', '强调');
    else if (mark === 'code' && selected.includes('\n')) wrap('```\n', '\n```', '');
    else if (mark === 'code') wrap('`', '`', 'code');
    else if (mark === 'math') wrap('$', '$', 'x^2');
    else if (mark === 'heading') prefix('## ');
    else if (mark === 'list') prefix('- ');
    else if (mark === 'todo') prefix('- [ ] ');
    else prefix('> ');
    edit(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(from, to); });
  };

  const onAreaKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'b') { event.preventDefault(); apply('bold'); }
    else if (mod && event.key.toLowerCase() === 'i') { event.preventDefault(); apply('italic'); }
    else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const el = event.currentTarget;
      const at = el.selectionStart;
      edit(`${el.value.slice(0, at)}  ${el.value.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
    }
  };

  const addTag = () => {
    const tag = tagText.trim().replace(/^#/, '').slice(0, 16);
    setTagText('');
    if (!tag || tags.includes(tag)) return;
    setTags([...tags, tag].slice(0, 8));
    setDirty(true);
  };

  const ask = () => {
    const el = areaRef.current;
    const picked = window.getSelection();
    const fromPreview = picked && rootRef.current?.contains(picked.anchorNode) ? picked.toString().trim() : '';
    const fromArea = el && el.selectionEnd > el.selectionStart ? body.slice(el.selectionStart, el.selectionEnd).trim() : '';
    const selected = fromArea || fromPreview;
    const quote = clip((selected || body).trim(), 1500);
    if (!quote) { toast('先写一点内容，再来问小砚'); return; }
    const lead = selected ? '请讲讲我笔记里的这一段，哪里理解得不对请指出来' : `请帮我检查笔记《${title || '未命名笔记'}》有没有讲错或漏掉的地方`;
    onAsk(`${lead}：\n\n${quote.split('\n').map((line) => `> ${line}`).join('\n')}`);
  };

  const tools: { mark: Mark; label: string; icon: typeof Bold; shortcut?: string }[] = [
    { mark: 'heading', label: '小标题', icon: Heading2 },
    { mark: 'bold', label: '加粗', icon: Bold, shortcut: '⌘B' },
    { mark: 'italic', label: '强调', icon: Italic, shortcut: '⌘I' },
    { mark: 'list', label: '列表', icon: List },
    { mark: 'todo', label: '待核对项', icon: ListChecks },
    { mark: 'quote', label: '引用', icon: Quote },
    { mark: 'code', label: '代码', icon: Code },
    { mark: 'math', label: '公式', icon: Sigma },
  ];

  return (
    <div className={`${s.card} ${n.editor}`} ref={rootRef}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<OriginBadge origin={note.origin} />}>
        <Button variant="ghost" size="sm" icon={<MessageCircleQuestion {...ICON_SM} />} onClick={ask}>问小砚</Button>
        <IconButton label="导出 Markdown" size="sm" onClick={() => exportNote({ title, body })}><Download {...ICON_SM} /></IconButton>
      </DetailHead>

      <div className={n.tags}>
        {tags.map((tag) => (
          <span key={tag} className={n.tag}>
            {tag}
            <button type="button" aria-label={`移除标签 ${tag}`} onClick={() => { setTags(tags.filter((item) => item !== tag)); setDirty(true); }}>
              <X size={12} strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          className={n.tagInput}
          value={tagText}
          placeholder={tags.length ? '添加标签' : '添加标签，回车确认'}
          aria-label="添加标签"
          onChange={(event) => setTagText(event.target.value)}
          onBlur={addTag}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') { event.preventDefault(); addTag(); }
            if (event.key === 'Backspace' && !tagText && tags.length) { setTags(tags.slice(0, -1)); setDirty(true); }
          }}
        />
      </div>

      <div className={n.bar}>
        <div className={n.marks} data-off={mode === 'preview'}>
          {tools.map(({ mark, label, icon: Icon, shortcut }) => (
            <IconButton key={mark} label={label} shortcut={shortcut} size="sm" disabled={mode === 'preview'} onClick={() => apply(mark)}>
              <Icon {...ICON_SM} />
            </IconButton>
          ))}
        </div>
        <span className={s.saved} aria-live="polite">
          {dirty ? '正在保存…' : <><Check size={13} strokeWidth={2} />已保存</>}
          <span className={n.count}> · {countWords(body)} 字</span>
        </span>
        <Segmented
          size="sm"
          label="视图"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'edit', label: '编辑', icon: <SquarePen {...ICON_SM} /> },
            { value: 'split', label: '分栏', icon: <Columns2 {...ICON_SM} /> },
            { value: 'preview', label: '预览', icon: <Eye {...ICON_SM} /> },
          ]}
        />
      </div>

      <div className={n.body} data-mode={mode}>
        {mode !== 'preview' && (
          <textarea
            ref={areaRef}
            className={n.area}
            value={body}
            spellCheck={false}
            placeholder={'在这里写笔记。支持 Markdown：\n\n## 小标题\n- 要点\n**重点**、`代码`、公式 $E = mc^2$'}
            aria-label="笔记正文"
            onChange={(event) => edit(event.target.value)}
            onKeyDown={onAreaKey}
          />
        )}
        {mode !== 'edit' && (
          <div className={`${n.preview} ${s.prose}`}>
            {body.trim() ? <CoachMarkdown text={body} /> : <p className={n.previewEmpty}>写下的内容会在这里排好版。</p>}
          </div>
        )}
      </div>
    </div>
  );
}
