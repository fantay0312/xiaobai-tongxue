/**
 * 学伴记忆引擎(对标 OpenAI Memory / Anthropic Memory Topics / Mem0):
 * 两层制 —— 离散可编辑的记忆条目(MemoryItem)+ 后台合成的学习者画像(LearnerProfile)。
 * 写入管线(Mem0 式):每堂课 extractSessionMemories 抽草稿 → reconcileMemories 按 ADD/UPDATE/DELETE/NOOP 归并;
 * 新鲜度:同键再见即 UPDATE(seenCount++/confidence+0.15),同矛盾键的长处/短板新者胜、旧者 DELETE;
 * 出师则清掉该课的卡壳/送考短板(superseded-by-mastery);21 天半衰期只作用于观察项,里程碑与亲笔不褪色。
 * 注入(just-in-time):memoryHintsForXiaobai 只按 dedupeKey 查固定话术表 HINT_BY_KEY,
 * 从不拼 item.text / evidence(那里有先生原话,可能含未教术语),且每句过 leakageCheck。
 * 铁律:纯函数、确定性、Node 安全(无 DOM、无 Date.now)、不进 engine/index barrel;
 * 只依赖 ../types 与两个同样纯净的兄弟模块(story.demonName 策展心魔名、leakage.leakageCheck 出口守门)。
 * 文本纪律:第三人称写「先生」,全角标点,≤60 字;不写用户名/邮箱/手机号(scrubQuote 兜底)。
 */
import type {
  ChatMessage, LearnEvent, LearnerProfile, MemoryItem, MemoryKind, MemoryState, SessionReport,
  Topic, TurnTrace,
} from '../types';
import { demonName } from './story';
import { leakageCheck } from './leakage';

// ───────────────────────── 常量 ─────────────────────────

export const EMPTY_MEMORY: MemoryState = { items: [], profile: null, paused: false, version: 1 };

/** 条目上限;超出按 scoreMemory 淘汰观察项(先淘非里程碑,亲笔/固定永不淘汰) */
export const MEMORY_CAP = 80;
/** 低于此置信度的条目:册页仍列出(注「还在观察」),但不进画像、不进检索、不进提示词 */
export const MIN_VISIBLE_CONFIDENCE = 0.45;
/** 观察项的记忆半衰期(天) */
const HALF_LIFE_DAYS = 21;
const TEXT_MAX = 60;
const EVIDENCE_MAX = 5;
const QUOTE_MAX = 20;

export const MEMORY_KINDS: readonly MemoryKind[] = [
  'preference', 'habit', 'strength', 'weakness', 'milestone', 'bond', 'note',
];
const KIND_SET = new Set<string>(MEMORY_KINDS);
const SOURCE_SET = new Set<string>(['observed', 'explicit', 'synthesized']);

/** 与 evaluator.ts ANALOGY_MARKERS 逐字同源(evaluator 不导出,此处复制以免拖入 LLM 依赖) */
const ANALOGY_MARKERS = ['就像', '好比', '比如说', '打个比方', '相当于', '类似于', '就好像'];

/**
 * 提示词表:只按 dedupeKey 取固定第二人称话术,永不插值条目文本/证据。
 * 没有表项的条目(含所有亲笔/改过的条目、夜读等)一律不进提示词。
 */
export const HINT_BY_KEY: Readonly<Record<string, string>> = {
  analogy: '老师爱打比方，一举例你就容易懂——听到比喻可以更起劲',
  code: '老师爱用代码说事——看到代码可以顺着代码问',
  terse: '老师说话短，一句一个点——听完一句再问，别抢',
  verbose: '老师一开口就是一大段——抓住最后一句接住就好',
  reteach: '讲岔了的地方老师会回来重讲——放心把没懂的说出来',
  review: '你忘了的东西老师陪你捡回来过——忘了就直说',
};

// ───────────────────────── 类型 ─────────────────────────

export interface MemoryDraft {
  kind: MemoryKind;
  scope: MemoryItem['scope'];
  dedupeKey: string;
  text: string;
  confidence: number;
  evidence: string[];
  contradictionKey?: string;
}

export interface MemoryOp {
  op: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';
  id: string;
  reason: string;
}

export interface ExtractInput {
  sessionId: string;
  events: LearnEvent[];
  report: SessionReport | null;
  topic: Topic;
  /** 本场对话(老师 + 小白);历史回填时为 [] */
  messages: ChatMessage[];
  /** 本场逐轮判定;消息类规则只数无卡壳/无偏题/非题外的老师轮次;历史回填时为 [] */
  traces: TurnTrace[];
  /** 既有条目(只读):用于「卡壳后讲明白」这类需要往史的正向草稿 */
  existing: MemoryItem[];
  /** 需要从引文里剔除的词(如用户名);Node 下为 [] */
  piiTerms?: string[];
  now: string;
}

// ───────────────────────── 小工具 ─────────────────────────

