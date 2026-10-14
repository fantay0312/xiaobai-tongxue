/**
 * 第二章「教」：全页的重心。
 * 上半是「教小白」中枢的复刻：四站切换条（备课 → 上课 → 赴考 → 批注复盘）+ 当前一站的界面 + 侧栏的科名、学识、连续天数与今日课业。
 * 之后是《学记》题句、师徒旅程的纸质物件（拜师帖、日记、来信、证书、成长册）、小白的角色卡，最后列齐本章能力。
 * 纸质物件都挂 data-story；讲解舱黑板用 --board / --chalk 场景色，不随皮肤变。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import {
  ArrowRight, ArrowUp, Camera, Check, Film, Flame, GraduationCap, Highlighter, ImagePlus, MessageCircleQuestion, Mic,
  NotebookText, Radar, RotateCcw, ScrollText, Stamp, Swords, UserRound, X,
} from 'lucide-react';
import {
  IconExam, IconGrowth, IconLesson, IconMemory, IconPrep, IconReview, IconSpark, IconTeach, type XbIconType,
} from '../../components/ui/icons';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { XiaobaiMood } from '../../types';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './teach.module.css';

/* ───────────── 四站 ───────────── */

interface Station {
  key: 'prep' | 'lesson' | 'exam' | 'review';
  name: string;
  icon: XbIconType;
  status: string;
  text: string;
  mood: XiaobaiMood;
  /** 中枢里小白此刻说的一句话 */
  line: string;
}

const STATIONS: readonly Station[] = [
  {
    key: 'prep', name: '备课', icon: IconPrep, status: '已备好',
    text: '先自己把这一课弄懂：摸底、任务卡、讲课路线图、材料、自检，小砚在旁边陪着。',
    mood: 'idle', line: '先生备好课了吗？我在讲解舱等你。',
  },
  {
    key: 'lesson', name: '上课', icon: IconLesson, status: '上过 2 堂 · 讲明白 3/4 处',
    text: '在讲解舱的黑板上讲，小白坐在课桌后听。他只会问，不会替你讲，也不会把答案说出来。',
    mood: 'curious', line: '先生讲到叶子了，可我还有一处没想通。',
  },
  {
    key: 'exam', name: '赴考', icon: IconExam, status: '最近一卷 75 分',
    text: '下课后小白独自答卷，只会你讲过的。哪里没讲清，他就在哪里答错。',
    mood: 'thinking', line: '先生，有几处我答得不够稳。你愿意在灯下再替我批一批么？',
  },
  {
    key: 'review', name: '批注复盘', icon: IconReview, status: '1 处还没讲透',
    text: '先看讲得好的，再看小白还没懂的；每一处红笔批注都连着证据。',
    mood: 'confused', line: '「范围查询」那一处，我还没转过弯来。',
  },
];

/* ── 备课 ── */

const PREP_STEPS = ['摸底快测', '教学任务卡', '讲课路线图', '研读材料包', '备课自检'];
const PREP_NOW = 2;
const PREP_MODES = ['通读', '跟读复述', '例题先行', '只补不会的'];

const ROUTE = [
  { point: '磁盘读得慢，索引要让树尽量矮', ask: '树矮一点，为什么就快？', done: true },
  { point: '非叶子节点只放键，用来指路', ask: '不放数据，那数据去哪了？', done: true },
  { point: '叶子节点从左到右连成链表', ask: '连起来是为了什么？', done: false },
  { point: '节点满了怎样分裂', ask: '满了以后，多出来的键放哪？', done: false },
];

function PrepScene() {
  return (
    <div className={s.scene}>
      <div className={s.sceneHead}>
        <span className={s.crumb}>数据库原理<i aria-hidden="true">›</i><strong>B+ 树索引</strong></span>
        <span className={s.meta}>备课度 60%</span>
      </div>
      <ol className={s.prepRail} aria-label="备课五步">
        {PREP_STEPS.map((name, index) => (
          <li key={name} data-state={index < PREP_NOW ? 'done' : index === PREP_NOW ? 'now' : undefined}>
            <i aria-hidden="true">{index < PREP_NOW ? <Check size={11} strokeWidth={3} /> : index + 1}</i>
            <span>{name}</span>
          </li>
        ))}
      </ol>
      <div className={s.modes}>
        <span>学法</span>
        {PREP_MODES.map((name, index) => <b key={name} data-on={index === 1 || undefined}>{name}</b>)}
      </div>
      <div className={s.routeHead}>
        <strong>讲课路线图</strong>
        <span>每一点都配了小白可能的追问</span>
      </div>
      <ol className={s.route}>
        {ROUTE.map((item) => (
          <li key={item.point} data-done={item.done || undefined}>
            <i aria-hidden="true">{item.done && <Check size={12} strokeWidth={3} />}</i>
            <span className={s.routePoint}>{item.point}</span>
            <em>{item.done ? '讲得出' : '还没过'}</em>
            <span className={s.routeAsk}>小白会问：「{item.ask}」</span>
          </li>
        ))}
      </ol>
      <div className={s.coach}>
        <span className={s.tutor} aria-hidden="true">砚</span>
        <p><strong>小砚</strong>第 3 点你还说不清。要不要我先扮成小白，陪你试讲一遍？</p>
        <span className={s.coachModes} aria-label="小砚的三种用法">
          <b>答疑</b><b data-on>试讲</b><b>草稿</b>
        </span>
      </div>
    </div>
  );
}

