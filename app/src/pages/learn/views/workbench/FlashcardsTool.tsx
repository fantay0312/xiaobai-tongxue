import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, Pencil, Play, Plus, Search, Trash2, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Button, Dialog, Field, IconButton, Input, Kbd, Progress, Segmented, Textarea, toast } from '../../../../components/ui';
import { IconSpark } from '../../../../components/ui/icons';
import { logActivity } from '../../../../engine/activityLog';
import { dueCards, newCard, scheduleCard, studyData, useStudyData, type CardRating, type Deck, type Flashcard } from '../../../../store/studyData';
import { AiBlock, ItemOrigin, SendMenu, useAiRun, type AiBlockAction } from './AiKit';
import { useAiFocus } from './AskPanel';
import { CARD_ACTIONS, runCardAction, weakCards, weakNote, type CardAction } from './ai';
import { itemKey, setItemOrigin } from './origins';
import { DetailHead, ICON_SM, ToolFrame, type ToolProps } from './shared';
import { addDays, clip, dayKey, dayLabel, matches, spanLabel, useAutosave, useHotkeys, useWorkbenchNav, weekday } from './util';
import s from './workbench.module.css';
import f from './flashcards.module.css';
import a from './ai.module.css';

const deckMarkdown = (deck: Deck) => deck.cards.map((card, index) => `${index + 1}. 问：${card.front}\n   答：${card.back}`).join('\n\n');

const RATINGS: { value: CardRating; label: string; tone: 'bad' | 'warn' | 'accent' | 'ok'; key: string }[] = [
  { value: 'again', label: '重来', tone: 'bad', key: '1' },
  { value: 'hard', label: '困难', tone: 'warn', key: '2' },
  { value: 'good', label: '良好', tone: 'accent', key: '3' },
  { value: 'easy', label: '简单', tone: 'ok', key: '4' },
];
const dueTime = (card: Flashcard) => {
  const time = Date.parse(card.due);
  return Number.isNaN(time) ? 0 : time;
};
/** 评分后多久再见到这张卡 */
const intervalHint = (card: Flashcard, rating: CardRating) => {
  const now = new Date();
  return spanLabel(Date.parse(scheduleCard(card, rating, now).due) - now.getTime());
};

function forecast(deck: Deck) {
  const today = dayKey();
  return Array.from({ length: 7 }, (_, index) => {
    const key = dayKey(addDays(index));
    const count = deck.cards.filter((card) => {
      const due = dayKey(dueTime(card));
      return index === 0 ? due <= today : due === key;
    }).length;
    return { key, label: index === 0 ? '今天' : index === 1 ? '明天' : weekday(key), count };
  });
}
function nextDueText(deck: Deck): string {
  const now = Date.now();
  const future = deck.cards.map(dueTime).filter((time) => time > now).sort((a, b) => a - b);
  if (!future.length) return '';
  const first = future[0];
  const key = dayKey(first);
  if (key === dayKey()) return `下一张 ${spanLabel(first - now)}后到期`;
  return `${dayLabel(key)}有 ${future.filter((time) => dayKey(time) === key).length} 张到期`;
}

export default function FlashcardsTool(props: ToolProps) {
  const { owner } = props;
  const { decks } = useStudyData(owner);

  return (
    <ToolFrame
      tool="flashcards"
      view={props}
      empty={{
        title: '还没有闪卡',
        description: '一张卡考一个知识点。每次复习后按掌握程度评分，记得牢的卡会隔得越来越久才再出现。',
        primary: 'generate',
        generateLabel: '从本课生成卡组',
        createLabel: '自己做卡片',
      }}
    >
      {(id) => {
        const deck = decks.find((item) => item.id === id);
        return deck ? <DeckDetail key={deck.id} deck={deck} view={props} /> : null;
      }}
    </ToolFrame>
  );
}

