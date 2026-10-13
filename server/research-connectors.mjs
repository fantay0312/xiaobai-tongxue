/**
 * 文献连接器（网关侧）：科研台的检索与取文。
 * 只访问本文件写死的学术来源；浏览器传来的只有检索词和文献标识，
 * 地址一律由校验过的标识和编码后的检索词拼出，从不直接去取客户端给的地址。
 * 六个来源各自归一成同一种结构，按 DOI / arXiv 号 / 标题去重合并后排序。
 */

const SOURCES = ['openalex', 'crossref', 'arxiv', 'pubmed', 'semanticscholar', 'europepmc'];
// 默认来源：生产机实测都在 1.5 秒内返回。PubMed 的内容 Europe PMC 已覆盖，且无密钥时每秒只许 3 次；
// Semantic Scholar 无密钥时常年 429。两者只在调用方点名时才查。
const DEFAULT_SOURCES = ['openalex', 'arxiv', 'europepmc', 'crossref'];

const HOSTS = new Set([
  'api.openalex.org', 'api.crossref.org', 'export.arxiv.org', 'arxiv.org', 'ar5iv.labs.arxiv.org',
  'eutils.ncbi.nlm.nih.gov', 'api.semanticscholar.org', 'www.ebi.ac.uk',
]);
// 单个来源同时在途的请求数：按各家的礼貌用量定
const HOST_CONCURRENCY = { 'export.arxiv.org': 1, 'eutils.ncbi.nlm.nih.gov': 2, 'api.semanticscholar.org': 1, default: 4 };

const USER_AGENT = 'xiaobai-research-connectors/1.0 (study app literature gateway)';
const TOOL_NAME = 'xiaobai-research';

const LIMITS = {
  queryChars: 300, results: 25, defaultResults: 10, bodyBytes: 16 * 1024,
  sourceMs: 8000, searchMs: 15000, paperMs: 15000, fullTextMs: 10000,
  metaBytes: 2 * 1024 * 1024, fullTextBytes: 6 * 1024 * 1024,
  fullTextChars: 60000, minFullTextChars: 800, abstractChars: 3000, authors: 30, references: 80,
  searchPerMin: 30, searchPerDay: 600, paperPerMin: 20, paperPerDay: 400,
  upstreamConcurrency: 12, upstreamQueue: 48, redirects: 3,
  searchTtl: 10 * 60_000, paperTtl: 60 * 60_000, knownTtl: 6 * 60 * 60_000,
};

const fail = (code, status) => Object.assign(new Error(code), { code, status });
/** 来源侧的故障：reason 是给前端看的短码，不带上游原文 */
const upstream = (reason) => Object.assign(new Error(reason), { upstream: true, reason });

// ───────────────────────── 文本小件 ─────────────────────────

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', prime: '′', Prime: '″',
  times: '×', minus: '−', plusmn: '±', deg: '°', micro: 'µ', middot: '·', le: '≤', ge: '≥', ne: '≠', asymp: '≈',
  larr: '←', rarr: '→', harr: '↔', infin: '∞', sup2: '²', sup3: '³', frac12: '½', copy: '©', reg: '®', trade: '™',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', atilde: 'ã', aring: 'å', ccedil: 'ç', eacute: 'é', egrave: 'è',
  ecirc: 'ê', euml: 'ë', iacute: 'í', iuml: 'ï', ntilde: 'ñ', oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö',
  oslash: 'ø', uacute: 'ú', ugrave: 'ù', uuml: 'ü', szlig: 'ß', Eacute: 'É', Ouml: 'Ö', Uuml: 'Ü', Aring: 'Å',
};

function decodeEntities(text) {
  if (text.indexOf('&') < 0) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,30});/gi, (whole, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return '';
    return String.fromCodePoint(code);
  });
}