/** 同步 32 位 FNV-1a(UTF-16 码元),8 位十六进制;≤80 条内碰撞可忽略,且 reconcile 仍比对三元组 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function scopeKey(scope: MemoryItem['scope']): string {
  if (scope.topicId) return `t:${scope.topicId}`;
  if (scope.course) return `c:${scope.course}`;
  return 'g';
}

export function memoryItemId(kind: MemoryKind, scope: MemoryItem['scope'], dedupeKey: string): string {
  return `mem-${fnv1a(`${kind}|${scopeKey(scope)}|${dedupeKey}`)}`;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function chronological(events: LearnEvent[]): LearnEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.t < b.e.t ? -1 : a.e.t > b.e.t ? 1 : a.i - b.i))
    .map((x) => x.e);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
}

const PII_PATTERNS = [/\d{7,}/, /[\w.-]+@[\w-]+\.\w+/, /(微信|手机|电话|QQ)[:：]?\s*\S+/];

/** 引文净化:含号码/邮箱/联系方式/用户名的引文整条丢弃(保留事件 id 作证据),其余截 20 字 */
export function scrubQuote(raw: string, piiTerms: string[] = []): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (PII_PATTERNS.some((re) => re.test(text))) return null;
  for (const term of piiTerms) {
    const t = term.trim();
    if (t.length >= 2 && text.toLowerCase().includes(t.toLowerCase())) return null;
  }
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX)}…` : text;
}

function clipText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > TEXT_MAX ? clean.slice(0, TEXT_MAX) : clean;
}

// ───────────────────────── 抽取 ─────────────────────────

const CODE_RE = [/```/, /\bdef\s+\w+\(/, /\bprint\(/, /\bimport\s+\w+/];

function looksLikeCode(text: string): boolean {
  if (CODE_RE.some((re) => re.test(text))) return true;
  const lines = text.split('\n');
  let colonIndent = 0;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (/:\s*$/.test(lines[i]) && /^\s+\S/.test(lines[i + 1])) colonIndent += 1;
  }
  return colonIndent >= 2;
}

/** 亚洲/上海固定时区小时数(不用 getHours:Node 与浏览器时区可能不同,回填须确定) */
function shanghaiHour(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(((ms / 3_600_000) + 8) % 24 + 24) % 24;
}

/**
 * 规则抽取(mock/离线路径,也是确定性的唯一真源)。
 * 每条草稿带 dedupeKey 与 evidence(事件 id 或 ≤20 字净化引文)。
 */
