/**
 * 工作台里「就地用 AI」的那一层：笔记的改写与斜杠命令、导图节点、错题讲解、闪卡提示、待办拆解、侧栏问答。
 * 都是纯函数：有模型时用 streamModel 流式输出；没有模型（ModelUnavailableError）时按规则从手头的内容里取，
 * 结果带 local=true，由界面标「本地演示」。不依赖 React。
 */
import type { Activity } from '../../../../engine/activityLog';
import { ACTIVITY_LABELS } from '../../../../engine/activityLog';
import type { NotebookSource } from '../../../../engine/notebookSources';
import { completeJson, streamModel, type ChatMessage, type Effort } from '../../../../lib/modelGateway';
import { dueCards, mindNode, newCard, newId, type Deck, type Flashcard, type MindNode, type QuestionType, type QuizQuestion, type StudyData, type Todo } from '../../../../store/studyData';
import type { Topic } from '../../../../types';
import { QUESTION_TYPES, TRUE_FALSE, feedbackSection, generateQuiz, isUnavailable, normaliseQuestion, pairs, sections, sentences, shuffle, stripMd } from './generate';
import { addDays, clip, dayKey, dueDay } from './util';

export interface AiOutcome {
  text: string;
  /** 没有模型，按规则给出的 */
  local: boolean;
  model?: string;
  /** 给用户看的一句说明（本地演示做了什么、没做什么） */
  note?: string;
}
export interface AiCall { signal?: AbortSignal; onText?: (text: string) => void }
export type AiTask = (call: AiCall) => Promise<AiOutcome>;

export function aiErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'ai-empty') return '这里还没有可以处理的内容。先写几句，或者打开一门课。';
  if (message === 'gen-empty') return '内容太少，没能整理出东西。';
  if (message === 'model-auth') return '登录已失效，重新登录后再试。';
  if (message === 'model-busy') return '模型正忙，过一会儿再试。';
  if (message === 'model-timeout') return '模型响应超时，可以再试一次。';
  return '这次没有成功：模型没有返回可用的内容。可以再试一次。';
}

/* ── 调用 ── */
const SYSTEM = '你是大学课程助教「小砚」，在学生的学习工作台里帮忙。只依据给出的内容，不编造其中没有的事实。直接给出结果本身，用简体中文（翻译除外）和 Markdown，公式写成 $...$。不寒暄，不解释你做了什么，不要用代码围栏包住整段输出。';

function tidyOutput(text: string): string {
  const out = text.trim();
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(out);
  return fenced ? fenced[1].trim() : out;
}

