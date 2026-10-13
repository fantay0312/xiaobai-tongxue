/** Search each source's actual knowledge base, accepting only already-authorized chunks. */
export async function searchSelectedSources(weknora, { assets, fallbackKb, query, chunks, requestId }) {
  const groups = new Map();
  for (const asset of assets) {
    const kb = asset.wkKbId || fallbackKb;
    if (!groups.has(kb)) groups.set(kb, []);
    groups.get(kb).push(asset.wkKnowledgeId);
  }
  const allowed = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const results = await Promise.allSettled([...groups].map(([kbId, knowledgeIds]) => weknora.search({ kbId, knowledgeIds, query, requestId })));
  const found = new Map();
  for (const result of results) if (result.status === 'fulfilled') for (const hit of result.value) {
    const id = String(hit?.id ?? hit?.chunk_id ?? hit?.chunkId ?? hit?.chunk?.id ?? '');
    if (allowed.has(id)) found.set(id, allowed.get(id));
  }
  return [...found.values()];
}
