/**
 * 真实 API 全链路实测(node 端,`npm run livetest`)。
 * 与 simulate.ts 的区别:这里走 mode='api'(DeepSeek),讲解话术故意使用
 * 与 checklist 关键词组【不咬合】的自由表述 —— 验证 LLM 语义评估在真实输入下的命中能力:
 *   要点语义命中 / 误区注入 / 纠正语义判定 / 卡壳救援 / 偏题围栏 / 泄漏出口守门。
 * 凭据从 app/.env.local 读取(VITE_LLM_*);缺 key 时以退出码 2 提示。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/data';
import {
  applyEvent, decide, evaluate, extractTeacherTerms, initialTopicState,
  isValidAction, matchKeywordGroups, speakXiaobai, FALLBACK_LINE,
} from '../src/engine';
import type {
  ChatMessage, EvalResult, LearnEvent, LlmSettings, Topic, TopicState, XiaobaiGlobal,
} from '../src/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 凭据加载 ─────────────────────────

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(path.resolve(HERE, '../.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 文件不存在时走 process.env */ }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const API_KEY = (env.VITE_LLM_API_KEY ?? '').trim();
if (!API_KEY) {
  console.error('缺少 VITE_LLM_API_KEY(app/.env.local),无法真实实测。');
  process.exit(2);
}
const SETTINGS: LlmSettings = {
  mode: 'api',
  baseUrl: (env.VITE_LLM_BASE_URL ?? '').trim() || 'https://api.deepseek.com',
  apiKey: API_KEY,
  model: (env.VITE_LLM_MODEL ?? '').trim() || 'deepseek-v4-flash',
  temperature: 0.9,
};

// ───────────────────────── 断言收集 ─────────────────────────

let failures = 0;
const warns: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}
function warn(msg: string): void {
  warns.push(msg);
  console.log(`  ⚠ ${msg}`);
}

// ───────────────────────── 会话仿真器(镜像 appStore.submitTeaching)─────────────────────────

interface Sim {
  topic: Topic;
  global: XiaobaiGlobal;
  state: TopicState;
  pendingMcId: string | null;
  messages: ChatMessage[];
  turn: number;
}

let uidSeq = 0;
const uid = () => `live-${++uidSeq}`;
const now = () => new Date().toISOString();

interface TurnOut {
  action: string;
  evalResult: EvalResult;
  xiaobaiText: string;
  leakageRetries: number;
  leaked: string[];
  pendingMcAfter: string | null;
  ms: number;
}

async function teachTurn(sim: Sim, text: string): Promise<TurnOut> {
  const { topic } = sim;
  const t0 = Date.now();
  const lastXiaobaiText = [...sim.messages].reverse()
    .find((message) => message.role === 'xiaobai')?.text ?? null;
  const evalResult = await evaluate({
    utterance: text, lastXiaobaiText, topic, state: sim.state,
    pendingMcId: sim.pendingMcId, settings: SETTINGS,
  });
  const decision = decide({
    evalResult, topic, state: sim.state, global: sim.global, mode: 'teach',
    pendingMcId: sim.pendingMcId, turn: sim.turn, utterance: text,
  });
  if (!isValidAction(decision.action)) throw new Error(`非法动作:${decision.action}`);

  let st = sim.state;
  for (const d of decision.events) {
    const ev: LearnEvent = { ...d, id: uid(), t: now(), sessionId: 'live' };
    st = applyEvent(st, ev);
  }
  st = { ...st, ...decision.stateDelta, mcStates: { ...st.mcStates, ...(decision.stateDelta.mcStates ?? {}) } };
  sim.state = st;

  const teacherMsg: ChatMessage = { id: uid(), role: 'teacher', text, t: now() };
  const card = {
    ...decision.card,
    recentTeacherTerms: extractTeacherTerms([...sim.messages, teacherMsg], topic),
  };
  const speak = await speakXiaobai({
    card, topic, state: sim.state, recentMessages: [...sim.messages, teacherMsg],
    settings: SETTINGS, seed: sim.turn + 1,
  });
  const ms = Date.now() - t0;

  sim.messages.push(teacherMsg, { id: uid(), role: 'xiaobai', text: speak.text, t: now() });
  sim.pendingMcId = decision.pendingMcAfter;
  sim.turn += 1;

  console.log(`\n  [轮${sim.turn}] 老师:${text}`);
  console.log(`   评估:命中[${evalResult.checklistHits.join(',') || '—'}]`
    + ` 卡壳=${evalResult.stuckSignal ? '是' : '否'} 偏题=${evalResult.offTopic ? '是' : '否'}`
    + ` 误区=${evalResult.mcEvent ? `${evalResult.mcEvent.mcId}:${evalResult.mcEvent.result}` : '—'}`
    + ` 金句=${evalResult.goldenAnalogy ? '是' : '否'}`);
  console.log(`   依据:${evalResult.reasoning}`);
  console.log(`   导演:${decision.action}`);
  console.log(`   小白:${speak.text}`);
  console.log(`   (mood=${speak.mood} 泄漏重试=${speak.leakageRetries} 本轮耗时=${(ms / 1000).toFixed(1)}s)`);

  return {
    action: decision.action, evalResult, xiaobaiText: speak.text,
    leakageRetries: speak.leakageRetries, leaked: speak.leaked,
    pendingMcAfter: decision.pendingMcAfter, ms,
  };
}