/* ── 上课：讲解舱黑板 ── */

const SCAFFOLDS = ['打个比方', '举个例子', '分步讲', '画重点', '换个说法'];
const ATTACH = [
  { icon: ImagePlus, label: '图片' },
  { icon: Film, label: '视频取帧' },
  { icon: Camera, label: '拍照' },
  { icon: Mic, label: '语音' },
];

/** 老师夹进讲义的一张辅助讲图：粉笔画的 B+ 树 */
function TreeSketch() {
  return (
    <svg className={s.sketch} viewBox="0 0 280 124" role="img" aria-label="辅助讲图：一棵 B+ 树，叶子节点连成链表">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="104" y="8" width="72" height="26" rx="4" />
        <path d="M140 8v26" />
        <path d="M112 34 46 82M140 34v48M168 34l66 48" />
        <rect x="8" y="82" width="76" height="26" rx="4" />
        <rect x="102" y="82" width="76" height="26" rx="4" />
        <rect x="196" y="82" width="76" height="26" rx="4" />
        <path d="M84 95h14m-5-4 5 4-5 4M178 95h14m-5-4 5 4-5 4" data-chain />
      </g>
      <g fill="currentColor" fontSize="13" textAnchor="middle">
        <text x="122" y="26">20</text>
        <text x="158" y="26">40</text>
        <text x="46" y="100">5 · 12</text>
        <text x="140" y="100">20 · 31</text>
        <text x="234" y="100">40 · 57</text>
      </g>
    </svg>
  );
}

