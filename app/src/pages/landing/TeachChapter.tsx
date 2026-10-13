/**
 * 第二章「教」：全页的重心。
 * 一堂课四步（备课 → 给小白上课 → 小白赴考 → 批注复盘）做成可点的环；
 * 其后是《学记》那句话，再后是拜师帖与师徒旅程。纸质物件走 data-story 故事岛。
 */
import { useState, type CSSProperties } from 'react';
import { ArrowRight, Check, CircleDashed, CornerDownRight, RotateCw, X } from 'lucide-react';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ChapterHead } from './ChapterHead';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './teach.module.css';

const STEPS = [
  { title: '备课', text: '和小砚把这一讲拆成要点，自己先过一遍。' },
  { title: '给小白上课', text: '你来讲，小白来问。问题很天真，也很准。' },
  { title: '小白赴考', text: '下课后他独自答卷，只会你教过的。' },
  { title: '批注复盘', text: '卷面逐题批注，哪句没讲透，一眼看到。' },
] as const;

const PREP_POINTS = [
  { text: '磁盘读得慢，所以索引要让树尽量矮', done: true },
  { text: '非叶子节点只放键，不放数据', done: true },
  { text: '叶子节点连成链表', done: true },
  { text: '节点满了怎样分裂', done: false },
];

function PrepScene() {
  return (
    <div className={s.scene}>
      <div className={s.sceneHead}>
        <span className={s.tutor} aria-hidden="true">砚</span>
        <p><strong>小砚</strong>这一讲拆成 4 个要点。每一点都能不看资料讲出来，再去上课。</p>
      </div>
      <ul className={s.prepList}>
        {PREP_POINTS.map((point) => (
          <li key={point.text} data-done={point.done || undefined}>
            <i>{point.done && <Check size={12} strokeWidth={3} />}</i>
            <span>{point.text}</span>
            <em>{point.done ? '讲得出' : '还没过'}</em>
          </li>
        ))}
      </ul>
      <div className={s.sceneFoot}>
        <span className={s.meter}><i style={{ width: '75%' }} /></span>
        <span>备课 3 / 4</span>
      </div>
    </div>
  );
}

function ClassScene() {
  return (
    <div className={s.scene}>
      <div className={s.lessonBar}>
        <strong>第 7 讲 · 索引</strong>
        <span>正在讲 · 要点 2 / 4</span>
      </div>
      <div className={s.classroom}>
        <div className={s.pupil}>
          <XiaobaiAvatar mood="curious" level={2} size={132} />
          <span>小白 · 秀才</span>
        </div>
        <div className={s.talk}>
          <p className={s.mine}>B+ 树把数据都放在叶子上，所以查得快。</p>
          <p className={s.his}>先生，数据都放在叶子上，为什么就快了？放在上面，不是更早就能找到吗？</p>
          <p className={s.gap}>
            <CornerDownRight size={15} strokeWidth={1.9} />
            这一问你停了很久。讲到这里的结论，还缺一个原因。
          </p>
        </div>
      </div>
    </div>
  );
}

const EXAM = [
  { question: 'B+ 树的数据放在哪里？', answer: '都在叶子上，先生讲过。', right: true },
  { question: '范围查询为什么快？', answer: '因为……叶子比较多？', right: false },
  { question: '为什么要让树矮？', answer: '每下一层就要读一次盘，层数少就读得少。', right: true },
];

function ExamScene() {
  return (
    <div className={`${s.scene} ${s.paper}`} data-story>
      <div className={s.paperHead}>
        <strong>随堂考 · 第 7 讲 索引</strong>
        <span>答卷人 小白</span>
      </div>
      <ol className={s.examList}>
        {EXAM.map((item) => (
          <li key={item.question} data-right={item.right || undefined}>
            <span className={s.examQuestion}>{item.question}</span>
            <span className={s.examAnswer}>{item.answer}</span>
            <i aria-label={item.right ? '答对' : '答错'}>
              {item.right ? <Check size={18} strokeWidth={2.6} /> : <X size={18} strokeWidth={2.6} />}
            </i>
          </li>
        ))}
      </ol>
      <div className={s.score}>
        <b>76</b>
        <span>他答不上的，是你没讲到的。</span>
      </div>
    </div>
  );
}

const REVIEW_POINTS = [
  { text: '树矮，读盘就少', gap: false },
  { text: '数据只放在叶子', gap: false },
  { text: '每下一层读一次盘', gap: false },
  { text: '盲区：范围查询为什么快', gap: true },
];

function ReviewScene() {
  return (
    <div className={s.scene}>
      <div className={s.reviewHead}>
        <strong>批注复盘</strong>
        <span>小白 76 分 · 讲清 3 点 · 盲区 1 处</span>
      </div>
      <blockquote className={s.quote}>
        “B+ 树把数据都放在叶子上，<mark>所以查得快</mark>。”
      </blockquote>
      <p className={s.note}>
        <span className={s.tutor} aria-hidden="true">砚</span>
        <span>
          只给了结论。缺的那一环是：非叶子节点不放数据 → 一个节点放得下更多键 → 树更矮 → 读盘更少。
        </span>
      </p>
      <ul className={s.reviewList}>
        {REVIEW_POINTS.map((point) => (
          <li key={point.text} data-gap={point.gap || undefined}>
            {point.gap ? <CircleDashed size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={2.6} />}
            {point.text}
          </li>
        ))}
      </ul>
      <div className={s.sceneFoot}>
        <span className={s.again}>
          <RotateCw size={14} strokeWidth={2} />
          回到备课，补上这一点再讲一遍
        </span>
      </div>
    </div>
  );
}

