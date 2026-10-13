/** 第一章「学」：学习终端。三件可以上手的小件——可互动的回答、资料勾选、思考强度。 */
import { useState, type ComponentType, type CSSProperties } from 'react';
import { Check, FileText, Plus, RotateCw, X, Zap } from 'lucide-react';
import { EffortSlider, Segmented } from '../../components/ui';
import { EFFORTS, EFFORT_HINTS, EFFORT_LABELS } from '../../store/modelPrefs';
import { ChapterHead } from './ChapterHead';
import base from './landing.module.css';
import s from './learn.module.css';

type FormId = 'quiz' | 'card' | 'table' | 'plan' | 'steps' | 'chart';

const FORMS: { value: FormId; label: string; ask: string }[] = [
  { value: 'quiz', label: '测验', ask: '考我一道范围查询的题' },
  { value: 'card', label: '闪卡', ask: '把这个要点做成闪卡' },
  { value: 'table', label: '对比表', ask: 'B 树和 B+ 树差在哪？' },
  { value: 'plan', label: '计划', ask: '三天复习完这一章' },
  { value: 'steps', label: '公式推导', ask: '树高是怎么算出来的？' },
  { value: 'chart', label: '图表', ask: '和二叉搜索树比，差多少？' },
];

const QUIZ = {
  question: '在 B+ 树里做范围查询，最省事的做法是？',
  options: ['每个值都从根查一次', '找到起点，顺着叶子链表往后读', '把整棵树遍历一遍'],
  answer: 1,
};

function QuizForm() {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className={s.quiz}>
      <p className={s.formTitle}>{QUIZ.question}</p>
      <div className={s.quizOptions}>
        {QUIZ.options.map((option, index) => {
          const state = picked === null ? undefined : index === QUIZ.answer ? 'right' : index === picked ? 'wrong' : 'rest';
          return (
            <button
              key={option}
              type="button"
              className={s.quizOption}
              data-state={state}
              disabled={picked !== null}
              onClick={() => setPicked(index)}
            >
              <b>{'ABC'[index]}</b>
              <span>{option}</span>
              {state === 'right' && <Check size={16} strokeWidth={2.2} />}
              {state === 'wrong' && <X size={16} strokeWidth={2.2} />}
            </button>
          );
        })}
      </div>
      <p className={s.formFoot} aria-live="polite">
        {picked === null && '选一个试试。'}
        {picked !== null && (picked === QUIZ.answer
          ? '答对了。叶子连成链表，找到起点后一路读下去就行。'
          : '再想想：叶子节点之间有链表相连，不必回到根。')}
        {picked !== null && (
          <button type="button" className={s.linkButton} onClick={() => setPicked(null)}>
            <RotateCw size={13} strokeWidth={2} />
            再来一次
          </button>
        )}
      </p>
    </div>
  );
}

function CardForm() {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={s.cardForm}>
      <button
        type="button"
        className={s.flashcard}
        data-flipped={flipped || undefined}
        aria-label={flipped ? '闪卡背面，点击翻回正面' : '闪卡正面，点击看答案'}
        onClick={() => setFlipped((value) => !value)}
      >
        <span className={s.face}>
          <small>正面</small>
          B+ 树的非叶子节点里存什么？
        </span>
        <span className={`${s.face} ${s.faceBack}`}>
          <small>背面</small>
          只存键和指向子节点的指针，不存数据，所以一个节点放得下更多键。
        </span>
      </button>
      <p className={s.formFoot}>点一下卡片翻面。存进闪卡后，按间隔重复安排复习。</p>
    </div>
  );
}

