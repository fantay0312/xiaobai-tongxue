/** 第三章「练与记」：工作台的四件小件（闪卡、思维导图、待办、批改）与双记忆。 */
import { useState, type CSSProperties } from 'react';
import { Check, Layers, ListTodo, Network, PenLine } from 'lucide-react';
import { Badge, Button } from '../../components/ui';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { ChapterHead } from './ChapterHead';
import base from './landing.module.css';
import s from './practice.module.css';

const TOOLS = [
  { name: '笔记', count: 12 },
  { name: '思维导图', count: 3 },
  { name: '题目集', count: 5 },
  { name: '闪卡', count: 4 },
  { name: '待办', count: 6 },
  { name: '作文与翻译批改', count: 2 },
];

const CARDS = [
  { front: 'B+ 树的叶子节点为什么要连成链表？', back: '范围查询找到起点后，顺着链表往后读，不必回到根节点。' },
  { front: 'KMP 的 next 数组记的是什么？', back: '模式串每个前缀里，最长的相等前后缀的长度。' },
  { front: '进程和线程最核心的区别？', back: '进程是资源分配的单位，线程是调度的单位。' },
];

/** 与工作台同一套间隔重复：重来 10 分钟后；其余按上次间隔与熟练度推算天数。 */
const RATINGS = [
  { label: '重来', due: '10 分钟后' },
  { label: '吃力', due: '2 天后' },
  { label: '记得', due: '5 天后' },
  { label: '很熟', due: '7 天后' },
];

