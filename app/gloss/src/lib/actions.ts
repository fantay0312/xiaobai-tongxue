/** Quick actions on a selection. Shared by the lens (labels) and the server (prompts). */
import { countWords } from './article';

export type Action = "ask" | "explain" | "define" | "simplify" | "check" | "connect" | "counter";

export const ACTIONS: Record<Action, { label: string; hint: string }> = {
  ask: { label: "提问", hint: "输入你的问题" },
  explain: { label: "解释", hint: "解释这里的含义和作用" },
  define: { label: "定义", hint: "解释作者在这里如何使用这个词" },
  simplify: { label: "说简单些", hint: "用更通俗的话解释同一个意思" },
  check: { label: "事实核查", hint: "这个说法还成立吗？联网核查" },
  connect: { label: "相关段落", hint: "找出文中讨论同一问题的其他段落" },
  counter: { label: "反方观点", hint: "提出最有力的反对意见" },
};

/** Short selections get Define; longer ones get Simplify in the same slot. */
export const isShortSelection = (quote: string) => countWords(quote) <= 4;

export const ARTICLE_QUESTIONS = [
  "用三句话概括核心论点。",
  "作者最依赖哪些证据？",
  "严谨的质疑者会提出什么反对意见？",
];

/** How a one-click action reads in the notebook, so every entry scans as a question. */
export const ACTION_QUESTIONS: Record<Action, string> = {
  ask: "你的问题",
  explain: "这段话在这里是什么意思？",
  define: "这个词在这里是什么意思？",
  simplify: "能说得更简单些吗？",
  check: "这个说法还成立吗？",
  connect: "文中还有哪些段落讨论了这个问题？",
  counter: "最有力的反对意见是什么？",
};
