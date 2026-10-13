/**
 * AI 课堂引擎 —— 一键生成课程（大纲 → 逐幕生成）、无模型时的本地课程、
 * 课堂回放的分句脚本、举手提问与小白答题。界面在 pages/learn/views/lesson。
 */
import { completeJson, ModelUnavailableError, streamModel, type ChatMessage } from '../lib/modelGateway';
import { newId } from '../store/studyData';
import type { Topic } from '../types';
import type { NotebookSource } from './notebookSources';

// ───────────────────────── 类型 ─────────────────────────

export type SceneType = 'slide' | 'whiteboard' | 'quiz' | 'interactive' | 'pbl';
export type Classmate = 'xiaobai' | 'acheng';
export type SpeakerId = 'teacher' | Classmate | 'user';
export type AudienceLevel = 'intro' | 'standard' | 'exam';
export type LessonLength = 'short' | 'standard' | 'long';
export type SceneOrigin = 'model' | 'local';

export interface Interjection {
  speaker: Classmate;
  text: string;
  /** 老师的一句回应 */
  reply?: string;
}
export interface SlideFigure {
  kind: 'mermaid' | 'formula' | 'code';
  content: string;
  caption?: string;
}
export interface BoardStroke {
  kind: 'text' | 'formula' | 'diagram' | 'highlight';
  content: string;
  /** 老师写这一笔时说的话 */
  say?: string;
}
export interface LessonQuestion {
  id: string;
  type: 'single' | 'multiple' | 'truefalse';
  stem: string;
  options: string[];
  answer: number[];
  explanation: string;
}
export interface PblMilestone { title: string; detail: string }
export interface PblRubric { criterion: string; levels: string }

interface SceneBase {
  id: string;
  title: string;
  goal: string;
  /** 老师口播稿 */
  script: string;
  interjections: Interjection[];
  origin: SceneOrigin;
}
export interface SlideScene extends SceneBase { type: 'slide'; bullets: string[]; figure?: SlideFigure }
export interface WhiteboardScene extends SceneBase { type: 'whiteboard'; strokes: BoardStroke[] }
export interface QuizScene extends SceneBase { type: 'quiz'; questions: LessonQuestion[] }
export interface InteractiveScene extends SceneBase { type: 'interactive'; html: string; instructions: string }
export interface PblScene extends SceneBase {
  type: 'pbl';
  brief: string;
  deliverable: string;
  milestones: PblMilestone[];
  rubric: PblRubric[];
}
export type LessonScene = SlideScene | WhiteboardScene | QuizScene | InteractiveScene | PblScene;

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  objectives: string[];
  scenes: LessonScene[];
  level: AudienceLevel;
  length: LessonLength;
  /** 用户的主题描述 */
  prompt: string;
  topicId?: string;
  topicTitle?: string;
  sourceTitles: string[];
  /** local = 没有可用模型时由课程内容拼出的本地演示 */
  origin: SceneOrigin;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateInput {
  prompt: string;
  topic?: Topic;
  sources: NotebookSource[];
  level: AudienceLevel;
  length: LessonLength;
  types: SceneType[];
}
export interface SceneProgress { title: string; type: SceneType; status: 'pending' | 'running' | 'done' | 'fallback' }
export interface GenerateProgress { stage: 'outline' | 'scenes' | 'done'; title?: string; scenes: SceneProgress[] }

/** 既没有模型也没有可用材料 */
export class LessonInputError extends Error {
  constructor(message: string) { super(message); this.name = 'LessonInputError'; }
}

// ───────────────────────── 常量 ─────────────────────────

export const SCENE_TYPES: SceneType[] = ['slide', 'whiteboard', 'quiz', 'interactive', 'pbl'];
export const SCENE_LABELS: Record<SceneType, string> = {
  slide: '幻灯片', whiteboard: '白板', quiz: '测验', interactive: '互动模拟', pbl: '项目实践',
};
export const LENGTH_SCENES: Record<LessonLength, number> = { short: 5, standard: 8, long: 12 };
export const LENGTH_LABELS: Record<LessonLength, string> = { short: '短课 · 5 幕', standard: '标准 · 8 幕', long: '长课 · 12 幕' };
export const LEVEL_LABELS: Record<AudienceLevel, string> = { intro: '零基础', standard: '有基础', exam: '备考冲刺' };
const LEVEL_HINTS: Record<AudienceLevel, string> = {
  intro: '面向第一次接触这个主题的大学生：从生活例子讲起，术语出现时先解释。',
  standard: '面向学过相关前置课的大学生：直接讲机制与推导，配一个有分量的例子。',
  exam: '面向备考的大学生：突出考点、易错点与解题套路，测验贴近考试题型。',
};
export const AGENTS: Record<SpeakerId, { name: string; role: string }> = {
  teacher: { name: '小砚', role: '主讲' },
  xiaobai: { name: '小白', role: '同学 · 爱问为什么' },
  acheng: { name: '阿澄', role: '同学 · 抢答快' },
  user: { name: '我', role: '同学' },
};

const CAST = [
  '课堂角色（口吻必须区分开）：',
  '- 小砚（teacher）：主讲老师。口语、短句，先讲结论再讲原因，爱用生活例子。',
  '- 小白（xiaobai）：基础薄的同学，好奇，爱问「为什么」。问题听起来天真，却常戳中要害；偶尔把典型误解当真说出来。',
  '- 阿澄（acheng）：反应快、有点好胜的同学。喜欢抢答、补充细节，或抛出更刁钻的情况。',
].join('\n');

// ───────────────────────── 文本工具 ─────────────────────────

const now = () => new Date().toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 2000): string => (typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '');
const strList = (value: unknown, maxItems: number, maxLen = 400): string[] =>
  (Array.isArray(value) ? value : []).map((item) => str(item, maxLen)).filter(Boolean).slice(0, maxItems);

/** 去掉 Markdown / LaTeX 标记，得到可朗读、可放进 PPT 的纯文本 */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 按句切分，过短的并到前一句，过长的在逗号处再切 */
export function splitSentences(text: string, maxLen = 72): string[] {
  const raw = plainText(text).split(/(?<=[。！？!?；;])\s*|\n+/).map((part) => part.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of raw) {
    const pieces = part.length > maxLen ? part.split(/(?<=[，,、：:])/).reduce<string[]>((acc, piece) => {
      const last = acc[acc.length - 1];
      if (last !== undefined && (last + piece).length <= maxLen) acc[acc.length - 1] = last + piece;
      else acc.push(piece);
      return acc;
    }, []) : [part];
    for (const piece of pieces) {
      const last = out[out.length - 1];
      if (last !== undefined && piece.length < 6 && (last + piece).length <= maxLen) out[out.length - 1] = last + piece;
      else out.push(piece);
    }
  }
  return out;
}

function clipAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut}…`;
}

/** 句末没有标点时补一个句号 */
const endSentence = (text: string) => (/[。！？!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`);

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

export const optionLetter = (index: number) => String.fromCharCode(65 + index);

// ───────────────────────── 回放脚本 ─────────────────────────

export interface PlaySegment {
  speaker: SpeakerId;
  text: string;
  kind: 'script' | 'interject' | 'reply';
  /** 这一句开始时，舞台上已显示的要点 / 板书笔数 */
  reveal: number;
}

/** 一幕里随讲解逐步出现的条目数（幻灯片要点、白板笔画） */
export function sceneRevealTotal(scene: LessonScene): number {
  if (scene.type === 'slide') return scene.bullets.length;
  if (scene.type === 'whiteboard') return scene.strokes.length;
  return 0;
}

