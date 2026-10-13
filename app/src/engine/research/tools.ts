/**
 * 科研助手的工具集：每个工具有 JSON Schema，返回给模型一段紧凑的 JSON，同时给时间线一份可展开的展示数据。
 * 连接器或 Python 不可用时如实返回失败，不伪造检索结果或运行输出。
 */
import type { ToolCall, ToolSpec } from '../../lib/modelGateway';
import { listLibrary, readLibrarySources } from '../../lib/fileLibrary';
import {
  PAPER_SOURCE_LABELS, getPaper, searchPapers, toBibtex,
  type Paper, type PaperDetail, type PaperSource,
} from '../../lib/researchConnectors';
import { researchStore } from '../../store/researchStore';
import { newId } from '../../store/studyData';
import { logActivity } from '../activityLog';
import type { ToolOutcome } from '../agent/tools';
import { isAbortError } from '../agent/loop';
import { runProjectPython } from './python';
import type { PaperRow, PlanItem, PlanProposal, PlanStatus, ToolView, WorkerLane } from './types';
import { WorkspaceError, deleteFile, fileExists, formatBytes, listFiles, normalizePath, readFile, writeFile } from './workspace';

/* ───────── 契约 ───────── */

export interface FinalPayload {
  text: string;
  files: { path: string; exists: boolean }[];
  sources: { label: string; verified: boolean; url?: string }[];
}

export interface ResearchOutcome extends ToolOutcome {
  view?: ToolView;
  denied?: boolean;
  final?: FinalPayload;
}

/** risky = 高风险（「仅高风险询问」也要问）；step = 普通步骤（只有「每步询问」才问） */
export interface GateRequest {
  tool: string;
  level: 'risky' | 'step';
  /** 权限键；全部已获准就不再问 */
  keys: string[];
  title: string;
  detail: string;
  /** 允许一次也记住（文献来源：问过就不算新来源了） */
  sticky?: boolean;
}

export type GateDecision = { allowed: true } | { allowed: false; reason: string };

export interface WorkerTask {
  title: string;
  brief: string;
}

export interface ToolContext {
  owner: string | null;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  turn: number;
  actor: 'agent' | 'worker';
  signal: AbortSignal;
  /** 本会话取回过的文献，save_paper 与 finish 据此核对 */
  retrieved: Map<string, Paper>;
  gate: (request: GateRequest) => Promise<GateDecision>;
  /* 以下只有主助手有 */
  setPlan?: (items: PlanItem[]) => void;
  ask?: (question: string, options: string[]) => Promise<string>;
  spawn?: (tasks: WorkerTask[], report: (lanes: WorkerLane[]) => void) => Promise<ResearchOutcome>;
  proposePlan?: (plan: PlanProposal) => void;
  setGoal?: (goal: { objective: string; criteria: string[] }) => void;
  /** 运行中的实时输出 */
  onLive?: (text: string) => void;
  onLanes?: (lanes: WorkerLane[]) => void;
}

/* ───────── Schema ───────── */

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const SOURCES = Object.keys(PAPER_SOURCE_LABELS) as PaperSource[];

