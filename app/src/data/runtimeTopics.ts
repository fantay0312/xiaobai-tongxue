import type { ChecklistItem, Topic } from '../types';

const runtimeTopics = new Map<string, Topic>();

function nonEmpty(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function stringArray(value: unknown, maximum = 20): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 2_000)).slice(0, maximum)
    : [];
}

function groups(value: unknown): string[][] {
  return Array.isArray(value)
    ? value.map((item) => stringArray(item, 8)).filter((item) => item.length > 0).slice(0, 8)
    : [];
}

/** 学生接口刻意不返回 groundTruth / correctionCriteria / probe.explanation。
 *  客户端只补 Topic 冻结类型所需的空位；规则评估仍使用服务端下发的关键词契约。 */
export function hydrateRuntimeTopic(value: unknown): Topic | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const topicId = nonEmpty(raw.topicId, 160);
  const title = nonEmpty(raw.title, 160);
  const course = nonEmpty(raw.course, 120);
  if (!/^custom-[a-z0-9-]+$/i.test(topicId) || !title || !course) return null;
  const checklistRaw = Array.isArray(raw.checklist) ? raw.checklist.slice(0, 7) : [];
  if (checklistRaw.length < 3) return null;
  const checklist = checklistRaw.map((value, index) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const point = nonEmpty(item.point, 160);
    const level: ChecklistItem['level'] = item.level === 'L1' || item.level === 'L2' || item.level === 'L3' || item.level === 'L5'
      ? item.level
      : index === 0 ? 'L1' : 'L5';
    return {
      id: nonEmpty(item.id, 40) || `c${index + 1}`,
      point,
      // 只用要点名占冻结接口空位，不还原服务端评估依据。
      groundTruth: point,
      keywords: groups(item.keywords),
      terms: stringArray(item.terms),
      level,
      lookupCard: nonEmpty(item.lookupCard, 2_000),
      probeLine: nonEmpty(item.probeLine, 500),
    };
  });
  const checklistIds = new Set(checklist.map((item) => item.id));
  const misconceptions = (Array.isArray(raw.misconceptions) ? raw.misconceptions : [])
    .slice(0, 5)
    .map((value, index) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const probe = item.probe && typeof item.probe === 'object' ? item.probe as Record<string, unknown> : {};
      const remedy = item.remedy && typeof item.remedy === 'object' ? item.remedy as Record<string, unknown> : {};
      const micro = remedy.microLesson && typeof remedy.microLesson === 'object'
        ? remedy.microLesson as Record<string, unknown> : {};
      return {
        mcId: nonEmpty(item.mcId, 100) || `${topicId}_M${index + 1}`,
        topicId,
        belief: nonEmpty(item.belief, 800),
        triggerLine: nonEmpty(item.triggerLine, 600),
        correctionCriteria: [],
        correctionKeywords: groups(item.correctionKeywords),
        adoptionKeywords: groups(item.adoptionKeywords),
        injectAfterChecklist: stringArray(item.injectAfterChecklist, 8).filter((id) => checklistIds.has(id)),
        probe: {
          statement: nonEmpty(probe.statement, 600),
          isTrue: false as const,
          explanation: '',
        },
        remedy: {
          microLesson: {
            title: nonEmpty(micro.title, 160),
            body: nonEmpty(micro.body, 5_000),
            askBack: nonEmpty(micro.askBack, 500),
          },
          predictionQuiz: Array.isArray(remedy.predictionQuiz) ? remedy.predictionQuiz as Topic['quizBank'] : [],
        },
      };
    });
  const prep = raw.prep && typeof raw.prep === 'object' ? raw.prep as Record<string, unknown> : {};
  const microLecture = prep.microLecture && typeof prep.microLecture === 'object'
    ? prep.microLecture as Record<string, unknown> : {};
  return {
    topicId,
    title,
    course,
    tagline: nonEmpty(raw.tagline, 240),
    checklist,
    misconceptions,
    quizBank: Array.isArray(raw.quizBank) ? raw.quizBank.slice(0, 8) as Topic['quizBank'] : [],
    prep: {
      microLecture: {
        title: nonEmpty(microLecture.title, 160),
        body: nonEmpty(microLecture.body, 8_000),
      },
      examples: Array.isArray(prep.examples) ? prep.examples.slice(0, 5) as Topic['prep']['examples'] : [],
      selfCheck: stringArray(prep.selfCheck, 10),
      taskCard: nonEmpty(prep.taskCard, 1_000),
    },
    transferHint: nonEmpty(raw.transferHint, 240),
  };
}

export function registerRuntimeTopics(topics: Topic[]): void {
  runtimeTopics.clear();
  for (const topic of topics) runtimeTopics.set(topic.topicId, topic);
}

export function runtimeTopic(topicId: string): Topic | undefined {
  return runtimeTopics.get(topicId);
}

export function runtimeTopicList(): Topic[] {
  return [...runtimeTopics.values()];
}
