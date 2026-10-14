/** Quick actions on a selection. Shared by the lens (labels) and the server (prompts). */
import { countWords } from './article';

export type Action = "ask" | "explain" | "define" | "simplify" | "check" | "connect" | "counter";

export const ACTIONS: Record<Action, { label: string; hint: string }> = {
  ask: { label: "提问", hint: "输入你的问题" },
  explain: { label: "解释", hint: "解释这里的含义和作用" },
  define: { label: "定义", hint: "解释作者在这里如何使用这个词" },
  simplify: { label: "说简单些", hint: "The same idea in plain words" },
  check: { label: "Fact-check", hint: "这个说法还成立吗？联网核查" },
  connect: { label: "相关段落", hint: "Where else the text takes this up" },
  counter: { label: "反方观点", hint: "The strongest objection to it" },
};

/** Short selections get Define; longer ones get Simplify in the same slot. */
export const isShortSelection = (quote: string) => countWords(quote) <= 4;

export const ARTICLE_QUESTIONS = [
  "What is the core argument, in three sentences?",
  "What evidence does the author lean on most?",
  "What would a sharp skeptic say?",
];

/** How a one-click action reads in the notebook, so every entry scans as a question. */
export const ACTION_QUESTIONS: Record<Action, string> = {
  ask: "Your question",
  explain: "What does this mean here?",
  define: "What does this word mean here?",
  simplify: "能说得更简单些吗？",
  check: "这个说法还成立吗？",
  connect: "Where else does the text take this up?",
  counter: "What is the strongest objection?",
};