/** 元数据里的短文本：去掉行内标签与控制字符，折叠空白，按长度截断 */
function cleanText(value, max, { abstract = false } = {}) {
  if (typeof value !== 'string' || !value) return '';
  let text = value.length > max * 4 + 2000 ? value.slice(0, max * 4 + 2000) : value;
  if (text.includes('<')) {
    text = text.replace(/<\/h\d>/gi, ': ').replace(/<\/?(?:p|br|sec|title|jats:p|jats:sec|jats:title)\b[^>]{0,200}>/gi, ' ').replace(/<\/?[a-z][^>]{0,200}>/gi, '');
  }
  text = decodeEntities(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (abstract) text = text.replace(/^abstract\s*[:.]?\s+/i, '');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function cleanAuthors(list) {
  if (!Array.isArray(list)) return [];
  const names = [];
  for (const item of list) {
    const name = cleanText(item, 120);
    if (name && names[names.length - 1] !== name) names.push(name);
    if (names.length > LIMITS.authors) break;
  }
  // 作者过多时截断，并留一个「et al.」让导出时能写成 and others
  return names.length > LIMITS.authors ? [...names.slice(0, LIMITS.authors), 'et al.'] : names;
}

function validYear(value) {
  const year = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isInteger(year) && year >= 1500 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

const countOf = (value) => (Number.isInteger(value) && value >= 0 ? value : undefined);

/** 上游给的链接只接受 http(s)，免得把奇怪的协议带到页面上 */
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 600) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
}

// ───────────────────────── 标识 ─────────────────────────

function normDoi(value) {
  if (typeof value !== 'string') return undefined;
  const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  if (!/^10\.\d{4,9}\/[^\s"'\\\u0000-\u001f]{1,200}$/.test(doi)) return undefined;
  if (typeof doi.isWellFormed === 'function' && !doi.isWellFormed()) return undefined;
  // 不让 . 与 .. 这样的路径段混进后面拼出的地址
  return doi.split('/').some((part) => part === '.' || part === '..') ? undefined : doi;
}

const ARXIV_NEW = /^(\d{4}\.\d{4,5})(?:v\d{1,3})?$/;
const ARXIV_OLD = /^([a-z][a-z-]{1,20}(?:\.[a-z]{2})?\/\d{7})(?:v\d{1,3})?$/i;

function normArxiv(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return ARXIV_NEW.exec(text)?.[1] ?? ARXIV_OLD.exec(text)?.[1];
}

const arxivFromDoi = (doi) => (doi ? normArxiv(/^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1]) : undefined);
const arxivFromUrl = (url) => (typeof url === 'string' ? normArxiv(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?$/i.exec(url.trim())?.[1]) : undefined);
const isArxivDoi = (doi) => /^10\.48550\/arxiv\./i.test(doi);
/** DOI 放进地址的路径里：保留 / 与 :，其余按需转义（? 与 # 不能漏） */
const doiPath = (doi) => encodeURI(doi).replace(/[?#]/g, encodeURIComponent);

/** 客户端传来的文献标识：只认这几种写法，其余一律拒绝 */
function parsePaperRef(value) {
  if (typeof value !== 'string') throw fail('invalid-id', 400);
  let text = value.normalize('NFKC').trim();
  if (!text || text.length > 300 || /[\u0000-\u001f\u007f\s]/.test(text)) throw fail('invalid-id', 400);
  // 常见落地页写法当作标识的另一种写法来解析；只解析，不访问
  const arxivUrl = arxivFromUrl(text);
  if (arxivUrl) return { kind: 'arxiv', value: arxivUrl };
  text = text.replace(/[.,;]+$/, '');
  let match;
  if ((match = /^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/.+)$/i.exec(text))) {
    const doi = normDoi(match[1]);
    if (!doi) throw fail('invalid-id', 400);
    const arxiv = arxivFromDoi(doi);
    return arxiv ? { kind: 'arxiv', value: arxiv } : { kind: 'doi', value: doi };
  }
  if ((match = /^(?:arxiv:)?(.+)$/i.exec(text)) && normArxiv(match[1])) return { kind: 'arxiv', value: normArxiv(match[1]) };
  if ((match = /^(?:pmcid:)?(PMC\d{1,9})$/i.exec(text))) return { kind: 'pmcid', value: match[1].toUpperCase() };
  if ((match = /^(?:pmid:)?(\d{1,9})$/i.exec(text))) return { kind: 'pmid', value: match[1] };
  if ((match = /^(?:openalex:|https?:\/\/openalex\.org\/)?(W\d{3,12})$/i.exec(text))) return { kind: 'openalex', value: match[1].toUpperCase() };
  if ((match = /^(?:s2:|semanticscholar:)([0-9a-f]{40})$/i.exec(text))) return { kind: 's2', value: match[1].toLowerCase() };
  throw fail('invalid-id', 400);
}

function paperId(record) {
  if (record.doi && !isArxivDoi(record.doi)) return record.doi;
  if (record.arxivId) return `arxiv:${record.arxivId}`;
  if (record.doi) return record.doi;
  if (record.pmid) return `pmid:${record.pmid}`;
  if (record.pmcid) return `pmcid:${record.pmcid}`;
  if (record.openalexId) return `openalex:${record.openalexId}`;
  if (record.s2Id) return `s2:${record.s2Id}`;
  return null;
}

/** 一条记录可能被记住或查到的所有写法 */
function aliasKeys(record) {
  const keys = [];
  if (record.doi && !isArxivDoi(record.doi)) keys.push(`doi:${record.doi}`);
  if (record.arxivId) keys.push(`arxiv:${record.arxivId}`);
  if (record.pmid) keys.push(`pmid:${record.pmid}`);
  if (record.pmcid) keys.push(`pmcid:${record.pmcid}`);
  if (record.openalexId) keys.push(`openalex:${record.openalexId}`);
  if (record.s2Id) keys.push(`s2:${record.s2Id}`);
  return keys;
}

// ───────────────────────── 归一结构 ─────────────────────────

/** 各来源的原始字段收成内部记录；标题或标识缺失就丢弃 */
function makeRecord(raw) {
  const title = cleanText(raw.title, 400);
  if (!title) return null;
  const doi = normDoi(raw.doi);
  const record = {
    source: raw.source,
    title,
    authors: cleanAuthors(raw.authors),
    year: validYear(raw.year),
    venue: cleanText(raw.venue, 200) || undefined,
    abstract: cleanText(raw.abstract, LIMITS.abstractChars, { abstract: true }) || undefined,
    doi,
    citedBy: countOf(raw.citedBy),
    openAccessUrl: safeUrl(raw.openAccessUrl),
    landing: safeUrl(raw.landing),
    arxivId: normArxiv(raw.arxivId) ?? arxivFromDoi(doi),
    pmid: typeof raw.pmid === 'string' && /^\d{1,9}$/.test(raw.pmid) ? raw.pmid : undefined,
    pmcid: typeof raw.pmcid === 'string' && /^PMC\d{1,9}$/.test(raw.pmcid) ? raw.pmcid : undefined,
    openalexId: typeof raw.openalexId === 'string' && /^W\d{3,12}$/.test(raw.openalexId) ? raw.openalexId : undefined,
    s2Id: typeof raw.s2Id === 'string' && /^[0-9a-f]{40}$/.test(raw.s2Id) ? raw.s2Id : undefined,
  };
  if (record.venue && /arxiv/i.test(record.venue)) record.venue = 'arXiv';
  return paperId(record) ? record : null;
}

/** 内部记录 → 契约里的 Paper（只带有值的字段） */
function toPaper(record) {
  const url = record.doi && !isArxivDoi(record.doi) ? `https://doi.org/${doiPath(record.doi)}`
    : record.arxivId ? `https://arxiv.org/abs/${record.arxivId}`
      : record.doi ? `https://doi.org/${doiPath(record.doi)}`
        : record.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`
          : record.pmcid ? `https://europepmc.org/article/PMC/${record.pmcid}`
            : record.landing ?? (record.openalexId ? `https://openalex.org/${record.openalexId}` : `https://www.semanticscholar.org/paper/${record.s2Id}`);
  const openAccessUrl = record.openAccessUrl ?? (record.arxivId ? `https://arxiv.org/pdf/${record.arxivId}` : undefined);
  const paper = { id: paperId(record), source: record.source, title: record.title, authors: record.authors, url };
  if (record.year) paper.year = record.year;
  if (record.venue) paper.venue = record.venue;
  if (record.abstract) paper.abstract = record.abstract;
  if (record.doi) paper.doi = record.doi;
  if (openAccessUrl) paper.openAccessUrl = openAccessUrl;
  if (record.citedBy !== undefined) paper.citedBy = record.citedBy;
  return paper;
}

// 合并同一篇文献时，字段优先取哪家的
const FIELD_PRIORITY = ['openalex', 'semanticscholar', 'europepmc', 'pubmed', 'arxiv', 'crossref'];
const priorityOf = (source) => { const index = FIELD_PRIORITY.indexOf(source); return index < 0 ? FIELD_PRIORITY.length : index; };

/** 把同一篇文献的几条记录并成一条 */
function combine(records) {
  const list = records.filter(Boolean).slice().sort((a, b) => priorityOf(a.source) - priorityOf(b.source));
  if (!list.length) return null;
  const first = (pick) => { for (const item of list) { const value = pick(item); if (value !== undefined && value !== '') return value; } return undefined; };
  const merged = { ...list[0] };
  merged.title = first((item) => item.title);
  merged.authors = first((item) => (item.authors?.length ? item.authors : undefined)) ?? [];
  merged.year = first((item) => item.year);
  merged.venue = first((item) => (item.venue && item.venue !== 'arXiv' ? item.venue : undefined)) ?? first((item) => item.venue);
  merged.abstract = list.reduce((best, item) => ((item.abstract?.length ?? 0) > (best?.length ?? 0) ? item.abstract : best), undefined);
  merged.doi = first((item) => (item.doi && !isArxivDoi(item.doi) ? item.doi : undefined)) ?? first((item) => item.doi);
  const cited = list.map((item) => item.citedBy).filter((value) => value !== undefined);
  merged.citedBy = cited.length ? Math.max(...cited) : undefined;
  for (const field of ['openAccessUrl', 'landing', 'arxivId', 'pmid', 'pmcid', 'openalexId', 's2Id']) merged[field] = first((item) => item[field]);
  merged.source = first((item) => (item.title ? item.source : undefined)) ?? list[0].source;
  return merged;
}

// ───────────────────────── 去重与排序 ─────────────────────────

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'by', 'from', 'at', 'as', 'is', 'are', 'via', 'using', 'based']);
const SOURCE_WEIGHT = { openalex: 1, semanticscholar: 1, arxiv: 0.9, europepmc: 0.9, pubmed: 0.9, crossref: 0.6 };

const titleKey = (title) => { const key = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); return key.length >= 12 ? key : null; };
const surnameOf = (name) => (name ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z一-鿿 ,]/g, '').split(',')[0].trim().split(' ').filter((part) => part.length > 1).pop() ?? '';

function queryTerms(query) {
  const terms = query.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  return [...new Set(terms)].slice(0, 12);
}

/** 只凭标题相同还不够：年份相近，或第一作者同姓，才当作同一篇 */
function sameWork(a, b) {
  if (a.year && b.year && Math.abs(a.year - b.year) <= 3) return true;
  if (!a.year || !b.year) return true;
  const left = surnameOf(a.authors[0]);
  return !!left && left === surnameOf(b.authors[0]);
}

/**
 * 各来源按自己的相关度给出名次；这里用名次倒数相加（多家都靠前的自然靠前），
 * 再给标题命中检索词、被引数和年份一点加成。
 */
function mergeAndRank(outcomes, query) {
  const groups = [];
  const byKey = new Map();
  for (const { source, records } of outcomes) {
    records.forEach((record, rank) => {
      const keys = aliasKeys(record);
      const tkey = titleKey(record.title);
      let group = null;
      for (const key of keys) { group = byKey.get(key); if (group) break; }
      if (!group && tkey) {
        const candidate = byKey.get(`title:${tkey}`);
        if (candidate && sameWork(candidate.members[0].record, record)) group = candidate;
      }
      if (!group) { group = { members: [] }; groups.push(group); }
      group.members.push({ record, source, rank });
      for (const key of keys) if (!byKey.has(key)) byKey.set(key, group);
      if (tkey && !byKey.has(`title:${tkey}`)) byKey.set(`title:${tkey}`, group);
    });
  }

  const terms = queryTerms(query.query);
  const thisYear = new Date().getFullYear();
  const scored = groups.map((group) => {
    const record = combine(group.members.map((member) => member.record));
    const best = group.members.reduce((top, member) => (member.rank < top.rank || (member.rank === top.rank && priorityOf(member.source) < priorityOf(top.source)) ? member : top));
    record.source = best.source;
    const seen = new Set();
    let score = 0;
    for (const member of group.members) {
      if (seen.has(member.source)) continue;
      seen.add(member.source);
      score += (SOURCE_WEIGHT[member.source] ?? 0.8) / (10 + member.rank);
    }
    if (terms.length) {
      const title = record.title.toLowerCase();
      const body = (record.abstract ?? '').toLowerCase();
      const inTitle = terms.filter((term) => title.includes(term)).length / terms.length;
      const inBody = terms.filter((term) => body.includes(term)).length / terms.length;
      score += 0.06 * inTitle + 0.02 * inBody;
      // 标题和摘要里一个检索词都没有的，多半是某个来源硬凑的结果，压到后面
      if (!inTitle && !inBody) score *= 0.5;
    }
    score += Math.min(0.04, Math.log10(1 + (record.citedBy ?? 0)) * 0.01);
    if (record.year) score += 0.01 * Math.max(0, 1 - (thisYear - record.year) / 10);
    return { record, score };
  });

  return scored
    .filter(({ record }) => (!query.yearFrom || !record.year || record.year >= query.yearFrom)
      && (!query.yearTo || !record.year || record.year <= query.yearTo)
      && (!query.openAccessOnly || record.openAccessUrl || record.arxivId))
    .sort((a, b) => b.score - a.score)
    .map(({ record }) => record);
}

// ───────────────────────── 宽松的标记解析（HTML 与 XML 共用）─────────────────────────

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = { script: /<\/script/gi, style: /<\/style/gi };
const NO_TAGS = new Set();
const isNameCode = (code) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 58) || code === 45 || code === 46 || code === 95;
const isAlphaCode = (code) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90);

/**
 * 把标记文本读成一棵轻量的树：元素是 { tag, raw, kids }，文本是字符串（实体留到取用时再解）。
 * 容忍不闭合、被截断的输入；线性扫描，节点数与嵌套深度都有上限。
 * drop 里的元素连同内容整段丢掉；leaf 里的元素只留自身和属性。
 */