export function extractSessionMemories(input: ExtractInput): MemoryDraft[] {
  const { sessionId, topic, report, existing } = input;
  const pii = input.piiTerms ?? [];
  const events = chronological(input.events.filter((e) => e.sessionId === sessionId));
  const of = (type: LearnEvent['type']) => events.filter((e) => e.type === type);
  const topicScope = { topicId: topic.topicId };
  const drafts: MemoryDraft[] = [];
  const quotes = (texts: string[], cap: number): string[] => {
    const out: string[] = [];
    for (const t of texts) {
      const q = scrubQuote(t, pii);
      if (q && !out.includes(q)) out.push(q);
      if (out.length >= cap) break;
    }
    return out;
  };

  // 1. 爱打比方:金句事件 或 ≥3 句带比喻标记的老师话(与 evaluator 同一标记表)
  const goldens = of('golden_analogy_saved');
  const teacherTexts = input.messages.filter((m) => m.role === 'teacher').map((m) => m.text);
  const markerTexts = teacherTexts.filter((t) => ANALOGY_MARKERS.some((m) => t.includes(m)));
  if (goldens.length > 0 || markerTexts.length >= 3) {
    drafts.push({
      kind: 'habit', scope: {}, dedupeKey: 'analogy',
      text: '先生讲课爱打比方',
      confidence: goldens.length > 0 ? 0.8 : 0.6,
      evidence: [...goldens.map((e) => e.id), ...quotes(markerTexts, EVIDENCE_MAX)].slice(0, EVIDENCE_MAX),
    });
  }

  // 2. 卡壳(R2+ 才算:R1 只是递台阶;按 checklistId 一条,同课再犯由 UPDATE 累计)
  const stuckByChecklist = new Map<string, { level: number; ids: string[] }>();
  for (const e of of('stuck_rescued')) {
    const id = e.payload.checklistId;
    const level = String(e.payload.level ?? '');
    if (typeof id !== 'string' || !['R2', 'R3', 'R4'].includes(level)) continue;
    const weight = level === 'R2' ? 0.5 : 0.7;
    const cur = stuckByChecklist.get(id) ?? { level: 0, ids: [] };
    cur.level = Math.max(cur.level, weight);
    cur.ids.push(e.id);
    stuckByChecklist.set(id, cur);
  }
  for (const [checklistId, info] of stuckByChecklist) {
    const point = topic.checklist.find((c) => c.id === checklistId)?.point;
    if (!point) continue;
    drafts.push({
      kind: 'weakness', scope: topicScope, dedupeKey: `stuck:${checklistId}`,
      contradictionKey: `checklist:${checklistId}`,
      text: clipText(`讲『${point}』时，先生卡过壳`),
      confidence: info.level, evidence: info.ids.slice(-EVIDENCE_MAX),
    });
  }

  // 3. 卡壳过的要点这回讲明白了(只在既有短板存在时才出正向草稿)
  const hitIds = new Map<string, string[]>();
  for (const e of of('checklist_hit')) {
    const id = e.payload.checklistId;
    if (typeof id !== 'string') continue;
    hitIds.set(id, [...(hitIds.get(id) ?? []), e.id]);
  }
  for (const [checklistId, ids] of hitIds) {
    const hadStuck = existing.some((it) =>
      it.kind === 'weakness' && it.scope.topicId === topic.topicId && it.dedupeKey === `stuck:${checklistId}`);
    const point = topic.checklist.find((c) => c.id === checklistId)?.point;
    if (!hadStuck || !point) continue;
    drafts.push({
      kind: 'strength', scope: topicScope, dedupeKey: `hit:${checklistId}`,
      contradictionKey: `checklist:${checklistId}`,
      text: clipText(`『${point}』后来先生讲明白了`),
      confidence: 0.6, evidence: ids.slice(-EVIDENCE_MAX),
    });
  }

  // 4. 误区:同一 mcId 只看本场最后一次判定;心魔名走 story.demonName(策展白名单,不写 belief 原文)
  const lastMc = new Map<string, LearnEvent>();
  for (const e of events) {
    if (e.type !== 'misconception_adopted' && e.type !== 'misconception_corrected') continue;
    if (typeof e.payload.mcId === 'string') lastMc.set(e.payload.mcId, e);
  }
  for (const [mcId, e] of lastMc) {
    const mc = topic.misconceptions.find((m) => m.mcId === mcId);
    if (!mc) continue;
    const name = demonName(mc);
    const adopted = e.type === 'misconception_adopted';
    drafts.push({
      kind: adopted ? 'weakness' : 'strength', scope: topicScope,
      dedupeKey: `mc:${mcId}`, contradictionKey: `mc:${mcId}`,
      text: clipText(adopted
        ? `先生在『${name}』上被小白带偏过`
        : `先生把『${name}』这处误区纠了回来`),
      confidence: 0.7,
      evidence: [e.id, ...quotes([mc.belief], 1)],
    });
  }

  // 5. 出师里程碑
  const mastered = of('topic_mastered').at(-1);
  if (mastered) {
    const turns = Math.max(0, Math.round(num(mastered.payload.turns)));
    drafts.push({
      kind: 'milestone', scope: topicScope, dedupeKey: 'mastered',
      text: clipText(`《${topic.title}》讲了 ${turns} 轮，小白出师`),
      confidence: 1, evidence: [mastered.id],
    });
  }

  // 6. 雷达·逻辑结构(≥4 轮才有统计意义;课级,高低共用矛盾键)
  if (report && report.turnCount >= 4) {
    const logic = report.radar.逻辑结构;
    if (logic >= 0.8) {
      drafts.push({
        kind: 'strength', scope: topicScope, dedupeKey: 'radar:logic:hi', contradictionKey: 'radar:logic',
        text: '先生讲得有条理', confidence: 0.4, evidence: [`逻辑结构 ${Math.round(logic * 100)}`],
      });
    } else if (logic < 0.4) {
      drafts.push({
        kind: 'weakness', scope: topicScope, dedupeKey: 'radar:logic:lo', contradictionKey: 'radar:logic',
        text: '先生讲解顺序有些跳', confidence: 0.4, evidence: [`逻辑结构 ${Math.round(logic * 100)}`],
      });
    }
  }

  // 7. 送考分数
  const quiz = of('xiaobai_quiz_scored').at(-1);
  if (quiz) {
    const score = Math.round(num(quiz.payload.score));
    if (score < 60) {
      drafts.push({
        kind: 'weakness', scope: topicScope, dedupeKey: 'quiz', contradictionKey: `quiz:${topic.topicId}`,
        text: clipText(`《${topic.title}》送考只得 ${score} 分，先生还得再讲`),
        confidence: 0.6, evidence: [quiz.id],
      });
    } else if (score >= 80) {
      drafts.push({
        kind: 'strength', scope: topicScope, dedupeKey: 'quiz', contradictionKey: `quiz:${topic.topicId}`,
        text: clipText(`《${topic.title}》送考 ${score} 分，先生讲得住`),
        confidence: 0.5, evidence: [quiz.id],
      });
    }
  }

  // 8. 说话风格(只数干净轮次:无卡壳、无偏题、非题外;≥4 轮才下判断)
  const cleanTurns = input.traces
    .filter((t) => !t.evalResult.stuckSignal && !t.evalResult.offTopic && !t.evalResult.answeredTangent)
    .map((t) => t.teacherText);
  if (cleanTurns.length >= 4) {
    const avg = cleanTurns.reduce((sum, t) => sum + t.length, 0) / cleanTurns.length;
    if (avg < 25) {
      drafts.push({
        kind: 'habit', scope: {}, dedupeKey: 'terse', contradictionKey: 'style:length',
        text: '先生说话短，一句一个点', confidence: 0.5, evidence: quotes(cleanTurns, 3),
      });
    } else if (avg > 90) {
      drafts.push({
        kind: 'habit', scope: {}, dedupeKey: 'verbose', contradictionKey: 'style:length',
        text: '先生一开口就是一大段', confidence: 0.5, evidence: quotes(cleanTurns, 3),
      });
    }
  }
  const codeTurns = cleanTurns.filter(looksLikeCode);
  if (codeTurns.length >= 2) {
    drafts.push({
      kind: 'preference', scope: {}, dedupeKey: 'code',
      text: '先生爱用代码说事', confidence: 0.6, evidence: quotes(codeTurns, 3),
    });
  }

  // 9. 夜读(置信度 0.3:两晚 UPDATE 后才过可见线;不进提示词表)
  const started = of('session_started')[0];
  if (started) {
    const hour = shanghaiHour(started.t);
    if (hour !== null && (hour >= 22 || hour <= 4)) {
      drafts.push({
        kind: 'habit', scope: {}, dedupeKey: 'night',
        text: '先生常夜读', confidence: 0.3, evidence: [started.id],
      });
    }
    // 10. 情分:重讲验证 / 复习过关
    if (started.payload.mode === 'reteach') {
      drafts.push({
        kind: 'bond', scope: {}, dedupeKey: 'reteach',
        text: '讲岔了的地方，先生会回来重讲', confidence: 0.6, evidence: [started.id],
      });
    }
  }
  const reviewPassed = of('review_passed');
  if (reviewPassed.length > 0) {
    drafts.push({
      kind: 'bond', scope: {}, dedupeKey: 'review',
      text: '小白忘了的，先生陪它捡回来过', confidence: 0.6,
      evidence: reviewPassed.map((e) => e.id).slice(-EVIDENCE_MAX),
    });
  }

  return drafts;
}