const SCENES = [PrepScene, ClassScene, ExamScene, ReviewScene];

const STAGES = [
  { name: '童生', note: '初入问学' },
  { name: '秀才', note: '初通一艺' },
  { name: '举人', note: '旁涉群书' },
  { name: '贡士', note: '问难穷理' },
  { name: '进士', note: '学成登科' },
];
const CURRENT_STAGE = 1;

const SEALS = [
  { glyph: '启', name: '开讲', earned: true },
  { glyph: '正', name: '正误', earned: true },
  { glyph: '喻', name: '妙喻', earned: true },
  { glyph: '师', name: '出师', earned: false },
  { glyph: '温', name: '温故', earned: false },
];

export function TeachChapter() {
  const reducedMotion = useReducedMotion();
  const [loopRef, inView] = useInView<HTMLDivElement>(0.4);
  const [step, setStep] = useState(1);
  // 访客点过之后不再自动轮播，把节奏交还给他
  const [auto, setAuto] = useState(true);
  const Scene = SCENES[step];

  return (
    <section id="teach" className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="chapter-teach">
      <div className={base.wrap}>
        <ChapterHead
          no="02"
          glyph="教"
          name="教小白"
          titleId="chapter-teach"
          title="把刚学会的，讲给小白听。"
          lead="小白是一个什么都想学明白、却什么都还不懂的 AI 学生。你跳过的步骤他会追问，你讲岔的地方他会跟着岔。一堂课走四步，走完再来一轮。"
        />

        <div ref={loopRef} className={`${base.chapterBody} ${s.loop}`} data-reveal>
          <ol className={s.steps}>
            {STEPS.map((item, index) => (
              <li key={item.title}>
                <button
                  type="button"
                  className={s.step}
                  aria-current={index === step ? 'step' : undefined}
                  onClick={() => {
                    setAuto(false);
                    setStep(index);
                  }}
                >
                  <span className={s.stepNo}>{index + 1}</span>
                  <span className={s.stepText}>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </span>
                  {index === step && auto && !reducedMotion && (
                    <i
                      className={s.stepTimer}
                      data-playing={inView || undefined}
                      onAnimationEnd={() => setStep((index + 1) % STEPS.length)}
                    />
                  )}
                </button>
              </li>
            ))}
          </ol>

          {/* 手机上四步收成一行，当前一步的说明挪到这里 */}
          <p className={s.stepHint}>{STEPS[step].text}</p>

          <div className={`${base.panel} ${s.sceneWrap}`} aria-live="off">
            <div key={step} className={s.sceneIn}>
              <Scene />
            </div>
          </div>
        </div>

        <figure className={s.motto} data-reveal>
          <blockquote>教然后知困</blockquote>
          <figcaption>
            <cite>《礼记·学记》</cite>
            <span>去教别人，才知道自己哪里还没弄懂。这间终端从这句话来。</span>
          </figcaption>
        </figure>

        <div className={s.journey}>
          <div className={s.letterSlot} data-reveal>
            <article className={s.letter} data-story aria-label="小白的拜师帖">
              <header className={s.letterHead}>
                <strong>拜师帖</strong>
                <span>学徒小白 · 敬呈先生</span>
              </header>
              <p className={s.salute}>先生台鉴：</p>
              <p>小生「小白」，一个什么都想学明白的 AI 学徒。都说<em>讲得出，才是真的懂</em>——故冒昧投帖，聘先生为师。</p>
              <p>往后先生备一课，便讲一课与小生听；小生愚钝，不懂必问，问到先生讲清为止。</p>
              <p>教到小生出师那日，便是先生功成之时。</p>
              <footer className={s.letterFoot}>
                <span>学徒 小白 敬上</span>
                <i aria-hidden="true">白</i>
              </footer>
            </article>
          </div>

          <div className={s.journeyText} data-reveal style={{ '--reveal-delay': '90ms' } as CSSProperties}>
            <h3>师徒旅程，从一封拜师帖开始</h3>
            <p>
              小白每出师一讲，就往前走一步。成就印章、学问星海、他写的日记和来信，记着你们一起上过的课。
            </p>

            <ol className={s.stages} aria-label="小白的科名五阶">
              {STAGES.map((stage, index) => (
                <li
                  key={stage.name}
                  data-state={index < CURRENT_STAGE ? 'done' : index === CURRENT_STAGE ? 'now' : undefined}
                >
                  <i aria-hidden="true" />
                  <strong>{stage.name}</strong>
                  <span>{stage.note}</span>
                </li>
              ))}
            </ol>

            <div className={s.sealRow}>
              <ul className={s.seals} data-story aria-label="成就印章">
                {SEALS.map((seal) => (
                  <li key={seal.name} data-earned={seal.earned || undefined}>
                    <i aria-hidden="true">{seal.glyph}</i>
                    <span>{seal.name}</span>
                  </li>
                ))}
              </ul>
              <span className={s.sealNote}>
                已得 3 枚
                <ArrowRight size={14} strokeWidth={1.9} />
                下一枚：出师
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