const SPECS: ToolSpec[] = [
  {
    name: 'update_plan',
    description: '写下或更新你的计划清单（会置顶显示给用户）。每次传完整清单；同一时间只有一项是 active。开始做非一句话能答的任务前先调用，之后每完成一步更新一次。',
    parameters: obj({
      items: {
        type: 'array', minItems: 1, maxItems: 12,
        items: obj({ text: str('这一步做什么，一句话'), status: { type: 'string', enum: ['pending', 'active', 'done', 'skipped'] } }, ['text', 'status']),
      },
    }, ['items']),
  },
  {
    name: 'search_papers',
    description: '在学术来源里检索文献，返回标题、作者、年份、摘要、DOI、被引量。检索式用英文关键词通常效果更好。查不到就换检索式，不要编造。',
    parameters: obj({
      query: str('检索式，如 "graph neural network traffic forecasting"'),
      sources: { type: 'array', items: { type: 'string', enum: SOURCES }, description: '限定来源；不传则由连接器选默认来源并合并去重' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回多少篇，默认 8' },
      year_from: { type: 'integer', description: '起始年份' },
      year_to: { type: 'integer', description: '截止年份' },
      open_access_only: { type: 'boolean', description: '只要有开放全文的' },
    }, ['query']),
  },
  {
    name: 'read_paper',
    description: '读一篇文献：摘要，以及能取到的开放获取正文（按字数分段返回，结果里会注明是否只有摘要、是否被截断）。id 用 search_papers 返回的 id、DOI 或 arXiv 号。',
    parameters: obj({
      id: str('文献 id、DOI 或 arXiv 号'),
      offset: { type: 'integer', minimum: 0, description: '从正文第几个字开始读，默认 0' },
      limit: { type: 'integer', minimum: 1000, maximum: 12000, description: '这次最多读多少字，默认 10000' },
    }, ['id']),
  },
  {
    name: 'save_paper',
    description: '把一篇检索到的文献存入课题的文献列表，并更新 references.bib。只能保存本次会话实际检索到或读过的文献。',
    parameters: obj({ id: str('文献 id、DOI 或 arXiv 号'), note: str('一句话：这篇为什么相关、打算怎么用') }, ['id']),
  },
  {
    name: 'list_files',
    description: '列出课题文件（路径、大小、修改时间）。',
    parameters: obj({ dir: str('只看某个目录，如 data/；不传则列全部') }),
  },
  {
    name: 'read_file',
    description: '读课题里的一个文本文件。长文件分段返回，结果里注明总字数与本次范围。',
    parameters: obj({
      path: str('相对路径，如 notes/screening.md'),
      offset: { type: 'integer', minimum: 0, description: '从第几个字开始，默认 0' },
      limit: { type: 'integer', minimum: 500, maximum: 12000, description: '最多读多少字，默认 10000' },
    }, ['path']),
  },
  {
    name: 'write_file',
    description: '写入整份文本文件（新建或覆盖）。用于笔记、综述、报告、CSV、代码。覆盖已有文件前想清楚是否该用 edit_file。内容很长时拆成几个文件。',
    parameters: obj({ path: str('相对路径，如 survey.md、notes/topics.md、data/results.csv'), content: str('文件的完整内容') }, ['path', 'content']),
  },
  {
    name: 'edit_file',
    description: '把文件里的一段文字精确替换成另一段。old_string 必须与文件内容逐字一致且只出现一次（否则加长上下文，或传 replace_all）。',
    parameters: obj({
      path: str('相对路径'),
      old_string: str('要被替换的原文，逐字一致'),
      new_string: str('替换成的新内容'),
      replace_all: { type: 'boolean', description: '替换全部出现处' },
    }, ['path', 'old_string', 'new_string']),
  },
  {
    name: 'delete_file',
    description: '删除课题里的一个文件。不可恢复，只在确有必要时用。',
    parameters: obj({ path: str('相对路径') }, ['path']),
  },
  {
    name: 'run_python',
    description: '在用户浏览器里的 Python 环境运行一段代码。课题的 data/ 与 code/ 已挂载在工作目录（用相对路径读写）。print 的内容、报错、matplotlib 画的图都会返回；代码写出的文件和图会存回课题（图在 figures/）。只有 numpy、pandas、scipy、matplotlib 和标准库，不能联网。',
    parameters: obj({
      code: str('要运行的完整 Python 代码'),
      save_as: str('同时把这段代码存成课题文件，如 code/analysis.py（最终版脚本应当保存）'),
      timeout_s: { type: 'integer', minimum: 5, maximum: 180, description: '超时秒数，默认 60' },
    }, ['code']),
  },
  {
    name: 'read_library_file',
    description: '读取用户资料库里已解析的文档正文。不传 file 时返回资料库的文件列表。',
    parameters: obj({ file: str('文件名或文件 id'), query: str('想重点找的内容，用来挑相关片段') }),
  },
  {
    name: 'spawn_workers',
    description: '把 2–4 件互不依赖的检索或阅读子任务交给并行助手。每个助手只有检索、读文献、看课题文件的能力，各自返回一段小结和用到的文献。写文件由你来做。',
    parameters: obj({
      tasks: {
        type: 'array', minItems: 2, maxItems: 4,
        items: obj({ title: str('子任务标题'), brief: str('任务书：查什么、关注什么、交回什么') }, ['title', 'brief']),
      },
    }, ['tasks']),
  },
  {
    name: 'ask_user',
    description: '暂停并向用户问一个具体问题（范围、数据、取舍）。能合理假设时不要问。',
    parameters: obj({ question: str('要问的问题，一句话'), options: { type: 'array', items: { type: 'string' }, maxItems: 4, description: '可选：给出 2–4 个选项' } }, ['question']),
  },
  {
    name: 'finish',
    description: '任务完成（或已尽力而为）时调用，结束这一轮。',
    parameters: obj({
      summary: str('给用户的最终说明：做了什么、主要结论、局限与下一步。Markdown，简短'),
      files: { type: 'array', items: { type: 'string' }, description: '本轮产出或修改的文件路径' },
      sources: { type: 'array', items: { type: 'string' }, description: '实际用到的文献，每条写「作者 年份. 标题. DOI 或 arXiv 号」' },
    }, ['summary']),
  },
  {
    name: 'propose_plan',
    description: '（计划模式）提交计划书，等待用户批准或修改。提交后本轮结束。',
    parameters: obj({
      objective: str('一句话目标'),
      steps: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10, description: '具体步骤' },
      sources: { type: 'array', items: { type: 'string' }, description: '打算检索的来源与检索式，或要用的课题文件' },
      outputs: { type: 'array', items: { type: 'string' }, description: '预期产出的文件路径' },
      risks: { type: 'array', items: { type: 'string' }, description: '风险、假设与做不到的地方' },
    }, ['objective', 'steps']),
  },
  {
    name: 'set_goal',
    description: '设定课题目标与验收标准。',
    parameters: obj({
      objective: str('课题目标，一两句话'),
      criteria: { type: 'array', items: { type: 'string' }, maxItems: 8, description: '可检验的验收标准' },
    }, ['objective']),
  },
];

