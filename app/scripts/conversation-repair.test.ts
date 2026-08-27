import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTopic, TOPICS } from '../src/data';
import {
  evaluate, initialTopicState, mockQuestionClarificationReply, questionClarificationSource,
  recentXiaobaiQuestionText, repeatsQuestionVerbatim, speakQuestionClarification,
} from '../src/engine';
import type { ChatMessage, LlmSettings, Persona, XiaobaiGlobal } from '../src/types';

const MOCK: LlmSettings = {
  mode: 'mock', baseUrl: '', apiKey: '', model: '', temperature: 0.8,
};
const topic = getTopic('shallow-copy');
assert.ok(topic, '浅拷贝主题必须存在');
const state = initialTopicState(topic);
const probe = topic.checklist[0]?.probeLine;
assert.ok(probe, '浅拷贝首个追问必须存在');
const opening = `老师好!今天来学浅拷贝。\n等等等等,${probe}`;

const positiveRequests = [
  '我没明白你说的什么意思',
  '我没听懂你刚才的问题，能换个说法吗？',
  '你这句话有点绕，问具体一点',
  '什么意思？',
  '再说一遍',
  '你问啥？',
  '你能换一个更简单的说法解释一下你刚才的问题吗？我真的没有听懂。',
  '你的意思是问等号会不会复制吗？',
];

for (const utterance of positiveRequests) {
  const source = questionClarificationSource(utterance, opening);
  assert.equal(source, probe, `必须识别老师是在请小白重述上一问：${utterance}`);
}

for (const utterance of [
  '这个知识点我不会讲',
  '我不知道怎么回答你这个问题',
  '你问的这个我不知道答案',
  '你没听懂我说的什么意思吗？',
  '我换个说法给你讲',
  '你能再解释一下浅拷贝是什么吗？',
]) {
  assert.equal(
    questionClarificationSource(utterance, opening),
    null,
    `方向相反或真正不会讲时不得误判为请小白重述：${utterance}`,
  );
}

const teachingAfterClarification = '我没明白你说的意思，不过赋值不会产生新对象，只是两个名字指向同一个对象。';
const teachingSource = questionClarificationSource(teachingAfterClarification, opening);
assert.equal(teachingSource, probe, '显式要求重述时整轮按元对话处理，讲解留到下一轮');

const misconception = topic.misconceptions.find((item) => item.mcId === 'shallow_copy_M1');
assert.ok(misconception, '浅拷贝 M1 必须存在');
const quotedMisconception = '我没听懂你说的「不会变」是什么意思';
const misconceptionSource = questionClarificationSource(
  quotedMisconception, misconception.triggerLine,
);
assert.ok(misconceptionSource, '引用误区措辞追问含义时必须识别为澄清请求');
const misconceptionEvaluation = await evaluate({
  utterance: quotedMisconception,
  lastXiaobaiText: misconception.triggerLine,
  topic,
  state,
  pendingMcId: misconception.mcId,
  settings: MOCK,
});
assert.equal(misconceptionEvaluation.mcEvent?.result, 'adopted', '夹具必须撞中旧 adoption 误判');
assert.ok(misconceptionSource, '澄清候选必须在评估器 adoption 子串误判之前截住');
const quotedCorrection = '我没听懂你说的「还是同一个」是什么意思';
const correctionSource = questionClarificationSource(
  quotedCorrection, misconception.triggerLine,
);
assert.ok(correctionSource, '引用纠正关键词追问含义时必须识别为澄清请求');
const correctionEvaluation = await evaluate({
  utterance: quotedCorrection,
  lastXiaobaiText: misconception.triggerLine,
  topic,
  state,
  pendingMcId: misconception.mcId,
  settings: MOCK,
});
assert.equal(correctionEvaluation.mcEvent?.result, 'corrected', '夹具必须撞中旧 corrected 误判');
assert.ok(correctionSource, '澄清候选必须在评估器 corrected 子串误判之前截住');

for (const utterance of ['我没懂你在问什么', '我不懂你想问啥']) {
  assert.equal(
    questionClarificationSource(utterance, opening),
    probe,
    `常见“懂/在问/想问”措辞必须识别：${utterance}`,
  );
}