function parseMarkup(source, { html = false, drop = NO_TAGS, leaf = NO_TAGS, maxNodes = 300_000, maxDepth = 200 } = {}) {
  const root = { tag: '#root', raw: '', kids: [] };
  const stack = [root];
  const length = source.length;
  let pos = 0;
  let nodes = 0;
  let clipped = false;
  let skipTag = '';
  let skipNest = 0;
  let noDouble = false;
  let noSingle = false;
  const addText = (text) => { if (!skipTag && text) stack[stack.length - 1].kids.push(text); };
  const after = (needle, from) => { const end = source.indexOf(needle, from); return end < 0 ? length : end + needle.length; };

  while (pos < length) {
    const lt = source.indexOf('<', pos);
    if (lt < 0) { addText(source.slice(pos)); break; }
    if (lt > pos) addText(source.slice(pos, lt));
    const next = source.charCodeAt(lt + 1);
    if (next === 33) { // <!-- 注释 -->、<![CDATA[…]]>、<!DOCTYPE>
      if (source.startsWith('<!--', lt)) pos = after('-->', lt + 4);
      else if (source.startsWith('<![CDATA[', lt)) {
        const end = source.indexOf(']]>', lt + 9);
        addText(source.slice(lt + 9, end < 0 ? length : end).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
        pos = end < 0 ? length : end + 3;
      } else pos = after('>', lt + 2);
      continue;
    }
    if (next === 63) { pos = after('>', lt + 2); continue; }
    const closing = next === 47;
    const nameStart = lt + (closing ? 2 : 1);
    let cursor = nameStart;
    while (cursor < length && isNameCode(source.charCodeAt(cursor))) cursor += 1;
    if (cursor === nameStart || !isAlphaCode(source.charCodeAt(nameStart))) { addText('&lt;'); pos = lt + 1; continue; }
    const tag = source.slice(nameStart, cursor).toLowerCase();
    const attrStart = cursor;
    // 找标签结尾；引号里的 > 不算。引号找不到下家就此收工，保证整体仍是线性扫描
    let end = -1;
    while (cursor < length) {
      const code = source.charCodeAt(cursor);
      if (code === 62) { end = cursor; break; }
      if (code === 34 || code === 39) {
        if (code === 34 ? noDouble : noSingle) break;
        const close = source.indexOf(code === 34 ? '"' : "'", cursor + 1);
        if (close < 0) { if (code === 34) noDouble = true; else noSingle = true; break; }
        cursor = close + 1;
      } else cursor += 1;
    }
    if (end < 0) { clipped = true; break; }
    pos = end + 1;
    const selfClosed = source.charCodeAt(end - 1) === 47;
    const single = selfClosed || (html && VOID_TAGS.has(tag));

    if (skipTag) {
      if (tag === skipTag) {
        if (closing) { skipNest -= 1; if (skipNest === 0) skipTag = ''; } else if (!single) skipNest += 1;
      }
      continue;
    }
    if (closing) {
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].tag !== tag) depth -= 1;
      if (depth > 0) stack.length = depth;
      continue;
    }
    if (html && RAW_TEXT_TAGS[tag] && !selfClosed) {
      const finder = RAW_TEXT_TAGS[tag];
      finder.lastIndex = pos;
      const found = finder.exec(source);
      pos = found ? found.index : length;
      continue;
    }
    const dropped = drop.has(tag);
    const isLeaf = leaf.has(tag);
    if (!dropped) {
      nodes += 1;
      if (nodes > maxNodes) { clipped = true; break; }
      const node = { tag, raw: source.slice(attrStart, end), kids: [] };
      stack[stack.length - 1].kids.push(node);
      if (!single && !isLeaf && stack.length < maxDepth) stack.push(node);
    }
    if ((dropped || isLeaf) && !single) { skipTag = tag; skipNest = 1; }
  }
  return { root, clipped };
}

const ATTRIBUTE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attrsOf(node) {
  if (!node.attrs) {
    const attrs = Object.create(null);
    if (node.raw) {
      for (const match of node.raw.matchAll(ATTRIBUTE)) {
        const name = match[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
      }
    }
    node.attrs = attrs;
  }
  return node.attrs;
}

const byTag = (...tags) => (node) => tags.includes(node.tag);
const hasClass = (node, name) => { const value = attrsOf(node).class; return !!value && ` ${value} `.includes(` ${name} `); };

/** 先序遍历找后代；不用递归，免得被极深的嵌套撑爆栈 */
function findAll(node, test, max = 5000) {
  const found = [];
  if (!node) return found;
  const pending = [];
  for (let index = node.kids.length - 1; index >= 0; index -= 1) pending.push(node.kids[index]);
  while (pending.length && found.length < max) {
    const current = pending.pop();
    if (typeof current === 'string') continue;
    if (test(current)) found.push(current);
    for (let index = current.kids.length - 1; index >= 0; index -= 1) pending.push(current.kids[index]);
  }
  return found;
}
const findFirst = (node, test) => findAll(node, test, 1)[0] ?? null;
const childrenOf = (node, test) => (node ? node.kids.filter((kid) => typeof kid !== 'string' && test(kid)) : []);
const childOf = (node, test) => childrenOf(node, test)[0] ?? null;

function rawText(node) {
  if (!node) return '';
  const parts = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') { parts.push(current); continue; }
    for (let index = current.kids.length - 1; index >= 0; index -= 1) pending.push(current.kids[index]);
  }
  return decodeEntities(parts.join(''));
}
const innerText = (node) => rawText(node).replace(/\s+/g, ' ').trim();

/** 累积正文：负责空白折叠、段落间距和长度预算 */
function createTextOut(budget) {
  const parts = [];
  const GAPS = ['', ' ', '\n', '\n\n'];
  let size = 0;
  let gap = 0;
  const put = (body) => {
    if (!body) return;
    const separator = size ? GAPS[gap] : '';
    parts.push(separator, body);
    size += separator.length + body.length;
    gap = 0;
  };
  return {
    get full() { return size >= budget; },
    text(value) {
      const text = value.replace(/\s+/g, ' ');
      if (!text) return;
      if (text === ' ') { if (gap < 1) gap = 1; return; }
      if (text[0] === ' ' && gap < 1) gap = 1;
      put(text.trim());
      if (text[text.length - 1] === ' ') gap = 1;
    },
    glue: put,
    space() { if (gap < 1) gap = 1; },
    line() { if (gap < 2) gap = 2; },
    block() { if (gap < 3) gap = 3; },
    toString() { return parts.join(''); },
  };
}

/** 收尾：理顺空行，超长时在段落边界截断 */
function finishText(out, max, clipped) {
  let text = out.toString().replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  let truncated = clipped || out.full;
  if (text.length > max) {
    const cut = text.lastIndexOf('\n\n', max);
    text = text.slice(0, cut > max * 0.8 ? cut : max).trimEnd();
    truncated = true;
  }
  return { text, truncated };
}

