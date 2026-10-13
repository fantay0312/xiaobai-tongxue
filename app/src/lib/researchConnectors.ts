/**
 * 科研台的文献连接器。
 * 检索与取文都经网关 /api/research/*（网关只访问固定的学术来源，统一成同一种结构）。
 * 导出名与签名是科研台依赖的契约，保持不变。
 */
import { API_BASE, currentAuthEpoch, gatewayFetch } from './api';

export type PaperSource = 'openalex' | 'crossref' | 'arxiv' | 'pubmed' | 'semanticscholar' | 'europepmc';

export interface Paper {
  /** 稳定标识：优先 DOI，其次来源自己的 id，如 arxiv:2401.01234 */
  id: string;
  source: PaperSource;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  /** 落地页 */
  url: string;
  /** 开放获取的全文地址（PDF 或 HTML），没有则为空 */
  openAccessUrl?: string;
  citedBy?: number;
}

export interface PaperDetail extends Paper {
  /** 能取到的正文纯文本（开放获取时）；取不到则只有摘要 */
  fullText?: string;
  /** 正文是否被截断 */
  truncated?: boolean;
  references?: { title: string; doi?: string; year?: number }[];
}

export interface PaperSearchInput {
  query: string;
  /** 不传则由网关挑默认来源并去重合并 */
  sources?: PaperSource[];
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  /** 只要有开放全文的 */
  openAccessOnly?: boolean;
  signal?: AbortSignal;
}

export const PAPER_SOURCE_LABELS: Record<PaperSource, string> = {
  openalex: 'OpenAlex', crossref: 'Crossref', arxiv: 'arXiv', pubmed: 'PubMed', semanticscholar: 'Semantic Scholar', europepmc: 'Europe PMC',
};

// ───────────────────────── 公共小件 ─────────────────────────

type Json = Record<string, unknown>;
type Action = 'search' | 'paper';

/** 都略长于网关自己的 15 秒，让网关先给出明确原因 */
const STATUS_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 22_000;
const MAX_RESULTS = 25;

const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const isSource = (value: unknown): value is PaperSource => typeof value === 'string' && Object.hasOwn(PAPER_SOURCE_LABELS, value);
const stopped = () => new DOMException('Stopped', 'AbortError');

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function yearOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 调用方的取消信号 + 自带超时，合成一个信号。 */
function linkSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}

// ───────────────────────── 读网关返回 ─────────────────────────

function readPaper(value: unknown): Paper | null {
  if (!isRecord(value)) return null;
  const url = httpUrl(value.url);
  if (typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || !value.title || !url || !isSource(value.source)) return null;
  const paper: Paper = {
    id: value.id,
    source: value.source,
    title: value.title,
    authors: Array.isArray(value.authors) ? value.authors.filter((name): name is string => typeof name === 'string' && name.length > 0) : [],
    url,
  };
  const year = yearOf(value.year);
  if (year) paper.year = year;
  if (typeof value.venue === 'string' && value.venue) paper.venue = value.venue;
  if (typeof value.abstract === 'string' && value.abstract) paper.abstract = value.abstract;
  if (typeof value.doi === 'string' && value.doi) paper.doi = value.doi;
  const openAccessUrl = httpUrl(value.openAccessUrl);
  if (openAccessUrl) paper.openAccessUrl = openAccessUrl;
  if (typeof value.citedBy === 'number' && Number.isFinite(value.citedBy) && value.citedBy >= 0) paper.citedBy = value.citedBy;
  return paper;
}

function readDetail(value: unknown): PaperDetail | null {
  const paper = readPaper(value);
  if (!paper || !isRecord(value)) return null;
  const detail: PaperDetail = paper;
  if (typeof value.fullText === 'string' && value.fullText) {
    detail.fullText = value.fullText;
    detail.truncated = value.truncated === true;
  }
  if (Array.isArray(value.references)) {
    const references: NonNullable<PaperDetail['references']> = [];
    for (const item of value.references) {
      if (!isRecord(item) || typeof item.title !== 'string' || !item.title) continue;
      const year = yearOf(item.year);
      references.push({ title: item.title, ...(typeof item.doi === 'string' && item.doi ? { doi: item.doi } : {}), ...(year ? { year } : {}) });
    }
    if (references.length) detail.references = references;
  }
  return detail;
}

/** 网关的错误码 → 给用户看的一句话 */
function failureMessage(action: Action, status: number, code: string): string {
  const verb = action === 'search' ? '检索' : '读取';
  if (status === 401) return '登录已失效，请重新登录';
  if (status === 403) return `当前账号暂时不能使用文献${verb}`;
  if (status === 429) return code === 'daily-limit' ? `今天的文献${verb}次数已用完，明天再来` : `${verb}得太频繁，稍等一会儿再试`;
  if (code === 'invalid-id') return '文献标识无效，无法读取';
  if (status === 400 || status === 413 || status === 415) return action === 'search' ? '检索词无效，换个说法试试' : '文献标识无效，无法读取';
  if (status === 404) return action === 'paper' && code === 'not-found' ? '没有找到这篇文献' : `文献${verb}暂不可用`;
  if (code === 'source-rate-limited') return '文献来源限流了，稍后再试';
  if (code === 'source-timeout' || status === 504) return '文献来源响应超时，稍后再试';
  return '文献来源暂时连不上，稍后再试';
}

