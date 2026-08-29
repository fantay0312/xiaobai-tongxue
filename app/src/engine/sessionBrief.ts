/**
 * 课堂小本本(session brief):一场课里小白的结构化随堂笔记(Anthropic "structured note-taking" 式)。
 * 纯函数、Node 安全、不进 engine barrel;每轮由 store / simulate / livetest 派生一次再传给评估器与渲染器。
 * 纪律:
 *  - 给小白的渲染只用已命中要点的 point 名(它们本来就在认知白名单里),永不含 groundTruth;
 *  - 老师原话只进评估器的 user JSON(lastTeacherLine),绝不进小白的系统提示(那是注入通道);
 *  - mock 路径完全忽略本模块(模板确定性由 simulate 证明)。
 */
import type { ChatMessage, Topic, TopicState, TurnTrace, XiaobaiMood } from '../types';
import { XIAOBAI_EXAM_READY_LINE } from '../data/xiaobaiLines';
import { DEFLECTION_LINE } from './guard';

export interface SessionBrief {
  /** 本轮轮次(1 起,= traces.length + 1) */
  turn: number;
  /** 已讲明白的要点名,按老师讲到的先后 */
  understood: string[];
  /** 待判定误区的观点原文(= 待判定 mcId 的 belief) */
  currentBelief: string | null;
  /** 小白自己上一句问的问题(去掉送考提示;取最后一个问句) */
  lastQuestion: string | null;
  /** 老师上一轮讲解(不含本轮);只给评估器 */
  lastTeacherLine: string | null;
  stuckStreak: number;
  rescueLevel: number;
  /** 最近 3 条小白消息的心情 */
  recentMoods: XiaobaiMood[];
  teacherStyle: { avgChars: number; usesExamples: boolean; usesCode: boolean };
}