const yearIn = (text) => { const years = text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g); return years ? validYear(years[years.length - 1]) : undefined; };
const doiIn = (text) => normDoi(/\b10\.\d{4,9}\/[^\s"'<>,;]+/.exec(text)?.[0]?.replace(/[.)\]]+$/, ''));

// ───────────────────────── arXiv 的 HTML 正文（LaTeXML 产物）─────────────────────────

const HTML_DROP = new Set(['head', 'script', 'style', 'svg', 'nav', 'header', 'footer', 'button', 'noscript', 'iframe', 'form', 'select', 'template']);
const HTML_LEAF = new Set(['math']);
const HTML_BLOCKS = new Set(['p', 'div', 'section', 'article', 'figure', 'figcaption', 'table', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'caption']);
// 脚注、作者栏、目录、页眉页脚这些不算正文
const LATEXML_SKIP = ['ltx_note', 'ltx_authors', 'ltx_dates', 'ltx_TOC', 'ltx_page_footer', 'ltx_page_navbar', 'ltx_page_logo', 'ltx_pagination', 'ltx_ERROR', 'ltx_rule', 'ltx_tag_bibitem'];
const HEADING_MARK = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '####', h6: '####' };

function latexOf(alttext) {
  if (!alttext) return '';
  return decodeEntities(alttext).replace(/%\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
}

function latexmlReferences(section, references) {
  for (const item of findAll(section, (node) => node.tag === 'li' && hasClass(node, 'ltx_bibitem'), LIMITS.references)) {
    if (references.length >= LIMITS.references) break;
    const blocks = findAll(item, (node) => hasClass(node, 'ltx_bibblock'), 12).map(innerText).filter(Boolean);
    const whole = blocks.join(' ');
    // 常见排法：第一段作者，第二段题名
    const title = cleanText((blocks.length >= 2 ? blocks[1] : whole).replace(/^["“”'‘’]+|[.,;\s"“”'‘’]+$/g, ''), 300);
    if (!title) continue;
    const link = findAll(item, (node) => node.tag === 'a' && /doi\.org\//i.test(attrsOf(node).href ?? ''), 1)[0];
    const doi = (link && normDoi(decodeEntities(attrsOf(link).href))) ?? doiIn(whole);
    const year = yearIn(whole);
    references.push({ title, ...(doi ? { doi } : {}), ...(year ? { year } : {}) });
  }
}

function arxivHtmlToText(html, max) {
  const { root, clipped } = parseMarkup(html, { html: true, drop: HTML_DROP, leaf: HTML_LEAF });
  const article = findFirst(root, (node) => node.tag === 'article' && hasClass(node, 'ltx_document'));
  if (!article) return { text: '', truncated: false, references: [] };
  const out = createTextOut(max + 1000);
  const references = [];
  const meta = { title: '', abstract: '' };

  const walkKids = (node, tabular) => { for (const kid of node.kids) walk(kid, tabular); };
  const walk = (node, tabular) => {
    if (out.full) return;
    if (typeof node === 'string') { out.text(decodeEntities(node)); return; }
    const { tag } = node;
    if (tag === 'math') {
      const tex = latexOf(attrsOf(node).alttext);
      if (!tex) return;
      if (attrsOf(node).display === 'block') { out.line(); out.text(`$$${tex}$$`); out.space(); } else out.text(`$${tex}$`);
      return;
    }
    if (attrsOf(node).class) {
      if (LATEXML_SKIP.some((name) => hasClass(node, name))) return;
      if (hasClass(node, 'ltx_bibliography')) return;
      if (hasClass(node, 'ltx_abstract')) { if (!meta.abstract) meta.abstract = innerText(node).replace(/^abstract\s*[:.]?\s*/i, ''); return; }
      if (hasClass(node, 'ltx_title_document')) { if (!meta.title) meta.title = innerText(node); return; }
    }
    if (HEADING_MARK[tag]) { out.block(); out.glue(HEADING_MARK[tag]); out.space(); walkKids(node, tabular); out.block(); return; }
    if (HTML_BLOCKS.has(tag)) {
      out.block();
      // 公式表格的单元格只是排版用，不加分隔符
      walkKids(node, tag === 'table' ? !/ltx_eqn|ltx_equation/.test(attrsOf(node).class ?? '') : tabular);
      out.block();
      return;
    }
    switch (tag) {
      case 'br': out.line(); return;
      case 'img': return;
      case 'li': out.line(); out.glue('-'); out.space(); walkKids(node, tabular); out.line(); return;
      case 'tr': {
        out.line();
        let cells = 0;
        for (const kid of node.kids) {
          if (typeof kid !== 'string' && (kid.tag === 'td' || kid.tag === 'th')) {
            if (cells && tabular) { out.space(); out.glue('|'); }
            out.space();
            cells += 1;
            walkKids(kid, tabular);
          } else walk(kid, tabular);
        }
        out.line();
        return;
      }
      case 'sup': out.glue('^'); walkKids(node, tabular); return;
      case 'sub': out.glue('_'); walkKids(node, tabular); return;
      default: walkKids(node, tabular);
    }
  };
  walk(article, true);
  // 参考文献单独收：正文因长度截断时也不丢
  for (const section of findAll(article, (node) => hasClass(node, 'ltx_bibliography'), 3)) latexmlReferences(section, references);
  return { ...finishText(out, max, clipped), references, title: cleanText(meta.title, 400), abstract: cleanText(meta.abstract, LIMITS.abstractChars) };
}

// ───────────────────────── Europe PMC 的 JATS 全文 ─────────────────────────

const JATS_SKIP = new Set(['graphic', 'inline-graphic', 'media', 'object-id', 'ref-list', 'fn-group', 'fn', 'supplementary-material', 'inline-supplementary-material']);
const JATS_BLOCKS = new Set(['fig', 'table-wrap', 'table-wrap-foot', 'boxed-text', 'disp-quote', 'statement', 'list', 'def-list', 'table', 'preformat', 'code', 'verse-group', 'app']);
const MATH_TAGS = new Set(['mml:math', 'math', 'm:math']);
const MATH_BINARY = /^[=+\-−±×÷<>≤≥≠≈∈→←∝∼~]$/;
const MATH_ACCENT = { '¯': '\\bar', '‾': '\\bar', '^': '\\hat', 'ˆ': '\\hat', '~': '\\tilde', '˜': '\\tilde', '→': '\\vec', '˙': '\\dot' };

/** MathML 压成一行可读的式子（近似 LaTeX 的写法） */
function mathmlLinear(node) {
  if (typeof node === 'string') return decodeEntities(node).replace(/\s+/g, ' ').trim();
  const tag = node.tag.replace(/^(?:mml|m):/, '');
  if (tag === 'annotation' || tag === 'annotation-xml') return '';
  const parts = node.kids.map(mathmlLinear).filter(Boolean);
  const el = node.kids.filter((kid) => typeof kid !== 'string').map(mathmlLinear);
  const group = (text = '') => (text.length > 1 ? `{${text}}` : text);
  const term = (text = '') => (/^[\p{L}\p{N}.]*$/u.test(text) ? text : `(${text})`);
  switch (tag) {
    case 'msup': return `${el[0] ?? ''}^${group(el[1])}`;
    case 'msub': case 'munder': return `${el[0] ?? ''}_${group(el[1])}`;
    case 'msubsup': case 'munderover': return `${el[0] ?? ''}_${group(el[1])}^${group(el[2])}`;
    case 'mover': return MATH_ACCENT[el[1]] ? `${MATH_ACCENT[el[1]]}{${el[0] ?? ''}}` : `${el[0] ?? ''}^${group(el[1])}`;
    case 'mfrac': return `${term(el[0])}/${term(el[1])}`;
    case 'msqrt': return `\\sqrt{${el.join(' ')}}`;
    case 'mroot': return `\\sqrt[${el[1] ?? ''}]{${el[0] ?? ''}}`;
    case 'mfenced': return `${attrsOf(node).open ?? '('}${el.join(', ')}${attrsOf(node).close ?? ')'}`;
    case 'mtr': case 'mlabeledtr': return el.join(' & ');
    case 'mtable': return el.join('; ');
    case 'mtext': return ` ${parts.join(' ')} `;
    case 'mspace': return ' ';
    case 'mo': { const text = parts.join(''); return MATH_BINARY.test(text) ? ` ${text} ` : text; }
    default: return parts.join('');
  }
}

/** 公式优先取 TeX 源，其次把 MathML 压成一行 */
function formulaOf(node) {
  const tex = node.tag === 'tex-math' ? node : findFirst(node, byTag('tex-math'));
  if (tex) {
    let source = rawText(tex);
    const body = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(source);
    if (body) source = body[1];
    return source.replace(/\s+/g, ' ').trim().replace(/^\${1,2}|\${1,2}$/g, '').trim();
  }
  const math = MATH_TAGS.has(node.tag) ? node : findFirst(node, (item) => MATH_TAGS.has(item.tag));
  return math ? mathmlLinear(math).replace(/\s+/g, ' ').trim() : '';
}

function jatsReferences(root) {
  const references = [];
  for (const ref of findAll(root, byTag('ref'), LIMITS.references)) {
    const title = cleanText(
      innerText(findFirst(ref, byTag('article-title'))) || innerText(findFirst(ref, byTag('chapter-title')))
        || innerText(findFirst(ref, byTag('source'))) || innerText(findFirst(ref, byTag('mixed-citation', 'element-citation', 'citation'))),
      300,
    );
    if (!title) continue;
    const doiNode = findFirst(ref, (node) => node.tag === 'pub-id' && attrsOf(node)['pub-id-type'] === 'doi');
    const whole = doiNode ? '' : innerText(ref);
    const doi = normDoi(innerText(doiNode)) ?? doiIn(whole);
    const year = validYear(innerText(findFirst(ref, byTag('year'))).slice(0, 4)) ?? yearIn(whole);
    references.push({ title, ...(doi ? { doi } : {}), ...(year ? { year } : {}) });
  }
  return references;
}

function jatsToText(xml, max) {
  const { root, clipped } = parseMarkup(xml);
  const front = findFirst(root, byTag('front'));
  const body = findFirst(root, byTag('body'));
  const back = findFirst(root, byTag('back'));
  const meta = {
    title: cleanText(innerText(findFirst(front, byTag('article-title'))), 400),
    abstract: cleanText(innerText(findFirst(front, (node) => node.tag === 'abstract' && !attrsOf(node)['abstract-type'])), LIMITS.abstractChars, { abstract: true }),
  };
  if (!body) return { text: '', truncated: false, references: [], ...meta };
  const out = createTextOut(max + 1000);

  const walkKids = (node, depth, flat) => { for (const kid of node.kids) walk(kid, depth, flat); };
  // flat：题注、列表项、单元格里的段落不另起一段
  const walk = (node, depth, flat) => {
    if (out.full) return;
    if (typeof node === 'string') { out.text(decodeEntities(node)); return; }
    const { tag } = node;
    if (JATS_SKIP.has(tag)) return;
    if (MATH_TAGS.has(tag) || tag === 'tex-math' || tag === 'inline-formula' || tag === 'disp-formula' || tag === 'alternatives') {
      const formula = formulaOf(node);
      if (!formula) { walkKids(node, depth, flat); return; }
      if (tag === 'disp-formula') {
        out.line(); out.text(`$$${formula}$$`);
        const label = innerText(childOf(node, byTag('label')));
        if (label) { out.space(); out.text(label); }
        out.line();
      } else out.text(`$${formula}$`);
      return;
    }
    switch (tag) {
      case 'sec': {
        out.block();
        const heading = [innerText(childOf(node, byTag('label'))), innerText(childOf(node, byTag('title')))].filter(Boolean).join(' ');
        if (heading) { out.glue('#'.repeat(Math.min(depth + 2, 4))); out.space(); out.text(heading); out.block(); }
        for (const kid of node.kids) {
          if (typeof kid !== 'string' && (kid.tag === 'title' || kid.tag === 'label')) continue;
          walk(kid, depth + 1, false);
        }
        out.block();
        return;
      }
      case 'p': case 'title':
        if (flat) { out.space(); walkKids(node, depth, true); out.space(); } else { out.block(); walkKids(node, depth, false); out.block(); }
        return;
      case 'label': walkKids(node, depth, true); out.space(); return;
      case 'caption': walkKids(node, depth, true); return;
      case 'list-item': out.line(); out.glue('-'); out.space(); walkKids(node, depth, true); out.line(); return;
      case 'def-item': out.line(); walkKids(node, depth, true); out.line(); return;
      case 'term': walkKids(node, depth, true); out.glue(':'); out.space(); return;
      case 'tr': {
        out.line();
        let cells = 0;
        for (const kid of node.kids) {
          if (typeof kid !== 'string' && (kid.tag === 'td' || kid.tag === 'th')) {
            if (cells) { out.space(); out.glue('|'); }
            out.space();
            cells += 1;
            walkKids(kid, depth, true);
          } else walk(kid, depth, true);
        }
        out.line();
        return;
      }
      case 'break': out.line(); return;
      case 'sup': out.glue('^'); walkKids(node, depth, flat); return;
      case 'sub': out.glue('_'); walkKids(node, depth, flat); return;
      default:
        if (JATS_BLOCKS.has(tag)) { out.block(); walkKids(node, depth, tag === 'fig' || tag === 'table-wrap' || tag === 'table-wrap-foot' ? true : flat); out.block(); } else walkKids(node, depth, flat);
    }
  };
  walk(body, 0, false);
  for (const appendix of findAll(back, byTag('app'), 20)) walk(appendix, 0, false);
  return { ...finishText(out, max, clipped), references: jatsReferences(back ?? root), ...meta };
}

// ───────────────────────── 来源适配 ─────────────────────────

/** 去掉各家检索语法里的特殊符号，只留词 */
const plainTerms = (query) => query.replace(/["'()[\]{}:\\/^~*?!<>=|&]+/g, ' ').replace(/\s+/g, ' ').trim();

function openalexRecord(work) {
  if (!work || typeof work !== 'object') return null;
  const primary = work.primary_location ?? {};
  const bestOa = work.best_oa_location ?? {};
  const landings = [primary.landing_page_url, bestOa.landing_page_url, ...(Array.isArray(work.locations) ? work.locations.slice(0, 20).map((item) => item?.landing_page_url) : [])];
  let abstract = '';
  const index = work.abstract_inverted_index;
  if (index && typeof index === 'object') {
    const words = [];
    for (const [word, positions] of Object.entries(index)) {
      if (!Array.isArray(positions)) continue;
      for (const position of positions) if (Number.isInteger(position) && position >= 0 && position < 1500) words[position] = word;
    }
    abstract = words.filter(Boolean).join(' ');
  }
  return makeRecord({
    source: 'openalex',
    title: work.display_name ?? work.title,
    authors: Array.isArray(work.authorships) ? work.authorships.slice(0, LIMITS.authors + 1).map((item) => item?.author?.display_name) : [],
    year: work.publication_year,
    venue: primary.source?.display_name,
    abstract,
    doi: work.doi,
    citedBy: work.cited_by_count,
    openAccessUrl: bestOa.pdf_url ?? work.open_access?.oa_url ?? (bestOa.is_oa ? bestOa.landing_page_url : undefined),
    landing: primary.landing_page_url,
    arxivId: landings.map(arxivFromUrl).find(Boolean),
    pmid: /(\d{1,9})\/?$/.exec(work.ids?.pmid ?? '')?.[1],
    pmcid: /(PMC\d{1,9})\/?$/i.exec(work.ids?.pmcid ?? '')?.[1]?.toUpperCase(),
    openalexId: /(W\d{3,12})$/.exec(work.id ?? '')?.[1],
  });
}

function crossrefRecord(item) {
  if (!item || typeof item !== 'object') return null;
  if (['component', 'peer-review', 'journal', 'journal-issue', 'journal-volume', 'grant', 'dataset', 'book-series'].includes(item.type)) return null;
  const openLicense = Array.isArray(item.license) && item.license.some((entry) => /creativecommons\.org/i.test(entry?.URL ?? ''));
  const pdf = Array.isArray(item.link) ? item.link.find((entry) => entry?.['content-type'] === 'application/pdf')?.URL : undefined;
  return makeRecord({
    source: 'crossref',
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    authors: Array.isArray(item.author) ? item.author.slice(0, LIMITS.authors + 1).map((author) => [author?.given, author?.family].filter(Boolean).join(' ') || author?.name) : [],
    year: item.issued?.['date-parts']?.[0]?.[0] ?? item.published?.['date-parts']?.[0]?.[0],
    venue: Array.isArray(item['container-title']) ? item['container-title'][0] : undefined,
    abstract: item.abstract,
    doi: item.DOI,
    citedBy: item['is-referenced-by-count'],
    openAccessUrl: openLicense ? pdf : undefined,
  });
}

function arxivEntries(xml) {
  const { root } = parseMarkup(xml);
  const records = [];
  for (const entry of findAll(root, byTag('entry'), 60)) {
    const arxivId = arxivFromUrl(innerText(childOf(entry, byTag('id'))));
    if (!arxivId) continue; // 出错时上游会塞一条 id 指向 errors 的条目
    const record = makeRecord({
      source: 'arxiv',
      title: innerText(childOf(entry, byTag('title'))),
      authors: childrenOf(entry, byTag('author')).map((author) => innerText(childOf(author, byTag('name')))),
      year: innerText(childOf(entry, byTag('published'))).slice(0, 4),
      venue: innerText(childOf(entry, byTag('arxiv:journal_ref'))) || 'arXiv',
      abstract: innerText(childOf(entry, byTag('summary'))),
      doi: innerText(childOf(entry, byTag('arxiv:doi'))) || undefined,
      openAccessUrl: `https://arxiv.org/pdf/${arxivId}`,
      arxivId,
    });
    if (record) records.push(record);
  }
  return records;
}

function pubmedArticles(xml) {
  const { root } = parseMarkup(xml);
  const records = [];
  for (const item of findAll(root, byTag('pubmedarticle'), 60)) {
    const citation = childOf(item, byTag('medlinecitation'));
    const article = childOf(citation, byTag('article'));
    if (!article) continue;
    const journal = childOf(article, byTag('journal'));
    const idList = childOf(childOf(item, byTag('pubmeddata')), byTag('articleidlist'));
    const idOf = (type) => innerText(childrenOf(idList, (node) => node.tag === 'articleid' && attrsOf(node).idtype === type)[0]);
    const abstract = childrenOf(childOf(article, byTag('abstract')), byTag('abstracttext'))
      .map((part) => { const label = attrsOf(part).label; const text = innerText(part); return label && text ? `${decodeEntities(label)}: ${text}` : text; })
      .filter(Boolean).join(' ');
    const pubDate = findFirst(journal, byTag('pubdate'));
    const pmcid = idOf('pmc').toUpperCase();
    const record = makeRecord({
      source: 'pubmed',
      title: innerText(childOf(article, byTag('articletitle'))).replace(/\.$/, ''),
      authors: childrenOf(childOf(article, byTag('authorlist')), byTag('author')).map((author) => {
        const last = innerText(childOf(author, byTag('lastname')));
        const fore = innerText(childOf(author, byTag('forename')));
        return [fore, last].filter(Boolean).join(' ') || innerText(childOf(author, byTag('collectivename')));
      }),
      year: innerText(childOf(pubDate, byTag('year'))) || /\d{4}/.exec(innerText(childOf(pubDate, byTag('medlinedate'))))?.[0],
      venue: innerText(childOf(journal, byTag('title'))) || innerText(childOf(journal, byTag('isoabbreviation'))),
      abstract,
      doi: idOf('doi') || undefined,
      pmid: idOf('pubmed') || innerText(childOf(citation, byTag('pmid'))),
      pmcid: pmcid || undefined,
      openAccessUrl: pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : undefined,
    });
    if (record) records.push(record);
  }
  return records;
}

function europepmcRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const authors = Array.isArray(item.authorList?.author)
    ? item.authorList.author.slice(0, LIMITS.authors + 1).map((author) => (author?.firstName && author?.lastName ? `${author.firstName} ${author.lastName}` : author?.fullName ?? author?.collectiveName))
    : typeof item.authorString === 'string' ? item.authorString.replace(/\.$/, '').split(', ').slice(0, LIMITS.authors + 1) : [];
  const links = Array.isArray(item.fullTextUrlList?.fullTextUrl) ? item.fullTextUrlList.fullTextUrl : [];
  const open = links.find((link) => link?.availabilityCode === 'OA' && link?.documentStyle === 'pdf')
    ?? links.find((link) => link?.availabilityCode === 'OA') ?? links.find((link) => link?.availabilityCode === 'F');
  const pmcid = typeof item.pmcid === 'string' ? item.pmcid.toUpperCase() : undefined;
  return makeRecord({
    source: 'europepmc',
    title: typeof item.title === 'string' ? item.title.replace(/\.$/, '') : undefined,
    authors,
    year: item.pubYear,
    venue: item.journalInfo?.journal?.title ?? item.bookOrReportDetails?.publisher,
    abstract: item.abstractText,
    doi: item.doi,
    citedBy: item.citedByCount,
    openAccessUrl: open?.url ?? (item.isOpenAccess === 'Y' && pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : undefined),
    landing: typeof item.source === 'string' && typeof item.id === 'string' && /^[A-Z]{3}$/.test(item.source) && /^[A-Za-z0-9]{1,24}$/.test(item.id) ? `https://europepmc.org/article/${item.source}/${item.id}` : undefined,
    pmid: item.pmid,
    pmcid,
  });
}

function semanticScholarRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const ids = item.externalIds ?? {};
  return makeRecord({
    source: 'semanticscholar',
    title: item.title,
    authors: Array.isArray(item.authors) ? item.authors.slice(0, LIMITS.authors + 1).map((author) => author?.name) : [],
    year: item.year,
    venue: item.venue,
    abstract: item.abstract,
    doi: ids.DOI,
    citedBy: item.citationCount,
    openAccessUrl: item.openAccessPdf?.url || undefined,
    arxivId: typeof ids.ArXiv === 'string' ? ids.ArXiv : undefined,
    pmid: ids.PubMed !== undefined ? String(ids.PubMed) : undefined,
    pmcid: ids.PubMedCentral !== undefined ? `PMC${String(ids.PubMedCentral).replace(/^PMC/i, '')}` : undefined,
    s2Id: item.paperId,
  });
}

const OPENALEX_FIELDS = 'id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,cited_by_count,abstract_inverted_index,ids,type';
const CROSSREF_FIELDS = 'DOI,title,author,issued,container-title,abstract,is-referenced-by-count,type,license,link';
const S2_FIELDS = 'paperId,externalIds,title,abstract,authors,year,venue,citationCount,openAccessPdf';
const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** 六个来源的检索与按标识查找。get 已绑定本次的时限与并发闸。 */
function createAdapters(keys) {
  const withKey = (params, name, key) => { if (key) params.set(name, key); return params; };
  const s2Headers = keys.semanticscholar ? { 'x-api-key': keys.semanticscholar } : undefined;

  async function pubmedFetch(ids, get) {
    const params = withKey(new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'xml', tool: TOOL_NAME }), 'api_key', keys.ncbi);
    // 条目带参考文献表时体积不小：读到上限为止，宽松解析能消化被截断的尾巴
    const { text } = await get.text(`${EUTILS_BASE}/efetch.fcgi?${params}`, { accept: 'application/xml', clip: true });
    const records = pubmedArticles(text);
    return ids.map((id) => records.find((record) => record.pmid === id)).filter(Boolean);
  }

  async function europepmcQuery(query, size, get) {
    const params = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: String(size) });
    const data = await get.json(`${EPMC_BASE}/search?${params}`);
    const list = data.resultList?.result;
    return (Array.isArray(list) ? list : []).map(europepmcRecord).filter(Boolean);
  }

  return {
    openalex: {
      async search(q, get) {
        const params = withKey(new URLSearchParams({ search: q.query, 'per-page': String(q.perSource), select: OPENALEX_FIELDS }), 'api_key', keys.openalex);
        const filters = [];
        if (q.yearFrom) filters.push(`from_publication_date:${q.yearFrom}-01-01`);
        if (q.yearTo) filters.push(`to_publication_date:${q.yearTo}-12-31`);
        if (q.openAccessOnly) filters.push('open_access.is_oa:true');
        if (filters.length) params.set('filter', filters.join(','));
        const data = await get.json(`https://api.openalex.org/works?${params}`);
        return (Array.isArray(data.results) ? data.results : []).map(openalexRecord).filter(Boolean);
      },
      /** locator：W 开头的编号，或 doi:10.x/… */
      async lookup(locator, get) {
        const params = withKey(new URLSearchParams({ select: `${OPENALEX_FIELDS},locations` }), 'api_key', keys.openalex);
        const path = locator.startsWith('doi:') ? `doi:${doiPath(locator.slice(4))}` : locator;
        return openalexRecord(await get.json(`https://api.openalex.org/works/${path}?${params}`));
      },
    },
    crossref: {
      async search(q, get) {
        const params = new URLSearchParams({ 'query.bibliographic': q.query, rows: String(q.perSource), select: CROSSREF_FIELDS });
        const filters = [];
        if (q.yearFrom) filters.push(`from-pub-date:${q.yearFrom}`);
        if (q.yearTo) filters.push(`until-pub-date:${q.yearTo}`);
        if (filters.length) params.set('filter', filters.join(','));
        const data = await get.json(`https://api.crossref.org/works?${params}`);
        return (Array.isArray(data.message?.items) ? data.message.items : []).map(crossrefRecord).filter(Boolean);
      },
      async lookup(doi, get) {
        const data = await get.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
        return crossrefRecord(data.message);
      },
    },
    arxiv: {
      async search(q, get) {
        // arXiv 只收拉丁字母的检索词；逐词用 AND 连，一无所获再放宽成 OR
        const terms = q.query.replace(/[^A-Za-z0-9.]+/g, ' ').split(' ').map((term) => term.replace(/^\.+|\.+$/g, ''))
          .filter((term) => term.length > 1 && !STOP_WORDS.has(term.toLowerCase())).slice(0, 8);
        if (!terms.length) return [];
        const dates = q.yearFrom || q.yearTo ? ` AND submittedDate:[${q.yearFrom ?? 1991}01010000 TO ${q.yearTo ?? new Date().getFullYear() + 1}12312359]` : '';
        const run = async (joiner) => {
          const expression = `(${terms.map((term) => `all:${term}`).join(` ${joiner} `)})${dates}`;
          const params = new URLSearchParams({ search_query: expression, start: '0', max_results: String(q.perSource), sortBy: 'relevance', sortOrder: 'descending' });
          const { text } = await get.text(`https://export.arxiv.org/api/query?${params}`, { accept: 'application/atom+xml' });
          return arxivEntries(text);
        };
        const strict = await run('AND');
        return strict.length || terms.length < 3 ? strict : run('OR');
      },
      async lookup(arxivId, get) {
        const params = new URLSearchParams({ id_list: arxivId, max_results: '1' });
        const { text } = await get.text(`https://export.arxiv.org/api/query?${params}`, { accept: 'application/atom+xml' });
        return arxivEntries(text)[0] ?? null;
      },
    },
    pubmed: {
      async search(q, get) {
        const terms = plainTerms(q.query);
        if (!terms) return [];
        const params = withKey(new URLSearchParams({
          db: 'pubmed', term: q.openAccessOnly ? `(${terms}) AND free full text[filter]` : terms,
          retmax: String(q.perSource), retmode: 'json', sort: 'relevance', tool: TOOL_NAME,
        }), 'api_key', keys.ncbi);
        if (q.yearFrom || q.yearTo) { params.set('datetype', 'pdat'); params.set('mindate', String(q.yearFrom ?? 1800)); params.set('maxdate', String(q.yearTo ?? 3000)); }
        const found = await get.json(`${EUTILS_BASE}/esearch.fcgi?${params}`);
        const ids = (Array.isArray(found.esearchresult?.idlist) ? found.esearchresult.idlist : []).filter((id) => typeof id === 'string' && /^\d{1,9}$/.test(id)).slice(0, q.perSource);
        return ids.length ? pubmedFetch(ids, get) : [];
      },
      async lookup(pmid, get) { return (await pubmedFetch([pmid], get))[0] ?? null; },
    },
    semanticscholar: {
      async search(q, get) {
        const params = new URLSearchParams({ query: q.query, limit: String(q.perSource), fields: S2_FIELDS });
        if (q.yearFrom || q.yearTo) params.set('year', `${q.yearFrom ?? ''}-${q.yearTo ?? ''}`);
        if (q.openAccessOnly) params.set('openAccessPdf', '');
        const data = await get.json(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, { headers: s2Headers });
        return (Array.isArray(data.data) ? data.data : []).map(semanticScholarRecord).filter(Boolean);
      },
      async lookup(paperHash, get) {
        const params = new URLSearchParams({ fields: S2_FIELDS });
        return semanticScholarRecord(await get.json(`https://api.semanticscholar.org/graph/v1/paper/${paperHash}?${params}`, { headers: s2Headers }));
      },
    },
    europepmc: {
      async search(q, get) {
        const terms = plainTerms(q.query);
        if (!terms) return [];
        const clauses = [`(${terms})`, 'NOT SRC:PAT'];
        if (q.yearFrom || q.yearTo) clauses.push(`AND PUB_YEAR:[${q.yearFrom ?? 1800} TO ${q.yearTo ?? 3000}]`);
        if (q.openAccessOnly) clauses.push('AND OPEN_ACCESS:y');
        return europepmcQuery(clauses.join(' '), q.perSource, get);
      },
      /** query 由调用方用校验过的标识拼好，如 DOI:"10.x/…"、PMCID:PMC123 */
      async lookup(query, get) { return (await europepmcQuery(query, 1, get))[0] ?? null; },
    },
  };
}

// ───────────────────────── 取数：白名单、时限、体积、并发 ─────────────────────────

function allowedUrl(value, reason = 'blocked-url') {
  let url;
  try { url = value instanceof URL ? value : new URL(value); } catch { throw upstream(reason); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw upstream(reason);
  return url;
}

/** 带时限的中止信号；上级信号中止时一并中止。用完要 dispose。 */
function deadline(ms, parent) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  timer.unref?.();
  if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}

/** 全局与单来源两层并发闸；排队的请求随自己的时限放弃 */
function createLimiter(globalMax, perHost, maxQueue) {
  const active = new Map();
  const queue = [];
  let total = 0;
  const free = (host) => total < globalMax && (active.get(host) ?? 0) < (perHost[host] ?? perHost.default);
  const take = (host) => { total += 1; active.set(host, (active.get(host) ?? 0) + 1); };
  const release = (host) => {
    total -= 1;
    active.set(host, active.get(host) - 1);
    for (let index = 0; index < queue.length; index += 1) {
      if (!free(queue[index].host)) continue;
      const [job] = queue.splice(index, 1);
      index -= 1;
      take(job.host);
      job.start();
    }
  };
  return async (host, signal, task) => {
    if (signal.aborted) throw upstream('timeout');
    if (free(host)) take(host);
    else {
      if (queue.length >= maxQueue) throw upstream('busy');
      await new Promise((resolve, reject) => {
        const job = { host, start: () => { signal.removeEventListener('abort', giveUp); resolve(); } };
        const giveUp = () => { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); reject(upstream('timeout')); };
        signal.addEventListener('abort', giveUp, { once: true });
        queue.push(job);
      });
    }
    try { return await task(); } finally { release(host); }
  };
}

async function readCapped(response, maxBytes, clip) {
  if (!response.body) return { text: '', clipped: false };
  const declared = Number(response.headers.get('content-length'));
  const reader = response.body.getReader();
  if (!clip && Number.isFinite(declared) && declared > maxBytes) { await reader.cancel().catch(() => {}); throw upstream('too-large'); }
  const chunks = [];
  let total = 0;
  let clipped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      if (!clip) throw upstream('too-large');
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      clipped = true;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: Buffer.concat(chunks, total).toString('utf8'), clipped };
}