/** 把一幕拆成逐句播放的片段：老师的话按句推进，同学的插话穿插在句子之间 */
export function sceneSegments(scene: LessonScene): PlaySegment[] {
  const total = sceneRevealTotal(scene);
  const main: PlaySegment[] = [];
  if (scene.type === 'whiteboard') {
    scene.strokes.forEach((stroke, index) => {
      const lines = splitSentences(stroke.say || (stroke.kind === 'diagram' ? '看这张图。' : stroke.content));
      for (const text of lines.length ? lines : ['看这里。']) main.push({ speaker: 'teacher', text, kind: 'script', reveal: index + 1 });
    });
  } else {
    const lines = splitSentences(scene.script || scene.goal || scene.title);
    lines.forEach((text, index) => main.push({
      speaker: 'teacher', text, kind: 'script',
      reveal: total ? Math.max(1, Math.ceil(((index + 1) / lines.length) * total)) : 0,
    }));
  }
  if (!scene.interjections.length) return main;
  const out = [...main];
  // 从后往前插，前面的下标不受影响
  [...scene.interjections].reverse().forEach((item, reversedIndex) => {
    const order = scene.interjections.length - 1 - reversedIndex;
    const at = Math.min(main.length, Math.max(1, Math.ceil(((order + 1) / (scene.interjections.length + 1)) * main.length)));
    const reveal = main[at - 1]?.reveal ?? total;
    const inserted: PlaySegment[] = [{ speaker: item.speaker, text: item.text, kind: 'interject', reveal }];
    if (item.reply) for (const text of splitSentences(item.reply)) inserted.push({ speaker: 'teacher', text, kind: 'reply', reveal });
    out.splice(at, 0, ...inserted);
  });
  return out;
}

/** 估算课堂时长（分钟）：朗读约每秒 4 字，测验与互动另算停留时间 */
export function estimateMinutes(lesson: Pick<Lesson, 'scenes'>): number {
  const seconds = lesson.scenes.reduce((sum, scene) => {
    const speech = sceneSegments(scene).reduce((chars, segment) => chars + segment.text.length, 0) / 4;
    const dwell = scene.type === 'quiz' ? scene.questions.length * 35 : scene.type === 'interactive' ? 80 : scene.type === 'pbl' ? 30 : 4;
    return sum + speech + dwell;
  }, 0);
  return Math.max(1, Math.round(seconds / 60));
}

export function sceneTypeMix(lesson: Pick<Lesson, 'scenes'>): { type: SceneType; count: number }[] {
  return SCENE_TYPES.map((type) => ({ type, count: lesson.scenes.filter((scene) => scene.type === type).length })).filter((item) => item.count > 0);
}

/** 一幕的文字内容：给提问上下文、本地检索和导出备注用 */
export function sceneDigest(scene: LessonScene): string {
  const head = `【${SCENE_LABELS[scene.type]}】${scene.title}`;
  switch (scene.type) {
    case 'slide': return [head, ...scene.bullets.map((item) => `- ${item}`), scene.figure ? `图示：${scene.figure.content}` : '', scene.script].filter(Boolean).join('\n');
    case 'whiteboard': return [head, ...scene.strokes.map((stroke) => `${stroke.content}${stroke.say ? `（${stroke.say}）` : ''}`)].join('\n');
    case 'quiz': return [head, ...scene.questions.map((question) => `${question.stem}\n${question.options.map((option, i) => `${optionLetter(i)}. ${option}`).join('\n')}\n解析：${question.explanation}`)].join('\n');
    case 'interactive': return [head, scene.instructions, scene.script].filter(Boolean).join('\n');
    case 'pbl': return [head, scene.brief, `交付物：${scene.deliverable}`, ...scene.milestones.map((item, i) => `${i + 1}. ${item.title}：${item.detail}`)].join('\n');
  }
}

/** 一幕写成 Markdown：标题、目标、这一幕的内容和老师的讲稿。带去别的板块（笔记、闪卡、出题）时用 */
export function sceneMarkdown(scene: LessonScene, index?: number): string {
  const lines: string[] = [`## ${index === undefined ? '' : `${index + 1}. `}${scene.title}（${SCENE_LABELS[scene.type]}）`];
  if (scene.goal.trim()) lines.push(`目标：${scene.goal.trim()}`);
  switch (scene.type) {
    case 'slide':
      lines.push(scene.bullets.map((item) => `- ${item}`).join('\n'));
      if (scene.figure) lines.push(scene.figure.kind === 'formula' ? `$$${scene.figure.content}$$` : `\`\`\`${scene.figure.kind === 'mermaid' ? 'mermaid' : ''}\n${scene.figure.content}\n\`\`\``);
      break;
    case 'whiteboard':
      lines.push(scene.strokes.map((stroke) => (stroke.kind === 'formula' ? `$$${stroke.content}$$` : stroke.kind === 'diagram' ? `\`\`\`mermaid\n${stroke.content}\n\`\`\`` : `- ${stroke.content}`)).join('\n'));
      break;
    case 'quiz':
      lines.push(scene.questions.map((question, i) => [
        `${i + 1}. ${question.stem}`,
        ...question.options.map((option, optionIndex) => `   ${optionLetter(optionIndex)}. ${option}`),
        `   答案：${question.answer.map(optionLetter).join('、')}`,
        question.explanation ? `   解析：${question.explanation}` : '',
      ].filter(Boolean).join('\n')).join('\n\n'));
      break;
    case 'interactive':
      if (scene.instructions.trim()) lines.push(`动手试一试：${scene.instructions.trim()}`);
      break;
    case 'pbl':
      lines.push(scene.brief, `交付物：${scene.deliverable}`, scene.milestones.map((item, i) => `${i + 1}. ${item.title}：${item.detail}`).join('\n'));
      if (scene.rubric.length) lines.push(`评价标准：\n${scene.rubric.map((item) => `- ${item.criterion}：${item.levels}`).join('\n')}`);
      break;
  }
  if (scene.script.trim()) lines.push(`讲稿：${scene.script.trim()}`);
  return lines.filter((line) => line.trim()).join('\n\n');
}

/** 整堂课写成 Markdown：简介、学习目标、大纲、逐幕内容与讲稿 */
export function lessonMarkdown(lesson: Lesson): string {
  return [
    `# ${lesson.title}`,
    lesson.summary.trim(),
    lesson.objectives.length ? `## 学习目标\n\n${lesson.objectives.map((item) => `- ${item}`).join('\n')}` : '',
    `## 大纲\n\n${lesson.scenes.map((scene, index) => `${index + 1}. ${scene.title}（${SCENE_LABELS[scene.type]}）`).join('\n')}`,
    ...lesson.scenes.map((scene, index) => sceneMarkdown(scene, index)),
  ].filter((part) => part.trim()).join('\n\n');
}

// ───────────────────────── 互动模拟文档 ─────────────────────────

/** 互动页可用的颜色变量；播放器里换成当前皮肤的实际颜色，导出时用这组浅色默认值 */
export const INTERACTIVE_PALETTE: Record<string, string> = {
  bg: '#ffffff', surface: '#ffffff', inset: '#f2f3f5', text: '#1b1d21', 'text-2': '#4b5059', 'text-3': '#7a808a',
  border: '#e6e8ec', 'border-2': '#d3d6dc', accent: '#3b72e6', 'accent-soft': '#e7eefc', 'on-accent': '#ffffff',
  solid: '#16181c', 'on-solid': '#ffffff', ok: '#1f9d6b', 'ok-soft': '#e2f4ec', bad: '#d5483f', 'bad-soft': '#fbe9e7', warn: '#c0810c',
};

/**
 * 给互动页注入「禁止联网」的内容安全策略和皮肤颜色变量。
 * 课堂里页面经隔离宿主页 public/sandbox.html 在 sandbox="allow-scripts"（无同源）的 iframe 里运行；
 * 导出的单文件课件从磁盘打开，用 srcdoc 内嵌。
 */
export function prepareInteractiveDoc(rawHtml: string, palette: Record<string, string> = INTERACTIVE_PALETTE): string {
  // 外链脚本、样式表、字体一律去掉：页面必须自包含，运行环境也不允许联网
  const html = rawHtml
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(?:link|base)\b[^>]*>/gi, '')
    .replace(/@import\s+[^;]+;/gi, '');
  const vars = Object.entries({ ...INTERACTIVE_PALETTE, ...palette }).map(([name, value]) => `--${name}:${value}`).join(';');
  const head = [
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:">',
    `<style>:root{${vars}}html{background:var(--bg);color:var(--text)}</style>`,
  ].join('');
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html lang="zh-CN"><head>${head}</head><body>${html}</body></html>`;
}

const DOC_STYLE = `*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text)}
h1{margin:0 0 4px;font-size:16px}p.hint{margin:0 0 12px;color:var(--text-3);font-size:13px}
button{height:34px;padding:0 14px;border:1px solid var(--border-2);border-radius:10px;background:var(--surface);color:inherit;font:inherit;cursor:pointer;transition:background .15s,transform .1s}
button:hover:not(:disabled){background:var(--inset)}button:active:not(:disabled){transform:scale(.97)}button:disabled{opacity:.4;cursor:default}
button.primary{border-color:transparent;background:var(--solid);color:var(--on-solid)}button.primary:hover:not(:disabled){background:var(--solid);opacity:.88}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.meter{flex:1;min-width:80px;height:6px;border-radius:99px;background:var(--inset);overflow:hidden}.meter b{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.note{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--inset);min-height:56px}`;

const embedJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/** 本地互动一：逐行走查一段示例代码 */
function codeStepperDoc(title: string, code: string, walkthrough: string): string {
  const lines = code.replace(/\t/g, '  ').split('\n');
  const notes = splitSentences(walkthrough, 90);
  return `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${DOC_STYLE}
