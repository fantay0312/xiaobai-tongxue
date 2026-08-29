const LEVELS = new Set(['L1', 'L2', 'L3', 'L5']);
const MAX_TEXT = 8_000;

function text(value, maximum = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function stringList(value, maximum = 12, itemMaximum = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, itemMaximum))
    .filter(Boolean)
    .slice(0, maximum);
}

function keywordGroups(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((group) => stringList(group, 8, 60))
    .filter((group) => group.length > 0)
    .slice(0, 8);
}

function quizOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => text(item, 500));
}

function cleanId(value, fallback, maximum = 80) {
  const candidate = text(value, maximum).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return candidate || fallback;
}

function normalizeQuiz(item, index) {
  // 题目选项保留空槽交给质量闸门；删除空槽会令 answerIndex 静默指向另一项。
  const options = quizOptions(item?.options);
  return {
    id: cleanId(item?.id, `q${index + 1}`, 60),
    ...(text(item?.code, 4_000) ? { code: text(item.code, 4_000) } : {}),
    question: text(item?.question, 1_000),
    options,
    answerIndex: Number.isInteger(item?.answerIndex) ? item.answerIndex : -1,
    explanation: text(item?.explanation, 1_500),
    checklistRef: cleanId(item?.checklistRef, '', 40),
    mcRef: item?.mcRef === null ? null : text(item?.mcRef, 80) || null,
  };
}

function normalizeRemedy(value) {
  return {
    microLesson: {
      title: text(value?.microLesson?.title, 160),
      body: text(value?.microLesson?.body, 5_000),
      askBack: text(value?.microLesson?.askBack, 500),
    },
    predictionQuiz: (Array.isArray(value?.predictionQuiz) ? value.predictionQuiz : [])
      .slice(0, 5)
      .map((item, index) => normalizeQuiz(item, index)),
  };
}

export function normalizeTopicDraft(raw, {
  topicId,
  courseTitle,
  sourceAssets = [],
  promptVersion,
  model,
} = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const checklist = (Array.isArray(value.checklist) ? value.checklist : [])
    .slice(0, 10)
    .map((item, index) => ({
      id: cleanId(item?.id, `c${index + 1}`, 40),
      point: text(item?.point, 160),
      groundTruth: text(item?.groundTruth, 2_000),
      keywords: keywordGroups(item?.keywords),
      terms: stringList(item?.terms, 20, 80),
      level: LEVELS.has(item?.level) ? item.level : index === 0 ? 'L1' : index === 1 ? 'L2' : index === 2 ? 'L3' : 'L5',
      lookupCard: text(item?.lookupCard, 2_000),
      probeLine: text(item?.probeLine, 500),
      sourceChunkIds: stringList(item?.sourceChunkIds, 8, 100),
      sourceExcerpt: text(item?.sourceExcerpt, 800),
    }));
  const checklistIds = new Set(checklist.map((item) => item.id));
  const misconceptions = (Array.isArray(value.misconceptions) ? value.misconceptions : [])
    .slice(0, 8)
    .map((item, index) => ({
      mcId: cleanId(item?.mcId, `${topicId || 'custom'}_M${index + 1}`, 100),
      topicId,
      belief: text(item?.belief, 800),
      triggerLine: text(item?.triggerLine, 600),
      correctionCriteria: stringList(item?.correctionCriteria, 8, 600),
      correctionKeywords: keywordGroups(item?.correctionKeywords),
      adoptionKeywords: keywordGroups(item?.adoptionKeywords),
      injectAfterChecklist: stringList(item?.injectAfterChecklist, 8, 40)
        .filter((id) => checklistIds.has(id)),
      probe: {
        statement: text(item?.probe?.statement, 600),
        isTrue: false,
        explanation: text(item?.probe?.explanation, 1_200),
      },
      remedy: normalizeRemedy(item?.remedy),
    }));
  const quizBank = (Array.isArray(value.quizBank) ? value.quizBank : [])
    .slice(0, 8)
    .map((item, index) => normalizeQuiz(item, index));

  return {
    topicId,
    title: text(value.title, 160),
    course: text(courseTitle, 120),
    tagline: text(value.tagline, 240),
    checklist,
    misconceptions,
    quizBank,
    prep: {
      microLecture: {
        title: text(value.prep?.microLecture?.title, 160),
        body: text(value.prep?.microLecture?.body, 8_000),
      },
      examples: (Array.isArray(value.prep?.examples) ? value.prep.examples : [])
        .slice(0, 5)
        .map((example) => ({
          title: text(example?.title, 160),
          code: text(example?.code, 5_000),
          walkthrough: text(example?.walkthrough, 2_500),
        })),
      selfCheck: stringList(value.prep?.selfCheck, 10, 500),
      taskCard: text(value.prep?.taskCard, 1_000),
    },
    transferHint: text(value.transferHint, 240),
    sources: sourceAssets.map((asset) => ({
      assetId: asset.id,
      wkKnowledgeId: asset.wkKnowledgeId,
      filename: asset.filename,
      role: asset.assetRole,
    })),
    compileMeta: {
      model,
      promptVersion,
      teacherEdited: value.compileMeta?.teacherEdited === true,
    },
  };
}

