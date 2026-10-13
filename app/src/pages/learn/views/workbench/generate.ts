/**
 * 工作台的「AI 生成」与批改。
 * 有模型：completeJson 取 JSON，逐字段校验归一后再用（不信任返回形状）。
 * 没有模型（ModelUnavailableError）或调用方指定 local：从课程内容 / 所给文字里确定性地抽取，结果标「本地演示」。
 */
import type { Topic } from '../../../../types';
import type { NotebookSource } from '../../../../engine/notebookSources';
import { completeJson, ModelUnavailableError } from '../../../../lib/modelGateway';
import { mindNode, newCard, newId, type Flashcard, type MindNode, type QuestionType, type QuizQuestion } from '../../../../store/studyData';
import { addDays, clip, countWords, dayKey } from './util';

export const DEMO_SUFFIX = '（本地演示）';
export const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'single', label: '单选' },
  { value: 'multiple', label: '多选' },
  { value: 'truefalse', label: '判断' },
  { value: 'blank', label: '填空' },
  { value: 'short', label: '简答' },
];
export const TRUE_FALSE = ['正确', '错误'];

export interface GenInput {
  topic?: Topic;
  sources: NotebookSource[];
  /** 用户的补充要求 */
  instruction?: string;
  /** 没有课程和资料时，用户贴的一段文字 */
  text?: string;
  /** 跳过模型，直接本地抽取 */
  local?: boolean;
  signal?: AbortSignal;
}
export interface GenResult<T> { data: T; local: boolean }

export const hasMaterial = (input: Pick<GenInput, 'topic' | 'sources' | 'text'>) =>
  Boolean(input.topic || input.sources.some((source) => source.content.trim()) || (input.text ?? '').trim().length >= 20);

/* ── 取材 ── */
function gather(input: GenInput): { title: string; body: string } {
  const { topic, sources } = input;
  const text = (input.text ?? '').trim();
  const parts: string[] = [];
  let budget = 10_000;
  for (const source of sources) {
    if (budget <= 0) break;
    const content = source.content.trim().slice(0, Math.min(5000, budget));
    if (!content) continue;
    parts.push(`## ${source.title}\n\n${content}`);
    budget -= content.length;
  }
  if (topic) {
    const lectureIncluded = sources.some((source) => source.id === `lecture:${topic.topicId}`);
    const lines = [`# ${topic.title}`, topic.tagline];
    if (!lectureIncluded) lines.push(topic.prep.microLecture.body.slice(0, 6000));
    if (topic.checklist.length) lines.push(`## 要点\n${topic.checklist.map((item) => `- ${item.point}：${item.groundTruth}`).join('\n')}`);
    if (topic.misconceptions.length) lines.push(`## 常见误区\n${topic.misconceptions.map((item) => `- ${item.belief}`).join('\n')}`);
    parts.unshift(lines.filter(Boolean).join('\n\n'));
  }
  if (text) parts.push(`## 补充文字\n\n${text.slice(0, 8000)}`);
  const firstLine = text.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean) ?? '';
  const title = topic?.title ?? sources[0]?.title ?? (clip(firstLine, 18) || '学习材料');
  return { title, body: parts.join('\n\n') };
}

/* ── 校验小件 ── */
export const str = (value: unknown, max = 4000): string =>
  (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '').trim().slice(0, max);
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const rec = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const SYSTEM = '你是大学课程助教「小砚」。只依据用户给出的材料组织内容，不编造材料之外的事实。用简体中文。只输出一个 JSON 对象，不要代码围栏，不要任何多余文字。';

export const isUnavailable = (error: unknown) =>
  error instanceof ModelUnavailableError || (error instanceof Error && (error.name === 'ModelUnavailableError' || error.message === 'model-unavailable'));

async function run<T>(input: GenInput, prompt: string, parse: (raw: unknown) => T | null, fallback: () => T, maxTokens = 3200): Promise<GenResult<T>> {
  if (input.local) return { data: fallback(), local: true };
  try {
    const raw = await completeJson<unknown>({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      maxTokens,
      temperature: 0.4,
      signal: input.signal,
    });
    const data = parse(raw);
    if (!data) throw new Error('model-invalid-shape');
    return { data, local: false };
  } catch (error) {
    if (isUnavailable(error)) return { data: fallback(), local: true };
    throw error;
  }
}

const withExtra = (instruction?: string) => (instruction?.trim() ? `\n\n补充要求：${instruction.trim().slice(0, 400)}` : '');

