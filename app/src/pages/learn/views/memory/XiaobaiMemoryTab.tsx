/**
 * 小白记得的课 —— 把课堂上小白的记忆（appStore.memory + 事件流）放进学习终端。
 * 逻辑沿用成长册：单课回执走 engine/recall，掌握度与衰减走 engine/memory，条目增删改走 appStore 动作。
 * 这是故事页：纸页与金句用 data-story 岛，文案是小白的第一人称。
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BookOpen, GraduationCap, Link2, Plus, RefreshCw } from 'lucide-react';
import { Badge, Button, Empty, Input, Progress, Switch, toast } from '../../../../components/ui';
import { XiaobaiAvatar } from '../../../../components/xiaobai/XiaobaiAvatar';
import { getTopic } from '../../../../data';
import { MIN_VISIBLE_CONFIDENCE } from '../../../../engine/learnerMemory';
import { computeMastery, decayedMastery, replayTopicState } from '../../../../engine/memory';
import { deriveTopicRecall } from '../../../../engine/recall';
import type { TopicRecall } from '../../../../engine/recall';
import { relDay } from '../../../../lib/relDay';
import { useAppStore } from '../../../../store/appStore';
import type { MemoryItem, MemoryKind, Topic, TopicState } from '../../../../types';
import { MemoryRow } from './MemoryRow';
import s from './memory.module.css';

interface Props {
  topics: Topic[];
  topic?: Topic;
  onOpenTopic: (topicId: string) => void;
  onView: (view: string, params?: Record<string, string>) => void;
}

interface Lesson {
  topic: Topic;
  state: TopicState;
  recall: TopicRecall;
  /** 不计遗忘的掌握度 0..1 */
  base: number;
  /** 按遗忘曲线衰减到此刻的掌握度 0..1 */
  current: number;
  fogged: boolean;
  lastAt: number;
}

// 情分（bond）不列条目：它只经「小白眼里的先生」的情分一行露面，与成长册一致
const KIND_GROUPS: { kind: MemoryKind; label: string }[] = [
  { kind: 'preference', label: '偏好' },
  { kind: 'habit', label: '习惯' },
  { kind: 'strength', label: '长处' },
  { kind: 'weakness', label: '短板' },
  { kind: 'milestone', label: '里程碑' },
  { kind: 'note', label: '笔记' },
];
const PROFILE_ROWS: { key: 'style' | 'strengths' | 'weaknesses' | 'pace' | 'bond'; label: string }[] = [
  { key: 'style', label: '讲法' },
  { key: 'strengths', label: '长处' },
  { key: 'weaknesses', label: '短板' },
  { key: 'pace', label: '节奏' },
  { key: 'bond', label: '情分' },
];
const LESSON_PREVIEW = 4;
const QUOTE_PREVIEW = 6;
const percent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

function sortRows(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || Number(a.muted) - Number(b.muted)
    || b.lastSeenAt.localeCompare(a.lastSeenAt)
    || a.id.localeCompare(b.id));
}

function fogNote(days: number | null): string {
  if (days == null) return '暂时还稳';
  if (days === 0) return '今天开始起雾';
  return days < 0 ? `已经起雾 ${Math.abs(days)} 天` : `再过 ${days} 天起雾`;
}

