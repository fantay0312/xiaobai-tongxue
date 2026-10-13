import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookMarked, Check, CircleCheck, CircleX, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Badge, Button, Dialog, Field, IconButton, Input, Kbd, Progress, Segmented, Switch, Textarea, toast } from '../../../../components/ui';
import { IconFlashcard, IconSpark } from '../../../../components/ui/icons';
import { logActivity } from '../../../../engine/activityLog';
import { newId, studyData, useStudyData, type Flashcard, type QuestionType, type QuizQuestion, type QuizSet } from '../../../../store/studyData';
import { isAbort } from './actions';
import { AiBlock, ItemOrigin, SendMenu, useAiRun } from './AiKit';
import { useAiFocus } from './AskPanel';
import {
  LETTERS, TYPE_LABEL, aiErrorText, answerText, explainWrong, isChoice, keyOf, optionsOf, questionText, referenceOf, reinforceQuiz, similarQuestion, wrongCards,
} from './ai';
import { QUESTION_TYPES, TRUE_FALSE } from './generate';
import { itemKey, setItemOrigin } from './origins';
import { DetailHead, ICON_SM, ToolFrame, type ToolProps } from './shared';
import { clip, useAutosave, useHotkeys, useWorkbenchNav } from './util';
import s from './workbench.module.css';
import q from './quiz.module.css';
import a from './ai.module.css';