.code{margin:0;padding:10px 0;border-radius:12px;background:var(--inset);font:13px/1.75 ui-monospace,Menlo,Consolas,monospace;overflow:auto}
.line{display:flex;gap:12px;padding:0 14px;white-space:pre;border-left:3px solid transparent;opacity:.42;transition:opacity .2s,background .2s}
.line i{min-width:1.6em;color:var(--text-3);font-style:normal;text-align:right;user-select:none}
.line.done{opacity:.8}.line.on{opacity:1;background:var(--accent-soft);border-left-color:var(--accent)}
#pos{color:var(--text-3);font-size:13px;font-variant-numeric:tabular-nums}</style></head><body>
<h1></h1><p class="hint">一行一行往下走。先自己猜这一行执行后会怎样，再看下面的讲解。</p>
<pre class="code" id="code"></pre>
<div class="bar"><button id="prev">上一行</button><button class="primary" id="next">执行下一行</button><div class="meter"><b id="meter"></b></div><span id="pos"></span></div>
<div class="note" id="note"></div>
<script>
const DATA=${embedJson({ title, lines, notes })};
const steps=DATA.lines.map((text,i)=>i).filter(i=>DATA.lines[i].trim());
let at=-1;
document.querySelector('h1').textContent=DATA.title;
const code=document.getElementById('code');
DATA.lines.forEach((text,i)=>{const row=document.createElement('div');row.className='line';const n=document.createElement('i');n.textContent=i+1;const t=document.createElement('span');t.textContent=text||' ';row.append(n,t);code.append(row)});
function render(){
  [...code.children].forEach((row,i)=>{row.classList.toggle('on',at>=0&&steps[at]===i);row.classList.toggle('done',at>=0&&i<steps[at])});
  document.getElementById('prev').disabled=at<=0;
  document.getElementById('next').textContent=at>=steps.length-1?'从头再走一遍':'执行下一行';
  document.getElementById('meter').style.width=((at+1)/steps.length*100)+'%';
  document.getElementById('pos').textContent=(at+1)+' / '+steps.length;
  const upto=Math.ceil((at+1)/steps.length*DATA.notes.length);
  document.getElementById('note').textContent=at<0?'点「执行下一行」开始。':(DATA.notes.slice(Math.max(0,upto-2),upto).join(' ')||'这一行没有额外说明，继续往下。');
  if(at>=0)code.children[steps[at]].scrollIntoView({block:'nearest'});
}
document.getElementById('next').onclick=()=>{at=at>=steps.length-1?0:at+1;render()};
document.getElementById('prev').onclick=()=>{at=Math.max(0,at-1);render()};
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')document.getElementById('next').click();if(e.key==='ArrowLeft')document.getElementById('prev').click()});
render();
</script></body></html>`;
}

/** 本地互动二：要点翻牌 + 自评 */
function flipCardsDoc(title: string, cards: { front: string; back: string }[]): string {
  return `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${DOC_STYLE}
.card{margin-top:4px;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface);min-height:150px;display:grid;gap:10px;align-content:center}
.card small{color:var(--text-3);font-size:12px}.card strong{font-size:17px;line-height:1.5}.card p{margin:0;padding-top:10px;border-top:1px dashed var(--border-2);color:var(--text-2)}
.ok{border-color:transparent!important;background:var(--ok-soft)!important;color:var(--ok)!important}.bad{border-color:transparent!important;background:var(--bad-soft)!important;color:var(--bad)!important}
#score{color:var(--text-3);font-size:13px}</style></head><body>
<h1></h1><p class="hint">先在心里把这一条讲一遍，再翻开对照，老实给自己打分。</p>
<div class="card"><small id="pos"></small><strong id="front"></strong><p id="back" hidden></p></div>
<div class="bar"><button class="primary" id="flip">翻开对照</button><button class="ok" id="yes" hidden>我讲对了</button><button class="bad" id="no" hidden>还没讲清</button><div class="meter"><b id="meter"></b></div><span id="score"></span></div>
<script>
const DATA=${embedJson({ title, cards })};
let at=0,right=0,seen=0;
document.querySelector('h1').textContent=DATA.title;
const $=id=>document.getElementById(id);
function render(open){
  if(at>=DATA.cards.length){$('pos').textContent='这一轮结束';$('front').textContent='讲对 '+right+' / '+DATA.cards.length+' 条';$('back').hidden=false;$('back').textContent=right===DATA.cards.length?'全部讲清了，可以去教小白了。':'没讲清的那几条，回到前面的幻灯片再看一眼。';$('flip').hidden=false;$('flip').textContent='再来一轮';$('yes').hidden=$('no').hidden=true;return}
  const card=DATA.cards[at];
  $('pos').textContent='第 '+(at+1)+' / '+DATA.cards.length+' 条';$('front').textContent=card.front;$('back').textContent=card.back;$('back').hidden=!open;
  $('flip').hidden=open;$('flip').textContent='翻开对照';$('yes').hidden=$('no').hidden=!open;
  $('meter').style.width=(seen/DATA.cards.length*100)+'%';$('score').textContent='讲对 '+right+' 条';
}
$('flip').onclick=()=>{if(at>=DATA.cards.length){at=0;right=0;seen=0;render(false)}else render(true)};
$('yes').onclick=()=>{right++;seen++;at++;render(false);$('meter').style.width=(seen/DATA.cards.length*100)+'%'};
$('no').onclick=()=>{seen++;at++;render(false);$('meter').style.width=(seen/DATA.cards.length*100)+'%'};
render(false);
</script></body></html>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ───────────────────────── 归一化 ─────────────────────────

type ScenePlan = { type: SceneType; title: string; goal: string };
interface Outline { title: string; summary: string; objectives: string[]; scenes: ScenePlan[] }

const SPEAKER_ALIASES: Record<string, Classmate> = { xiaobai: 'xiaobai', 小白: 'xiaobai', acheng: 'acheng', 阿澄: 'acheng' };

function normalizeInterjections(raw: unknown): Interjection[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item): Interjection[] => {
    if (!isRecord(item)) return [];
    const speaker = SPEAKER_ALIASES[str(item.speaker, 20).toLowerCase()] ?? SPEAKER_ALIASES[str(item.speaker, 20)];
    const text = str(item.text, 200);
    if (!speaker || !text) return [];
    const reply = str(item.reply, 240);
    return [{ speaker, text, ...(reply ? { reply } : {}) }];
  }).slice(0, 3);
}

