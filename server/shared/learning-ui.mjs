/**
 * 交互式回答的数据契约：模型只产出数据，界面由应用绘制。
 * 这里做「正向投影」——只挑认识的字段重建对象，模型给的 HTML、链接、脚本、事件一律进不来。
 * 服务器生成后校验一次，浏览器收到与读回本地存档时再各校验一次。
 */
const bad = () => { throw new Error('learning-ui-invalid'); };

export const LEARNING_BLOCK_LIMIT = 6;
export const LEARNING_BLOCK_TYPES = ['concept', 'steps', 'formula', 'code', 'comparison', 'table', 'chart', 'mindmap', 'timeline', 'callout', 'quiz', 'flashcard', 'plan'];

// ── 反斜杠救援 ─────────────────────────────────────────────
// 模型常把 LaTeX 写成单个反斜杠。\alpha 这类会让 JSON.parse 直接报错；
// \frac \theta \beta \rho \nabla 更隐蔽：被 JSON 当成换页、制表、退格、回车、换行吞掉。

/** 解析前：把 JSON 字符串里不合法的转义（\a \s \( 等）补成双反斜杠。 */
function repairJsonEscapes(raw) {
  let out = '', inString = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (!inString) { if (char === '"') inString = true; out += char; continue; }
    if (char === '"') { inString = false; out += char; continue; }
    if (char !== '\\') { out += char; continue; }
    const next = raw[i + 1] ?? '';
    if (next === 'u' ? /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6)) : '"\\/bfnrt'.includes(next) && next !== '') {
      out += char + next; i += 1;
    } else out += '\\\\';
  }
  return out;
}

const N_COMMAND = /^(?:abla|eq|e|u|eg|ot|otin|i|leq|geq|mid|parallel|subseteq|supseteq|exists|less|gtr|cong|sim|leftarrow|rightarrow|Rightarrow|Leftarrow|earrow|warrow|olimits|onumber|vdash|prec|succ)(?![a-zA-Z])/;
const T_COMMAND = /^(?:heta|au|imes|ext|extbf|extit|extrm|exttt|frac|o|op|riangle|an|anh|ilde|herefore|ag|binom|riangleq|extstyle)(?![a-zA-Z])/;

/** 解析后：把被吞掉的控制字符还原成 LaTeX 命令。allMath 表示整段都是公式（latex 字段）。 */
function restoreLatex(value, allMath) {
  if (!/[\u0008\f\t\r\n]/.test(value)) return value;
  let out = '', math = allMath;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i], next = value[i + 1] ?? '', letter = /[a-zA-Z]/.test(next);
    if (char === '$' && !allMath && value[i - 1] !== '\\') {
      math = !math; out += char;
      if (next === '$') { out += next; i += 1; }
    } else if (char === '\f') out += '\\f';
    else if (char === '\u0008') out += '\\b';
    else if (char === '\r') { if (next !== '\n') out += letter ? '\\r' : '\n'; }
    else if (char === '\t') out += letter && (math || T_COMMAND.test(value.slice(i + 1))) ? '\\t' : char;
    else if (char === '\n') {
      // 多行公式里真正的换行跟在 \\ 或 \begin{…} 后面，其余「换行+命令名」按 \neq、\nabla 还原
      const realBreak = /(?:\\\\|\\begin\{[a-zA-Z*]+\}|\\end\{[a-zA-Z*]+\})\s*$/.test(out);
      out += math && !realBreak && N_COMMAND.test(value.slice(i + 1)) ? '\\n' : char;
    } else out += char;
  }
  return out;
}

/** 模型输出 → 对象。容忍代码围栏与前后说明文字；解析失败抛 learning-ui-invalid。 */
export function parseLearningUiJson(raw) {
  if (typeof raw !== 'string') bad();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) bad();
  try { return JSON.parse(repairJsonEscapes(raw.slice(start, end + 1))); } catch { return bad(); }
}

// ── 字段 ───────────────────────────────────────────────────
const array = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max ? value : bad();
/** 数量超出上限时截断而不是整份作废。 */
const list = (value, min, max) => Array.isArray(value) && value.length >= min ? value.slice(0, max) : bad();

