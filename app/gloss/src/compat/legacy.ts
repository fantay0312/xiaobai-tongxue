import { HOST_BASE } from './bridge';
import { saveDoc, savePdf, useStore } from '../lib/store';
import type { Article } from '../lib/article';

/** Preserve unsynced local notes and PDF originals from the earlier reader. */
export async function migrateLegacy(open: IDBFactory['open'], owner: string) {
  if (localStorage.getItem('legacy-migrated:v1')) return;
  const names = await indexedDB.databases();
  if (!names.some((item) => item.name === 'xiaobai-reader-v1')) { localStorage.setItem('legacy-migrated:v1', '1'); return; }
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = open('xiaobai-reader-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const prefix = `${encodeURIComponent(HOST_BASE)}:${encodeURIComponent(owner)}:`;
    const read = <T,>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((resolve, reject) => { const request = fn(db.transaction(store).objectStore(store)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [keys, docs] = await Promise.all([read('documents', (s) => s.getAllKeys()), read<any[]>('documents', (s) => s.getAll())]);
    for (const [index, key] of keys.entries()) {
      if (!String(key).startsWith(prefix)) continue;
      const old = docs[index]; if (!old?.blocks || old.deleted) continue;
      const article: Article = { id: old.id, title: old.title, author: old.author, sourceUrl: old.sourceUrl, origin: old.pdfFileId ? 'file' : 'paste', addedAt: old.createdAt,
        blocks: old.blocks.map((b: any) => ({ id: b.id, type: b.kind === 'heading' ? 'h2' : b.kind === 'image' ? 'figure' : b.kind === 'code' ? 'pre' : 'p', runs: [{ text: b.text }], src: b.src, page: b.page })) };
      const state = useStore.getState();
      if (!state.library.some((item) => item.id === article.id)) {
        await saveDoc(article); state.addToLibrary(article, old.wordCount || 0, { topic: old.topic, tags: old.tags, favorite: old.favorite });
        for (const m of old.marks || []) if (m.anchors?.length) state.addHighlight({ id: m.id, articleId: old.id, anchor: { start: { b: m.anchors[0].block, o: m.anchors[0].start }, end: { b: m.anchors.at(-1).block, o: m.anchors.at(-1).end }, quote: m.quote }, color: m.color, note: m.note, createdAt: m.createdAt });
        for (const g of old.threads || []) state.addGloss({ id: g.id, articleId: old.id, action: 'ask', ...(g.anchors?.length ? { anchor: { start: { b: g.anchors[0].block, o: g.anchors[0].start }, end: { b: g.anchors.at(-1).block, o: g.anchors.at(-1).end }, quote: g.quote } } : {}), turns: g.turns.map((t: any) => ({ role: t.role, content: t.text, model: t.model })), createdAt: g.createdAt });
      }
      if (db.objectStoreNames.contains('pdfs')) { const pdf = await read<Blob | undefined>('pdfs', (s) => s.get(key)); if (pdf) await savePdf(old.id, pdf); }
    }
    localStorage.setItem('legacy-migrated:v1', '1');
  } finally { db.close(); }
}