const stripFence = (text: string) => text.replace(/^\s*```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
const stripMathFence = (text: string) => text.replace(/^\s*\$\$?/, '').replace(/\$\$?\s*$/, '').trim();

function normalizeAnswer(raw: unknown, optionCount: number): number[] {
  const toIndex = (value: unknown): number[] => {
    if (typeof value === 'number' && Number.isInteger(value)) return [value];
    if (typeof value === 'boolean') return [value ? 0 : 1];
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^(true|正确|对)$/i.test(text)) return [0];
      if (/^(false|错误|错)$/i.test(text)) return [1];
      if (/^\d+$/.test(text)) return [Number(text)];
      return [...text.toUpperCase()].filter((char) => /[A-H]/.test(char)).map((char) => char.charCodeAt(0) - 65);
    }
    return [];
  };
  const list = (Array.isArray(raw) ? raw.flatMap(toIndex) : toIndex(raw)).filter((index) => index >= 0 && index < optionCount);
  return [...new Set(list)].sort((a, b) => a - b);
}

function normalizeQuestion(raw: unknown): LessonQuestion | null {
  if (!isRecord(raw)) return null;
  const stem = str(raw.stem ?? raw.question, 600);
  const rawType = str(raw.type, 20).toLowerCase();
  const type: LessonQuestion['type'] = rawType === 'multiple' ? 'multiple' : rawType === 'truefalse' || rawType === 'true-false' || rawType === 'judge' ? 'truefalse' : 'single';
  const options = type === 'truefalse' ? ['正确', '错误'] : strList(raw.options, 6, 240).map((option) => option.replace(/^[A-Ha-h][.、)）]\s*/, ''));
  if (!stem || options.length < 2) return null;
  let answer = normalizeAnswer(raw.answer ?? raw.answerIndex, options.length);
  if (!answer.length) return null;
  if (type !== 'multiple') answer = answer.slice(0, 1);
  return { id: newId(), type, stem, options, answer, explanation: str(raw.explanation, 600) || '对照本节要点再想一遍。' };
}

function normalizeScene(raw: unknown, plan: ScenePlan): LessonScene | null {
  if (!isRecord(raw)) return null;
  const base = {
    id: newId(),
    title: str(raw.title, 60) || plan.title,
    goal: plan.goal,
    script: str(raw.script, 1200),
    interjections: normalizeInterjections(raw.interjections),
    origin: 'model' as const,
  };
  switch (plan.type) {
    case 'slide': {
      const bullets = strList(raw.bullets, 6, 260);
      if (!bullets.length) return null;
      let figure: SlideFigure | undefined;
      if (isRecord(raw.figure)) {
        const kind = str(raw.figure.kind, 20).toLowerCase();
        const content = str(raw.figure.content ?? raw.figure.code, 2400);
        const caption = str(raw.figure.caption, 80);
        if (content && (kind === 'mermaid' || kind === 'formula' || kind === 'code')) {
          figure = { kind, content: kind === 'formula' ? stripMathFence(content) : stripFence(content), ...(caption ? { caption } : {}) };
        }
      }
      return { ...base, type: 'slide', bullets, script: base.script || bullets.map(plainText).join('。'), ...(figure ? { figure } : {}) };
    }
    case 'whiteboard': {
      const strokes = (Array.isArray(raw.strokes) ? raw.strokes : []).flatMap((item): BoardStroke[] => {
        if (!isRecord(item)) return [];
        const rawKind = str(item.kind, 20).toLowerCase();
        const kind: BoardStroke['kind'] = rawKind === 'formula' || rawKind === 'diagram' || rawKind === 'highlight' ? rawKind : 'text';
        const content = str(item.content, kind === 'diagram' ? 2400 : 400);
        if (!content) return [];
        const say = str(item.say, 300);
        return [{ kind, content: kind === 'formula' ? stripMathFence(content) : kind === 'diagram' ? stripFence(content) : content, ...(say ? { say } : {}) }];
      }).slice(0, 9);
      if (strokes.length < 2) return null;
      // 模型只给了整段讲稿时，把句子均分到各笔
      if (strokes.every((stroke) => !stroke.say) && base.script) {
        const lines = splitSentences(base.script);
        strokes.forEach((stroke, index) => {
          const from = Math.floor((index / strokes.length) * lines.length);
          const to = Math.floor(((index + 1) / strokes.length) * lines.length);
          const say = lines.slice(from, Math.max(to, from + 1)).join('');
          if (say) stroke.say = say;
        });
      }
      return { ...base, type: 'whiteboard', strokes, script: base.script || strokes.map((stroke) => stroke.say ?? '').join('') };
    }
    case 'quiz': {
      const questions = (Array.isArray(raw.questions) ? raw.questions : []).flatMap((item) => normalizeQuestion(item) ?? []).slice(0, 3);
      if (!questions.length) return null;
      return { ...base, type: 'quiz', questions, script: base.script || '讲到这里，先做几道题，看看刚才的内容有没有真的进脑子。', interjections: [] };
    }
    case 'interactive': {
      const html = stripFence(str(raw.html, 60_000));
      if (html.length < 160 || !/<[a-z][\s\S]*>/i.test(html) || !/<script/i.test(html)) return null;
      return { ...base, type: 'interactive', html, instructions: str(raw.instructions, 300) || '动手改一改参数，观察结果怎么变。', script: base.script || `这一幕交给你动手。${plan.goal}` };
    }
    case 'pbl': {
      const milestones = (Array.isArray(raw.milestones) ? raw.milestones : []).flatMap((item): PblMilestone[] => {
        if (typeof item === 'string') return item.trim() ? [{ title: item.trim().slice(0, 80), detail: '' }] : [];
        if (!isRecord(item)) return [];
        const title = str(item.title ?? item.name, 80);
        return title ? [{ title, detail: str(item.detail ?? item.description, 300) }] : [];
      }).slice(0, 6);
      const rubric = (Array.isArray(raw.rubric) ? raw.rubric : []).flatMap((item): PblRubric[] => {
        if (typeof item === 'string') return item.trim() ? [{ criterion: item.trim().slice(0, 80), levels: '' }] : [];
        if (!isRecord(item)) return [];
        const criterion = str(item.criterion ?? item.name, 80);
        return criterion ? [{ criterion, levels: str(item.levels ?? item.description, 300) }] : [];
      }).slice(0, 5);
      const brief = str(raw.brief, 800);
      if (!brief || milestones.length < 2) return null;
      return { ...base, type: 'pbl', brief, deliverable: str(raw.deliverable, 300) || '一份可以讲给别人听的成果', milestones, rubric, script: base.script || `最后留一个小项目。${plainText(brief)}` };
    }
  }
}

function normalizeOutline(raw: unknown, count: number, types: SceneType[]): Outline | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title, 60);
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).flatMap((item): ScenePlan[] => {
    if (!isRecord(item)) return [];
    const rawType = str(item.type, 20).toLowerCase() as SceneType;
    const type = types.includes(rawType) ? rawType : types[0];
    const sceneTitle = str(item.title, 60);
    return sceneTitle ? [{ type, title: sceneTitle, goal: str(item.goal, 240) || sceneTitle }] : [];
  }).slice(0, count);
  if (!title || scenes.length < Math.min(3, count)) return null;
  return { title, summary: str(raw.summary, 200), objectives: strList(raw.objectives, 5, 120), scenes };
}

// ───────────────────────── 提示词 ─────────────────────────

function materialDigest(input: Pick<GenerateInput, 'topic' | 'sources'>, max: number): string {
  const parts: string[] = [];
  const { topic } = input;
  if (topic) {
    parts.push(`# 课程知识点：${topic.title}（${topic.course}）\n${topic.tagline}`);
    parts.push(`## 讲义\n${topic.prep.microLecture.body}`);
    if (topic.checklist.length) parts.push(`## 要点\n${topic.checklist.map((item) => `- ${item.point}：${item.groundTruth}`).join('\n')}`);
    if (topic.misconceptions.length) parts.push(`## 常见误解\n${topic.misconceptions.map((item) => `- ${item.belief}`).join('\n')}`);
    for (const example of topic.prep.examples.slice(0, 2)) parts.push(`## 例子：${example.title}\n\`\`\`\n${example.code}\n\`\`\`\n${example.walkthrough}`);
  }
  const lectureId = topic ? `lecture:${topic.topicId}` : '';
  for (const source of input.sources) {
    if (source.id === lectureId || (topic && source.id.startsWith(`example:${topic.topicId}:`))) continue;
    parts.push(`# 资料：${source.title}\n${source.content}`);
  }
  const text = parts.join('\n\n').trim();
  return text.length > max ? `${text.slice(0, max)}\n…（资料过长，已截断）` : text;
}