/** 小型 LRU：带过期时间，并把同一个键的并发请求并成一次 */
function createCache(maxEntries) {
  const entries = new Map();
  const pending = new Map();
  const read = (key) => {
    const hit = entries.get(key);
    if (!hit) return undefined;
    entries.delete(key);
    if (hit.expires < Date.now()) return undefined;
    entries.set(key, hit);
    return hit.value;
  };
  const write = (key, value, ttl) => {
    entries.delete(key);
    entries.set(key, { value, expires: Date.now() + ttl });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  return {
    read,
    write,
    /** producer 返回 { value, ttl }；ttl 为 0 时不入缓存 */
    resolve(key, producer) {
      const hit = read(key);
      if (hit !== undefined) return Promise.resolve(hit);
      let job = pending.get(key);
      if (!job) {
        job = producer().then(({ value, ttl }) => { if (ttl > 0) write(key, value, ttl); return value; }).finally(() => pending.delete(key));
        pending.set(key, job);
      }
      return job;
    },
  };
}

// ───────────────────────── 服务 ─────────────────────────

function normalizeSearch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.query !== 'string') throw fail('invalid-input', 400);
  const query = input.query.normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!query || query.length > LIMITS.queryChars) throw fail('invalid-input', 400);
  let sources = DEFAULT_SOURCES;
  if (input.sources !== undefined && input.sources !== null) {
    if (!Array.isArray(input.sources) || input.sources.length > SOURCES.length || input.sources.some((source) => !SOURCES.includes(source))) throw fail('invalid-input', 400);
    if (input.sources.length) sources = SOURCES.filter((source) => input.sources.includes(source));
  }
  const yearOf = (value) => {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || value < 1500 || value > new Date().getFullYear() + 1) throw fail('invalid-input', 400);
    return value;
  };
  const yearFrom = yearOf(input.yearFrom);
  const yearTo = yearOf(input.yearTo);
  if (yearFrom && yearTo && yearFrom > yearTo) throw fail('invalid-input', 400);
  if (input.limit !== undefined && input.limit !== null && !(Number.isInteger(input.limit) && input.limit >= 1)) throw fail('invalid-input', 400);
  const limit = Math.min(LIMITS.results, input.limit ?? LIMITS.defaultResults);
  return { query, sources, limit, perSource: Math.min(LIMITS.results, Math.max(limit, 10)), yearFrom, yearTo, openAccessOnly: input.openAccessOnly === true };
}