const WORKER_FINISH: ToolSpec = {
  name: 'finish',
  description: '子任务做完后调用，把结果交回主助手。',
  parameters: obj({
    summary: str('3–6 句结论'),
    findings: { type: 'array', items: { type: 'string' }, description: '要点，每条尽量带出处' },
    sources: { type: 'array', items: { type: 'string' }, description: '实际用到的文献：作者 年份 标题 DOI或arXiv号' },
  }, ['summary']),
};

export const MAIN_TOOLS = [
  'update_plan', 'search_papers', 'read_paper', 'save_paper', 'list_files', 'read_file', 'write_file', 'edit_file', 'delete_file',
  'run_python', 'read_library_file', 'spawn_workers', 'ask_user', 'finish',
] as const;
export const PLAN_TOOLS = ['list_files', 'read_file', 'ask_user', 'propose_plan'] as const;
export const GOAL_TOOLS = ['list_files', 'ask_user', 'set_goal'] as const;
export const WORKER_TOOLS = ['search_papers', 'read_paper', 'list_files', 'read_file', 'finish'] as const;

export function toolSpecs(names: readonly string[], worker = false): ToolSpec[] {
  return names.flatMap((name) => {
    if (worker && name === 'finish') return [WORKER_FINISH];
    const spec = SPECS.find((item) => item.name === name);
    return spec ? [spec] : [];
  });
}

/* ───────── 小件 ───────── */

type Args = Record<string, unknown>;

const ok = (data: Record<string, unknown>, extra: Partial<ResearchOutcome> = {}): ResearchOutcome => ({ content: JSON.stringify({ ok: true, ...data }), ...extra });
const fail = (error: string, extra: Partial<ResearchOutcome> = {}, data: Record<string, unknown> = {}): ResearchOutcome => ({ content: JSON.stringify({ ok: false, error, ...data }), error: true, ...extra });
const denied = (reason: string): ResearchOutcome => ({
  content: JSON.stringify({ ok: false, denied: true, error: '用户没有批准这一步', reason: reason || '未说明理由' }),
  error: true,
  denied: true,
});

const text = (value: unknown, max = 4000): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
};
const list = (value: unknown, max: number, itemMax = 400): string[] =>
  (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim().slice(0, itemMax)).slice(0, max) : []);
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
/** 本地时间的「月-日 时:分」，给模型看文件新旧 */
const localStamp = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message.slice(0, 200) : fallback);

function provenance(ctx: ToolContext, tool: string) {
  return { actor: ctx.actor, tool, sessionId: ctx.sessionId, sessionTitle: ctx.sessionTitle, turn: ctx.turn } as const;
}

/* ───────── 文献 ───────── */

const normalizeId = (id: string) => id.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, 'arxiv:').replace(/\.pdf$/, '');

export function rememberPaper(retrieved: Map<string, Paper>, paper: Paper) {
  retrieved.set(normalizeId(paper.id), paper);
  if (paper.doi) retrieved.set(normalizeId(paper.doi), paper);
}

function findPaper(retrieved: Map<string, Paper>, id: string): Paper | undefined {
  const key = normalizeId(id);
  return retrieved.get(key) ?? retrieved.get(`arxiv:${key}`) ?? retrieved.get(key.replace(/^arxiv:/, ''));
}

export function paperRow(paper: Paper, abstractMax = 320): PaperRow {
  return {
    id: paper.id,
    source: paper.source,
    title: clip(paper.title, 240),
    authors: paper.authors.slice(0, 8).map((author) => clip(author, 60)),
    ...(paper.year ? { year: paper.year } : {}),
    ...(paper.venue ? { venue: clip(paper.venue, 120) } : {}),
    ...(paper.doi ? { doi: paper.doi } : {}),
    url: paper.url,
    ...(paper.openAccessUrl ? { openAccessUrl: paper.openAccessUrl } : {}),
    ...(typeof paper.citedBy === 'number' ? { citedBy: paper.citedBy } : {}),
    ...(paper.abstract ? { abstract: clip(paper.abstract.replace(/\s+/g, ' '), abstractMax) } : {}),
  };
}

const authorLine = (authors: string[]) => (authors.length > 4 ? `${authors.slice(0, 4).join(', ')} 等` : authors.join(', '));

/** 课题文献列表里一篇文献的一行说明（进系统提示，也用来核对 finish 的来源） */
export function paperLine(paper: Paper): string {
  return `${authorLine(paper.authors) || '佚名'} ${paper.year ?? 'n.d.'}. ${clip(paper.title, 140)}. ${paper.doi ? `doi:${paper.doi}` : paper.id}`;
}

function bibKey(paper: Paper, used: Set<string>): string {
  const family = (paper.authors[0] ?? 'anon').trim().split(/\s+/).pop() ?? 'anon';
  const word = paper.title.split(/[^A-Za-z]+/).find((part) => part.length > 3) ?? 'paper';
  const base = `${family}${paper.year ?? ''}${word}`.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'ref';
  let key = base;
  for (let index = 2; used.has(key); index += 1) key = `${base}${index}`;
  used.add(key);
  return key;
}

