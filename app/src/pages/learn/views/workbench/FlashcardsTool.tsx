import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleCheck, Pencil, Play, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Button, Dialog, Field, IconButton, Input, Kbd, Progress, Segmented, Textarea, toast } from '../../../../components/ui';
import { dueCards, newCard, scheduleCard, studyData, useStudyData, type CardRating, type Deck, type Flashcard } from '../../../../store/studyData';
import { DetailHead, GenerateDialog, ICON_SM, OriginBadge, SplitLayout, ToolHead, removeWithUndo, type Entry, type ToolProps } from './shared';
import { addDays, clip, dayKey, dayLabel, matches, spanLabel, useAutosave, useHotkeys, useWorkbenchNav, weekday } from './util';
import s from './workbench.module.css';
import f from './flashcards.module.css';

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
  const { owner, topic, activeId } = props;
  const { go } = useWorkbenchNav();
  const { decks } = useStudyData(owner);
  const [genOpen, setGenOpen] = useState(false);

  const entries = useMemo<Entry[]>(() => [...decks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((deck) => {
      const due = dueCards(deck).length;
      return {
        id: deck.id,
        title: deck.title,
        origin: deck.origin,
        topicId: deck.topicId,
        text: deck.cards.map((card) => `${card.front} ${card.back}`).join(' '),
        meta: <>{deck.cards.length} 张{due > 0 ? <b className={f.dueMeta}> · 待复习 {due}</b> : deck.cards.length > 0 && ' · 今天已复习完'}</>,
      };
    }), [decks]);

  const create = () => {
    const deck = studyData.saveDeck(owner, { title: topic ? `${topic.title} · 闪卡` : '', cards: [], ...(topic ? { topicId: topic.topicId } : {}) });
    go('flashcards', deck.id);
  };
  const remove = (id: string) => {
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    removeWithUndo(deck.title, () => studyData.removeDeck(owner, id), () => studyData.saveDeck(owner, deck));
    if (activeId === id) go('flashcards', null, true);
  };

  return (
    <>
      <ToolHead tool="flashcards">
        <Button variant="soft" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>AI 生成</Button>
        <Button variant="outline" icon={<Plus {...ICON_SM} />} onClick={create}>新建卡组</Button>
      </ToolHead>
      <SplitLayout
        tool="flashcards"
        entries={entries}
        activeId={activeId}
        topic={topic}
        empty={{
          title: '还没有闪卡',
          description: '一张卡考一个知识点。每次复习后按掌握程度评分，记得牢的卡会隔得越来越久才再出现。',
          action: (
            <>
              <Button variant="solid" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>从本课生成卡组</Button>
              <Button variant="soft" icon={<Plus {...ICON_SM} />} onClick={create}>自己做卡片</Button>
            </>
          ),
        }}
        onRename={(id, title) => {
          const deck = decks.find((item) => item.id === id);
          if (deck) studyData.saveDeck(owner, { ...deck, title });
        }}
        onDelete={remove}
      >
        {(id) => {
          const deck = decks.find((item) => item.id === id);
          return deck ? <DeckDetail key={deck.id} deck={deck} owner={owner} /> : null;
        }}
      </SplitLayout>
      <GenerateDialog kind="deck" open={genOpen} onOpenChange={setGenOpen} view={props} onCreated={(created) => go('flashcards', created.id)} />
    </>
  );
}

function DeckDetail({ deck, owner }: { deck: Deck; owner: string | null }) {
  const [title, setTitle] = useState(deck.title);
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

  if (session) {
    return (
      <div className={s.card}>
        <Review key={session.key} deck={deck} ids={session.ids} owner={owner} onExit={() => setSession(null)} />
      </div>
    );
  }

  const shown = deck.cards.filter((card) => matches(query, card.front, card.back));

  return (
    <div className={s.card}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<OriginBadge origin={deck.origin} />}>
        <Segmented
          size="sm"
          label="卡组视图"
          value={tab}
          onChange={setTab}
          options={[{ value: 'overview', label: '复习' }, { value: 'cards', label: `卡片 ${deck.cards.length}` }]}
        />
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
function Review({ deck, ids, owner, onExit }: { deck: Deck; ids: string[]; owner: string | null; onExit: () => void }) {
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

  const rate = (rating: CardRating) => {
    if (!card || !flipped) return;
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
    <div className={f.review}>
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