const stopped = () => new DOMException('Stopped', 'AbortError');
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(stopped()); return; }
  const onAbort = () => { clearTimeout(timer); reject(stopped()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

interface Local { text: string; note?: string }
interface AskOptions { maxTokens?: number; temperature?: number; system?: string; history?: ChatMessage[]; effort?: Effort }

async function ask(user: string, call: AiCall, local: () => Local, options: AskOptions = {}): Promise<AiOutcome> {
  try {
    const result = await streamModel({
      messages: [{ role: 'system', content: options.system ?? SYSTEM }, ...(options.history ?? []), { role: 'user', content: user }],
      maxTokens: options.maxTokens ?? 1200,
      temperature: options.temperature ?? 0.5,
      ...(options.effort ? { effort: options.effort } : {}),
      signal: call.signal,
      onText: (text) => call.onText?.(text),
    });
    const text = tidyOutput(result.text);
    if (!text) throw new Error('model-empty');
    return { text, local: false, model: result.model };
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    // 留一拍「正在想」，本地结果不至于一闪就出来
    await wait(220, call.signal);
    const fallback = local();
    return { text: fallback.text.trim(), local: true, ...(fallback.note ? { note: fallback.note } : {}) };
  }
}

/* ── 上下文 ── */
export interface AiContext {
  noteTitle?: string;
  /** 本篇笔记正文 */
  noteBody?: string;
  topic?: Topic;
  sources?: NotebookSource[];
}

const topicDigest = (topic: Topic) => [
  topic.tagline,
  ...topic.checklist.map((item) => `- ${item.point}：${item.groundTruth}`),
  ...topic.misconceptions.map((item) => `- 常见误区：${item.belief}`),
].filter(Boolean).join('\n');

function contextBlock(context: AiContext): string {
  const parts: string[] = [];
  if (context.noteBody?.trim()) parts.push(`【本篇笔记《${context.noteTitle || '未命名'}》】\n${clip(context.noteBody.trim(), 5000)}`);
  if (context.topic) parts.push(`【当前课程《${context.topic.title}》】\n${topicDigest(context.topic)}`);
  const sources = (context.sources ?? []).filter((source) => source.content.trim());
  if (sources.length) parts.push(`【已选资料】\n${sources.slice(0, 4).map((source) => `《${source.title}》\n${clip(source.content.trim(), 1800)}`).join('\n\n')}`);
  return parts.join('\n\n');
}
const withContext = (prompt: string, context: AiContext) => {
  const block = contextBlock(context);
  return block ? `${prompt}\n\n可以参考的上下文：\n${block}` : prompt;
};
/** 本地降级时能翻的全部文字 */
const contextText = (context: AiContext) => [
  context.noteBody ?? '',
  context.topic ? `${topicDigest(context.topic)}\n${context.topic.prep.microLecture.body}` : '',
  ...(context.sources ?? []).map((source) => source.content),
].filter((text) => text.trim()).join('\n\n');

/* ── 关键词相关度（本地降级用） ── */
function termsOf(text: string): Set<string> {
  const out = new Set<string>(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
  for (const run of text.match(/[一-鿿]+/g) ?? []) for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  return out;
}
function related(query: string, haystack: string, limit: number, exclude = ''): string[] {
  const wanted = termsOf(query);
  if (!wanted.size) return [];
  const seen = new Set<string>();
  return sentences(haystack)
    .filter((sentence) => { if (seen.has(sentence) || exclude.includes(sentence)) return false; seen.add(sentence); return true; })
    .map((sentence, index) => ({ sentence, index, score: [...termsOf(sentence)].filter((term) => wanted.has(term)).length }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.sentence);
}
const cjkShare = (text: string) => (text.match(/[一-鿿]/g)?.length ?? 0) / Math.max(1, text.replace(/\s/g, '').length);
const DEMO = '本地演示：';

/* ══════════ 笔记：改写、斜杠命令、问 AI ══════════ */
export type TextAction =
  | 'polish' | 'expand' | 'shorten' | 'explain' | 'translate' | 'continue'
  | 'summarize' | 'outline' | 'table' | 'formula' | 'flowchart' | 'example' | 'selftest' | 'ask';

export const TEXT_ACTIONS: Record<TextAction, { label: string; doing: string }> = {
  polish: { label: '润色', doing: '正在润色' },
  expand: { label: '扩写', doing: '正在扩写' },
  shorten: { label: '精简', doing: '正在精简' },
  explain: { label: '解释', doing: '正在解释' },
  translate: { label: '翻译', doing: '正在翻译' },
  continue: { label: '续写', doing: '正在续写' },
  summarize: { label: '总结上文', doing: '正在总结' },
  outline: { label: '列提纲', doing: '正在列提纲' },
  table: { label: '生成表格', doing: '正在整理成表格' },
  formula: { label: '写公式', doing: '正在写公式' },
  flowchart: { label: '画流程图', doing: '正在画流程图' },
  example: { label: '举例', doing: '正在找例子' },
  selftest: { label: '出自测题', doing: '正在出自测题' },
  ask: { label: '问 AI', doing: '正在思考' },
};
/** 结果用来替换选区的动作；其余的是往下加内容 */
export const REPLACING: TextAction[] = ['polish', 'expand', 'shorten', 'translate'];

export interface TextInput {
  /** 选中的文字 */
  selection?: string;
  /** 光标之前的正文 */
  before?: string;
  /** 「问 AI」里用户写的要求 */
  instruction?: string;
  context: AiContext;
}

function subjectOf(input: TextInput): string {
  const selected = input.selection?.trim();
  if (selected) return clip(selected, 4000);
  const before = input.before?.trim() ?? '';
  if (before.length >= 40) return before.slice(-3000);
  const note = (input.context.noteBody ?? '').trim() || before;
  if (note) return clip(note, 3000);
  return input.context.topic ? `${input.context.topic.title}\n${topicDigest(input.context.topic)}` : '';
}

const sentencePieces = (text: string) => text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];

function tidyText(text: string): string {
  let out = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/([。，！？；：])\1+/g, '$1');
  if (/```/.test(out)) return out;
  if (cjkShare(out) < 0.3) {
    out = out
      .replace(/ +([,.;:!?])/g, '$1')
      .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ')
      .replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
      .replace(/\bi\b/g, 'I');
  } else {
    out = out
      .replace(/([一-鿿])\s*,\s*/g, '$1，')
      .replace(/([一-鿿])\s*;\s*/g, '$1；')
      .replace(/([一-鿿])\s*\?/g, '$1？')
      .replace(/([一-鿿])\s*!/g, '$1！')
      .replace(/([一-鿿]) +(?=[一-鿿])/g, '$1');
  }
  return out;
}

function shortenText(text: string): string {
  return text.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    if (/^\s*(#|```|\||\$\$)/.test(lines[0])) return block;
    if (lines.every((line) => /^\s*(?:[-*+•]|\d+[.)、])\s/.test(line))) return lines.slice(0, Math.max(2, Math.ceil(lines.length / 2))).join('\n');
    const pieces = sentencePieces(block);
    if (pieces.length <= 1) return block;
    const budget = Math.ceil(block.length / 2);
    const kept: string[] = [];
    for (const piece of pieces) {
      if (kept.length && kept.join('').length + piece.length > budget) break;
      kept.push(piece);
    }
    return kept.join('');
  }).join('\n\n');
}