/** 连接器没给 BibTeX 时在本地按已有字段生成（只用取回的字段，不补全缺失信息） */
export function localBibtex(papers: Paper[]): string {
  const used = new Set<string>();
  const escape = (value: string) => value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return papers.map((paper) => {
    const preprint = paper.source === 'arxiv' || /^arxiv:/i.test(paper.id);
    const fields: [string, string | undefined][] = [
      ['title', `{${escape(paper.title)}}`],
      ['author', paper.authors.length ? paper.authors.map(escape).join(' and ') : undefined],
      ['year', paper.year ? String(paper.year) : undefined],
      [preprint ? 'howpublished' : 'journal', paper.venue ? escape(paper.venue) : preprint ? 'arXiv preprint' : undefined],
      ['doi', paper.doi],
      ['eprint', preprint ? paper.id.replace(/^arxiv:/i, '') : undefined],
      ['url', paper.url],
    ];
    const body = fields.filter((field): field is [string, string] => !!field[1]).map(([name, value]) => `  ${name} = {${value}}`).join(',\n');
    return `@${preprint ? 'misc' : 'article'}{${bibKey(paper, used)},\n${body}\n}`;
  }).join('\n\n');
}

async function rewriteBib(ctx: ToolContext): Promise<void> {
  const papers = researchStore.papers(ctx.owner, ctx.projectId);
  let bib = '';
  try {
    bib = toBibtex(papers);
  } catch {
    bib = '';
  }
  if (!bib.trim()) bib = localBibtex(papers);
  await writeFile(ctx.owner, ctx.projectId, { path: 'references.bib', content: `${bib.trim()}\n`, provenance: provenance(ctx, 'save_paper') });
}

async function searchTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const query = text(args.query, 300);
  if (!query) return fail('缺少检索式 query');
  const sources = (Array.isArray(args.sources) ? args.sources : []).filter((item): item is PaperSource => SOURCES.includes(item as PaperSource));
  const decision = await ctx.gate({
    tool: 'search_papers',
    level: 'risky',
    sticky: true,
    keys: (sources.length ? sources : ['default']).map((source) => `net:${source}`),
    title: `检索文献：${clip(query, 80)}`,
    detail: `将通过文献连接器访问${sources.length ? sources.map((source) => PAPER_SOURCE_LABELS[source]).join('、') : '默认学术来源（OpenAlex 等）'}，发送的只有检索式。`,
  });
  if (!decision.allowed) return denied(decision.reason);

  let papers: Paper[];
  try {
    papers = await searchPapers({
      query,
      ...(sources.length ? { sources } : {}),
      limit: int(args.limit, 8, 1, 20),
      ...(args.year_from !== undefined ? { yearFrom: int(args.year_from, 1900, 1800, 2100) } : {}),
      ...(args.year_to !== undefined ? { yearTo: int(args.year_to, 2100, 1800, 2100) } : {}),
      ...(args.open_access_only === true ? { openAccessOnly: true } : {}),
      signal: ctx.signal,
    });
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) throw error;
    return fail(`文献检索没有成功：${errorText(error, '连接器没有响应')}`, {}, { hint: '没有取回任何文献。不要凭记忆列举文献；告诉用户检索未成功，或改用课题里已有的材料。' });
  }
  papers.forEach((paper) => rememberPaper(ctx.retrieved, paper));
  return ok({
    query,
    count: papers.length,
    papers: papers.map((paper) => ({
      id: paper.id,
      title: clip(paper.title, 240),
      authors: authorLine(paper.authors),
      year: paper.year,
      venue: paper.venue ? clip(paper.venue, 100) : undefined,
      doi: paper.doi,
      source: paper.source,
      cited_by: paper.citedBy,
      open_access: !!paper.openAccessUrl,
      abstract: paper.abstract ? clip(paper.abstract.replace(/\s+/g, ' '), 520) : undefined,
    })),
    ...(papers.length ? {} : { note: '没有命中。换一组关键词、放宽年份或换来源再试；仍然没有就如实说明。' }),
  }, { view: { kind: 'papers', query, papers: papers.slice(0, 20).map((paper) => paperRow(paper)), total: papers.length } });
}

async function readPaperTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const id = text(args.id, 300);
  if (!id) return fail('缺少文献 id');
  const known = findPaper(ctx.retrieved, id);
  const decision = await ctx.gate({
    tool: 'read_paper',
    level: 'risky',
    sticky: true,
    keys: ['net:fulltext'],
    title: `读取文献：${clip(known?.title ?? id, 80)}`,
    detail: '将通过文献连接器取这篇文献的详情和开放获取的正文。',
  });
  if (!decision.allowed) return denied(decision.reason);

  let detail: PaperDetail;
  try {
    detail = await getPaper(known?.id ?? id, ctx.signal);
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) throw error;
    return fail(`没有读到这篇文献：${errorText(error, '连接器没有响应')}`, {}, {
      hint: known?.abstract ? '只能依据检索结果里的摘要，引用时注明「仅据摘要」。' : '没有取回内容，不要描述这篇文献的细节。',
    });
  }
  rememberPaper(ctx.retrieved, detail);
  const body = (detail.fullText ?? '').trim();
  const offset = int(args.offset, 0, 0, Math.max(0, body.length));
  const limit = int(args.limit, 10000, 1000, 12000);
  const slice = body.slice(offset, offset + limit);
  const more = offset + slice.length < body.length;
  const notes: string[] = [];
  if (!body) notes.push('没有取到开放获取的正文，只有摘要。引用时注明「仅据摘要」，不要描述摘要以外的细节。');
  else {
    notes.push(`正文共 ${body.length} 字，本次返回第 ${offset}–${offset + slice.length} 字。`);
    if (more) notes.push(`后面还有内容，用 offset=${offset + slice.length} 继续读。`);
    if (detail.truncated) notes.push('连接器取回的正文本身不完整（已被截断），末尾之后的内容没有取到。');
  }
  return ok({
    id: detail.id,
    title: detail.title,
    authors: authorLine(detail.authors),
    year: detail.year,
    venue: detail.venue,
    doi: detail.doi,
    has_full_text: !!body,
    truncated: more || !!detail.truncated,
    note: notes.join(''),
    abstract: detail.abstract ? clip(detail.abstract, 3000) : undefined,
    ...(slice ? { text: slice } : {}),
    ...(detail.references?.length && offset === 0 ? { references: detail.references.slice(0, 20).map((ref) => `${ref.title}${ref.year ? ` (${ref.year})` : ''}${ref.doi ? ` doi:${ref.doi}` : ''}`) } : {}),
  }, { view: { kind: 'paper', paper: paperRow(detail, 600), chars: slice.length, fullText: !!body, truncated: more || !!detail.truncated } });
}

