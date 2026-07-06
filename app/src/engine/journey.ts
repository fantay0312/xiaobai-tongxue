/**
 * 旅程引导引擎 —— 门厅只指一条路。
 * 从事件流与派生状态推「当下最该做的一步」,优先级即教学闭环的断点顺序:
 * 从未开课 → 有被带偏(先补学,补完重讲) → 小白忘了 → 备好未出师 → 有新课未动 → 全出师。
 * line 是叙事句(小白/师徒视角),to 是真实路由 —— 引导永远指向能立刻做的事。
 * 铁律:纯函数、Node 安全,不得 re-export 进 engine/index barrel(simulate 在 Node 加载 barrel)。
 */
import type { LearnEvent, SessionReport, Topic, TopicState } from '../types';

export interface JourneyStep {
  key: string;
  title: string;   // 2 字步骤名,楷体印于带上
  line: string;    // 叙事一句话
  to: string;      // 路由
  cta: string;     // 按钮文案
}

export interface JourneyInput {
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  topics: Topic[];
}

/** 未动过的主题:没有任何真实痕迹(备课/命中/掌握度)才算"新" */
function untouched(st: TopicState | undefined): boolean {
  return !st || (
    !st.prepDone && st.hitChecklist.length === 0
    && st.knowledgeState === '没懂' && st.mastery === 0
  );
}

export function nextStep(input: JourneyInput): JourneyStep {
  const { events, reports, topicStates, topics } = input;
  const open = topics.filter((t) => !t.locked);

  // 1. 白纸一张:先去备第一门课
  if (events.length === 0) {
    const first = open[0];
    return {
      key: 'first-prep', title: '开馆',
      line: '小白搬好了小板凳,眼巴巴等着你的第一堂课。',
      to: first ? `/prep/${first.topicId}` : '/study',
      cta: '去备第一课',
    };
  }

  // 2. 有被带偏的误区:未补学 → 去复盘补学;已补学 → 回讲解舱重讲验证
  for (const topic of open) {
    const st = topicStates[topic.topicId];
    if (!st) continue;
    const strayed = Object.entries(st.mcStates)
      .filter(([, s]) => s === '被带偏')
      .map(([mcId]) => mcId);
    if (strayed.length === 0) continue;

    // 该误区最近一次被带偏之后,是否已走完补学微路径(数事件,不猜快照)
    const needsRemedy = strayed.some((mcId) => {
      let lastAdopt = -1;
      let lastRemedy = -1;
      events.forEach((e, i) => {
        if (e.topicId !== topic.topicId || String(e.payload.mcId ?? '') !== mcId) return;
        if (e.type === 'misconception_adopted') lastAdopt = i;
        if (e.type === 'remedy_completed') lastRemedy = i;
      });
      return lastAdopt >= 0 && lastRemedy < lastAdopt;
    });
    // 反查该主题最近一次复盘报告,补学入口在复盘页
    const report = [...reports].reverse().find((r) => r.topicId === topic.topicId);

    if (needsRemedy && report) {
      return {
        key: 'remedy', title: '补讲',
        line: `「${topic.title}」里有个地方小白还没懂——回复盘看看是哪儿讲拧了。`,
        to: `/review/${report.sessionId}`,
        cta: '去复盘补学',
      };
    }
    return {
      key: 'reteach', title: '重讲',
      line: needsRemedy
        ? `「${topic.title}」里小白记岔了一处,回讲解舱把它重新讲顺。`
        : `补学已毕,小白还等着你把「${topic.title}」那道坎重新讲顺。`,
      to: `/teach/${topic.topicId}`,
      cta: '回讲解舱重讲',
    };
  }

  // 3. 小白忘了:按遗忘曲线到期的课,先帮他想起来
  const forgot = open.find((t) => topicStates[t.topicId]?.forgotten);
  if (forgot) {
    return {
      key: 'review-due', title: '温书',
      line: `小白挠挠头:「老师,『${forgot.title}』那一课……我好像有点忘了。」`,
      to: '/growth',
      cta: '去帮他复习',
    };
  }

  // 4. 有进度未出师的课:该开讲了
  const ready = open.find((t) => {
    const st = topicStates[t.topicId];
    return !!st && st.knowledgeState !== '出师' && (st.prepDone || st.hitChecklist.length > 0);
  });
  if (ready) {
    const started = (topicStates[ready.topicId]?.hitChecklist.length ?? 0) > 0;
    return {
      key: 'teach', title: '开讲',
      line: started
        ? `「${ready.title}」讲了一半,小白还坐在原位等下文。`
        : `「${ready.title}」的课备好了,小白已在讲解舱里坐得笔直。`,
      to: `/teach/${ready.topicId}`,
      cta: '该开讲了',
    };
  }

  // 5. 书架上还有没翻开的课:开新课
  const fresh = open.find((t) => untouched(topicStates[t.topicId]));
  if (fresh) {
    return {
      key: 'new-prep', title: '新课',
      line: `书架上「${fresh.title}」还没翻开,小白最近正好好奇这个。`,
      to: `/prep/${fresh.topicId}`,
      cta: '开一门新课',
    };
  }

  // 6. 全部开放主题出师:去印章墙受贺
  const allMastered = open.length > 0
    && open.every((t) => topicStates[t.topicId]?.knowledgeState === '出师');
  if (allMastered) {
    return {
      key: 'all-mastered', title: '满谱',
      line: '满架的书都讲透了——小白逢人便说,这些全是老师教的。',
      to: '/growth',
      cta: '去看印章墙',
    };
  }

  // 兜底(理论上到不了):去成长册看看近况再定下一课
  return {
    key: 'browse', title: '巡斋',
    line: '去成长册翻翻小白的近况,再定下一课讲什么。',
    to: '/growth',
    cta: '看看小白',
  };
}