function outlineMessages(input: GenerateInput, count: number, types: SceneType[]): ChatMessage[] {
  const material = materialDigest(input, 7000);
  const typeGuide = [
    types.includes('slide') && '- slide：幻灯片，讲清一个概念或一步推理',
    types.includes('whiteboard') && '- whiteboard：白板，一步步写出推导、公式或画出结构图',
    types.includes('quiz') && '- quiz：随堂测验，1-3 题，放在讲完相关内容之后',
    types.includes('interactive') && `- interactive：可以动手操作的小模拟，全课最多 ${count >= 10 ? 2 : 1} 幕`,
    types.includes('pbl') && '- pbl：项目式学习任务，只能有 1 幕，放在最后',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: '你是大学课程的教学设计师，为一堂由 AI 老师主讲、两位 AI 同学参与的互动课设计大纲。只输出一个合法 JSON 对象，不要输出任何解释、前后缀或 Markdown 代码围栏。' },
    { role: 'user', content: [
      `主题：${input.prompt.trim() || input.topic?.title || '根据下面的资料确定'}`,
      `学习者：${LEVEL_HINTS[input.level]}`,
      `幕数：恰好 ${count} 幕。`,
      `可用的幕类型（type 只能取这些值）：\n${typeGuide}`,
      '编排要求：第一幕用来引入（为什么要学、学完能做什么）；讲解由浅入深，每幕只做一件事；可用的类型尽量都出现；标题不超过 14 个字，不要写「第几幕」。',
      material ? `参考资料（内容以它为准，不要编造资料里没有的事实）：\n"""\n${material}\n"""` : '没有提供资料，请依据该主题公认的教材内容设计。',
      '输出 JSON，结构如下：\n{"title":"课程标题（不超过 18 字）","summary":"一句话说明这堂课讲什么","objectives":["学完能……（3-4 条）"],"scenes":[{"type":"slide","title":"幕标题","goal":"这一幕要让学习者明白或做到什么"}]}',
    ].join('\n\n') },
  ];
}

const INTERJECTION_SCHEMA = '"interjections":[{"speaker":"xiaobai 或 acheng","text":"同学的一句插话或提问（40 字以内）","reply":"老师的一句回应（60 字以内）"}]';
const SCENE_SCHEMAS: Record<SceneType, string> = {
  slide: [
    `{"title":"幕标题","bullets":["3-5 条要点，每条不超过 40 字，可用 Markdown 加粗与 $LaTeX$"],"figure":{"kind":"mermaid 或 formula","content":"mermaid 代码，或不带 $ 的 LaTeX","caption":"图示说明"},"script":"老师的口播稿，150-240 字，口语化，不要念要点原文",${INTERJECTION_SCHEMA}}`,
    '说明：figure 只在确实有助于理解时给，否则写 null。interjections 给 1-2 条，小白和阿澄的口吻要分得开。',
  ].join('\n'),
  whiteboard: [
    `{"title":"幕标题","strokes":[{"kind":"text | formula | diagram | highlight","content":"板书内容","say":"老师写这一笔时说的话（30-70 字，口语）"}],${INTERJECTION_SCHEMA}}`,
    '说明：strokes 给 4-7 笔，按书写顺序。text 是一行短板书；formula 的 content 是不带 $ 的 LaTeX；diagram 的 content 是 mermaid 代码，全幕最多 1 个；highlight 是需要圈出来的一句结论，放在最后。interjections 给 1 条。',
  ].join('\n'),
  quiz: [
    '{"title":"幕标题","script":"老师引出测验的一两句话","questions":[{"type":"single | multiple | truefalse","stem":"题干","options":["选项文本，不带 A/B 前缀"],"answer":[正确选项的下标，从 0 开始],"explanation":"解析：为什么对，错的选项错在哪"}]}',
    '说明：给 2-3 题，考理解而不是记忆，至少一题针对常见误解。single 给 4 个选项；truefalse 的 options 固定为 ["正确","错误"]。',
  ].join('\n'),
  interactive: [
    '{"title":"幕标题","instructions":"一两句话告诉学习者怎么操作、观察什么","script":"老师的引导语，60-120 字","html":"完整的 HTML 文档字符串"}',
    'html 的要求：',
    '- 一个自包含的 HTML 文档（<!doctype html> 开头），CSS 与 JavaScript 全部内联，不引用任何外部脚本、样式、字体、图片或网络请求。',
    '- 实现一个围绕本幕概念的小模拟或可探索演示：学习者拖滑块、点按钮或输入数值，页面即时用图形（canvas / SVG / DOM）和数字展示结果。',
    '- 页面宽度自适应（最窄 340px），高度控制在 420px 以内，中文界面。',
    '- 颜色只用这些已注入的 CSS 变量：var(--bg) var(--surface) var(--inset) var(--text) var(--text-2) var(--text-3) var(--border) var(--accent) var(--accent-soft) var(--solid) var(--on-solid) var(--ok) var(--bad)。canvas 里用 getComputedStyle(document.documentElement).getPropertyValue 读取。',
    '- 代码不超过 160 行，不使用 alert / localStorage / fetch。',
  ].join('\n'),
  pbl: [
    '{"title":"幕标题","brief":"项目背景与任务（80-150 字）","deliverable":"最终要交出的东西","milestones":[{"title":"里程碑","detail":"具体做什么、做到什么程度"}],"rubric":[{"criterion":"评价维度","levels":"优秀与合格分别是什么样"}],"script":"老师布置任务时说的话，80-140 字"}',
    '说明：milestones 给 3-5 个，每个都能在一两小时内完成；rubric 给 3-4 条。',
  ].join('\n'),
};

function sceneMessages(context: { title: string; objectives: string[]; plans: ScenePlan[]; level: AudienceLevel; material: string }, index: number): ChatMessage[] {
  const plan = context.plans[index];
  return [
    { role: 'system', content: `你在为一堂互动课编写其中一幕的内容。只输出一个合法 JSON 对象，不要输出任何解释、前后缀或 Markdown 代码围栏。字符串里的换行写成 \\n，反斜杠写成 \\\\。\n\n${CAST}` },
    { role: 'user', content: [
      `课程：${context.title}`,
      context.objectives.length ? `学习目标：${context.objectives.join('；')}` : '',
      `学习者：${LEVEL_HINTS[context.level]}`,
      `全课大纲：\n${context.plans.map((item, i) => `${i + 1}. [${item.type}] ${item.title}${i === index ? '  ← 现在写这一幕' : ''}`).join('\n')}`,
      `本幕：第 ${index + 1} 幕，类型 ${plan.type}（${SCENE_LABELS[plan.type]}），标题「${plan.title}」，目标：${plan.goal}`,
      '只写这一幕，不要重复前面几幕讲过的内容，也不要抢后面几幕的内容。mermaid 代码用 flowchart LR 或 flowchart TD，节点文字一律写成 A["文字"] 的带引号形式，不用括号和特殊符号。',
      context.material ? `参考资料：\n"""\n${context.material}\n"""` : '',
      `输出 JSON，结构如下：\n${SCENE_SCHEMAS[plan.type]}`,
    ].filter(Boolean).join('\n\n') },
  ];
}

// ───────────────────────── 生成管线 ─────────────────────────

/** 把模型网关的错误码换成学习者看得懂的一句话 */
export function describeModelError(error: unknown, fallback = '可能是网络或模型出了问题，请再试一次。'): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'model-auth') return '登录状态已失效，重新登录后再试。';
  if (code === 'model-busy') return '现在用模型的人比较多，稍等一会儿再试。';
  if (code === 'model-timeout') return '模型响应超时了，再试一次，或者把课程调短一些。';
  return fallback;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** 调一次 JSON 生成；JSON 不合法或校验不过时带着提醒重试一次 */
async function jsonWithRetry<T>(messages: ChatMessage[], options: { maxTokens: number; signal?: AbortSignal; temperature?: number }, normalise: (raw: unknown) => T | null): Promise<T> {
  let lastError: unknown = new Error('lesson-invalid');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await completeJson<unknown>({
        messages: attempt === 0 ? messages : [...messages, { role: 'user', content: '上一次的输出不是合法 JSON 或缺少必填字段。请严格按给定结构重新输出，只输出 JSON 对象本身。' }],
        ...options,
        // 结构化内容不需要长时间思考，轻度即可，整堂课才能在一两分钟内出完
        effort: 'low',
      });
      const value = normalise(raw);
      if (value !== null) return value;
      lastError = new Error('lesson-invalid');
    } catch (error) {
      if (error instanceof ModelUnavailableError || isAbort(error) || options.signal?.aborted) throw error;
      lastError = error;
      if (!(error instanceof Error && error.message === 'model-invalid-json')) throw error;
    }
  }
  throw lastError;
}

const SCENE_TOKENS: Record<SceneType, number> = { slide: 2200, whiteboard: 2400, quiz: 2200, interactive: 7000, pbl: 2200 };

async function generateScene(context: Parameters<typeof sceneMessages>[0], index: number, signal?: AbortSignal): Promise<LessonScene> {
  const plan = context.plans[index];
  return jsonWithRetry(sceneMessages(context, index), { maxTokens: SCENE_TOKENS[plan.type], signal, temperature: 0.6 }, (raw) => normalizeScene(raw, plan));
}