async function savePaperTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const id = text(args.id, 300);
  if (!id) return fail('缺少文献 id');
  const paper = findPaper(ctx.retrieved, id) ?? researchStore.papers(ctx.owner, ctx.projectId).find((item) => normalizeId(item.id) === normalizeId(id));
  if (!paper) {
    return fail('这篇文献不在本次会话的检索结果里，不能保存。先用 search_papers 或 read_paper 取回它；取不回就说明没有找到，不要手写条目。');
  }
  const decision = await ctx.gate({ tool: 'save_paper', level: 'step', keys: ['tool:save_paper'], title: `保存文献：${clip(paper.title, 80)}`, detail: '加入课题的文献列表，并更新 references.bib。' });
  if (!decision.allowed) return denied(decision.reason);
  const note = text(args.note, 300);
  // 只存书目信息，正文不进列表
  const { fullText: _fullText, truncated: _truncated, references: _references, ...plain } = paper as PaperDetail;
  researchStore.savePaper(ctx.owner, ctx.projectId, { ...plain, abstract: plain.abstract ? clip(plain.abstract, 1200) : undefined, savedAt: new Date().toISOString(), ...(note ? { note } : {}), sessionId: ctx.sessionId });
  try {
    await rewriteBib(ctx);
  } catch (error) {
    return fail(`文献已加入列表，但 references.bib 没有写成：${errorText(error, '保存失败')}`);
  }
  const project = researchStore.getProject(ctx.owner, ctx.projectId);
  logActivity(ctx.owner, {
    source: 'research',
    signal: 'interest',
    summary: `在科研课题《${project?.title ?? '未命名'}》保存文献《${clip(paper.title, 60)}》`,
    detail: `${authorLine(paper.authors)} ${paper.year ?? ''} ${paper.doi ? `doi:${paper.doi}` : paper.id}${note ? `；${note}` : ''}`,
    ref: { kind: 'research-project', id: ctx.projectId, title: project?.title },
  });
  const total = researchStore.papers(ctx.owner, ctx.projectId).length;
  return ok({ saved: paper.id, title: clip(paper.title, 160), total, bib: 'references.bib' }, { view: { kind: 'saved', paper: paperRow(paper), total } });
}

/* ───────── 文件 ───────── */

function listFilesTool(args: Args, ctx: ToolContext): ResearchOutcome {
  const dir = text(args.dir, 120).replace(/^\.?\/+/, '').replace(/\/+$/, '');
  const files = listFiles(ctx.owner, ctx.projectId).filter((file) => !dir || file.path === dir || file.path.startsWith(`${dir}/`));
  return ok({
    count: files.length,
    files: files.slice(0, 200).map((file) => ({ path: file.path, size: formatBytes(file.size), updated: localStamp(file.updatedAt) })),
    ...(files.length ? {} : { note: dir ? '这个目录下没有文件。' : '课题里还没有文件。' }),
  }, { view: { kind: 'files', files: files.slice(0, 200).map((file) => ({ path: file.path, size: file.size })) } });
}

async function readFileTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const path = normalizePath(args.path);
  if (!path) return fail('文件路径不合法');
  const file = await readFile(ctx.owner, ctx.projectId, path);
  if (!file) return fail(`没有这个文件：${path}。用 list_files 看看有哪些文件。`);
  if (file.meta.encoding !== 'utf8') {
    return ok({ path, binary: true, mime: file.meta.mime, size: formatBytes(file.meta.size), note: '这是二进制文件（如图片），不能作为文本读取。图片可在 Markdown 里用相对路径引用；要分析其中的数据请用 run_python。' });
  }
  const offset = int(args.offset, 0, 0, file.content.length);
  const limit = int(args.limit, 10000, 500, 12000);
  const slice = file.content.slice(offset, offset + limit);
  const more = offset + slice.length < file.content.length;
  return ok({
    path,
    total_chars: file.content.length,
    range: [offset, offset + slice.length],
    truncated: more,
    ...(more ? { note: `文件共 ${file.content.length} 字，本次只返回了一部分；用 offset=${offset + slice.length} 继续读。` } : {}),
    content: slice,
  }, { view: { kind: 'read', path, excerpt: clip(slice, 1600), chars: file.content.length, truncated: more } });
}

function contentOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  // 模型有时把 JSON 文件的内容直接给成对象
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return null;
}

async function writeFileTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const path = normalizePath(args.path);
  if (!path) return fail('文件路径不合法：用相对路径，如 notes/summary.md');
  const content = contentOf(args.content);
  if (content === null) return fail('缺少文件内容 content');
  const exists = fileExists(ctx.owner, ctx.projectId, path);
  const decision = await ctx.gate(exists
    ? { tool: 'write_file', level: 'risky', keys: ['tool:write_file:overwrite'], title: `覆盖已有文件：${path}`, detail: `将用 ${content.length} 字的新内容替换整份文件，原内容不可恢复。` }
    : { tool: 'write_file', level: 'step', keys: ['tool:write_file'], title: `新建文件：${path}`, detail: `写入 ${content.length} 字。` });
  if (!decision.allowed) return denied(decision.reason);
  const before = exists ? await readFile(ctx.owner, ctx.projectId, path) : null;
  try {
    const result = await writeFile(ctx.owner, ctx.projectId, { path, content, provenance: provenance(ctx, 'write_file') });
    return ok({ path, action: result.created ? 'created' : 'overwritten', chars: content.length }, {
      view: {
        kind: 'write', path, created: result.created, chars: content.length, after: clip(content, 3000),
        ...(before && before.meta.encoding === 'utf8' ? { before: clip(before.content, 3000) } : {}),
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) return fail(error.message);
    throw error;
  }
}

async function editFileTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const path = normalizePath(args.path);
  if (!path) return fail('文件路径不合法');
  const oldText = typeof args.old_string === 'string' ? args.old_string : '';
  const newText = typeof args.new_string === 'string' ? args.new_string : null;
  if (!oldText || newText === null) return fail('缺少 old_string 或 new_string');
  if (oldText === newText) return fail('old_string 与 new_string 相同，没有可改的内容');
  const file = await readFile(ctx.owner, ctx.projectId, path);
  if (!file) return fail(`没有这个文件：${path}`);
  if (file.meta.encoding !== 'utf8') return fail('这是二进制文件，不能用 edit_file 修改');
  const count = file.content.split(oldText).length - 1;
  if (count === 0) return fail('文件里找不到 old_string。它必须与原文逐字一致（包括空格和换行）；先 read_file 确认原文。');
  if (count > 1 && args.replace_all !== true) return fail(`old_string 在文件里出现了 ${count} 处。加长上下文使它唯一，或传 replace_all: true。`);
  const decision = await ctx.gate({ tool: 'edit_file', level: 'step', keys: ['tool:edit_file'], title: `修改文件：${path}`, detail: `替换 ${count} 处文字。` });
  if (!decision.allowed) return denied(decision.reason);
  const next = args.replace_all === true ? file.content.split(oldText).join(newText) : file.content.replace(oldText, () => newText);
  try {
    await writeFile(ctx.owner, ctx.projectId, { path, content: next, provenance: provenance(ctx, 'edit_file') });
  } catch (error) {
    if (error instanceof WorkspaceError) return fail(error.message);
    throw error;
  }
  return ok({ path, replaced: count, chars: next.length }, { view: { kind: 'edit', path, oldText: clip(oldText, 2000), newText: clip(newText, 2000), count } });
}

async function deleteFileTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const path = normalizePath(args.path);
  if (!path) return fail('文件路径不合法');
  if (!fileExists(ctx.owner, ctx.projectId, path)) return fail(`没有这个文件：${path}`);
  const decision = await ctx.gate({ tool: 'delete_file', level: 'risky', keys: ['tool:delete_file'], title: `删除文件：${path}`, detail: '删除后不可恢复。' });
  if (!decision.allowed) return denied(decision.reason);
  await deleteFile(ctx.owner, ctx.projectId, path);
  return ok({ deleted: path }, { view: { kind: 'delete', path } });
}

/* ───────── Python ───────── */

