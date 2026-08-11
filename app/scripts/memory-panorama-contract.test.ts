import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/data';
import { STAR_LINKS } from '../src/data/starLinks';
import { initialTopicState } from '../src/engine/memory';
import { deriveMemoryPanorama } from '../src/engine/recall';
import type { LearnEvent, TopicState, XiaobaiGlobal } from '../src/types';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const component = read('../src/components/story/MemoryPanorama.tsx');
const layerCss = read('../src/components/story/memory.module.css');
const registryCss = read('../src/components/story/memoryRegistry.module.css');
const detailCss = read('../src/components/story/memoryDetails.module.css');
const recall = read('../src/engine/recall.ts');
const growth = read('../src/pages/growth/index.tsx');

const ruleFor = (css: string, className: string): string => {
  const match = css.replace(/\/\*[\s\S]*?\*\//g, '').match(
    new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `缺少 .${className} 样式规则`);
  return match[1];
};

assert.match(growth, /id="memory"[\s\S]*?aria-labelledby="memory-title"/, '卷五 section 必须由标题命名');
assert.match(growth, /<h2[^>]*id="memory-title"/, '卷五标题必须暴露 memory-title');
assert.match(component, /<ol className=\{s\.layers\}>/, '四层记忆必须使用有序账页');
assert.match(component, /<article[\s\S]*?aria-labelledby=\{titleId\}/, '每层 article 必须由 h3 命名');
assert.match(component, /<dl className=\{s\.statLedger\}>/, '记忆统计必须使用描述列表');
assert.match(component, /role="progressbar"/, '保持度必须暴露 progressbar 语义');
assert.match(component, /<details className=\{d\.moreDetails\}>/, '长记录必须渐进展开');
assert.match(component, /scrollIntoView/, '本页跳转必须保留 HashRouter 安全滚动');
assert.match(component, /focus\(\{ preventScroll: true \}\)/, '本页跳转后必须把焦点交给目标标题');
assert.match(component, /layer\.empty \? meta\.emptyLabel : meta\.filledLabel/, '空态必须使用显式派生字段');
assert.match(component, /layer\.empty && layer\.key !== 'working'/, '全空状态必须只保留一个下一步');

