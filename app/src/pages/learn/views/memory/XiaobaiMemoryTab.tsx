/**
 * 小白记得的课 —— 把课堂上小白的记忆（appStore.memory + 事件流）放进学习终端。
 * 派生数据来自 useXiaobaiMemory；条目增删改走 appStore 动作。
 * slice 决定显示哪一块：全部 / 教过的课 / 金句与心魔 / 小白眼里的先生 / 小白记得的事。
 * 这是故事页：纸页与金句用 data-story 岛，文案是小白的第一人称。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BookOpen, GraduationCap, Link2, Plus, RefreshCw } from 'lucide-react';
import { Badge, Button, Empty, Input, Progress, Switch, toast } from '../../../../components/ui';
import { XiaobaiAvatar } from '../../../../components/xiaobai/XiaobaiAvatar';
import { MIN_VISIBLE_CONFIDENCE } from '../../../../engine/learnerMemory';
import { relDay } from '../../../../lib/relDay';
import { useAppStore } from '../../../../store/appStore';
import type { Topic } from '../../../../types';
import { MemoryRow } from './MemoryRow';
import { PROFILE_ROWS } from './useXiaobaiMemory';
import type { XiaobaiMemoryData, XiaobaiSlice } from './useXiaobaiMemory';
import s from './memory.module.css';

interface Props {
  data: XiaobaiMemoryData;
  slice: XiaobaiSlice;
  topic?: Topic;
  /** 页内自带暂停开关（没有侧栏时用）；有侧栏时开关在页头 */
  inlinePause: boolean;
  /** 每次加一，把光标放进「记一条给小白」 */
  addSignal: number;
  onOpenTopic: (topicId: string) => void;
  onView: (view: string, params?: Record<string, string>) => void;
  /** 手机：「记一条给小白」吸在页面底部 */
  dock?: boolean;
}

const LESSON_PREVIEW = 4;
const QUOTE_PREVIEW = 6;
const percent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

function fogNote(days: number | null): string {
  if (days == null) return '暂时还稳';
  if (days === 0) return '今天开始起雾';
  return days < 0 ? `已经起雾 ${Math.abs(days)} 天` : `再过 ${days} 天起雾`;
}