async function runPythonTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const code = typeof args.code === 'string' ? args.code : '';
  if (!code.trim()) return fail('缺少要运行的代码 code');
  if (code.length > 40_000) return fail('代码太长（超过 4 万字）。拆成几段分别运行。');
  const saveAs = text(args.save_as, 160);
  const decision = await ctx.gate({
    tool: 'run_python',
    level: 'risky',
    keys: ['tool:run_python'],
    title: `运行 Python${saveAs ? `：${saveAs}` : ''}`,
    detail: clip(code.trim(), 900),
  });
  if (!decision.allowed) return denied(decision.reason);

  const run = await runProjectPython(ctx.owner, ctx.projectId, {
    code,
    ...(saveAs ? { saveAs } : {}),
    timeoutMs: int(args.timeout_s, 60, 5, 180) * 1000,
    signal: ctx.signal,
    onStdout: ctx.onLive,
    provenance: { tool: 'run_python', sessionId: ctx.sessionId, sessionTitle: ctx.sessionTitle, turn: ctx.turn },
    author: ctx.actor,
  });
  if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError');
  const { view } = run;
  if (!run.available) {
    return fail(view.error ?? 'Python 运行环境不可用', { view }, {
      ran: false,
      ...(view.savedAs ? { saved_as: view.savedAs } : {}),
      hint: '代码没有运行，没有任何输出。不要报告运行结果；告诉用户脚本尚未运行。',
    });
  }
  const payload = {
    stdout: view.stdout,
    ...(view.stderr ? { stderr: view.stderr } : {}),
    ...(view.result ? { result: view.result } : {}),
    ...(view.error ? { error_trace: view.error } : {}),
    figures: view.figures,
    files_written: view.files,
    duration_ms: view.durationMs,
    ...(view.savedAs ? { saved_as: view.savedAs } : {}),
    ...(run.saveErrors.length ? { save_errors: run.saveErrors } : {}),
  };
  return view.ok
    ? ok(payload, { view })
    : fail('代码运行出错，见 error_trace。修正后重试；不要假设它成功了。', { view }, payload);
}

/* ───────── 资料库 ───────── */

const PARSE_LABELS: Record<string, string> = { completed: '已解析', unparsed: '未解析', failed: '解析失败', cancelled: '已取消' };

async function readLibraryTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  const wanted = text(args.file, 200);
  let entries;
  try {
    entries = (await listLibrary(ctx.signal)).entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt);
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) throw error;
    return fail(`读不到资料库：${errorText(error, '服务没有响应')}（需要登录并连接到服务器）。`);
  }
  if (!wanted) {
    const files = entries.slice(0, 60).map((entry) => ({ id: entry.id, name: entry.name, status: PARSE_LABELS[entry.parse?.status ?? 'unparsed'] ?? '解析中' }));
    return ok({ count: entries.length, files, ...(entries.length ? {} : { note: '资料库里还没有文件。' }) }, { view: { kind: 'libraryList', files } });
  }
  const lower = wanted.toLowerCase();
  const entry = entries.find((item) => item.id === wanted) ?? entries.find((item) => item.name.toLowerCase() === lower) ?? entries.find((item) => item.name.toLowerCase().includes(lower));
  if (!entry) return fail(`资料库里没有找到「${wanted}」。不传 file 可以先看文件列表。`);
  const decision = await ctx.gate({ tool: 'read_library_file', level: 'step', keys: ['tool:read_library_file'], title: `读取资料库文件：${clip(entry.name, 80)}`, detail: '把这份文档的正文读进本次对话。' });
  if (!decision.allowed) return denied(decision.reason);
  try {
    const { sources } = await readLibrarySources([entry.id], text(args.query, 200), ctx.signal);
    const body = sources.map((source) => source.content).join('\n\n').trim();
    if (!body) return fail(`「${entry.name}」没有可读的正文，可能还没解析完成。请用户先在资料库里解析它。`);
    const slice = body.slice(0, 10000);
    const truncated = slice.length < body.length || sources.some((source) => source.limited);
    return ok({
      name: entry.name,
      total_chars: body.length,
      truncated,
      ...(truncated ? { note: `正文共 ${body.length} 字，只返回了前 ${slice.length} 字（或与 query 相关的片段），不是全文。` } : {}),
      content: slice,
    }, { view: { kind: 'library', title: entry.name, excerpt: clip(slice, 1200), chars: body.length, truncated } });
  } catch (error) {
    if (ctx.signal.aborted || isAbortError(error)) throw error;
    return fail(`没有读到「${entry.name}」：${errorText(error, '读取失败')}`);
  }
}

/* ───────── 计划、提问、收尾 ───────── */

const PLAN_STATUSES: PlanStatus[] = ['pending', 'active', 'done', 'skipped'];

function updatePlanTool(args: Args, ctx: ToolContext): ResearchOutcome {
  if (!ctx.setPlan) return fail('这里不能修改计划');
  const raw = Array.isArray(args.items) ? args.items : [];
  const items: PlanItem[] = raw.flatMap((item): PlanItem[] => {
    // 兼容直接给字符串的写法
    if (typeof item === 'string' && item.trim()) return [{ id: newId(), text: item.trim().slice(0, 200), status: 'pending' }];
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const body = text(record.text, 200);
    if (!body) return [];
    const status = PLAN_STATUSES.includes(record.status as PlanStatus) ? (record.status as PlanStatus) : record.done === true ? 'done' : 'pending';
    return [{ id: newId(), text: body, status }];
  }).slice(0, 12);
  if (!items.length) return fail('计划清单是空的：items 里每项要有 text 和 status');
  // 同一时间只留一项进行中
  let seenActive = false;
  for (const item of items) {
    if (item.status !== 'active') continue;
    if (seenActive) item.status = 'pending';
    seenActive = true;
  }
  ctx.setPlan(items);
  const done = items.filter((item) => item.status === 'done').length;
  return ok({ total: items.length, done });
}

async function askUserTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  if (!ctx.ask) return fail('这里不能向用户提问，请自行合理假设并写明假设');
  const question = text(args.question, 400);
  if (!question) return fail('缺少问题 question');
  const answer = await ctx.ask(question, list(args.options, 4, 80));
  return ok({ answer });
}

