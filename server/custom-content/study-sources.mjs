const stem = (word) => word.length > 5 ? word.replace(/(?:ing|ed|s)$/u, '') : word;
const normalize = (text) => String(text).toLowerCase().replace(/√/g, 'sqrt').replace(/[a-z]{3,}/g, stem).replace(/[^\p{L}\p{N}]/gu, '');
function tokensOf(text) {
  const tokens = new Set((String(text).toLowerCase().match(/[a-z0-9]+(?:[_+-][a-z0-9]+)*/g) ?? []).filter((word) => word.length > 1).map(normalize));
  for (const run of String(text).match(/\p{Script=Han}+/gu) ?? []) {
    for (let i = 0; i + 1 < run.length; i += 1) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens].slice(0, 64);
}

/** Rank only enumerated authorized chunks; rare formula terms outrank repeated section names. */
export function rankStudySources(query, groups) {
  const tokens = tokensOf(query);
  const documents = groups.flatMap(({ asset, chunks }) => chunks.map((raw) => ({
    asset,
    chunkId: String(raw?.id ?? raw?.chunk_id ?? raw?.chunkId ?? raw?.chunk?.id ?? '').trim(),
    content: String(raw?.content ?? raw?.text ?? raw?.chunk_content ?? raw?.chunk?.content ?? raw?.document?.content ?? '').trim().slice(0, 24000),
  }))).map((document) => ({ ...document, normalized: normalize(document.content) }));
  const frequencies = new Map(tokens.map((token) => [token, documents.filter((document) => document.normalized.includes(token)).length]));
  const candidates = documents.map(({ asset, chunkId, content, normalized }) => {
    const matched = tokens.filter((token) => normalized.includes(token));
    const score = matched.reduce((sum, token) => sum + Math.log(1 + documents.length / (frequencies.get(token) || 1)) ** 2, 0);
    const offsets = matched.map((token) => content.toLowerCase().indexOf(token)).filter((offset) => offset >= 0);
    const start = offsets.length ? Math.max(0, Math.min(...offsets) - 120) : 0;
    return { chunkId, assetId: asset.id, filename: asset.filename, excerpt: content.slice(start, start + 1400), score };
  }).filter((source) => source.chunkId && source.excerpt && source.score > 0);
  const seen = new Set();
  return candidates.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .filter((source) => {
      const key = `${source.assetId}:${source.chunkId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5).map(({ score: _score, ...source }) => source);
}
