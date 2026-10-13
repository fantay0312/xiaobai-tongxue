import { resolveBuiltinStudyTopic } from './study-catalog.mjs';
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

/** Positive projection; neither teacher rubrics nor client system instructions cross this seam. */
export function studyMaterial(topic) {
  return { topicId: text(topic?.topicId, 100), title: text(topic?.title, 120), course: text(topic?.course, 120),
    lecture: text(topic?.prep?.microLecture?.body ?? topic?.lecture, 6000),
    examples: Array.isArray(topic?.prep?.examples ?? topic?.examples) ? (topic.prep?.examples ?? topic.examples).slice(0, 6).map((item) => ({ title: text(item?.title, 100), code: text(item?.code, 600), walkthrough: text(item?.walkthrough, 600) })) : [] };
}

export function selectStudyMaterials(material, selection, assets = [], librarySources = []) {
  const invalid = () => { throw Object.assign(new Error('study-selection-invalid'), { status: 400 }); };
  if (!selection || typeof selection !== 'object' || typeof selection.includeLecture !== 'boolean' || !Array.isArray(selection.exampleIndices) || !Array.isArray(selection.assetIds) || !Array.isArray(selection.textSources)) invalid();
  if (selection.exampleIndices.length > 6 || selection.assetIds.length > 12 || selection.textSources.length > 16) invalid();
  const sources = [];
  if (selection.includeLecture) sources.push({ id: `lecture:${material.topicId}`, title: material.title, content: material.lecture });
  for (const index of new Set(selection.exampleIndices)) {
    if (!Number.isInteger(index) || !material.examples[index]) invalid();
    const item = material.examples[index]; sources.push({ id: `example:${material.topicId}:${index}`, title: item.title, content: `${item.code}\n\n${item.walkthrough}` });
  }
  for (const id of new Set(selection.assetIds)) {
    const asset = assets.find((source) => source.assetId === id);
    if (!asset) invalid();
    sources.push({ id: asset.id, title: asset.title, content: asset.content });
  }
  for (const source of selection.textSources) {
    if (!/^text:[\w-]{1,80}$/.test(source?.id) || typeof source.content !== 'string' || !source.content.trim()) invalid();
    sources.push({ id: source.id, title: text(source.title, 120) || '用户补充文本', content: source.content.slice(0, 4000) });
  }
  sources.push(...librarySources.map((source) => ({ id: source.id, title: source.title, content: source.excerpt })));
  if (!sources.length || !sources.some((source) => source.content.trim())) invalid();
  return sources;
}

export function createStudyTutorRouter({ provider, resolveOwner, customContent, fileLibrary, reserveCalls, send, readJson, hasJsonContentType, resolveBuiltin = resolveBuiltinStudyTopic }) {
  const owners = new Set();
  let inflight = 0;
  return { async handle(req, res, pathname) {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    if (pathname === '/api/study/status' && req.method === 'GET') return send(res, 200, await provider.status());
    if (pathname !== '/api/study/chat' || req.method !== 'POST') return send(res, 404, { error: 'not-found' });
    if (!hasJsonContentType(req)) return send(res, 415, { error: 'json-required' });
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    let release = () => {};
    try {
      const body = await readJson(req, 128000);
      const question = text(body?.question, 3000).trim();
      const topicId = text(body?.topic?.topicId, 100);
      if (question.length < 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(topicId)) return send(res, 400, { error: 'study-input-invalid' });
      if (inflight >= 2 || owners.has(owner.name)) return send(res, 429, { error: 'study-busy' });
      owners.add(owner.name); inflight += 1;
      release = () => { owners.delete(owner.name); inflight -= 1; };
      if (!(await provider.status()).available) return send(res, 503, { error: 'deeptutor-unavailable' });
      let material = studyMaterial(body.topic);
      let sources;
      let sourceNote = '';
      if (topicId.startsWith('custom-')) {
        if (!customContent || !owner.id) return send(res, 503, { error: 'custom-content-unavailable' });
        material = studyMaterial(await customContent.getPublishedTopic(owner, topicId));
        if (body.selection === undefined) try {
          sources = (await customContent.findStudySources(owner, topicId, { query: question }, `study-${Date.now()}`)).slice(0, 5).map((source) => ({ id: `${source.assetId}:${source.chunkId}`.slice(0, 100), title: text(source.filename, 100), excerpt: text(source.excerpt, 550) }));
        } catch { sourceNote = '原始资料检索暂不可用，本轮仅依据已发布讲义。'; }
      } else if (topicId === 'library') {
        if (!body.selection?.libraryFileIds?.length) return send(res, 400, { error: 'study-selection-invalid' });
        material = { topicId: 'library', title: '资料对话', course: '资料库', lecture: '', examples: [] };
      } else {
        const builtin = resolveBuiltin(topicId);
        if (!builtin) return send(res, 404, { error: 'topic-not-found' });
        material = studyMaterial(builtin);
      }
      if (body.selection !== undefined) {
        const assetIds = body.selection?.assetIds;
        if (!Array.isArray(assetIds)) throw Object.assign(new Error('study-selection-invalid'), { status: 400 });
        const assets = assetIds.length && topicId.startsWith('custom-') ? await customContent.listStudyMaterials(owner, topicId, `study-${Date.now()}`) : [];
        const ids = body.selection.libraryFileIds ?? [];
        if (!Array.isArray(ids) || ids.length > 12) throw Object.assign(new Error('study-selection-invalid'), { status: 400 });
        const library = typeof fileLibrary === 'function' ? fileLibrary() : fileLibrary;
        const libraryEvidence = ids.length ? (await library.sources(owner, ids, question)).evidence : [];
        const selected = selectStudyMaterials(material, body.selection, assets, libraryEvidence);
        sources = [...libraryEvidence, ...selected.filter((source) => !libraryEvidence.some((item) => item.id === source.id)).map((source) => ({ id: source.id, title: source.title, excerpt: source.content.slice(0, 550) }))].slice(0, 5);
        material = { ...material, lecture: sources.map((source) => `${source.title}\n${source.excerpt}`).join('\n\n'), examples: [] };
        sourceNote = '本轮仅使用勾选资料的有限片段。';
      }
      if (!material.lecture.trim()) return send(res, 400, { error: 'study-material-required' });
      if (!sources?.length) sources = [{ id: `lecture:${topicId}`, title: material.title, excerpt: material.lecture.slice(0, 550) }];
      if (!await reserveCalls(owner, res, 4)) return;
      if (controller.signal.aborted) return;
      const result = await provider.ask({ question, material, sources, note: text(body.note, 1500),
        history: Array.isArray(body.history) ? body.history.slice(-6).filter((item) => item && ['user', 'assistant'].includes(item.role)).map((item) => ({ role: item.role, text: text(item.text, 600) })) : [] }, controller.signal);
      if (!controller.signal.aborted) send(res, 200, { ...result, sources, sourceNote });
    } catch (error) {
      if (!controller.signal.aborted) {
        const status = error.status === 400 ? 400 : error.status === 404 ? 404 : error.message === 'body-too-large' ? 413 : error.message === 'study-timeout' ? 504 : 502;
        send(res, status, { error: status === 400 ? 'study-selection-invalid' : status === 404 ? 'topic-not-found' : status === 413 ? 'body-too-large' : 'study-failed' });
      }
    } finally { release(); res.off('close', abort); }
  } };
}