function flowchart(steps: string[]): string {
  const label = (step: string) => clip(stripMd(step).replace(/["'“”‘’()（）[\]{}<>|]/g, '').replace(/\s+/g, ' ').trim(), 16);
  const nodes = steps.map(label).filter(Boolean).slice(0, 7);
  return ['```mermaid', 'flowchart TD', ...nodes.map((text, index) => `  n${index}["${text}"]`), ...nodes.slice(1).map((_, index) => `  n${index} --> n${index + 1}`), '```'].join('\n');
}

function localText(action: TextAction, input: TextInput, subject: string): Local {
  const { context } = input;
  const all = contextText(context);
  const pool = `${subject}\n\n${all}`;
  switch (action) {
    case 'polish': {
      const text = tidyText(subject);
      return text === subject
        ? { text, note: `${DEMO}按规则检查了标点和空格，没有需要改的地方。连接模型后才会改写句子。` }
        : { text, note: `${DEMO}只按规则改了标点和空格。连接模型后才会改写句子。` };
    }
    case 'shorten':
      return { text: shortenText(subject), note: `${DEMO}每段留下开头的句子、列表留下前半，没有重写。` };
    case 'expand': {
      const more = related(subject, all, 3, subject);
      return more.length
        ? { text: `${subject}\n\n${more.map((sentence) => `- ${sentence}`).join('\n')}`, note: `${DEMO}从笔记和课程里按关键词补了相关的句子，没有重写原文。` }
        : { text: `${subject}\n\n- 原因：\n- 例子：\n- 容易混的地方：`, note: `${DEMO}没有找到可以补充的内容，先留了三个待填的空。` };
    }
    case 'translate':
      return { text: '', note: '本地演示没有翻译能力。连接模型后，这里会给出译文。' };
    case 'explain': {
      const found = pairs(pool).filter((pair) => subject.includes(pair.term)).slice(0, 4);
      const more = related(subject, all, 2, subject);
      if (found.length || more.length) {
        return {
          text: [...found.map((pair) => `- **${pair.term}**：${pair.desc}`), ...more.map((sentence) => `- ${sentence}`)].join('\n'),
          note: `${DEMO}这是从笔记和课程里按关键词找到的相关内容，不是模型的讲解。`,
        };
      }
      const pieces = sentences(subject).slice(0, 5);
      return pieces.length
        ? { text: `这段话可以拆成 ${pieces.length} 层意思：\n\n${pieces.map((piece, index) => `${index + 1}. ${piece}`).join('\n')}`, note: `${DEMO}只把句子拆开了，没有讲解。连接模型后可以得到解释和例子。` }
        : { text: '', note: '本地演示没有找到可以解释的内容。连接模型后可以直接讲解。' };
    }
    case 'continue': {
      const written = `${context.noteBody ?? ''}\n${input.before ?? ''}`;
      const points = context.topic?.checklist.filter((item) => !written.includes(item.point)).slice(0, 3) ?? [];
      if (points.length) return { text: points.map((item) => `**${item.point}**：${item.groundTruth}`).join('\n\n'), note: `${DEMO}接上了本课里笔记还没写到的要点。` };
      const next = related(subject.slice(-300), all, 3, written);
      return next.length
        ? { text: next.join(''), note: `${DEMO}从课程和资料里接了相关的句子。` }
        : { text: '- 用一句话概括上面的内容：\n- 举一个例子：\n- 还不确定的地方：', note: `${DEMO}没有可以接着写的材料，先留了三个待填的空。` };
    }
    case 'summarize': {
      const titled = sections(subject).filter((section) => section.title && section.lines.length);
      const lines = titled.length >= 2
        ? titled.slice(0, 5).map((section) => `- **${section.title}**：${sentences(section.lines.join('\n'))[0] ?? clip(stripMd(section.lines[0]).trim(), 60)}`)
        : sentences(subject).slice(0, 4).map((sentence) => `- ${sentence}`);
      return lines.length ? { text: lines.join('\n'), note: `${DEMO}取了每一节开头的句子。` } : { text: '', note: '上文太短，没有可以总结的内容。' };
    }
    case 'outline': {
      const titled = sections(subject).filter((section) => section.title);
      if (titled.length >= 2) {
        return {
          text: titled.slice(0, 8).map((section) => [`- ${section.title}`, ...sentences(section.lines.join('\n')).slice(0, 2).map((sentence) => `  - ${clip(sentence, 32)}`)].join('\n')).join('\n'),
          note: `${DEMO}按小标题列的提纲。`,
        };
      }
      const found = pairs(subject).slice(0, 8);
      const lines = found.length >= 3 ? found.map((pair) => `- ${pair.term}\n  - ${clip(pair.desc, 32)}`) : sentences(subject).slice(0, 6).map((sentence) => `- ${clip(sentence, 32)}`);
      return lines.length ? { text: lines.join('\n'), note: `${DEMO}按关键词列的提纲。` } : { text: '', note: '上文太短，列不出提纲。' };
    }
    case 'table': {
      const found = pairs(subject).slice(0, 8);
      const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
      return found.length >= 2
        ? { text: `| 概念 | 说明 |\n| --- | --- |\n${found.map((pair) => `| ${cell(pair.term)} | ${cell(pair.desc)} |`).join('\n')}`, note: `${DEMO}把上文里「术语：解释」这样的内容排成了表。` }
        : { text: '| 对比项 |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |', note: `${DEMO}上文里没有找到成对的内容，先放了一张空表。` };
    }
    case 'formula': {
      const found = [...new Set(pool.match(/\$\$[\s\S]+?\$\$|\$[^$\n]{2,}\$/g) ?? [])].slice(0, 4);
      return found.length
        ? { text: found.map((math) => `$$\n${math.replace(/^\$+|\$+$/g, '').trim()}\n$$`).join('\n\n'), note: `${DEMO}把笔记和课程里已有的公式单独列了出来。` }
        : { text: '', note: '本地演示没有在上文和课程里找到公式。连接模型后可以按内容写出公式。' };
    }
    case 'flowchart': {
      const items = subject.split('\n').map((line) => /^\s*(?:[-*+•]|\d+[.)、])\s+(.+)$/.exec(line)?.[1] ?? '').filter(Boolean);
      const titles = sections(subject).map((section) => section.title).filter(Boolean);
      const steps = items.length >= 3 ? items : titles.length >= 3 ? titles : sentences(subject).slice(0, 5);
      return steps.length >= 2
        ? { text: flowchart(steps), note: `${DEMO}按上文里列表或小标题的先后顺序连成了流程。` }
        : { text: '', note: '上文太短，画不出流程。' };
    }
    case 'example': {
      const sample = context.topic?.prep.examples[0];
      if (sample) return { text: `**例：${sample.title}**\n\n${clip(stripMd(sample.walkthrough).trim(), 320)}`, note: `${DEMO}取自本课的例题。` };
      const hit = sentences(all).find((sentence) => /例如|比如|举例|例子|for example/i.test(sentence));
      return hit ? { text: hit, note: `${DEMO}在资料里找到的一个例子。` } : { text: '', note: '本地演示没有在资料里找到现成的例子。连接模型后可以举例。' };
    }
    case 'selftest': {
      const found = pairs(subject).slice(0, 3);
      if (found.length) return { text: found.map((pair) => `- [ ] 用自己的话解释：${pair.term}\n  - 答案：${pair.desc}`).join('\n'), note: `${DEMO}按上文里的关键词出的题。` };
      const checks = context.topic?.prep.selfCheck.slice(0, 3) ?? [];
      if (checks.length) return { text: checks.map((item) => `- [ ] ${item}`).join('\n'), note: `${DEMO}取自本课的自检问题。` };
      const pieces = sentences(subject).slice(0, 3);
      return pieces.length ? { text: pieces.map((piece) => `- [ ] 这句话对吗，为什么：${piece}`).join('\n'), note: `${DEMO}把上文的句子改成了判断题。` } : { text: '', note: '上文太短，出不了题。' };
    }
    case 'ask': {
      const hits = related(`${input.instruction ?? ''} ${input.selection ?? ''}`, pool, 3);
      return hits.length
        ? { text: `在笔记和课程里找到这些相关的内容：\n\n${hits.map((hit) => `> ${hit}`).join('\n>\n')}`, note: `${DEMO}只能按关键词查找，不是模型的回答。` }
        : { text: '', note: '本地演示只能按关键词查找，这次没有找到相关内容。连接模型后可以直接回答。' };
    }
  }
}

const TEXT_PROMPTS: Record<Exclude<TextAction, 'ask'>, { prompt: string; context: boolean; options?: AskOptions }> = {
  polish: { prompt: '润色下面这段笔记：改正错别字和病句，让表达更清楚；保持原意、原有的 Markdown 结构和大致长度。只输出润色后的文字。', context: false, options: { effort: 'none', temperature: 0.3 } },
  expand: { prompt: '把下面这段扩写得更充分：补上原因、步骤或一个例子，保持原来的观点和语气，长度约为原文的两倍。只输出扩写后的文字。', context: true },
  shorten: { prompt: '把下面这段精简到原来的一半以内，保留关键结论和术语，保持 Markdown 结构。只输出精简后的文字。', context: false, options: { effort: 'none', temperature: 0.3 } },
  explain: { prompt: '用通俗的话解释下面这段：先用一句话说清它在讲什么，再分点讲关键概念，最后给一个小例子。不超过 220 字。', context: true },
  translate: { prompt: '翻译下面这段：中文译成英文，其他语言译成中文。保留 Markdown 结构、公式和代码。只输出译文。', context: false, options: { effort: 'none', temperature: 0.2 } },
  continue: { prompt: '接着下面的笔记往下写一段（120–200 字）：承接上文的思路，不重复已经写过的内容。只输出续写的部分。', context: true },
  summarize: { prompt: '用 3–5 条要点总结下面的内容。只输出 Markdown 列表。', context: false },
  outline: { prompt: '为下面的内容列一份提纲：用嵌套列表，最多三层，每条不超过 16 个字。只输出列表。', context: false },
  table: { prompt: '把下面内容里可以对比或归类的部分整理成一张 Markdown 表格（2–4 列）。表格前用一句话说明它在比较什么。', context: false },
  formula: { prompt: '写出下面内容涉及的关键公式。每个公式单独用 $$...$$ 写一行，公式下面用一句话说明各个符号的含义。内容里没有可以写成公式的东西时，直接说明。', context: true },
  flowchart: { prompt: '把下面内容里的过程或因果关系画成一张流程图。只输出一个 ```mermaid 代码块，用 flowchart TD；节点写成 n1["文字"] 的形式，文字不超过 12 个字，不要用括号和引号。', context: false, options: { temperature: 0.2 } },
  example: { prompt: '为下面的内容举一个具体的例子（生活里的，或者带数字的），100–160 字。只输出例子。', context: true },
  selftest: { prompt: '依据下面的内容出 3 道自测题：每题用 - [ ] 开头；每题下面缩进一行写「答案：…」。只输出题目。', context: false },
};

export function runTextAction(action: TextAction, input: TextInput, call: AiCall): Promise<AiOutcome> {
  const subject = subjectOf(input);
  const instruction = input.instruction?.trim() ?? '';
  if (action === 'ask') {
    if (!instruction) return Promise.reject(new Error('ai-empty'));
    const selected = input.selection?.trim();
    const prompt = selected ? `${instruction}\n\n针对这段文字：\n${clip(selected, 4000)}` : instruction;
    return ask(withContext(prompt, input.context), call, () => localText(action, input, subject), { maxTokens: 1500 });
  }
  if (!subject) return Promise.reject(new Error('ai-empty'));
  const spec = TEXT_PROMPTS[action];
  // 处理的就是笔记本身时，不再把整篇笔记当上下文重复带一遍
  const context = spec.context ? (input.selection?.trim() ? input.context : { ...input.context, noteBody: undefined }) : {};
  const prompt = `${spec.prompt}${instruction ? `\n补充要求：${clip(instruction, 300)}` : ''}\n\n${subject}`;
  return ask(withContext(prompt, context), call, () => localText(action, input, subject), spec.options);
}

/* ══════════ 思维导图 ══════════ */
const kids = (node: MindNode): MindNode[] => (Array.isArray(node.children) ? node.children : []);
export function outlineOf(node: MindNode, depth = 0): string {
  return kids(node).map((child) => `${'  '.repeat(depth)}- ${child.text || '未命名'}${kids(child).length ? `\n${outlineOf(child, depth + 1)}` : ''}`).join('\n');
}
export function mapMarkdown(root: MindNode): string {
  return `# ${root.text || '未命名'}\n\n${outlineOf(root)}\n`;
}

/** 把缩进列表读成节点；一行没有列表符号时，每个非空行算一个节点 */
export function parseOutline(text: string): MindNode[] {
  const body = text.replace(/```[\s\S]*?```/g, '');
  const roots: MindNode[] = [];
  const stack: { indent: number; node: MindNode }[] = [];
  for (const raw of body.split('\n')) {
    const match = /^(\s*)(?:[-*+•]|\d+[.)、])\s+(.+)$/.exec(raw);
    if (!match) continue;
    const label = stripMd(match[2]).replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const indent = match[1].replace(/\t/g, '  ').length;
    const node = mindNode(clip(label, 80));
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent && stack.length < 6) parent.children.push(node); else roots.push(node);
    stack.push({ indent, node });
  }
  if (roots.length) return roots.slice(0, 16);
  return body.split('\n').map((line) => stripMd(line).trim()).filter((line) => line.length >= 2 && line.length <= 40).slice(0, 8).map((line) => mindNode(line));
}

