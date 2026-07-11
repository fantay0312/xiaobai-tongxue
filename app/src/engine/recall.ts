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

export interface MemoryLayer {
  key: MemoryLayerKey;
  no: string;                                  // 壹/贰/叁/肆
  name: string;
  caption: string;                             // 这一层的存续规则,一句话
  stats: { label: string; value: string }[];
  lines: string[];
  anchor: { label: string; to: string } | null;
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
}

/** 事件按 sessionId 分组并轨 reports,倒序;备课/补学(sessionId 为 null)不算课堂情景 */
function collectEpisodes(events: LearnEvent[], reports: SessionReport[]): Episode[] {
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
    episodes.push({
      t: evs[0].t,
      topicId: evs[0].topicId,
      mastered: (report?.masteredNow ?? false) || evs.some((e) => e.type === 'topic_mastered'),
      reviewPassed: evs.some((e) => e.type === 'review_passed'),
      adopted: evs.filter((e) => e.type === 'misconception_adopted').length,
      corrected: evs.filter((e) => e.type === 'misconception_corrected').length,
      golden: evs.filter((e) => e.type === 'golden_analogy_saved').length,
    });
  }
  return episodes.sort((a, b) => (a.t < b.t ? 1 : -1));
}

/** 情景一句话:编年史同款语域——只说小白怎么样,不说你错了(盲区语言纪律) */
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
  return `${chineseDateLabel(ep.t)}那堂「${title}」,${outcome}。`;
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
    working = {
      key: 'working', no: '壹', name: '当堂记忆', caption: '只存当堂问答,下课即散',
      stats: [
        { label: '在上', value: `「${titleOf(live.topicId)}」` },
        { label: '进行到', value: `第 ${Math.max(1, turnNo)} 轮` },
        { label: '本课听懂', value: `${heard.size} 个要点` },
      ],
      lines: ['这一层只装当堂的一问一答,下课铃一响就清空——要紧的会沉进下面三层。'],
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
  const episodes = collectEpisodes(events, input.reports);
  const episodic: MemoryLayer = {
    key: 'episodic', no: '贰', name: '课堂情景', caption: '一堂课,存一页情景',
    stats: [{ label: '共', value: `${episodes.length} 堂课` }],
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
    ],
    lines: semanticLines,
    anchor: { label: '看学问舆图', to: '/growth#map' },
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

/**
 * 跨会话回忆开场白:把 L2 情景记忆做成看得见的行为。
 * 评估隐身铁律:开场白绝不引用误区 belief、不碰 groundTruth、不吐未教术语——
 * 只允许 topic.title 与金句原文(教师原话,逐字引用即安全)。
 * excludeSessionId = 刚开的这场,必须滤掉;没有任何往史则返回 null(第一课不装熟)。
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

  // (b) 别门课上最新的金句:从新到旧找第一条能塞进开场白的(原文逐字引用)
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'golden_analogy_saved' || e.topicId === topic.topicId) continue;
    const text = String(e.payload.text ?? '').trim();
    const thatTitle = getTopic(e.topicId)?.title;
    if (!text || !thatTitle || text.length > GREETING_ANALOGY_MAX) continue;
    return `上次老师讲「${thatTitle}」打的那个比方——『${text}』——我到现在还记得!`;
  }

  // (c) 最近出师的别门课:荣誉记忆,顺带表个决心
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const e = prior[i];
    if (e.type !== 'topic_mastered' || e.topicId === topic.topicId) continue;
    const thatTitle = getTopic(e.topicId)?.title;
    if (thatTitle) return `老师上次把「${thatTitle}」教到我出师,这门我也想学明白!`;
  }

  return null;
}