// ───────────────────────── 实测场景 ─────────────────────────

async function main(): Promise<void> {
  const topic = TOPICS.find((t) => t.topicId === 'shallow-copy');
  if (!topic) throw new Error('缺少 shallow-copy 知识点');

  console.log(`\n══ 真实 API 全链路实测:${topic.title} ══`);
  console.log(`   端点:${SETTINGS.baseUrl} · 模型:${SETTINGS.model}\n`);
  console.log('讲解话术全部使用与关键词组不咬合的自由表述,规则引擎单独打不中,');
  console.log('命中即证明 LLM 语义评估真实生效。');

  const sim: Sim = {
    topic,
    global: {
      persona: '好奇型', learningLevel: 1, relationshipMemory: [],
      goldenAnalogies: [], topicsMastered: 0, bestRecord: null,
    },
    state: initialTopicState(topic),
    pendingMcId: null, messages: [], turn: 0,
  };
  const c1 = topic.checklist.find((c) => c.id === 'c1');
  const m1 = topic.misconceptions.find((m) => m.mcId === 'shallow_copy_M1');
  if (!c1 || !m1) throw new Error('数据缺失:c1/M1');

  // 轮1:讲清"赋值 vs 拷贝",措辞避开 c1 所有关键词组
  const t1Text = 'b = a 这种写法其实一份新数据都没造出来,内存里就一个对象,两个名字都挂在它身上,动谁都是在动那个东西';
  check('轮1话术确实不咬合 c1 关键词组(规则单独打不中)', !matchKeywordGroups(t1Text, c1.keywords));
  const t1 = await teachTurn(sim, t1Text);
  check('轮1:语义评估命中 c1', t1.evalResult.checklistHits.includes('c1'),
    `实际命中:[${t1.evalResult.checklistHits.join(',')}]`);
  check('轮1:小白进入开窍复述', t1.action === 'express_understanding', `实际:${t1.action}`);

  // 轮2:讲浅拷贝只复制最外层(自由表述 + 生活类比),预期命中 c2 并触发 M1 注入
  const t2 = await teachTurn(sim,
    '用 copy 方法就不一样了,它重新造一个最外面的壳子,把原来壳里每一格的地址抄到新壳里,' +
    '里面装的东西本身一个都没重新造 —— 就好像把文件夹的目录页复印了一遍,里面的文件还是原来那几份');
  check('轮2:语义评估命中 c2', t2.evalResult.checklistHits.includes('c2'),
    `实际命中:[${t2.evalResult.checklistHits.join(',')}]`);
  check('轮2:触发误区 M1 注入', t2.pendingMcAfter === 'shallow_copy_M1' && t2.action === 'inject_misconception',
    `实际:action=${t2.action}, pending=${t2.pendingMcAfter}`);
  if (!t2.evalResult.goldenAnalogy) warn('轮2带明显类比但未收录金句(主观项,不计失败)');

  // 轮3:纠正 M1,措辞避开 correction/adoption 关键词组 → 只有语义判定能给出 corrected
  const t3Text =
    '不对哦,copy 完里面那个小列表两边共用的还是原来那份,你在新列表里动它,旧列表那边也看得到,并没有分成两份';
  check('轮3话术确实不咬合纠正关键词组(规则单独判不出 corrected)',
    !matchKeywordGroups(t3Text, m1.correctionKeywords) && !matchKeywordGroups(t3Text, m1.adoptionKeywords));
  const t3 = await teachTurn(sim, t3Text);
  check('轮3:语义判定纠正成功(corrected)',
    t3.evalResult.mcEvent?.mcId === 'shallow_copy_M1' && t3.evalResult.mcEvent.result === 'corrected',
    `实际:${t3.evalResult.mcEvent ? `${t3.evalResult.mcEvent.mcId}:${t3.evalResult.mcEvent.result}` : '无'}`);
  check('轮3后误区状态=已纠正', sim.state.mcStates['shallow_copy_M1'] === '已纠正',
    `实际:${sim.state.mcStates['shallow_copy_M1']}`);

  // 轮4:卡壳 → R1 递台阶
  const t4 = await teachTurn(sim, '呃……老师我讲不下去了,后面的我真想不起来了');
  check('轮4:卡壳信号 → R1 递台阶', t4.evalResult.stuckSignal && t4.action === 'rescue_hint',
    `实际:stuck=${t4.evalResult.stuckSignal}, action=${t4.action}`);

  // 轮5:偏题围栏。存在悬置误区时评估会记 mc:pending 而非 offTopic,
  // 但两条路径殊途同归:都必须走 stay_confused 把话题拉回,且绝不能推进任何状态
  const t5 = await teachTurn(sim, '对了老师,昨晚那场球赛你看了吗?最后那个绝杀真的太帅了');
  check('轮5:闲聊不推进任何状态(零命中/非卡壳)',
    t5.evalResult.checklistHits.length === 0 && !t5.evalResult.stuckSignal,
    `实际:命中[${t5.evalResult.checklistHits.join(',')}], stuck=${t5.evalResult.stuckSignal}`);
  check('轮5:围栏生效 → stay_confused 拉回话题', t5.action === 'stay_confused',
    `实际:action=${t5.action}, offTopic=${t5.evalResult.offTopic}, mc=${t5.evalResult.mcEvent?.result ?? '—'}`);

  // 全程出口守门
  const turns = [t1, t2, t3, t4, t5];
  check('全程小白台词零泄漏出口', turns.every((t) => t.leaked.length === 0),
    turns.map((t, i) => `轮${i + 1}:[${t.leaked.join(',')}]`).join(' '));
  for (const [i, t] of turns.entries()) {
    if (t.xiaobaiText === FALLBACK_LINE) warn(`轮${i + 1}台词落到兜底话术(泄漏重试耗尽),质量待观察`);
    if (t.leakageRetries > 0) warn(`轮${i + 1}泄漏重试 ${t.leakageRetries} 次`);
  }
  const total = turns.reduce((s, t) => s + t.ms, 0);
  const avg = total / turns.length;
  console.log(`\n  耗时:总 ${(total / 1000).toFixed(1)}s,单轮均值 ${(avg / 1000).toFixed(1)}s(评估+渲染两跳)`);
  if (avg > 15_000) warn('单轮均值超 15s,课堂体感偏慢,考虑换更快模型');

  console.log(`\n══ 实测结论 ══`);
  if (warns.length) console.log(`  软警告 ${warns.length} 条(不计失败)`);
  if (failures > 0) {
    console.error(`  ✗ ${failures} 项断言失败`);
    process.exit(1);
  }
  console.log('  ✓ 全部断言通过:语义评估/误区判定/救援/围栏/泄漏守门在真实 API 下均生效');
}

main().catch((e) => {
  console.error('实测异常终止:', e);
  process.exit(1);
});