export function XiaobaiMemoryTab({ topics, topic, onOpenTopic, onView }: Props) {
  const memory = useAppStore((st) => st.memory);
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);
  const global = useAppStore((st) => st.global);
  const pinMemory = useAppStore((st) => st.pinMemory);
  const muteMemory = useAppStore((st) => st.muteMemory);
  const editMemory = useAppStore((st) => st.editMemory);
  const deleteMemory = useAppStore((st) => st.deleteMemory);
  const addExplicitMemory = useAppStore((st) => st.addExplicitMemory);
  const setMemoryPaused = useAppStore((st) => st.setMemoryPaused);
  const recomposeProfile = useAppStore((st) => st.recomposeProfile);

  const [draft, setDraft] = useState('');
  const [linkTopic, setLinkTopic] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [allLessons, setAllLessons] = useState(false);
  const [allQuotes, setAllQuotes] = useState(false);

  const { items, profile, paused } = memory;
  const titleOf = (topicId: string) => topics.find((entry) => entry.topicId === topicId)?.title ?? getTopic(topicId)?.title ?? null;

  /* 教过的课：只算真正开过课的，按最近一次上课排序 */
  const lessons = useMemo<Lesson[]>(() => {
    const lastSeen = new Map<string, number>();
    for (const event of events) {
      if (!event.sessionId && event.type !== 'session_started') continue;
      const at = Date.parse(event.t);
      if (Number.isFinite(at) && at > (lastSeen.get(event.topicId) ?? 0)) lastSeen.set(event.topicId, at);
    }
    const now = new Date();
    const list: Lesson[] = [];
    for (const [topicId, lastAt] of lastSeen) {
      const lessonTopic = topics.find((entry) => entry.topicId === topicId) ?? getTopic(topicId);
      if (!lessonTopic) continue;
      const recall = deriveTopicRecall({ topicId, events, reports, topicStates, topics, now: now.getTime() });
      if (!recall) continue;
      const own = events.filter((event) => event.topicId === topicId);
      const state = topicStates[topicId] ?? replayTopicState(lessonTopic, events, now);
      const base = computeMastery(state, lessonTopic, own);
      const current = decayedMastery(base, state.lastVerified, now);
      const fogged = state.forgotten || (recall.daysToFog != null && recall.daysToFog < 0);
      list.push({ topic: lessonTopic, state, recall, base, current, fogged, lastAt });
    }
    return list.sort((a, b) => b.lastAt - a.lastAt);
  }, [events, reports, topicStates, topics]);

  const mastered = lessons.filter((lesson) => lesson.state.knowledgeState === '出师').length;
  const cleared = useMemo(() => events.filter((event) => event.type === 'misconception_corrected').length, [events]);
  const quotes = useMemo(() => [...global.goldenAnalogies].sort((a, b) => b.t.localeCompare(a.t)), [global.goldenAnalogies]);

  const groups = useMemo(
    () => KIND_GROUPS
      .map((group) => ({ ...group, items: sortRows(items.filter((item) => item.kind === group.kind)) }))
      .filter((group) => group.items.length > 0),
    [items],
  );
  const listed = groups.reduce((sum, group) => sum + group.items.length, 0);
  const hasProfile = !!profile && (profile.summary !== '' || PROFILE_ROWS.some(({ key }) => profile.sections[key] !== ''));
  const nothingYet = lessons.length === 0 && listed === 0 && !hasProfile && quotes.length === 0;

  const voice = lessons.length === 0
    ? '先生还没给我讲过课。讲完第一课，我就有东西可记了。'
    : `先生教过我 ${lessons.length} 门课${mastered > 0 ? `，有 ${mastered} 门我已经出师` : ''}。讲过的话、清掉的心魔，我都记在小本子上。`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const before = new Set(items.map((item) => item.id));
    addExplicitMemory(text, linkTopic && topic ? { topicId: topic.topicId } : {});
    const added = useAppStore.getState().memory.items.find((item) => !before.has(item.id));
    if (!added) {
      toast.error('这条没记下，换个说法再试');
      return;
    }
    setFreshId(added.id);
    setDraft('');
    toast.success('小白记下了');
  };

  const visibleLessons = allLessons ? lessons : lessons.slice(0, LESSON_PREVIEW);
  const visibleQuotes = allQuotes ? quotes : quotes.slice(0, QUOTE_PREVIEW);

  return (
    <>
      <section className={s.storyCard} data-story aria-label="小白的话">
        <XiaobaiAvatar mood={lessons.length > 0 ? 'happy' : 'curious'} level={global.learningLevel} size={72} />
        <div>
          <p className={s.storyQuote}>{voice}</p>
          <p className={s.storySign}>—— 小白</p>
        </div>
        {!nothingYet && (
          <dl className={s.storyStats}>
            <div><dt>教过</dt><dd>{lessons.length}<small>门</small></dd></div>
            <div><dt>出师</dt><dd>{mastered}<small>门</small></dd></div>
            <div><dt>清掉心魔</dt><dd>{cleared}<small>处</small></dd></div>
            <div><dt>记下金句</dt><dd>{quotes.length}<small>句</small></dd></div>
          </dl>
        )}
      </section>

      {nothingYet && (
        <Empty
          icon={<GraduationCap size={22} strokeWidth={1.75} />}
          title="还没有课可以记"
          description="把一门课讲给小白听。讲完之后，他学到多少、过几天还记得多少、你打过的比方，都会出现在这里。"
          action={(
            <Button variant="solid" icon={<GraduationCap size={16} strokeWidth={1.75} />} onClick={() => onView('feynman')}>
              去教小白
            </Button>
          )}
        />
      )}

      {lessons.length > 0 && (
        <section className={s.section} aria-labelledby="xb-lessons-title">
          <div className={s.sectionHead}>
            <div>
              <h2 id="xb-lessons-title">教过的课</h2>
              <p>每门课小白学到多少，隔了几天还记得多少。出师的课不复习会慢慢起雾。</p>
            </div>
          </div>
          <div className={s.lessons}>
            {visibleLessons.map(({ topic: lessonTopic, state, recall, base, current, fogged, lastAt }) => {
              const done = state.knowledgeState === '出师';
              const faded = done && percent(base) > percent(current);
              return (
                <article key={lessonTopic.topicId} className={s.lesson}>
                  <header className={s.lessonHead}>
                    <div>
                      <h3>{lessonTopic.title}</h3>
                      <small>{lessonTopic.course}</small>
                    </div>
                    <div className={s.lessonBadges}>
                      {fogged && <Badge tone="warn">该复习了</Badge>}
                      <Badge tone={done ? 'ok' : state.knowledgeState === '半懂' ? 'accent' : 'neutral'} dot>
                        {state.knowledgeState === '没懂' ? '还没懂' : state.knowledgeState}
                      </Badge>
                    </div>
                  </header>

                  <div className={s.meter}>
                    <div className={s.meterTop}>
                      <span>{done ? '现在还记得' : '学到了'}</span>
                      <strong>{percent(current)}%</strong>
                    </div>
                    <Progress
                      value={percent(current)}
                      tone={fogged ? 'warn' : done ? 'ok' : 'accent'}
                      label={`《${lessonTopic.title}》的掌握度`}
                    />
                    {done && (
                      <span className={s.meterNote}>
                        {faded ? `出师时 ${percent(base)}% · ` : ''}{fogNote(recall.daysToFog)}
                      </span>
                    )}
                  </div>

                  {recall.lastOutcome && <p className={s.lessonLine}>{recall.lastOutcome}</p>}

                  {recall.rememberedPoints.length > 0 && (
                    <div className={s.chipRow}>
                      <span>还记得的要点</span>
                      <div className={s.chips}>
                        {recall.rememberedPoints.map((point) => <span key={point} className={s.chip}>{point}</span>)}
                      </div>
                    </div>
                  )}
                  {recall.clearedDemons.length > 0 && (
                    <div className={s.chipRow}>
                      <span>清掉的心魔</span>
                      <div className={s.chips}>
                        {recall.clearedDemons.map((demon) => <span key={demon} className={`${s.chip} ${s.chipOk}`}>{demon}</span>)}
                      </div>
                    </div>
                  )}
                  {recall.goldenQuotes.map((quote) => (
                    <blockquote key={quote} className={s.handQuote} data-story>「{quote}」</blockquote>
                  ))}

                  <footer className={s.lessonFoot}>
                    <span>上次上课：{relDay(new Date(lastAt).toISOString())}</span>
                    <Button size="sm" variant="ghost" iconRight={<ArrowRight size={14} strokeWidth={1.75} />} onClick={() => onOpenTopic(lessonTopic.topicId)}>
                      打开这门课
                    </Button>
                  </footer>
                </article>
              );
            })}
          </div>
          {lessons.length > LESSON_PREVIEW && (
            <Button className={s.more} size="sm" variant="ghost" onClick={() => setAllLessons((value) => !value)}>
              {allLessons ? '收起' : `查看其余 ${lessons.length - LESSON_PREVIEW} 门`}
            </Button>
          )}
        </section>
      )}

      {quotes.length > 0 && (
        <section className={s.section} aria-labelledby="xb-quotes-title">
          <div className={s.sectionHead}>
            <div>
              <h2 id="xb-quotes-title">先生打过的比方</h2>
              <p>讲得最妙的几句，小白原样抄在小本子上。</p>
            </div>
          </div>
          <ul className={s.quoteWall}>
            {visibleQuotes.map((quote) => (
              <li key={quote.id} className={s.quoteNote} data-story>
                <blockquote>「{quote.text}」</blockquote>
                <footer>{titleOf(quote.topicId) ? `讲《${titleOf(quote.topicId)}》时 · ` : ''}{relDay(quote.t)}</footer>
              </li>
            ))}
          </ul>
          {quotes.length > QUOTE_PREVIEW && (
            <Button className={s.more} size="sm" variant="ghost" onClick={() => setAllQuotes((value) => !value)}>
              {allQuotes ? '收起' : `查看其余 ${quotes.length - QUOTE_PREVIEW} 句`}
            </Button>
          )}
        </section>
      )}

      {hasProfile && profile && (
        <section className={s.section} aria-labelledby="xb-bond-title">
          <div className={s.sectionHead}>
            <div>
              <h2 id="xb-bond-title">小白眼里的先生</h2>
              <p>小白根据上过的课，对你讲课方式的归纳。</p>
            </div>
          </div>
          <div className={s.bond}>
            {profile.summary && <p className={s.bondSummary}>{profile.summary}</p>}
            <dl className={s.bondRows}>
              {PROFILE_ROWS.filter(({ key }) => profile.sections[key]).map(({ key, label }) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{profile.sections[key]}</dd>
                </div>
              ))}
            </dl>
            <div className={s.bondMeta}>
              <span>整理于{relDay(profile.updatedAt)} · 凭 {profile.basis.itemCount} 条记忆、{profile.basis.sessionCount} 堂课</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={14} strokeWidth={1.75} />} onClick={recomposeProfile}>重新整理</Button>
            </div>
          </div>
        </section>
      )}

      <section className={s.section} aria-labelledby="xb-items-title">
        <div className={s.sectionHead}>
          <div>
            <h2 id="xb-items-title">小白记得的事</h2>
            <p>
              {paused
                ? '记忆已暂停：这段时间上的课，小白不会再记。'
                : '上课时一条一条记下的。写得不对可以改，不想让他用可以隐藏。'}
            </p>
          </div>
          <div className={s.sectionSide}>
            <label htmlFor="xiaobai-memory-pause">暂停记忆</label>
            <Switch id="xiaobai-memory-pause" checked={paused} onCheckedChange={setMemoryPaused} label="暂停小白的记忆" />
          </div>
        </div>

        {groups.length > 0 ? (
          <div className={s.groups}>
            {groups.map((group) => (
              <div key={group.kind} className={s.group} role="group" aria-labelledby={`xb-kind-${group.kind}`}>
                <div className={s.groupHead}>
                  <h3 id={`xb-kind-${group.kind}`}>{group.label}</h3>
                  <span className={s.count}>{group.items.length}</span>
                </div>
                <ul className={s.rows}>
                  {group.items.map((item) => {
                    const scopeTitle = item.scope.topicId ? titleOf(item.scope.topicId) : null;
                    return (
                      <MemoryRow
                        key={item.id}
                        text={item.text}
                        pinned={item.pinned}
                        muted={item.muted}
                        fresh={freshId === item.id}
                        maxLength={60}
                        confirmDelete
                        onEdit={(text) => editMemory(item.id, text)}
                        onPin={(pinned) => pinMemory(item.id, pinned)}
                        onMute={(muted) => muteMemory(item.id, muted)}
                        onDelete={() => deleteMemory(item.id)}
                        meta={(
                          <>
                            <span>{item.source === 'explicit' ? '先生亲笔' : '课上记下'}</span>
                            <span>{relDay(item.lastSeenAt)}</span>
                            {item.source === 'observed' && item.confidence < MIN_VISIBLE_CONFIDENCE && <span>还在观察</span>}
                            {item.muted && <Badge tone="outline">已隐藏</Badge>}
                            {scopeTitle && item.scope.topicId && (
                              <button type="button" className={s.topicChip} title="打开这门课" onClick={() => onOpenTopic(item.scope.topicId!)}>
                                <BookOpen size={12} strokeWidth={1.75} />
                                <span>{scopeTitle}</span>
                              </button>
                            )}
                          </>
                        )}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className={s.lessonLine}>还没记下什么。讲完一课，小白会把你的讲法、长处和短板记在这里。</p>
        )}

        <form className={s.add} onSubmit={submit}>
          <Input
            wrapClassName={s.addInput}
            leading={<Plus size={16} strokeWidth={1.75} />}
            value={draft}
            maxLength={60}
            placeholder="记一条给小白，比如：先生开讲前爱先问一句"
            aria-label="记一条给小白"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={s.addSide}>
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
            <Button type="submit" variant="soft" disabled={!draft.trim()}>记下</Button>
          </div>
        </form>
      </section>

      <Link to="/growth#memory" className={s.growthLink}>
        <div>
          <strong>翻开成长册</strong>
          <span>完整的四层记忆、每堂课的记录和小白的日记都在那里。</span>
        </div>
        <ArrowRight size={18} strokeWidth={1.75} />
      </Link>
    </>
  );
}
