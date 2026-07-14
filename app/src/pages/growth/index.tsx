/**
 * 成长页 /growth —— 一本真正的「成长册」,按书卷编次:
 * 卷首·师徒(小白阶梯+人格+师道称号印+下一步) / 卷一·印章墙 / 卷二·教学编年史 /
 * 卷三·盲区图谱(遗忘的知识点化作「小白的来信」信笺) / 卷四·金句画廊 /
 * 卷五·小白的记忆(四层记忆匣,engine/recall 派生) / 卷尾·小白眼里的你(印象句+可复算出处)。
 * 数据全部真实派生:印章与师道称号来自 engine/achievements,下一步来自 engine/journey,
 * 编年史把 events 按 sessionId 与 reports 并轨(sessionId 为 null 的备课/补学作独立眉批);
 * 卷二/卷三/卷尾 section 带 id(chronicle/map/bond)供卷五记忆匣的锚点按钮 scrollIntoView。
 * 保留契约:setPersona / 复习 await startReview(topicId) → navigate(`/teach/${topicId}?mode=review`)
 * 且 reviewBusy 防抖原样;右下角演示重置的行内二次确认原样(答辩依赖)。
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LearnEvent, LearnEventType, Persona, SessionMode, SessionReport, XiaobaiMood } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic, TOPICS } from '../../data';
import { deriveAchievements, deriveTeacherRank } from '../../engine/achievements';
import { nextStep } from '../../engine/journey';
// 双轨成长引擎:同 achievements/journey 惯例按路径直接 import,不进 engine barrel
import { STAGE_RULES, deriveWisdom, deriveEvolution } from '../../engine/evolution';
import { deriveXiaobaiLetter } from '../../engine/story';
import { deriveMemoryPanorama, deriveRelationshipLines } from '../../engine/recall';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { XiaobaiLetter } from '../../components/story/XiaobaiLetter';
import { MemoryPanorama } from '../../components/story/MemoryPanorama';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useDocTitle } from '../../hooks/useDocTitle';
import { KnowledgeMap, type MapNode } from './KnowledgeMap';
import s from './growth.module.css';

/* 五阶称号沿用既有成长语义;头像以壹至伍学识印标记当前阶段 */
const LEVELS: { lv: 1 | 2 | 3 | 4 | 5; name: string; desc: string; icon: IconName }[] = [
  { lv: 1, name: '嫩芽', desc: '初入学堂', icon: 'sprout' },
  { lv: 2, name: '灯泡', desc: '偶有灵光', icon: 'lightbulb' },
  { lv: 3, name: '眼镜', desc: '追问成性', icon: 'glasses' },
  { lv: 4, name: '问号', desc: '刨根问底', icon: 'circle-help' },
  { lv: 5, name: '学士帽', desc: '可以出师', icon: 'graduation' },
] as const;

const DREAM_GOAL = 5;

const PERSONAS: { name: Persona; line: string }[] = [
  { name: '好奇型', line: '「哇,为什么会这样?然后呢然后呢?」' },
  { name: '严谨型', line: '「等等,这个说法有依据吗?边界在哪儿?」' },
  { name: '杠精型', line: '「我不信。你要是对的,这段代码怎么解释?」' },
];

const PERSONA_MOOD: Record<Persona, XiaobaiMood> = {
  好奇型: 'curious',
  严谨型: 'thinking',
  杠精型: 'proud',
};

const EVENT_LABEL: Record<LearnEventType, string> = {
  session_started: '开课',
  checklist_hit: '要点命中',
  accuracy_flag: '表述存疑',
  misconception_injected: '误区注入',
  misconception_corrected: '误区纠正',
  misconception_adopted: '被带偏',
  golden_analogy_saved: '金句收录',
  stuck_rescued: '卡壳救援',
  prep_completed: '备课完成',
  remedy_completed: '补学完成',
  topic_mastered: '出师',
  review_triggered: '复习触发',
  review_passed: '复习通过',
  xiaobai_quiz_scored: '小测计分',
  session_ended: '下课',
};

const MODE_LABEL: Record<SessionMode, string> = { teach: '讲解', reteach: '重讲', review: '复习' };

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

/* 入场步进 75ms,同屏最长 delay 封顶 300ms(加浓轮 R6) */
const rise = (i: number) => ({ animationDelay: `${Math.min(i * 75, 300)}ms` });

// ── 卷二·编年史装订:events 按 sessionId 分组,与 reports 并轨,倒序 ──