// ───────────────────────── 评分 / 归并 ─────────────────────────

/** 置信度 × 新鲜度(观察项 21 天半衰期;里程碑与亲笔不褪色)× 固定加倍 × 隐藏归零,加一点复见对数奖励 */
export function scoreMemory(item: MemoryItem, now: string): number {
  if (item.muted) return 0;
  const fresh = item.kind === 'milestone' || item.source === 'explicit'
    ? 1
    : 0.5 ** (daysBetween(item.lastSeenAt, now) / HALF_LIFE_DAYS);
  const base = clamp01(item.confidence) * fresh * (item.pinned ? 2 : 1);
  return base + 0.05 * Math.log1p(Math.max(0, item.seenCount));
}

function byScoreDesc(now: string) {
  return (a: MemoryItem, b: MemoryItem) =>
    scoreMemory(b, now) - scoreMemory(a, now) || a.id.localeCompare(b.id);
}

function mergeEvidence(existing: string[], incoming: string[]): string[] {
  const out = [...existing];
  for (const e of incoming) if (!out.includes(e)) out.push(e);
  return out.slice(-EVIDENCE_MAX);
}

function protectedItem(item: MemoryItem): boolean {
  return item.pinned || item.source === 'explicit';
}

/** 超上限淘汰:只淘观察且未固定的;有非里程碑可淘时不动里程碑;淘最低分 */
export function capMemoryItems(items: MemoryItem[], now: string): MemoryItem[] {
  return capItems(items, now);
}

function capItems(items: MemoryItem[], now: string, ops?: MemoryOp[]): MemoryItem[] {
  const out = [...items];
  while (out.length > MEMORY_CAP) {
    const candidates = out.filter((it) => !protectedItem(it));
    const pool = candidates.some((it) => it.kind !== 'milestone')
      ? candidates.filter((it) => it.kind !== 'milestone')
      : candidates;
    if (pool.length === 0) break;
    const victim = [...pool].sort(byScoreDesc(now)).at(-1)!;
    out.splice(out.findIndex((it) => it.id === victim.id), 1);
    ops?.push({ op: 'DELETE', id: victim.id, reason: 'cap-80' });
  }
  return out;
}

/**
 * Mem0 式归并:同 (kind, scope, dedupeKey) → UPDATE;同矛盾键的既有条目 → 观察项 DELETE(新者胜),
 * 亲笔/固定项则反过来让新草稿 NOOP(先生的话是权威);出师草稿顺带清掉该课的卡壳/送考短板;末尾封顶 80。
 */