const TRANSIENT = new Set(['timeout', 'unreachable', 'rate-limited', 'busy', 'upstream-error', 'too-large']);

export function createResearchConnectors({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // 可选密钥：配了就带上，换更宽的额度；不配照常匿名访问
  const adapters = createAdapters({
    openalex: env.OPENALEX_API_KEY || '', semanticscholar: env.SEMANTIC_SCHOLAR_API_KEY || '', ncbi: env.NCBI_API_KEY || '',
  });
  const limiter = createLimiter(LIMITS.upstreamConcurrency, HOST_CONCURRENCY, LIMITS.upstreamQueue);
  const searchCache = createCache(200);
  const paperCache = createCache(120);
  const known = createCache(1500); // 近期检索到的文献：取文时省一次元数据查询，也带着跨库标识

  async function request(url, { signal, maxBytes = LIMITS.metaBytes, clip = false, accept = 'application/json', headers }) {
    let target = allowedUrl(url);
    for (let hop = 0; hop <= LIMITS.redirects; hop += 1) {
      const current = target;
      const outcome = await limiter(current.hostname, signal, async () => {
        let response;
        try {
          // 自定义请求头（如密钥）只发给第一跳
          response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal, headers: { 'User-Agent': USER_AGENT, Accept: accept, ...(hop === 0 ? headers : undefined) } });
        } catch { throw upstream(signal.aborted ? 'timeout' : 'unreachable'); }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => {});
          if (!location) throw upstream('bad-response');
          return { location };
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw upstream(response.status === 429 ? 'rate-limited' : response.status === 404 || response.status === 410 ? 'not-found' : 'upstream-error');
        }
        try { return { ...(await readCapped(response, maxBytes, clip)), url: current }; } catch (error) {
          if (error?.upstream) throw error;
          throw upstream(signal.aborted ? 'timeout' : 'unreachable');
        }
      });
      if (!outcome.location) return outcome;
      let next;
      try { next = new URL(outcome.location, current); } catch { throw upstream('bad-response'); }
      target = allowedUrl(next, 'blocked-redirect'); // 跳出白名单的重定向一律不跟
    }
    throw upstream('bad-response');
  }

  const bind = (signal) => ({
    text: (url, options) => request(url, { ...options, signal }),
    async json(url, options) {
      const { text } = await request(url, { ...options, signal });
      try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') return value;
      } catch { /* 落到下面统一报错 */ }
      throw upstream('bad-response');
    },
  });

  const reasonOf = (error, label) => {
    if (error?.upstream) return error.reason;
    console.error('[research]', label, String(error?.message ?? error).slice(0, 120));
    return 'bad-response';
  };

  function remember(record) {
    for (const key of aliasKeys(record)) known.write(key, record, LIMITS.knownTtl);
  }

  async function searchSource(source, query, parent) {
    const limit = deadline(LIMITS.sourceMs, parent);
    try { return { source, records: await adapters[source].search(query, bind(limit.signal)) }; } catch (error) {
      const reason = reasonOf(error, `search:${source}`);
      return { source, reason: reason === 'not-found' || reason.startsWith('blocked') ? 'upstream-error' : reason };
    } finally { limit.dispose(); }
  }

  function search(input) {
    const query = normalizeSearch(input);
    const key = JSON.stringify([query.query.toLowerCase(), query.sources, query.limit, query.yearFrom ?? 0, query.yearTo ?? 0, query.openAccessOnly]);
    return searchCache.resolve(key, async () => {
      // 检索不跟着某一个浏览器连接走：同一检索词的并发请求共用这一次
      const overall = deadline(LIMITS.searchMs);
      try {
        const outcomes = await Promise.all(query.sources.map((source) => searchSource(source, query, overall.signal)));
        const failed = outcomes.filter((outcome) => outcome.reason).map(({ source, reason }) => ({ source, reason }));
        const ranked = mergeAndRank(outcomes.filter((outcome) => outcome.records), query).slice(0, query.limit);
        ranked.forEach(remember);
        const ttl = !failed.length ? LIMITS.searchTtl : failed.length === query.sources.length ? 10_000 : 60_000;
        return { value: { papers: ranked.map(toPaper), failed, sources: query.sources }, ttl };
      } finally { overall.dispose(); }
    });
  }

  /** 正文：成功给 { text, truncated, references, title, abstract }；取不到给 { transient } */
  async function fetchFullText(kind, id, parent) {
    const pages = kind === 'arxiv'
      ? [`https://arxiv.org/html/${id}`, `https://ar5iv.labs.arxiv.org/html/${id}`]
      : [`${EPMC_BASE}/${id}/fullTextXML`];
    let transient = false;
    for (const page of pages) {
      const limit = deadline(LIMITS.fullTextMs, parent);
      try {
        const got = await request(page, { signal: limit.signal, maxBytes: LIMITS.fullTextBytes, clip: true, accept: kind === 'arxiv' ? 'text/html' : 'application/xml' });
        // ar5iv 没有转换稿时会跳去摘要页，那不是正文
        if (kind === 'arxiv' && !got.url.pathname.startsWith('/html/')) continue;
        const result = kind === 'arxiv' ? arxivHtmlToText(got.text, LIMITS.fullTextChars) : jatsToText(got.text, LIMITS.fullTextChars);
        if (result.text.length >= LIMITS.minFullTextChars) return { ...result, truncated: result.truncated || got.clipped };
      } catch (error) {
        if (TRANSIENT.has(reasonOf(error, `fulltext:${kind}`))) transient = true;
      } finally { limit.dispose(); }
    }
    return { transient };
  }

  async function readPaper(ref, signal) {
    const key = `${ref.kind}:${ref.value}`;
    const field = { doi: 'doi', arxiv: 'arxivId', pmid: 'pmid', pmcid: 'pmcid', openalex: 'openalexId', s2: 's2Id' }[ref.kind];
    let record = known.read(key) ?? { source: null, title: '', authors: [], [field]: ref.value };
    const issues = [];
    const lookup = async (label, task) => {
      const limit = deadline(LIMITS.sourceMs, signal);
      try { return await task(bind(limit.signal)); } catch (error) {
        const reason = reasonOf(error, `lookup:${label}`);
        if (reason !== 'not-found') issues.push(reason);
        return null;
      } finally { limit.dispose(); }
    };
    const absorb = (found) => { if (found) record = combine([record.title ? record : { ...record, source: found.source }, found]) ?? record; };

    // 这两种标识只有原来源认得：先换出通用标识
    if (!record.title && ref.kind === 's2') absorb(await lookup('semanticscholar', (get) => adapters.semanticscholar.lookup(ref.value, get)));
    if (!record.title && ref.kind === 'openalex') absorb(await lookup('openalex', (get) => adapters.openalex.lookup(ref.value, get)));

    // 能直接定位正文的，正文与元数据同时取
    const tried = new Set();
    const startFull = (kind, id) => { tried.add(kind); return fetchFullText(kind, id, signal); };
    let fullJob = record.arxivId ? startFull('arxiv', record.arxivId) : record.pmcid ? startFull('pmc', record.pmcid) : null;

    const jobs = [];
    if (record.arxivId) {
      if (!record.title) jobs.push(lookup('arxiv', (get) => adapters.arxiv.lookup(record.arxivId, get)));
    } else if (!record.title || !record.pmcid) {
      // Europe PMC 既给元数据，也告诉我们这篇在不在 PMC 开放全文里
      const query = record.pmcid ? `PMCID:${record.pmcid}` : record.doi ? `DOI:"${record.doi}"` : record.pmid ? `EXT_ID:${record.pmid} AND SRC:MED` : null;
      if (query) jobs.push(lookup('europepmc', (get) => adapters.europepmc.lookup(query, get)));
      if (!record.title && record.doi && !/[,|]/.test(record.doi)) jobs.push(lookup('openalex', (get) => adapters.openalex.lookup(`doi:${record.doi}`, get)));
    }
    for (const found of await Promise.all(jobs)) absorb(found);
    if (!record.title && record.doi) absorb(await lookup('crossref', (get) => adapters.crossref.lookup(record.doi, get)));
    if (!record.title && record.pmid) absorb(await lookup('pubmed', (get) => adapters.pubmed.lookup(record.pmid, get)));

    let full = fullJob ? await fullJob : null;
    let transient = !!full?.transient;
    for (const [kind, id] of [['pmc', record.pmcid], ['arxiv', record.arxivId]]) {
      if (full?.text || !id || tried.has(kind) || signal.aborted) continue;
      fullJob = startFull(kind, id);
      full = await fullJob;
      transient = transient || !!full?.transient;
    }

    if (!record.title && full?.title) record = { ...record, title: full.title, source: ref.kind === 'arxiv' ? 'arxiv' : 'europepmc' };
    if (!record.title) {
      if (!issues.length) throw fail('not-found', 404);
      if (issues.every((reason) => reason === 'rate-limited')) throw fail('source-rate-limited', 503);
      throw fail(issues.includes('timeout') ? 'source-timeout' : 'source-unreachable', issues.includes('timeout') ? 504 : 502);
    }
    if (!record.abstract && full?.abstract) record = { ...record, abstract: full.abstract };
    if (!record.source) record = { ...record, source: 'openalex' };
    remember(record);

    const detail = toPaper(record);
    if (full?.text) {
      detail.fullText = full.text;
      detail.truncated = !!full.truncated;
      if (full.references?.length) detail.references = full.references;
    }
    // 正文或元数据是因为临时故障才缺的，就别缓存太久
    return { value: detail, ttl: full?.text || (!transient && !issues.length) ? LIMITS.paperTtl : 120_000 };
  }

  function paper(input) {
    const ref = parsePaperRef(input && typeof input === 'object' ? input.id : undefined);
    return paperCache.resolve(`${ref.kind}:${ref.value}`, async () => {
      const overall = deadline(LIMITS.paperMs);
      try { return await readPaper(ref, overall.signal); } finally { overall.dispose(); }
    });
  }

  return {
    status: () => ({ available: true, sources: SOURCES, defaultSources: DEFAULT_SOURCES }),
    search,
    paper,
  };
}

