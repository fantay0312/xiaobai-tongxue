/**
 * 小砚记得的你 —— 学习终端里小砚对学习者的长期记忆。
 * 数据全部来自 engine/tutorMemory（按账号存在当前浏览器），这里只负责看、改、删、暂停。
 */
import { useMemo, useState, type FormEvent } from 'react';
import { BookOpen, ChevronDown, Link2, MessageCircle, NotebookPen, Plus, Tag, Target, TriangleAlert, WandSparkles } from 'lucide-react';
import {
  Badge, Button, Dialog, Empty, IconButton, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Switch, toast,
} from '../../../../components/ui';
import {
  TUTOR_MEMORY_KINDS, TUTOR_MEMORY_TEXT_MAX, guessTutorMemoryKind, isSensitiveMemoryText, summarizeTutorMemory,
  tutorMemory, tutorMemoryHints,
} from '../../../../engine/tutorMemory';
import type { TutorMemoryItem, TutorMemoryKind, TutorMemoryState } from '../../../../engine/tutorMemory';
import { relDay } from '../../../../lib/relDay';
import type { Topic } from '../../../../types';
import { MemoryRow } from './MemoryRow';
import s from './memory.module.css';

interface Props {
  owner: string | null;
  topic?: Topic;
  state: TutorMemoryState;
  onAsk: (text: string) => void;
  onOpenTopic: (topicId: string) => void;
}

const KIND_LABEL = Object.fromEntries(TUTOR_MEMORY_KINDS.map((entry) => [entry.kind, entry.label])) as Record<TutorMemoryKind, string>;
const SUGGESTIONS = ['我想在期末前学完数据结构', '讲解时先给结论，再展开', '我是大二，计算机专业'];
const INTRO_PROMPT = '先认识一下：我是……专业，这学期想……，讲解时希望……';

function sortItems(items: TutorMemoryItem[]): TutorMemoryItem[] {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
}

function sourceLabel(item: TutorMemoryItem): string {
  if (item.source === 'user') return '我添加的';
  return item.edited ? '自动记下 · 我改过' : '自动记下';
}