/** Markdown 文本：去掉链接目标、危险标签与协议头，只留文字。 */
function cleanText(value) {
  return restoreLatex(value, false)
    .replace(/\[S(\d+)\]/g, '[$1]')
    .replace(/!?\[([^\]\n]{0,200})\]\((?:[^()\s]|\([^)\s]*\))+\)/g, '$1')
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|img|svg|a|form|input|button|video|audio)\b[^>]*>/gi, '')
    .replace(/\b(?:https?|ftp):\/\/(?=\S)/gi, '')
    .replace(/\bjavascript:/gi, '')
    .trim();
}
const text = (value, max) => {
  if (typeof value !== 'string') return bad();
  const clean = cleanText(value);
  return clean && clean.length <= max ? clean : bad();
};
const optional = (value, max) => value === undefined || value === null || (typeof value === 'string' && !value.trim()) ? undefined : text(value, max);
/** 单元格/标签：允许模型给数字。 */
const cell = (value, max) => text(typeof value === 'number' && Number.isFinite(value) ? String(value) : value, max);
/** 纯 LaTeX：去掉模型多写的 $ 定界符。 */
const latex = (value, max) => {
  if (typeof value !== 'string') return bad();
  const clean = restoreLatex(value, true).trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '').trim();
  return clean && clean.length <= max ? clean : bad();
};
const number = (value) => {
  const parsed = typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && Math.abs(parsed) <= 1e12 ? parsed : bad();
};
const integer = (value, min, max) => {
  const parsed = number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : bad();
};
const pick = (value, choices) => choices.includes(value) ? value : bad();
const withOptional = (object, extras) => ({ ...object, ...Object.fromEntries(Object.entries(extras).filter(([, value]) => value !== undefined)) });

function mindNode(node, depth, budget) {
  if (!node || typeof node !== 'object') bad();
  budget.left -= 1;
  const label = text(node.label, 80);
  const children = [];
  // 超出 4 层、每层 8 个或总数上限的部分直接不要
  if (depth < 4 && Array.isArray(node.children)) {
    for (const child of node.children.slice(0, 8)) {
      if (budget.left <= 0) break;
      children.push(mindNode(child, depth + 1, budget));
    }
  }
  return withOptional({ label }, { note: optional(node.note, 240), children: children.length ? children : undefined });
}

