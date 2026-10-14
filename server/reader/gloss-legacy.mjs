export function legacyArticle(doc) {
  return { id: doc.id, title: doc.title, author: doc.author, sourceUrl: doc.sourceUrl, origin: 'paste', addedAt: doc.createdAt,
    blocks: doc.blocks.map((b) => ({ id: b.id, type: b.kind === 'heading' ? 'h2' : b.kind === 'image' ? 'figure' : b.kind === 'code' ? 'pre' : 'p', runs: [{ text: b.text }], ...(b.src ? { src: b.src, alt: b.text } : {}), ...(b.page ? { page: b.page } : {}) })) };
}
export function legacyRows(doc) {
  const article = legacyArticle(doc);
  const row = (collection, id, data) => ({ collection, id, articleId: doc.id, data, deleted: doc.deleted === true, revision: 0 });
  const anchor = (anchors, quote) => anchors?.length ? { start: { b: anchors[0].block, o: anchors[0].start }, end: { b: anchors.at(-1).block, o: anchors.at(-1).end }, quote } : undefined;
  const rows = [row('articles', doc.id, { id: doc.id, title: doc.title, author: doc.author, sourceUrl: doc.sourceUrl, words: Math.ceil((doc.wordCount || doc.blocks.reduce((n, b) => n + b.text.length, 0)) / 3), origin: 'paste', addedAt: doc.createdAt, topic: doc.topic, tags: doc.tags, favorite: doc.favorite, ...(doc.agent ? { addedBy: 'agent' } : {}) })];
  for (const mark of doc.marks) rows.push(row('highlights', mark.id, { id: mark.id, articleId: doc.id, anchor: anchor(mark.anchors, mark.quote), createdAt: mark.createdAt, color: mark.color, note: mark.note, review: mark.due ? { due: mark.due, step: mark.level || 0, last: mark.createdAt, off: mark.retired } : undefined }));
  for (const thread of doc.threads) rows.push(row('glosses', thread.id, { id: thread.id, articleId: doc.id, anchor: anchor(thread.anchors, thread.quote), action: 'ask', question: thread.turns.find((t) => t.role === 'user')?.text, turns: thread.turns.map((t) => ({ role: t.role, content: t.text, model: t.model })), createdAt: thread.createdAt }));
  if (doc.brief) rows.push(row('briefs', doc.id, { status: 'ready', data: { gist: doc.brief, claims: [], caveats: [], sections: [] }, at: doc.updatedAt }));
  rows.push(row('progress', doc.id, { block: doc.blocks[Math.min(doc.blocks.length - 1, Math.floor(doc.progress * doc.blocks.length))]?.id || '', pct: doc.progress, at: doc.updatedAt }));
  return { article, rows };
}