/* ── 本地抽取用的文本工具 ── */
export const stripMd = (text: string) => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`>#|]/g, '')
  .replace(/[ \t]+/g, ' ');

export function sentences(text: string): string[] {
  return stripMd(text)
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+(?=[A-Z])/)
    .map((part) => part.replace(/^\s*(?:[-+•]|\d+[.)、])\s*/, '').trim())
    .filter((part) => part.length >= 8 && part.length <= 180);
}

export interface Section { title: string; lines: string[] }
export function sections(md: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^#{1,4}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      current = { title: stripMd(heading[1]).trim(), lines: [] };
      out.push(current);
    } else if (line.trim()) {
      if (!current) { current = { title: '', lines: [] }; out.push(current); }
      current.lines.push(line);
    }
  }
  return out.filter((section) => section.title || section.lines.length);
}

export interface Pair { term: string; desc: string }
/** 从文字里找「术语：解释」「X 是 Y」一类的成对内容，凑不够再用小节标题和句子补 */
export function pairs(md: string): Pair[] {
  const found: Pair[] = [];
  const push = (term: string, desc: string) => {
    const t = stripMd(term).trim().replace(/[：:，,。.]$/, '');
    const d = stripMd(desc).trim();
    if (t.length < 2 || t.length > 20 || d.length < 6) return;
    if (found.some((pair) => pair.term === t)) return;
    found.push({ term: t, desc: clip(d, 160) });
  };
  for (const line of md.split('\n')) {
    const colon = /^\s*(?:[-*+•]|\d+[.)、])?\s*\**([^：:*\n]{2,20}?)\**\s*[：:]\s*(.{6,})$/.exec(line);
    if (colon && !/^https?$/i.test(colon[1])) push(colon[1], colon[2]);
  }
  for (const sentence of sentences(md)) {
    const is = /^([^，,。；;：:]{2,14}?)(?:是指|指的是|是一种|是一个|就是|称为|叫做|\s+is\s+(?:an?\s+|the\s+)?|\s+means\s+|\s+refers to\s+)(.{6,})$/i.exec(sentence);
    if (is) push(is[1], sentence);
  }
  if (found.length < 6) {
    for (const section of sections(md)) {
      const first = sentences(section.lines.join('\n'))[0];
      if (section.title && first) push(section.title, first);
    }
  }
  if (found.length < 4) {
    for (const sentence of sentences(md)) {
      const cut = sentence.search(/[，,]/);
      if (cut >= 2 && cut <= 16 && sentence.length - cut > 8) push(sentence.slice(0, cut), sentence);
    }
  }
  return found.slice(0, 30);
}

/** 确定性的洗牌：同样的材料每次得到同样的结果 */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: T[], seed: string): T[] {
  const random = seeded(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ══════════ 笔记 ══════════ */
export interface NoteDraft { title: string; body: string; tags: string[] }

function localNote(input: GenInput): NoteDraft {
  const { topic } = input;
  const { title, body } = gather(input);
  if (topic) {
    const lecture = sentences(topic.prep.microLecture.body).slice(0, 4);
    const lines = [
      `> ${topic.tagline}`,
      '## 核心要点',
      ...topic.checklist.map((item, index) => `${index + 1}. **${item.point}**：${item.groundTruth}`),
    ];
    if (topic.misconceptions.length) {
      lines.push('## 容易想错的地方', ...topic.misconceptions.map((item) => `- 误区：${item.belief}\n  - 纠正：${item.correctionCriteria[0] ?? item.probe.explanation}`));
    }
    if (topic.prep.examples.length) lines.push('## 例子', ...topic.prep.examples.slice(0, 2).map((example) => `- **${example.title}**：${clip(stripMd(example.walkthrough).trim(), 120)}`));
    if (lecture.length) lines.push('## 讲义摘录', ...lecture.map((sentence) => `- ${sentence}`));
    if (topic.prep.selfCheck.length) lines.push('## 自测', ...topic.prep.selfCheck.slice(0, 5).map((item) => `- [ ] ${item}`));
    return { title: `${topic.title} · 要点笔记`, body: lines.join('\n\n').replace(/\n\n(?=\d+\. |- )/g, '\n'), tags: [topic.course, '本地演示'].filter(Boolean) };
  }
  const parts = sections(body).filter((section) => section.title !== '补充文字' || section.lines.length);
  const lines: string[] = [];
  for (const section of parts.slice(0, 8)) {
    const picked = sentences(section.lines.join('\n')).slice(0, 3);
    if (!picked.length) continue;
    if (section.title) lines.push(`## ${section.title}`);
    lines.push(picked.map((sentence) => `- ${sentence}`).join('\n'));
  }
  const terms = pairs(body).slice(0, 8);
  if (terms.length) lines.push('## 关键词', terms.map((pair) => `- **${pair.term}**：${pair.desc}`).join('\n'));
  if (terms.length) lines.push('## 自测', terms.slice(0, 3).map((pair) => `- [ ] 用自己的话解释：${pair.term}`).join('\n'));
  return { title: `${title} · 要点摘录`, body: lines.join('\n\n') || body.slice(0, 1200), tags: ['本地演示'] };
}

export function generateNote(input: GenInput): Promise<GenResult<NoteDraft>> {
  const { title, body } = gather(input);
  const prompt = `把下面的材料整理成一篇复习笔记。

输出 JSON：{"title":"笔记标题（20 字以内）","tags":["2 到 4 个标签"],"body":"Markdown 正文"}
正文要求：开头一句话概括；用 ## 分 3–5 节写要点；单列「容易想错的地方」；给一个具体例子；结尾 3 条自测问题（用 - [ ] 列出）。公式写成 $...$。600–900 字。${withExtra(input.instruction)}

材料《${title}》：
${body}`;
  return run(input, prompt, (raw) => {
    const data = rec(raw);
    const text = str(data.body ?? data.content ?? data.markdown, 12_000);
    if (text.length < 40) return null;
    return {
      title: str(data.title, 60) || `${title} · 笔记`,
      body: text,
      tags: arr(data.tags).map((tag) => str(tag, 16)).filter(Boolean).slice(0, 5),
    };
  }, () => localNote(input));
}

/* ══════════ 思维导图 ══════════ */
export interface MapDraft { title: string; root: MindNode }

function normaliseNode(raw: unknown, depth = 0): MindNode | null {
  if (typeof raw === 'string') return raw.trim() ? mindNode(clip(raw.trim(), 80)) : null;
  const data = rec(raw);
  const text = str(data.text ?? data.title ?? data.name ?? data.topic, 80).replace(/\s+/g, ' ');
  if (!text) return null;
  const children = depth >= 5 ? [] : arr(data.children ?? data.nodes ?? data.items).slice(0, 14)
    .map((child) => normaliseNode(child, depth + 1))
    .filter((node): node is MindNode => node !== null);
  return mindNode(text, children, str(data.note ?? data.detail, 200) || undefined);
}

