/**
 * 四层记忆全景 = 已有数据的另一种切面(工作/情景/学问/师徒),纯派生零新状态;
 * 不入 barrel;认知天花板与评估隐身对 recall 行为同样生效——
 * 任何输出只允许引用 topic.title、命中要点数、金句原文(教师原话)、真实事件计数,
 * 绝不触碰误区 belief / groundTruth / lookupCard / 未教术语(开场白尤其不得暗示考点)。
 * 单场事实一律数 misconception_* 事件,不读 mcStates 快照
 * (session_ended 会把悬置"已注入"退回"待注入",快照会抹掉遭遇记录)。
 * 铁律:纯函数、Node 安全,不得 re-export 进 engine/index barrel(simulate 在 Node 加载 barrel)。
 */
import type {
  LearnEvent, LiveSession, SessionReport, Topic, TopicState, XiaobaiGlobal,
} from '../types';
// 课程注册表只借 title 查表(recallGreetingLine 的契约入参没有 topics 列表);
// data 为纯对象字面量,Node 安全,且 title 本就是白名单词汇,无泄漏风险
import { getTopic } from '../data';
// 心魔命名走 story.ts 路径直连(与本文件同不进 barrel,demonName 是白名单化的策展名);
// 掌握度/衰减走 memory.ts 路径直连(纯函数);策展知识关联走 starLinks(纯对象字面量)。
// 三者皆 Node 安全,且都不经 engine/index barrel —— simulate 加载 barrel 时不会拖入 recall。
import { demonName } from './story';
import { computeMastery, decayedMastery } from './memory';
import { STAR_LINKS } from '../data/starLinks';

// ───────────────────────── 通用小工具 ─────────────────────────