export function XiaobaiMemoryTab({ data, slice, topic, inlinePause, addSignal, onOpenTopic, onView, dock = false }: Props) {
  const level = useAppStore((st) => st.global.learningLevel);
  const items = useAppStore((st) => st.memory.items);
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
  const addInputRef = useRef<HTMLInputElement>(null);
  const seenSignal = useRef(addSignal);

  // 侧栏「添加一条记忆」：等输入框出现在页面上再聚焦（切片切换可能晚一拍）
  useEffect(() => {
    if (seenSignal.current === addSignal || !addInputRef.current) return;
    seenSignal.current = addSignal;
    addInputRef.current.scrollIntoView({ block: 'center' });
    addInputRef.current.focus();
  });

  const { lessons, mastered, cleared, quotes, demons, groups, profile, hasProfile, paused, nothingYet, titleOf } = data;
  const whole = slice === 'all';
  const show = (name: XiaobaiSlice) => whole || slice === name;

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

  const teachAction = (
    <Button variant="solid" icon={<GraduationCap size={16} strokeWidth={1.75} />} onClick={() => onView('feynman')}>
      去教小白
    </Button>
  );
  const addInput = (
    <Input
      ref={addInputRef}
      wrapClassName={s.addInput}
      leading={<Plus size={16} strokeWidth={1.75} />}
      value={draft}
      maxLength={60}
      placeholder="记一条给小白，比如：先生开讲前爱先问一句"
      aria-label="记一条给小白"
      onChange={(event) => setDraft(event.target.value)}
    />
  );
  const linkToggle = topic ? (
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
  ) : null;
  const visibleLessons = whole && !allLessons ? lessons.slice(0, LESSON_PREVIEW) : lessons;
  const visibleQuotes = whole && !allQuotes ? quotes.slice(0, QUOTE_PREVIEW) : quotes;

  return (
    <>
      {whole && (
        <section className={s.storyCard} data-story aria-label="小白的话">
          <XiaobaiAvatar mood={lessons.length > 0 ? 'happy' : 'curious'} level={level} size={72} />
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
      )}

      {whole && nothingYet && (
        <Empty
          icon={<GraduationCap size={22} strokeWidth={1.75} />}
          title="还没有课可以记"
          description="把一门课讲给小白听。讲完之后，他学到多少、过几天还记得多少、你打过的比方，都会出现在这里。"
          action={teachAction}
        />
      )}

      {show('lessons') && lessons.length > 0 && (
        <section className={s.section} aria-label="教过的课">
          {whole && (
            <div className={s.sectionHead}>
              <div>
                <h2>教过的课</h2>
                <p>每门课小白学到多少，隔了几天还记得多少。出师的课不复习会慢慢起雾。</p>
              </div>
            </div>
          )}
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
          {whole && lessons.length > LESSON_PREVIEW && (
            <Button className={s.more} size="sm" variant="ghost" onClick={() => setAllLessons((value) => !value)}>
              {allLessons ? '收起' : `查看其余 ${lessons.length - LESSON_PREVIEW} 门`}
            </Button>
          )}
        </section>
      )}
      {slice === 'lessons' && lessons.length === 0 && (
        <Empty
          icon={<GraduationCap size={22} strokeWidth={1.75} />}
          title="还没教过课"
          description="把一门课讲给小白听。讲完之后，他学到多少、过几天还记得多少，都会记在这里。"
          action={teachAction}
        />
      )}

      {show('quotes') && quotes.length > 0 && (
        <section className={s.section} aria-label="先生打过的比方">
          <div className={s.sectionHead}>
            <div>
              <h2>先生打过的比方</h2>
              <p>讲得最妙的几句，小白原样抄在小本子上。</p>
            </div>
          </div>
          <ul className={s.quoteWall}>
            {visibleQuotes.map((quote) => {
              const title = titleOf(quote.topicId);
              return (
                <li key={quote.id} className={s.quoteNote} data-story>
                  <blockquote>「{quote.text}」</blockquote>
                  <footer>{title ? `讲《${title}》时 · ` : ''}{relDay(quote.t)}</footer>
                </li>
              );
            })}
          </ul>
          {whole && quotes.length > QUOTE_PREVIEW && (
            <Button className={s.more} size="sm" variant="ghost" onClick={() => setAllQuotes((value) => !value)}>
              {allQuotes ? '收起' : `查看其余 ${quotes.length - QUOTE_PREVIEW} 句`}
            </Button>
          )}
        </section>
      )}
      {slice === 'quotes' && demons.length > 0 && (
        <section className={s.section} aria-label="清掉的心魔">
          <div className={s.sectionHead}>
            <div>
              <h2>清掉的心魔</h2>
              <p>小白原本想错的地方，被你讲明白了。</p>
            </div>
          </div>
          <div className={s.bond}>
            <dl className={s.demonRows}>
              {demons.map((entry) => (
                <div key={entry.topicId}>
                  <dt>{entry.title}</dt>
                  <dd className={s.chips}>
                    {entry.names.map((name) => <span key={name} className={`${s.chip} ${s.chipOk}`}>{name}</span>)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}
      {slice === 'quotes' && quotes.length === 0 && demons.length === 0 && (
        <Empty
          icon={<GraduationCap size={22} strokeWidth={1.75} />}
          title="还没有金句和心魔"
          description="讲课时打个好比方，小白会原样抄下来；他想错的地方被你纠正，也会记在这里。"
          action={teachAction}
        />
      )}

      {show('profile') && hasProfile && profile && (
        <section className={s.section} aria-label="小白眼里的先生">
          {whole && (
            <div className={s.sectionHead}>
              <div>
                <h2>小白眼里的先生</h2>
                <p>小白根据上过的课，对你讲课方式的归纳。</p>
              </div>
            </div>
          )}
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
      {slice === 'profile' && !hasProfile && (
        <Empty
          icon={<GraduationCap size={22} strokeWidth={1.75} />}
          title="小白还没看清先生"
          description="上过一两堂课，小白才会写下对你讲课方式的印象：讲法、长处、短板和节奏。"
          action={teachAction}
        />
      )}

      {show('items') && (
        <section className={s.section} aria-label="小白记得的事">
          {(whole || inlinePause) && (
            <div className={s.sectionHead}>
              <div>
                <h2>小白记得的事</h2>
                <p>
                  {paused
                    ? '记忆已暂停：这段时间上的课，小白不会再记。'
                    : '上课时一条一条记下的。写得不对可以改，不想让他用可以隐藏。'}
                </p>
              </div>
              {inlinePause && (
                <div className={s.sectionSide}>
                  <label htmlFor="xiaobai-memory-pause">暂停记忆</label>
                  <Switch id="xiaobai-memory-pause" checked={paused} onCheckedChange={setMemoryPaused} label="暂停小白的记忆" />
                </div>
              )}
            </div>
          )}

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

          {!dock && (
            <form className={s.add} onSubmit={submit}>
              {addInput}
              <div className={s.addSide}>
                {linkToggle}
                <Button type="submit" variant="soft" disabled={!draft.trim()}>记下</Button>
              </div>
            </form>
          )}
        </section>
      )}

      {whole && (
        <Link to="/growth#memory" className={s.growthLink}>
          <div>
            <strong>翻开成长册</strong>
            <span>完整的四层记忆、每堂课的记录和小白的日记都在那里。</span>
          </div>
          <ArrowRight size={18} strokeWidth={1.75} />
        </Link>
      )}

      {dock && show('items') && (
        <form className={s.dock} onSubmit={submit}>
          {draft.trim() && linkToggle && <div className={s.dockOpts}>{linkToggle}</div>}
          <div className={s.dockRow}>
            {addInput}
            <Button type="submit" variant="solid" disabled={!draft.trim()}>记下</Button>
          </div>
        </form>
      )}
    </>
  );
}