// ───────────────────────── 路由 ─────────────────────────

/** 单账号的分钟窗 + 日封顶，写法与 index.mjs 的 rateCheck 一致；表太大时顺手清掉过期项 */
function rateCheck(name, perMin, perDay, minMap, dayMap) {
  const now = Date.now();
  if (minMap.size > 5000) for (const [key, value] of minMap) if (value.resetAt < now) minMap.delete(key);
  const rate = minMap.get(name) ?? { count: 0, resetAt: now + 60_000 };
  if (rate.resetAt < now) { rate.count = 0; rate.resetAt = now + 60_000; }
  rate.count += 1;
  minMap.set(name, rate);
  if (rate.count > perMin) return 'rate-limited';
  const today = new Date().toISOString().slice(0, 10);
  if (dayMap.size > 5000) for (const [key, value] of dayMap) if (value.day !== today) dayMap.delete(key);
  const daily = dayMap.get(name);
  const dayCount = daily && daily.day === today ? daily.count + 1 : 1;
  dayMap.set(name, { day: today, count: dayCount });
  return dayCount > perDay ? 'daily-limit' : null;
}

const PUBLIC_ERRORS = new Set(['invalid-input', 'invalid-id', 'not-found', 'source-rate-limited', 'source-timeout', 'source-unreachable']);