/**
 * 一键生成课程：先出大纲，再 3 路并行逐幕生成。
 * 没有可用模型时退到本地课程；某一幕失败时只把那一幕换成本地内容。
 */
export async function generateLesson(input: GenerateInput, options: { signal?: AbortSignal; onProgress?: (progress: GenerateProgress) => void } = {}): Promise<Lesson> {
  const { signal, onProgress } = options;
  const types = SCENE_TYPES.filter((type) => input.types.includes(type));
  if (!types.length) types.push('slide');
  const count = LENGTH_SCENES[input.length];
  if (!input.prompt.trim() && !input.topic && !input.sources.length) throw new LessonInputError('先写下想学的主题，或者打开一门课、勾选资料。');

  onProgress?.({ stage: 'outline', scenes: [] });
  let outline: Outline;
  try {
    outline = await jsonWithRetry(outlineMessages(input, count, types), { maxTokens: 1800, signal, temperature: 0.5 }, (raw) => normalizeOutline(raw, count, types));
  } catch (error) {
    if (!(error instanceof ModelUnavailableError)) throw error;
    const lesson = buildLocalLesson(input);
    onProgress?.({ stage: 'done', title: lesson.title, scenes: lesson.scenes.map((scene) => ({ title: scene.title, type: scene.type, status: 'fallback' })) });
    return lesson;
  }

  const progress: SceneProgress[] = outline.scenes.map((plan) => ({ title: plan.title, type: plan.type, status: 'pending' }));
  const report = () => onProgress?.({ stage: 'scenes', title: outline.title, scenes: progress.map((item) => ({ ...item })) });
  report();

  const context = { title: outline.title, objectives: outline.objectives, plans: outline.scenes, level: input.level, material: materialDigest(input, 3600) };
  // 没开课程时，本地补位的幕用大纲定下的课名，不用整句主题描述
  const fallbackPool = localScenePool({ ...input, prompt: outline.title });
  const scenes: LessonScene[] = new Array(outline.scenes.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < outline.scenes.length) {
      const index = cursor;
      cursor += 1;
      progress[index].status = 'running';
      report();
      try {
        scenes[index] = await generateScene(context, index, signal);
        progress[index].status = 'done';
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw error;
        scenes[index] = fallbackScene(outline.scenes[index], fallbackPool);
        progress[index].status = 'fallback';
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, outline.scenes.length) }, worker));

  const stamp = now();
  onProgress?.({ stage: 'done', title: outline.title, scenes: progress });
  return {
    id: newId(),
    title: outline.title,
    summary: outline.summary,
    objectives: outline.objectives,
    scenes,
    level: input.level,
    length: input.length,
    prompt: input.prompt.trim(),
    ...(input.topic ? { topicId: input.topic.topicId, topicTitle: input.topic.title } : {}),
    sourceTitles: input.sources.map((source) => source.title).slice(0, 8),
    origin: scenes.every((scene) => scene.origin === 'local') ? 'local' : 'model',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** 重新生成某一幕（需要模型；没有模型时抛 ModelUnavailableError） */
export async function regenerateScene(lesson: Lesson, index: number, material: Pick<GenerateInput, 'topic' | 'sources'>, signal?: AbortSignal): Promise<LessonScene> {
  const plans: ScenePlan[] = lesson.scenes.map((scene) => ({ type: scene.type, title: scene.title, goal: scene.goal }));
  const context = { title: lesson.title, objectives: lesson.objectives, plans, level: lesson.level, material: materialDigest(material, 3600) };
  const scene = await generateScene(context, index, signal);
  return { ...scene, id: lesson.scenes[index]?.id ?? scene.id };
}

// ───────────────────────── 本地课程（无模型） ─────────────────────────

interface LectureSection { title: string; text: string; code?: string }

function splitLecture(body: string, fallbackTitle: string): LectureSection[] {
  const sections: LectureSection[] = [];
  let current: LectureSection = { title: fallbackTitle, text: '' };
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    // 代码块里的 # 是注释，不是小标题
    const heading = inFence ? null : line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      if (current.text.trim()) sections.push(current);
      current = { title: plainText(heading[1]).slice(0, 24), text: '' };
    } else current.text += `${line}\n`;
  }
  if (current.text.trim()) sections.push(current);
  // 没有小标题的讲义：按段落均分成三节
  if (sections.length < 2) {
    const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const size = Math.max(1, Math.ceil(paragraphs.length / 3));
    sections.length = 0;
    for (let i = 0; i < paragraphs.length; i += size) {
      const text = paragraphs.slice(i, i + size).join('\n\n');
      // 小标题取开头第一个分句；太长就用讲义名加序号，不截半句话
      const clause = plainText(text).split(/[，,。：:；;！？!?\n]/)[0]?.trim() ?? '';
      const title = clause.length >= 3 && clause.length <= 22 ? clause : `${fallbackTitle.slice(0, 16)}（${sections.length + 1}）`;
      sections.push({ title, text });
    }
  }
  return sections.map((section) => {
    const code = section.text.match(/```[\w-]*\n([\s\S]*?)```/)?.[1]?.trim();
    return { ...section, text: section.text.trim(), ...(code ? { code } : {}) };
  }).filter((section) => plainText(section.text).length > 12 || section.code);
}

function sectionBullets(section: LectureSection): string[] {
  const prose = section.text.replace(/```[\s\S]*?```/g, '');
  const listed = prose.split('\n').map((line) => line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/)?.[1]?.trim()).filter((item): item is string => !!item);
  const items = listed.length >= 2 ? listed : splitSentences(prose, 64);
  return items.map((item) => item.replace(/[。；;]+$/, '')).filter((item) => item.length > 3).slice(0, 4);
}

const localBase = (title: string, goal: string, script: string, interjections: Interjection[] = []) => ({
  id: newId(), title, goal, script, interjections, origin: 'local' as const,
});

type PoolScene = { scene: LessonScene; priority: number };