export function reconcileMemories(
  existing: MemoryItem[], drafts: MemoryDraft[], now: string,
): { items: MemoryItem[]; ops: MemoryOp[] } {
  const items = [...existing];
  const ops: MemoryOp[] = [];
  const indexOf = (id: string) => items.findIndex((it) => it.id === id);

  for (const draft of drafts) {
    const id = memoryItemId(draft.kind, draft.scope, draft.dedupeKey);
    const key = draft.contradictionKey;
    if (key) {
      const conflicting = items.filter((it) => it.id !== id && it.contradictionKey === key);
      const guarded = conflicting.find(protectedItem);
      if (guarded) {
        ops.push({ op: 'NOOP', id, reason: `kept-explicit:${key}` });
        continue;
      }
      for (const victim of conflicting) {
        items.splice(indexOf(victim.id), 1);
        ops.push({ op: 'DELETE', id: victim.id, reason: `contradiction:${key}` });
      }
    }
    const at = indexOf(id);
    if (at >= 0) {
      const cur = items[at];
      items[at] = {
        ...cur,
        text: protectedItem(cur) ? cur.text : clipText(draft.text) || cur.text,
        ...(cur.contradictionKey === undefined && key ? { contradictionKey: key } : {}),
        confidence: clamp01(Math.min(1, cur.confidence + 0.15)),
        evidence: mergeEvidence(cur.evidence, draft.evidence),
        // 观察只推 lastSeenAt/seenCount/confidence/evidence;updatedAt 留给先生的手笔(固定/隐藏/改文),
        // 否则另一台设备的后台「又见到一次」会在合并时压掉先生刚按下的固定/隐藏
        lastSeenAt: now,
        seenCount: cur.seenCount + 1,
      };
      ops.push({ op: 'UPDATE', id, reason: 'seen-again' });
    } else {
      const text = clipText(draft.text);
      if (!text) {
        ops.push({ op: 'NOOP', id, reason: 'empty-text' });
        continue;
      }
      items.push({
        id, kind: draft.kind, scope: { ...draft.scope }, text, source: 'observed',
        dedupeKey: draft.dedupeKey,
        ...(key ? { contradictionKey: key } : {}),
        confidence: clamp01(draft.confidence),
        evidence: draft.evidence.slice(-EVIDENCE_MAX),
        createdAt: now, updatedAt: now, lastSeenAt: now,
        seenCount: 1, pinned: false, muted: false,
      });
      ops.push({ op: 'ADD', id, reason: 'new-fact' });
    }

    // 出师即超越:该课的卡壳/送考短板(观察项)退场
    if (draft.kind === 'milestone' && draft.dedupeKey === 'mastered' && draft.scope.topicId) {
      const topicId = draft.scope.topicId;
      for (const it of [...items]) {
        if (it.kind !== 'weakness' || it.scope.topicId !== topicId || protectedItem(it)) continue;
        if (!it.dedupeKey.startsWith('stuck:') && it.dedupeKey !== 'quiz') continue;
        items.splice(indexOf(it.id), 1);
        ops.push({ op: 'DELETE', id: it.id, reason: 'superseded-by-mastery' });
      }
    }
  }

  return { items: capItems(items, now, ops), ops };
}

// ───────────────────────── 检索 / 提示 ─────────────────────────

export interface RetrieveInput {
  items: MemoryItem[];
  topicId?: string;
  course?: string;
  kinds?: MemoryKind[];
  limit: number;
  now: string;
}

function scopeRank(item: MemoryItem, topicId?: string, course?: string): number {
  if (item.scope.topicId) return topicId && item.scope.topicId === topicId ? 3 : -1;
  if (item.scope.course) return course && item.scope.course === course ? 2 : -1;
  return 1;
}