interface SessionEntry {
  kind: 'session';
  sessionId: string;
  t: string;
  topicId: string;
  mode: SessionMode;
  turns: number | null;
  corrected: number;
  adopted: number;
  golden: number;
  reviewPassed: boolean;
  quizScore: number | null;
  mastered: boolean;
  abandoned: boolean;
  hasReport: boolean;
}

interface MarginEntry {
  kind: 'margin';
  id: string;
  t: string;
  topicId: string;
  type: 'prep_completed' | 'remedy_completed';
  evidence: string;
}

type ChronicleEntry = SessionEntry | MarginEntry;

function buildChronicle(events: LearnEvent[], reports: SessionReport[]): ChronicleEntry[] {
  const reportOf = new Map(reports.map((r) => [r.sessionId, r]));
  const groups = new Map<string, LearnEvent[]>();
  const margins: MarginEntry[] = [];
  for (const e of events) {
    if (e.sessionId) {
      const list = groups.get(e.sessionId);
      if (list) list.push(e);
      else groups.set(e.sessionId, [e]);
    } else if (e.type === 'prep_completed' || e.type === 'remedy_completed') {
      // 无会话归属的备课/补学:作独立眉批,evidence 本身已是一句人话
      margins.push({ kind: 'margin', id: e.id, t: e.t, topicId: e.topicId, type: e.type, evidence: e.evidence });
    }
  }
  const sessions: SessionEntry[] = [];
  for (const [sessionId, evs] of groups) {
    const report = reportOf.get(sessionId) ?? null;
    const first = evs[0];
    const rawMode = evs.find((e) => e.type === 'session_started')?.payload.mode;
    const ended = evs.find((e) => e.type === 'session_ended');
    const turnsRaw = report?.turnCount ?? ended?.payload.turns;
    const scoreRaw = report?.quiz?.score ?? evs.find((e) => e.type === 'xiaobai_quiz_scored')?.payload.score;
    sessions.push({
      kind: 'session',
      sessionId,
      t: first.t,
      topicId: first.topicId,
      mode: rawMode === 'reteach' || rawMode === 'review' ? rawMode : (report?.mode ?? 'teach'),
      turns: typeof turnsRaw === 'number' ? turnsRaw : null,
      corrected: evs.filter((e) => e.type === 'misconception_corrected').length,
      adopted: evs.filter((e) => e.type === 'misconception_adopted').length,
      golden: evs.filter((e) => e.type === 'golden_analogy_saved').length,
      reviewPassed: evs.some((e) => e.type === 'review_passed'),
      quizScore: typeof scoreRaw === 'number' ? scoreRaw : null,
      mastered: (report?.masteredNow ?? false) || evs.some((e) => e.type === 'topic_mastered'),
      abandoned: ended?.payload.abandoned === true,
      hasReport: report !== null,
    });
  }
  return [...sessions, ...margins].sort((a, b) => (a.t < b.t ? 1 : -1));
}

/** 一句叙事:按真实事件拼装,措辞克制;盲区语言纪律——只说小白怎么样,不说你错了。
    中途弃课不是互斥分支而是后缀从句:有成果也要如实记下「合上了书」,免得编年史与事实相反 */
function narrate(en: SessionEntry, title: string): string {
  const t = `〈${title}〉`;
  const head =
    en.mode === 'review' ? `这天你陪小白复习${t}`
      : en.mode === 'reteach' ? `这天你把${t}回炉重讲`
        : `这天你把${t}讲给小白`;
  const tail = en.abandoned && !en.mastered ? ',这一课中途合上了书' : '';
  if (en.mode === 'review' && en.reviewPassed) return `${head},几句点拨,它「想起来了」。`;
  if (en.mastered) return `${head},讲到它当堂出师。`;
  if (en.adopted > 0 && en.corrected > 0) return `${head},它把你将了一军,你也识破了它埋的误区${tail}。`;
  if (en.adopted > 0) return `${head},它在误区上把你将了一军${tail}。`;
  if (en.corrected > 0) return `${head},它埋的误区被你当场识破${tail}。`;
  if (en.golden > 0) return `${head},你打的比方被它记进了小本子${tail}。`;
  if (en.abandoned) return `${head},这一课中途合上了书。`;
  if (en.quizScore !== null) return `${head},随堂小测考了小白 ${en.quizScore} 分。`;
  // 只有 session_started 落档(直接关了标签页,没有下课事件):不能谎称「一问一答」
  if (!en.hasReport && en.turns === null) return `${head},这一课开了个头,还没讲完。`;
  return `${head},一问一答,平实往来。`;
}