function ReviewDeck() {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(12);
  const [lastDue, setLastDue] = useState<string | null>(null);
  const card = CARDS[index % CARDS.length];

  const rate = (due: string) => {
    setLastDue(due);
    setRevealed(false);
    setIndex((value) => value + 1);
    setLeft((value) => (value > 1 ? value - 1 : 12));
  };

  return (
    <div className={`${base.panel} ${s.cell} ${s.deck}`}>
      <div className={s.cellHead}>
        <Layers size={16} strokeWidth={1.75} />
        <strong>闪卡</strong>
        <span>今日待复习 {left} 张</span>
      </div>
      <div className={s.card} key={index}>
        <p className={s.cardFront}>{card.front}</p>
        {revealed && <p className={s.cardBack}>{card.back}</p>}
      </div>
      {revealed ? (
        <div className={s.ratings}>
          {RATINGS.map((rating) => (
            <button key={rating.label} type="button" className={s.rating} onClick={() => rate(rating.due)}>
              <strong>{rating.label}</strong>
              <span>{rating.due}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={s.deckFoot}>
          <Button variant="solid" onClick={() => setRevealed(true)}>显示答案</Button>
          <span aria-live="polite">{lastDue ? `上一张已排到${lastDue}` : '先在心里答一遍，再看答案。'}</span>
        </div>
      )}
    </div>
  );
}

/** 思维导图：手排坐标的小 SVG，颜色全走令牌。 */
function MindMap() {
  return (
    <div className={`${base.panel} ${s.cell}`}>
      <div className={s.cellHead}>
        <Network size={16} strokeWidth={1.75} />
        <strong>思维导图</strong>
        <span>第 7 章 索引</span>
      </div>
      <svg className={s.map} viewBox="0 0 340 196" role="img" aria-label="思维导图：索引分出 B 树、B+ 树和哈希，B+ 树再分出高扇出与叶子链表">
        <g className={s.mapLinks}>
          <path d="M78 98 C110 98 106 34 138 34" />
          <path d="M78 98 C110 98 106 98 138 98" />
          <path d="M78 98 C110 98 106 162 138 162" />
          <path d="M204 98 C228 98 224 70 248 70" />
          <path d="M204 98 C228 98 224 126 248 126" />
        </g>
        <g className={s.mapRoot}>
          <rect x="14" y="80" width="64" height="36" rx="10" />
          <text x="46" y="103">索引</text>
        </g>
        <g className={s.mapNode}>
          <rect x="138" y="19" width="58" height="30" rx="9" />
          <text x="167" y="39">B 树</text>
          <rect x="138" y="147" width="58" height="30" rx="9" />
          <text x="167" y="167">哈希</text>
        </g>
        <g className={s.mapNodeOn}>
          <rect x="138" y="83" width="66" height="30" rx="9" />
          <text x="171" y="103">B+ 树</text>
        </g>
        <g className={s.mapLeaf}>
          <rect x="248" y="56" width="78" height="28" rx="8" />
          <text x="287" y="75">高扇出</text>
          <rect x="248" y="112" width="78" height="28" rx="8" />
          <text x="287" y="131">叶子链表</text>
        </g>
      </svg>
    </div>
  );
}

const TODOS = [
  { text: '复习第 7 章闪卡', due: '今天', agent: false },
  { text: '给小白讲一遍索引', due: '今天', agent: false },
  { text: '整理操作系统第 3 章笔记', due: '周四', agent: true },
];

function Todos() {
  const [done, setDone] = useState<readonly boolean[]>([true, false, false]);
  return (
    <div className={`${base.panel} ${s.cell}`}>
      <div className={s.cellHead}>
        <ListTodo size={16} strokeWidth={1.75} />
        <strong>待办</strong>
        <span>{done.filter(Boolean).length} / {TODOS.length}</span>
      </div>
      <div className={s.todos}>
        {TODOS.map((todo, index) => (
          <button
            key={todo.text}
            type="button"
            role="checkbox"
            aria-checked={done[index]}
            className={s.todo}
            onClick={() => setDone((prev) => prev.map((value, at) => (at === index ? !value : value)))}
          >
            <i>{done[index] && <Check size={12} strokeWidth={3} />}</i>
            <span>{todo.text}</span>
            {todo.agent && <Badge tone="accent">助理添加</Badge>}
            <em>{todo.due}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function Correction() {
  return (
    <div className={`${base.panel} ${s.cell}`}>
      <div className={s.cellHead}>
        <PenLine size={16} strokeWidth={1.75} />
        <strong>翻译批改</strong>
        <span>3 处修改</span>
      </div>
      <p className={s.source}>叶子节点通过指针相连，便于范围查询。</p>
      <p className={s.draft}>
        The leaf nodes <del>is</del><ins>are</ins> linked by pointers, which <del>make</del><ins>makes</ins> range
        queries <del>more easy</del><ins>easier</ins>.
      </p>
      <p className={s.remark}>主谓一致两处，比较级一处。句子结构没问题。</p>
    </div>
  );
}

const TUTOR_MEMORY = [
  { kind: '偏好', text: '先举例子，再给定义' },
  { kind: '目标', text: '期末前吃透索引这一章' },
  { kind: '薄弱点', text: 'B 树和 B+ 树容易混' },
];

const PUPIL_MEMORY = [
  { kind: '学会了', text: '树矮，读盘就少', tone: 'ok' },
  { kind: '好比方', text: '目录越厚，翻得越少', tone: 'accent' },
  { kind: '快忘了', text: '叶子链表，7 天没温习', tone: 'warn' },
] as const;

export function PracticeChapter() {
  return (
    <section id="practice" className={base.chapter} aria-labelledby="chapter-practice">
      <div className={base.wrap}>
        <ChapterHead
          no="03"
          glyph="练"
          name="工作台与记忆"
          titleId="chapter-practice"
          title="学过的东西，要留得下来。"
          lead="笔记、思维导图、题目集、闪卡、待办、作文与翻译批改，都在同一张工作台上。对话里的回答一键存成笔记，闪卡按间隔重复安排复习。"
        />

        <div className={base.chapterBody}>
          <ul className={s.tools} data-reveal aria-label="工作台的六件工具">
            {TOOLS.map((tool, index) => (
              <li key={tool.name} data-on={index === 3 || undefined}>
                {tool.name}
                <span>{tool.count}</span>
              </li>
            ))}
          </ul>

          <div className={s.bento}>
            <div className={s.span7} data-reveal><ReviewDeck /></div>
            <div className={s.span5} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}><MindMap /></div>
            <div className={s.span5} data-reveal><Todos /></div>
            <div className={s.span7} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}><Correction /></div>
          </div>
        </div>

        <div className={s.memory} data-reveal>
          <div className={s.memoryIntro}>
            <h3>两份记忆，各记各的</h3>
            <p>小砚记的是你这个人怎么学；小白记的是你教过他什么。两边互不混写。</p>
          </div>

          <div className={s.memoryCards}>
            <div className={s.memoryCard}>
              <div className={s.memoryHead}>
                <span className={s.tutor} aria-hidden="true">砚</span>
                <div>
                  <strong>小砚记得你怎么学</strong>
                  <span>答疑时照着这些来</span>
                </div>
              </div>
              <ul>
                {TUTOR_MEMORY.map((item) => (
                  <li key={item.text}>
                    <Badge>{item.kind}</Badge>
                    {item.text}
                  </li>
                ))}
              </ul>
              <p>每一条都能改、能删，也可以暂停记录。</p>
            </div>

            <div className={s.memoryCard}>
              <div className={s.memoryHead}>
                <XiaobaiAvatar mood="thinking" level={2} size={40} />
                <div>
                  <strong>小白记得你教过什么</strong>
                  <span>上课、考试、温习都算数</span>
                </div>
              </div>
              <ul>
                {PUPIL_MEMORY.map((item) => (
                  <li key={item.text}>
                    <Badge tone={item.tone}>{item.kind}</Badge>
                    {item.text}
                  </li>
                ))}
              </ul>
              <p>快忘的那些，他会写信来问。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