function codeBlock(block) {
  if (typeof block.code !== 'string') bad();
  const code = block.code.replace(/\r\n?/g, '\n').replace(/^\s*```[\w.+#-]*\n/, '').replace(/\n```\s*$/, '').replace(/^\n+|\s+$/g, '');
  if (!code || code.length > 6000) bad();
  const lines = code.split('\n').length;
  const language = typeof block.language === 'string' && /^[a-zA-Z0-9+#.-]{1,24}$/.test(block.language.trim()) ? block.language.trim().toLowerCase() : 'text';
  const notes = Array.isArray(block.notes) ? block.notes.slice(0, 16).flatMap((note) => {
    const line = Number(note?.line);
    return Number.isInteger(line) && line >= 1 && line <= lines && typeof note.text === 'string' && note.text.trim() ? [{ line, text: text(note.text, 400) }] : [];
  }).sort((a, b) => a.line - b.line) : [];
  const explanation = optional(block.explanation, 2400);
  if (!notes.length && !explanation) bad();
  return withOptional({ language, code, notes }, { explanation });
}

function chartBlock(block) {
  const kind = pick(block.kind, ['bar', 'line', 'pie']);
  const labels = array(block.labels, 2, 12).map((label) => cell(label, 40));
  const series = list(block.series, 1, kind === 'pie' ? 1 : 4).map((item) => ({
    name: text(item?.name, 40),
    values: array(item.values, labels.length, labels.length).map(number),
  }));
  if (kind === 'pie' && (series[0].values.some((value) => value < 0) || !series[0].values.some((value) => value > 0))) bad();
  return withOptional({ kind, labels, series }, { unit: optional(block.unit, 16), note: optional(block.note, 600) });
}

function blockBody(block) {
  switch (block.type) {
    case 'concept': return { body: text(block.body, 3200) };
    case 'flashcard': return { front: text(block.front, 500), back: text(block.back, 1200) };
    case 'quiz': {
      const options = array(block.options, 2, 5).map((option) => cell(option, 240));
      return { question: text(block.question, 600), options, answerIndex: integer(block.answerIndex, 0, options.length - 1), explanation: text(block.explanation, 1600) };
    }
    case 'comparison': {
      const columns = array(block.columns, 2, 4).map((column) => cell(column, 80));
      const rows = array(block.rows, 2, 8).map((row) => ({ label: cell(row?.label, 80), values: array(row.values, columns.length, columns.length).map((item) => cell(item, 500)) }));
      return { columns, rows };
    }
    case 'plan': return { steps: array(block.steps, 2, 7).map((step) => ({ title: text(step?.title, 100), detail: text(step.detail, 700), minutes: integer(step.minutes, 1, 120) })) };
    case 'steps': return withOptional({
      steps: array(block.steps, 2, 8).map((step) => withOptional({ title: text(step?.title, 100), body: text(step.body, 1200) }, { latex: step.latex ? latex(step.latex, 500) : undefined })),
    }, { result: optional(block.result, 800) });
    case 'formula': return withOptional({
      latex: latex(block.latex, 700),
      symbols: Array.isArray(block.symbols) ? block.symbols.slice(0, 12).map((item) => ({ symbol: latex(item?.symbol, 80), meaning: text(item.meaning, 240) })) : [],
    }, { usage: optional(block.usage, 800) });
    case 'code': return codeBlock(block);
    case 'chart': return chartBlock(block);
    case 'mindmap': {
      const root = mindNode(block.root, 1, { left: 48 });
      if (!root.children || root.children.length < 2) bad();
      return { root };
    }
    case 'timeline': return { events: array(block.events, 2, 10).map((event) => withOptional({ time: cell(event?.time, 40), title: text(event.title, 100) }, { detail: optional(event.detail, 600) })) };
    case 'callout': return withOptional({ tone: pick(block.tone, ['tip', 'warning', 'misconception']), body: text(block.body, 1200) }, { fix: optional(block.fix, 800) });
    case 'table': {
      const columns = array(block.columns, 2, 6).map((column) => cell(column, 60));
      const rows = list(block.rows, 1, 14).map((row) => array(row, columns.length, columns.length).map((item) => cell(item, 300)));
      return withOptional({ columns, rows }, { caption: optional(block.caption, 200) });
    }
    default: return bad();
  }
}

/**
 * 校验并重建。salvage=true 时（修正一轮后的最后手段）丢弃字段残缺的卡片、保留其余；
 * 类型不认识或引用了本轮没有的来源，说明输出整体脱离契约，仍然整份拒绝。
 */
export function validateLearningUi(value, sources, { salvage = false } = {}) {
  if (!value || typeof value !== 'object' || value.version !== 1) bad();
  const allowed = new Set(sources.map((source) => source.id));
  const sourceId = (raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return bad();
    const id = String(raw).trim().replace(/^\[|\]$/g, '');
    return allowed.has(id) ? id : allowed.has(`S${id}`) ? `S${id}` : bad();
  };
  const ids = new Set();
  const blocks = list(value.blocks, 0, LEARNING_BLOCK_LIMIT).flatMap((block, index) => {
    if (!block || typeof block !== 'object' || !LEARNING_BLOCK_TYPES.includes(block.type)) bad();
    // 自由问答没有资料可引用；仍逐项拒绝虚构的来源 id。
    const sourceIds = [...new Set(array(block.sourceIds, allowed.size ? 1 : 0, 8).map(sourceId))];
    try {
      const id = text(block.id, 40);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) bad();
      const result = { id, type: block.type, title: text(block.title, 120), sourceIds, ...blockBody(block) };
      ids.add(id);
      return [result];
    } catch {
      if (salvage) return [];
      throw Object.assign(new Error('learning-ui-invalid'), { detail: `blocks[${index}] type=${block.type}` });
    }
  });
  const followUps = (Array.isArray(value.followUps) ? value.followUps : []).flatMap((item) => {
    try { return [text(item, 160)]; } catch { return []; }
  }).slice(0, 3);
  return { version: 1, summary: text(value.summary, 4000), blocks, followUps };
}

// ── 文字版 ─────────────────────────────────────────────────
const flat = (value) => String(value).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const markdownTable = (head, rows) => [`| ${head.map(flat).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(flat).join(' | ')} |`)].join('\n');
const outline = (node, depth = 0) => [`${'  '.repeat(depth)}- ${node.label}${node.note ? `：${node.note}` : ''}`, ...(node.children ?? []).flatMap((child) => outline(child, depth + 1))];
const CALLOUT_LABEL = { tip: '小窍门', warning: '注意', misconception: '易错点' };