function localMap(input: GenInput): MapDraft {
  const { topic } = input;
  const { title, body } = gather(input);
  if (topic) {
    const branches: MindNode[] = [
      mindNode('核心要点', topic.checklist.map((item) => mindNode(item.point, item.terms.slice(0, 4).map((term) => mindNode(term)), item.groundTruth))),
    ];
    if (topic.misconceptions.length) branches.push(mindNode('常见误区', topic.misconceptions.map((item) => mindNode(clip(item.belief, 30), [mindNode(clip(item.correctionCriteria[0] ?? item.probe.explanation, 36))]))));
    if (topic.prep.examples.length) branches.push(mindNode('例子', topic.prep.examples.slice(0, 4).map((example) => mindNode(clip(example.title, 28)))));
    if (topic.prep.selfCheck.length) branches.push(mindNode('自检', topic.prep.selfCheck.slice(0, 5).map((item) => mindNode(clip(item, 30)))));
    if (topic.transferHint) branches.push(mindNode('迁移', [mindNode(clip(topic.transferHint, 30))]));
    return { title: `${topic.title} · 思维导图${DEMO_SUFFIX}`, root: mindNode(topic.title, branches.filter((branch) => branch.children.length)) };
  }
  const parts = sections(body).filter((section) => section.title && section.title !== '补充文字');
  let branches: MindNode[];
  if (parts.length >= 2) {
    branches = parts.slice(0, 7).map((section) => mindNode(clip(section.title, 24), sentences(section.lines.join('\n')).slice(0, 4).map((sentence) => mindNode(clip(sentence, 30)))));
  } else {
    const found = pairs(body);
    branches = found.length >= 3
      ? found.slice(0, 8).map((pair) => mindNode(pair.term, [mindNode(clip(pair.desc, 36))]))
      : sentences(body).slice(0, 6).map((sentence) => mindNode(clip(sentence, 30)));
  }
  return { title: `${title} · 思维导图${DEMO_SUFFIX}`, root: mindNode(clip(title, 24), branches) };
}

export function generateMindMap(input: GenInput): Promise<GenResult<MapDraft>> {
  const { title, body } = gather(input);
  const prompt = `把下面的材料整理成一张思维导图。

输出 JSON：{"title":"导图标题","root":{"text":"中心主题","children":[{"text":"分支","note":"可选的一句说明","children":[]}]}}
要求：3–6 个一级分支；每个分支 2–4 个子节点；最多 4 层；节点文字是短语，不超过 16 个字；note 可省略。${withExtra(input.instruction)}

材料《${title}》：
${body}`;
  return run(input, prompt, (raw) => {
    const data = rec(raw);
    const root = normaliseNode(data.root ?? data.tree ?? data);
    if (!root || !root.children.length) return null;
    return { title: str(data.title, 60) || `${title} · 思维导图`, root };
  }, () => localMap(input));
}

/* ══════════ 题目集 ══════════ */
export interface QuizDraft { title: string; questions: QuizQuestion[] }
export interface QuizOptions { count: number; types: QuestionType[] }

const TYPE_ALIASES: Record<string, QuestionType> = {
  single: 'single', single_choice: 'single', choice: 'single', radio: 'single', 单选: 'single', 单选题: 'single',
  multiple: 'multiple', multi: 'multiple', multiple_choice: 'multiple', checkbox: 'multiple', 多选: 'multiple', 多选题: 'multiple',
  truefalse: 'truefalse', true_false: 'truefalse', judge: 'truefalse', boolean: 'truefalse', 判断: 'truefalse', 判断题: 'truefalse',
  blank: 'blank', fill: 'blank', fill_blank: 'blank', cloze: 'blank', 填空: 'blank', 填空题: 'blank',
  short: 'short', short_answer: 'short', essay: 'short', open: 'short', 简答: 'short', 简答题: 'short',
};
const stripLabel = (option: string) => option.replace(/^\s*[（(]?[A-Ha-h][)）.、．:：]\s*/, '').trim();