export function TutorMemoryTab({ owner, topic, state, onAsk, onOpenTopic }: Props) {
  const { items, paused } = state;
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<TutorMemoryKind | 'auto'>('auto');
  const [linkTopic, setLinkTopic] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const summary = useMemo(() => summarizeTutorMemory(state), [state]);
  const groups = useMemo(
    () => TUTOR_MEMORY_KINDS
      .map((entry) => ({ ...entry, items: sortItems(items.filter((item) => item.kind === entry.kind)) }))
      .filter((group) => group.items.length > 0),
    [items],
  );
  // 与对话里实际注入的要点同一个函数，所见即所用
  const hints = useMemo(() => tutorMemoryHints(owner, topic?.topicId, 6), [owner, topic?.topicId, state]);

  const draftText = draft.trim();
  const guessed = draftText ? guessTutorMemoryKind(draftText) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draftText) return;
    const saved = tutorMemory.add(owner, {
      text: draftText,
      ...(kind === 'auto' ? {} : { kind }),
      ...(linkTopic && topic ? { topicId: topic.topicId, topicTitle: topic.title } : {}),
    });
    if (!saved) {
      toast.error(isSensitiveMemoryText(draftText) ? '密码、手机号、邮箱这类信息不会存进记忆' : '太短了，写具体一点');
      return;
    }
    setDraft('');
    setFreshId(saved.id);
    toast.success(`已记到「${KIND_LABEL[saved.kind]}」`);
  };

  const remove = (item: TutorMemoryItem) => {
    const removed = tutorMemory.remove(owner, item.id);
    if (!removed) return;
    toast('已删除这条记忆', {
      duration: 6000,
      action: { label: '撤销', onClick: () => tutorMemory.restore(owner, removed) },
    });
  };

  const edit = (item: TutorMemoryItem, text: string) => {
    if (tutorMemory.edit(owner, item.id, { text })) return true;
    toast.error(isSensitiveMemoryText(text) ? '密码、手机号、邮箱这类信息不会存进记忆' : '没保存：内容太短');
    return false;
  };

  const clearAll = () => {
    const removed = tutorMemory.clear(owner);
    setClearOpen(false);
    if (!removed.length) return;
    toast(`已清空 ${removed.length} 条记忆`, {
      duration: 8000,
      action: { label: '撤销', onClick: () => tutorMemory.restore(owner, removed) },
    });
  };

  const facets: { label: string; icon: typeof Target; lines: string[]; empty: string }[] = [
    { label: '主要目标', icon: Target, lines: summary.goals, empty: '还没记下目标' },
    { label: '容易卡住的地方', icon: TriangleAlert, lines: summary.weaknesses, empty: '还没发现薄弱点' },
    { label: '喜欢的讲法', icon: WandSparkles, lines: summary.preferences, empty: '还没记下偏好' },
  ];

  return (
    <>
      {paused && (
        <div className={s.banner} role="status">
          <span>记忆已暂停：小砚不再自动记下新内容，回答时也不参考这些记忆。</span>
          <Button size="sm" variant="outline" onClick={() => tutorMemory.setPaused(owner, false)}>继续记忆</Button>
        </div>
      )}

      <section className={s.profile} aria-labelledby="tutor-profile-title">
        <div className={s.sectionHead}>
          <div>
            <h2 id="tutor-profile-title">小砚眼里的你</h2>
            <p>
              {summary.total > 0
                ? `由 ${summary.total} 条记忆归纳${summary.updatedAt ? `，最近更新于${relDay(summary.updatedAt)}` : ''}。`
                : '聊几轮之后，这里会出现你的目标、薄弱点和喜欢的讲法。'}
            </p>
          </div>
          <div className={s.sectionSide}>
            <label htmlFor="tutor-memory-pause">暂停记忆</label>
            <Switch id="tutor-memory-pause" checked={paused} onCheckedChange={(next) => tutorMemory.setPaused(owner, next)} label="暂停小砚的记忆" />
          </div>
        </div>

        {summary.total > 0 ? (
          <>
            <dl className={s.facets}>
              {facets.map(({ label, icon: FacetIcon, lines, empty }) => (
                <div key={label} className={s.facet}>
                  <dt><FacetIcon size={14} strokeWidth={1.75} />{label}</dt>
                  {lines.length > 0 ? lines.map((line) => <dd key={line}>{line}</dd>) : <dd data-empty>{empty}</dd>}
                </div>
              ))}
            </dl>
            <div className={s.profileStats}>
              {TUTOR_MEMORY_KINDS.map((entry) => {
                const count = items.filter((item) => item.kind === entry.kind).length;
                return count > 0 ? <Badge key={entry.kind}>{entry.label} {count}</Badge> : null;
              })}
              {summary.pinned > 0 && <Badge tone="accent">置顶 {summary.pinned}</Badge>}
            </div>
          </>
        ) : (
          <Empty
            icon={<NotebookPen size={22} strokeWidth={1.75} />}
            title="小砚还没记下什么"
            description="在学习终端里问几个问题，小砚会记下你的目标、偏好和反复卡住的地方。也可以先在下面自己写一条。"
            action={(
              <Button variant="soft" icon={<MessageCircle size={16} strokeWidth={1.75} />} onClick={() => onAsk(INTRO_PROMPT)}>
                告诉小砚我的情况
              </Button>
            )}
          />
        )}
      </section>

      <section className={s.section} aria-labelledby="tutor-add-title">
        <div className={s.sectionHead}>
          <div>
            <h2 id="tutor-add-title">添一条</h2>
            <p>想让小砚一直记住的事，直接写在这里。</p>
          </div>
        </div>
        <form className={s.add} onSubmit={submit}>
          <Input
            wrapClassName={s.addInput}
            leading={<Plus size={16} strokeWidth={1.75} />}
            value={draft}
            maxLength={TUTOR_MEMORY_TEXT_MAX}
            placeholder="比如：我想在十二月前学完操作系统"
            aria-label="写一条让小砚记住"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={s.addSide}>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="outline" icon={<Tag size={15} strokeWidth={1.75} />} iconRight={<ChevronDown size={14} strokeWidth={1.75} />}>
                  {kind === 'auto' ? (guessed ? `自动：${KIND_LABEL[guessed]}` : '自动归类') : KIND_LABEL[kind]}
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>归到哪一类</MenuLabel>
                <MenuItem checked={kind === 'auto'} hint="按措辞判断" onSelect={() => setKind('auto')}>自动归类</MenuItem>
                {TUTOR_MEMORY_KINDS.map((entry) => (
                  <MenuItem key={entry.kind} checked={kind === entry.kind} hint={entry.hint} onSelect={() => setKind(entry.kind)}>
                    {entry.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {topic && (
              <button
                type="button"
                className={s.toggleChip}
                aria-pressed={linkTopic}
                title={linkTopic ? '这条只和当前课程有关' : '点一下，只关联当前课程'}
                onClick={() => setLinkTopic((value) => !value)}
              >
                <Link2 size={14} strokeWidth={1.75} />
                <span>{linkTopic ? `只关联《${topic.title}》` : '关联当前课程'}</span>
              </button>
            )}
            <Button type="submit" variant="solid" disabled={!draftText}>记下</Button>
          </div>
        </form>
        {items.length < 3 && (
          <div className={s.suggest}>
            <span>不知道写什么？点一条再改：</span>
            {SUGGESTIONS.map((text) => (
              <button key={text} type="button" className={s.suggestChip} onClick={() => setDraft(text)}>{text}</button>
            ))}
          </div>
        )}
      </section>

      {groups.length > 0 && (
        <section className={s.section} aria-labelledby="tutor-list-title">
          <div className={s.sectionHead}>
            <div>
              <h2 id="tutor-list-title">记下的内容</h2>
              <p>每一条都能改、置顶或删除。置顶的会优先交给小砚。</p>
            </div>
          </div>
          <div className={s.groups}>
            {groups.map((group) => (
              <div key={group.kind} className={s.group} role="group" aria-labelledby={`tutor-kind-${group.kind}`}>
                <div className={s.groupHead}>
                  <h3 id={`tutor-kind-${group.kind}`}>{group.label}</h3>
                  <span className={s.count}>{group.items.length}</span>
                  <span className={s.groupHint}>{group.hint}</span>
                </div>
                <ul className={s.rows}>
                  {group.items.map((item) => (
                    <MemoryRow
                      key={item.id}
                      text={item.text}
                      pinned={Boolean(item.pinned)}
                      fresh={freshId === item.id}
                      maxLength={TUTOR_MEMORY_TEXT_MAX}
                      onEdit={(text) => edit(item, text)}
                      onPin={(pinned) => tutorMemory.pin(owner, item.id, pinned)}
                      onDelete={() => remove(item)}
                      actionsOpen={menuFor === item.id}
                      meta={(
                        <>
                          <span>{sourceLabel(item)}</span>
                          <span>{relDay(item.updatedAt)}</span>
                          {(item.seen ?? 1) > 1 && <span>提到 {item.seen} 次</span>}
                          {item.topicId && (
                            <button type="button" className={s.topicChip} title="打开这门课" onClick={() => onOpenTopic(item.topicId!)}>
                              <BookOpen size={12} strokeWidth={1.75} />
                              <span>{item.topicTitle ?? '关联课程'}</span>
                            </button>
                          )}
                        </>
                      )}
                      extra={(
                        <Menu open={menuFor === item.id} onOpenChange={(open) => setMenuFor(open ? item.id : null)}>
                          <MenuTrigger asChild>
                            <IconButton size="sm" label="改分类">
                              <Tag strokeWidth={1.75} />
                            </IconButton>
                          </MenuTrigger>
                          <MenuContent align="end">
                            <MenuLabel>改到哪一类</MenuLabel>
                            {TUTOR_MEMORY_KINDS.map((entry) => (
                              <MenuItem
                                key={entry.kind}
                                checked={item.kind === entry.kind}
                                onSelect={() => tutorMemory.edit(owner, item.id, { kind: entry.kind })}
                              >
                                {entry.label}
                              </MenuItem>
                            ))}
                          </MenuContent>
                        </Menu>
                      )}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className={s.listFoot}>
            <span>共 {items.length} 条，最多保留 120 条，满了先清最旧的自动记录。</span>
            <Button size="sm" variant="ghost" onClick={() => setClearOpen(true)}>清空全部</Button>
          </div>
        </section>
      )}

      <section className={s.usage} aria-labelledby="tutor-usage-title">
        <h3 id="tutor-usage-title">这些记忆怎么用</h3>
        <ul>
          <li>你向小砚提问时，最相关的几条会作为背景一起交给它：置顶的优先，其次是当前课程的，再是最近的。</li>
          <li>记忆按账号保存在这个浏览器里。换设备，或清除浏览器数据后，不会跟过去。</li>
          <li>密码、手机号、邮箱这类信息不会被记下。你删掉的自动记录，之后不会再自动记回来。</li>
          <li>这份记忆只给小砚用。小白记得什么，看旁边的「小白记得的课」。</li>
        </ul>
        <div className={s.hintBox}>
          {paused ? (
            <p>记忆已暂停，现在提问不会带上任何一条。</p>
          ) : hints.length > 0 ? (
            <>
              <p>现在{topic ? `在《${topic.title}》里` : ''}提问，小砚会带上这 {hints.length} 条：</p>
              <ol className={s.hintList}>
                {hints.map((hint) => <li key={hint}>{hint}</li>)}
              </ol>
            </>
          ) : (
            <p>还没有可以带上的记忆。</p>
          )}
        </div>
      </section>

      <Dialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        size="sm"
        title="清空小砚的记忆？"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>取消</Button>
            <Button variant="danger" onClick={clearAll}>清空</Button>
          </>
        )}
      >
        <p className={s.lessonLine}>会删掉全部 {items.length} 条，置顶的也在内。小白的记忆不受影响。</p>
      </Dialog>
    </>
  );
}
