import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, Bot, Ellipsis, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  Badge, Button, Dialog, Empty, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
  Segmented, Shimmer, Skeleton, Textarea, cx, toast,
} from '../../../../components/ui';
import { IconFlashcard, IconMindmap, IconNote, IconQuiz, IconTodo, IconWorkbench, IconWriting, type XbIconProps, IconSpark } from '../../../../components/ui/icons';
import { useStudyData, type Origin, type QuestionType } from '../../../../store/studyData';
import type { TerminalViewProps } from '../types';
import { createFromAI, errorText, isAbort, type Created, type GenKind } from './actions';
import { QUESTION_TYPES, hasMaterial } from './generate';
import { CREATE_LABEL, GEN_OF, createItem, itemMenu, listEntries, removeItem, renameItem, type Entry, type ListTool } from './registry';
import { clip, matches, useWorkbenchNav, TOOL_IDS, type ToolId } from './util';
import s from './workbench.module.css';

export const ICON = { size: 17, strokeWidth: 1.75 } as const;
export const ICON_SM = { size: 15, strokeWidth: 1.75 } as const;

/** 工具图标用产品自己的那一套（components/ui/icons） */
export const TOOLS: Record<ToolId, { name: string; hint: string; icon: ComponentType<XbIconProps> }> = {
  notes: { name: '笔记', hint: '用 Markdown 记下要点，随写随存', icon: IconNote },
  mindmap: { name: '思维导图', hint: '把一课的结构理成一张图', icon: IconMindmap },
  quiz: { name: '题目集', hint: '做题、看解析、攒错题本', icon: IconQuiz },
  flashcards: { name: '闪卡', hint: '按遗忘规律安排复习', icon: IconFlashcard },
  todos: { name: '待办', hint: '把今天要学的事列出来', icon: IconTodo },
  writing: { name: '作文与翻译', hint: '写完就批改，对照着改进', icon: IconWriting },
};

/** 工具组件的入参：终端视图入参 + 选中的条目 + 导航在不在侧栏 */
export interface ToolProps extends TerminalViewProps {
  activeId: string | null;
  /** 终端侧栏有挂载位：工具切换与条目列表都在侧栏，主区只放编辑器 */
  sideNav: boolean;
  onGenerate: (kind: GenKind) => void;
  /** 待办的输入框，侧栏「新建待办」用它聚焦 */
  todoInputRef?: RefObject<HTMLInputElement | null>;
}

/** 条目来源：助理任务写入、从对话保存的才标出来 */
export function OriginBadge({ origin }: { origin: Origin }) {
  if (origin === 'agent') return <Badge tone="accent" title="由助理任务写入"><Bot size={11} strokeWidth={2} />助理</Badge>;
  if (origin === 'chat') return <Badge title="从对话保存"><MessageSquare size={11} strokeWidth={2} />对话</Badge>;
  return null;
}