function toIndexes(value: unknown, options: string[], judge: boolean): number[] {
  const one = (item: unknown): number => {
    if (typeof item === 'number') return Number.isInteger(item) ? item : -1;
    if (typeof item === 'boolean') return judge ? (item ? 0 : 1) : -1;
    const text = str(item, 300);
    if (judge && /^(正确|对|true|是|t|√|yes)$/i.test(text)) return 0;
    if (judge && /^(错误|错|false|否|f|×|no)$/i.test(text)) return 1;
    if (/^[A-Ha-h]$/.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
    if (/^\d+$/.test(text)) return Number(text);
    return options.findIndex((option) => option === text || option === stripLabel(text));
  };
  const text = typeof value === 'string' ? value.trim() : '';
  const items = Array.isArray(value) ? value
    : /^[A-H](\s*[,，、\s]?\s*[A-H])+$/.test(text) ? (text.match(/[A-H]/g) ?? [])
      : [value];
  return [...new Set(items.map(one).filter((index) => index >= 0 && index < options.length))].sort((a, b) => a - b);
}

/** 把任意来源的一道题收拾成合规的 QuizQuestion；收拾不了返回 null */
export function normaliseQuestion(raw: unknown): QuizQuestion | null {
  const data = rec(raw);
  const stem = str(data.stem ?? data.question ?? data.title, 1200);
  if (!stem) return null;
  let options = arr(data.options ?? data.choices).map((option) => stripLabel(str(option, 300))).filter(Boolean).slice(0, 8);
  let type = TYPE_ALIASES[str(data.type, 30).toLowerCase()];
  if (!type) type = options.length >= 2 ? (Array.isArray(data.answer) && data.answer.length > 1 ? 'multiple' : 'single') : typeof data.answer === 'boolean' ? 'truefalse' : 'short';
  const base = {
    id: newId(),
    stem,
    explanation: str(data.explanation ?? data.analysis ?? data.reason, 2000),
    difficulty: clampInt(data.difficulty, 1, 3, 2) as 1 | 2 | 3,
  };
  if (type === 'truefalse') {
    options = TRUE_FALSE;
    const answer = toIndexes(data.answer, options, true).slice(0, 1);
    return answer.length ? { ...base, type, options, answer } : null;
  }
  if (type === 'single' || type === 'multiple') {
    if (options.length < 2) return null;
    const answer = toIndexes(data.answer, options, false);
    if (!answer.length) return null;
    if (type === 'single') return { ...base, type, options, answer: answer.slice(0, 1) };
    return answer.length > 1 ? { ...base, type, options, answer } : { ...base, type: 'single', options, answer };
  }
  const answer = Array.isArray(data.answer) ? data.answer.map((item) => str(item, 400)).filter(Boolean).join('；') : str(data.answer ?? data.reference, 1500);
  return answer ? { ...base, type, answer } : null;
}

function topicPool(topic: Topic): Record<QuestionType, QuizQuestion[]> {
  const q = (question: Omit<QuizQuestion, 'id'>): QuizQuestion => ({ id: newId(), ...question });
  const single = topic.quizBank.filter((item) => item.options.length >= 2).map((item) => q({
    type: 'single',
    stem: item.code ? `${item.question}\n\n\`\`\`\n${item.code}\n\`\`\`` : item.question,
    options: item.options,
    answer: [Math.min(item.options.length - 1, Math.max(0, item.answerIndex))],
    explanation: item.explanation,
    difficulty: 2,
  }));
  const truefalse = [
    ...topic.misconceptions.map((item) => q({ type: 'truefalse', stem: item.probe.statement, options: TRUE_FALSE, answer: [1], explanation: item.probe.explanation, difficulty: 2 })),
    ...topic.checklist.map((item) => q({ type: 'truefalse', stem: `${item.point}：${item.groundTruth}`, options: TRUE_FALSE, answer: [0], explanation: `这是本课的要点「${item.point}」。`, difficulty: 1 })),
  ];
  const multiple: QuizQuestion[] = [];
  const truths = topic.checklist.map((item) => item.groundTruth);
  const myths = topic.misconceptions.map((item) => item.belief);
  for (let i = 0; i + 1 < truths.length && myths.length && multiple.length < 3; i += 2) {
    const wrong = [myths[(i / 2) % myths.length], myths[(i / 2 + 1) % myths.length]].filter((item, index, all) => all.indexOf(item) === index);
    const options = shuffle([truths[i], truths[i + 1], ...wrong], `${topic.topicId}:${i}`);
    multiple.push(q({
      type: 'multiple',
      stem: `关于「${topic.title}」，下面哪些说法是对的？`,
      options,
      answer: [options.indexOf(truths[i]), options.indexOf(truths[i + 1])].sort((a, b) => a - b),
      explanation: `错误的说法是常见误区：${wrong.join('；')}`,
      difficulty: 3,
    }));
  }
  const blank = topic.checklist.flatMap((item) => {
    const term = item.terms.find((candidate) => candidate.length >= 2 && item.groundTruth.includes(candidate));
    return term
      ? [q({ type: 'blank', stem: item.groundTruth.replace(term, '____'), answer: term, explanation: `要点「${item.point}」：${item.groundTruth}`, difficulty: 2 })]
      : [];
  });
  const short = topic.checklist.map((item) => q({ type: 'short', stem: `用自己的话讲清楚：${item.point}`, answer: item.groundTruth, explanation: stripMd(item.lookupCard).trim().slice(0, 400), difficulty: 3 }));
  return { single, multiple, truefalse, blank, short };
}

function textPool(body: string): Record<QuestionType, QuizQuestion[]> {
  const found = pairs(body);
  const q = (question: Omit<QuizQuestion, 'id'>): QuizQuestion => ({ id: newId(), ...question });
  const single = found.length >= 4 ? found.map((pair, index) => {
    const others = shuffle(found.filter((other) => other.term !== pair.term), `${pair.term}:${index}`).slice(0, 3).map((other) => other.term);
    const options = shuffle([pair.term, ...others], `o:${pair.term}`);
    return q({ type: 'single', stem: `「${pair.desc.replace(pair.term, '____')}」说的是哪一项？`, options, answer: [options.indexOf(pair.term)], explanation: `${pair.term}：${pair.desc}`, difficulty: 2 });
  }) : [];
  const truefalse = found.map((pair, index) => {
    const other = found[(index + 1) % found.length];
    const swap = index % 2 === 1 && other && other.term !== pair.term && pair.desc.includes(pair.term);
    return q({
      type: 'truefalse',
      stem: swap ? pair.desc.replace(pair.term, other.term) : pair.desc,
      options: TRUE_FALSE,
      answer: [swap ? 1 : 0],
      explanation: swap ? `原文说的是「${pair.term}」：${pair.desc}` : '与材料原文一致。',
      difficulty: 1,
    });
  });
  const blank = found.map((pair) => q({
    type: 'blank',
    stem: pair.desc.includes(pair.term) ? pair.desc.replace(pair.term, '____') : `____：${pair.desc}`,
    answer: pair.term,
    explanation: `${pair.term}：${pair.desc}`,
    difficulty: 2,
  }));
  const short = found.map((pair) => q({ type: 'short', stem: `用自己的话解释：${pair.term}`, answer: pair.desc, explanation: '', difficulty: 3 }));
  return { single, multiple: [], truefalse, blank, short };
}

function localQuiz(input: GenInput, options: QuizOptions): QuizDraft {
  const { title, body } = gather(input);
  const pool = input.topic ? topicPool(input.topic) : textPool(body);
  const types = options.types.length ? options.types : QUESTION_TYPES.map((type) => type.value);
  const questions: QuizQuestion[] = [];
  const cursor: Partial<Record<QuestionType, number>> = {};
  // 按所选题型轮流取，取不到的题型跳过
  for (let guard = 0; questions.length < options.count && guard < options.count * types.length + types.length; guard += 1) {
    const type = types[guard % types.length];
    const index = cursor[type] ?? 0;
    const next = pool[type][index];
    cursor[type] = index + 1;
    if (next) questions.push(next);
  }
  if (!questions.length) {
    // 所选题型一题都凑不出时，退回任何能出的题
    for (const type of QUESTION_TYPES) questions.push(...pool[type.value]);
  }
  return { title: `${title} · 练习题${DEMO_SUFFIX}`, questions: questions.slice(0, options.count) };
}

export function generateQuiz(input: GenInput, options: QuizOptions): Promise<GenResult<QuizDraft>> {
  const { title, body } = gather(input);
  const typeNames = (options.types.length ? options.types : QUESTION_TYPES.map((type) => type.value)).join('、');
  const prompt = `依据下面的材料出 ${options.count} 道练习题，题型只用：${typeNames}（尽量均匀）。

输出 JSON：{"title":"题目集标题","questions":[{"type":"single|multiple|truefalse|blank|short","stem":"题干","options":["选项"],"answer":[0],"explanation":"解析","difficulty":1}]}
规则：
- single：4 个选项，answer 是 [正确选项下标]，下标从 0 开始。
- multiple：4–5 个选项，answer 是至少两个下标的数组。
- truefalse：options 固定为 ["正确","错误"]，answer 是 [0] 或 [1]。
- blank：题干用 ____ 标出一个空，不要 options，answer 是字符串。
- short：不要 options，answer 是 2–4 句参考答案字符串。
- explanation 说明为什么，指出常见错误；difficulty 取 1–3。选项不要带 A/B/C 前缀。${withExtra(input.instruction)}

材料《${title}》：
${body}`;
  return run(input, prompt, (raw) => {
    const data = rec(raw);
    const questions = arr(data.questions ?? data.items)
      .map(normaliseQuestion)
      .filter((question): question is QuizQuestion => question !== null)
      .slice(0, 40);
    return questions.length ? { title: str(data.title, 60) || `${title} · 练习题`, questions } : null;
  }, () => localQuiz(input, options), 4200);
}

/* ══════════ 闪卡 ══════════ */
export interface DeckDraft { title: string; cards: Flashcard[] }

function localDeck(input: GenInput, count: number): DeckDraft {
  const { topic } = input;
  const { title, body } = gather(input);
  const cards: Flashcard[] = [];
  if (topic) {
    for (const item of topic.checklist) cards.push(newCard(`请讲清楚：${item.point}`, item.groundTruth));
    for (const item of topic.misconceptions) cards.push(newCard(`对还是错：${item.probe.statement}`, `错。${item.probe.explanation}`));
    for (const item of topic.checklist) for (const term of item.terms.slice(0, 1)) cards.push(newCard(`「${term}」在「${item.point}」里指什么？`, item.groundTruth));
    for (const item of topic.quizBank) cards.push(newCard(item.question, `${item.options[item.answerIndex] ?? ''}\n\n${item.explanation}`.trim()));
  } else {
    for (const pair of pairs(body)) cards.push(newCard(pair.term, pair.desc));
  }
  return { title: `${title} · 闪卡${DEMO_SUFFIX}`, cards: cards.slice(0, count) };
}

export function generateDeck(input: GenInput, count: number): Promise<GenResult<DeckDraft>> {
  const { title, body } = gather(input);
  const prompt = `依据下面的材料做 ${count} 张记忆闪卡。

输出 JSON：{"title":"卡组标题","cards":[{"front":"问题或术语","back":"答案"}]}
要求：一张卡只考一个知识点；正面是一个明确的问题，不超过 40 字；背面 1–3 句，先给结论再给依据；覆盖定义、原理、易错点和例子；不要重复。公式写成 $...$。${withExtra(input.instruction)}

材料《${title}》：
${body}`;
  return run(input, prompt, (raw) => {
    const data = rec(raw);
    const cards = arr(data.cards ?? data.items).flatMap((item) => {
      const card = rec(item);
      const front = str(card.front ?? card.question ?? card.q, 400);
      const back = str(card.back ?? card.answer ?? card.a, 1200);
      return front && back ? [newCard(front, back)] : [];
    }).slice(0, 60);
    return cards.length ? { title: str(data.title, 60) || `${title} · 闪卡`, cards } : null;
  }, () => localDeck(input, count));
}

/* ══════════ 待办 ══════════ */
export interface TodoDraft { text: string; due?: string }

function localTodos(input: GenInput): TodoDraft[] {
  const { topic } = input;
  const { title, body } = gather(input);
  const due = (days: number) => dayKey(addDays(days));
  if (topic) {
    return [
      { text: `通读《${topic.title}》讲义，划出不懂的地方`, due: due(0) },
      ...topic.checklist.slice(0, 3).map((item, index) => ({ text: `弄懂并能复述：${item.point}`, due: due(index < 2 ? 0 : 1) })),
      ...(topic.misconceptions[0] ? [{ text: `想清楚为什么这句话不对：${clip(topic.misconceptions[0].belief, 28)}`, due: due(1) }] : []),
      { text: `做一组《${topic.title}》练习题，整理错题`, due: due(1) },
      { text: `把《${topic.title}》讲给小白听`, due: due(2) },
      { text: `复习《${topic.title}》的闪卡`, due: due(3) },
    ];
  }
  const heads = sections(body).map((section) => section.title).filter((head) => head && head !== '补充文字').slice(0, 3);
  return [
    { text: `通读《${title}》，划出不懂的地方`, due: due(0) },
    ...heads.map((head, index) => ({ text: `弄懂并能复述：${clip(head, 24)}`, due: due(index ? 1 : 0) })),
    { text: `为《${title}》整理一页要点笔记`, due: due(1) },
    { text: `做一组《${title}》练习题，整理错题`, due: due(2) },
    { text: `不看材料，把《${title}》讲一遍`, due: due(3) },
  ];
}

export function generateTodos(input: GenInput): Promise<GenResult<TodoDraft[]>> {
  const { title, body } = gather(input);
  const prompt = `依据下面的材料，为学生排一份这几天的学习待办。

输出 JSON：{"todos":[{"text":"待办内容","dueInDays":0}]}
要求：5–7 条；动词开头，具体到要做的事，每条 28 字以内，30–60 分钟能完成；按先理解、再练习、再讲出来的顺序；dueInDays 是 0–7 的整数（0 表示今天）。${withExtra(input.instruction)}

材料《${title}》：
${body}`;
  return run(input, prompt, (raw) => {
    const todos = arr(rec(raw).todos ?? rec(raw).items ?? raw).flatMap((item): TodoDraft[] => {
      const data = rec(item);
      const text = typeof item === 'string' ? item.trim() : str(data.text ?? data.title ?? data.task, 80);
      if (!text) return [];
      const hasDue = data.dueInDays !== undefined || data.due !== undefined;
      const days = clampInt(data.dueInDays ?? data.due, 0, 30, 0);
      return [{ text: clip(text, 80), ...(hasDue ? { due: dayKey(addDays(days)) } : {}) }];
    }).slice(0, 10);
    return todos.length ? todos : null;
  }, () => localTodos(input), 1200);
}

/* ══════════ 作文批改与翻译练习 ══════════ */
export interface ReviewResult { score: number; feedback: string }

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ').trim() || '—';
const bullets = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
const cjkRatio = (text: string) => (text.match(/[一-鿿]/g)?.length ?? 0) / Math.max(1, text.replace(/\s/g, '').length);
const DEMO_NOTE = '> **本地演示**：当前没有可用模型，下面是按规则做的检查，不含对内容的理解。';

/** 取批改意见里某一节的正文（如「参考译文」「修改稿」），供对照视图使用 */
export function feedbackSection(feedback: string | undefined, heading: string): string {
  if (!feedback) return '';
  const lines = feedback.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{1,4}\\s*${heading}\\s*$`).test(line.trim()));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？!?])|(?<=\.)\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

function localEssay(prompt: string, essay: string): ReviewResult {
  const english = cjkRatio(essay) < 0.3;
  const words = countWords(essay);
  const paragraphs = essay.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
  const all = splitSentences(essay);
  const lengths = all.map((sentence) => countWords(sentence));
  const average = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const longLimit = english ? 34 : 60;
  const long = all.filter((_, index) => lengths[index] > longLimit);
  const connectives = (essay.match(english
    ? /\b(however|therefore|moreover|furthermore|firstly|secondly|finally|in addition|for example|in conclusion|on the other hand|as a result)\b/gi
    : /首先|其次|再次|最后|然而|但是|因此|所以|此外|另外|例如|比如|总之|综上|由此可见|换句话说/g) ?? []).length;
  const tokens = english ? (essay.toLowerCase().match(/[a-z]{4,}/g) ?? []) : (essay.match(/[一-鿿]{2}/g) ?? []);
  const stop = new Set(['that', 'this', 'with', 'have', 'from', 'they', 'their', 'there', 'which', 'will', 'would', 'about', 'because', 'people', 'more', 'also', 'been', 'what', 'when', 'some', 'them', 'than', 'should', 'could', '我们', '可以', '一个', '这个', '因为', '所以', '他们', '自己', '没有', '什么', '就是', '但是']);
  const freq = new Map<string, number>();
  for (const token of tokens) if (!stop.has(token)) freq.set(token, (freq.get(token) ?? 0) + 1);
  const repeated = [...freq.entries()].filter(([, count]) => count >= (english ? 5 : 6)).sort((a, b) => b[1] - a[1]).slice(0, 4);
  // 中文没有可靠的分词，题目关键词的覆盖只在英文作文里检查
  const keys = english ? [...new Set(prompt.toLowerCase().match(/[a-z]{5,}/g) ?? [])].filter((key) => !stop.has(key)).slice(0, 12) : [];
  const covered = keys.filter((key) => essay.toLowerCase().includes(key));

  const strengths: string[] = [];
  const issues: Record<string, string[]> = {};
  const issue = (category: string, text: string) => { (issues[category] ??= []).push(text); };
  let score = 74;

  if (paragraphs.length >= 3) { strengths.push(`分了 ${paragraphs.length} 段，有开头、展开和收束的层次。`); score += 4; }
  else { issue('结构', `全文只有 ${paragraphs.length} 段。至少分成开头、主体、结尾三段，一段只讲一层意思。`); score -= 6; }
  if (connectives >= 3) { strengths.push(`用了 ${connectives} 处衔接词，句与句之间的关系交代得清楚。`); score += 3; }
  else { issue('结构', '衔接词偏少。在转折、因果、举例处补上衔接词，读者更容易跟上思路。'); score -= 3; }
  if (keys.length >= 3) {
    if (covered.length / keys.length >= 0.5) { strengths.push('正文多次回应了题目里的关键词，没有跑题的迹象。'); score += 3; }
    else { issue('内容', `题目里的关键词只回应了 ${covered.length}/${keys.length} 个，检查是否有要求没有写到。`); score -= 5; }
  }
  const target = english ? 120 : 300;
  if (words < target) { issue('内容', `全文约 ${words} ${english ? '词' : '字'}，偏短。给每个观点补一个具体的例子或理由。`); score -= 8; }
  else strengths.push(`全文约 ${words} ${english ? '词' : '字'}，篇幅足够展开论述。`);
  if (long.length) { issue('语言', `有 ${long.length} 句超过 ${longLimit} ${english ? '词' : '字'}，读起来吃力，拆成两句更清楚。`); score -= Math.min(6, long.length * 2); }
  if (average && average < (english ? 9 : 14)) issue('语言', '句子普遍偏短，像提纲。把相关的短句合并，写出它们之间的关系。');
  if (repeated.length) { issue('用词', `这些词出现得很密：${repeated.map(([word, count]) => `${word}（${count} 次）`).join('、')}。换用同义表达或代词。`); score -= 3; }

  let revised = essay.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const fixes: string[] = [];
  if (english) {
    const before = revised;
    revised = revised
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ')
      .replace(/(^|[.!?]\s+|\n)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
      .replace(/\bi\b/g, 'I');
    if (before !== revised) { fixes.push('标点前后空格、句首大写、单独的 i 已按规范改正。'); score -= 2; }
  } else {
    const before = revised;
    revised = revised.replace(/([一-鿿])\s*,\s*/g, '$1，').replace(/([一-鿿])\s*;\s*/g, '$1；').replace(/([一-鿿])\s*\?/g, '$1？').replace(/([一-鿿])\s*!/g, '$1！').replace(/([一-鿿])\s*:\s*/g, '$1：');
    if (before !== revised) { fixes.push('中文句子里的半角标点已改成全角。'); score -= 2; }
  }
  if (fixes.length) issue('规范', fixes.join(' '));
  score = Math.min(92, Math.max(45, Math.round(score)));

  const rows = long.slice(0, 3).map((sentence) => {
    const middle = Math.floor(sentence.length / 2);
    const cut = sentence.slice(middle).search(/[，,；;]/);
    const at = cut < 0 ? -1 : middle + cut;
    const better = at < 0 ? '在意思转折处断成两句' : `${sentence.slice(0, at)}${english ? '.' : '。'} ${sentence.slice(at + 1).trim().replace(/^[a-z]/, (letter) => letter.toUpperCase())}`;
    return `| ${cell(sentence)} | ${cell(better)} | 句子过长，一句只说一件事 |`;
  });

  const feedback = [
    DEMO_NOTE,
    `## 总评\n\n全文约 ${words} ${english ? '词' : '字'}，${paragraphs.length} 段，${all.length} 句，平均每句 ${average.toFixed(0)} ${english ? '词' : '字'}。${Object.keys(issues).length ? `主要可以改进的是${Object.keys(issues).join('、')}。` : '规则检查没有发现明显问题。'}`,
    strengths.length ? `## 亮点\n\n${bullets(strengths)}` : '',
    Object.keys(issues).length ? `## 问题\n\n${Object.entries(issues).map(([category, items]) => `### ${category}\n\n${bullets(items)}`).join('\n\n')}` : '',
    rows.length ? `## 逐句建议\n\n| 原句 | 建议改为 | 理由 |\n| --- | --- | --- |\n${rows.join('\n')}` : '',
    `## 修改稿\n\n${revised}`,
  ].filter(Boolean).join('\n\n');
  return { score, feedback };
}