/** 按时间稳排(事件流本为追加序,ISO 可字典序比较;排序只为防御乱序注入) */
function chronological(events: LearnEvent[]): LearnEvent[] {
  return [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/* 中文数字日期:story.ts 的同款帮手是私有函数未导出,此处按契约自备一份极小实现 */
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const LEARNING_STAGES = ['嫩芽期', '开窍期', '求索期', '问难期', '出师期'] as const;

function cnNum(n: number): string {
  if (n <= 0 || n > 31) return String(n);
  if (n <= 10) return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n - 1];
  if (n < 20) return `十${CN_DIGITS[n % 10]}`;
  return `${CN_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CN_DIGITS[n % 10] : ''}`;
}

/** ISO → 「七月六日」;非法日期返回空串 */
function chineseDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${cnNum(d.getMonth() + 1)}月${cnNum(d.getDate())}日`;
}

/** 计数量词:2 用「两」,其余走 cnNum(「两处心魔」比「二处」顺口) */
function cnCount(n: number): string {
  return n === 2 ? '两' : cnNum(n);
}

/** payload 数值收口:非有限数一律归零(评分/计数只信真实数字) */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 实质触达过的知识点:有要点命中或已出师的课(跨课线两端都需满足) */
function substantiallyLearned(events: LearnEvent[]): Set<string> {
  const set = new Set<string>();
  for (const e of events) {
    if (e.type === 'checklist_hit' || e.type === 'topic_mastered') set.add(e.topicId);
  }
  return set;
}

/**
 * 跨课记忆线:STAR_LINKS 中两端都实质学过的关联,造句用 note + 两端 title。
 * 「小白自己连起来的」——只在两门课都真讲过时才亮,避免臆造关联。
 */
function deriveCrossLinkLines(
  events: LearnEvent[],
  titleOf: (topicId: string) => string,
): CrossLinkLine[] {
  const learned = substantiallyLearned(events);
  const out: CrossLinkLine[] = [];
  for (const link of STAR_LINKS) {
    if (!learned.has(link.a) || !learned.has(link.b)) continue;
    out.push({ line: `《${titleOf(link.a)}》学的东西,我用到《${titleOf(link.b)}》上了——${link.note}。` });
  }
  return out;
}

// ───────────────────────── 小白眼里的你 ─────────────────────────

export interface RelationshipLine {
  line: string;       // 小白口吻的一句印象
  evidence: string;   // 这句印象的出处(真实统计或「相处中记下的」)
}

/** 派生印象候选:sig 为"意义签名"关键词,用于与存量 relationshipMemory 按意义去重 */
interface TraitCandidate {
  fire: boolean;
  line: string;
  evidence: string;
  sig: string[];
}

/**
 * 小白眼里的你:存量 relationshipMemory(相处中记下的)在前,
 * 真实统计派生的印象在后;按意义去重,总量封顶 6 条。
 * 每条派生印象的 evidence 都指向可复算的事件计数——评委追问「凭什么这么说」,答案在数字里。
 */
export function deriveRelationshipLines(input: {
  events: LearnEvent[];
  reports: SessionReport[];
  global: XiaobaiGlobal;
}): RelationshipLine[] {
  const events = chronological(input.events);
  const of = (type: LearnEvent['type']) => events.filter((e) => e.type === type);

  const out: RelationshipLine[] = [];
  for (const raw of input.global.relationshipMemory) {
    const line = raw.trim();
    if (line && !out.some((x) => x.line === line)) out.push({ line, evidence: '相处中记下的' });
  }

  const golden = of('golden_analogy_saved').length;
  const rescued = of('stuck_rescued').length;
  const reviews = of('review_passed').length;
  const corrected = of('misconception_corrected').length;
  // 重讲堂数:session_started(mode=reteach) 与 reteach 报告按 sessionId 并集,免得双计
  const reteachIds = new Set<string>();
  for (const e of of('session_started')) {
    if (e.payload.mode === 'reteach' && e.sessionId) reteachIds.add(e.sessionId);
  }
  for (const r of input.reports) if (r.mode === 'reteach') reteachIds.add(r.sessionId);
  // 出师门数:事件里的去重主题数;global.topicsMastered 是同源缓存,取较大者防漏
  const masteredTopics = new Set(of('topic_mastered').map((e) => e.topicId));
  const masteredN = Math.max(masteredTopics.size, input.global.topicsMastered);

  const candidates: TraitCandidate[] = [
    { fire: golden >= 1, line: '老师爱打比方,一举例我就懂。', evidence: `金句 ${golden} 句`, sig: ['比方', '比喻', '举例'] },
    { fire: rescued >= 2, line: '我卡壳的时候,老师会换个说法讲,从不催我。', evidence: `卡壳救援 ${rescued} 次`, sig: ['卡壳', '换个说法', '不催'] },
    { fire: reteachIds.size >= 1, line: '讲岔了的地方,老师会回来重讲,直到我真的懂。', evidence: `回炉重讲 ${reteachIds.size} 堂`, sig: ['重讲', '回炉'] },
    { fire: reviews >= 1, line: '我忘了的东西,老师陪我一起捡回来过。', evidence: `复习通过 ${reviews} 次`, sig: ['复习', '捡回', '忘了'] },
    { fire: corrected >= 2, line: '我说错话的时候,老师总能当场听出来。', evidence: `误区纠正 ${corrected} 处`, sig: ['说错', '听出', '纠正'] },
    { fire: masteredN >= 1, line: `老师已经把 ${masteredN} 门学问教到我出师了。`, evidence: `出师 ${masteredN} 门`, sig: ['出师'] },
  ];
  for (const c of candidates) {
    if (!c.fire) continue;
    // 意义去重:存量记忆(或已收录的派生句)提过同一件事,就不再重复
    if (out.some((x) => c.sig.some((k) => x.line.includes(k)))) continue;
    out.push({ line: c.line, evidence: c.evidence });
  }
  return out.slice(0, 6);
}

// ───────────────────────── 四层记忆全景 ─────────────────────────

export type MemoryLayerKey = 'working' | 'episodic' | 'semantic' | 'bond';

/** 出师课的保持度迷你条(叁·学问层遗忘曲线显形):芦苇绿=尚清晰 / 藤黄=已衰减 */
export interface RetentionBar {
  title: string;
  retention: number;         // 0..1,衰减后的掌握度(memory.ts decayedMastery)
  daysToFog: number | null;  // 距 reviewDue 天数,负=已过期,无复习期为 null
  fogged: boolean;           // 已过复习期(藤黄示警)
}

/** 跨课记忆线(叁·学问层:小白自己连起来的) */
export interface CrossLinkLine {
  line: string;
}

export interface MemoryLayer {
  key: MemoryLayerKey;
  no: string;                                  // 壹/贰/叁/肆
  name: string;
  caption: string;                             // 这一层的存续规则,一句话
  stats: { label: string; value: string }[];
  lines: string[];
  anchor: { label: string; to: string } | null;
  retentions?: RetentionBar[];                 // 仅叁·学问层填充(遗忘曲线显形)
  crossLinks?: CrossLinkLine[];                // 仅叁·学问层填充(跨课记忆线)
}

/** 单场情景条目(内部用):与 growth 页 buildChronicle 同口径,从事件×报告并轨派生 */
interface Episode {
  t: string;
  topicId: string;
  mastered: boolean;
  reviewPassed: boolean;
  adopted: number;
  corrected: number;
  golden: number;
  goldenText: string | null;    // 本场最后一条金句原文(逐字,情景加厚用)
  correctedDemons: string[];    // 本场纠正的心魔名(story.ts demonName)
  hitPoints: string[];          // 本场命中的 checklist 要点名
}

/**
 * 事件按 sessionId 分组并轨 reports,倒序;备课/补学(sessionId 为 null)不算课堂情景。
 * topicOf 解析该场知识点,用于把 mcId/checklistId 落成心魔名与要点名(情景加厚);
 * 解析不到(占位/未登记)则相应细节留空,句子退回不含细节的版本,不臆造。
 */
function collectEpisodes(
  events: LearnEvent[],
  reports: SessionReport[],
  topicOf: (topicId: string) => Topic | undefined,
): Episode[] {
  const reportOf = new Map(reports.map((r) => [r.sessionId, r]));
  const groups = new Map<string, LearnEvent[]>();
  for (const e of events) {
    if (!e.sessionId) continue;
    const list = groups.get(e.sessionId);
    if (list) list.push(e);
    else groups.set(e.sessionId, [e]);
  }
  const episodes: Episode[] = [];
  for (const [sessionId, evs] of groups) {
    const report = reportOf.get(sessionId) ?? null;
    const topic = topicOf(evs[0].topicId);
    let goldenText: string | null = null;
    const correctedIds: string[] = [];
    const hitIds: string[] = [];
    for (const e of evs) {
      if (e.type === 'golden_analogy_saved') {
        const text = String(e.payload.text ?? '').trim();
        if (text) goldenText = text;   // 顺序追加,循环到底即本场最后一条
      } else if (e.type === 'misconception_corrected') {
        const id = String(e.payload.mcId ?? '');
        if (id && !correctedIds.includes(id)) correctedIds.push(id);
      } else if (e.type === 'checklist_hit') {
        const id = String(e.payload.checklistId ?? '');
        if (id && !hitIds.includes(id)) hitIds.push(id);
      }
    }
    const correctedDemons = topic
      ? correctedIds
          .map((id) => {
            const mc = topic.misconceptions.find((m) => m.mcId === id);
            return mc ? demonName(mc) : null;
          })
          .filter((x): x is string => !!x)
      : [];
    const hitPoints = topic
      ? hitIds
          .map((id) => topic.checklist.find((c) => c.id === id)?.point)
          .filter((x): x is string => !!x)
      : [];
    episodes.push({
      t: evs[0].t,
      topicId: evs[0].topicId,
      mastered: (report?.masteredNow ?? false) || evs.some((e) => e.type === 'topic_mastered'),
      reviewPassed: evs.some((e) => e.type === 'review_passed'),
      adopted: evs.filter((e) => e.type === 'misconception_adopted').length,
      corrected: evs.filter((e) => e.type === 'misconception_corrected').length,
      golden: evs.filter((e) => e.type === 'golden_analogy_saved').length,
      goldenText,
      correctedDemons,
      hitPoints,
    });
  }
  return episodes.sort((a, b) => (a.t < b.t ? 1 : -1));
}

/**
 * 情景一句话:编年史同款语域——只说小白怎么样,不说你错了(盲区语言纪律)。
 * 每条缀一处具体细节(金句原文 > 识破的心魔名 > 听懂的要点,择一不叠),
 * 引用皆在白名单内(金句原文/心魔策展名/要点名),评估隐身。
 */
function episodeLine(ep: Episode, title: string): string {
  const outcome = ep.mastered
    ? '出师了'
    : ep.reviewPassed
      ? '它「想起来了」'
      : ep.adopted > 0
        ? '它把先生将了一军'
        : ep.corrected > 0
          ? '它埋的误区被先生当场识破'
          : ep.golden > 0
            ? '先生打的比方被记进了小本子'
            : '平实往来';
  let detail = '';
  if (ep.goldenText) detail = `——「${ep.goldenText}」这句它还记着`;
  else if (ep.correctedDemons[0]) detail = `——那只「${ep.correctedDemons[0]}」再没能糊弄它`;
  else if (ep.hitPoints[0]) detail = `,「${ep.hitPoints[0]}」那一段它听懂了`;
  return `${chineseDateLabel(ep.t)}那堂「${title}」,${outcome}${detail}。`;
}

/** 情景结局压成两三个字(贰层「最近一堂」小签用) */
function shortOutcome(ep: Episode): string {
  if (ep.mastered) return '出师';
  if (ep.reviewPassed) return '复习捡回';
  if (ep.adopted > 0) return '被将军';
  if (ep.corrected > 0) return '识破心魔';
  if (ep.golden > 0) return '记下金句';
  return '平实';
}

/** 最近一堂结局压成一句册页语域(称「先生」),供备课回执与记忆匣复用 */
function recallOutcomeLine(ep: Episode): string {
  if (ep.mastered) return '上一堂,先生把这门课教到我出师了。';
  if (ep.reviewPassed) return '上一堂复习,蒙尘的地方又擦亮了些。';
  // adopted 优先于 corrected: 与 episodeLine/shortOutcome 同序, 未解的将军不被正面结局盖掉
  if (ep.adopted > 0) return '上一堂我把先生将了一军,还有个结没解开。';
  if (ep.corrected > 0) return `上一堂清了${cnCount(ep.corrected)}处心魔。`;
  if (ep.golden > 0) return '上一堂,先生打的比方我记进了小本子。';
  return '上一堂,我们静静地把它又过了一遍。';
}

/**
 * 四层记忆全景:固定四层、固定顺序(当堂→情景→学问→师徒),越往下存得越久。
 * 每层的 stats/lines 全部来自真实事件、报告与状态——空档期各层给出诚实的空态文案。
 */
export function deriveMemoryPanorama(input: {
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  topics: Topic[];
  global: XiaobaiGlobal;
  live: LiveSession | null;
}): MemoryLayer[] {
  const events = chronological(input.events);
  const titleOf = (topicId: string) =>
    input.topics.find((t) => t.topicId === topicId)?.title ?? getTopic(topicId)?.title ?? topicId;
  const topicOf = (topicId: string) =>
    input.topics.find((t) => t.topicId === topicId) ?? getTopic(topicId);
  const nowDate = new Date();

  // —— 壹 · 当堂记忆:只存正在进行的这堂课,下课即散 ——
  let working: MemoryLayer;
  if (input.live) {
    const live = input.live;
    // 本课已听懂的要点:课中轨迹与已落档事件取并集(两者都是本场真实判定)
    const heard = new Set<string>();
    for (const tr of live.traces) for (const id of tr.evalResult.checklistHits) heard.add(id);
    for (const e of events) {
      if (e.sessionId === live.sessionId && e.type === 'checklist_hit') {
        const id = String(e.payload.checklistId ?? '');
        if (id) heard.add(id);
      }
    }
    const turnNo = live.traces.length + (live.ended ? 0 : 1);
    // 本课听懂的 checklistId 落成要点名(≤3):当堂层不再只报计数,而是点出讲明白了哪几点
    const liveTopic = topicOf(live.topicId);
    const heardPoints = liveTopic
      ? [...heard]
          .map((id) => liveTopic.checklist.find((c) => c.id === id)?.point)
          .filter((p): p is string => !!p)
          .slice(0, 3)
      : [];
    working = {
      key: 'working', no: '壹', name: '当堂记忆', caption: '只存当堂问答,下课即散',
      stats: [
        { label: '在上', value: `「${titleOf(live.topicId)}」` },
        { label: '进行到', value: `第 ${Math.max(1, turnNo)} 轮` },
        { label: '本课听懂', value: `${heard.size} 个要点` },
      ],
      lines: [
        ...(heardPoints.length
          ? [`这堂刚讲明白:${heardPoints.map((p) => `「${p}」`).join('、')}。`]
          : []),
        '这一层只装当堂的一问一答,下课铃一响就清空——要紧的会沉进下面三层。',
      ],
      anchor: { label: '回课堂', to: `/teach/${live.topicId}` },
    };
  } else {
    working = {
      key: 'working', no: '壹', name: '当堂记忆', caption: '只存当堂问答,下课即散',
      stats: [],
      lines: ['此刻不在课上——下课后,这一层会清空,要紧的都往下面三层里存。'],
      anchor: { label: '去开讲', to: '/study' },
    };
  }

  // —— 贰 · 课堂情景:一堂课一页,近三页可翻 ——
  const episodes = collectEpisodes(events, input.reports, topicOf);
  const episodic: MemoryLayer = {
    key: 'episodic', no: '贰', name: '课堂情景', caption: '一堂课,存一页情景',
    stats: [
      { label: '共', value: `${episodes.length} 堂课` },
      ...(episodes.length ? [{ label: '最近一堂', value: shortOutcome(episodes[0]) }] : []),
    ],
    lines: episodes.length
      ? episodes.slice(0, 3).map((ep) => episodeLine(ep, titleOf(ep.topicId)))
      : ['还没上过课——每上完一堂,这里就多一页课堂情景。'],
    anchor: { label: '翻编年史', to: '/growth#chronicle' },
  };

  // —— 叁 · 学问沉淀:讲明白的要点沉在这里,但会随日子起雾(诚实交代衰减) ——
  let hitTotal = 0;
  let masteredN = 0;
  let forgottenN = 0;
  for (const t of input.topics) {
    if (t.locked) continue;
    const st = input.topicStates[t.topicId];
    if (!st) continue;
    hitTotal += st.hitChecklist.length;
    if (st.knowledgeState === '出师') masteredN += 1;
    if (st.forgotten) forgottenN += 1;
  }
  // 心魔纠正数事件,不读 mcStates 快照(快照会被 session_ended 回滚抹平)
  const correctedN = events.filter((e) => e.type === 'misconception_corrected').length;

  // 遗忘曲线显形:每门出师课的当前保持度(decayedMastery 0..1)+ 距起雾天数,
  // 把只算不显的艾宾浩斯衰减摆到台面上——芦苇绿=尚清晰,藤黄=已衰减。
  const retentions: RetentionBar[] = [];
  for (const t of input.topics) {
    if (t.locked) continue;
    const st = input.topicStates[t.topicId];
    if (!st || st.knowledgeState !== '出师') continue;
    const retention = decayedMastery(computeMastery(st, t, events), st.lastVerified, nowDate);
    let daysToFog: number | null = null;
    if (st.reviewDue) {
      const ms = new Date(st.reviewDue).getTime() - nowDate.getTime();
      if (!Number.isNaN(ms)) daysToFog = Math.round(ms / 86400000);
    }
    retentions.push({
      title: t.title,
      retention,
      daysToFog,
      fogged: daysToFog != null && daysToFog <= 0,
    });
  }

  // 跨课记忆线:STAR_LINKS 中两端都实质学过的关联(小白自己连起来的),命中数入 stats
  const crossLinks = deriveCrossLinkLines(events, titleOf);

  const semanticLines: string[] = [];
  if (hitTotal === 0 && correctedN === 0) {
    semanticLines.push('这一层还空着——先生讲明白的要点,会一条条沉在这里。');
  } else {
    semanticLines.push('沉在这里的学问不会一直清晰:多日不温,掌握度会慢慢衰减,雾气会重新聚拢。');
    if (forgottenN > 0) {
      semanticLines.push(`眼下已有 ${forgottenN} 门学问蒙了雾,等一堂复习课把它捡回来。`);
    }
  }
  const semantic: MemoryLayer = {
    key: 'semantic', no: '叁', name: '学问沉淀', caption: '沉得住,也会起雾',
    stats: [
      { label: '记住要点', value: `${hitTotal} 个` },
      { label: '心魔纠正', value: `${correctedN} 处` },
      { label: '出师', value: `${masteredN} 门` },
      ...(crossLinks.length ? [{ label: '跨课线', value: `${crossLinks.length} 条` }] : []),
    ],
    lines: semanticLines,
    anchor: { label: '看学问舆图', to: '/growth#map' },
    retentions,
    crossLinks,
  };

  // —— 肆 · 师徒之谊:全局层,永不清空 ——
  // 金句数:事件计数与全局收藏取较大者(global 是永不重置层,事件被清档时它仍在)
  const goldenN = Math.max(
    events.filter((e) => e.type === 'golden_analogy_saved').length,
    input.global.goldenAnalogies.length,
  );
  const relLines = deriveRelationshipLines({
    events: input.events, reports: input.reports, global: input.global,
  }).slice(0, 3).map((r) => r.line);
  const bond: MemoryLayer = {
    key: 'bond', no: '肆', name: '师徒之谊', caption: '这一层,永不清空',
    stats: [
      { label: '人格', value: input.global.persona },
      { label: '当前阶段', value: LEARNING_STAGES[input.global.learningLevel - 1] },
      { label: '金句', value: `${goldenN} 句` },
      ...(input.global.bestRecord ? [{ label: '最佳战绩', value: input.global.bestRecord }] : []),
    ],
    lines: relLines.length
      ? relLines
      : ['刚认识不久——相处久了,小白会把先生的样子一条条记在这里。'],
    anchor: { label: '看小白眼里的你', to: '/growth#bond' },
  };

  return [working, episodic, semantic, bond];
}

// ───────────────────────── 跨会话开场回忆 ─────────────────────────

/** 开场白引用金句的长度上限:太长的比方塞进一句开场白会破相,跳过换下一条候选 */
const GREETING_ANALOGY_MAX = 24;

/** 既往场次数:去重非空 sessionId,作开场白轮换的确定性种子(勿用 Math.random) */
function priorSessionCount(events: LearnEvent[]): number {
  const ids = new Set<string>();
  for (const e of events) if (e.sessionId) ids.add(e.sessionId);
  return ids.size;
}

/**
 * 跨会话回忆开场白:把情景记忆做成看得见的行为。
 * 评估隐身铁律:开场白绝不引用误区 belief、不碰 groundTruth、不吐未教术语——
 * 只允许 topic.title、金句原文(教师原话逐字)、真实计数(小测分)与策展级跨课关联。
 * excludeSessionId = 刚开的这场,必须滤掉;没有任何往史则返回 null(第一课不装熟)。
 *
 * 结构:分支 (a)「本课接着讲」最贴合当下,始终优先且不参与轮换——它独占
 * 「才开了个头」(零轮弃课不装熟)与「记在小本子上」(讲过才敢断言)两条硬不变式;
 * 其余信号(既有金句/出师 + 新增小测分/卡壳想通/跨课线)进候选池,以既往场次数为种子轮换,
 * 连开两门课不再吐同一句(旧版恒取首命中金句 → 台词雷同的病根)。
 * 向后兼容:(a) 行为一字不改;旧版能出句的输入,候选池至少含金句/出师候选之一,不会退化成 null。
 */
export function recallGreetingLine(input: {
  topic: Topic;
  events: LearnEvent[];
  reports: SessionReport[];
  excludeSessionId: string | null;
}): string | null {
  const { topic, excludeSessionId } = input;
  const prior = chronological(input.events).filter((e) => e.sessionId !== excludeSessionId);
  const priorReports = input.reports.filter((r) => r.sessionId !== excludeSessionId);
  if (prior.length === 0 && priorReports.length === 0) return null;

  // (a) 本课上过但未出师:上过课(课堂事件或报告)且尚无出师事件 → 记得上回讲到一半
  const touched = prior.some((e) => e.topicId === topic.topicId && e.sessionId !== null)
    || priorReports.some((r) => r.topicId === topic.topicId);
  const mastered = prior.some((e) => e.type === 'topic_mastered' && e.topicId === topic.topicId);
  if (touched && !mastered) {
    // 叙事验收:「记在小本子上」是在断言老师讲过话。零轮弃课只留 session_started/ended
    // (misconception_injected 也可在老师开口前落档,不算讲授痕迹),
    // 实质讲授 = 该门的要点命中/金句/误区纠正或将军事件,或任一往期报告 turnCount > 0;
    // 没有讲授痕迹时降级为不含记录断言的接续句
    const substantive = prior.some((e) =>
      e.topicId === topic.topicId
      && (e.type === 'checklist_hit' || e.type === 'golden_analogy_saved'
        || e.type === 'misconception_corrected' || e.type === 'misconception_adopted'))
      || priorReports.some((r) => r.topicId === topic.topicId && r.turnCount > 0);
    return substantive
      ? `上回「${topic.title}」讲到一半,我把老师的话都记在小本子上了。`
      : `上回「${topic.title}」我们才开了个头,这回接着讲呀!`;
  }

  // —— 其余候选池:轮换以破「连开两课台词雷同」——
  const candidates: string[] = [];

  // 候选①(新增):上次小测分回忆(score 过 num() 收口,不暗示考点,只报真实分数)
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'xiaobai_quiz_scored') continue;
    const score = Math.round(num(e.payload.score));
    const thatTitle = getTopic(e.topicId)?.title;
    candidates.push(
      thatTitle && e.topicId !== topic.topicId
        ? `上次考「${thatTitle}」那场小测我得了 ${score} 分,这回我想考得更稳。`
        : `上次那场小测我得了 ${score} 分,这回我想考得更稳。`,
    );
    break;
  }

  // 候选②(新增):上次卡壳、后来想通(找一门卡壳过又出师的课,现身说法长进)
  const masteredTopics = new Set(
    prior.filter((e) => e.type === 'topic_mastered').map((e) => e.topicId),
  );
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'stuck_rescued' || !masteredTopics.has(e.topicId)) continue;
    const thatTitle = getTopic(e.topicId)?.title;
    if (!thatTitle) continue;
    candidates.push(`上次讲「${thatTitle}」我卡了好一会儿,后来忽然就通了——想想还挺神奇。`);
    break;
  }

  // 候选③(新增):跨课线(两端都实质学过,小白自己连起来的)
  const crossLinks = deriveCrossLinkLines(prior, (id) => getTopic(id)?.title ?? id);
  if (crossLinks.length > 0) {
    candidates.push(crossLinks[priorSessionCount(prior) % crossLinks.length].line);
  }

  // 候选④(既有 b):别门课最新的金句(原文逐字,长句跳过)
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'golden_analogy_saved' || e.topicId === topic.topicId) continue;
    const text = String(e.payload.text ?? '').trim();
    const thatTitle = getTopic(e.topicId)?.title;
    if (!text || !thatTitle || text.length > GREETING_ANALOGY_MAX) continue;
    candidates.push(`上次老师讲「${thatTitle}」打的那个比方——『${text}』——我到现在还记得!`);
    break;
  }

  // 候选⑤(既有 c):别门课最近出师(荣誉记忆,顺带表决心)
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'topic_mastered' || e.topicId === topic.topicId) continue;
    const thatTitle = getTopic(e.topicId)?.title;
    if (thatTitle) {
      candidates.push(`老师上次把「${thatTitle}」教到我出师,这门我也想学明白!`);
      break;
    }
  }

  if (candidates.length === 0) return null;
  return candidates[priorSessionCount(prior) % candidates.length];
}

// ───────────────────────── 单课记忆回执(备课页 / 星图消费) ─────────────────────────

/**
 * 单课记忆回执:一门课到此刻的全部记忆切面,供备课页「接着上次讲」纸条卡与盲区星图消费。
 * 评估隐身同样生效——只吐 topic.title / 命中要点 point 名 / 金句原文逐字 / 心魔策展名 /
 * 真实计数与衰减数;绝不碰 belief / groundTruth / lookupCard / 未教术语。
 * 零事件的课返回 null(首学不装熟);各数组封顶,消费方对空数组/null 一律防御式不渲染。
 */
export interface TopicRecall {
  topicId: string;
  title: string;
  lastStudiedAt: number | null;      // 该课最后一次会话事件时间戳(ms)
  lastOutcome: string | null;        // 一句册页语域结局,如「上一堂清了两处心魔」
  rememberedPoints: string[];        // 命中过的 checklist 要点名,≤4
  goldenQuotes: string[];            // 金句原文逐字,≤2
  clearedDemons: string[];           // 已纠正误区的心魔名(story.ts demonName),≤3
  retention: number | null;          // decayedMastery 0..1,仅出师课,否则 null
  daysToFog: number | null;          // 距 reviewDue 天数(负=已过期),不适用为 null
  crossLinks: Array<{ otherTitle: string; note: string }>; // 两端都实质学过的关联
}

export function deriveTopicRecall(input: {
  topicId: string;
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  topics: Topic[];
  now?: number;
}): TopicRecall | null {
  const { topicId } = input;
  const own = chronological(input.events.filter((e) => e.topicId === topicId));
  if (own.length === 0) return null;   // 零事件的课不装熟

  const topic = input.topics.find((t) => t.topicId === topicId) ?? getTopic(topicId);
  const title = topic?.title ?? topicId;
  const titleOf = (id: string) =>
    input.topics.find((t) => t.topicId === id)?.title ?? getTopic(id)?.title ?? id;
  const nowDate = new Date(input.now ?? Date.now());
  const state = input.topicStates[topicId];

  // 该课最后一次会话事件时间戳(备课/补学 sessionId 为 null,不计)
  let lastStudiedAt: number | null = null;
  for (const e of own) {
    if (!e.sessionId) continue;
    const ms = new Date(e.t).getTime();
    if (!Number.isNaN(ms) && (lastStudiedAt === null || ms > lastStudiedAt)) lastStudiedAt = ms;
  }

  // 最近一堂结局(册页语域,称「先生」);topicOf 恒解析为本课
  const episodes = topic ? collectEpisodes(own, input.reports, () => topic) : [];
  const lastOutcome = episodes.length ? recallOutcomeLine(episodes[0]) : null;

  // 记得的要点:topicState 与命中事件取并集,按 checklist 次序取前四
  const hitIds = new Set<string>(state?.hitChecklist ?? []);
  for (const e of own) {
    if (e.type === 'checklist_hit') {
      const id = String(e.payload.checklistId ?? '');
      if (id) hitIds.add(id);
    }
  }
  const rememberedPoints = topic
    ? topic.checklist.filter((c) => hitIds.has(c.id)).map((c) => c.point).slice(0, 4)
    : [];

  // 裱起来的金句:原文逐字,去重后取最近两条
  const quotes: string[] = [];
  for (const e of own) {
    if (e.type !== 'golden_analogy_saved') continue;
    const text = String(e.payload.text ?? '').trim();
    if (text && !quotes.includes(text)) quotes.push(text);
  }
  const goldenQuotes = quotes.slice(-2);

  // 清掉的心魔:按 mcId 时序最后一条判定为「纠正」者(后又被带偏则不算清),取名走 demonName
  const verdict = new Map<string, 'corrected' | 'adopted'>();
  for (const e of own) {
    if (e.type === 'misconception_corrected') verdict.set(String(e.payload.mcId ?? ''), 'corrected');
    else if (e.type === 'misconception_adopted') verdict.set(String(e.payload.mcId ?? ''), 'adopted');
  }
  const clearedDemons: string[] = [];
  if (topic) {
    for (const [mcId, v] of verdict) {
      if (v !== 'corrected' || !mcId) continue;
      const mc = topic.misconceptions.find((m) => m.mcId === mcId);
      if (mc) clearedDemons.push(demonName(mc));
    }
  }

  // 保持度:仅出师课,decayedMastery(0..1);距起雾天数由 reviewDue 派生(负=已过期)
  let retention: number | null = null;
  let daysToFog: number | null = null;
  if (state) {
    if (state.knowledgeState === '出师' && topic) {
      retention = decayedMastery(computeMastery(state, topic, input.events), state.lastVerified, nowDate);
    }
    if (state.reviewDue) {
      const ms = new Date(state.reviewDue).getTime() - nowDate.getTime();
      if (!Number.isNaN(ms)) daysToFog = Math.round(ms / 86400000);
    }
  }

  // 跨课线:本课两端都实质学过的 STAR_LINKS(本课自身也须实质学过)
  const learned = substantiallyLearned(input.events);
  const crossLinks: Array<{ otherTitle: string; note: string }> = [];
  if (learned.has(topicId)) {
    for (const link of STAR_LINKS) {
      const other = link.a === topicId ? link.b : link.b === topicId ? link.a : null;
      if (!other || !learned.has(other)) continue;
      crossLinks.push({ otherTitle: titleOf(other), note: link.note });
    }
  }

  return {
    topicId,
    title,
    lastStudiedAt,
    lastOutcome,
    rememberedPoints,
    goldenQuotes,
    clearedDemons: clearedDemons.slice(0, 3),
    retention,
    daysToFog,
    crossLinks,
  };
}