export interface MapNodeInput {
  mapTitle: string;
  /** 从中心主题到这个节点的路径 */
  path: string[];
  node: MindNode;
  root: MindNode;
  context: AiContext;
}
export type MapAction = 'expand' | 'note' | 'prune' | 'reorder';
export const MAP_ACTIONS: Record<MapAction, { label: string; doing: string; accept: string }> = {
  expand: { label: 'AI 展开子节点', doing: '正在展开', accept: '加为子节点' },
  note: { label: '补充说明', doing: '正在写说明', accept: '设为说明' },
  prune: { label: '精简这一支', doing: '正在精简', accept: '替换这一支' },
  reorder: { label: '重排', doing: '正在重排', accept: '按这个顺序' },
};

export function runMapAction(action: MapAction, input: MapNodeInput, call: AiCall): Promise<AiOutcome> {
  const { node, path, context } = input;
  const where = `思维导图《${input.mapTitle || input.root.text}》里的节点「${node.text}」（位置：${path.join(' > ')}）`;
  const branch = outlineOf(node);
  const all = `${contextText(context)}\n${mapMarkdown(input.root)}`;
  if (action === 'expand') {
    const have = kids(node).map((child) => child.text);
    return ask(withContext(`${where}。${have.length ? `它已有子节点：${have.join('、')}。` : ''}为它补 3–5 个子节点：每行一个，用「- 」开头，每个不超过 14 个字，不要和已有的重复。只输出列表。`, context), call, () => {
      const found = pairs(all).filter((pair) => pair.desc.includes(node.text) && pair.term !== node.text && !have.includes(pair.term)).slice(0, 5);
      if (found.length >= 2) return { text: found.map((pair) => `- ${pair.term}`).join('\n'), note: `${DEMO}从课程和笔记里找到的相关概念。` };
      const scaffold = ['是什么', '为什么重要', '怎么用', '容易错在哪'].filter((item) => !have.includes(item));
      return { text: scaffold.map((item) => `- ${item}`).join('\n'), note: `${DEMO}没有找到相关材料，先放了几个通用的角度，自己填内容。` };
    }, { maxTokens: 400, effort: 'none' });
  }
  if (action === 'note') {
    return ask(withContext(`${where}。用一句话（不超过 40 字）说明这个节点在这张导图里的意思。只输出这句话。`, context), call, () => {
      const hit = related(`${node.text} ${path.slice(-2).join(' ')}`, contextText(context), 1)[0] ?? sentences(contextText(context)).find((sentence) => sentence.includes(node.text));
      return hit ? { text: clip(hit, 80), note: `${DEMO}从课程和笔记里找到的一句相关的话。` } : { text: '', note: '本地演示没有找到和这个节点相关的内容。连接模型后可以写说明。' };
    }, { maxTokens: 200, effort: 'none' });
  }
  if (!kids(node).length) return Promise.reject(new Error('ai-empty'));
  if (action === 'prune') {
    return ask(`${where}。精简它下面的这一支：合并意思重复的节点，删掉细枝末节，最多保留 5 个子节点、3 层。按原来的缩进列表格式输出，只输出列表。\n\n${branch}`, call, () => {
      const trim = (item: MindNode, depth: number): string => kids(item).slice(0, depth === 0 ? 5 : 3).map((child) => `${'  '.repeat(depth)}- ${child.text}${depth < 1 && kids(child).length ? `\n${trim(child, depth + 1)}` : ''}`).join('\n');
      return { text: trim(node, 0), note: `${DEMO}每层只留了靠前的几项、最多两层，没有合并意思相近的节点。` };
    }, { maxTokens: 700, effort: 'none', temperature: 0.3 });
  }
  return ask(`${where}。重排它的子节点顺序：先基础后进阶、先定义后应用。不增、不删、不改字，子节点下面的内容跟着走。按原来的缩进列表格式输出，只输出列表。\n\n${branch}`, call, () => {
    const sorted = [...kids(node)].sort((a, b) => kids(b).length - kids(a).length || a.text.length - b.text.length);
    return { text: outlineOf({ ...node, children: sorted }), note: `${DEMO}把有下级内容的排在前面，其余按字数从短到长。` };
  }, { maxTokens: 900, effort: 'none', temperature: 0.2 });
}