async function spawnTool(args: Args, ctx: ToolContext): Promise<ResearchOutcome> {
  if (!ctx.spawn) return fail('这里不能派出并行助手');
  const tasks: WorkerTask[] = (Array.isArray(args.tasks) ? args.tasks : []).flatMap((item): WorkerTask[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const title = text(record.title, 60);
    const brief = text(record.brief, 1200);
    return title && brief ? [{ title, brief }] : [];
  }).slice(0, 4);
  if (tasks.length < 2) return fail('并行助手至少要 2 个子任务（每个有 title 和 brief）。只有一件事就自己做。');
  const decision = await ctx.gate({
    tool: 'spawn_workers', level: 'step', keys: ['tool:spawn_workers'],
    title: `派出 ${tasks.length} 个并行助手`,
    detail: tasks.map((task, index) => `${index + 1}. ${task.title}`).join('\n'),
  });
  if (!decision.allowed) return denied(decision.reason);
  return ctx.spawn(tasks, (lanes) => ctx.onLanes?.(lanes));
}

function verifySource(label: string, known: Paper[]): { label: string; verified: boolean; url?: string } {
  const lower = label.toLowerCase();
  const match = known.find((paper) => (paper.doi && lower.includes(paper.doi.toLowerCase()))
    || lower.includes(normalizeId(paper.id).replace(/^arxiv:/, ''))
    || (paper.title.length > 12 && lower.includes(paper.title.toLowerCase().slice(0, 40))));
  return { label: clip(label, 300), verified: !!match, ...(match ? { url: match.url } : {}) };
}

function finishTool(args: Args, ctx: ToolContext): ResearchOutcome {
  const summary = text(args.summary, 6000);
  if (ctx.actor === 'worker') {
    return { content: JSON.stringify({ ok: true }), finish: JSON.stringify({ summary, findings: list(args.findings, 10, 400), sources: list(args.sources, 12, 300) }) };
  }
  const files = list(args.files, 30, 160).map((item) => {
    const path = normalizePath(item) ?? item;
    return { path, exists: fileExists(ctx.owner, ctx.projectId, path) };
  });
  const known = [...new Set([...ctx.retrieved.values(), ...researchStore.papers(ctx.owner, ctx.projectId)])];
  const sources = list(args.sources, 40, 400).map((label) => verifySource(label, known));
  const final: FinalPayload = { text: summary || '这一轮已结束。', files, sources };
  return { content: JSON.stringify({ ok: true }), finish: final.text, final };
}

function proposePlanTool(args: Args, ctx: ToolContext): ResearchOutcome {
  if (!ctx.proposePlan) return fail('现在不在计划模式');
  const objective = text(args.objective, 400);
  const steps = list(args.steps, 10, 300);
  if (!objective || steps.length < 2) return fail('计划书至少要有 objective 和 2 个 steps');
  ctx.proposePlan({ objective, steps, sources: list(args.sources, 8, 240), outputs: list(args.outputs, 10, 160), risks: list(args.risks, 8, 240) });
  return { content: JSON.stringify({ ok: true, note: '计划已提交，等待用户批准。' }), finish: '' };
}

function setGoalTool(args: Args, ctx: ToolContext): ResearchOutcome {
  if (!ctx.setGoal) return fail('这里不能设定课题目标');
  const objective = text(args.objective, 600);
  if (!objective) return fail('缺少课题目标 objective');
  const criteria = list(args.criteria, 8, 240);
  ctx.setGoal({ objective, criteria });
  return ok({ objective, criteria });
}

/* ───────── 入口 ───────── */

export async function executeTool(call: ToolCall, ctx: ToolContext, allowed: ReadonlySet<string>): Promise<ResearchOutcome> {
  if (!allowed.has(call.name)) return fail(`没有这个工具：${call.name}。可用的工具：${[...allowed].join('、')}`);
  let args: Args;
  try {
    const parsed: unknown = JSON.parse(call.arguments || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
    args = parsed as Args;
  } catch {
    return fail('工具参数不是合法的 JSON（可能因为内容太长被截断）。缩短内容后重试；长文件拆成几个文件或分多次写。');
  }
  switch (call.name) {
    case 'update_plan': return updatePlanTool(args, ctx);
    case 'search_papers': return searchTool(args, ctx);
    case 'read_paper': return readPaperTool(args, ctx);
    case 'save_paper': return savePaperTool(args, ctx);
    case 'list_files': return listFilesTool(args, ctx);
    case 'read_file': return readFileTool(args, ctx);
    case 'write_file': return writeFileTool(args, ctx);
    case 'edit_file': return editFileTool(args, ctx);
    case 'delete_file': return deleteFileTool(args, ctx);
    case 'run_python': return runPythonTool(args, ctx);
    case 'read_library_file': return readLibraryTool(args, ctx);
    case 'spawn_workers': return spawnTool(args, ctx);
    case 'ask_user': return askUserTool(args, ctx);
    case 'finish': return finishTool(args, ctx);
    case 'propose_plan': return proposePlanTool(args, ctx);
    case 'set_goal': return setGoalTool(args, ctx);
    default: return fail(`没有这个工具：${call.name}`);
  }
}