export async function reviewEssay(input: { prompt: string; essay: string; local?: boolean; signal?: AbortSignal }): Promise<GenResult<ReviewResult>> {
  const prompt = `批改下面这篇学生作文。先判断语种，用作文的语种写修改稿，其余意见用简体中文。

输出 JSON：{"score":0,"summary":"两三句总评","strengths":["亮点"],"issues":[{"category":"内容|结构|语言|语法|用词","problem":"问题","suggestion":"怎么改"}],"sentences":[{"original":"原句","revised":"改写后的句子","reason":"原因"}],"revised":"完整修改稿"}
要求：score 是 0–100 的整数；strengths 2–3 条；issues 3–6 条，具体到段落或句子；sentences 挑 3–6 句最值得改的，original 必须是原文里的原句；revised 保留作者的观点和结构，只改表达。

作文题目与要求：
${input.prompt.trim().slice(0, 1500) || '（未提供）'}

学生作文：
${input.essay.trim().slice(0, 6000)}`;
  return run({ sources: [], local: input.local, signal: input.signal }, prompt, (raw) => {
    const data = rec(raw);
    const summary = str(data.summary ?? data.overall, 800);
    const revised = str(data.revised ?? data.revision, 8000);
    if (!summary && !revised) return null;
    const strengths = arr(data.strengths).map((item) => str(item, 300)).filter(Boolean).slice(0, 5);
    const grouped = new Map<string, string[]>();
    for (const item of arr(data.issues).slice(0, 10)) {
      const entry = rec(item);
      const problem = typeof item === 'string' ? item.trim() : str(entry.problem ?? entry.issue, 400);
      if (!problem) continue;
      const category = str(entry.category, 10) || '语言';
      const suggestion = str(entry.suggestion ?? entry.fix, 400);
      grouped.set(category, [...(grouped.get(category) ?? []), suggestion ? `${problem}\n  - 建议：${suggestion}` : problem]);
    }
    const rows = arr(data.sentences).slice(0, 8).flatMap((item) => {
      const entry = rec(item);
      const original = str(entry.original, 400);
      const better = str(entry.revised ?? entry.better, 400);
      return original && better ? [`| ${cell(original)} | ${cell(better)} | ${cell(str(entry.reason, 300))} |`] : [];
    });
    const feedback = [
      summary ? `## 总评\n\n${summary}` : '',
      strengths.length ? `## 亮点\n\n${bullets(strengths)}` : '',
      grouped.size ? `## 问题\n\n${[...grouped.entries()].map(([category, items]) => `### ${category}\n\n${bullets(items)}`).join('\n\n')}` : '',
      rows.length ? `## 逐句建议\n\n| 原句 | 建议改为 | 理由 |\n| --- | --- | --- |\n${rows.join('\n')}` : '',
      revised ? `## 修改稿\n\n${revised}` : '',
    ].filter(Boolean).join('\n\n');
    return { score: clampInt(data.score, 0, 100, 70), feedback };
  }, () => localEssay(input.prompt, input.essay), 4200);
}

