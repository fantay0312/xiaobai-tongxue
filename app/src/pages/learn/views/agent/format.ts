/** 助理任务界面的文案与格式化：工具名、参数摘要、结果摘要、时间。 */
import { TOOL_LABELS, WEEKDAY_LABELS, type AgentRun, type ProducedItem, type RunStatus } from '../../../../engine/agent';

type Json = Record<string, unknown>;

export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

export const KIND_LABELS: Record<ProducedItem['kind'], string> = {
  notes: '笔记',
  mindmap: '思维导图',
  quiz: '题目集',
  flashcards: '闪卡',
  todos: '待办',
  writing: '作文与翻译',
  schedule: '定时任务',
};

export const STATUS_META: Record<RunStatus, { label: string; tone: 'accent' | 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  running: { label: '进行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warn' },
  done: { label: '已完成', tone: 'ok' },
  stopped: { label: '已停止', tone: 'neutral' },
  error: { label: '出错', tone: 'bad' },
};

export function parseJson(text: string | undefined): Json | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

export function prettyJson(text: string | undefined): string {
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const size = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const CADENCE_TEXT: Record<string, string> = { once: '一次', daily: '每天', weekly: '每周' };

/** 工具卡片标题右侧的一句参数摘要 */
export function describeCall(name: string, argsJson: string): string {
  const args = parseJson(argsJson) ?? {};
  const title = str(args.title);
  switch (name) {
    case 'save_note':
    case 'review_essay':
    case 'translate_text':
      return title;
    case 'create_mindmap':
      return [title, size(args.outline) ? `${size(args.outline)} 个分支` : ''].filter(Boolean).join(' · ');
    case 'create_quiz_set':
      return [title, size(args.questions) ? `${size(args.questions)} 题` : ''].filter(Boolean).join(' · ');
    case 'create_flashcards':
      return [title, size(args.cards) ? `${size(args.cards)} 张` : ''].filter(Boolean).join(' · ');
    case 'add_todos':
      return size(args.items) ? `${size(args.items)} 项` : '';
    case 'search_materials':
      return str(args.query) ? `「${str(args.query)}」` : '';
    case 'read_material':
      return str(args.source_id) ? `${str(args.source_id)}${Number(args.offset) > 0 ? ` · 从第 ${Number(args.offset)} 字` : ''}` : '资料目录';
    case 'spawn_subagents':
      return size(args.tasks) ? `${size(args.tasks)} 个子代理并行` : '';
    case 'schedule_task':
      return [title, `${CADENCE_TEXT[str(args.cadence)] ?? ''} ${str(args.time)}`.trim()].filter(Boolean).join(' · ');
    case 'update_goal': {
      const items = Array.isArray(args.items) ? args.items : [];
      const done = items.filter((item) => item && typeof item === 'object' && (item as Json).done === true).length;
      return items.length ? `${done}/${items.length} 项完成` : '';
    }
    default:
      return '';
  }
}

/** 工具卡片下方的一句结果摘要；没有值得说的就返回空串 */
export function describeResult(name: string, resultJson: string | undefined): string {
  const result = parseJson(resultJson);
  if (!result) return resultJson && resultJson.length < 80 ? resultJson : '';
  if (result.ok === false) return str(result.error) || '执行失败';
  switch (name) {
    case 'search_materials': {
      const hits = Array.isArray(result.hits) ? (result.hits as Json[]) : [];
      if (!hits.length) return str(result.note) || '没有命中';
      const titles = [...new Set(hits.map((hit) => str(hit.title)).filter(Boolean))].slice(0, 3);
      return `命中 ${hits.length} 段 · ${titles.join('、')}`;
    }
    case 'read_material':
      if (Array.isArray(result.sources)) return `共 ${result.sources.length} 份资料`;
      return `${str(result.title)} · 读了 ${str(result.text).length} 字${result.has_more ? '，后面还有' : ''}`;
    case 'list_workbench':
      return `笔记 ${size(result.notes)} · 导图 ${size(result.mindmaps)} · 题目集 ${size(result.quiz_sets)} · 闪卡 ${size(result.decks)} · 待办 ${size(result.open_todos)}`;
    case 'create_quiz_set':
      return Number(result.dropped) > 0 ? `已写入 ${Number(result.questions)} 题，${Number(result.dropped)} 题格式不合规被丢弃` : '';
    case 'schedule_task':
      return `${str(result.when)} · 只在应用打开时执行`;
    default:
      return '';
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

export function clockTime(iso: string): string {
  const at = new Date(iso);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function dayLabel(at: Date, base = new Date()): string {
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(at) - start(base)) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  if (diff > 1 && diff < 7) return WEEKDAY_LABELS[at.getDay()];
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日`;
}

/** 今天 08:00 / 明天 20:30 / 10 月 16 日 09:00 */
export function dayTime(iso: string): string {
  const at = new Date(iso);
  return `${dayLabel(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return dayTime(iso);
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

export function tokenText(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`;
}

/** 目标清单进度 */
export function goalProgress(run: AgentRun) {
  const done = run.checklist.filter((item) => item.done).length;
  return { done, total: run.checklist.length };
}