function DeckDetail({ deck, view }: { deck: Deck; view: ToolProps }) {
  const { owner, topic, topics, askHere } = view;
  const { go } = useWorkbenchNav();
  const [title, setTitle] = useState(deck.title);
  const deckRef = useRef(deck);
  useEffect(() => { deckRef.current = deck; });
  const course = deck.topicId ? topics.find((item) => item.topicId === deck.topicId) ?? topic : topic;
  /* ── 把薄弱卡整理成笔记 ── */
  const noteAi = useAiRun();
  const [noteOpen, setNoteOpen] = useState(false);
  const weak = weakCards(deck);
  const writeWeakNote = () => {
    setNoteOpen(true);
    void noteAi.start((call) => weakNote(deckRef.current, weakCards(deckRef.current), { ...(course ? { topic: course } : {}) }, call));
  };
  const saveWeakNote = () => {
    const name = `${deck.title || '未命名卡组'} · 薄弱点`;
    const saved = studyData.saveNote(owner, { title: name, body: noteAi.state.text, tags: ['薄弱点'], ...(deck.topicId ? { topicId: deck.topicId } : {}) });
    setItemOrigin(owner, itemKey('note', saved.id), { section: 'workbench', label: `闪卡：${clip(deck.title || '未命名卡组', 24)}`, open: { view: 'workbench', params: { tool: 'flashcards', id: deck.id } } });
    noteAi.reset();
    setNoteOpen(false);
    toast.success(`已存为笔记《${clip(name, 18)}》`, { action: { label: '打开', onClick: () => go('notes', saved.id) } });
  };
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'overview' | 'cards'>(deck.cards.length ? 'overview' : 'cards');
  const [session, setSession] = useState<{ ids: string[]; key: number } | null>(null);
  const [editing, setEditing] = useState<Flashcard | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const saveTitle = useCallback((value: string) => {
    const current = studyData.get(owner).decks.find((item) => item.id === deck.id);
    if (current) studyData.saveDeck(owner, { ...current, title: value });
    setDirty(false);
  }, [owner, deck.id]);
  useAutosave(title, dirty, saveTitle);
  useEffect(() => {
    if (!dirty) setTitle(deck.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.title]);

  const due = dueCards(deck);
  const fresh = deck.cards.filter((card) => card.reps === 0 && card.lapses === 0).length;
  const solid = deck.cards.filter((card) => card.interval >= 21).length;
  const days = forecast(deck);
  const peak = Math.max(1, ...days.map((day) => day.count));
  const saveCards = (cards: Flashcard[]) => studyData.saveDeck(owner, { ...deck, title, cards });
  const start = (cards: Flashcard[]) => setSession({ ids: cards.map((card) => card.id), key: Date.now() });

  // 复习时由复习界面报告正在看的那张卡
  useAiFocus(session ? null : {
    kind: 'deck',
    id: deck.id,
    label: '闪卡',
    title,
    ...(deck.topicId ? { topicId: deck.topicId } : {}),
    getText: () => deckMarkdown(deckRef.current),
  });

  if (session) {
    return (
      <div className={s.card}>
        <Review key={session.key} deck={deck} ids={session.ids} view={view} onExit={() => setSession(null)} />
      </div>
    );
  }

  const shown = deck.cards.filter((card) => matches(query, card.front, card.back));

  return (
    <div className={s.card}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<ItemOrigin owner={owner} kind="deck" id={deck.id} origin={deck.origin} />}>
        <Segmented
          size="sm"
          label="卡组视图"
          value={tab}
          onChange={setTab}
          options={[{ value: 'overview', label: '复习' }, { value: 'cards', label: `卡片 ${deck.cards.length}` }]}
        />
        <IconButton label="问小砚" size="sm" onClick={() => askHere()}><IconSpark size={16} /></IconButton>
        <SendMenu view={view} item={{ kind: 'deck', id: deck.id, label: '闪卡', title, ...(deck.topicId ? { topicId: deck.topicId } : {}), text: () => deckMarkdown(deckRef.current) }} />
      </DetailHead>

      {tab === 'overview' ? (
        <div className={f.overview}>
          <div className={f.hero} data-clear={due.length === 0}>
            <div>
              {due.length > 0 ? (
                <>
                  <p className={f.heroNum}><b>{due.length}</b> 张待复习</p>
                  <p className={s.muted}>大约 {Math.max(1, Math.round(due.length * 0.3))} 分钟。先回忆，再翻面，按真实的掌握程度评分。</p>
                </>
              ) : deck.cards.length ? (
                <>
                  <p className={f.heroNum}><CircleCheck size={22} strokeWidth={1.75} />今天的复习做完了</p>
                  <p className={s.muted}>{nextDueText(deck) || '所有卡片都排到以后了。'}</p>
                </>
              ) : (
                <>
                  <p className={f.heroNum}>这组还没有卡片</p>
                  <p className={s.muted}>到「卡片」里添加，正面写问题，背面写答案。</p>
                </>
              )}
            </div>
            <div className={f.heroActions}>
              {due.length > 0 && <Button variant="solid" size="lg" icon={<Play {...ICON_SM} />} onClick={() => start(due)}>开始复习</Button>}
              {due.length === 0 && deck.cards.length > 0 && <Button variant="soft" size="lg" onClick={() => start(deck.cards)}>提前复习全部</Button>}
              {deck.cards.length === 0 && <Button variant="solid" size="lg" icon={<Plus {...ICON_SM} />} onClick={() => { setTab('cards'); setEditing('new'); }}>添加卡片</Button>}
            </div>
          </div>

          {weak.length > 0 && !noteOpen && (
            <div className={a.aiRow}>
              <span>有 {weak.length} 张卡反复记不住</span>
              <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={writeWeakNote}>把薄弱卡整理成笔记</Button>
              <Button variant="ghost" size="sm" onClick={() => start(weak)}>只复习这几张</Button>
            </div>
          )}
          {noteOpen && (
            <AiBlock
              state={noteAi.state}
              title="薄弱卡复习笔记"
              doing={`正在看这 ${weak.length} 张卡`}
              actions={[{ label: '存为笔记', primary: true, onClick: saveWeakNote }]}
              onRetry={() => void noteAi.retry()}
              onStop={noteAi.stop}
              onDiscard={() => { noteAi.reset(); setNoteOpen(false); }}
            />
          )}

          <div className={s.stats}>
            <div className={s.stat}><b>{deck.cards.length}</b><span>全部卡片</span></div>
            <div className={s.stat} data-tone={due.length ? 'accent' : undefined}><b>{due.length}</b><span>待复习</span></div>
            <div className={s.stat}><b>{fresh}</b><span>没学过</span></div>
            <div className={s.stat} data-tone={solid ? 'ok' : undefined}><b>{solid}</b><span>已记牢（间隔三周以上）</span></div>
          </div>

          <div className={f.forecast}>
            <h4>未来七天</h4>
            <div className={f.bars} role="img" aria-label={`未来七天到期：${days.map((day) => `${day.label} ${day.count} 张`).join('，')}`}>
              {days.map((day, index) => (
                <div key={day.key} className={f.bar} data-today={index === 0}>
                  <span className={f.barNum}>{day.count || ''}</span>
                  <span className={f.barTrack}><i style={{ height: `${day.count ? Math.max(8, (day.count / peak) * 100) : 0}%` }} /></span>
                  <span className={f.barLabel}>{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={f.cards}>
          <div className={f.cardsTools}>
            <Input size="sm" leading={<Search {...ICON_SM} />} placeholder="搜索卡片" aria-label="搜索卡片" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Button variant="solid" icon={<Plus {...ICON_SM} />} onClick={() => setEditing('new')}>添加卡片</Button>
          </div>
          {shown.length === 0 ? (
            <p className={f.none}>{deck.cards.length ? '没有匹配的卡片。' : '还没有卡片。正面写一个问题，背面写答案。'}</p>
          ) : (
            <ul className={f.cardList}>
              {shown.map((card) => {
                const time = dueTime(card);
                const overdue = time <= Date.now();
                return (
                  <li key={card.id} className={f.cardRow}>
                    <div className={f.cardFront}>{clip(card.front.replace(/\s+/g, ' '), 120)}</div>
                    <div className={f.cardBack}>{clip(card.back.replace(/\s+/g, ' '), 160)}</div>
                    <span className={f.cardDue} data-due={overdue}>{card.reps === 0 && card.lapses === 0 ? '新卡' : overdue ? '待复习' : dayLabel(dayKey(time))}</span>
                    <span className={f.cardActions}>
                      <IconButton label="编辑卡片" size="sm" onClick={() => setEditing(card)}><Pencil {...ICON_SM} /></IconButton>
                      <IconButton
                        label="删除卡片"
                        size="sm"
                        onClick={() => {
                          const before = deck.cards;
                          saveCards(before.filter((item) => item.id !== card.id));
                          toast('已删除这张卡片', { action: { label: '撤销', onClick: () => { studyData.saveDeck(owner, { ...deck, title, cards: before }); } } });
                        }}
                      >
                        <Trash2 {...ICON_SM} />
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <CardDialog
          card={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(front, back, more) => {
            if (editing === 'new') saveCards([...deck.cards, newCard(front, back)]);
            else saveCards(deck.cards.map((card) => (card.id === editing.id ? { ...card, front, back } : card)));
            if (!more) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CardDialog({ card, onSave, onClose }: { card: Flashcard | null; onSave: (front: string, back: string, more: boolean) => void; onClose: () => void }) {
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const valid = Boolean(front.trim() && back.trim());
  const submit = (more: boolean) => {
    if (!valid) return;
    onSave(front.trim(), back.trim(), more);
    if (more) { setFront(''); setBack(''); toast.success('已添加，继续写下一张'); }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={card ? '编辑卡片' : '添加卡片'}
      description="一张卡只考一个知识点，支持 Markdown 和公式。"
      footer={(
        <>
          <Button variant="soft" onClick={onClose}>{card ? '取消' : '完成'}</Button>
          {!card && <Button variant="soft" disabled={!valid} onClick={() => submit(true)}>保存并继续</Button>}
          <Button variant="solid" disabled={!valid} onClick={() => submit(false)}>保存</Button>
        </>
      )}
    >
      <div className={f.form}>
        <Field label="正面 · 问题">
          <Textarea rows={3} value={front} autoFocus placeholder="例如：浅拷贝和深拷贝的区别是什么？" onChange={(event) => setFront(event.target.value)} />
        </Field>
        <Field label="背面 · 答案">
          <Textarea rows={4} value={back} placeholder="先给结论，再给依据" onChange={(event) => setBack(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ── 复习 ── */
function Review({ deck, ids, view, onExit }: { deck: Deck; ids: string[]; view: ToolProps; onExit: () => void }) {
  const { owner, topic, topics } = view;
  const course = deck.topicId ? topics.find((item) => item.topicId === deck.topicId) ?? topic : topic;
  const ai = useAiRun();
  const [helper, setHelper] = useState<CardAction | null>(null);
  const lapsed = useRef<string[]>([]);
  const logged = useRef(false);
  const [queue, setQueue] = useState(ids);
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cleared, setCleared] = useState(0);
  const [tally, setTally] = useState<Record<CardRating, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const total = ids.length;
  const done = at >= queue.length;
  const card = done ? undefined : deck.cards.find((item) => item.id === queue[at]);

  // 复习途中卡片被删掉了：跳过
  useEffect(() => {
    if (!done && !card) setAt((value) => value + 1);
  }, [done, card]);

  const closeHelper = () => { ai.reset(); setHelper(null); };
  const runHelper = (action: CardAction) => {
    if (!card) return;
    setHelper(action);
    void ai.start((call) => runCardAction(action, card, { ...(course ? { topic: course } : {}) }, call));
  };
  /** 采纳 AI 的结果：换掉正面的问法，或者把讲解补到背面 */
  const patchCard = (patch: Partial<Pick<Flashcard, 'front' | 'back'>>, done: string) => {
    if (!card) return;
    const current = studyData.get(owner).decks.find((item) => item.id === deck.id);
    if (!current) return;
    const before = current.cards;
    studyData.saveDeck(owner, { ...current, cards: before.map((item) => (item.id === card.id ? { ...item, ...patch } : item)) });
    closeHelper();
    toast(done, { action: { label: '撤销', onClick: () => { const now = studyData.get(owner).decks.find((item) => item.id === deck.id); if (now) studyData.saveDeck(owner, { ...now, cards: before }); } } });
  };

  useAiFocus(done || !card ? null : {
    kind: 'deck',
    id: deck.id,
    label: '闪卡',
    title: deck.title,
    detail: clip(card.front.replace(/\s+/g, ' '), 80),
    ...(deck.topicId ? { topicId: deck.topicId } : {}),
    getText: () => (flipped ? `正在复习的卡：\n问：${card.front}\n答：${card.back}` : `正在复习的卡：\n问：${card.front}\n（还没有翻面。不要直接说出答案，给提示。答案是：${card.back}）`),
  });

  // 一轮复习结束：记一条学习行为，选过「重来」的卡算卡住的地方
  useEffect(() => {
    const reviewed = tally.again + tally.hard + tally.good + tally.easy;
    if (!done || logged.current || !reviewed) return;
    logged.current = true;
    logActivity(owner, {
      source: 'flashcards',
      summary: `闪卡《${clip(deck.title || '未命名卡组', 24)}》复习 ${ids.length} 张：重来 ${tally.again}、困难 ${tally.hard}、良好 ${tally.good}、简单 ${tally.easy}`,
      signal: tally.again > 0 ? 'struggle' : 'success',
      ...(lapsed.current.length ? { detail: `选了重来的卡：${[...new Set(lapsed.current)].map((front) => clip(front.replace(/\s+/g, ' '), 30)).join('；')}` } : {}),
      ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}),
      ref: { kind: 'deck', id: deck.id, title: deck.title },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const rate = (rating: CardRating) => {
    if (!card || !flipped) return;
    closeHelper();
    if (rating === 'again') lapsed.current.push(card.front);
    studyData.reviewCard(owner, deck.id, card.id, rating);
    setTally((current) => ({ ...current, [rating]: current[rating] + 1 }));
    // 「重来」的卡排到本轮末尾再过一遍
    if (rating === 'again') setQueue((current) => [...current, card.id]);
    else setCleared((value) => value + 1);
    setFlipped(false);
    setAt((value) => value + 1);
  };

  useHotkeys((event) => {
    if (done || !card) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setFlipped(true); return; }
    const rating = RATINGS.find((item) => item.key === event.key);
    if (rating) rate(rating.value);
  });

  if (done) {
    const reviewed = tally.again + tally.hard + tally.good + tally.easy;
    return (
      <div className={f.done}>
        <span className={f.doneIcon}><CircleCheck size={30} strokeWidth={1.75} /></span>
        <h3>这一轮复习完了</h3>
        <p className={s.muted}>共 {total} 张卡，翻了 {reviewed} 次。{nextDueText(deck)}</p>
        <div className={f.tally}>
          {RATINGS.map((rating) => (
            <span key={rating.value} data-tone={rating.tone}><b>{tally[rating.value]}</b>{rating.label}</span>
          ))}
        </div>
        <Button variant="solid" size="lg" onClick={onExit}>完成</Button>
      </div>
    );
  }
  if (!card) return null;

  return (
    <div className={f.review} data-wb-focus="">
      <div className={f.rTop}>
        <span className={f.rCount}>{Math.min(cleared + 1, total)} / {total}</span>
        <Progress value={cleared} max={total} className={f.rBar} label="复习进度" />
        <IconButton label="结束复习" size="sm" onClick={onExit}><X {...ICON_SM} /></IconButton>
      </div>

      <div className={f.stage}>
        <div
          key={`${card.id}:${at}`}
          className={f.flip}
          data-flipped={flipped}
          role="button"
          tabIndex={0}
          aria-label={flipped ? '卡片背面，点击翻回正面' : '卡片正面，点击翻面看答案'}
          onClick={(event) => {
            // 点卡片里的链接、选中文字时不翻面
            if ((event.target as HTMLElement).closest('a') || window.getSelection()?.toString()) return;
            setFlipped((value) => !value);
          }}
        >
          <div className={f.face} aria-hidden={flipped}>
            <span className={f.faceTag}>问题</span>
            <div className={f.faceText}><CoachMarkdown text={card.front} /></div>
            <span className={f.faceHint}>先在心里回答，再翻面</span>
          </div>
          <div className={`${f.face} ${f.back}`} aria-hidden={!flipped}>
            <span className={f.faceTag}>答案</span>
            <div className={f.faceText}><CoachMarkdown text={card.back} /></div>
          </div>
        </div>
      </div>

      <div className={f.aid}>
        {helper ? (
          <AiBlock
            state={ai.state}
            title={CARD_ACTIONS[helper].label}
            doing={CARD_ACTIONS[helper].doing}
            actions={((): AiBlockAction[] => {
              if (helper === 'rephrase') return [{ label: '用这个问法', primary: true, onClick: () => patchCard({ front: ai.state.text }, '已换成新的问法') }];
              if (helper === 'explain' && !ai.state.local) return [{ label: '补到答案后面', onClick: () => patchCard({ back: `${card.back.trim()}\n\n${ai.state.text}` }, '已补到这张卡的答案后面') }];
              return [];
            })()}
            onRetry={() => void ai.retry()}
            onStop={ai.stop}
            onDiscard={closeHelper}
          />
        ) : (
          <div className={a.aiRow} style={{ justifyContent: 'center' }}>
            {!flipped && <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={() => runHelper('hint')}>给个提示</Button>}
            <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={() => runHelper('rephrase')}>换个问法</Button>
            {flipped && <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={() => runHelper('explain')}>讲透这张卡</Button>}
          </div>
        )}
      </div>

      <div className={f.rFoot}>
        {flipped ? (
          <div className={f.ratings}>
            {RATINGS.map((rating) => (
              <button key={rating.value} type="button" className={f.rating} data-tone={rating.tone} onClick={() => rate(rating.value)}>
                <b>{rating.label}</b>
                <span>{intervalHint(card, rating.value)}后</span>
                <Kbd>{rating.key}</Kbd>
              </button>
            ))}
          </div>
        ) : (
          <Button variant="solid" size="lg" className={f.show} onClick={() => setFlipped(true)}>
            显示答案<Kbd>空格</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