const EXAMPLE_MARKERS = ['就像', '好比', '比如', '打个比方', '相当于', '类似于', '就好像', '例如', '举个例子'];
const CODE_RE = /```|[=(){};[\]]|\b(?:def|return|print|for|while|if|class|import|const|let|var)\b/;
const MAX_QUESTION_CHARS = 60;

/** 取文本里最后一个问句(从上一个句末标点到问号);没有问号则整句 */
function lastQuestionClause(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const end = Math.max(normalized.lastIndexOf('?'), normalized.lastIndexOf('？'));
  if (end < 0) return normalized;
  let start = end - 1;
  while (start >= 0 && !/[。!！?？\n]/.test(normalized[start])) start -= 1;
  return normalized.slice(start + 1, end + 1).trim();
}

/** 被入口守门拦截的老师发言:显式 blocked 标记,或(旧会话/simulate 无标记时)后一条正是小白的婉拒台词 */
export function isBlockedTeacherMessage(messages: ChatMessage[], index: number): boolean {
  const m = messages[index];
  if (m.role !== 'teacher') return false;
  if (m.blocked) return true;
  const next = messages[index + 1];
  return next?.role === 'xiaobai' && next.text === DEFLECTION_LINE;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function deriveSessionBrief(input: {
  topic: Topic;
  state: TopicState;
  /** 本场对话,含本轮老师发言(若已产生) */
  messages: ChatMessage[];
  traces: TurnTrace[];
  pendingMcId: string | null;
}): SessionBrief {
  const { topic, state, messages, traces, pendingMcId } = input;
  const pointOf = (id: string) => topic.checklist.find((c) => c.id === id)?.point ?? null;
  // hitChecklist 由事件流按 checklist_hit 先后追加,本身就是老师讲到的顺序
  const understood = state.hitChecklist
    .map(pointOf)
    .filter((p): p is string => p !== null);

  const mc = pendingMcId ? topic.misconceptions.find((m) => m.mcId === pendingMcId) : undefined;

  const xiaobaiLines = messages.filter((m) => m.role === 'xiaobai' && m.text !== XIAOBAI_EXAM_READY_LINE);
  const lastXiaobai = xiaobaiLines[xiaobaiLines.length - 1];
  const lastQuestion = lastXiaobai ? clip(lastQuestionClause(lastXiaobai.text), MAX_QUESTION_CHARS) : null;

  // 守门拦截过的老师发言(打了 blocked,或紧跟着小白的婉拒台词)不算讲解:不进 lastTeacherLine 与讲法统计
  const teacherLines = messages.filter((m, i) => m.role === 'teacher' && !isBlockedTeacherMessage(messages, i));
  // 末条若是老师(= 本轮发言),"上一轮"取它前面那条
  const isCurrentTeacher = messages.length > 0 && messages[messages.length - 1].role === 'teacher';
  const previousTeacher = isCurrentTeacher ? teacherLines[teacherLines.length - 2] : teacherLines[teacherLines.length - 1];
  const lastTeacherLine = previousTeacher?.text.trim() || null;

  const recentMoods = messages
    .filter((m) => m.role === 'xiaobai' && m.mood !== undefined)
    .slice(-3)
    .map((m) => m.mood as XiaobaiMood);

  const teacherTexts = teacherLines.map((m) => m.text.trim()).filter(Boolean);
  const avgChars = teacherTexts.length
    ? Math.round(teacherTexts.reduce((sum, t) => sum + t.length, 0) / teacherTexts.length)
    : 0;
  const usesExamples = teacherTexts.some((t) => EXAMPLE_MARKERS.some((m) => t.includes(m)));
  const usesCode = teacherTexts.some((t) => CODE_RE.test(t));

  return {
    turn: traces.length + 1,
    understood,
    currentBelief: mc?.belief ?? null,
    lastQuestion,
    lastTeacherLine,
    stuckStreak: state.stuckStreak,
    rescueLevel: state.rescueLevel,
    recentMoods,
    teacherStyle: { avgChars, usesExamples, usesCode },
  };
}

export const SESSION_BRIEF_HEADER =
  '【这堂课到现在】(这是你脑子里的小本本,只用来决定怎么接话;不要把这些句子念出来,不要向老师汇报你听懂了什么,除非本轮任务要你复述)';

/**
 * 渲染给小白系统提示的私人笔记行。只出:已懂要点名 / 「别重复上一问」的提醒 / 卡壳与情绪的软提醒 / 老师讲法的固定短语。
 * 永不出 lastTeacherLine(老师原话不得进 system)、不引用 lastQuestion 原文(小白上一句可被老师口授,也是注入通道)、
 * 不出 currentBelief(已在【你当前坚信的观点】)、不出数字。
 * teacherStyle 行只在没有学伴记忆提示时出(记忆 HINT_BY_KEY 已覆盖同一信息,避免同一提示里两处打架)。
 * 每行再过 bannedTerms 闸门(与 renderer 的严禁清单同源),含未教术语的行整行丢弃。
 * 一行都没有时返回 []:调用方据此省掉整块。
 */
export function renderSessionBriefForXiaobai(
  brief: SessionBrief,
  opts: { hasMemoryHints?: boolean; bannedTerms?: readonly string[] } = {},
): string[] {
  const banned = opts.bannedTerms ?? [];
  const lines: string[] = [];
  if (brief.turn >= 2) lines.push(`- 这是第 ${brief.turn} 轮。`);
  if (brief.understood.length > 0) {
    lines.push(`- 老师已经给你讲明白的:${brief.understood.slice(-5).join('、')}。`);
  }
  // 不引用 lastQuestion 原文:它是模型自己的上一句,老师可以口授(「跟我念一遍……」),原样进 system 就是二阶注入通道;
  // 原句已经作为最后一条「小白:」出现在 user 消息里,这里只留提醒。
  if (brief.lastQuestion) {
    lines.push('- 别把你上一问原样再问一遍,顺着老师的回答往下接。');
  }
  if (brief.stuckStreak >= 2) lines.push('- 老师刚才卡了好几次:这轮说话放软,一次只问一个小问题。');
  const moods = brief.recentMoods.slice(-2);
  if (moods.length === 2 && moods.every((m) => m === 'confused')) {
    lines.push('- 你已经连着两轮说不懂了:这轮换个说法,别再叠一句"我不懂"。');
  }
  if (!opts.hasMemoryHints) {
    if (brief.teacherStyle.usesExamples) lines.push('- 老师讲课爱举例子。');
    if (brief.teacherStyle.usesCode) lines.push('- 老师爱拿代码说事。');
    if (brief.teacherStyle.avgChars > 0 && brief.teacherStyle.avgChars < 25) lines.push('- 老师说话很短,一句一个点。');
  }
  const safe = lines.filter((line) => !banned.some((t) => t && line.includes(t)));
  return safe.length ? [SESSION_BRIEF_HEADER, ...safe] : [];
}

/** 评估器 user JSON 追加的两个键(紧跟"老师本轮讲解");老师上一轮讲解只作上下文,截 300 字 */
export function renderSessionBriefForEvaluator(brief: SessionBrief): {
  课堂轮次: number;
  老师上一轮讲解: string | null;
} {
  return {
    课堂轮次: brief.turn,
    老师上一轮讲解: brief.lastTeacherLine ? brief.lastTeacherLine.slice(0, 300) : null,
  };
}