/** 重排、精简后的节点：文字对得上的沿用原来的 id 与说明 */
export function reuseNodes(next: MindNode[], previous: MindNode[]): MindNode[] {
  const pool = new Map<string, MindNode>();
  const collect = (node: MindNode) => { if (!pool.has(node.text)) pool.set(node.text, node); kids(node).forEach(collect); };
  previous.forEach(collect);
  const used = new Set<string>();
  const walk = (node: MindNode): MindNode => {
    const old = pool.get(node.text);
    const keep = old && !used.has(old.id) ? old : undefined;
    if (keep) used.add(keep.id);
    return { id: keep?.id ?? node.id, text: node.text, ...(keep?.note ? { note: keep.note } : {}), children: kids(node).map(walk) };
  };
  return next.map(walk);
}

/* ══════════ 题目集 ══════════ */
export const LETTERS = 'ABCDEFGH';
export const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES.map((type) => [type.value, type.label])) as Record<QuestionType, string>;
export const isChoice = (type: QuestionType) => type === 'single' || type === 'multiple' || type === 'truefalse';
export const optionsOf = (question: QuizQuestion): string[] =>
  question.type === 'truefalse' ? (question.options?.length === 2 ? question.options : TRUE_FALSE) : question.options ?? [];
export const keyOf = (question: QuizQuestion): number[] => (Array.isArray(question.answer) ? question.answer : []);
export const referenceOf = (question: QuizQuestion): string => {
  if (!isChoice(question.type)) return typeof question.answer === 'string' ? question.answer : '';
  const options = optionsOf(question);
  return keyOf(question).map((index) => (question.type === 'truefalse' ? options[index] : `${LETTERS[index]}. ${options[index] ?? ''}`)).join('　');
};
export const answerText = (question: QuizQuestion, answer: number[] | string | undefined): string => {
  if (Array.isArray(answer)) {
    const options = optionsOf(question);
    return answer.length ? answer.map((index) => (question.type === 'truefalse' ? options[index] : `${LETTERS[index]}. ${options[index] ?? ''}`)).join('　') : '（未作答）';
  }
  return answer?.trim() || '（未作答）';
};
export function questionText(question: QuizQuestion): string {
  const options = question.type === 'truefalse' ? [] : optionsOf(question);
  return `[${TYPE_LABEL[question.type] ?? '题目'}] ${question.stem}${options.length ? `\n${options.map((option, index) => `${LETTERS[index]}. ${option}`).join('\n')}` : ''}`;
}