async function postJson(action: Action, body: Json, signal: AbortSignal | undefined): Promise<Json> {
  if (signal?.aborted) throw stopped();
  const link = linkSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await gatewayFetch(`${API_BASE}/research/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: link.signal,
      });
    } catch {
      if (link.timedOut()) throw new Error('文献来源响应超时，稍后再试');
      if (link.signal.aborted) throw stopped();
      throw new Error('网络连不上，检查网络后再试');
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (link.signal.aborted && !link.timedOut()) throw stopped();
    }
    if (!response.ok) throw new Error(failureMessage(action, response.status, isRecord(payload) && typeof payload.error === 'string' ? payload.error : ''));
    if (!isRecord(payload)) throw new Error(`文献${action === 'search' ? '检索' : '读取'}暂不可用`);
    return payload;
  } finally {
    link.dispose();
  }
}

// ───────────────────────── 可用性 ─────────────────────────

let availability: { epoch: number; value?: boolean; pending?: Promise<boolean>; failedAt?: number } | null = null;

/** true / false 是网关的明确答复；null 表示这次没问到，稍后可以再问 */
async function fetchAvailability(): Promise<boolean | null> {
  const link = linkSignal(undefined, STATUS_TIMEOUT_MS);
  try {
    const response = await gatewayFetch(`${API_BASE}/research/status`, { signal: link.signal });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return isRecord(payload) && payload.available === true;
  } catch {
    return null;
  } finally {
    link.dispose();
  }
}

function probeAvailability(): Promise<boolean> {
  const epoch = currentAuthEpoch();
  if (availability?.epoch !== epoch) availability = { epoch };
  const cache = availability;
  if (cache.value !== undefined) return Promise.resolve(cache.value);
  if (cache.pending) return cache.pending;
  if (cache.failedAt && Date.now() - cache.failedAt < 10_000) return Promise.resolve(false);
  cache.pending = fetchAvailability().then((value) => {
    cache.pending = undefined;
    if (value === null) cache.failedAt = Date.now(); else cache.value = value;
    return value ?? false;
  });
  return cache.pending;
}

/** 文献连接器是否可用（需要登录并且网关已开通）。结果按登录会话缓存。 */
export async function researchConnectorsAvailable(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const pending = probeAvailability();
  if (!signal) return pending;
  // 调用方不等了就立刻放手；探测本身照常完成并进缓存
  return new Promise<boolean>((resolve) => {
    const giveUp = () => resolve(false);
    signal.addEventListener('abort', giveUp, { once: true });
    void pending.then((value) => { signal.removeEventListener('abort', giveUp); resolve(value); });
  });
}

// ───────────────────────── 检索与取文 ─────────────────────────

export async function searchPapers(input: PaperSearchInput): Promise<Paper[]> {
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (!query) throw new Error('先写下要检索的内容');
  const body: Json = { query: query.slice(0, 300) };
  const sources = input.sources?.filter(isSource);
  if (sources?.length) body.sources = [...new Set(sources)];
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) body.limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(input.limit)));
  const yearFrom = yearOf(input.yearFrom);
  const yearTo = yearOf(input.yearTo);
  if (yearFrom) body.yearFrom = yearFrom;
  if (yearTo) body.yearTo = yearTo;
  if (input.openAccessOnly) body.openAccessOnly = true;

  const payload = await postJson('search', body, input.signal);
  const papers = (Array.isArray(payload.papers) ? payload.papers : []).map(readPaper).filter((paper): paper is Paper => paper !== null);
  if (papers.length) return papers;

  // 一篇都没有时分清两种情况：确实没有，还是来源全都没连上
  const failed = (Array.isArray(payload.failed) ? payload.failed : []).filter(isRecord);
  const asked = Array.isArray(payload.sources) ? payload.sources.length : failed.length;
  if (failed.length && failed.length >= asked) {
    const reasons = failed.map((item) => String(item.reason ?? ''));
    if (reasons.every((reason) => reason === 'rate-limited')) throw new Error('文献来源限流了，稍后再试');
    if (reasons.includes('timeout')) throw new Error('文献来源响应超时，稍后再试');
    throw new Error('文献来源暂时连不上，稍后再试');
  }
  return [];
}

/** 取一篇文献的详情与可得的正文。id 可以是 Paper.id、DOI 或 arXiv 号。 */
export async function getPaper(id: string, signal?: AbortSignal): Promise<PaperDetail> {
  const value = id.trim();
  if (!value || value.length > 300) throw new Error('文献标识无效，无法读取');
  const detail = readDetail(await postJson('paper', { id: value }, signal));
  if (!detail) throw new Error('文献读取暂不可用');
  return detail;
}

// ───────────────────────── BibTeX ─────────────────────────

const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '$': '\\$', '#': '\\#', '_': '\\_',
  '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
};
const KEY_STOP_WORDS = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'to', 'and', 'or', 'with', 'by', 'from', 'at', 'as', 'is', 'are', 'towards', 'toward', 'via']);
const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z][a-z-]{1,20}(?:\.[a-z]{2})?\/\d{7})(?:v\d{1,3})?$/i;

/** 文本字段：折叠空白并转义 BibTeX / LaTeX 的特殊字符 */
function bibText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[\\{}%&$#_~^]/g, (char) => BIBTEX_ESCAPES[char]);
}

/** doi、url 这类原样字段：只保证花括号配平 */
function bibVerbatim(text: string): string {
  return text.replace(/\s+/g, '').replace(/\\/g, '%5C').replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

/** 取键用的纯小写拉丁串：去重音，丢掉其余字符 */
function keyPart(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[łŁ]/g, 'l')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function surnameOf(author: string): string {
  const name = author.trim();
  if (name.includes(',')) return name.split(',')[0];
  const parts = name.split(/\s+/);
  // 「Smith JA」这种姓在前、名缩写在后的写法
  if (parts.length > 1 && /^[A-Z]{1,3}$/.test(parts[parts.length - 1])) return parts.slice(0, -1).join(' ');
  return parts[parts.length - 1] ?? '';
}

/** 标识里没有可用的拉丁字符时，用它的短散列补位，保证键稳定且不撞 */
function shortHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 6);
}

function arxivIdOf(paper: Paper): string | undefined {
  const candidates = [
    /^arxiv:(.+)$/i.exec(paper.id)?.[1],
    /^10\.48550\/arxiv\.(.+)$/i.exec(paper.doi ?? '')?.[1],
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?$/i.exec(paper.url)?.[1],
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?$/i.exec(paper.openAccessUrl ?? '')?.[1],
  ];
  for (const candidate of candidates) {
    const match = candidate ? ARXIV_ID.exec(candidate) : null;
    if (match) return match[1];
  }
  return undefined;
}

function bibKey(paper: Paper): string {
  const realAuthors = paper.authors.filter((name) => !/^et al\.?$/i.test(name.trim()));
  const author = keyPart(surnameOf(realAuthors[0] ?? ''));
  const words = paper.title.split(/[^\p{L}\p{N}]+/u).map(keyPart).filter(Boolean);
  const word = words.find((item) => item.length > 1 && !KEY_STOP_WORDS.has(item)) ?? words[0] ?? '';
  const year = paper.year ? String(paper.year) : 'nd';
  if (author && word) return `${author}${year}${word}`;
  return `${author || 'ref'}${year}${word || shortHash(paper.id || paper.title)}`;
}

function bibAuthors(authors: string[]): string {
  return authors.map((name) => {
    if (/^et al\.?$/i.test(name.trim())) return 'others';
    const text = bibText(name);
    // 机构作者名里带 and 时要整体括起来，否则会被拆成两位作者
    return /\sand\s/i.test(text) ? `{${text}}` : text;
  }).filter(Boolean).join(' and ');
}

function bibEntry(paper: Paper, key: string): string {
  const arxivId = arxivIdOf(paper);
  const doi = paper.doi && !/^10\.48550\/arxiv\./i.test(paper.doi) ? paper.doi : undefined;
  const venue = paper.venue && !/^arxiv\b/i.test(paper.venue.trim()) ? paper.venue : undefined;
  // 只有预印本的记成 @misc + eprint；有期刊或会议出处的记成 @article
  const type = venue ? 'article' : 'misc';
  const fields: [string, string][] = [];
  const authors = bibAuthors(paper.authors);
  if (authors) fields.push(['author', authors]);
  fields.push(['title', `{${bibText(paper.title)}}`]);
  if (paper.year) fields.push(['year', String(paper.year)]);
  if (type === 'article' && venue) fields.push(['journal', bibText(venue)]);
  if (doi) fields.push(['doi', bibVerbatim(doi)]);
  if (arxivId) {
    fields.push(['eprint', arxivId], ['archivePrefix', 'arXiv']);
    const primaryClass = /^([a-z-]+(?:\.[A-Za-z]{2})?)\//.exec(arxivId)?.[1];
    if (primaryClass) fields.push(['primaryClass', primaryClass]);
  }
  fields.push(['url', bibVerbatim(arxivId && !doi ? `https://arxiv.org/abs/${arxivId}` : paper.url)]);
  return `@${type}{${key},\n${fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n')}\n}`;
}

/** 把一组文献导出成 BibTeX。键为「第一作者姓 + 年份 + 标题首个实词」，重复时依次加 b、c… */
export function toBibtex(papers: Paper[]): string {
  const used = new Map<string, number>();
  const entries = papers.map((paper) => {
    const base = bibKey(paper);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const suffix = count === 1 ? '' : count <= 26 ? String.fromCharCode(96 + count) : `-${count}`;
    return bibEntry(paper, `${base}${suffix}`);
  });
  return entries.length ? `${entries.join('\n\n')}\n` : '';
}