function localTranslation(source: string, draft: string): ReviewResult {
  const toChinese = cjkRatio(source) < 0.3;
  const sourceUnits = toChinese ? countWords(source) : (source.match(/[一-鿿]/g)?.length ?? 0);
  const draftUnits = toChinese ? (draft.match(/[一-鿿]/g)?.length ?? 0) : countWords(draft);
  const ratio = sourceUnits ? draftUnits / sourceUnits : 0;
  const [low, high] = toChinese ? [1.2, 2.4] : [0.42, 0.9];
  const tips: string[] = [];
  const good: string[] = [];
  let score = 78;

  const numbers = [...new Set(source.match(/\d+(?:[.,]\d+)*%?/g) ?? [])];
  const missing = numbers.filter((number) => !draft.includes(number));
  if (numbers.length && !missing.length) good.push('原文里的数字都保留在了译文里。');
  if (missing.length) { tips.push(`这些数字在译文里没有找到：${missing.join('、')}。核对是否漏译或写成了文字。`); score -= Math.min(10, missing.length * 4); }
  if (ratio && ratio < low) { tips.push(`译文明显偏短（长度比 ${ratio.toFixed(2)}，常见范围 ${low}–${high}），可能有漏译。`); score -= 10; }
  else if (ratio > high) { tips.push(`译文明显偏长（长度比 ${ratio.toFixed(2)}，常见范围 ${low}–${high}），检查有没有添加原文没有的意思。`); score -= 6; }
  else if (ratio) good.push(`译文长度与原文相称（长度比 ${ratio.toFixed(2)}）。`);
  const leftover = toChinese
    ? [...new Set(draft.match(/[A-Za-z]{4,}/g) ?? [])].filter((word) => source.includes(word)).slice(0, 6)
    : [...new Set(draft.match(/[一-鿿]{2,}/g) ?? [])].slice(0, 6);
  if (leftover.length) { tips.push(`译文里还留着原文的词：${leftover.join('、')}。专有名词可以保留，普通词应当译出。`); score -= Math.min(8, leftover.length * 2); }

  const a = splitSentences(source);
  const b = splitSentences(draft);
  if (a.length === b.length) good.push(`句数与原文一致（${a.length} 句），断句没有丢。`);
  else { tips.push(`原文 ${a.length} 句，译文 ${b.length} 句。合并或拆分句子没有问题，但要确认每一句的意思都还在。`); score -= 3; }
  const rows = a.slice(0, 8).map((sentence, index) => {
    const mine = b[index] ?? '';
    const su = toChinese ? countWords(sentence) : (sentence.match(/[一-鿿]/g)?.length ?? 0);
    const mu = toChinese ? (mine.match(/[一-鿿]/g)?.length ?? 0) : countWords(mine);
    const r = su ? mu / su : 0;
    const note = !mine ? '没有对应的译文' : r < low * 0.7 ? '偏短，核对是否漏译' : r > high * 1.3 ? '偏长，核对是否添加了意思' : '长度相称';
    return `| ${cell(sentence)} | ${cell(mine)} | ${note} |`;
  });
  score = Math.min(90, Math.max(40, Math.round(score)));

  const feedback = [
    DEMO_NOTE,
    `## 总评\n\n${toChinese ? '英译中' : '中译英'}，原文 ${a.length} 句。${tips.length ? `规则检查发现 ${tips.length} 处需要核对。` : '规则检查没有发现明显问题。'}连接模型后可以得到参考译文和逐句讲评。`,
    good.length ? `## 做得好的地方\n\n${bullets(good)}` : '',
    tips.length ? `## 需要核对\n\n${bullets(tips)}` : '',
    rows.length ? `## 逐句对照\n\n| 原文 | 我的译法 | 检查 |\n| --- | --- | --- |\n${rows.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { score, feedback };
}

export async function reviewTranslation(input: { source: string; draft: string; local?: boolean; signal?: AbortSignal }): Promise<GenResult<ReviewResult>> {
  const prompt = `讲评下面这段翻译练习。判断翻译方向（英译中或中译英），意见用简体中文写。

输出 JSON：{"score":0,"summary":"两三句总评","reference":"完整的参考译文","items":[{"source":"原文片段","mine":"学生的译法","better":"更好的译法","reason":"说明"}],"tips":["可迁移的翻译方法"]}
要求：score 是 0–100 的整数；reference 忠实、通顺，与学生译文同一语种；items 挑 3–6 处最值得讲的，覆盖误译、漏译、搭配和语序，mine 必须是学生译文里的原话；tips 2–3 条。

原文：
${input.source.trim().slice(0, 4000)}

学生译文：
${input.draft.trim().slice(0, 4000)}`;
  return run({ sources: [], local: input.local, signal: input.signal }, prompt, (raw) => {
    const data = rec(raw);
    const reference = str(data.reference ?? data.translation, 6000);
    const summary = str(data.summary ?? data.overall, 800);
    if (!reference && !summary) return null;
    const rows = arr(data.items ?? data.issues).slice(0, 8).flatMap((item) => {
      const entry = rec(item);
      const mine = str(entry.mine ?? entry.original, 400);
      const better = str(entry.better ?? entry.revised, 400);
      return mine && better ? [`| ${cell(str(entry.source, 400))} | ${cell(mine)} | ${cell(better)} | ${cell(str(entry.reason, 300))} |`] : [];
    });
    const tips = arr(data.tips).map((item) => str(item, 300)).filter(Boolean).slice(0, 5);
    const feedback = [
      summary ? `## 总评\n\n${summary}` : '',
      reference ? `## 参考译文\n\n${reference}` : '',
      rows.length ? `## 逐句对照\n\n| 原文 | 我的译法 | 更好的译法 | 说明 |\n| --- | --- | --- | --- |\n${rows.join('\n')}` : '',
      tips.length ? `## 方法提示\n\n${bullets(tips)}` : '',
    ].filter(Boolean).join('\n\n');
    return { score: clampInt(data.score, 0, 100, 70), feedback };
  }, () => localTranslation(input.source, input.draft), 3600);
}

/* ── 对照视图用的差异计算（按词 / 按字的最长公共子序列） ── */
export interface DiffPart { kind: 'same' | 'del' | 'add'; text: string }
const tokenize = (text: string) => text.match(/[A-Za-z0-9'’-]+|\s+|[\s\S]/g) ?? [];

export function diffText(before: string, after: string): DiffPart[] | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (!a.length || !b.length || a.length * b.length > 2_400_000) return null;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text; else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { push('del', a[i]); i += 1; }
    else { push('add', b[j]); j += 1; }
  }
  while (i < a.length) { push('del', a[i]); i += 1; }
  while (j < b.length) { push('add', b[j]); j += 1; }
  return parts;
}