/** 鉴权后的 JSON 接口：GET /api/research/status、POST /api/research/search、POST /api/research/paper */
export function createResearchConnectorsRouter({ resolveUser, send, readJson, hasJsonContentType, service = createResearchConnectors() }) {
  const searchHits = new Map();
  const searchDaily = new Map();
  const paperHits = new Map();
  const paperDaily = new Map();

  return { async handle(req, res, pathname) {
    try {
      const user = await resolveUser(req, res);
      if (!user) return;
      if (pathname === '/api/research/status' && req.method === 'GET') return send(res, 200, service.status());
      const action = pathname === '/api/research/search' ? 'search' : pathname === '/api/research/paper' ? 'paper' : null;
      if (!action || req.method !== 'POST') return send(res, 404, { error: 'not-found' });
      if (!hasJsonContentType(req)) return send(res, 415, { error: 'json-required' });
      if (req.headers.origin) {
        try { if (new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'invalid-origin' }); } catch { return send(res, 403, { error: 'invalid-origin' }); }
      }
      const limited = action === 'search'
        ? rateCheck(user.name, LIMITS.searchPerMin, LIMITS.searchPerDay, searchHits, searchDaily)
        : rateCheck(user.name, LIMITS.paperPerMin, LIMITS.paperPerDay, paperHits, paperDaily);
      if (limited) return send(res, 429, { error: limited });
      const input = await readJson(req, LIMITS.bodyBytes);
      const result = action === 'search' ? await service.search(input) : await service.paper(input);
      if (!res.destroyed && !res.writableEnded) send(res, 200, result);
    } catch (error) {
      if (res.destroyed || res.writableEnded || res.headersSent) return;
      const message = error?.message;
      if (message === 'body-too-large') return send(res, 413, { error: 'invalid-input' });
      if (message === 'bad-json' || error instanceof SyntaxError) return send(res, 400, { error: 'invalid-input' });
      if (PUBLIC_ERRORS.has(error?.code)) return send(res, error.status, { error: error.code });
      // 上游的原始报错不外传，只留一行短日志
      console.error('[research]', String(error?.code || message || 'error').slice(0, 120));
      send(res, 502, { error: 'research-failed' });
    }
  } };
}