const recentMessages: ChatMessage[] = [
  { id: 'x1', role: 'xiaobai', text: opening, t: new Date(0).toISOString() },
  { id: 't1', role: 'teacher', text: positiveRequests[0], t: new Date(1).toISOString() },
];
assert.equal(
  recentXiaobaiQuestionText([
    { id: 't-prev', role: 'teacher', text: '上一轮讲解', t: new Date(0).toISOString() },
    { id: 'x-question', role: 'xiaobai', text: opening, t: new Date(1).toISOString() },
    { id: 'x-cue', role: 'xiaobai', text: '老师,可以送我去考场试试啦!', t: new Date(2).toISOString() },
  ]),
  opening,
  '同轮送考提示不得遮住紧邻的真实问题',
);
assert.equal(
  recentXiaobaiQuestionText([
    { id: 'x-old', role: 'xiaobai', text: probe, t: new Date(0).toISOString() },
    { id: 't-old', role: 'teacher', text: '我先回答上一问', t: new Date(1).toISOString() },
    { id: 'x-latest', role: 'xiaobai', text: '哦,原来如此。', t: new Date(2).toISOString() },
  ]),
  null,
  '不得跨过上一轮老师发言翻回旧问题',
);
assert.equal(
  repeatsQuestionVerbatim(`哇,听起来好厉害,但是……${probe}`, probe),
  true,
  'API 或模板若完整复读上一问，出口必须识别并拒绝',
);
for (const persona of ['好奇型', '严谨型', '杠精型'] as Persona[]) {
  const global: XiaobaiGlobal = {
    persona, learningLevel: 1, relationshipMemory: [], goldenAnalogies: [],
    topicsMastered: 0, bestRecord: null,
  };
  const reply = await speakQuestionClarification({
    questionSource: probe,
    topic,
    state,
    global,
    recentMessages,
    settings: MOCK,
    seed: 1,
  });
  assert.equal(reply.leakageRetries, 0, `${persona}重述不得触发知识泄漏兜底`);
  assert.doesNotMatch(reply.text, /听起来好厉害/, `${persona}不得继续套用赞叹前缀`);
  assert.equal(reply.text.includes(probe), false, `${persona}不得逐字复读完整原问题`);
  assert.match(reply.text, /问绕|不够清楚/, `${persona}必须先承认自己没问清楚`);
  assert.match(reply.text, /多出了一份新的东西.+原来那份东西有了两个名字/,
    `${persona}必须把截图里的问题真正换成两种待判断的可能`);
}

let corpusCases = 0;
for (const candidate of TOPICS.filter((item) => !item.locked)) {
  for (let index = 0; index < candidate.checklist.length; index += 1) {
    const question = candidate.checklist[index].probeLine;
    const candidateState = {
      ...initialTopicState(candidate),
      hitChecklist: candidate.checklist.slice(0, index).map((item) => item.id),
    };
    for (const persona of ['好奇型', '严谨型', '杠精型'] as Persona[]) {
      const global: XiaobaiGlobal = {
        persona, learningLevel: 1, relationshipMemory: [], goldenAnalogies: [],
        topicsMastered: 0, bestRecord: null,
      };
      const reply = await speakQuestionClarification({
        questionSource: question,
        topic: candidate,
        state: candidateState,
        global,
        recentMessages: [
          { id: 'x-all', role: 'xiaobai', text: question, t: new Date(0).toISOString() },
          { id: 't-all', role: 'teacher', text: '能换个说法吗？', t: new Date(1).toISOString() },
        ],
        settings: MOCK,
        seed: index,
      });
      assert.equal(reply.leakageRetries, 0,
        `${candidate.topicId}/${candidate.checklist[index].id}/${persona} 重述不得泄漏`);
      assert.equal(repeatsQuestionVerbatim(reply.text, question), false,
        `${candidate.topicId}/${candidate.checklist[index].id}/${persona} 不得原样复读`);
      assert.doesNotMatch(reply.text, /我先不照原话重复了/,
        `${candidate.topicId}/${candidate.checklist[index].id}/${persona} 不得退化成无问题内容的泛化台词`);
      corpusCases += 1;
    }
  }
}
assert.ok(corpusCases > 500, `全课程重述语料覆盖不足：${corpusCases}`);

for (const dynamicQuestion of ['为什么会这样？', '这到底咋回事？']) {
  const reply = mockQuestionClarificationReply(dynamicQuestion, '好奇型');
  assert.doesNotMatch(reply, /刚才举的情况/, '动态单句不得假装存在并未出现的举例');
  assert.equal(repeatsQuestionVerbatim(reply, dynamicQuestion), false,
    `动态单句也必须真正换说法：${dynamicQuestion}`);
  assert.match(reply, /为什么会发生|先看「/, `动态单句必须保留具体问题内容：${dynamicQuestion}`);
}

const storeSource = readFileSync(
  fileURLToPath(new URL('../src/store/appStore.ts', import.meta.url)),
  'utf8',
);
const evaluateAt = storeSource.indexOf('const privateEval = await evaluate');
const repairAt = storeSource.indexOf('if (clarificationSource)');
const decideAt = storeSource.indexOf('const decision = decide');
assert.ok(repairAt >= 0 && evaluateAt > repairAt && decideAt > evaluateAt,
  '澄清请求必须在评估器和导演推进任何状态前截住');
const repairBranch = storeSource.slice(repairAt, evaluateAt);
assert.match(repairBranch, /await speakQuestionClarification/, '会话修复必须走小白统一渲染与泄漏守门');
assert.match(repairBranch, /return \{ accepted: true \};/, '完成重述后必须提前结束本轮编排');
assert.doesNotMatch(repairBranch, /appendEvents|traces:/, '澄清元对话不得写教学事件或推进课堂 trace');
assert.match(repairBranch, /stuckStreak: 0/, '澄清元对话必须打断连续卡壳计数');
assert.doesNotMatch(repairBranch, /rescueLevel:/, '澄清元对话不得升级救援级别');

console.log('conversation repair: all assertions passed');