/** 排除隐藏与低置信;作用域优先级 课 > 课程 > 全局(别的课的条目不取);再按分数 */
export function retrieveMemories(input: RetrieveInput): MemoryItem[] {
  const { items, topicId, course, kinds, limit, now } = input;
  const kindSet = kinds ? new Set<MemoryKind>(kinds) : null;
  return items
    .filter((it) => !it.muted && it.confidence >= MIN_VISIBLE_CONFIDENCE)
    .filter((it) => !kindSet || kindSet.has(it.kind))
    .map((it) => ({ it, rank: scopeRank(it, topicId, course) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || byScoreDesc(now)(a.it, b.it))
    .slice(0, Math.max(0, limit))
    .map((x) => x.it);
}

export interface HintInput {
  items: MemoryItem[];
  topicId: string;
  course: string;
  topic: Topic;
  /** 已解锁的 checklist id(泄漏守门白名单) */
  hitChecklist: string[];
  now: string;
  limit?: number;
}

/**
 * 注入小白提示词的句子:只取 preference/habit/bond 三类,只查固定话术表(永不用 item.text),
 * 每句再过 leakageCheck(白名单 = 已命中要点,老师词 = 空),有泄漏即丢。默认 ≤2 句。
 */
export function memoryHintsForXiaobai(input: HintInput): string[] {
  const { items, topicId, course, topic, hitChecklist, now } = input;
  const limit = input.limit ?? 2;
  const picked = retrieveMemories({
    items, topicId, course, kinds: ['preference', 'habit', 'bond'], limit: items.length, now,
  });
  const out: string[] = [];
  for (const it of picked) {
    const line = HINT_BY_KEY[it.dedupeKey];
    if (!line || out.includes(line)) continue;
    const leaks = leakageCheck({ reply: line, topic, whitelistChecklist: hitChecklist, teacherTerms: [] });
    if (leaks.length > 0) continue;
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

// ───────────────────────── 画像合成 ─────────────────────────

const STYLE_KEYS = new Set(['analogy', 'code']);
const PACE_KEYS = new Set(['terse', 'verbose', 'night']);

function joinWithin(parts: string[], max: number): string {
  let out = '';
  for (const p of parts) {
    const next = out ? `${out}，${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

const SUBSTANTIAL: ReadonlySet<LearnEvent['type']> = new Set([
  'checklist_hit', 'misconception_corrected', 'misconception_adopted', 'golden_analogy_saved',
]);

/** 画像依据:实质上过的堂数(有要点/误区/金句事件的会话)与最近一课时间 */
export function profileBasis(events: LearnEvent[]): { sessionCount: number; lastSessionAt: string | null } {
  const sessions = new Set<string>();
  let last: string | null = null;
  for (const e of events) {
    if (!e.sessionId) continue;
    if (SUBSTANTIAL.has(e.type)) sessions.add(e.sessionId);
    if (last === null || e.t > last) last = e.t;
  }
  return { sessionCount: sessions.size, lastSessionAt: last };
}

/**
 * 确定性中文画像(OpenAI memory summary 的规则版):
 * summary 引用真实堂数/出师数与前两条习惯;五段各 ≤80 字;14 天未来标「上回来是 N 天前」,45 天以上只留长短板与情分。
 */
export function composeLearnerProfile(input: {
  items: MemoryItem[]; events: LearnEvent[]; now: string;
}): LearnerProfile {
  const { items, events, now } = input;
  const basis = profileBasis(events);
  const visible = items
    .filter((it) => !it.muted && it.confidence >= MIN_VISIBLE_CONFIDENCE)
    .sort(byScoreDesc(now));
  const daysSince = basis.lastSessionAt === null ? null : Math.floor(daysBetween(basis.lastSessionAt, now));
  const stale = daysSince !== null && daysSince >= 14;
  const ancient = daysSince !== null && daysSince >= 45;
  const mastered = new Set(events.filter((e) => e.type === 'topic_mastered').map((e) => e.topicId)).size;

  const habits = visible.filter((it) => it.kind === 'habit' || it.kind === 'preference');
  const styleTexts = habits.filter((it) => STYLE_KEYS.has(it.dedupeKey) || it.kind === 'preference').map((it) => it.text);
  const paceTexts = habits.filter((it) => PACE_KEYS.has(it.dedupeKey)).map((it) => it.text);
  const otherHabits = habits.filter((it) => !STYLE_KEYS.has(it.dedupeKey) && !PACE_KEYS.has(it.dedupeKey) && it.kind === 'habit');

  const strengthItems = visible.filter((it) => it.kind === 'strength');
  const logicTopics = strengthItems.filter((it) => it.dedupeKey === 'radar:logic:hi').length;
  const strengthTexts = [
    ...(logicTopics >= 2 ? [`${logicTopics} 门课都讲得有条理`] : []),
    ...strengthItems.filter((it) => it.dedupeKey !== 'radar:logic:hi').map((it) => it.text),
  ];
  const weaknessTexts = visible.filter((it) => it.kind === 'weakness').map((it) => it.text);
  const bondTexts = visible.filter((it) => it.kind === 'bond').map((it) => it.text);
  const noteTexts = visible.filter((it) => it.kind === 'note').map((it) => it.text);

  const sections = {
    style: ancient ? '' : joinWithin([...styleTexts, ...otherHabits.map((it) => it.text)], 80),
    strengths: joinWithin(strengthTexts, 80),
    weaknesses: joinWithin(weaknessTexts, 80),
    pace: ancient ? '' : joinWithin(paceTexts, 80),
    bond: joinWithin([...bondTexts, ...noteTexts], 80),
  };

  const clauses: string[] = [];
  if (stale && daysSince !== null) clauses.push(`先生上回来是 ${daysSince} 天前。`);
  if (basis.sessionCount > 0) {
    clauses.push(`先生讲过 ${basis.sessionCount} 堂课${mastered > 0 ? `，${mastered} 门出师` : ''}。`);
  }
  // 习惯句合并成一句:「讲课爱打比方，一开口就是一大段」——去掉重复的「先生」主语,像人写的画像
  const topHabits = habits.slice(0, 2).map((it) => it.text.replace(/^先生/, ''));
  if (topHabits.length > 0) clauses.push(`${stale ? '从前' : ''}${topHabits.join('，')}。`);
  const milestone = visible.filter((it) => it.kind === 'milestone')
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.id.localeCompare(b.id))[0];
  if (milestone) clauses.push(`最近一回，${milestone.text}。`);
  let summary = '';
  for (const c of clauses) {
    if ((summary + c).length > 120) break;
    summary += c;
  }

  return {
    version: 1, updatedAt: now, summary, sections,
    basis: { itemCount: items.length, sessionCount: basis.sessionCount, lastSessionAt: basis.lastSessionAt },
  };
}

// ───────────────────────── 历史回填 ─────────────────────────

/**
 * 从事件流按 sessionId 分组、按时间重放 extract → reconcile,再合成画像;同输入同输出。
 * 对话不持久化:回填只能恢复事件/报告派生的条目,说话风格类(terse/verbose/code)在回填中天然缺席。
 */
export function rebuildMemoryFromHistory(input: {
  events: LearnEvent[];
  reports: SessionReport[];
  topics: Topic[];
  messagesBySession?: Record<string, ChatMessage[]>;
  now: string;
}): MemoryState {
  const events = chronological(input.events);
  const order: string[] = [];
  const bySession = new Map<string, LearnEvent[]>();
  for (const e of events) {
    if (!e.sessionId) continue;
    const bucket = bySession.get(e.sessionId);
    if (bucket) bucket.push(e);
    else {
      bySession.set(e.sessionId, [e]);
      order.push(e.sessionId);
    }
  }
  let items: MemoryItem[] = [];
  for (const sessionId of order) {
    const sessionEvents = bySession.get(sessionId)!;
    const topic = input.topics.find((t) => t.topicId === sessionEvents[0].topicId);
    if (!topic) continue;
    const at = sessionEvents.at(-1)!.t;
    const drafts = extractSessionMemories({
      sessionId, events: sessionEvents,
      report: input.reports.find((r) => r.sessionId === sessionId) ?? null,
      topic, messages: input.messagesBySession?.[sessionId] ?? [], traces: [],
      existing: items, now: at,
    });
    items = reconcileMemories(items, drafts, Number.isFinite(Date.parse(at)) ? at : input.now).items;
  }
  const profile = items.length > 0 || order.length > 0
    ? composeLearnerProfile({ items, events, now: input.now })
    : null;
  return { items, profile, paused: false, version: 1 };
}

// ───────────────────────── 亲笔 ─────────────────────────

/** 先生亲笔一条:explicit、固定、置信 1;空文本返回 null;超 60 字截断 */
export function explicitMemory(text: string, scope: MemoryItem['scope'], now: string): MemoryItem | null {
  const clean = clipText(text);
  if (!clean) return null;
  const dedupeKey = `note:${fnv1a(`${now}|${clean}`)}`;
  return {
    id: memoryItemId('note', scope, dedupeKey), kind: 'note', scope: { ...scope }, text: clean,
    source: 'explicit', dedupeKey, confidence: 1, evidence: [],
    createdAt: now, updatedAt: now, lastSeenAt: now, seenCount: 1, pinned: true, muted: false,
  };
}

// ───────────────────────── 校验 / 净化(同步载荷与本地存档共用) ─────────────────────────

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isoString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function isMemoryItem(value: unknown): value is MemoryItem {
  if (!object(value)) return false;
  const scope = value.scope;
  return typeof value.id === 'string' && value.id.length > 0
    && KIND_SET.has(String(value.kind))
    && object(scope)
    && (scope.topicId === undefined || typeof scope.topicId === 'string')
    && (scope.course === undefined || typeof scope.course === 'string')
    && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= TEXT_MAX
    && SOURCE_SET.has(String(value.source))
    && typeof value.dedupeKey === 'string' && value.dedupeKey.length > 0
    && (value.contradictionKey === undefined || typeof value.contradictionKey === 'string')
    && typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1
    && strings(value.evidence) && value.evidence.length <= EVIDENCE_MAX
    && isoString(value.createdAt) && isoString(value.updatedAt) && isoString(value.lastSeenAt)
    && Number.isInteger(value.seenCount) && Number(value.seenCount) >= 0
    && typeof value.pinned === 'boolean' && typeof value.muted === 'boolean';
}

export function isLearnerProfile(value: unknown): value is LearnerProfile {
  if (!object(value) || value.version !== 1 || !isoString(value.updatedAt)) return false;
  if (typeof value.summary !== 'string' || !object(value.sections) || !object(value.basis)) return false;
  const s = value.sections;
  const b = value.basis;
  return ['style', 'strengths', 'weaknesses', 'pace', 'bond'].every((k) => typeof s[k] === 'string')
    && Number.isInteger(b.itemCount) && Number(b.itemCount) >= 0
    && Number.isInteger(b.sessionCount) && Number(b.sessionCount) >= 0
    && (b.lastSessionAt === null || isoString(b.lastSessionAt));
}

export function isMemoryState(value: unknown): value is MemoryState {
  return object(value) && value.version === 1 && typeof value.paused === 'boolean'
    && Array.isArray(value.items) && value.items.length <= MEMORY_CAP && value.items.every(isMemoryItem)
    && (value.profile === null || isLearnerProfile(value.profile));
}

/** 单条宽松修复:能修的修(置信度夹取、证据裁剪、文本截断),修不好的交给 isMemoryItem 判死 */
function repairItem(value: unknown): unknown {
  if (!object(value)) return value;
  const scope = object(value.scope) ? value.scope : {};
  const cleanScope: Record<string, string> = {};
  if (typeof scope.topicId === 'string' && scope.topicId) cleanScope.topicId = scope.topicId;
  if (typeof scope.course === 'string' && scope.course) cleanScope.course = scope.course;
  return {
    ...value,
    scope: cleanScope,
    text: typeof value.text === 'string' ? clipText(value.text) : value.text,
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? clamp01(value.confidence) : value.confidence,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter((e): e is string => typeof e === 'string').map((e) => e.slice(0, 120)).slice(-EVIDENCE_MAX)
      : value.evidence,
    seenCount: typeof value.seenCount === 'number' && Number.isFinite(value.seenCount)
      ? Math.max(0, Math.round(value.seenCount)) : value.seenCount,
    pinned: value.pinned === true,
    muted: value.muted === true,
    ...(value.contradictionKey === null ? { contradictionKey: undefined } : {}),
  };
}

/** 远端/存档中的记忆切片净化:非对象返回 null;畸形条目丢弃、数值夹取、去重、封顶 80、paused 归布尔 */
export function sanitizeMemoryState(value: unknown): MemoryState | null {
  if (!object(value)) return null;
  const seen = new Set<string>();
  const items: MemoryItem[] = [];
  if (Array.isArray(value.items)) {
    for (const raw of value.items) {
      const fixed = repairItem(raw);
      if (!isMemoryItem(fixed) || seen.has(fixed.id)) continue;
      seen.add(fixed.id);
      items.push(fixed);
    }
  }
  const latest = items.reduce<string | null>((max, it) => (max === null || it.updatedAt > max ? it.updatedAt : max), null);
  return {
    items: capItems(items, latest ?? '1970-01-01T00:00:00.000Z'),
    profile: isLearnerProfile(value.profile) ? value.profile : null,
    paused: value.paused === true,
    version: 1,
  };
}

/** 两份记忆切片的确定性合并:按 id 取 updatedAt 新者(平手取固定者、再取未隐藏者),画像取新,paused 取后者 */
export function mergeMemoryStates(states: MemoryState[]): MemoryState | undefined {
  if (states.length === 0) return undefined;
  const byId = new Map<string, MemoryItem>();
  for (const state of states) {
    for (const it of state.items) {
      const cur = byId.get(it.id);
      byId.set(it.id, cur ? newerItem(cur, it) : it);
    }
  }
  const items = [...byId.values()];
  const latest = items.reduce<string | null>((max, it) => (max === null || it.updatedAt > max ? it.updatedAt : max), null);
  const profile = states.reduce<LearnerProfile | null>((best, s) =>
    s.profile && (!best || s.profile.updatedAt > best.updatedAt) ? s.profile : best, null);
  return {
    items: capItems(items, latest ?? states.at(-1)!.items[0]?.updatedAt ?? '1970-01-01T00:00:00.000Z'),
    profile,
    paused: states.at(-1)!.paused,
    version: 1,
  };
}

/**
 * 同 id 两份的合并:意图字段(text/source/pinned/muted/contradictionKey)取 updatedAt 新者
 * (平手取固定者、再取未隐藏者);观察字段(lastSeenAt/seenCount/confidence/evidence)两边取大/并集,
 * 所以后台的「又见到一次」永远压不掉先生的固定/隐藏,而先生的取消隐藏(会推 updatedAt)照常传播。
 */
export function newerItem(a: MemoryItem, b: MemoryItem): MemoryItem {
  const intent = pickIntent(a, b);
  const other = intent === a ? b : a;
  const newerSeen = a.lastSeenAt >= b.lastSeenAt ? a : b;
  const olderSeen = newerSeen === a ? b : a;
  return {
    ...intent,
    createdAt: a.createdAt < b.createdAt ? a.createdAt : b.createdAt,
    lastSeenAt: newerSeen.lastSeenAt,
    seenCount: Math.max(a.seenCount, b.seenCount),
    confidence: Math.max(a.confidence, b.confidence),
    evidence: mergeEvidence(olderSeen.evidence, newerSeen.evidence),
    ...(intent.contradictionKey === undefined && other.contradictionKey !== undefined
      ? { contradictionKey: other.contradictionKey } : {}),
  };
}

function pickIntent(a: MemoryItem, b: MemoryItem): MemoryItem {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.pinned !== b.pinned) return a.pinned ? a : b;
  if (a.muted !== b.muted) return a.muted ? b : a;
  return a;
}
