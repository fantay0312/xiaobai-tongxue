import { useEffect, useRef, useState } from 'react';
import { BookMarked, GalleryVerticalEnd, ListTodo, Sparkles } from 'lucide-react';
import { Button, Empty, Shimmer, toast } from '../../../../components/ui';
import { dueCards, type Origin, type StudyData } from '../../../../store/studyData';
import type { TerminalViewProps } from '../types';
import { createFromAI, isAbort, type GenKind } from './actions';
import { hasMaterial } from './generate';
import { ICON, ICON_SM, OriginBadge, TOOLS } from './shared';
import { TOOL_IDS, ago, clip, dayKey, dueDay, type ToolId } from './util';
import s from './workbench.module.css';

const PACK: GenKind[] = ['note', 'mindmap', 'quiz', 'deck', 'todos'];

export function Overview({ view, data, onGo }: {
  view: TerminalViewProps;
  data: StudyData;
  onGo: (tool: ToolId, id?: string | null) => void;
}) {
  const { owner, topic, selectedSources } = view;
  const today = dayKey();
  const [packing, setPacking] = useState<{ done: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const dueByDeck = data.decks.map((deck) => ({ deck, due: dueCards(deck).length })).sort((a, b) => b.due - a.due);
  const dueTotal = dueByDeck.reduce((sum, item) => sum + item.due, 0);
  const cardTotal = data.decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const openTodos = data.todos.filter((todo) => !todo.done);
  const todayTodos = openTodos.filter((todo) => { const day = dueDay(todo.due); return day !== null && day <= today; });
  const overdue = todayTodos.filter((todo) => (dueDay(todo.due) ?? today) < today).length;
  const wrongBySet = data.quizSets.map((set) => ({ set, wrong: set.wrongIds.length })).sort((a, b) => b.wrong - a.wrong);
  const wrongTotal = wrongBySet.reduce((sum, item) => sum + item.wrong, 0);
  const questionTotal = data.quizSets.reduce((sum, set) => sum + set.questions.length, 0);
  const lastWriting = [...data.writings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find((doc) => typeof doc.score === 'number');

  const tiles: Record<ToolId, { count: number; unit: string; sub: string; due?: boolean }> = {
    notes: { count: data.notes.length, unit: '篇', sub: data.notes[0] ? `最近：${data.notes[0].title || '未命名笔记'}` : TOOLS.notes.hint },
    mindmap: { count: data.mindmaps.length, unit: '张', sub: data.mindmaps[0] ? `最近：${data.mindmaps[0].title || '未命名导图'}` : TOOLS.mindmap.hint },
    quiz: { count: questionTotal, unit: '题', sub: wrongTotal ? `错题本 ${wrongTotal} 题待重做` : data.quizSets.length ? `${data.quizSets.length} 套题目集` : TOOLS.quiz.hint, due: wrongTotal > 0 },
    flashcards: { count: cardTotal, unit: '张', sub: dueTotal ? `今天待复习 ${dueTotal} 张` : cardTotal ? '今天已复习完' : TOOLS.flashcards.hint, due: dueTotal > 0 },
    todos: { count: openTodos.length, unit: '项', sub: todayTodos.length ? `今天 ${todayTodos.length} 项${overdue ? ` · 逾期 ${overdue}` : ''}` : openTodos.length ? '今天没有到期的事' : TOOLS.todos.hint, due: todayTodos.length > 0 },
    writing: { count: data.writings.length, unit: '篇', sub: lastWriting ? `最近一篇 ${lastWriting.score} 分` : TOOLS.writing.hint },
  };

  const recent: { tool: ToolId; id: string; title: string; at: string; origin: Origin }[] = [
    ...data.notes.map((item) => ({ tool: 'notes' as const, id: item.id, title: item.title || '未命名笔记', at: item.updatedAt, origin: item.origin })),
    ...data.mindmaps.map((item) => ({ tool: 'mindmap' as const, id: item.id, title: item.title || '未命名导图', at: item.updatedAt, origin: item.origin })),
    ...data.quizSets.map((item) => ({ tool: 'quiz' as const, id: item.id, title: item.title || '未命名题目集', at: item.updatedAt, origin: item.origin })),
    ...data.decks.map((item) => ({ tool: 'flashcards' as const, id: item.id, title: item.title || '未命名卡组', at: item.updatedAt, origin: item.origin })),
    ...data.writings.map((item) => ({ tool: 'writing' as const, id: item.id, title: item.title || '未命名写作', at: item.updatedAt, origin: item.origin })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const sources = selectedSources.filter((source) => source.content.trim());
  const canPack = hasMaterial({ topic, sources });

  /** 五种材料同时生成，各自成功各自入库；某一项模型没给出可用结果时，这一项改用本地演示 */
  const pack = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPacking({ done: 0 });
    const options = { quizCount: 8, deckCount: 12 };
    const results = await Promise.allSettled(PACK.map((kind) => createFromAI(kind, owner, { topic, sources, signal: controller.signal }, options)
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbort(reason)) throw reason;
        return createFromAI(kind, owner, { topic, sources, local: true }, options);
      })
      .finally(() => setPacking((current) => (current ? { done: current.done + 1 } : current)))));
    if (controller.signal.aborted) return;
    setPacking(null);
    const ok = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected' && !isAbort(result.reason)).length;
    const local = ok.some((result) => result.status === 'fulfilled' && result.value.local);
    if (!ok.length) { toast.error('这次没有生成成功，稍后再试，或到各个工具里单独生成。'); return; }
    toast.success(`学习包已生成：${ok.length} 项${failed ? `，${failed} 项没有成功` : ''}`, local ? { description: '当前没有可用模型，内容取自课程资料（本地演示）。' } : undefined);
  };

  return (
    <>
      <header className={s.hero}>
        <div>
          <h1>学习工作台</h1>
          <p>{topic ? `正在学《${clip(topic.title, 20)}》。笔记、导图、题目、闪卡、待办和写作都在这里。` : '笔记、导图、题目、闪卡、待办和写作都在这里，保存在当前浏览器。'}</p>
        </div>
      </header>

      {(dueTotal > 0 || todayTodos.length > 0 || wrongTotal > 0) && (
        <div className={s.today} aria-label="今天要做的事">
          {dueTotal > 0 && (
            <button type="button" className={s.todayItem} onClick={() => onGo('flashcards', dueByDeck[0]?.deck.id)}>
              <GalleryVerticalEnd {...ICON} />复习 <b>{dueTotal}</b> 张到期闪卡
            </button>
          )}
          {todayTodos.length > 0 && (
            <button type="button" className={s.todayItem} onClick={() => onGo('todos')}>
              <ListTodo {...ICON} />今天还有 <b>{todayTodos.length}</b> 项待办
            </button>
          )}
          {wrongTotal > 0 && (
            <button type="button" className={s.todayItem} onClick={() => onGo('quiz', wrongBySet[0]?.set.id)}>
              <BookMarked {...ICON} />重做 <b>{wrongTotal}</b> 道错题
            </button>
          )}
        </div>
      )}

      <div className={s.tiles}>
        {TOOL_IDS.map((id) => {
          const Icon = TOOLS[id].icon;
          const tile = tiles[id];
          return (
            <button key={id} type="button" className={s.tile} onClick={() => onGo(id)}>
              <span className={s.tileIcon}><Icon size={19} strokeWidth={1.75} /></span>
              <span className={s.tileCount}>{tile.count}<small>{tile.unit}</small></span>
              <span className={s.tileText}>
                <b>{TOOLS[id].name}</b>
                <span data-due={tile.due || undefined}>{tile.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {canPack && (
        <div className={s.pack}>
          <div>
            <b>{topic ? `为《${clip(topic.title, 16)}》备一套学习材料` : `用已选的 ${sources.length} 份资料备一套学习材料`}</b>
            <p>{packing ? <Shimmer>正在整理笔记、导图、题目、闪卡和待办（{packing.done} / {PACK.length}）…</Shimmer> : '一次生成要点笔记、思维导图、练习题、闪卡和学习待办，之后都可以再改。'}</p>
          </div>
          {packing
            ? <Button variant="soft" onClick={() => { abort.current?.abort(); setPacking(null); }}>取消</Button>
            : <Button variant="solid" icon={<Sparkles {...ICON_SM} />} onClick={() => void pack()}>生成学习包</Button>}
        </div>
      )}

      <section className={s.section}>
        <div className={s.sectionHead}><h3>最近</h3></div>
        {recent.length ? (
          <div className={s.recent}>
            {recent.map((item) => {
              const Icon = TOOLS[item.tool].icon;
              return (
                <button key={`${item.tool}:${item.id}`} type="button" className={s.recentRow} onClick={() => onGo(item.tool, item.id)}>
                  <Icon {...ICON} />
                  <span className={s.recentTitle}><span>{item.title}</span><OriginBadge origin={item.origin} /></span>
                  <span className={s.recentMeta}>{TOOLS[item.tool].name} · {ago(item.at)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={s.emptyCard}>
            <Empty
              title="这里还是空的"
              description={canPack ? '点上面的「生成学习包」，或者从任意一个工具开始。助理任务写入的内容也会出现在这里。' : '从上面任意一个工具开始。打开一门课后，可以一次生成整套学习材料。'}
              action={<Button variant={canPack ? 'soft' : 'solid'} onClick={() => onGo('notes')}>写一篇笔记</Button>}
            />
          </div>
        )}
      </section>
    </>
  );
}