function TableForm() {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col" aria-label="对比项" />
            <th scope="col">B 树</th>
            <th scope="col">B+ 树</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">数据放在</th>
            <td>所有节点</td>
            <td>只在叶子</td>
          </tr>
          <tr>
            <th scope="row">范围查询</th>
            <td>中序遍历，上下来回</td>
            <td>顺着叶子链表读</td>
          </tr>
          <tr>
            <th scope="row">单节点键数</th>
            <td>较少</td>
            <td>更多，树更矮</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const PLAN = [
  { day: '第 1 天', text: '读第 7 章，跟小砚把要点过一遍', done: true },
  { day: '第 2 天', text: '做 10 道选择题，错题留在题目集', done: false },
  { day: '第 3 天', text: '给小白讲一遍，再看批注补漏', done: false },
];

function PlanForm() {
  return (
    <div className={s.plan}>
      <ol>
        {PLAN.map((item) => (
          <li key={item.day} data-done={item.done || undefined}>
            <i>{item.done && <Check size={12} strokeWidth={3} />}</i>
            <span>{item.day}</span>
            {item.text}
          </li>
        ))}
      </ol>
      <span className={s.planAdd}>
        <Plus size={14} strokeWidth={2} />
        加入待办
      </span>
    </div>
  );
}

function StepsForm() {
  return (
    <ol className={s.steps}>
      <li>
        <span>每个节点最多 <i>m</i> 个孩子，<i>h</i> 层最多放下的记录数</span>
        <b className={s.math}><i>m</i><sup><i>h</i></sup></b>
      </li>
      <li>
        <span>要装下 <i>N</i> 条记录，需要</span>
        <b className={s.math}><i>m</i><sup><i>h</i></sup> ≥ <i>N</i></b>
      </li>
      <li>
        <span>两边取对数，得到树高</span>
        <b className={s.math}><i>h</i> ≥ log<sub><i>m</i></sub> <i>N</i></b>
      </li>
    </ol>
  );
}

const BARS = [
  { name: '二叉搜索树', value: 27 },
  { name: 'B+ 树（m = 200）', value: 4 },
];

function ChartForm() {
  return (
    <figure className={s.chart}>
      <figcaption className={s.formTitle}>存一亿条记录，各要几层</figcaption>
      {BARS.map((bar, index) => (
        <div key={bar.name} className={s.bar}>
          <span>{bar.name}</span>
          <div className={s.barTrack}>
            <i data-accent={index === 1 || undefined} style={{ '--w': bar.value / 27 } as CSSProperties} />
            <b>{bar.value} 层</b>
          </div>
        </div>
      ))}
    </figure>
  );
}

const FORM_VIEWS: Record<FormId, ComponentType> = {
  quiz: QuizForm, card: CardForm, table: TableForm, plan: PlanForm, steps: StepsForm, chart: ChartForm,
};

const MATERIALS = ['数据结构·第 7 章.pdf', '索引讲义.pptx', '往年试卷.docx'];

export function LearnChapter() {
  const [form, setForm] = useState<FormId>('quiz');
  const [effort, setEffort] = useState(2);
  const [chosen, setChosen] = useState<readonly boolean[]>([true, true, false]);
  const current = FORMS.find((item) => item.value === form) ?? FORMS[0];
  const FormView = FORM_VIEWS[form];
  const chosenCount = chosen.filter(Boolean).length;
  const effortId = EFFORTS[effort];

  return (
    <section id="learn" className={base.chapter} aria-labelledby="chapter-learn">
      <div className={base.wrap}>
        <ChapterHead
          no="01"
          glyph="学"
          name="学习终端"
          titleId="chapter-learn"
          title="每一句回答，都从你的资料里来。"
          lead="一门课是一个项目，每次对话是一条工作日志。导师小砚只依据你勾选的资料作答，句句标出处；答案也不止是一段文字。"
        />

        <div className={`${base.chapterBody} ${base.split}`}>
          <ul className={`${base.points} ${base.sticky}`} data-reveal>
            <li>
              <strong>只读你选的资料</strong>
              <span>勾选哪几份，小砚就只用哪几份。每个结论后面跟着编号，对得上出处。</span>
            </li>
            <li>
              <strong>答案可以动手</strong>
              <span>测验、闪卡、对比表、学习计划、公式推导、图表，按问题给出合适的形式。这里的六种都能点开试。</span>
            </li>
            <li>
              <strong>公式和代码排得整齐</strong>
              <span>LaTeX 公式、代码高亮直接渲染。用哪个模型、想多深，由你定。</span>
            </li>
          </ul>

          <div className={base.stage} data-reveal style={{ '--reveal-delay': '90ms' } as CSSProperties}>
            <div className={`${base.panel} ${s.answer}`}>
              <Segmented
                value={form}
                onChange={setForm}
                options={FORMS.map(({ value, label }) => ({ value, label }))}
                label="回答的形式"
                block
                className={s.formTabs}
              />
              <p className={s.ask}>{current.ask}</p>
              <div className={s.formBody} key={form}>
                <FormView />
              </div>
            </div>

            <div className={s.pair}>
              <div className={`${base.panel} ${s.small}`}>
                <div className={s.smallHead}>
                  <span className={base.label}>作答依据</span>
                  <span className={s.count}>{chosenCount} / {MATERIALS.length} 份</span>
                </div>
                <div className={s.materials}>
                  {MATERIALS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      role="checkbox"
                      aria-checked={chosen[index]}
                      className={s.material}
                      onClick={() => setChosen((prev) => prev.map((value, at) => (at === index ? !value : value)))}
                    >
                      <i>{chosen[index] && <Check size={12} strokeWidth={3} />}</i>
                      <FileText size={15} strokeWidth={1.75} />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={`${base.panel} ${s.small}`}>
                <div className={s.smallHead}>
                  <span className={base.label}>思考强度</span>
                  <span className={s.effortNow}>
                    <Zap size={14} strokeWidth={2} />
                    {EFFORT_LABELS[effortId]}
                  </span>
                </div>
                <EffortSlider
                  value={effort}
                  onChange={setEffort}
                  labels={EFFORTS.map((item) => EFFORT_LABELS[item])}
                />
                <p className={s.effortHint}>{EFFORT_HINTS[effortId]}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