function issue(code, path, message, level = 'error') {
  return { code, path, message, level };
}

function validateQuizItems(items, path, checklistIds, misconceptionIds, issues, { minimum = 3, exact = null } = {}) {
  if (!Array.isArray(items)) {
    issues.push(issue('quiz-count', path, exact ? `恰好需要 ${exact} 道题` : `至少需要 ${minimum} 道题`));
    return;
  }
  if ((exact !== null && items.length !== exact) || (exact === null && items.length < minimum)) {
    issues.push(issue('quiz-count', path, exact ? `恰好需要 ${exact} 道题` : `至少需要 ${minimum} 道题`));
  }
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}.${index}`;
    const options = Array.isArray(item.options) ? item.options : [];
    if (!item.id || ids.has(item.id)) issues.push(issue('quiz-id', `${itemPath}.id`, '题目编号必须非空且不重复'));
    ids.add(item.id);
    if (!item.question || options.length < 2 || options.some((option) => !option)) {
      issues.push(issue('quiz-shape', itemPath, '每题须有题干与至少两个选项'));
    }
    if (!Number.isInteger(item.answerIndex) || item.answerIndex < 0 || item.answerIndex >= options.length) {
      issues.push(issue('quiz-answer', `${itemPath}.answerIndex`, '正确选项下标无效'));
    }
    if (!item.explanation) issues.push(issue('quiz-explanation', `${itemPath}.explanation`, '每题须附课件依据'));
    if (!checklistIds.has(item.checklistRef)) {
      issues.push(issue('quiz-checklist-ref', `${itemPath}.checklistRef`, '题目必须关联已有讲解要点'));
    }
    if (item.mcRef && !misconceptionIds.has(item.mcRef)) {
      issues.push(issue('quiz-misconception-ref', `${itemPath}.mcRef`, '题目关联的误区不存在'));
    }
  }
}

export function validateTopicDraft(topic, { sourceCorpus = '' } = {}) {
  const issues = [];
  if (!text(topic?.title, 160)) issues.push(issue('title-required', 'title', '课题名称不能为空'));
  if (!text(topic?.tagline, 240)) issues.push(issue('tagline-required', 'tagline', '请补一句课题引子'));
  if (!Array.isArray(topic?.checklist) || topic.checklist.length < 3 || topic.checklist.length > 7) {
    issues.push(issue('checklist-count', 'checklist', '讲解要点须为 3–7 条'));
  }
  const ids = new Set();
  for (const [index, item] of (topic?.checklist ?? []).entries()) {
    const path = `checklist.${index}`;
    if (!item.id || ids.has(item.id)) issues.push(issue('checklist-id', `${path}.id`, '要点编号必须非空且不重复'));
    ids.add(item.id);
    if (!item.point) issues.push(issue('checklist-point', `${path}.point`, '要点名称不能为空'));
    if (!item.groundTruth) issues.push(issue('ground-truth', `${path}.groundTruth`, '每条要点必须有评估依据'));
    if (!Array.isArray(item.keywords) || item.keywords.length === 0) {
      issues.push(issue('keywords-required', `${path}.keywords`, '每条要点至少需要一组命中词'));
    }
    if (!LEVELS.has(item.level)) issues.push(issue('checklist-level', `${path}.level`, '追问层级只能是 L1、L2、L3 或 L5'));
    if (!item.lookupCard) issues.push(issue('lookup-card', `${path}.lookupCard`, '请补一起查书时显示的知识卡'));
    if (!item.probeLine || !/[?？]$/.test(item.probeLine)) {
      issues.push(issue('probe-line', `${path}.probeLine`, '小白追问须以问号收尾'));
    }
    if (!Array.isArray(item.sourceChunkIds) || item.sourceChunkIds.length === 0) {
      issues.push(issue('source-missing', `${path}.sourceChunkIds`, '该要点尚未找到课件出处'));
    }
    if (sourceCorpus && item.terms.some((term) => !sourceCorpus.toLowerCase().includes(term.toLowerCase()))) {
      issues.push(issue('term-not-in-source', `${path}.terms`, '部分术语未在课件原文出现，发布前请删除或改写'));
    }
  }

  if (!Array.isArray(topic?.misconceptions) || topic.misconceptions.length < 2 || topic.misconceptions.length > 5) {
    issues.push(issue('misconception-count', 'misconceptions', '误区须为 2–5 条'));
  }
  const misconceptionItems = topic?.misconceptions ?? [];
  const misconceptionIds = new Set(misconceptionItems.map((item) => item.mcId).filter(Boolean));
  const seenMisconceptionIds = new Set();
  for (const [index, item] of misconceptionItems.entries()) {
    const path = `misconceptions.${index}`;
    if (!item.mcId || seenMisconceptionIds.has(item.mcId)) issues.push(issue('misconception-id', `${path}.mcId`, '误区编号必须非空且不重复'));
    seenMisconceptionIds.add(item.mcId);
    if (!item.belief) issues.push(issue('belief-required', `${path}.belief`, '错误认知描述不能为空'));
    if (!item.triggerLine || !/[?？]$/.test(item.triggerLine)) {
      issues.push(issue('trigger-question', `${path}.triggerLine`, '误区注入台词必须是学生口吻问句'));
    }
    if (!item.injectAfterChecklist.length || item.injectAfterChecklist.some((id) => !ids.has(id))) {
      issues.push(issue('inject-target', `${path}.injectAfterChecklist`, '误区必须挂在已有讲解要点之后'));
    }
    if (!item.correctionCriteria.length || !item.correctionKeywords.length || !item.adoptionKeywords.length) {
      issues.push(issue('misconception-evidence', path, '误区需补齐纠正标准、纠正词与认同词'));
    }
    if (!item.probe?.statement || !item.probe?.explanation) {
      issues.push(issue('misconception-probe', `${path}.probe`, '摸底判断题须有题干与课件解释'));
    }
    if (!item.remedy?.microLesson?.title || !item.remedy?.microLesson?.body || !item.remedy?.microLesson?.askBack) {
      issues.push(issue('remedy-incomplete', `${path}.remedy.microLesson`, '补学小笺须有标题、正文与回问'));
    }
    validateQuizItems(
      item.remedy?.predictionQuiz,
      `${path}.remedy.predictionQuiz`,
      ids,
      misconceptionIds,
      issues,
      { exact: 3 },
    );
  }

  validateQuizItems(topic?.quizBank, 'quizBank', ids, misconceptionIds, issues, { minimum: 3 });
  if (!topic?.prep?.microLecture?.body || !topic?.prep?.taskCard || topic?.prep?.selfCheck?.length < 3) {
    issues.push(issue('prep-incomplete', 'prep', '备课包需包含微课、任务卡与至少 3 条自检'));
  }
  if (!topic?.transferHint) issues.push(issue('transfer-hint', 'transferHint', '请补一个迁移场景'));
  return issues;
}

export function hasBlockingIssues(issues) {
  return issues.some((item) => item?.level === 'error');
}

export function studentTopicView(topic) {
  const copy = structuredClone(topic);
  for (const item of copy.checklist ?? []) {
    delete item.groundTruth;
    delete item.sourceChunkIds;
    delete item.sourceExcerpt;
  }
  for (const item of copy.misconceptions ?? []) {
    delete item.correctionCriteria;
    if (item.probe) delete item.probe.explanation;
  }
  delete copy.sources;
  delete copy.compileMeta;
  return copy;
}

export function teacherEditableDraft(topic) {
  const copy = structuredClone(topic);
  if (copy.compileMeta) copy.compileMeta.teacherEdited = true;
  return copy;
}