assert.doesNotMatch(layerCss, /box-shadow/, '四层账页不得各自堆叠阴影');
assert.doesNotMatch(layerCss, /nth-child/, '四层样式不得依赖脆弱的节点序号');
assert.match(ruleFor(layerCss, 'layerName'), /font-family:\s*var\(--font-serif\)/, '层名必须走衬线题头');
assert.match(ruleFor(layerCss, 'anchorLink'), /min-height:\s*2\.75rem/, '行动热区必须至少 44px');
assert.match(registryCss, /container:\s*memory-panorama\s*\/\s*inline-size/, '组件必须建立容器查询上下文');
assert.match(layerCss, /@container memory-panorama \(min-width: 40rem\)/, '账页必须有内容驱动断点');
assert.match(detailCss, /@container memory-panorama \(min-width: 56rem\)/, '长记录必须自适应容器');
assert.match(detailCss, /\.supplement:only-child\s*\{\s*grid-column:\s*1\s*\/\s*-1/, '单组补充记录必须占满整行');
assert.match(recall, /empty:\s*boolean/, '记忆层必须显式派生空态，不解析展示字符串');

const global: XiaobaiGlobal = {
  persona: '好奇型',
  learningLevel: 1,
  relationshipMemory: [],
  goldenAnalogies: [],
  topicsMastered: 0,
  bestRecord: null,
};

const derive = (overrides: {
  events?: LearnEvent[];
  topicStates?: Record<string, TopicState>;
  global?: XiaobaiGlobal;
} = {}) => deriveMemoryPanorama({
  events: overrides.events ?? [],
  reports: [],
  topicStates: overrides.topicStates ?? {},
  topics: TOPICS,
  global: overrides.global ?? global,
  live: null,
});

const emptyLayers = derive();
assert.deepEqual(
  emptyLayers.map((layer) => layer.key),
  ['working', 'episodic', 'semantic', 'bond'],
  '空档也必须保持四层顺序',
);
assert.ok(emptyLayers.every((layer) => layer.empty), '全新用户的四层必须明确标为空态');
assert.equal(
  emptyLayers.flatMap((layer) => layer.stats).some((stat) => /(^|\D)0(?:\D|$)/.test(stat.value)),
  false,
  '全新用户不得出现无意义的 0 值统计',
);

const masteredTopic = TOPICS.find((topic) => !topic.locked);
assert.ok(masteredTopic, '测试夹具需要至少一门开放课程');
const masteredState: TopicState = {
  ...initialTopicState(masteredTopic),
  knowledgeState: '出师',
  lastVerified: '2026-08-12T00:00:00.000Z',
  reviewDue: '2026-08-19T00:00:00.000Z',
  mastery: 1,
};
const masteredSemantic = derive({
  topicStates: { [masteredTopic.topicId]: masteredState },
}).find((layer) => layer.key === 'semantic');
assert.ok(masteredSemantic && !masteredSemantic.empty, '仅有出师状态时学问层也必须是非空态');
assert.ok(masteredSemantic.stats.some((stat) => stat.value === '1 门'), '出师数量必须进入统计');
assert.equal(masteredSemantic.retentions?.length, 1, '出师课程必须生成一条保持度记录');
assert.ok(
  masteredSemantic.lines.every((line) => !line.includes('还空着')),
  '已有出师记录时不得同时声称学问层为空',
);

const retentionTopics = TOPICS.filter((topic) => !topic.locked).slice(0, 4);
assert.equal(retentionTopics.length, 4, '测试夹具需要四门开放课程');
const dueOffsets: Array<number | null> = [8, -5, null, 2];
const retentionStates = Object.fromEntries(retentionTopics.map((topic, index) => {
  const dueOffset = dueOffsets[index];
  const state: TopicState = {
    ...initialTopicState(topic),
    knowledgeState: '出师',
    lastVerified: new Date().toISOString(),
    reviewDue: dueOffset == null
      ? null
      : new Date(Date.now() + dueOffset * 86_400_000).toISOString(),
  };
  return [topic.topicId, state];
}));
const orderedRetentions = derive({ topicStates: retentionStates })
  .find((layer) => layer.key === 'semantic')?.retentions ?? [];
assert.deepEqual(
  orderedRetentions.map((item) => item.title),
  [retentionTopics[1].title, retentionTopics[3].title, retentionTopics[0].title, retentionTopics[2].title],
  '保持度记录必须按已起雾、临期、无期限的紧要次序排列',
);

const linkedPair = STAR_LINKS.find(({ a, b }) =>
  TOPICS.some((topic) => topic.topicId === a && !topic.locked)
  && TOPICS.some((topic) => topic.topicId === b && !topic.locked));
assert.ok(linkedPair, '测试夹具需要至少一组开放课程星链');
const linkEvent = (topicId: string, order: number): LearnEvent => ({
  id: `memory-link-${order}`,
  t: `2026-08-12T00:00:0${order}.000Z`,
  type: 'checklist_hit',
  topicId,
  sessionId: null,
  payload: { checklistId: `fixture-${order}` },
  evidence: '记忆登记册契约夹具',
});
const linkedSemantic = derive({
  events: [linkEvent(linkedPair.a, 1), linkEvent(linkedPair.b, 2)],
}).find((layer) => layer.key === 'semantic');
assert.ok(linkedSemantic && !linkedSemantic.empty, '仅有跨课联结时学问层也必须是非空态');
assert.ok(linkedSemantic.crossLinks?.length, '两端都学过的课程必须生成跨课线');
assert.ok(
  linkedSemantic.lines.every((line) => !line.includes('还空着')),
  '已有跨课线时不得同时声称学问层为空',
);

const rememberedBond = derive({
  global: {
    ...global,
    goldenAnalogies: [{
      id: 'golden-fixture',
      topicId: masteredTopic.topicId,
      text: '把知识比作一盏慢慢点亮的灯',
      t: '2026-08-12T00:00:00.000Z',
    }],
  },
}).find((layer) => layer.key === 'bond');
assert.ok(rememberedBond && !rememberedBond.empty, '清档后仍有全局金句时师徒层必须是非空态');
assert.ok(rememberedBond.stats.some((stat) => stat.value === '1 句'), '全局金句必须保留在统计中');
assert.ok(
  rememberedBond.lines.every((line) => !line.includes('刚认识不久')),
  '已有全局金句时不得同时声称刚认识',
);

for (const [name, source] of [
  ['MemoryPanorama.tsx', component],
  ['memory.module.css', layerCss],
  ['memoryRegistry.module.css', registryCss],
  ['memoryDetails.module.css', detailCss],
] as const) {
  assert.ok(source.split('\n').length <= 300, `${name} 不得超过 300 行`);
}

console.log('memory panorama contract: all assertions passed');
