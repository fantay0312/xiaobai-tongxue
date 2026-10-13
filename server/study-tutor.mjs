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

/** runner 每完成一轮上报的标签 → 面向学习者的阶段。只有标签会经过这里，不含模型正文。 */
const STAGES = [
  { key: 'PLAN', id: 'plan', label: '拟定讲解提纲' },
  { key: 'CHECK', id: 'check', label: '核对资料依据' },
  { key: 'FINISH', id: 'finish', label: '组织解释与自检题' },
];
const SOURCE_SLOTS = 5; // 与前端展示的来源条数一致，引用序号才对得上

/** 勾选资料 → 展示用来源（短摘录）和给模型的正文（更完整，但有总量上限）。 */
function packSelectedSources(evidence, course, overviews) {
  // 课程资料与检索片段共用 5 个位置，任何一方都不会被另一方完全挤掉。
  const kept = evidence.slice(0, course.length ? Math.max(SOURCE_SLOTS - course.length, 3) : SOURCE_SLOTS);
  const picked = [...kept, ...course.map((source) => ({ id: source.id, title: source.title, excerpt: source.content.slice(0, 550), body: source.content.slice(0, source.id.startsWith('lecture:') ? 3000 : 1500) }))].slice(0, SOURCE_SLOTS);
  const seen = new Set();
  let budget = 8000;
  const parts = picked.map((source) => {
    let body = source.body ?? source.excerpt;
    // 资料库文件除命中片段外，再带一段全文抽样，概括类问题才有依据。
    const overview = source.fileId && !seen.has(source.fileId) ? overviews.get(source.fileId) : '';
    if (source.fileId) seen.add(source.fileId);
    if (overview) body = `${body}\n\n同一文件的其他片段：\n${overview.slice(0, 1500)}`;
    body = body.slice(0, Math.max(budget, 0));
    budget -= body.length;
    return `${source.title}\n${body}`;
  });
  return { sources: picked.map(({ body: _body, ...source }) => source), lecture: parts.join('\n\n') };
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
    // 客户端声明 Accept: text/event-stream 时逐阶段推送；否则保持一次性 JSON 响应。
    const streaming = /\btext\/event-stream\b/i.test(String(req.headers.accept ?? ''));
    let heartbeat;
    const emit = (event, data) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
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
        if (ids.length && !library) return send(res, 503, { error: 'library-unavailable' });
        const fromLibrary = ids.length ? await library.sources(owner, ids, question) : {};
        const libraryEvidence = Array.isArray(fromLibrary.evidence) ? fromLibrary.evidence : [];
        const selected = selectStudyMaterials(material, body.selection, assets, libraryEvidence);
        // 课程里勾选的原始资料按问题检索片段，和未勾选时、资料库文件的取法一致；检索不可用时退回资料开头。
        let assetEvidence = [];
        if (assets.length) try {
          assetEvidence = (await customContent.findStudySources(owner, topicId, { query: question, assetIds: [...new Set(assetIds)] }, `study-${Date.now()}`))
            .map((hit) => ({ id: `${hit.assetId}:${hit.chunkId}`.slice(0, 100), assetId: hit.assetId, title: text(hit.filename, 100), excerpt: text(hit.excerpt, 550), body: text(hit.excerpt, 1400) }));
        } catch { assetEvidence = []; }
        const course = selected.filter((source) => !libraryEvidence.some((item) => item.id === source.id) && !assetEvidence.some((hit) => source.id === `asset:${hit.assetId}`));
        const overviews = new Map((Array.isArray(fromLibrary.sources) ? fromLibrary.sources : []).map((source) => [source.libraryFileId, text(source.content, 6000)]));
        // 资料库片段与课程资料片段交替排列，两类来源都能进入有限的位置。
        const evidence = [];
        for (let i = 0; i < SOURCE_SLOTS; i += 1) evidence.push(...[libraryEvidence[i], assetEvidence[i]].filter(Boolean));
        const packed = packSelectedSources(evidence, course, overviews);
        sources = packed.sources;
        material = { ...material, lecture: packed.lecture, examples: [] };
        sourceNote = '本轮仅使用勾选资料的有限片段。';
      }
      if (!material.lecture.trim()) return send(res, 400, { error: 'study-material-required' });
      if (!sources?.length) sources = [{ id: `lecture:${topicId}`, title: material.title, excerpt: material.lecture.slice(0, 550) }];
      if (!await reserveCalls(owner, res, 4)) return;
      if (controller.signal.aborted) return;
      let onProgress;
      if (streaming) {
        // 资料此时已取齐；之后每完成一轮，把该阶段标为完成并点亮下一阶段。
        let cursor = 0;
        emit('stage', { id: 'sources', label: '读取所选资料', status: 'done' });
        emit('stage', { id: STAGES[0].id, label: STAGES[0].label, status: 'running' });
        onProgress = (key) => {
          const index = STAGES.findIndex((stage) => stage.key === key);
          if (index < cursor) return; // 重复轮次不回退进度
          for (; cursor <= index; cursor += 1) emit('stage', { id: STAGES[cursor].id, label: STAGES[cursor].label, status: 'done' });
          if (cursor < STAGES.length) emit('stage', { id: STAGES[cursor].id, label: STAGES[cursor].label, status: 'running' });
        };
        // 各轮之间可能静默几十秒，注释行防止反向代理按空闲超时断开。
        heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n'); }, 15000);
      }
      const result = await provider.ask({ question, material, sources, note: text(body.note, 1500),
        history: Array.isArray(body.history) ? body.history.slice(-6).filter((item) => item && ['user', 'assistant'].includes(item.role)).map((item) => ({ role: item.role, text: text(item.text, 600) })) : [] }, controller.signal, onProgress);
      if (controller.signal.aborted) return;
      if (streaming) { emit('done', { ...result, sources, sourceNote }); res.end(); }
      else send(res, 200, { ...result, sources, sourceNote });
    } catch (error) {
      if (!controller.signal.aborted) {
        const status = error.status === 400 ? 400 : error.status === 404 ? 404 : error.message === 'body-too-large' ? 413 : error.message === 'study-timeout' ? 504 : 502;
        const code = status === 400 ? 'study-selection-invalid' : status === 404 ? 'topic-not-found' : status === 413 ? 'body-too-large' : 'study-failed';
        if (res.headersSent) { emit('error', { error: code, status }); res.end(); }
        else send(res, status, { error: code });
      }
    } finally { clearInterval(heartbeat); release(); res.off('close', abort); }
  } };
}