type Answer = number[] | string;
const fold = (text: string) => text.toLowerCase().replace(/[\s，。,.;；:：!！?？"'“”‘’（）()、]/g, '');

/** true/false 为自动判分；null 表示简答题，需要对照参考答案自评 */
function grade(question: QuizQuestion, answer: Answer | undefined): boolean | null {
  if (isChoice(question.type)) {
    const picked = Array.isArray(answer) ? [...answer].sort((a, b) => a - b) : [];
    const key = [...keyOf(question)].sort((a, b) => a - b);
    return picked.length === key.length && picked.every((value, index) => value === key[index]);
  }
  if (question.type === 'short') return null;
  const mine = fold(typeof answer === 'string' ? answer : '');
  const accepted = referenceOf(question).split(/[|｜;；/]|或者?/).map(fold).filter(Boolean);
  return Boolean(mine) && accepted.some((item) => item === mine);
}
const lastScore = (set: QuizSet) => {
  const last = set.attempts[set.attempts.length - 1];
  return last && last.total ? Math.round((last.correct / last.total) * 100) : null;
};

/** 整套题的可读文本：给「问小砚」和「发送到」用 */
const setMarkdown = (set: QuizSet) => set.questions.map((question, index) => `${index + 1}. ${questionText(question)}\n   答案：${referenceOf(question)}${question.explanation ? `\n   解析：${question.explanation}` : ''}`).join('\n\n');

/** 错题卡收进同一个卡组：「<题目集> · 错题卡」，没有就新建 */
function saveWrongCards(owner: string | null, set: QuizSet, cards: Flashcard[]): { id: string; title: string } {
  const title = `${set.title || '未命名题目集'} · 错题卡`;
  const existing = studyData.get(owner).decks.find((deck) => deck.title === title);
  const fronts = new Set(existing?.cards.map((card) => card.front));
  const fresh = cards.filter((card) => !fronts.has(card.front));
  const saved = studyData.saveDeck(owner, { ...(existing ?? {}), title, cards: [...(existing?.cards ?? []), ...fresh], ...(set.topicId ? { topicId: set.topicId } : {}) });
  setItemOrigin(owner, itemKey('deck', saved.id), { section: 'workbench', label: `题目集：${clip(set.title || '未命名题目集', 24)}`, open: { view: 'workbench', params: { tool: 'quiz', id: set.id } } });
  return { id: saved.id, title };
}

export default function QuizTool(props: ToolProps) {
  const { owner } = props;
  const { quizSets } = useStudyData(owner);

  return (
    <ToolFrame
      tool="quiz"
      view={props}
      empty={{
        title: '还没有题目集',
        description: '做题是检验是否真懂的最快办法。让小砚按本课出一套题，做错的会自动进错题本。',
        primary: 'generate',
        generateLabel: '从本课出一套题',
        createLabel: '自己录题',
      }}
    >
      {(id) => {
        const set = quizSets.find((item) => item.id === id);
        return set ? <QuizDetail key={set.id} set={set} view={props} /> : null;
      }}
    </ToolFrame>
  );
}

function QuizDetail({ set, view }: { set: QuizSet; view: ToolProps }) {
  const { owner } = view;
  const { go } = useWorkbenchNav();
  const [title, setTitle] = useState(set.title);
  const [busy, setBusy] = useState(false);
  const setRef = useRef(set);
  useEffect(() => { setRef.current = set; });
  const [dirty, setDirty] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [run, setRun] = useState<{ ids: string[]; wrongOnly: boolean; key: number } | null>(null);
  const [editing, setEditing] = useState<QuizQuestion | 'new' | null>(null);

  const saveTitle = useCallback((value: string) => {
    const current = studyData.get(owner).quizSets.find((item) => item.id === set.id);
    if (current) studyData.saveQuizSet(owner, { ...current, title: value });
    setDirty(false);
  }, [owner, set.id]);
  useAutosave(title, dirty, saveTitle);
  useEffect(() => {
    if (!dirty) setTitle(set.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.title]);

  const wrong = set.questions.filter((question) => set.wrongIds.includes(question.id));
  const score = lastScore(set);
  const best = set.attempts.reduce((max, attempt) => (attempt.total ? Math.max(max, Math.round((attempt.correct / attempt.total) * 100)) : max), 0);
  const saveQuestions = (questions: QuizQuestion[]) => studyData.saveQuizSet(owner, { ...set, title, questions, wrongIds: set.wrongIds.filter((id) => questions.some((question) => question.id === id)) });
  const start = (wrongOnly: boolean) => setRun({ ids: (wrongOnly ? wrong : set.questions).map((question) => question.id), wrongOnly, key: Date.now() });

  // 练习时由练习界面报告正在做的那道题
  useAiFocus(run ? null : {
    kind: 'quiz',
    id: set.id,
    label: '题目集',
    title,
    ...(set.topicId ? { topicId: set.topicId } : {}),
    getText: () => setMarkdown(setRef.current),
  });

  const cardsFromWrong = (questions: QuizQuestion[]) => {
    if (!questions.length) return;
    const deck = saveWrongCards(owner, setRef.current, wrongCards(questions));
    toast.success(`${questions.length} 道错题已做成闪卡`, { description: `收在《${clip(deck.title, 20)}》里，今天就可以复习。`, action: { label: '打开', onClick: () => go('flashcards', deck.id) } });
  };
  /** 根据错题出一套巩固卷：新建一套题，来源指回这一套 */
  const reinforce = async (questions: QuizQuestion[]) => {
    if (!questions.length || busy) return;
    setBusy(true);
    const id = toast.loading('正在根据错题出巩固卷…');
    try {
      const current = setRef.current;
      const made = await reinforceQuiz(current.title, questions);
      if (!made.questions.length) throw new Error('gen-empty');
      const saved = studyData.saveQuizSet(owner, { title: made.title, questions: made.questions, ...(current.topicId ? { topicId: current.topicId } : {}) });
      setItemOrigin(owner, itemKey('quiz', saved.id), { section: 'workbench', label: `题目集：${clip(current.title || '未命名题目集', 20)} 的错题`, open: { view: 'workbench', params: { tool: 'quiz', id: current.id } } });
      toast.success(`巩固卷出好了，共 ${saved.questions.length} 题`, {
        id,
        description: made.local ? '本地演示：没有模型，这一套是把错题打乱选项重排的。' : undefined,
        action: { label: '打开', onClick: () => go('quiz', saved.id) },
      });
    } catch (reason) {
      if (!isAbort(reason)) toast.error(aiErrorText(reason), { id });
    } finally {
      setBusy(false);
    }
  };

  if (run) {
    return (
      <div className={s.card}>
        <Practice key={run.key} set={set} ids={run.ids} wrongOnly={run.wrongOnly} view={view} onExit={() => setRun(null)} onRestart={start} onCards={cardsFromWrong} onReinforce={(questions) => void reinforce(questions)} />
      </div>
    );
  }

  return (
    <div className={s.card}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<ItemOrigin owner={owner} kind="quiz" id={set.id} origin={set.origin} />}>
        <label className={q.reveal}>
          <Switch checked={reveal} onCheckedChange={setReveal} label="显示答案" />显示答案
        </label>
        <IconButton label="问小砚" size="sm" onClick={() => view.askHere()}><IconSpark size={16} /></IconButton>
        <SendMenu view={view} item={{ kind: 'quiz', id: set.id, label: '题目集', title, ...(set.topicId ? { topicId: set.topicId } : {}), text: () => setMarkdown(setRef.current) }} />
      </DetailHead>

      <div className={q.summary}>
        <div className={s.stats}>
          <div className={s.stat}><b>{set.questions.length}</b><span>题目</span></div>
          <div className={s.stat} data-tone={score !== null && score >= 80 ? 'ok' : undefined}><b>{score === null ? '—' : `${score}%`}</b><span>上次得分</span></div>
          <div className={s.stat}><b>{set.attempts.length ? `${best}%` : '—'}</b><span>最好成绩 · 练过 {set.attempts.length} 次</span></div>
          <div className={s.stat} data-tone={wrong.length ? 'bad' : undefined}><b>{wrong.length}</b><span>错题本</span></div>
        </div>
        <div className={q.cta}>
          <Button variant="solid" size="lg" icon={<Play {...ICON_SM} />} disabled={!set.questions.length} onClick={() => start(false)}>开始练习</Button>
          <Button variant="soft" size="lg" icon={<BookMarked {...ICON_SM} />} disabled={!wrong.length} onClick={() => start(true)}>
            只练错题{wrong.length > 0 && ` · ${wrong.length}`}
          </Button>
          <Button variant="ghost" size="lg" icon={<Plus {...ICON_SM} />} onClick={() => setEditing('new')}>添加题目</Button>
        </div>
        {wrong.length > 0 && (
          <div className={a.aiRow}>
            <span>错题本里有 {wrong.length} 道题</span>
            <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} loading={busy} onClick={() => void reinforce(wrong)}>根据错题出一套巩固卷</Button>
            <Button variant="ghost" size="sm" icon={<IconFlashcard size={16} />} onClick={() => cardsFromWrong(wrong)}>把错题做成闪卡</Button>
          </div>
        )}
      </div>

      {set.questions.length === 0 ? (
        <p className={q.none}>这套题还是空的。点「添加题目」录入第一道题。</p>
      ) : (
        <ol className={q.list}>
          {set.questions.map((question, index) => {
            const options = optionsOf(question);
            const key = keyOf(question);
            return (
              <li key={question.id} className={q.item}>
                <div className={q.itemHead}>
                  <span className={q.no}>{index + 1}</span>
                  <Badge>{TYPE_LABEL[question.type] ?? '题目'}</Badge>
                  {set.wrongIds.includes(question.id) && <Badge tone="bad" dot>做错过</Badge>}
                  <span className={q.itemActions}>
                    <IconButton label="编辑题目" size="sm" onClick={() => setEditing(question)}><Pencil {...ICON_SM} /></IconButton>
                    <IconButton
                      label="删除题目"
                      size="sm"
                      onClick={() => {
                        const before = set.questions;
                        saveQuestions(before.filter((item) => item.id !== question.id));
                        toast('已删除这道题', { action: { label: '撤销', onClick: () => { studyData.saveQuizSet(owner, { ...set, title, questions: before }); } } });
                      }}
                    >
                      <Trash2 {...ICON_SM} />
                    </IconButton>
                  </span>
                </div>
                <div className={q.stem}><CoachMarkdown text={question.stem} /></div>
                {options.length > 0 && (
                  <ul className={q.plainOpts}>
                    {options.map((option, at) => (
                      <li key={at} data-right={reveal && key.includes(at)}>
                        <span>{question.type === 'truefalse' ? (at === 0 ? '✓' : '✗') : LETTERS[at]}</span>{option}
                      </li>
                    ))}
                  </ul>
                )}
                {reveal && (
                  <div className={q.answer}>
                    {!isChoice(question.type) && <p><b>参考答案</b>{referenceOf(question)}</p>}
                    {question.explanation && <CoachMarkdown text={question.explanation} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editing && (
        <QuestionDialog
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(question) => {
            saveQuestions(editing === 'new' ? [...set.questions, question] : set.questions.map((item) => (item.id === question.id ? question : item)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ── 练习 ── */
function Practice({ set, ids, wrongOnly, view, onExit, onRestart, onCards, onReinforce }: {
  set: QuizSet;
  ids: string[];
  wrongOnly: boolean;
  view: ToolProps;
  onExit: () => void;
  onRestart: (wrongOnly: boolean) => void;
  onCards: (questions: QuizQuestion[]) => void;
  onReinforce: (questions: QuizQuestion[]) => void;
}) {
  const { owner, topic, topics, askHere } = view;
  // 练习开始时把题目定下来，练习中题目集被外部改动也不影响这一轮
  const [questions, setQuestions] = useState(() => ids.flatMap((id) => set.questions.find((question) => question.id === id) ?? []));
  const course = set.topicId ? topics.find((item) => item.topicId === set.topicId) ?? topic : topic;
  /* ── 答错之后：讲解这道题、再出一道同类题 ── */
  const explain = useAiRun();
  const similar = useAiRun();
  const [helper, setHelper] = useState<'explain' | 'similar' | null>(null);
  const drafted = useRef<QuizQuestion | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const question = questions[index];
  const total = questions.length;

  const finish = (finalMarks: Record<string, boolean>) => {
    const wrongNow = questions.filter((item) => !finalMarks[item.id]).map((item) => item.id);
    const rightNow = new Set(questions.filter((item) => finalMarks[item.id]).map((item) => item.id));
    // 只练错题时：做对的移出错题本，其余保留
    const wrongIds = wrongOnly ? [...new Set([...set.wrongIds.filter((id) => !rightNow.has(id)), ...wrongNow])] : wrongNow;
    studyData.recordQuizAttempt(owner, set.id, { at: new Date().toISOString(), answers, correct: rightNow.size, total }, wrongIds);
    const missedNow = questions.filter((item) => !finalMarks[item.id]);
    logActivity(owner, {
      source: 'quiz',
      summary: `做了《${clip(set.title || '未命名题目集', 24)}》${wrongOnly ? '的错题' : ''}：${total} 题对 ${rightNow.size} 题`,
      signal: total > 0 && rightNow.size / total >= 0.8 ? 'success' : 'struggle',
      ...(missedNow.length ? { detail: `做错的题：${missedNow.map((item) => clip(item.stem.replace(/\s+/g, ' '), 40)).join('；')}` } : {}),
      ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}),
      ref: { kind: 'quiz', id: set.id, title: set.title },
    });
    setDone(true);
  };
  const closeHelper = () => { explain.reset(); similar.reset(); drafted.current = null; setHelper(null); };

  const check = () => {
    if (!question || checked) return;
    const value = answers[question.id];
    const empty = value === undefined || (Array.isArray(value) ? value.length === 0 : !value.trim());
    if (empty && question.type !== 'short') { toast('先作答，再检查答案'); return; }
    const verdict = grade(question, value);
    if (verdict !== null) setMarks((current) => ({ ...current, [question.id]: verdict }));
    setChecked(true);
  };
  const next = () => {
    if (!question || marks[question.id] === undefined) return;
    closeHelper();
    if (index + 1 < total) { setIndex(index + 1); setChecked(false); }
    else finish(marks);
  };

  useAiFocus(done || !question ? null : {
    kind: 'quiz',
    id: set.id,
    label: '题目集',
    title: set.title,
    detail: clip(question.stem.replace(/\s+/g, ' '), 80),
    ...(set.topicId ? { topicId: set.topicId } : {}),
    getText: () => `正在做第 ${index + 1} / ${total} 题：\n${questionText(question)}${checked ? `\n\n我的答案：${answerText(question, answers[question.id])}\n正确答案：${referenceOf(question)}${question.explanation ? `\n解析：${question.explanation}` : ''}` : '\n\n（还没有作答，不要直接说出答案，给思路。）'}`,
  });

  const runExplain = () => {
    if (!question) return;
    setHelper('explain');
    void explain.start((call) => explainWrong({ question, mine: answers[question.id], context: { ...(course ? { topic: course } : {}) } }, call));
  };
  const runSimilar = () => {
    if (!question) return;
    setHelper('similar');
    drafted.current = null;
    void similar.start(async (call) => {
      const made = await similarQuestion(question, call.signal);
      drafted.current = made.question;
      const options = made.question.type === 'truefalse' ? '' : optionsOf(made.question).map((option, at) => `- ${LETTERS[at]}. ${option}`).join('\n');
      return {
        text: `**${TYPE_LABEL[made.question.type]}** · ${made.question.stem}${options ? `\n\n${options}` : ''}`,
        local: made.local,
        ...(made.local ? { note: '本地演示：没有模型，这是把原题的选项打乱后再出一遍。' } : {}),
      };
    });
  };
  /** 同类题收进题目集；next=true 时排到这一轮的下一题 */
  const keepSimilar = (next: boolean) => {
    const made = drafted.current;
    if (!made) return;
    const current = studyData.get(owner).quizSets.find((item) => item.id === set.id);
    if (current) studyData.saveQuizSet(owner, { ...current, questions: [...current.questions, made] });
    if (next) setQuestions((list) => [...list.slice(0, index + 1), made, ...list.slice(index + 1)]);
    closeHelper();
    toast.success(next ? '已加入题目集，下一题就做它' : '已加入题目集');
  };
  const saveExplanation = () => {
    if (!question) return;
    const current = studyData.get(owner).quizSets.find((item) => item.id === set.id);
    if (current) studyData.saveQuizSet(owner, { ...current, questions: current.questions.map((item) => (item.id === question.id ? { ...item, explanation: explain.state.text } : item)) });
    toast.success('已存为这道题的解析');
  };
  const pick = (at: number) => {
    if (!question || checked) return;
    setAnswers((current) => {
      const mine = Array.isArray(current[question.id]) ? (current[question.id] as number[]) : [];
      const value = question.type === 'multiple' ? (mine.includes(at) ? mine.filter((item) => item !== at) : [...mine, at]) : [at];
      return { ...current, [question.id]: value };
    });
  };

  useHotkeys((event) => {
    if (done || !question) return;
    if (event.key === 'Enter') { event.preventDefault(); if (checked) next(); else check(); return; }
    const at = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : LETTERS.indexOf(event.key.toUpperCase());
    if (isChoice(question.type) && at >= 0 && at < optionsOf(question).length) pick(at);
  });

  if (!total) {
    return <div className={q.done}><p className={s.muted}>没有可以练的题目。</p><Button variant="soft" onClick={onExit}>返回</Button></div>;
  }

  if (done) {
    const correct = questions.filter((item) => marks[item.id]).length;
    const percent = Math.round((correct / total) * 100);
    const missed = questions.filter((item) => !marks[item.id]);
    const line = percent === 100 ? '全对。可以把这一课讲给小白听了。' : percent >= 80 ? '掌握得不错，把错的几道再过一遍。' : percent >= 60 ? '基本过关，错题值得再练一轮。' : '还不稳。先回讲义看一遍，再来练错题。';
    return (
      <div className={q.done}>
        <ScoreRing percent={percent} />
        <h3>答对 {correct} / {total}</h3>
        <p className={s.muted}>{line}</p>
        <div className={q.cta} data-center="true">
          {missed.length > 0 && <Button variant="solid" icon={<BookMarked {...ICON_SM} />} onClick={() => onRestart(true)}>只练错题 · {missed.length}</Button>}
          <Button variant={missed.length ? 'soft' : 'solid'} icon={<RotateCcw {...ICON_SM} />} onClick={() => onRestart(false)}>再练一遍</Button>
          <Button variant="ghost" onClick={onExit}>回到题目</Button>
        </div>
        {missed.length > 0 && (
          <div className={a.aiRow} style={{ justifyContent: 'center' }}>
            <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={() => onReinforce(missed)}>根据错题出一套巩固卷</Button>
            <Button variant="ghost" size="sm" icon={<IconFlashcard size={16} />} onClick={() => onCards(missed)}>把错题做成闪卡</Button>
          </div>
        )}
        {missed.length > 0 && (
          <ul className={q.missed}>
            {missed.map((item) => (
              <li key={item.id}>
                <CircleX size={16} strokeWidth={1.75} />
                <div>
                  <p>{clip(item.stem.replace(/\s+/g, ' '), 90)}</p>
                  <span>正确答案：{clip(referenceOf(item), 120) || '见解析'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const options = optionsOf(question);
  const key = keyOf(question);
  const mine = answers[question.id];
  const picked = Array.isArray(mine) ? mine : [];
  const verdict = marks[question.id];
  const selfGrade = checked && verdict === undefined;

  return (
    <div className={q.practice} data-wb-focus="">
      <div className={q.pTop}>
        <span className={q.pCount}>{wrongOnly ? '错题本 · ' : ''}第 {index + 1} / {total} 题</span>
        <Progress value={index + (checked ? 1 : 0)} max={total} className={q.pBar} label="练习进度" />
        <IconButton label="退出练习" size="sm" onClick={onExit}><X {...ICON_SM} /></IconButton>
      </div>

      <div className={q.pBody} key={question.id}>
        <div className={q.itemHead}>
          <Badge tone="accent">{TYPE_LABEL[question.type] ?? '题目'}</Badge>
          {question.difficulty && <span className={q.level} aria-label={`难度 ${question.difficulty}`}>{'●'.repeat(question.difficulty)}{'○'.repeat(3 - question.difficulty)}</span>}
        </div>
        <div className={`${q.pStem} ${s.prose}`}><CoachMarkdown text={question.stem} /></div>

        {isChoice(question.type) && (
          <div className={q.opts} role={question.type === 'multiple' ? 'group' : 'radiogroup'} aria-label="选项">
            {options.map((option, at) => {
              const on = picked.includes(at);
              const state = !checked ? undefined : key.includes(at) ? (on ? 'right' : 'missed') : on ? 'wrong' : undefined;
              return (
                <button
                  key={at}
                  type="button"
                  className={q.opt}
                  role={question.type === 'multiple' ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  data-state={state}
                  aria-disabled={checked || undefined}
                  onClick={() => pick(at)}
                >
                  <span className={q.mark} data-square={question.type === 'multiple'}>
                    {state === 'right' || state === 'missed' ? <Check size={13} strokeWidth={2.5} /> : state === 'wrong' ? <X size={13} strokeWidth={2.5} /> : LETTERS[at]}
                  </span>
                  <span className={q.optText}>{option}</span>
                </button>
              );
            })}
          </div>
        )}
        {question.type === 'multiple' && !checked && <p className={q.tip}>多选题，选出所有正确的选项。</p>}
        {question.type === 'blank' && (
          <Input
            value={typeof mine === 'string' ? mine : ''}
            placeholder="填入答案，按回车检查"
            readOnly={checked}
            invalid={checked && verdict === false}
            aria-label="填空答案"
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              if (checked) next(); else check();
            }}
          />
        )}
        {question.type === 'short' && (
          <Textarea
            rows={5}
            value={typeof mine === 'string' ? mine : ''}
            placeholder="用自己的话作答，然后对照参考答案"
            readOnly={checked}
            aria-label="简答"
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
          />
        )}

        {checked && (
          <div className={q.result} data-tone={verdict === undefined ? 'neutral' : verdict ? 'ok' : 'bad'}>
            <p className={q.verdict}>
              {verdict === undefined ? '对照参考答案，自己判断' : verdict ? <><CircleCheck {...ICON_SM} />答对了</> : <><CircleX {...ICON_SM} />答错了</>}
            </p>
            {(verdict !== true || !isChoice(question.type)) && referenceOf(question) && (
              <p className={q.reference}><b>{isChoice(question.type) ? '正确答案' : '参考答案'}</b>{referenceOf(question)}</p>
            )}
            {question.explanation && <div className={q.explain}><CoachMarkdown text={question.explanation} /></div>}
            <div className={q.resultActions}>
              {selfGrade && (
                <>
                  <Button variant="soft" size="sm" icon={<Check {...ICON_SM} />} onClick={() => setMarks((current) => ({ ...current, [question.id]: true }))}>我答对了</Button>
                  <Button variant="soft" size="sm" icon={<X {...ICON_SM} />} onClick={() => setMarks((current) => ({ ...current, [question.id]: false }))}>没答对</Button>
                </>
              )}
              {verdict === false && question.type === 'blank' && (
                <Button variant="ghost" size="sm" onClick={() => setMarks((current) => ({ ...current, [question.id]: true }))}>意思一样，算我对</Button>
              )}
              {verdict === false && (
                <>
                  <Button variant="soft" size="sm" icon={<IconSpark size={16} />} onClick={runExplain}>讲解这道题</Button>
                  <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={runSimilar}>再出一道同类题</Button>
                  <Button variant="ghost" size="sm" icon={<IconFlashcard size={16} />} onClick={() => onCards([question])}>做成闪卡</Button>
                  <Button variant="ghost" size="sm" onClick={() => askHere('这道题我做错了，我错在哪、该怎么想？')}>问小砚</Button>
                </>
              )}
            </div>
            {helper === 'explain' && (
              <AiBlock
                state={explain.state}
                title="讲解这道题"
                doing="正在看你的答案"
                actions={explain.state.local ? [] : [{ label: '存为这道题的解析', onClick: saveExplanation }]}
                onRetry={() => void explain.retry()}
                onStop={explain.stop}
                onDiscard={closeHelper}
              />
            )}
            {helper === 'similar' && (
              <AiBlock
                state={similar.state}
                title="同类题"
                doing="正在出一道同类题"
                actions={[{ label: '下一题就做它', primary: true, onClick: () => keepSimilar(true) }, { label: '只加入题目集', onClick: () => keepSimilar(false) }]}
                onRetry={runSimilar}
                onDiscard={closeHelper}
              />
            )}
          </div>
        )}
      </div>

      <div className={q.pFoot}>
        <span className={s.kbdHint}><Kbd>Enter</Kbd>{checked ? '下一题' : '检查'}{isChoice(question.type) && !checked && <><Kbd>1</Kbd>–<Kbd>{options.length}</Kbd>选择</>}</span>
        {checked ? (
          <Button variant="solid" iconRight={<ArrowRight {...ICON_SM} />} disabled={verdict === undefined} onClick={next}>{index + 1 < total ? '下一题' : '看成绩'}</Button>
        ) : (
          <Button variant="solid" onClick={check}>{question.type === 'short' ? '对照参考答案' : '检查答案'}</Button>
        )}
      </div>
    </div>
  );
}

function ScoreRing({ percent }: { percent: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent]);
  const length = 2 * Math.PI * 44;
  return (
    <div className={q.ring} data-tone={percent >= 80 ? 'ok' : percent >= 60 ? 'accent' : 'warn'} role="img" aria-label={`得分 ${percent}%`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" />
        <circle cx="50" cy="50" r="44" strokeDasharray={length} strokeDashoffset={length * (1 - shown / 100)} />
      </svg>
      <b>{percent}<small>%</small></b>
    </div>
  );
}

/* ── 编辑题目 ── */
function QuestionDialog({ question, onSave, onClose }: { question: QuizQuestion | null; onSave: (question: QuizQuestion) => void; onClose: () => void }) {
  const [type, setType] = useState<QuestionType>(question?.type ?? 'single');
  const [stem, setStem] = useState(question?.stem ?? '');
  const [options, setOptions] = useState<string[]>(() => (question && question.type !== 'truefalse' && question.options?.length ? question.options : ['', '', '', '']));
  const [correct, setCorrect] = useState<number[]>(() => (question ? keyOf(question) : []));
  const [text, setText] = useState(() => (question && typeof question.answer === 'string' ? question.answer : ''));
  const [explanation, setExplanation] = useState(question?.explanation ?? '');
  const [difficulty, setDifficulty] = useState<'1' | '2' | '3'>(String(question?.difficulty ?? 2) as '1' | '2' | '3');

  const switchType = (next: QuestionType) => {
    setType(next);
    if (next === 'truefalse') setCorrect((current) => (current[0] === 1 ? [1] : [0]));
    else if (next === 'single') setCorrect((current) => current.slice(0, 1));
  };
  const toggle = (at: number) => setCorrect((current) => (type === 'multiple' ? (current.includes(at) ? current.filter((item) => item !== at) : [...current, at].sort((a, b) => a - b)) : [at]));

  const filled = options.map((option, at) => ({ option: option.trim(), at })).filter((item) => item.option);
  const valid = Boolean(stem.trim()) && (
    type === 'truefalse' ? correct.length === 1
      : isChoice(type) ? filled.length >= 2 && correct.some((at) => filled.some((item) => item.at === at)) && (type !== 'multiple' || correct.length >= 1)
        : Boolean(text.trim())
  );

  const submit = () => {
    if (!valid) return;
    const base = { id: question?.id ?? newId(), type, stem: stem.trim(), explanation: explanation.trim(), difficulty: Number(difficulty) as 1 | 2 | 3, ...(question?.tags ? { tags: question.tags } : {}) };
    if (type === 'truefalse') onSave({ ...base, options: TRUE_FALSE, answer: correct.slice(0, 1) });
    else if (isChoice(type)) {
      // 去掉空选项后，正确答案的下标要跟着重排
      const answer = correct.map((at) => filled.findIndex((item) => item.at === at)).filter((at) => at >= 0);
      onSave({ ...base, options: filled.map((item) => item.option), answer });
    } else onSave({ ...base, answer: text.trim() });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={question ? '编辑题目' : '添加题目'}
      size="md"
      footer={<><Button variant="soft" onClick={onClose}>取消</Button><Button variant="solid" disabled={!valid} onClick={submit}>保存</Button></>}
    >
      <div className={q.form}>
        <Segmented block size="sm" label="题型" value={type} onChange={switchType} options={QUESTION_TYPES} />
        <Field label="题干" hint={type === 'blank' ? '用 ____ 标出要填的空。' : undefined}>
          <Textarea rows={3} value={stem} placeholder="题目内容，支持 Markdown 和公式" onChange={(event) => setStem(event.target.value)} />
        </Field>
        {type === 'truefalse' && (
          <Field label="正确答案">
            <Segmented block label="正确答案" value={correct[0] === 1 ? 'false' : 'true'} onChange={(value) => setCorrect([value === 'true' ? 0 : 1])} options={[{ value: 'true', label: '正确' }, { value: 'false', label: '错误' }]} />
          </Field>
        )}
        {(type === 'single' || type === 'multiple') && (
          <Field label="选项" hint={type === 'multiple' ? '点左边的字母标出所有正确选项。' : '点左边的字母标出正确选项。'}>
            <div className={q.formOpts}>
              {options.map((option, at) => (
                <div key={at} className={q.formOpt}>
                  <button type="button" className={q.mark} data-square={type === 'multiple'} data-on={correct.includes(at)} aria-pressed={correct.includes(at)} aria-label={`把选项 ${LETTERS[at]} 设为正确答案`} onClick={() => toggle(at)}>
                    {correct.includes(at) ? <Check size={13} strokeWidth={2.5} /> : LETTERS[at]}
                  </button>
                  <Input size="sm" value={option} placeholder={`选项 ${LETTERS[at]}`} onChange={(event) => setOptions((current) => current.map((item, i) => (i === at ? event.target.value : item)))} />
                  <IconButton
                    label="删除选项"
                    size="sm"
                    tip={false}
                    disabled={options.length <= 2}
                    onClick={() => {
                      setOptions((current) => current.filter((_, i) => i !== at));
                      setCorrect((current) => current.filter((item) => item !== at).map((item) => (item > at ? item - 1 : item)));
                    }}
                  >
                    <X {...ICON_SM} />
                  </IconButton>
                </div>
              ))}
              {options.length < 6 && <Button variant="ghost" size="sm" icon={<Plus {...ICON_SM} />} onClick={() => setOptions((current) => [...current, ''])}>添加选项</Button>}
            </div>
          </Field>
        )}
        {(type === 'blank' || type === 'short') && (
          <Field label="参考答案" hint={type === 'blank' ? '有多种写法时用 | 隔开，例如：栈 | stack。' : undefined}>
            {type === 'blank'
              ? <Input value={text} placeholder="答案" onChange={(event) => setText(event.target.value)} />
              : <Textarea rows={3} value={text} placeholder="参考答案" onChange={(event) => setText(event.target.value)} />}
          </Field>
        )}
        <Field label="解析（可选）">
          <Textarea rows={3} value={explanation} placeholder="为什么是这个答案，容易错在哪" onChange={(event) => setExplanation(event.target.value)} />
        </Field>
        <Field label="难度">
          <Segmented size="sm" label="难度" value={difficulty} onChange={setDifficulty} options={[{ value: '1', label: '基础' }, { value: '2', label: '中等' }, { value: '3', label: '较难' }]} />
        </Field>
      </div>
    </Dialog>
  );
}
