/**
 * 资料检索：对当前课程讲义与已勾选资料做关键词检索与分段阅读。
 * 没有向量库，纯本地：按段切块，用英文词与中文二字词打分。
 */
import type { Topic } from '../../types';
import { courseSources, type NotebookSource } from '../notebookSources';

export interface Material {
  /** 原始资料 id */
  id: string;
  /** 给模型用的短编号：m1、m2… */
  alias: string;
  title: string;
  kind: string;
  content: string;
}

export interface MaterialHit {
  source_id: string;
  title: string;
  offset: number;
  excerpt: string;
}

const MAX_MATERIALS = 24;
const MAX_CONTENT = 120_000;
const CHUNK = 520;

/** 当前课程的讲义、例子、知识卡片，加上界面传入的已勾选资料（按 id 去重） */
export function collectMaterials(topic: Topic | undefined, selected: NotebookSource[]): Material[] {
  const sources: Pick<NotebookSource, 'id' | 'title' | 'content' | 'kind'>[] = topic ? [...courseSources(topic)] : [];
  const cards = topic?.checklist.map((item) => item.lookupCard?.trim()).filter(Boolean) ?? [];
  if (topic && cards.length) {
    sources.push({ id: `cards:${topic.topicId}`, title: `${topic.title} · 知识卡片`, content: cards.join('\n\n---\n\n'), kind: 'lecture' });
  }
  sources.push(...selected);
  const seen = new Set<string>();
  return sources
    .filter((source) => source.content?.trim() && !seen.has(source.id) && seen.add(source.id))
    .slice(0, MAX_MATERIALS)
    .map((source, index) => ({
      id: source.id,
      alias: `m${index + 1}`,
      title: source.title,
      kind: source.kind,
      content: source.content.slice(0, MAX_CONTENT),
    }));
}

function chunks(content: string): { offset: number; text: string }[] {
  const out: { offset: number; text: string }[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + CHUNK);
    if (end < content.length) {
      const cut = content.lastIndexOf('\n', end);
      if (cut > start + CHUNK / 2) end = cut;
    }
    const text = content.slice(start, end).trim();
    if (text) out.push({ offset: start, text });
    start = end;
  }
  return out;
}

/** 英文按词，中文按相邻二字 */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query.toLowerCase().match(/[a-z0-9_+#.-]{2,}|[一-鿿]+/g) ?? []) {
    if (!/^[一-鿿]/.test(token)) terms.add(token);
    else if (token.length === 2) terms.add(token);
    else for (let i = 0; i < token.length - 1; i += 1) terms.add(token.slice(i, i + 2));
  }
  return [...terms].slice(0, 40);
}

function countOf(haystack: string, needle: string, cap = 3): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0 && count < cap) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function searchMaterials(materials: Material[], query: string, limit = 5): MaterialHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const scored: (MaterialHit & { score: number })[] = [];
  for (const material of materials) {
    const titleBonus = terms.some((term) => material.title.toLowerCase().includes(term)) ? 1 : 0;
    for (const chunk of chunks(material.content)) {
      const lower = chunk.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + countOf(lower, term) * (/^[a-z0-9]/.test(term) ? 2 : 1), 0);
      if (score > 0) scored.push({ source_id: material.alias, title: material.title, offset: chunk.offset, excerpt: chunk.text, score: score + titleBonus });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(8, Math.max(1, limit)))
    .map(({ source_id, title, offset, excerpt }) => ({ source_id, title, offset, excerpt }));
}

export function findMaterial(materials: Material[], key: string): Material | undefined {
  const wanted = key.trim().toLowerCase();
  return materials.find((material) => material.alias === wanted || material.id.toLowerCase() === wanted)
    ?? materials.find((material) => material.title.toLowerCase() === wanted);
}

export function readMaterial(material: Material, offset = 0, length = 2400) {
  const start = Math.min(Math.max(0, Math.floor(offset) || 0), material.content.length);
  const size = Math.min(4000, Math.max(200, Math.floor(length) || 2400));
  const text = material.content.slice(start, start + size);
  return {
    source_id: material.alias,
    title: material.title,
    total: material.content.length,
    offset: start,
    text,
    has_more: start + text.length < material.content.length,
  };
}

/** 资料目录：编号、标题、字数 */
export function materialIndex(materials: Material[]) {
  return materials.map((material) => ({ source_id: material.alias, title: material.title, chars: material.content.length }));
}
