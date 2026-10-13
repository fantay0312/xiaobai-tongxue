import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookMarked, Check, CircleCheck, CircleX, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Badge, Button, Dialog, Field, IconButton, Input, Kbd, Progress, Segmented, Switch, Textarea, toast } from '../../../../components/ui';
import { newId, studyData, useStudyData, type QuestionType, type QuizQuestion, type QuizSet } from '../../../../store/studyData';
import { QUESTION_TYPES, TRUE_FALSE } from './generate';
import { DetailHead, ICON_SM, OriginBadge, ToolFrame, type ToolProps } from './shared';
import { clip, useAutosave, useHotkeys } from './util';
import s from './workbench.module.css';
import q from './quiz.module.css';

type Answer = number[] | string;
const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES.map((type) => [type.value, type.label])) as Record<QuestionType, string>;
const LETTERS = 'ABCDEFGH';
const isChoice = (type: QuestionType) => type === 'single' || type === 'multiple' || type === 'truefalse';

const optionsOf = (question: QuizQuestion): string[] =>
  question.type === 'truefalse' ? (question.options?.length === 2 ? question.options : TRUE_FALSE) : question.options ?? [];
const keyOf = (question: QuizQuestion): number[] => (Array.isArray(question.answer) ? question.answer : []);
const referenceOf = (question: QuizQuestion): string => {
  if (!isChoice(question.type)) return typeof question.answer === 'string' ? question.answer : '';
  const options = optionsOf(question);
  return keyOf(question).map((index) => (question.type === 'truefalse' ? options[index] : `${LETTERS[index]}. ${options[index] ?? ''}`)).join('　');
};
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

export default function QuizTool(props: ToolProps) {
  const { owner, onAsk } = props;
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
        return set ? <QuizDetail key={set.id} set={set} owner={owner} onAsk={onAsk} /> : null;
      }}
    </ToolFrame>
  );
}

function QuizDetail({ set, owner, onAsk }: { set: QuizSet; owner: string | null; onAsk: (text: string) => void }) {
  const [title, setTitle] = useState(set.title);
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

  if (run) {
    return (
      <div className={s.card}>
        <Practice key={run.key} set={set} ids={run.ids} wrongOnly={run.wrongOnly} owner={owner} onExit={() => setRun(null)} onRestart={start} onAsk={onAsk} />
      </div>
    );
  }

  return (
    <div className={s.card}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<OriginBadge origin={set.origin} />}>
        <label className={q.reveal}>
          <Switch checked={reveal} onCheckedChange={setReveal} label="显示答案" />显示答案
        </label>
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
function Practice({ set, ids, wrongOnly, owner, onExit, onRestart, onAsk }: {
  set: QuizSet;
  ids: string[];
  wrongOnly: boolean;
  owner: string | null;
  onExit: () => void;
  onRestart: (wrongOnly: boolean) => void;
  onAsk: (text: string) => void;
}) {
  // 练习开始时把题目定下来，练习中题目集被外部改动也不影响这一轮
  const [questions] = useState(() => ids.flatMap((id) => set.questions.find((question) => question.id === id) ?? []));
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
    setDone(true);
  };

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
    if (index + 1 < total) { setIndex(index + 1); setChecked(false); }
    else finish(marks);
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAsk(`这道题我做错了，请讲讲我错在哪、该怎么想：\n\n${question.stem}${options.length ? `\n${options.map((option, at) => `${LETTERS[at]}. ${option}`).join('\n')}` : ''}\n\n我的答案：${Array.isArray(mine) ? mine.map((at) => LETTERS[at]).join('、') : mine ?? '（未作答）'}\n正确答案：${referenceOf(question)}`)}
                >
                  问小砚
                </Button>
              )}
            </div>
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