export function explainWrong(input: { question: QuizQuestion; mine: number[] | string | undefined; context: AiContext }, call: AiCall): Promise<AiOutcome> {
  const { question } = input;
  const mine = answerText(question, input.mine);
  const prompt = `学生做错了这道题，请讲解：
1. 他的答案错在哪（针对他给出的这个答案，不要泛泛而谈）；
2. 正确的思路一步步怎么想；
3. 用一句话帮他记住。
不超过 220 字。

${questionText(question)}

学生的答案：${mine}
正确答案：${referenceOf(question)}${question.explanation ? `\n题目自带的解析：${clip(question.explanation, 500)}` : ''}`;
  return ask(withContext(prompt, { topic: input.context.topic }), call, () => ({
    text: [`你的答案：${mine}`, `正确答案：${referenceOf(question)}`, question.explanation ? `\n${question.explanation}` : ''].filter(Boolean).join('\n\n'),
    note: question.explanation ? `${DEMO}这是题目自带的解析，没有针对你的答案分析。` : `${DEMO}这道题没有自带解析。连接模型后可以针对你的答案讲解。`,
  }), { maxTokens: 700 });
}

/** 选项重新排一遍的同一道题：本地降级时的「同类题」 */
function reshuffled(question: QuizQuestion, seed: string): QuizQuestion {
  const base = { ...question, id: newId() };
  if (question.type !== 'single' && question.type !== 'multiple') return base;
  const options = optionsOf(question);
  const order = shuffle(options.map((_, index) => index), `${seed}:${question.stem}`);
  return { ...base, options: order.map((index) => options[index]), answer: keyOf(question).map((index) => order.indexOf(index)).sort((a, b) => a - b) };
}

export async function similarQuestion(question: QuizQuestion, signal?: AbortSignal): Promise<{ question: QuizQuestion; local: boolean }> {
  const prompt = `依据下面这道题的考点再出一道同类题：考同一个知识点，但换一个情境、数值或问法，不要只改几个字。题型保持「${TYPE_LABEL[question.type]}」。

输出 JSON：{"type":"${question.type}","stem":"题干","options":["选项"],"answer":[0],"explanation":"解析","difficulty":2}
规则：single 4 个选项、answer 是 [正确选项下标]（从 0 开始）；multiple 的 answer 至少两个下标；truefalse 的 options 固定为 ["正确","错误"]；blank 和 short 不要 options，answer 是字符串。选项不带 A/B/C 前缀。

原题：
${questionText(question)}
正确答案：${referenceOf(question)}${question.explanation ? `\n解析：${clip(question.explanation, 500)}` : ''}`;
  try {
    const raw = await completeJson<unknown>({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], maxTokens: 900, temperature: 0.6, signal });
    const data = raw && typeof raw === 'object' && 'question' in raw ? (raw as { question: unknown }).question : raw;
    const next = normaliseQuestion(data);
    if (!next) throw new Error('model-invalid-shape');
    return { question: next, local: false };
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    return { question: reshuffled(question, 'similar'), local: true };
  }
}

/** 错题做成闪卡：正面是题，背面是答案和解析。不需要模型 */
export function wrongCards(questions: QuizQuestion[]): Flashcard[] {
  return questions.map((question) => newCard(
    questionText(question).replace(/^\[[^\]]+\]\s*/, ''),
    [referenceOf(question), question.explanation].filter(Boolean).join('\n\n') || '见题目解析',
  ));
}

export async function reinforceQuiz(title: string, wrong: QuizQuestion[], signal?: AbortSignal): Promise<{ title: string; questions: QuizQuestion[]; local: boolean }> {
  const material = wrong.slice(0, 12).map((question, index) => `${index + 1}. ${questionText(question)}\n正确答案 ${referenceOf(question)}${question.explanation ? `\n解析 ${clip(question.explanation, 300)}` : ''}`).join('\n\n');
  const types = [...new Set(wrong.map((question) => question.type))];
  const name = `${title || '错题'} · 巩固卷`;
  const result = await generateQuiz(
    { sources: [], text: material, instruction: '这些是学生做错的题。针对每道错题的考点各出一到两道新题：同一考点，换情境或换问法，不要照抄原题。', signal },
    { count: Math.min(10, Math.max(4, wrong.length * 2)), types },
  );
  // 本地抽取读不懂题目的考点：没有模型时把错题打乱选项重排一遍
  if (result.local) return { title: `${name}（本地演示）`, questions: shuffle(wrong, name).map((question, index) => reshuffled(question, `r${index}`)), local: true };
  return { title: name, questions: result.data.questions, local: false };
}

/* ══════════ 闪卡 ══════════ */
export const weakCards = (deck: Deck): Flashcard[] => deck.cards
  .filter((card) => card.lapses > 0 || (card.reps > 0 && card.ease < 2.3))
  .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease);

export type CardAction = 'rephrase' | 'hint' | 'explain';
export const CARD_ACTIONS: Record<CardAction, { label: string; doing: string }> = {
  rephrase: { label: '换个问法', doing: '正在换个问法' },
  hint: { label: '给个提示', doing: '正在想提示' },
  explain: { label: '讲透这张卡', doing: '正在讲解' },
};

export function runCardAction(action: CardAction, card: Flashcard, context: AiContext, call: AiCall): Promise<AiOutcome> {
  const both = `问题：${clip(card.front, 600)}\n答案：${clip(card.back, 1200)}`;
  const plain = stripMd(card.back).replace(/\s+/g, '').trim();
  if (action === 'rephrase') {
    return ask(`给这张闪卡换一个问法：考同一个知识点，答案不变，可以换成情境题或者反过来问。只输出新的问题，不超过 40 字。\n\n${both}`, call, () => ({
      text: `不看书，用自己的话说一遍：${card.front.trim()}`,
      note: `${DEMO}只换了句式。连接模型后会从另一个角度提问。`,
    }), { maxTokens: 200, effort: 'none', temperature: 0.7 });
  }
  if (action === 'hint') {
    return ask(`给一个提示，帮学生自己想起答案，但不要说出答案本身：可以给适用的场景、一个类比，或者答案的结构。一句话，不超过 40 字。\n\n${both}`, call, () => ({
      text: plain ? `答案一共 ${[...plain].length} 个字，开头是「${[...plain][0]}」。` : '这张卡的背面是空的。',
      note: `${DEMO}只给了字数和开头。连接模型后会给出不剧透的线索。`,
    }), { maxTokens: 160, effort: 'none', temperature: 0.6 });
  }
  return ask(withContext(`把这张闪卡讲透：为什么是这个答案、它和相近概念的区别、一个具体的例子。不超过 200 字。\n\n${both}`, { topic: context.topic }), call, () => {
    const more = related(`${card.front} ${card.back}`, contextText(context), 3, card.back);
    return more.length
      ? { text: `${card.back.trim()}\n\n${more.map((sentence) => `- ${sentence}`).join('\n')}`, note: `${DEMO}在答案后面补了课程里相关的句子，不是模型的讲解。` }
      : { text: '', note: '本地演示没有找到和这张卡相关的课程内容。连接模型后可以讲解。' };
  }, { maxTokens: 700 });
}