function LessonScene() {
  return (
    <div className={`${s.scene} ${s.lesson}`}>
      <div className={s.sceneHead}>
        <span className={s.crumb}>数据库原理<i aria-hidden="true">›</i><strong>B+ 树索引</strong></span>
        <span className={s.flow}>
          <span>第 2 轮</span>
          <i aria-hidden="true" />
          <span className={s.mono}>08:42</span>
          <i aria-hidden="true" />
          <span className={s.follow}>跟着在问</span>
        </span>
        <span className={s.endChip}>送小白赴考</span>
      </div>

      <div className={s.room}>
        <div className={s.seat}>
          <XiaobaiAvatar mood="curious" level={2} size={120} variant="seat" />
          <span>小白 · 秀才</span>
        </div>

        <div className={s.board}>
          <div className={s.chalkHead}>
            <span className={s.chalkTopic}><small>今日课题</small>B+ 树索引</span>
            <span className={s.chalkMeta}>讲解 · 第 2 轮</span>
          </div>
          <div className={s.stream}>
            <section className={`${s.round} ${s.roundPast}`} aria-label="第 1 段讲解">
              <div className={s.rowT}>
                <span className={s.mark} aria-hidden="true">师</span>
                <div className={s.writing}>
                  <p>非叶子节点只存键，用来指路；数据全都放在最底下的叶子上。</p>
                  <figure className={s.teacherImage}>
                    <TreeSketch />
                  </figure>
                </div>
              </div>
              <div className={s.rowX}>
                <span className={s.face} aria-hidden="true">
                  <XiaobaiAvatar mood="idle" level={2} size={32} variant="board" />
                </span>
                <div className={s.say}>
                  <span className={s.anno}>小白 · <i>在听</i></span>
                  <p className={s.bubble}>所以上面几层只管指路，真正的数据都在最底下那一层？</p>
                </div>
              </div>
            </section>
            <section className={s.round} aria-label="第 2 段讲解">
              <div className={s.rowT}>
                <span className={s.mark} aria-hidden="true">师</span>
                <div className={s.writing}>
                  <p>对。而且这些叶子节点，从左到右连成了一条链表。</p>
                </div>
              </div>
              <div className={s.rowX} data-tone="ask">
                <span className={s.face} aria-hidden="true">
                  <XiaobaiAvatar mood="curious" level={2} size={32} variant="board" />
                </span>
                <div className={s.say}>
                  <span className={s.anno}>小白 · <i>跟着在问</i></span>
                  <p className={s.bubble}>那叶子节点为什么要连成链表？不连的话，范围查询会怎样？</p>
                </div>
              </div>
            </section>
          </div>
          <div className={s.ledge} aria-hidden="true"><i /><i /><b /></div>
        </div>
      </div>

      <div className={s.dock}>
        <div className={s.scaffolds} aria-label="讲法提示">
          <span>讲法</span>
          {SCAFFOLDS.map((item) => <b key={item}>{item}</b>)}
        </div>
        <div className={s.composer}>
          <span className={s.placeholder}>把知识点讲给小白听，也可以附上图片或视频画面</span>
          <div className={s.composerBar}>
            <ul className={s.attach} aria-label="讲解时可以附上">
              {ATTACH.map(({ icon: Icon, label }) => (
                <li key={label}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            <span className={s.send}><ArrowUp size={15} strokeWidth={2} aria-hidden="true" />讲给小白</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 赴考 ── */

const EXAM = [
  { q: '非叶子节点里存的是什么？', a: '只存键，用来指路。', right: true },
  { q: '数据放在哪一层？', a: '都在叶子上，先生讲过。', right: true },
  {
    q: '为什么 B+ 树适合做范围查询？', a: '因为叶子节点比较多？', right: false,
    whisper: '这处听过……可中间那一步怎么接来着？……我再想一想。',
  },
  { q: '为什么要让树尽量矮？', a: '每往下一层就要读一次盘，层数少，读盘就少。', right: true },
];

function ExamScene() {
  return (
    <div className={`${s.scene} ${s.examScene}`}>
      <ol className={s.phases} aria-label="考试进程">
        <li data-done>送考</li>
        <li data-done>作答</li>
        <li aria-current="step">放榜</li>
      </ol>
      <div className={s.paper} data-story>
        <div className={s.paperHead}>
          <strong>随堂小测 · B+ 树索引</strong>
          <span>答卷人 小白 · 秀才</span>
        </div>
        <ol className={s.examList}>
          {EXAM.map((item) => (
            <li key={item.q} data-right={item.right || undefined}>
              <span className={s.examQ}>{item.q}</span>
              <span className={s.examA}>{item.a}</span>
              {item.whisper && <span className={s.whisper}>心声：{item.whisper}</span>}
              <i aria-label={item.right ? '答对' : '答错'}>
                {item.right ? <Check size={20} strokeWidth={2.6} /> : <X size={20} strokeWidth={2.6} />}
              </i>
            </li>
          ))}
        </ol>
        <div className={s.score}>
          <b>75</b>
          <span>
            <em>乙等</em>
            他答错的那一题，正是你没讲清的那一处。
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 批注复盘 ── */

const EVIDENCE = [
  { time: '08:04', tag: '开课', tone: 'neutral', text: '常规讲解 · B+ 树索引' },
  { time: '08:12', tag: '要点命中', tone: 'ok', text: '「数据全都放在最底下的叶子上」' },
  { time: '08:16', tag: '金句收录', tone: 'ok', text: '「非叶子节点像字典的目录」' },
  { time: '08:19', tag: '表述存疑', tone: 'warn', text: '「连起来，查起来方便」' },
  { time: '08:27', tag: '下课', tone: 'neutral', text: '讲了 4 轮，送小白赴考' },
  { time: '08:31', tag: '小测计分', tone: 'neutral', text: '第 3 题答错 · 75 分' },
] as const;

const DIMS = [
  { name: '覆盖度', value: 75 },
  { name: '准确度', value: 82 },
  { name: '逻辑结构', value: 68 },
  { name: '深度', value: 60 },
  { name: '纠错力', value: 86 },
];

function ReviewScene() {
  return (
    <div className={s.scene}>
      <div className={s.sceneHead}>
        <span className={s.crumb}>灯下批注<i aria-hidden="true">·</i><strong>B+ 树索引</strong></span>
        <span className={s.meta}>1 处高光 · 1 处盲区</span>
      </div>
      <div className={s.fakeTabs} aria-hidden="true">
        <span data-on><Highlighter size={14} strokeWidth={1.75} />批注</span>
        <span><Radar size={14} strokeWidth={1.75} />成绩与证据</span>
        <span><NotebookText size={14} strokeWidth={1.75} />小白日记</span>
      </div>

      <div className={s.reviewGrid}>
        <div className={s.reviewMain}>
          <p className={s.highlight}>
            <IconSpark size={16} />
            <span>把非叶子节点比作字典的目录：先查目录，再翻到那一页。</span>
            <b>金句收录</b>
          </p>

          <article className={s.blind} data-story aria-label="红笔批注：小白还没懂的地方">
            <header>
              <strong>叶子链表与范围查询</strong>
              <span>还没讲到</span>
            </header>
            <p className={s.said}>
              <small>第 3 轮 · 你的原话</small>
              <span>「连起来，<u>查起来方便</u>。」</span>
            </p>
            <p className={s.redPen}>方便在哪？没讲出：找到范围的起点后，顺着链表往后读，不用再回到根节点。</p>
          </article>

          <div className={s.dims}>
            <strong>五维画像</strong>
            <ul>
              {DIMS.map((dim) => (
                <li key={dim.name}>
                  <span>{dim.name}</span>
                  <i aria-hidden="true"><b style={{ width: `${dim.value}%` }} /></i>
                  <span className={s.mono}>{dim.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={s.evidence}>
          <strong className={s.evidenceTitle}>证据链</strong>
          <ol>
            {EVIDENCE.map((item) => (
              <li key={item.time}>
                <span className={s.mono}>{item.time}</span>
                <b data-tone={item.tone}>{item.tag}</b>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

const SCENES = { prep: PrepScene, lesson: LessonScene, exam: ExamScene, review: ReviewScene };

/* ───────────── 中枢侧栏 ───────────── */

const STAGES = [
  { name: '童生', note: '初入问学' },
  { name: '秀才', note: '初通一艺' },
  { name: '举人', note: '旁涉群书' },
  { name: '贡士', note: '问难穷理' },
  { name: '进士', note: '学成登科' },
];
const CURRENT_STAGE = 1;

const QUESTS = [
  { glyph: '讲', title: '给小白上一课', hint: '讲明白 3 处要点', now: 2, target: 3 },
  { glyph: '破', title: '降服一个心魔', hint: '小白想岔时，把他拉回来', now: 1, target: 1 },
  { glyph: '考', title: '送小白赴考', hint: '下课后让他独立答一张卷', now: 0, target: 1 },
  { glyph: '恒', title: '保持连续', hint: '今天学一点就算', now: 1, target: 1 },
];

function Hub({ station }: { station: Station }) {
  const done = QUESTS.filter((quest) => quest.now >= quest.target).length;
  return (
    <aside className={s.hub} aria-label="教小白中枢：小白的近况">
      <div className={s.hubTop}>
        <div className={s.portrait} data-story>
          <XiaobaiAvatar mood={station.mood} level={2} size={64} variant="paper" />
        </div>
        <div className={s.hubName}>
          <span className={s.hubEyebrow}><IconTeach size={14} />教小白</span>
          <strong>秀才<span>初通一艺</span></strong>
        </div>
        <span className={s.streak}><Flame size={14} strokeWidth={1.9} aria-hidden="true" />连续 6 天</span>
      </div>

      <blockquote className={s.voice}>{station.line}</blockquote>

      <div className={s.xp}>
        <div className={s.xpHead}>
          <span>学识 · 第 3 阶</span>
          <span className={s.mono}>84 / 120</span>
        </div>
        <span className={s.xpBar}><i style={{ width: '70%' }} /></span>
      </div>

      <ol className={s.rail} aria-label="科名五阶">
        {STAGES.map((stage, index) => (
          <li
            key={stage.name}
            data-state={index < CURRENT_STAGE ? 'done' : index === CURRENT_STAGE ? 'now' : undefined}
            aria-current={index === CURRENT_STAGE ? 'step' : undefined}
          >
            <i aria-hidden="true" />
            {stage.name}
          </li>
        ))}
      </ol>

      <div className={s.quests}>
        <div className={s.questsHead}>
          <strong>今日课业</strong>
          <span className={s.mono}>{done} / {QUESTS.length}</span>
        </div>
        <ul>
          {QUESTS.map((quest) => {
            const finished = quest.now >= quest.target;
            return (
              <li key={quest.title} data-done={finished || undefined}>
                <span className={s.questSeal} aria-hidden="true">{quest.glyph}</span>
                <span className={s.questText}>
                  <b>{quest.title}</b>
                  <span>{quest.hint}</span>
                </span>
                <span className={s.questCount}>
                  {finished ? <Check size={15} strokeWidth={2.4} aria-label="已完成" /> : `${quest.now}/${quest.target}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

/* ───────────── 师徒旅程：纸质物件 ───────────── */

const SEALS = [
  { glyph: '启', name: '开讲', earned: true },
  { glyph: '正', name: '正误', earned: true },
  { glyph: '喻', name: '妙喻', earned: true },
  { glyph: '师', name: '出师', earned: false },
  { glyph: '温', name: '温故', earned: false },
];

/** 学问星海里的星：x/y 为百分比，state 对应成长册的四种状态 */
const STARS = [
  { x: 14, y: 30, state: 'mastered' }, { x: 27, y: 62, state: 'learning' }, { x: 36, y: 22, state: 'mastered' },
  { x: 47, y: 50, state: 'forgotten' }, { x: 58, y: 28, state: 'learning' }, { x: 64, y: 72, state: 'unlearned' },
  { x: 74, y: 44, state: 'mastered' }, { x: 84, y: 20, state: 'unlearned' }, { x: 88, y: 66, state: 'learning' },
  { x: 20, y: 80, state: 'unlearned' }, { x: 42, y: 80, state: 'unlearned' }, { x: 94, y: 40, state: 'unlearned' },
] as const;

const STAR_LEGEND = [
  { state: 'mastered', label: '出师' },
  { state: 'forgotten', label: '待复习' },
  { state: 'learning', label: '学习中' },
  { state: 'unlearned', label: '未学' },
] as const;

interface ShelfItem {
  key: string;
  title: string;
  text: string;
  object: () => ReactElement;
}

const SHELF: readonly ShelfItem[] = [
  {
    key: 'mentor',
    title: '拜师帖',
    text: '第一次进门，小白递来一封拜师帖。收下它，师徒旅程就开始了。',
    object: () => (
      <article className={s.mentor} data-story aria-label="小白的拜师帖">
        <header>
          <strong>拜师帖</strong>
          <span>学徒小白 · 敬呈先生</span>
        </header>
        <p className={s.salute}>先生台鉴：</p>
        <p>小生「小白」，一个什么都想学明白的 AI 学徒。都说<em>讲得出，才是真的懂</em>——故冒昧投帖，聘先生为师。</p>
        <p>往后先生备一课，便讲一课与小生听；小生愚钝，不懂必问，问到先生讲清为止。</p>
        <p>教到小生出师那日，便是先生功成之时。</p>
        <footer>
          <span>学徒 小白 敬上</span>
          <i aria-hidden="true">白</i>
        </footer>
      </article>
    ),
  },
  {
    key: 'diary',
    title: '小白日记',
    text: '每上完一课，他用自己的话写一页：哪段听得认真，哪句被你讲通了。',
    object: () => (
      <article className={s.diary} data-story aria-label="小白的日记">
        <header>
          <strong>十月十四日</strong>
          <span>晴</span>
        </header>
        <p>今天先生给我讲了「B+ 树索引」，「数据都在叶子上」那一段我听得特别认真。</p>
        <p>先生原话是：「非叶子节点像字典的目录」——我把这句记在心里了。</p>
        <p>不知道下次课先生要讲什么，好想快点到下次课。</p>
      </article>
    ),
  },
  {
    key: 'letter',
    title: '小白来信',
    text: '他记不清的课，会写信来问。回信就是带他温书，帮他想起来。',
    object: () => (
      <article className={s.note} data-story aria-label="小白的来信">
        <p className={s.salute}>先生：</p>
        <p>先生讲过的『非叶子节点只放键』，弟子还记得。</p>
        <p>只是『节点分裂』那一处，弟子越想越模糊……当时是怎么回事来着？</p>
        <footer>
          <span>弟子 小白</span>
          <b>回信 · 帮他温书</b>
        </footer>
      </article>
    ),
  },
  {
    key: 'certificate',
    title: '出师证书',
    text: '一门课讲到小白出师，颁发一张结业证书，落款是你。',
    object: () => (
      <article className={s.cert} data-story aria-label="结业证书">
        <span className={s.certEyebrow}>CERTIFICATE OF MASTERY · 结业执照</span>
        <strong>结业证书</strong>
        <p>兹有弟子小白，习《数据库原理 · B+ 树索引》</p>
        <p>问难十二回，心魔尽除，今已出师</p>
        <p className={s.certTeacher}>授业师：先生</p>
        <span className={s.certSeal} aria-hidden="true">出师</span>
      </article>
    ),
  },
  {
    key: 'growth',
    title: '成长册',
    text: '成就印章、教学编年史与学问星海：每门课出师了没有、该不该复习，一眼看到。',
    object: () => (
      <div className={s.growth}>
        <div className={s.sky} role="img" aria-label="学问星海：已出师 3 门，待复习 1 门，学习中 3 门，未学 5 门">
          {STARS.map((star) => (
            <i
              key={`${star.x}-${star.y}`}
              data-state={star.state}
              style={{ left: `${star.x}%`, top: `${star.y}%` } as CSSProperties}
            />
          ))}
          <span className={s.skyTitle}>学问星海</span>
          <ul className={s.skyLegend} aria-hidden="true">
            {STAR_LEGEND.map((item) => <li key={item.state} data-state={item.state}><i />{item.label}</li>)}
          </ul>
        </div>
        <ul className={s.seals} data-story aria-label="成就印章，已得 3 枚">
          {SEALS.map((seal) => (
            <li key={seal.name} data-earned={seal.earned || undefined}>
              <i aria-hidden="true">{seal.glyph}</i>
              <span>{seal.name}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
];

function Shelf() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();

  // 手机上是横滑的一排（轨道是定位容器，子项 offsetLeft 相对轨道）：按滚动位置算出当前是第几件
  const onScroll = () => {
    const track = trackRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    const items = Array.from(track.children) as HTMLElement[];
    const start = items[0]?.offsetLeft ?? 0;
    const left = track.scrollLeft;
    let best = 0;
    items.forEach((item, index) => {
      if (Math.abs(item.offsetLeft - start - left) < Math.abs(items[best].offsetLeft - start - left)) best = index;
    });
    if (left + track.clientWidth >= track.scrollWidth - 2) best = items.length - 1;
    setActive(best);
  };

  const goTo = (index: number) => {
    const track = trackRef.current;
    const items = track ? (Array.from(track.children) as HTMLElement[]) : [];
    if (!track || !items[index]) return;
    track.scrollTo({ left: items[index].offsetLeft - items[0].offsetLeft, behavior: reducedMotion ? 'auto' : 'smooth' });
    setActive(index);
  };

  return (
    <>
      <div ref={trackRef} className={s.shelf} onScroll={onScroll} data-reveal>
        {SHELF.map((item) => (
          <figure key={item.key} className={s.shelfItem} data-key={item.key}>
            <div className={s.object}>{item.object()}</div>
            <figcaption>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className={s.dots} role="group" aria-label="师徒旅程的物件">
        {SHELF.map((item, index) => (
          <button
            key={item.key}
            type="button"
            aria-label={`第 ${index + 1} 件：${item.title}`}
            aria-current={index === active || undefined}
            onClick={() => goTo(index)}
          >
            <i />
          </button>
        ))}
      </div>
    </>
  );
}

/* ───────────── 小白的角色卡 ───────────── */

const TEACHER_LINE = '梯度下降就是每一步都朝着让误差降得最快的方向走一小步，一步一步走到谷底。';

const PERSONAS = [
  {
    name: '好奇宝宝',
    text: '十二三岁的样子，对什么都好奇，听到新词眼睛会亮。说话短、快，喜欢打破砂锅问到底，常拿身边的事打比方。',
    reply: '先生是说，每次都挑最陡的方向往下走一小步？那要是走进一个小坑，以为到底了怎么办？',
  },
  {
    name: '慢热书呆',
    text: '话不多，想清楚了才开口。说话慢条斯理，爱用「我想确认一下」开头。不轻易说懂了，会把老师的话拆成一步一步核对。',
    reply: '我想确认一下：方向是误差降得最快的那边，步子每次都很小。那这一小步，多小才算小？',
  },
  {
    name: '抬杠小能手',
    text: '嘴硬心软，听到结论先找反例，口头禅是「那要是……呢」。被讲服了会不太情愿地承认「行吧，这回算你对」。',
    reply: '每一步都挑最陡的走，听着不错。那要是最陡的那条路，通到的不是最低的谷底呢？',
  },
  {
    name: '活泼话痨',
    text: '元气很足，想到哪说到哪，喜欢用拟声词和夸张的比喻。兴奋的时候句子会变短、连着问两个问题。',
    reply: '哇，像闭着眼睛下山，哪边最陡就往哪边挪！那挪着挪着停不下来怎么办？怎么知道到底了？',
  },
  {
    name: '江湖少年',
    text: '半文半白的口气，称老师为「先生」，把学习说成练功、过招。听懂一处说「这一招我接住了」，没懂说「这一式我还看不破」。',
    reply: '先生是说顺着最陡的坡一步步往下走？这一招我接住了。只是步子迈大了，会不会一脚跨过谷底？',
  },
];

const LIVELINESS = ['沉稳', '稳当', '平和', '活泼', '跳脱'];

function PersonaCard() {
  const [pick, setPick] = useState(4);
  const persona = PERSONAS[pick];

  return (
    <div className={`${base.split} ${s.persona}`}>
      <div className={s.personaText} data-reveal>
        <h3>小白的性格，由你来写</h3>
        <p>
          在设置里给小白写一张角色卡：一段文字写他的性格和说话方式，也可以从模板起稿；再定他怎么称呼你、说话有多活泼。点下面的模板，听他对同一句讲解怎么开口。
        </p>
        <p className={s.rule}>
          <MessageCircleQuestion size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>角色卡只改口吻。他仍然只提问和复述，不替你讲，不泄漏答案，也不会用你还没教过的词。</span>
        </p>
        <p className={s.small}>角色卡按账号保存在当前浏览器。</p>
      </div>

      <div className={`${base.panel} ${s.card}`} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
        <div className={s.cardRow}>
          <span className={s.cardLabel}>性格</span>
          <span className={s.seg} aria-hidden="true"><b>预设</b><b data-on>自定义角色卡</b></span>
        </div>
        <div className={s.chips} role="group" aria-label="角色卡模板">
          {PERSONAS.map((item, index) => (
            <button key={item.name} type="button" aria-pressed={index === pick} onClick={() => setPick(index)}>
              {item.name}
            </button>
          ))}
        </div>
        <div className={s.cardText}>
          <p>{persona.text}</p>
          <span className={s.mono}>{persona.text.length} / 600</span>
        </div>
        <div className={s.cardGrid}>
          <div>
            <span className={s.cardLabel}>怎么称呼你</span>
            <span className={s.address} aria-hidden="true"><b data-on>先生</b><b>老师</b><b>师父</b></span>
          </div>
          <div>
            <span className={s.cardLabel}>说话活泼程度 · 平和</span>
            <span className={s.slider} aria-hidden="true">
              {LIVELINESS.map((name, index) => <i key={name} data-on={index <= 2 || undefined} />)}
            </span>
          </div>
        </div>
        <div className={s.listen}>
          <span className={s.cardLabel}>试听一句</span>
          <p className={s.teacherLine}>{TEACHER_LINE}</p>
          <div className={s.replyRow}>
            <span className={s.replyFace} data-story aria-hidden="true">
              <XiaobaiAvatar mood="curious" level={2} size={36} variant="paper" />
            </span>
            <p className={s.reply} aria-live="polite">{persona.reply}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 能力清单 ───────────── */

const CAPS: readonly Cap[] = [
  { icon: IconTeach, title: '教小白中枢', text: '备课、上课、赴考、批注复盘四站串起一门课，旁边是科名、学识、连续天数和今日课业。' },
  { icon: IconPrep, title: '备课五步', text: '摸底快测、教学任务卡、讲课路线图、研读材料包、备课自检；学法可选通读、跟读复述、例题先行、只补不会的。' },
  { icon: UserRound, title: '小砚陪你备课', text: '备课时小砚在旁答疑、扮成小白陪你试讲、和你共用一份讲稿；进了讲解舱她就不再出现。' },
  { icon: IconLesson, title: '讲解舱上课', text: '你的话写在黑板上，小白坐在课桌后追问；讲法提示帮你起个头：打比方、举例子、分步讲。' },
  { icon: ImagePlus, title: '图片、视频帧与语音', text: '讲解可以附一张图、现拍一张，或从视频里取一帧；也可以开口讲，转成文字改好再发。' },
  { icon: MessageCircleQuestion, title: '只问不教', text: '小白只提问和复述，不替你讲，不泄漏答案，也不用你还没教过的词。' },
  { icon: Swords, title: '心魔', text: '小白有时会想岔。把他拉回来；拉不回来，他就真的学错，复盘时会现形。' },
  { icon: IconExam, title: '赴考', text: '送考、作答、放榜三幕：下课后小白独立答卷，只会你讲过的，没讲清的地方就答错。' },
  { icon: IconReview, title: '批注复盘', text: '先看高光和金句，再看小白还没懂的地方；被带偏的盲区附三步补学路径。' },
  { icon: Radar, title: '五维画像与证据链', text: '覆盖度、准确度、逻辑结构、深度、纠错力，每一分都能回放到课上发生的那一刻。' },
  { icon: RotateCcw, title: '重讲与温书', text: '被带偏的课可以重讲验证；小白记不清的课，他会写信来，你带他温书。' },
  { icon: GraduationCap, title: '科名与学识', text: '童生、秀才、举人、贡士、进士五阶；讲明白要点、纠正误区、送考、温书都会长学识。' },
  { icon: Flame, title: '今日课业与连续天数', text: '每天几项课业对着当天真实的学习记录计数，做完落一枚朱印。' },
  { icon: ScrollText, title: '拜师帖、日记、来信、证书', text: '纸质物件都从你们上过的课里生成，不凭空编造。' },
  { icon: Stamp, title: '成就印章', text: '开讲、正误、妙喻、出师、温故……每一枚对着一件真实发生过的事。' },
  { icon: IconGrowth, title: '成长册与学问星海', text: '科名进阶、教学编年史、金句画廊；星海里每门课是出师、待复习、学习中还是未学，一眼看到。' },
  { icon: IconMemory, title: '小白记得上过的课', text: '他的记忆记下你讲过什么、用过哪句比方，下次上课接着问。' },
  { icon: IconSpark, title: '角色卡', text: '用一段文字或模板写他的性格，设他怎么称呼你、说话多活泼；只改口吻，不改纪律。' },
];

/* ───────────── 本章 ───────────── */

export function TeachChapter() {
  const meta = sectionById('teach');
  const reducedMotion = useReducedMotion();
  const [stageRef, inView] = useInView<HTMLDivElement>(0.35);
  const stripRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  // 访客点过之后不再自动轮播，把节奏交还给他
  const [auto, setAuto] = useState(true);
  const station = STATIONS[step];
  const next = STATIONS[(step + 1) % STATIONS.length];

  const go = (index: number, focus = false) => {
    setAuto(false);
    setStep(index);
    if (focus) document.getElementById(`teach-tab-${STATIONS[index].key}`)?.focus();
  };

  // 手机上四站是横滑的一条：切到哪一站，就把它滚进条里（只滚条，不动整页）。
  // 访客还没点过时不滚，让他先看到第一站（自动轮播只在宽屏，那时条不可滚）。
  useEffect(() => {
    if (auto) return;
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const tab = strip.children[step] as HTMLElement | undefined;
    if (!tab) return;
    const target = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [step, auto, reducedMotion]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = STATIONS.length - 1;
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = step === last ? 0 : step + 1;
    else if (event.key === 'ArrowLeft') target = step === 0 ? last : step - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = last;
    if (target === null) return;
    event.preventDefault();
    go(target, true);
  };

  return (
    <section id={meta.id} className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="chapter-teach">
      <div className={base.wrap}>
        <ChapterHead
          no={meta.no!}
          glyph={meta.glyph!}
          name={meta.label}
          titleId="chapter-teach"
          title="把刚学会的，讲给小白听。"
          lead="小白是你的 AI 学生，什么都想弄明白，却什么都还不懂。他只会问，不会教，也不会把答案说出来。你跳过的步骤他会追问，你讲岔的地方他会跟着岔。一门课走四站：备课、上课、赴考、批注复盘。"
        />

        <div ref={stageRef} className={`${base.chapterBody} ${base.stage} ${s.stage}`} data-reveal>
          <div ref={stripRef} className={s.tabs} role="tablist" aria-label="一门课的四站">
            {STATIONS.map((item, index) => {
              const Icon = item.icon;
              const selected = index === step;
              return (
                <button
                  key={item.key}
                  id={`teach-tab-${item.key}`}
                  type="button"
                  role="tab"
                  className={s.tab}
                  aria-selected={selected}
                  aria-controls="teach-scene"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => go(index)}
                  onKeyDown={onKey}
                >
                  <span className={s.tabTop}>
                    <span className={s.tabNo}>{String(index + 1).padStart(2, '0')}</span>
                    <Icon size={20} active={selected} />
                  </span>
                  <strong>{item.name}</strong>
                  <span className={s.tabStatus}>{item.status}</span>
                  {selected && auto && !reducedMotion && (
                    <i
                      className={s.timer}
                      data-playing={inView || undefined}
                      onAnimationEnd={() => setStep((index + 1) % STATIONS.length)}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className={s.indicator} aria-hidden="true">
            {STATIONS.map((item, index) => <i key={item.key} data-on={index <= step || undefined} />)}
            <span>{step + 1} / {STATIONS.length}</span>
          </div>

          <div className={s.body}>
            <div
              id="teach-scene"
              role="tabpanel"
              aria-labelledby={`teach-tab-${station.key}`}
              className={`${base.panel} ${s.panel}`}
            >
              {/* 四幕叠在同一格里：宽屏下面板取最高一幕的高度，切换时下方内容不跳；窄屏只渲染当前一幕 */}
              <div className={s.slots}>
                {STATIONS.map((item, index) => {
                  const SceneOf = SCENES[item.key];
                  const active = index === step;
                  return (
                    <div
                      key={item.key}
                      className={s.slot}
                      data-active={active || undefined}
                      aria-hidden={!active || undefined}
                      inert={!active || undefined}
                    >
                      <SceneOf />
                    </div>
                  );
                })}
              </div>
              <div className={s.panelFoot}>
                <p aria-live="polite">{station.text}</p>
                {station.key === 'review' ? (
                  <button type="button" className={s.nextBtn} onClick={() => go(0)}>
                    <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
                    补上这一处，再讲一遍
                  </button>
                ) : (
                  <button type="button" className={s.nextBtn} onClick={() => go(step + 1)}>
                    下一站：{next.name}
                    <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <Hub station={station} />
          </div>
        </div>

        <figure className={s.motto} data-reveal>
          <blockquote>教然后知困</blockquote>
          <figcaption>
            <cite>《礼记·学记》</cite>
            <span>去教别人，才知道自己哪里还没弄懂。小白就是为这句话来的。</span>
          </figcaption>
        </figure>

        <div className={s.journeyHead} data-reveal>
          <h3>师徒旅程，从一封拜师帖开始</h3>
          <p>小白每出师一门课，就往前走一步。他写的日记和来信、你颁给他的证书、攒下的印章和点亮的星，都记着你们一起上过的课。</p>
        </div>
        <Shelf />

        <PersonaCard />

        <Caps label="教小白的全部能力" items={CAPS} />
      </div>
    </section>
  );
}