export default function GrowthPage() {
  useDocTitle('成长册');
  const navigate = useNavigate();
  const global = useAppStore((st) => st.global);
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);
  // 卷五当堂层要跟着课堂实时走:live 也入订阅,开课/下课/答问都会让记忆匣重新派生
  const live = useAppStore((st) => st.live);
  const topicStateOf = useAppStore((st) => st.topicState);
  const setPersona = useAppStore((st) => st.setPersona);
  const startReview = useAppStore((st) => st.startReview);
  const resetAll = useAppStore((st) => st.resetAll);

  const [selected, setSelected] = useState<string | null>(null);
  const [openSeal, setOpenSeal] = useState<string | null>(null);
  const [oldPages, setOldPages] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 印章 / 师道称号 / 下一步 / 编年史:全部由事件流等真实数据纯函数派生
  const deriveInput = useMemo(
    () => ({ events, reports, global, topicStates, topics: TOPICS }),
    [events, reports, global, topicStates],
  );
  const achievements = useMemo(() => deriveAchievements(deriveInput), [deriveInput]);
  const rank = useMemo(() => deriveTeacherRank(deriveInput), [deriveInput]);
  const step = useMemo(
    () => nextStep({ events, reports, topicStates, topics: TOPICS }),
    [events, reports, topicStates],
  );
  const chronicle = useMemo(() => buildChronicle(events, reports), [events, reports]);
  // 双轨成长(纯派生,不新增事件):学识经验轨(升级)+ 五阶进化轨(升期),均从 events 重算
  const wisdom = useMemo(() => deriveWisdom(events), [events]);
  const evolution = useMemo(() => deriveEvolution(events, TOPICS), [events]);
  const next = evolution.next;
  // 卷五·四层记忆匣 + 卷尾·印象句:engine/recall 纯派生,每句都带可复算的出处
  const panorama = useMemo(
    () => deriveMemoryPanorama({ events, reports, topicStates, topics: TOPICS, global, live }),
    [events, reports, topicStates, global, live],
  );
  const bondLines = useMemo(
    () => deriveRelationshipLines({ events, reports, global }),
    [events, reports, global],
  );

  // 学识条:intoLevel 已入本级的点数 / forNext 升下一级门槛(deriveWisdom 收口,恒 >0)
  const wisdomLeft = Math.max(0, wisdom.forNext - wisdom.intoLevel);
  const wisdomPct = wisdom.forNext > 0 ? Math.min(100, (wisdom.intoLevel / wisdom.forNext) * 100) : 100;

  const earnedCount = achievements.filter((a) => a.earnedAt !== null).length;
  const openAch = achievements.find((a) => a.id === openSeal) ?? null;
  // 收起时缓存上一次内容:让 0fr 折叠动画带着内容合上,而不是先卸载再对空容器过渡
  const lastAchRef = useRef<typeof openAch>(null);
  if (openAch) lastAchRef.current = openAch;
  const shownAch = openAch ?? lastAchRef.current;
  const shownChronicle = oldPages ? chronicle : chronicle.slice(0, 6);
  // 实印分色:tier → 印章样式(string 索引宽容契约外值,落回墨印)
  const TIER_CLASS: Record<string, string> = { ink: s.sealInk, cinnabar: s.sealCinnabar, gold: s.sealGold };
  const TIER_NAME: Record<string, string> = { ink: '墨印', cinnabar: '朱印', gold: '金印' };

  const nodes: MapNode[] = TOPICS.map((t) => {
    if (t.locked) return { topic: t, state: null, status: 'locked' as const };
    const st = topicStates[t.topicId] ?? topicStateOf(t.topicId);
    const touched =
      st.hitChecklist.length > 0 || st.prepDone || st.knowledgeState !== '没懂' ||
      events.some((e) => e.topicId === t.topicId);
    const status = st.forgotten
      ? ('forgotten' as const)
      : st.knowledgeState === '出师'
        ? ('mastered' as const)
        : touched
          ? ('learning' as const)
          : ('unlearned' as const);
    return { topic: t, state: st, status };
  });

  const selNode = nodes.find((n) => n.topic.topicId === selected) ?? null;
  // 同印章墙:收起时缓存内容,折叠动画不吃空
  const lastNodeRef = useRef<MapNode | null>(null);
  if (selNode) lastNodeRef.current = selNode;
  const shownNode = selNode ?? lastNodeRef.current;
  const shownEvents = shownNode ? events.filter((e) => e.topicId === shownNode.topic.topicId) : [];
  const forgottenNodes = nodes.filter((n) => n.status === 'forgotten');

  const mood: XiaobaiMood =
    global.learningLevel >= 5 ? 'proud' : global.topicsMastered > 0 ? 'happy' : PERSONA_MOOD[global.persona];

  const goReview = async (topicId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await startReview(topicId);
      navigate(`/teach/${topicId}?mode=review`);
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div className={s.page}>
      {/* ── 卷首·师徒:弟子画像立轴 + 修行阶牌 + 性情之笺 + 师道/下一步双卡 ── */}
      <header className={`${s.hero} ${s.rise}`} style={rise(0)}>
        <figure className={s.portrait}>
          <p className={s.portraitMark} aria-hidden="true">弟 子 画 像</p>
          <div className={s.portraitStage}>
            <XiaobaiAvatar mood={mood} level={global.learningLevel} variant="paper" size={200} />
          </div>
          {/* figcaption 须是 figure 的末位元素子节点(HTML 内容模型),展签一并收进题名里 */}
          <figcaption className={s.portraitCaption}>
            <span className={s.portraitNameRow}>
              <span className={s.portraitName}>弟子 · 小白</span>
              <span className={s.portraitSeal} aria-hidden="true">白</span>
            </span>
            {/* 画像展签随性情皮肤联动 */}
            <span className={s.portraitNote}>性情 · {global.persona}</span>
          </figcaption>
        </figure>

        <div className={s.heroBody}>
          <p className={s.volMark}>卷首 · 师徒</p>
          <h1 className={s.heroTitle}>小白的成长册</h1>
          <p className={s.heroSub}>
            它现在走到 <span className={s.levelNow}>「{LEVELS[global.learningLevel - 1].name} · {LEVELS[global.learningLevel - 1].desc}」</span>
            ——你教得越明白,它追问得越刁钻。
          </p>

          {/* 学识经验条:升级轨的连续反馈——攒学识、涨等级,与升期(进化)各走一轨 */}
          <div className={s.wisdom}>
            <div className={s.wisdomHead}>
              <span className={s.wisdomLabel}>学识 · 第 {wisdom.level} 级</span>
              <span className={s.wisdomGap}>距下一级还差 <b className={s.num}>{wisdomLeft}</b> 点</span>
            </div>
            <div
              className={s.wisdomTrack}
              role="progressbar"
              aria-valuenow={wisdom.intoLevel}
              aria-valuemin={0}
              aria-valuemax={wisdom.forNext}
              aria-label={`小白学识第 ${wisdom.level} 级,距下一级还差 ${wisdomLeft} 点`}
            >
              <span className={s.wisdomFill} style={{ width: `${wisdomPct}%` }} />
            </div>
          </div>

          <div className={s.dreamThread}>
            <span className={s.dreamIcon} aria-hidden="true"><Icon name="sparkles" size={20} /></span>
            <div>
              <p className={s.dreamLabel}>小白一直记着的愿望</p>
              <p className={s.dreamText}>“我想有一天，也能像先生一样，把道理讲给别人听。”</p>
            </div>
            <span className={s.dreamProgress}>
              {global.topicsMastered >= DREAM_GOAL
                ? '第一程已圆满'
                : `离第一次试讲还差 ${DREAM_GOAL - global.topicsMastered} 门`}
            </span>
          </div>

          {global.topicsMastered >= DREAM_GOAL && (
            <section className={s.graduationScene} aria-label="小白的第一次试讲，已由五门出师记录解锁">
              <div className={s.graduationCast} aria-hidden="true">
                <span className={s.graduationLectern}><Icon name="presentation" size={25} /></span>
                <span className={s.littleStudent}>白</span>
                <span className={s.littleStudent}>白</span>
                <span className={s.littleStudent}>白</span>
              </div>
              <div>
                <p className={s.graduationLabel}>终章已启 · 小白的第一次试讲</p>
                <blockquote className={s.graduationQuote}>“先生，这回换我来讲给小小白听。”</blockquote>
                <p className={s.graduationProof}>由已教到出师的 {global.topicsMastered} 门学问真实解锁</p>
              </div>
            </section>
          )}

          {/* 修行阶:走过的阶落墨,当下的阶钤青印,没到的阶还是虚印(与卷一印章墙同语) */}
          <ol className={s.ladder} aria-label="小白的成长阶梯">
            {LEVELS.map((l) => {
              // 本阶规则:STAGE_RULES 是按 stage 排列的数组,按 stage 字段查(勿用下标,避免错位)
              const stageRule = STAGE_RULES.find((r) => r.stage === l.lv);
              return (
              <li
                key={l.lv}
                aria-current={l.lv === global.learningLevel ? 'step' : undefined}
                className={
                  l.lv === global.learningLevel
                    ? `${s.rung} ${s.rungNow}`
                    : l.lv < global.learningLevel
                      ? `${s.rung} ${s.rungPast}`
                      : s.rung
                }
              >
                <span className={s.rungIcon} aria-hidden="true"><Icon name={l.icon} size={17} /></span>
                <span className={s.rungName}>{l.name}</span>
                <span className={s.rungDesc}>{l.desc}</span>
                {/* 条件铭文:够到这一阶的门槛,数字一律从 STAGE_RULES 派生(不手写复制);
                    当下要奔的那一阶改显实时进度(x/y);广度门槛未起(≤1 门)时不赘述涉猎;
                    两个分句各自 nowrap,窄牌换行只许发生在「·」处,不许孤字成行 */}
                {l.lv === 1 ? (
                  <span className={s.rungReq}>无需门槛</span>
                ) : next && next.stage === l.lv ? (
                  <span className={s.rungReq}>
                    <span className={s.reqClause}>出师 <b className={s.num}>{next.haveMasteries}</b>/<b className={s.num}>{next.needMasteries}</b></span>
                    {next.needCourses >= 2 && (
                      <> · <span className={s.reqClause}>课程 <b className={s.num}>{next.haveCourses}</b>/<b className={s.num}>{next.needCourses}</b></span></>
                    )}
                  </span>
                ) : (
                  <span className={s.rungReq}>
                    <span className={s.reqClause}>出师 <b className={s.num}>{stageRule?.masteries ?? 0}</b> 讲</span>
                    {(stageRule?.courses ?? 0) >= 2 && (
                      <> · <span className={s.reqClause}>涉猎 <b className={s.num}>{stageRule?.courses}</b> 门</span></>
                    )}
                  </span>
                )}
              </li>
              );
            })}
          </ol>

          {/* 化形指引:深度够了、只差换门课时的一句静默眉批(册页物称呼纪律用「先生」;不落朱砂) */}
          {next?.breadthBlocked && next.suggestedCourses[0] && (
            <p className={s.morphHint}>
              小白想去别的书架看看——先生哪天换一门<em className={s.morphCourse}>《{next.suggestedCourses[0]}》</em>讲给他听?
            </p>
          )}

          {/* 性情之笺:三张可点的纸笺,现用那张钤「现用」小印 */}
          <div className={s.personaBlock}>
            <p className={s.blockLabel}>性情之笺 <small>点一张,换一种问法</small></p>
            <div className={s.personaRow} role="group" aria-label="小白的性情皮肤">
              {PERSONAS.map((p) => {
                const active = global.persona === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-pressed={active}
                    className={active ? `${s.personaCard} ${s.personaActive}` : s.personaCard}
                    onClick={() => setPersona(p.name)}
                  >
                    <span className={s.personaTop}>
                      <span className={s.personaName}>{p.name}</span>
                      {active && <span className={s.personaStamp} aria-hidden="true">现用</span>}
                    </span>
                    <p className={s.personaLine}>{p.line}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 徒弟的阶梯之外,还有师父的路:师道等级印章卡 + 下一步 CTA */}
          <div className={s.mentorRow}>
            <div className={s.rankCard}>
              <span className={s.rankSeal} aria-hidden="true">师道</span>
              <div className={s.rankBody}>
                <p className={s.rankLabel}>先生的称号 · 由真实课堂留下</p>
                <p className={s.rankTitle}>{rank.title}</p>
                <p className={s.rankScore}>已教到出师 <b className={s.num}>{global.topicsMastered}</b> 门 · 实印 <b className={s.num}>{earnedCount}</b> 枚 · 履历 <b className={s.num}>{rank.score}</b> 分</p>
                <p className={s.rankNext}>
                  {rank.nextTitle && rank.nextAt !== null
                    ? <>距「{rank.nextTitle}」还差 <b className={s.num}>{rank.nextAt - rank.score}</b> 分——备课、讲明要点、纠正误区、出师,都在攒。</>
                    : '已至宗师——师道至此,桃李成蹊。'}
                </p>
              </div>
            </div>
            {step && (
              <div className={s.journeyCard}>
                <p className={s.journeyLabel}>下一步 · {step.title}</p>
                <p className={s.journeyLine}>{step.line}</p>
                <Link to={step.to} className={s.btnSolid}>{step.cta}<Icon name="arrow-right" size={16} /></Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── 卷一·印章墙:成就全量陈列,实印/虚印,点一枚看来历 ──
          分区带节奏(R2):卷一 warm / 卷二 paper / 卷三 shade / 卷四 warm / 卷五 paper / 卷尾 shade */}
      <section className={`${s.section} ${s.band} ${s.bandWarm} ${s.rise}`} style={rise(1)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷一</span>印章墙
          <small>{earnedCount}/{achievements.length} 枚实印 · 点一枚看它的来历</small>
        </h2>
        {achievements.length === 0 ? (
          <p className={s.muted}>册页尚空——先去开一课,印章自会一枚枚落上来。</p>
        ) : (
          <>
            {earnedCount === 0 && (
              <p className={s.emptyLead}>册页尚空——下面都是虚印,第一枚实印,等你开讲便有着落。</p>
            )}
            <div className={s.sealWall}>
              {achievements.map((a) => {
                const earned = a.earnedAt !== null;
                const isOpen = openSeal === a.id;
                const progressPct = a.progress.target > 0
                  ? Math.min(100, (a.progress.now / a.progress.target) * 100)
                  : 100;
                return (
                  <button
                    key={a.id}
                    id={`achievement-${a.id}`}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls="achievement-detail"
                    aria-label={earned ? `${a.name}，已钤印` : `${a.name}，进度 ${a.progress.now}/${a.progress.target}`}
                    data-tier-name={TIER_NAME[a.tier] ?? '印章'}
                    className={[
                      s.seal,
                      earned ? (TIER_CLASS[a.tier] ?? s.sealInk) : s.sealGhost,
                      isOpen ? s.sealOpen : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setOpenSeal(isOpen ? null : a.id)}
                  >
                    <span className={s.sealState}>{earned ? '已钤' : '待刻'}</span>
                    <span className={s.sealFace} aria-hidden="true">
                      <span className={s.sealGlyph}>{a.glyph}</span>
                    </span>
                    <span className={s.sealName}>{a.name}</span>
                    {!earned && (
                      <span className={s.sealProgress}>
                        <span className={s.sealProgressTrack} aria-hidden="true">
                          <span style={{ width: `${progressPct}%` }} />
                        </span>
                        <span className={s.sealProgressText}>{a.progress.now}/{a.progress.target}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className={`${s.collapse} ${openAch ? s.open : ''}`}>
              <div
                id="achievement-detail"
                role="region"
                aria-labelledby={shownAch ? `achievement-${shownAch.id}` : undefined}
                inert={!openAch}
              >
                {shownAch && (
                  <div className={s.sealDetail}>
                    <p className={s.sealDetailName}>
                      {shownAch.glyph} {shownAch.name}
                      {shownAch.earnedAt === null && <span className={s.sealDetailGhost}> · 虚印</span>}
                    </p>
                    <p className={s.sealDetailDesc}>{shownAch.desc}</p>
                    {shownAch.earnedAt !== null ? (
                      <p className={s.sealDetailEvidence}>
                        {shownAch.evidence ?? '印已钤下。'}
                        <span className={s.sealDetailDate}> · {fmtDateTime(shownAch.earnedAt)} 钤印</span>
                      </p>
                    ) : (
                      <p className={s.sealDetailEvidence}>
                        进度 <b className={s.num}>{shownAch.progress.now}/{shownAch.progress.target}</b>,印还没刻满。
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── 卷二·教学编年史:events×reports 并轨的会话日志,倒序,默认最近 6 条 ── */}
      <section id="chronicle" className={`${s.section} ${s.rise}`} style={rise(2)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷二</span>教学编年史
          <small>每一课都记在案,自新往旧翻</small>
        </h2>
        <div className={s.ledgerMeta}>
          <span>已出师 <b>{global.topicsMastered}</b> 门</span>
          <span>最快纪录 <b>{global.bestRecord ?? '——'}</b></span>
          <span>金句 <b>{global.goldenAnalogies.length}</b> 句</span>
        </div>
        {chronicle.length === 0 ? (
          <p className={s.muted}>编年史还没有第一笔——去书斋门厅开一课,这里会替你记下每一天。</p>
        ) : (
          <>
            <ol className={s.logList} id="chronicle-log">
              {shownChronicle.map((en) => {
                if (en.kind === 'margin') {
                  return (
                    <li key={en.id} className={s.marginItem}>
                      <span className={s.logDate}>{fmtDay(en.t)}</span>
                      <div>
                        <span className={s.marginTag}>{en.type === 'prep_completed' ? '备课' : '补学'}</span>
                        <span className={s.marginText}>「{getTopic(en.topicId)?.title ?? en.topicId}」· {en.evidence}</span>
                      </div>
                    </li>
                  );
                }
                const title = getTopic(en.topicId)?.title ?? en.topicId;
                return (
                  <li key={en.sessionId} className={en.mastered ? `${s.logItem} ${s.logMastered}` : s.logItem}>
                    <span className={s.logDate}>{fmtDay(en.t)}</span>
                    <div>
                      <div className={s.logHead}>
                        <span className={s.logTopic}>{title}</span>
                        <span className={s.chip}>{MODE_LABEL[en.mode]}</span>
                        {en.turns !== null && <span className={s.chip}><b className={s.num}>{en.turns}</b> 轮</span>}
                        {en.corrected > 0 && <span className={`${s.chip} ${s.chipJade}`}>纠正 ×{en.corrected}</span>}
                        {en.adopted > 0 && <span className={`${s.chip} ${s.chipCinnabar}`}>被带偏 ×{en.adopted}</span>}
                        {en.golden > 0 && <span className={`${s.chip} ${s.chipGold}`}>金句 ×{en.golden}</span>}
                        {en.quizScore !== null && <span className={s.chip}>小测 <b className={s.num}>{en.quizScore}</b> 分</span>}
                        {en.mastered && <span className={`${s.chip} ${s.chipJade}`}>出师</span>}
                      </div>
                      <p className={s.logLine}>{narrate(en, title)}</p>
                      {en.hasReport && (
                        <Link to={`/review/${en.sessionId}`} className={s.logLink}>查看复盘 <Icon name="arrow-right" size={15} /></Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {chronicle.length > 6 && (
              <button
                type="button"
                className={s.pageTurn}
                aria-expanded={oldPages}
                aria-controls="chronicle-log"
                onClick={() => setOldPages((v) => !v)}
              >
                {oldPages ? '收起旧页 ' : `翻旧页 —— 还有 ${chronicle.length - 6} 条 `}
                <span aria-hidden="true">{oldPages ? '▴' : '▾'}</span>
              </button>
            )}
          </>
        )}
      </section>

      {/* ── 卷三·盲区图谱:星图 + 证据链 + 遗忘复习入口(交互契约原样保留) ── */}
      <section id="map" className={`${s.section} ${s.band} ${s.bandShade} ${s.rise}`} style={rise(3)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷三</span>盲区图谱
          <small>
            {forgottenNodes.length > 0
              ? '小白来信了——雾气漫上来的地方'
              : '点一颗星,展开它的掌握度证据链'}
          </small>
        </h2>
        <div className={s.mapWrap}>
          <KnowledgeMap
            nodes={nodes}
            selectedId={selected}
            onSelect={(tid) => setSelected(selected === tid ? null : tid)}
          />
        </div>
        <div className={s.legendRow}>
          <span><span className={`${s.swatch} ${s.swJade}`} />出师</span>
          <span><span className={`${s.swatch} ${s.swAmber}`} />衰减待复习</span>
          <span><span className={`${s.swatch} ${s.swAzure}`} />学习中</span>
          <span><span className={`${s.swatch} ${s.swDust}`} />未学</span>
          <span><span className={`${s.swatch} ${s.swLocked}`} />未开放</span>
        </div>

        {/* 遗忘不再是干瘪一行:每个雾里的知识点是一封「小白的来信」(doc §8),
            素材由 deriveXiaobaiLetter 从真实命中要点与金句派生;回信即原 goReview 契约 */}
        {forgottenNodes.length > 0 && (
          <div className={s.letterFlow}>
            {forgottenNodes.map((n) => n.state && (
              <XiaobaiLetter
                key={n.topic.topicId}
                topicTitle={n.topic.title}
                data={deriveXiaobaiLetter({ topic: n.topic, state: n.state, events })}
                busy={reviewBusy}
                onReply={() => goReview(n.topic.topicId)}
              />
            ))}
          </div>
        )}

        <div className={`${s.collapse} ${selNode ? s.open : ''}`}>
          <div inert={!selNode}>
            {shownNode && shownNode.state && (
              <div className={s.nodePanel}>
                <div className={s.panelHead}>
                  <h3 className={s.panelTitle}>{shownNode.topic.title}</h3>
                  <span className={
                    shownNode.status === 'mastered' ? `${s.chip} ${s.chipJade}`
                      : shownNode.status === 'forgotten' ? `${s.chip} ${s.chipAmber}`
                        : `${s.chip} ${s.chipAzure}`
                  }>
                    {shownNode.status === 'mastered' ? '已出师'
                      : shownNode.status === 'forgotten' ? '小白说它忘了'
                        : shownNode.state.knowledgeState}
                  </span>
                  <span className={s.chip}>掌握度 {Math.round(shownNode.state.mastery * 100)}</span>
                  <span className={s.chip}>
                    要点 {shownNode.state.hitChecklist.length}/{shownNode.topic.checklist.length}
                  </span>
                </div>
                {shownNode.status === 'forgotten' && (
                  <button
                    type="button"
                    className={s.btnGhost}
                    disabled={reviewBusy}
                    onClick={() => goReview(shownNode.topic.topicId)}
                  >
                    小白说它忘了 <Icon name="arrow-right" size={15} /> 帮它复习
                  </button>
                )}
                <h3 className={s.h3} style={{ marginTop: 'var(--gap-tight)' }}>掌握度证据链</h3>
                {shownEvents.length === 0 ? (
                  <p className={s.muted}>还没有任何事件——这个知识点还没开讲。</p>
                ) : (
                  <ol className={s.timeline}>
                    {shownEvents.map((e) => (
                      <li key={e.id} className={s.timelineItem}>
                        <span className={s.timelineTime}>{fmtDateTime(e.t)}</span>
                        <span className={s.chip}>{EVENT_LABEL[e.type] ?? e.type}</span>
                        <span className={s.timelineText}>{e.evidence}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 卷四·金句画廊:goldenAnalogies 横向卡流,引号大字 + 出处小注 ── */}
      <section className={`${s.section} ${s.band} ${s.bandWarm} ${s.rise}`} style={rise(4)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷四</span>金句画廊
          <small>你打过的好比方,小白替你裱起来了</small>
        </h2>
        {global.goldenAnalogies.length === 0 ? (
          <p className={s.muted}>画廊还空着——讲课时打一个好比方,小白会把它裱进来。</p>
        ) : (
          <div className={s.galleryFlow}>
            {global.goldenAnalogies.map((g) => (
              <figure key={g.id} className={s.galleryCard}>
                <span className={s.galleryMark} aria-hidden="true">「</span>
                <blockquote className={s.galleryText}>{g.text}</blockquote>
                <figcaption className={s.galleryFrom}>
                  出自「{getTopic(g.topicId)?.title ?? g.topicId}」 · {fmtDateTime(g.t)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {/* ── 卷五·小白的记忆:四层记忆匣(recall.ts 派生,答辩 money-shot) ── */}
      <section id="memory" className={`${s.section} ${s.rise}`} style={rise(5)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷五</span>小白的记忆
          <small>四层,和你一样:当堂的、情景的、学问的、师徒的</small>
        </h2>
        <MemoryPanorama layers={panorama} />
      </section>

      {/* ── 卷尾·小白眼里的你:印象句由 deriveRelationshipLines 派生,每句带可复算出处 ── */}
      <section id="bond" className={`${s.section} ${s.band} ${s.bandShade} ${s.rise}`} style={rise(6)}>
        <h2 className={s.h2}>
          <span className={s.volNo}>卷尾</span>小白眼里的你
          <small>它记得的,是你教书的样子</small>
        </h2>
        {bondLines.length === 0 ? (
          <p className={s.muted}>还没熟起来——多讲几课,小白会慢慢记住你的教学风格。</p>
        ) : (
          <ul className={s.memoryList}>
            {bondLines.map((m) => (
              <li key={m.line} className={s.memoryItem}>
                <span className={s.memoryLine}>{m.line}</span>
                <span className={s.memoryEvidence}>{m.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 角落:演示重置(行内二次确认,不用弹窗) */}
      <div className={s.corner}>
        {confirming ? (
          <>
            <span className={s.cornerConfirm}>确认清空全部演示数据?撤销不了哦。</span>
            <button
              type="button"
              className={s.cornerYes}
              onClick={() => { resetAll(); setConfirming(false); setSelected(null); }}
            >
              确认重置
            </button>
            <button type="button" className={s.cornerNo} onClick={() => setConfirming(false)}>
              算了
            </button>
          </>
        ) : (
          <button type="button" className={s.cornerBtn} onClick={() => setConfirming(true)}>
            演示重置
          </button>
        )}
      </div>
    </div>
  );
}