export function weakNote(deck: Deck, cards: Flashcard[], context: AiContext, call: AiCall): Promise<AiOutcome> {
  const list = cards.slice(0, 20).map((card, index) => `${index + 1}. 问：${clip(card.front, 200)}\n   答：${clip(card.back, 400)}\n   忘过 ${card.lapses} 次`).join('\n');
  const prompt = `学生在闪卡《${deck.title || '未命名卡组'}》里反复记不住下面这些卡。把它们整理成一篇针对性的复习笔记：
- 先用一句话说这些卡集中在哪几个知识点；
- 按知识点分节（用 ##），每节讲清概念、容易混的地方，给一个帮助记忆的办法；
- 结尾列 3 条自测题（用 - [ ]）。
400–700 字。

${list}`;
  return ask(withContext(prompt, { topic: context.topic }), call, () => ({
    text: [`> 这些卡在复习时选过「重来」或者一直觉得难，按忘的次数排列。`, ...cards.slice(0, 20).map((card) => `## ${clip(stripMd(card.front).replace(/\s+/g, ' ').trim(), 40)}\n\n${card.back.trim()}\n\n- 忘过 ${card.lapses} 次\n- [ ] 合上笔记再说一遍`)].join('\n\n'),
    note: `${DEMO}把薄弱卡按原样列成了笔记，没有归纳知识点。`,
  }), { maxTokens: 1800 });
}

/* ══════════ 待办 ══════════ */
export interface StepDraft { text: string; due?: string }
const DAY_WORDS: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2 };

/** 读「- [+1] 要做的事」这样的行；没有日期标记的行不带日期 */
export function parseSteps(text: string): StepDraft[] {
  const out: StepDraft[] = [];
  for (const raw of text.replace(/```[\s\S]*?```/g, '').split('\n')) {
    const line = /^\s*(?:[-*+•]|\d+[.)、])\s+(.+)$/.exec(raw)?.[1]?.trim();
    if (!line) continue;
    const tagged = /^[[（(]\s*(?:\+?(\d{1,2})\s*天?后?|(今天|明天|后天))\s*[\]）)]\s*(.+)$/.exec(line);
    const body = stripMd(tagged ? tagged[3] : line.replace(/^\[\s?\]\s*/, '')).replace(/\s+/g, ' ').trim();
    if (body.length < 2) continue;
    const days = tagged ? (tagged[1] !== undefined ? Math.min(30, Number(tagged[1])) : DAY_WORDS[tagged[2]]) : undefined;
    out.push({ text: clip(body, 80), ...(days !== undefined ? { due: dayKey(addDays(days)) } : {}) });
  }
  return out.slice(0, 8);
}
/** 给人看的样子：[+1] → 明天 */
export function prettySteps(text: string): string {
  return text.replace(/^(\s*(?:[-*+•]|\d+[.)、])\s+)[[（(]\s*\+?(\d{1,2})\s*天?后?\s*[\]）)]\s*/gm, (_, lead: string, days: string) => {
    const n = Number(days);
    return `${lead}**${n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '后天' : `${n} 天后`}** · `;
  });
}

export function breakdownTodo(todo: Pick<Todo, 'text' | 'due'>, context: AiContext, call: AiCall): Promise<AiOutcome> {
  const prompt = `把这件学习待办拆成 3–5 个小步骤：「${todo.text}」。
每行一条，格式：- [+0] 要做的事。方括号里是建议第几天做（+0 今天，+1 明天，以此类推）${dueDay(todo.due) ? `，全部排在 ${dueDay(todo.due)} 之前` : ''}。
每条动词开头、不超过 26 字、30–45 分钟能做完；按先弄懂、再练习、再讲出来的顺序。只输出列表。`;
  return ask(withContext(prompt, { topic: context.topic }), call, () => {
    const name = clip(todo.text.replace(/[。.！!]$/, ''), 20);
    return {
      text: [`- [+0] 找齐材料，读一遍「${name}」涉及的内容`, `- [+0] 动手做「${name}」的第一部分，记下卡住的地方`, `- [+1] 做完剩下的部分，对照材料检查`, `- [+1] 不看材料，把「${name}」讲一遍`].join('\n'),
      note: `${DEMO}按「读、做、查、讲」的通用顺序拆的，没有看这件事的具体内容。`,
    };
  }, { maxTokens: 400, effort: 'none' });
}

const stamp = (iso: string) => iso.slice(5, 16).replace('T', ' ');
const signalWord = (activity: Activity) => (activity.signal === 'struggle' ? '（卡住）' : activity.signal === 'success' ? '（顺利）' : '');