/** 用课程自身内容（讲义、例子、要点、心魔、题库）拼出各类型的候选幕，按教学顺序排列 */
function localScenePool(input: Pick<GenerateInput, 'topic' | 'sources' | 'prompt'>): PoolScene[] {
  const { topic } = input;
  const pool: PoolScene[] = [];
  const lectureId = topic ? `lecture:${topic.topicId}` : '';
  const extraSources = input.sources.filter((source) => source.id !== lectureId && !(topic && source.id.startsWith(`example:${topic.topicId}:`)) && source.content.trim());
  const title = topic?.title ?? (input.prompt.trim().slice(0, 18) || extraSources[0]?.title || '这堂课');
  const sections = [
    ...(topic ? splitLecture(topic.prep.microLecture.body, topic.prep.microLecture.title) : []),
    ...extraSources.flatMap((source) => splitLecture(source.content.slice(0, 6000), source.title).slice(0, 4)),
  ];
  const points = topic?.checklist ?? [];

  // 引入
  const introBullets = topic
    ? [topic.tagline, ...points.slice(0, 3).map((item) => `弄清：**${item.point}**`)]
    : sections.slice(0, 4).map((section) => section.title);
  if (introBullets.length) {
    pool.push({ priority: 100, scene: {
      ...localBase('这堂课讲什么', `知道为什么要学「${title}」`,
        `今天这堂课讲「${title}」。${topic ? endSentence(topic.tagline) : ''}我们先看它要解决什么问题，再一步步拆开，最后做题和动手。有不明白的地方，随时举手。`,
        [{ speaker: 'xiaobai', text: `老师，「${title}」平时到底用在哪儿？我怕学完还是不会用。`, reply: '问得好。这堂课每一步都会落到具体例子上，你盯着例子看。' }]),
      type: 'slide', bullets: introBullets,
    } });
  }

  // 讲义分节
  sections.forEach((section, index) => {
    const bullets = sectionBullets(section);
    if (!bullets.length) return;
    const script = clipAtSentence(plainText(section.text), 260);
    pool.push({ priority: 80 - index * 12, scene: {
      ...localBase(section.title, `讲清「${section.title}」`, script,
        index === 0 ? [{ speaker: 'acheng', text: `这段我预习过，关键是不是「${bullets[0].replace(/\*\*/g, '').slice(0, 20)}」？`, reply: '方向对。先别急着下结论，把前提看完整。' }] : []),
      type: 'slide', bullets, ...(section.code ? { figure: { kind: 'code' as const, content: section.code } } : {}),
    } });
  });

  // 白板：要点一步步写
  if (points.length >= 2) {
    const shown = points.slice(0, 5);
    const diagram = `flowchart LR\n${shown.map((item, i) => `  P${i}["${item.point.replace(/["\n[\]]/g, ' ').slice(0, 14)}"]`).join('\n')}\n${shown.slice(1).map((_, i) => `  P${i} --> P${i + 1}`).join('\n')}`;
    const strokes: BoardStroke[] = [
      ...shown.map((item, i): BoardStroke => ({ kind: 'text', content: `${i + 1}. ${item.point}`, say: clipAtSentence(item.groundTruth, 110) })),
      { kind: 'diagram', content: diagram, say: '把这几条连起来看，前一条是后一条的前提。' },
      { kind: 'highlight', content: shown[shown.length - 1].groundTruth.slice(0, 60), say: '这一句圈起来，后面做题全靠它。' },
    ];
    const probe = points.find((item) => item.probeLine)?.probeLine;
    const probed = points.find((item) => item.probeLine);
    pool.push({ priority: 90, scene: {
      ...localBase('把要点写上白板', '按顺序掌握本节的关键要点', '', probe && probed ? [{ speaker: 'xiaobai', text: probe, reply: clipAtSentence(probed.groundTruth, 90) }] : []),
      type: 'whiteboard', strokes,
    } });
  } else if (sections.length >= 2) {
    const strokes: BoardStroke[] = sections.slice(0, 5).map((section, i): BoardStroke => ({ kind: 'text', content: `${i + 1}. ${section.title}`, say: clipAtSentence(plainText(section.text), 90) }));
    strokes.push({ kind: 'highlight', content: `${title}：${sections.length} 个部分环环相扣`, say: '记住这个顺序，后面复述时就按它讲。' });
    pool.push({ priority: 90, scene: { ...localBase('梳理结构', '看清内容的整体结构', ''), type: 'whiteboard', strokes } });
  }

  // 例子
  topic?.prep.examples.slice(0, 2).forEach((example, index) => {
    pool.push({ priority: 72 - index * 20, scene: {
      ...localBase(example.title.slice(0, 24), `用例子看懂「${title}」`, clipAtSentence(plainText(example.walkthrough), 280),
        index === 0 ? [{ speaker: 'acheng', text: '我先猜结果！老师别说答案。', reply: '好，大家都先在心里猜一个，再往下看。' }] : []),
      type: 'slide', bullets: splitSentences(example.walkthrough, 60).slice(0, 4), figure: { kind: 'code', content: example.code },
    } });
  });

  // 互动
  const example = topic?.prep.examples.find((item) => item.code.trim());
  const cards = points.length
    ? points.slice(0, 6).map((item) => ({ front: `用自己的话讲：${item.point}`, back: item.groundTruth }))
    : sections.slice(0, 6).map((section) => ({ front: `用自己的话讲：${section.title}`, back: clipAtSentence(plainText(section.text), 160) }));
  if (example) {
    pool.push({ priority: 85, scene: {
      ...localBase('逐行走查', '亲手把例子跑一遍，看清每一步发生了什么', '这一幕交给你动手。一行一行往下执行，每走一步之前先猜结果，再看讲解。猜错的那一行，就是你要重点弄懂的地方。'),
      type: 'interactive', html: codeStepperDoc(example.title, example.code, example.walkthrough), instructions: '点「执行下一行」逐行走查，也可以用键盘左右方向键。',
    } });
  } else if (cards.length >= 2) {
    pool.push({ priority: 85, scene: {
      ...localBase('讲一遍再翻牌', '检验自己能不能把每个要点讲出来', '这一幕交给你动手。每张牌先在心里讲一遍，再翻开对照。讲不出来的那几张，就是还没真正弄懂的地方。'),
      type: 'interactive', html: flipCardsDoc(`${title} · 要点翻牌`, cards), instructions: '先在心里讲一遍，再点「翻开对照」，然后老实自评。',
    } });
  }

  // 心魔
  if (topic?.misconceptions.length) {
    const list = topic.misconceptions.slice(0, 3);
    pool.push({ priority: 75, scene: {
      ...localBase('最容易想错的地方', '识别并纠正常见误解',
        `这一幕专门讲容易想错的地方。${list.map((item) => `有人会觉得：${item.belief}。这是不对的，${item.correctionCriteria[0] ?? item.probe.explanation}`).join('')}`.slice(0, 320),
        [{ speaker: 'xiaobai', text: list[0].triggerLine, reply: clipAtSentence(list[0].correctionCriteria[0] ?? list[0].probe.explanation, 90) }]),
      type: 'slide', bullets: list.map((item) => `**误解**：${item.belief}　→　${item.correctionCriteria[0] ?? item.probe.explanation}`),
    } });
  }

  // 测验
  const questions: LessonQuestion[] = [
    ...(topic?.quizBank ?? []).slice(0, 2).map((item): LessonQuestion => ({
      id: newId(), type: 'single', stem: item.code ? `${item.question}\n\n\`\`\`\n${item.code}\n\`\`\`` : item.question,
      options: item.options, answer: [item.answerIndex], explanation: item.explanation,
    })),
    ...(topic?.misconceptions ?? []).slice(0, 1).map((item): LessonQuestion => ({
      id: newId(), type: 'truefalse', stem: item.probe.statement, options: ['正确', '错误'], answer: [1], explanation: item.probe.explanation,
    })),
  ].filter((question) => question.options.length >= 2).slice(0, 3);
  if (questions.length) {
    pool.push({ priority: 95, scene: {
      ...localBase('随堂测验', '检验刚才的内容有没有真的进脑子', '讲到这里，先做几道题。不要翻前面的幻灯片，凭理解选。选完我来讲为什么。'),
      type: 'quiz', questions,
    } });
  }

  // 项目
  const selfCheck = topic?.prep.selfCheck ?? [];
  // 教学任务卡里预告过小白的第一问，拿来当项目的靶子
  const firstAsk = topic?.prep.taskCard.match(/「([^」]{4,80})」/)?.[1];
  pool.push({ priority: 76, scene: {
    ...localBase('把它讲给小白听', '用输出检验理解', `最后留一个小项目：准备一段三分钟的讲解，把「${title}」讲给小白听。讲的时候不许念定义，要有你自己的例子。讲完他会去考试，他考得怎么样，就是你讲得怎么样。`),
    type: 'pbl',
    brief: `准备一段三分钟的讲解，把「${title}」讲给一个完全没学过的同学听。不念定义，用自己的例子，并主动指出一个最容易想错的地方。${firstAsk ? `\n\n小白多半会先问你：「${firstAsk}」` : ''}`,
    deliverable: '一份三分钟讲稿，加一个原创例子',
    milestones: [
      { title: '列出必须讲到的要点', detail: points.length ? points.slice(0, 4).map((item) => item.point).join('、') : '从讲义里挑出 3-4 个不讲就听不懂的要点' },
      { title: '写一个自己的例子', detail: topic?.transferHint ? `可以试着迁移到：${topic.transferHint}` : '不能照搬讲义里的例子，换一个生活里的场景' },
      { title: '预演一遍并自检', detail: selfCheck.length ? selfCheck.slice(0, 2).join('；') : '对着空气讲一遍，卡住的地方回去再看' },
      { title: '讲给小白听', detail: '到讲解舱教小白，回答他的追问，直到他能复述' },
    ],
    rubric: [
      { criterion: '准确', levels: '优秀：没有说错的地方，边界条件也讲到；合格：主干正确' },
      { criterion: '例子', levels: '优秀：例子是自己的，并且能解释为什么成立；合格：能复述讲义的例子' },
      { criterion: '应对追问', levels: '优秀：小白提出误解时能当场纠正；合格：能在提示下纠正' },
    ],
  } });

  return pool;
}

/** 某一幕模型生成失败时，从本地候选里取同类型的一幕顶上；没有同类型就退成一页幻灯片 */
function fallbackScene(plan: ScenePlan, pool: PoolScene[]): LessonScene {
  const index = pool.findIndex((item) => item.scene.type === plan.type);
  if (index >= 0) {
    const [picked] = pool.splice(index, 1);
    return { ...picked.scene, title: plan.title, goal: plan.goal };
  }
  return { ...localBase(plan.title, plan.goal, `这一幕的目标是：${plan.goal}。这部分内容暂时没有生成出来，可以在「更多」里重新生成这一幕。`), type: 'slide', bullets: [plan.goal, '这一幕暂时没有生成出来，可以重新生成'] };
}