/* ── 主区里的工具导航：只在没有侧栏挂载位（手机、侧栏收起）时出现 ── */
export function WorkbenchNav({ tool, counts, onGo }: { tool: ToolId | null; counts: Record<ToolId, number>; onGo: (tool: ToolId | null) => void }) {
  const ref = useRef<HTMLElement>(null);
  // 横向滚动的一排：换工具后把当前项挪到中间，后面的工具不会藏在屏幕外
  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2 });
  }, [tool]);
  return (
    <nav ref={ref} className={s.nav} aria-label="学习工作台">
      <button type="button" className={s.navItem} aria-current={tool === null ? 'page' : undefined} onClick={() => onGo(null)}>
        <IconWorkbench size={16} active={tool === null} />概览
      </button>
      <span className={s.navSep} aria-hidden="true" />
      {TOOL_IDS.map((id) => {
        const Icon = TOOLS[id].icon;
        return (
          <button key={id} type="button" className={s.navItem} aria-current={tool === id ? 'page' : undefined} onClick={() => onGo(id)}>
            <Icon size={16} active={tool === id} />{TOOLS[id].name}
            {counts[id] > 0 && <span className={s.navCount}>{counts[id]}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** detail：窄屏上正在看某个条目时收起这一行，把高度让给内容（返回钮在详情头里） */
export function ToolHead({ tool, detail, children }: { tool: ToolId; detail?: boolean; children?: ReactNode }) {
  return (
    <div className={s.toolHead} data-detail={detail || undefined}>
      <div className={s.toolTitle}>
        <h2>{TOOLS[tool].name}</h2>
        <p>{TOOLS[tool].hint}</p>
      </div>
      <div className={s.toolActions}>{children}</div>
    </div>
  );
}

/* ── 列表-详情 ── */
interface SplitCtx { inSplit: boolean; collapsed: boolean; toggleList: () => void; backToList: () => void }
const SplitContext = createContext<SplitCtx>({ inSplit: false, collapsed: false, toggleList: () => {}, backToList: () => {} });

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, []);
  const finish = (title: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(title);
  };
  return (
    <input
      ref={ref}
      className={s.renameInput}
      value={value}
      aria-label="重命名"
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value.trim());
        if (event.key === 'Escape') finish(null);
      }}
    />
  );
}

/** 主区里的「列表-详情」：没有侧栏挂载位时的备用导航 */
function SplitLayout({ tool, owner, entries, activeId, topic, children }: {
  tool: ListTool;
  owner: string | null;
  entries: Entry[];
  activeId: string | null;
  topic?: TerminalViewProps['topic'];
  children: (id: string) => ReactNode;
}) {
  const { go } = useWorkbenchNav();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'course'>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { name } = TOOLS[tool];

  const shown = useMemo(
    () => entries.filter((entry) => (scope === 'all' || !topic || entry.topicId === topic.topicId) && matches(query, entry.title, entry.text)),
    [entries, scope, topic, query],
  );
  const picked = activeId !== null && entries.some((entry) => entry.id === activeId);
  const currentId = picked ? activeId : shown[0]?.id ?? null;
  const ctx = useMemo<SplitCtx>(() => ({
    inSplit: true,
    collapsed,
    toggleList: () => setCollapsed((value) => !value),
    backToList: () => go(tool, null),
  }), [collapsed, go, tool]);

  const remove = (id: string) => {
    removeItem(tool, owner, id);
    if (activeId === id) go(tool, null, true);
  };

  return (
    <SplitContext.Provider value={ctx}>
      <div className={s.split} data-collapsed={collapsed} data-picked={picked}>
        <aside className={s.listPane} aria-label={`${name}列表`}>
          <div className={s.listTools}>
            <Input
              size="sm"
              leading={<Search size={15} strokeWidth={1.75} />}
              placeholder={`搜索${name}`}
              aria-label={`搜索${name}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className={s.onlyWide}>
              <IconButton label="收起列表" onClick={() => setCollapsed(true)}><PanelLeftClose {...ICON} /></IconButton>
            </span>
          </div>
          {topic && (
            <Segmented
              size="sm"
              block
              label="按课程筛选"
              value={scope}
              onChange={setScope}
              options={[{ value: 'all', label: '全部' }, { value: 'course', label: '本课', title: topic.title }]}
            />
          )}
          <div className={s.items}>
            {shown.map((entry) => (
              <div key={entry.id} className={s.item} data-active={entry.id === currentId}>
                {renaming === entry.id ? (
                  <RenameInput
                    initial={entry.title}
                    onDone={(title) => {
                      setRenaming(null);
                      if (title && title !== entry.title) renameItem(tool, owner, entry.id, title);
                    }}
                  />
                ) : (
                  <>
                    <button type="button" className={s.itemMain} onClick={() => go(tool, entry.id)} onDoubleClick={() => setRenaming(entry.id)}>
                      <span className={s.itemTitle}>
                        <span>{entry.title || '未命名'}</span>
                        <OriginBadge origin={entry.origin} />
                      </span>
                      <span className={s.itemMeta}>{entry.meta}</span>
                    </button>
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton label="更多操作" size="sm" tip={false} className={s.itemMore}><Ellipsis size={16} strokeWidth={1.75} /></IconButton>
                      </MenuTrigger>
                      <MenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                        <MenuItem icon={<Pencil {...ICON_SM} />} onSelect={() => setRenaming(entry.id)}>重命名</MenuItem>
                        {itemMenu(tool, owner, entry.id)}
                        <MenuSeparator />
                        <MenuItem danger icon={<Trash2 {...ICON_SM} />} onSelect={() => remove(entry.id)}>删除</MenuItem>
                      </MenuContent>
                    </Menu>
                  </>
                )}
              </div>
            ))}
            {!shown.length && <p className={s.listEmpty}>{query ? `没有找到「${clip(query, 12)}」` : `本课还没有${name}`}</p>}
          </div>
        </aside>
        <section className={s.detailPane}>
          {currentId ? children(currentId) : <div className={s.emptyCard}><p className={s.listEmpty}>在左侧选一项，或者新建一个。</p></div>}
        </section>
      </div>
    </SplitContext.Provider>
  );
}

/**
 * 每个「条目-详情」工具的外框。
 * 侧栏有挂载位时主区只放选中条目的编辑器（没有条目时是空状态）；
 * 没有挂载位时在主区自带标题行、新建与列表，保证手机和侧栏收起时什么都点得到。
 */
export function ToolFrame({ tool, view, empty, actions, children }: {
  tool: ListTool;
  view: ToolProps;
  empty: { title: string; description: string; primary?: 'create' | 'generate'; createLabel?: string; generateLabel?: string };
  /** 自定义标题行与空状态里的动作（作文与翻译有两种新建） */
  actions?: { head: ReactNode; empty: ReactNode };
  children: (id: string) => ReactNode;
}) {
  const { owner, topic, activeId, sideNav, onGenerate } = view;
  const { go } = useWorkbenchNav();
  const data = useStudyData(owner);
  const entries = useMemo(() => listEntries(tool, data), [tool, data]);
  const kind = GEN_OF[tool];
  const Icon = TOOLS[tool].icon;
  const create = () => go(tool, createItem(tool, owner, topic));
  const leadWithGenerate = Boolean(kind) && empty.primary === 'generate';

  const emptyCard = (
    <div className={s.emptyCard}>
      <Empty
        icon={<Icon size={22} />}
        title={empty.title}
        description={empty.description}
        action={actions?.empty ?? (
          <>
            {kind && leadWithGenerate && <Button variant="solid" icon={<IconSpark />} onClick={() => onGenerate(kind)}>{empty.generateLabel ?? 'AI 生成'}</Button>}
            <Button variant={leadWithGenerate ? 'soft' : 'solid'} icon={<Plus {...ICON_SM} />} onClick={create}>{empty.createLabel ?? CREATE_LABEL[tool]}</Button>
            {kind && !leadWithGenerate && <Button variant="soft" icon={<IconSpark />} onClick={() => onGenerate(kind)}>{empty.generateLabel ?? 'AI 生成'}</Button>}
          </>
        )}
      />
    </div>
  );

  if (sideNav) {
    if (!entries.length) return emptyCard;
    return <>{(activeId && children(activeId)) || <div className={s.emptyCard}><p className={s.listEmpty}>在侧栏里选一项，或者新建一个。</p></div>}</>;
  }

  return (
    <>
      <ToolHead tool={tool} detail={activeId !== null && entries.some((entry) => entry.id === activeId)}>
        {actions?.head ?? (
          <>
            {kind && <Button variant="soft" icon={<IconSpark />} onClick={() => onGenerate(kind)}>AI 生成</Button>}
            <Button variant="outline" icon={<Plus {...ICON_SM} />} onClick={create}>{CREATE_LABEL[tool]}</Button>
          </>
        )}
      </ToolHead>
      {entries.length
        ? <SplitLayout tool={tool} owner={owner} entries={entries} activeId={activeId} topic={tool === 'writing' ? undefined : topic}>{children}</SplitLayout>
        : emptyCard}
    </>
  );
}

/** 详情头：窄屏的返回、收起后的展开按钮、可改的标题、右侧操作 */
export function DetailHead({ title, onTitle, badges, children }: {
  title: string;
  onTitle?: (title: string) => void;
  badges?: ReactNode;
  children?: ReactNode;
}) {
  const { inSplit, collapsed, toggleList, backToList } = useContext(SplitContext);
  return (
    <header className={s.detailHead}>
      {inSplit && (
        <span className={s.onlyNarrow}>
          <IconButton label="返回列表" onClick={backToList}><ArrowLeft {...ICON} /></IconButton>
        </span>
      )}
      {inSplit && collapsed && (
        <span className={s.onlyWide}>
          <IconButton label="展开列表" onClick={toggleList}><PanelLeftOpen {...ICON} /></IconButton>
        </span>
      )}
      <input
        className={s.titleInput}
        value={title}
        readOnly={!onTitle}
        placeholder="未命名"
        aria-label="标题"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        onChange={(event) => onTitle?.(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
      {badges}
      {children && <div className={s.detailActions}>{children}</div>}
    </header>
  );
}

/* ── 生成 ── */
export function GenRunning({ stages, className }: { stages: string[]; className?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => Math.min(value + 1, stages.length - 1)), 2600);
    return () => clearInterval(timer);
  }, [stages.length]);
  return (
    <div className={cx(s.genRunning, className)} role="status">
      <Shimmer>{stages[index]}…</Shimmer>
      <div className={s.genLines} aria-hidden="true">
        <Skeleton />
        <Skeleton width="84%" />
        <Skeleton width="62%" />
      </div>
    </div>
  );
}

const GEN_COPY: Record<GenKind, { title: string; desc: string; stages: string[]; hint: string }> = {
  note: { title: '生成笔记', desc: '把材料整理成一篇带要点、易错点和自测题的复习笔记。', stages: ['正在读材料', '正在提炼要点', '正在写成笔记'], hint: '例如：重点写易混的两个概念，多举例子' },
  mindmap: { title: '生成思维导图', desc: '把材料的结构理成一张分层的导图，生成后可以继续改。', stages: ['正在读材料', '正在理出层次', '正在画出分支'], hint: '例如：按「是什么、为什么、怎么用」分支' },
  quiz: { title: '生成题目集', desc: '按你选的题型和数量出题，每道题都带解析。', stages: ['正在读材料', '正在找考点', '正在出题并写解析'], hint: '例如：多出辨析题，难度偏高' },
  deck: { title: '生成闪卡', desc: '一张卡只考一个知识点，生成后今天就能开始复习。', stages: ['正在读材料', '正在拆知识点', '正在写卡片'], hint: '例如：只考定义和公式' },
  todos: { title: '排学习待办', desc: '按先理解、再练习、再讲出来的顺序，排出这几天要做的事。', stages: ['正在读材料', '正在估工作量', '正在排顺序'], hint: '例如：周五前要考试，每天不超过一小时' },
};
const QUIZ_COUNTS = ['5', '8', '10', '15'] as const;
const DECK_COUNTS = ['8', '12', '20', '30'] as const;

export function GenerateDialog({ kind, open, onOpenChange, view, onCreated }: {
  kind: GenKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: Pick<TerminalViewProps, 'owner' | 'topic' | 'selectedSources'>;
  onCreated?: (created: Created) => void;
}) {
  const { owner, topic, selectedSources } = view;
  const copy = GEN_COPY[kind];
  const [instruction, setInstruction] = useState('');
  const [text, setText] = useState('');
  const [quizCount, setQuizCount] = useState<(typeof QUIZ_COUNTS)[number]>('8');
  const [deckCount, setDeckCount] = useState<(typeof DECK_COUNTS)[number]>('12');
  const [types, setTypes] = useState<QuestionType[]>(QUESTION_TYPES.map((type) => type.value));
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const sources = selectedSources.filter((source) => source.content.trim());
  const needText = !topic && !sources.length;
  const ready = hasMaterial({ topic, sources, text }) && (kind !== 'quiz' || types.length > 0);

  useEffect(() => () => abort.current?.abort(), []);

  const close = (next: boolean) => {
    if (!next) {
      abort.current?.abort();
      setState('idle');
      setError('');
    }
    onOpenChange(next);
  };

  const start = async (local = false) => {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setState('running');
    setError('');
    try {
      const created = await createFromAI(
        kind,
        owner,
        { topic, sources, instruction, text, local, signal: controller.signal },
        { quizCount: Number(quizCount), quizTypes: types, deckCount: Number(deckCount) },
      );
      if (controller.signal.aborted) return;
      if (created.local) toast(`已生成${created.summary}（本地演示）`, { description: '当前没有可用模型，内容取自课程资料。' });
      else toast.success(`已生成${created.summary}`);
      setState('idle');
      setInstruction('');
      setText('');
      onOpenChange(false);
      onCreated?.(created);
    } catch (reason) {
      if (controller.signal.aborted || isAbort(reason)) return;
      setError(errorText(reason));
      setState('error');
    }
  };

  const footer = state === 'running'
    ? <Button variant="soft" onClick={() => close(false)}>取消</Button>
    : (
      <>
        {state === 'error' && <Button variant="ghost" onClick={() => void start(true)} disabled={!ready}>用本地演示</Button>}
        <Button variant="soft" onClick={() => close(false)}>取消</Button>
        <Button variant="solid" onClick={() => void start()} disabled={!ready}>{state === 'error' ? '重试' : '生成'}</Button>
      </>
    );

  return (
    <Dialog open={open} onOpenChange={close} title={copy.title} description={copy.desc} footer={footer}>
      {state === 'running' ? <GenRunning stages={copy.stages} /> : (
        <div className={s.gen}>
          {needText ? (
            <Field label="要学的内容" hint="没有打开课程，也没有勾选资料。贴一段课文、讲义或笔记，至少二十个字。">
              <Textarea rows={6} value={text} placeholder="把要学习的文字贴在这里" onChange={(event) => setText(event.target.value)} />
            </Field>
          ) : (
            <div className={s.basis}>
              依据
              {topic && <Badge tone="accent">本课 · {clip(topic.title, 18)}</Badge>}
              {sources.length > 0 && <Badge>已选资料 {sources.length} 份</Badge>}
            </div>
          )}
          {kind === 'quiz' && (
            <>
              <div className={s.genRow}>
                <span>题目数量</span>
                <Segmented size="sm" label="题目数量" value={quizCount} onChange={setQuizCount} options={QUIZ_COUNTS.map((value) => ({ value, label: `${value} 题` }))} />
              </div>
              <div className={s.genRow}>
                <span>题型</span>
                <div className={s.chips}>
                  {QUESTION_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className={s.chip}
                      aria-pressed={types.includes(type.value)}
                      onClick={() => setTypes((current) => (current.includes(type.value) ? current.filter((value) => value !== type.value) : [...current, type.value]))}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {kind === 'deck' && (
            <div className={s.genRow}>
              <span>卡片数量</span>
              <Segmented size="sm" label="卡片数量" value={deckCount} onChange={setDeckCount} options={DECK_COUNTS.map((value) => ({ value, label: `${value} 张` }))} />
            </div>
          )}
          <Field label="补充要求（可选）">
            <Input value={instruction} placeholder={copy.hint} maxLength={200} onChange={(event) => setInstruction(event.target.value)} />
          </Field>
          {state === 'error' && <p className={s.genError} role="alert">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