export function planToday(input: { data: StudyData; activities: Activity[]; topic?: Topic }, call: AiCall): Promise<AiOutcome> {
  const { data, activities, topic } = input;
  const today = dayKey();
  const due = data.decks.map((deck) => ({ title: deck.title || '未命名卡组', count: dueCards(deck).length })).filter((item) => item.count).sort((a, b) => b.count - a.count);
  const wrong = data.quizSets.map((set) => ({ title: set.title || '未命名题目集', count: set.wrongIds.length })).filter((item) => item.count).sort((a, b) => b.count - a.count);
  const open = data.todos.filter((todo) => !todo.done);
  const overdue = open.filter((todo) => { const day = dueDay(todo.due); return day !== null && day < today; });
  const facts = [
    activities.length ? `【最近的学习记录】（新的在后）\n${activities.slice(-24).map((item) => `- ${stamp(item.at)} ${ACTIVITY_LABELS[item.source]}：${item.summary}${signalWord(item)}${item.detail ? `｜${clip(item.detail, 80)}` : ''}`).join('\n')}` : '【最近的学习记录】还没有',
    due.length ? `【到期的闪卡】\n${due.slice(0, 5).map((item) => `- 《${item.title}》${item.count} 张`).join('\n')}` : '',
    wrong.length ? `【错题本】\n${wrong.slice(0, 5).map((item) => `- 《${item.title}》${item.count} 题`).join('\n')}` : '',
    open.length ? `【还没做完的待办】\n${open.slice(0, 10).map((todo) => `- ${todo.text}${dueDay(todo.due) ? `（${dueDay(todo.due)}）` : ''}`).join('\n')}` : '',
    topic ? `【当前课程】《${topic.title}》：${topic.tagline}` : '',
  ].filter(Boolean).join('\n\n');
  const prompt = `根据这位学生最近的学习情况，排一份今天的学习计划。
输出 4–6 行，每行一条，格式：- [+0] 要做的事。动词开头，不超过 28 字，30–60 分钟能做完，写清是哪门课或哪份材料。
先处理卡住的地方，再复习到期的闪卡和错题，最后推进新内容。不要和「还没做完的待办」重复，不要安排资料里没有出现过的课程。只输出列表。

${facts}`;
  return ask(prompt, call, () => {
    const lines: string[] = [];
    const struggles = [...activities].reverse().filter((item) => item.signal === 'struggle');
    const seen = new Set<string>();
    for (const item of struggles) {
      const name = item.ref?.title || item.topicTitle || clip(item.summary, 18);
      if (seen.has(name) || seen.size >= 2) continue;
      seen.add(name);
      lines.push(`- [+0] 回看卡住的地方：${clip(name, 20)}`);
    }
    for (const item of due.slice(0, 2)) lines.push(`- [+0] 复习《${clip(item.title, 16)}》到期的 ${item.count} 张闪卡`);
    for (const item of wrong.slice(0, 2)) lines.push(`- [+0] 重做《${clip(item.title, 16)}》的 ${item.count} 道错题`);
    if (overdue.length) lines.push(`- [+0] 清掉 ${overdue.length} 项逾期的待办，做不完的改个日期`);
    if (topic && lines.length < 5) lines.push(`- [+0] 把《${clip(topic.title, 16)}》讲给小白听`);
    return lines.length
      ? { text: lines.slice(0, 6).join('\n'), note: `${DEMO}按到期的闪卡、错题和卡住的记录排的，没有估算时间。` }
      : { text: '', note: '还没有可以参考的学习记录、到期闪卡或错题。先学一会儿，再来排计划。' };
  }, { maxTokens: 500 });
}

/* ══════════ 作文与翻译：逐句建议 ══════════ */
export interface Suggestion { original: string; revised: string; reason: string }

/** 从批改意见里的「逐句建议 / 逐句对照」表格读出可以逐条采纳的修改 */
export function parseSuggestions(feedback: string | undefined, kind: 'essay' | 'translation'): Suggestion[] {
  const table = feedbackSection(feedback, kind === 'essay' ? '逐句建议' : '逐句对照');
  if (!table) return [];
  const rows = table.split('\n').filter((line) => line.trim().startsWith('|')).map((line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim()));
  const head = rows[0] ?? [];
  // 作文：原句｜建议改为｜理由；翻译：原文｜我的译法｜更好的译法｜说明（本地演示的三列表没有改法）
  const at = kind === 'essay' ? { original: 0, revised: 1, reason: 2 } : head.length >= 4 ? { original: 1, revised: 2, reason: 3 } : null;
  if (!at) return [];
  return rows.slice(1)
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)))
    .map((cells) => ({ original: cells[at.original] ?? '', revised: cells[at.revised] ?? '', reason: cells[at.reason] ?? '' }))
    .filter((item) => item.original.length >= 2 && item.revised.length >= 2 && item.original !== '—' && item.revised !== '—' && item.original !== item.revised && item.revised !== '在意思转折处断成两句');
}

/* ══════════ 侧栏：问小砚 ══════════ */
export interface PanelTurn { role: 'user' | 'assistant'; content: string }
export interface PanelFocus {
  /** 「笔记」「思维导图」…… */
  label: string;
  title: string;
  text: string;
  /** 此刻选中的东西：节点、题目、卡片 */
  detail?: string;
}

const PANEL_SYSTEM = '你是大学课程助教「小砚」。学生正在学习工作台里做事，下面给出他此刻打开的内容。回答要针对这份内容：先结论后理由，分点说，内容里有错就直接指出来。用简体中文和 Markdown，公式写成 $...$。没有被要求展开时不超过 300 字。';

export function askPanel(input: { question: string; history: PanelTurn[]; focus?: PanelFocus | null; topic?: Topic; memory?: string[] }, call: AiCall): Promise<AiOutcome> {
  const { focus, topic } = input;
  const system = [
    PANEL_SYSTEM,
    focus ? `【正在看】${focus.label}《${focus.title || '未命名'}》${focus.detail ? `\n【此刻选中】${clip(focus.detail, 600)}` : ''}\n【内容】\n${clip(focus.text.trim(), 6000) || '（还是空的）'}` : '【正在看】工作台概览，没有打开具体的条目。',
    topic ? `【当前课程《${topic.title}》】\n${topicDigest(topic)}` : '',
    input.memory?.length ? `【关于这位学生】\n${input.memory.map((line) => `- ${line}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const history: ChatMessage[] = input.history.slice(-8).map((turn) => ({ role: turn.role, content: clip(turn.content, 2000) }));
  return ask(input.question, call, () => {
    const pool = `${focus?.detail ?? ''}\n${focus?.text ?? ''}\n${topic ? `${topicDigest(topic)}\n${topic.prep.microLecture.body}` : ''}`;
    const hits = related(input.question, pool, 3);
    return hits.length
      ? { text: `在${focus ? `这份${focus.label}` : '课程'}和课程内容里找到这些相关的地方：\n\n${hits.map((hit) => `> ${hit}`).join('\n>\n')}`, note: `${DEMO}只能按关键词查找，不是模型的回答。` }
      : { text: '', note: '本地演示只能按关键词在当前内容里查找，这次没有找到。连接模型后小砚可以直接回答。' };
  }, { system, history, maxTokens: 1400 });
}