function blockText(block) {
  switch (block.type) {
    case 'concept': return block.body;
    case 'flashcard': return `${block.front}\n\n${block.back}`;
    case 'quiz': return `${block.question}\n${block.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}\n\n解析：${block.explanation}`;
    case 'plan': return block.steps.map((step, index) => `${index + 1}. ${step.title}（${step.minutes} 分钟）\n${step.detail}`).join('\n\n');
    case 'comparison': return block.rows.map((row) => `${row.label}：${row.values.map((item, index) => `${block.columns[index]} — ${item}`).join('；')}`).join('\n');
    case 'steps': return `${block.steps.map((step, index) => `**第 ${index + 1} 步 ${step.title}**\n\n${step.body}${step.latex ? `\n\n$$${step.latex}$$` : ''}`).join('\n\n')}${block.result ? `\n\n**结论** ${block.result}` : ''}`;
    case 'formula': return `$$${block.latex}$$${block.symbols.length ? `\n\n${block.symbols.map((item) => `- $${item.symbol}$：${item.meaning}`).join('\n')}` : ''}${block.usage ? `\n\n适用：${block.usage}` : ''}`;
    case 'code': return `\`\`\`${block.language}\n${block.code}\n\`\`\`${block.notes.length ? `\n\n${block.notes.map((note) => `- 第 ${note.line} 行：${note.text}`).join('\n')}` : ''}${block.explanation ? `\n\n${block.explanation}` : ''}`;
    case 'chart': return `${markdownTable([block.unit ? `项目（${block.unit}）` : '项目', ...block.series.map((item) => item.name)], block.labels.map((label, index) => [label, ...block.series.map((item) => item.values[index])]))}${block.note ? `\n\n${block.note}` : ''}`;
    case 'mindmap': return outline(block.root).join('\n');
    case 'timeline': return block.events.map((event) => `- **${event.time}** ${event.title}${event.detail ? `：${event.detail}` : ''}`).join('\n');
    case 'callout': return `> **${CALLOUT_LABEL[block.tone]}** ${block.body.replace(/\n/g, '\n> ')}${block.fix ? `\n\n${block.tone === 'misconception' ? '正确理解' : '怎么做'}：${block.fix}` : ''}`;
    case 'table': return `${markdownTable(block.columns, block.rows)}${block.caption ? `\n\n${block.caption}` : ''}`;
    default: return '';
  }
}

export function learningUiText(ui) {
  return [ui.summary, ...ui.blocks.map((block) => `## ${block.title}\n\n${blockText(block)}`)].join('\n\n');
}

/** 读回本地存档时只恢复当前卡片认识的交互状态。 */
export function restoreLearningInteraction(ui, raw) {
  if (!ui || !raw || typeof raw !== 'object') return {};
  return Object.fromEntries(ui.blocks.flatMap((block) => {
    const state = raw[block.id];
    if (!state || typeof state !== 'object') return [];
    if (block.type === 'quiz') return [[block.id, {
      ...(Number.isInteger(state.choice) && state.choice >= 0 && state.choice < block.options.length ? { choice: state.choice } : {}),
      revealed: state.revealed === true,
    }]];
    if (block.type === 'flashcard') return [[block.id, { revealed: state.revealed === true }]];
    if (block.type === 'plan') return [[block.id, { checked: [...new Set(Array.isArray(state.checked) ? state.checked.filter((index) => Number.isInteger(index) && index >= 0 && index < block.steps.length) : [])] }]];
    if (block.type === 'steps') return Number.isInteger(state.step) && state.step >= 1 && state.step <= block.steps.length ? [[block.id, { step: state.step }]] : [];
    return [];
  }));
}

/** 流式阶段只解出第一个 summary 字符串，转义被切断时等下一段。 */
export function partialLearningSummary(raw) {
  const match = /"summary"\s*:\s*"/.exec(raw);
  if (!match) return '';
  let fragment = '', escaped = false;
  for (const char of raw.slice(match.index + match[0].length)) {
    if (char === '"' && !escaped) break;
    fragment += char;
    escaped = char === '\\' && !escaped;
  }
  const decode = (source) => {
    for (let trim = 0; trim <= 6 && trim <= source.length; trim += 1) {
      try { return JSON.parse(`"${source.slice(0, source.length - trim)}"`); } catch { /* 转义可能还没到齐 */ }
    }
    return null;
  };
  // 先按合法 JSON 解；失败多半是单反斜杠的 LaTeX，去掉尾部半截转义后补救再解
  const repaired = () => decode(repairJsonEscapes(`"${fragment.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '')}`).slice(1));
  const decoded = decode(fragment) ?? repaired();
  return decoded ? restoreLatex(decoded, false).replace(/\[S(\d+)\]/g, '[$1]') : '';
}