/** 没有模型时的整堂本地课程；既没有课程也没有资料时抛 LessonInputError */
export function buildLocalLesson(input: GenerateInput): Lesson {
  const hasMaterial = !!input.topic || input.sources.some((source) => source.content.trim().length > 40);
  if (!hasMaterial) {
    throw new LessonInputError('现在没有可用的模型，只凭一句主题生成不了课程。先打开一门课（或勾选资料），就能用它的讲义生成一堂本地演示课；接通模型后可以直接按主题生成。');
  }
  const types = input.types.length ? input.types : SCENE_TYPES;
  const count = LENGTH_SCENES[input.length];
  const pool = localScenePool(input).filter((item) => types.includes(item.scene.type));
  if (!pool.length) throw new LessonInputError('所选的幕类型在这门课里没有可用内容，请至少勾选「幻灯片」。');
  // 按优先级取前 count 幕，再还原成教学顺序
  const keep = new Set([...pool].sort((a, b) => b.priority - a.priority).slice(0, count));
  const scenes = pool.filter((item) => keep.has(item)).map((item) => item.scene);
  // 测验与项目放到讲解之后
  const order = (scene: LessonScene) => (scene.type === 'pbl' ? 2 : scene.type === 'quiz' ? 1 : 0);
  scenes.sort((a, b) => order(a) - order(b));
  const stamp = now();
  const title = input.topic?.title ?? (input.prompt.trim().slice(0, 18) || input.sources[0]?.title.slice(0, 18) || '资料导读');
  return {
    id: newId(),
    title,
    summary: input.topic?.tagline ?? '根据所选资料整理的导读课',
    objectives: (input.topic?.checklist ?? []).slice(0, 4).map((item) => `能讲清：${item.point}`),
    scenes,
    level: input.level,
    length: input.length,
    prompt: input.prompt.trim(),
    ...(input.topic ? { topicId: input.topic.topicId, topicTitle: input.topic.title } : {}),
    sourceTitles: input.sources.map((source) => source.title).slice(0, 8),
    origin: 'local',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

// ───────────────────────── 举手提问 ─────────────────────────

export interface TeacherAnswer {
  answer: string;
  remark?: { speaker: Classmate; text: string };
  /** true = 没有模型，答案是从本节内容里检索出来的 */
  local: boolean;
}

const REMARK_SPLIT = /\n?\s*@@\s*(小白|阿澄)\s*[:：]?\s*/;

function parseTeacherAnswer(text: string): Pick<TeacherAnswer, 'answer' | 'remark'> {
  const match = text.match(REMARK_SPLIT);
  if (!match || match.index === undefined) return { answer: text.trim() };
  const remark = text.slice(match.index + match[0].length).trim().split('\n')[0]?.slice(0, 120);
  return { answer: text.slice(0, match.index).trim(), ...(remark ? { remark: { speaker: SPEAKER_ALIASES[match[1]], text: remark } } : {}) };
}

function localAnswer(lesson: Lesson, scene: LessonScene, question: string): TeacherAnswer {
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9_]{2,}|[一-鿿]{2}/g) ?? [])];
  const candidates = [scene, ...lesson.scenes.filter((item) => item.id !== scene.id)].flatMap((item) => splitSentences(sceneDigest(item), 120));
  const ranked = candidates
    .map((text, index) => ({ text, index, score: terms.filter((term) => text.toLowerCase().includes(term)).length }))
    .filter((item) => item.score > 0 && item.text.length >= 12)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3);
  const quote = (ranked.length ? ranked.map((item) => item.text) : splitSentences(scene.script || sceneDigest(scene), 120).slice(0, 2)).map((text) => `> ${text}`).join('\n');
  return {
    answer: `现在没有可用的模型，我先把这堂课里和你的问题最相关的几句找出来：\n\n${quote}\n\n接通模型后，我可以针对你的问题展开讲。`,
    remark: { speaker: 'xiaobai', text: '这个我也没完全想明白。等会儿你弄懂了，讲给我听好不好？' },
    local: true,
  };
}

/** 举手提问：老师结合当前这一幕流式回答，末尾可能带一句同学的补充 */
export async function askTeacher(args: {
  lesson: Lesson;
  scene: LessonScene;
  question: string;
  /** 最近的课堂对话 */
  recent: { speaker: SpeakerId; text: string }[];
  /** 小砚对这位学习者的记忆提示 */
  hints?: string[];
  signal?: AbortSignal;
  onText?: (answer: string) => void;
}): Promise<TeacherAnswer> {
  const { lesson, scene, question } = args;
  const messages: ChatMessage[] = [
    { role: 'system', content: [
      `你是主讲老师「小砚」，正在上一堂名为「${lesson.title}」的课。一位同学举手提问，你要结合当前这一幕的内容回答。`,
      '要求：口语化，先给结论再解释，必要时举一个小例子；可以用 Markdown 与 $LaTeX$；不超过 220 字；不知道就直说，不编造。',
      '回答结束后，另起一行写 `@@小白：` 或 `@@阿澄：` 加一句这位同学的补充、追问或吐槽（40 字以内，口吻见下），只写一位。',
      CAST,
      args.hints?.length ? `你对这位提问同学的了解：\n${args.hints.map((hint) => `- ${hint}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n') },
    { role: 'user', content: [
      `当前这一幕的内容：\n"""\n${sceneDigest(scene).slice(0, 2400)}\n"""`,
      args.recent.length ? `刚才的课堂对话：\n${args.recent.slice(-8).map((line) => `${AGENTS[line.speaker].name}：${line.text}`).join('\n')}` : '',
      `同学的问题：${question}`,
    ].filter(Boolean).join('\n\n') },
  ];
  try {
    const result = await streamModel({
      messages, maxTokens: 900, temperature: 0.6, signal: args.signal,
      onText: (text) => args.onText?.(parseTeacherAnswer(text).answer),
    });
    const parsed = parseTeacherAnswer(result.text);
    if (!parsed.answer) throw new Error('empty-answer');
    return { ...parsed, local: false };
  } catch (error) {
    if (error instanceof ModelUnavailableError) return localAnswer(lesson, scene, question);
    throw error;
  }
}

// ───────────────────────── 让小白来答 ─────────────────────────

export interface XiaobaiAttempt { answer: number[]; correct: boolean; line: string }

/**
 * 小白答题：水平越低越容易答错（同一题在同一水平下结果固定）。
 * 这是产品主线的引子 —— 他答错了，就该轮到你去教他。
 */
export function xiaobaiAttempt(question: LessonQuestion, level: 1 | 2 | 3 | 4 | 5): XiaobaiAttempt {
  const seed = hash(`${question.stem}|${level}`);
  const chance = [0.3, 0.45, 0.6, 0.75, 0.88][level - 1] ?? 0.45;
  const correct = (seed % 1000) / 1000 < chance;
  let answer = [...question.answer];
  if (!correct) {
    const wrong = question.options.map((_, index) => index).filter((index) => !question.answer.includes(index));
    if (question.type === 'multiple' && question.answer.length > 1 && seed % 2 === 0) answer = question.answer.slice(0, -1);
    else if (wrong.length) answer = question.type === 'multiple' ? [...question.answer.slice(0, 1), wrong[seed % wrong.length]].sort((a, b) => a - b) : [wrong[seed % wrong.length]];
  }
  const picked = question.type === 'truefalse' ? `「${question.options[answer[0]]}」` : answer.map(optionLetter).join('、');
  const right = [`我选 ${picked}。刚才老师讲的那句我记住了，应该没错吧？`, `${picked}！这次我有把握，因为前面白板上写过。`, `我想选 ${picked}……我是照着刚才的例子推的。`];
  const wrongLines = [`我选 ${picked}……它看起来最像刚才讲的那个，对吗？`, `是 ${picked} 吧？我觉得别的选项都太绕了。`, `${picked}。呃，其实我是猜的，我没太听懂那一段。`];
  const lines = correct ? right : wrongLines;
  return { answer, correct: correct && sameAnswer(answer, question.answer), line: lines[seed % lines.length] };
}

export const sameAnswer = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
