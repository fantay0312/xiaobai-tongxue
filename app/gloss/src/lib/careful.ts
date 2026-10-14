"use client";

/**
 * "Read it more carefully": the PDF behind a text, read again by LlamaParse
 * through /api/pdf-careful, for layouts the free reader gets wrong (columns,
 * tables, maths, scans). Needs the reader's own Together key.
 */

import { markdownBlocks, wordCount, type Article } from "./article";
import { readApiKey } from "./ask";
import { htmlTablesToMarkdown, stitchBlocks } from "./pdf";
import { loadDoc, loadPdf, useStore } from "./store";

export type CarefulResult = { ok: true; article: Article } | { ok: false; error: string; needKey?: boolean };

const same = (a: string, b: string) => a.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase() === b.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

export async function readCarefully(shown: Article, signal?: AbortSignal): Promise<CarefulResult> {
  // The reader shows a display copy; the new reading builds on the stored original.
  const article = (await loadDoc(shown.id)) ?? shown;
  const pdf = await loadPdf(article.id);
  if (!pdf) return { ok: false, error: "当前设备没有这份 PDF，请重新打开原文件后精读。" };
  const key = readApiKey();
  if (!key) return { ok: false, error: "请在设置中选择服务器提供的精读模型。", needKey: true };

  const form = new FormData();
  form.append("file", pdf, "document.pdf");
  let j: { pages?: string[]; truncated?: boolean; error?: string; code?: string };
  let status = 0;
  try {
    const res = await fetch("/api/pdf-careful", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal });
    status = res.status;
    j = await res.json();
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: "已停止精读。" };
    return { ok: false, error: "连接已中断，请检查网络后重试。" };
  }
  if (status !== 200 || !j.pages) return { ok: false, error: j.error ?? `精读请求失败（${status}），请稍后重试。`, needKey: j.code === "need_key" };
  // A partial reading would drop the rest of the text, so it does not replace anything.
  if (j.truncated) return { ok: false, error: "精读结果不完整，原文已保留。请拆分 PDF 后重试。" };

  let blocks = stitchBlocks(j.pages.flatMap((md) => markdownBlocks(htmlTablesToMarkdown(md))));
  // The title is already shown above the text.
  if (blocks[0] && (blocks[0].type === "h2" || blocks[0].type === "h3") && same(blocks[0].runs.map((r) => r.text).join(""), article.title)) blocks = blocks.slice(1);
  if (!blocks.some((b) => b.type === "p")) return { ok: false, error: "精读没有返回正文，原文已保留。" };
  // Ids from separate pages would collide; number them again in reading order.
  blocks = blocks.map((b, i) => ({ ...b, id: `b${i + 1}` }));

  const next: Article = { ...article, blocks };
  if (!(await useStore.getState().replaceText(next, wordCount(next)))) return { ok: false, error: "浏览器存储空间不足，原文已保留。请释放空间后重试。" };
  window.dispatchEvent(new CustomEvent("gloss:text-replaced", { detail: next }));
  return { ok: true, article: next };
}
