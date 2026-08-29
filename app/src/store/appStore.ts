/**
 * 全局状态编排 —— FROZEN(页面只消费此 store,不直接调 engine)
 * 单轮两跳:评估(发生了什么) → 导演(接下来做什么) → 小白(怎么说出来) → 出口守门
 * 持久化:事件流 / 全局 profile / 复盘报告 / 设置;TopicState 由事件流重放派生。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AsrSettings, ChatMessage, EvalResult, LearnEvent, LiveSession, LlmSettings, MemoryItem, MemoryState,
  Persona, SessionMode, SessionReport, Topic, TopicState, TurnTrace, XiaobaiGlobal,
} from '../types';
import { getAllTopics, getTopic, TOPICS } from '../data';
import { XIAOBAI_EXAM_READY_LINE } from '../data/xiaobaiLines';
import {
  applyEvents, buildReport, decide, DEFLECTION_LINE, evaluate, extractTeacherTerms,
  initialTopicState, isExtractionAttempt, openingCard, questionClarificationSource,
  recentXiaobaiQuestionText, replayTopicState, runXiaobaiQuiz,
  speakQuestionClarification, speakXiaobai,
} from '../engine';
import type { EventDraft } from '../engine';
// 跨会话回忆:直接从 recall 模块导入,不走 engine barrel(simulate 在 Node 加载 barrel,recall 不得混入)
import { recallGreetingLine } from '../engine/recall';
// 进化派生(升期):同为不进 barrel 的纯函数,按路径直连
import { deriveEvolution } from '../engine/evolution';
// 课堂小本本:每轮派生一次,同时喂给评估器(轮次/上一轮讲解)与小白提示(【这堂课到现在】);不进 barrel
import { deriveSessionBrief } from '../engine/sessionBrief';
// 语音转写默认配置:同为浏览器专用模块,不走 barrel
import { DEFAULT_ASR } from '../engine/asr';
// 学伴记忆:纯引擎按路径直连(不进 barrel);LLM 润色在独立 sidecar,只在非 mock 模式后台调用
import {
  EMPTY_MEMORY, composeLearnerProfile, explicitMemory, extractSessionMemories, memoryHintsForXiaobai,
  rebuildMemoryFromHistory, reconcileMemories, sanitizeMemoryState, scrubQuote,
} from '../engine/learnerMemory';
import type { MemoryDraft } from '../engine/learnerMemory';
import { synthesizeProfileWithLlm } from '../engine/learnerMemoryLlm';
import type { PreparedImageAttachment } from '../lib/imageAttachment';
import { describeTeachingImage } from '../lib/vision';
import { listPublishedCustomTopics } from '../lib/customContent';
import { hydrateRuntimeTopic, registerRuntimeTopics } from '../data/runtimeTopics';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
let customTopicsLoadSequence = 0;
const CUSTOM_TOPICS_RETRY_MS = [750, 1_500] as const;

/** 记忆引文里要剔除的用户资料(用户名等);由 sync 层注入 authStore 读数,appStore 不直接依赖 authStore */
let memoryPiiProvider: () => string[] = () => [];
export function setMemoryPiiProvider(provider: () => string[]): void {
  memoryPiiProvider = provider;
}
/** 课堂里「小白翻了翻小本子」的系统旁注前缀(mock 模式下记忆影响的可见证据,一场只出一次) */
const MEMORY_NOTE_PREFIX = '小白翻了翻小本子：';

/** 导出给 sync 拉档时兜底:远端 global 缺字段(或被手工改坏)不得让页面派生层崩掉 */
export const DEFAULT_GLOBAL: XiaobaiGlobal = {
  persona: '好奇型',
  learningLevel: 1,
  relationshipMemory: [],
  goldenAnalogies: [],
  topicsMastered: 0,
  bestRecord: null,
};

// 直连凭据只允许本地开发使用；生产构建始终走服务端代理，避免密钥进入浏览器产物。
const ENV_KEY = import.meta.env.DEV
  ? (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim() ?? ''
  : '';
const ENV_LLM_DEFAULT: LlmSettings | null = ENV_KEY
  ? {
      mode: 'api',
      baseUrl: ((import.meta.env.VITE_LLM_BASE_URL as string | undefined) ?? '').trim() || 'https://api.deepseek.com',
      apiKey: ENV_KEY,
      model: ((import.meta.env.VITE_LLM_MODEL as string | undefined) ?? '').trim() || 'deepseek-v4-flash',
      temperature: 0.8,
    }
  : null;

// 无注入凭据时默认 proxy(部署形态走服务器网关);本地无网关时 llmCall 快速失败,
// 引擎按既有纪律静默降级 mock —— 离线演示体验与从前一致
const DEFAULT_SETTINGS: LlmSettings = ENV_LLM_DEFAULT ?? {
  mode: 'proxy',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.8,
};

function stamp(drafts: EventDraft[], sessionId: string | null): LearnEvent[] {
  return drafts.map((d) => ({ ...d, id: uid(), t: now(), sessionId }));
}

function msg(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: uid(), role, text, t: now(), ...extra };
}

export interface SubmitTeachingResult {
  accepted: boolean;
  error?: string;
}

function privateImageUtterance(text: string, description: string): string {
  const observed = `[本轮图片观察，仅供当前评估与回应：${description}]`;
  return text ? `${text}\n${observed}` : observed;
}

function normalizedQuote(text: string): string {
  return text.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

/** 图片识别原文不进事件、trace 或金句，只保留教学判定结果。 */
function privateEvalToRecord(evalResult: EvalResult, visibleText: string): EvalResult {
  const golden = evalResult.goldenAnalogy;
  const visibleNorm = normalizedQuote(visibleText);
  const goldenNorm = golden ? normalizedQuote(golden) : '';
  return {
    ...evalResult,
    accuracyFlags: evalResult.accuracyFlags.map((flag) => ({
      checklistId: flag.checklistId,
      note: '图片辅助讲解中的表述需复核',
    })),
    goldenAnalogy: golden && goldenNorm.length >= 4 && visibleNorm.includes(goldenNorm) ? golden : null,
    reasoning: '结合本轮文字与图片完成评估（图片内容不入档）',
  };
}

export function revokeLiveImages(live: LiveSession | null): void {
  for (const message of live?.messages ?? []) {
    if (message.image) URL.revokeObjectURL(message.image.objectUrl);
  }
}

export interface AppState {
  global: XiaobaiGlobal;
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  live: LiveSession | null;
  settings: LlmSettings;
  /** 语音转文字配置(含密钥):只存本机,永不进服务器学习存档同步 */
  asrSettings: AsrSettings;
  customTopics: Topic[];
  customTopicsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** 学伴记忆:条目 + 画像 + 暂停开关;随账号同步,退出登录即清 */
  memory: MemoryState;

  topicState: (topicId: string) => TopicState;
  appendEvents: (drafts: EventDraft[], sessionId: string | null) => LearnEvent[];
  rebuildStates: () => void;
  loadCustomTopics: (force?: boolean) => Promise<void>;
  clearCustomTopics: () => void;

  startSession: (topicId: string, mode: SessionMode) => Promise<void>;
  submitTeaching: (text: string, image?: PreparedImageAttachment) => Promise<SubmitTeachingResult>;
  closeLookup: () => void;
  endSession: () => string | null;
  abandonSession: () => void;

  completePrep: (topicId: string, correctCount: number, total: number) => void;
  completeRemedy: (topicId: string, mcId: string) => void;
  startReview: (topicId: string) => Promise<void>;

  setPersona: (p: Persona) => void;
  setSettings: (s: Partial<LlmSettings>) => void;
  setAsrSettings: (s: Partial<AsrSettings>) => void;
  resetAll: () => void;

  /** 一堂课结束(或中途离开且讲过至少一轮):抽取 → 归并 → 合成画像;paused 时空操作 */
  memorizeSession: (input: {
    sessionId: string; topicId: string; messages: ChatMessage[]; traces: TurnTrace[]; report: SessionReport | null;
  }) => void;
  /** 边讲边记:金句一出即归并一条「爱打比方」习惯,不等下课 */
  memorizeGoldenAnalogy: (input: { topicId: string; eventId: string; quote: string }) => void;
  pinMemory: (id: string, pinned: boolean) => void;
  muteMemory: (id: string, muted: boolean) => void;
  editMemory: (id: string, text: string) => void;
  deleteMemory: (id: string) => void;
  addExplicitMemory: (text: string, scope: MemoryItem['scope']) => void;
  setMemoryPaused: (paused: boolean) => void;
  recomposeProfile: () => void;
  resetMemory: () => void;
}

/** 归并草稿并重合成画像(同步、确定性);非 mock 且条目 ≥6 时后台请 LLM 润色,画像没被别处改动才落地 */
function applyDrafts(
  get: () => AppState, set: (partial: Partial<AppState>) => void, drafts: MemoryDraft[], at: string,
): void {
  const memory = get().memory;
  const { items } = reconcileMemories(memory.items, drafts, at);
  const profile = composeLearnerProfile({ items, events: get().events, now: at });
  const next: MemoryState = { ...memory, items, profile };
  set({ memory: next });
  const settings = get().settings;
  if (settings.mode === 'mock' || items.length < 6) return;
  void synthesizeProfileWithLlm(next, settings).then((polished) => {
    if (!polished) return;
    const current = get().memory;
    if (current.profile?.updatedAt !== profile.updatedAt) return;
    set({ memory: { ...current, profile: { ...polished, updatedAt: now() } } });
  });
}

function touchItem(items: MemoryItem[], id: string, patch: (item: MemoryItem) => MemoryItem): MemoryItem[] {
  return items.map((item) => (item.id === id ? patch(item) : item));
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      global: DEFAULT_GLOBAL,
      events: [],
      reports: [],
      topicStates: {},
      live: null,
      settings: DEFAULT_SETTINGS,
      asrSettings: DEFAULT_ASR,
      customTopics: [],
      customTopicsStatus: 'idle',
      memory: EMPTY_MEMORY,

      topicState: (topicId) => {
        const cached = get().topicStates[topicId];
        if (cached) return cached;
        const topic = getTopic(topicId);
        return topic ? replayTopicState(topic, get().events) : initialTopicState(TOPICS[0]);
      },

      appendEvents: (drafts, sessionId) => {
        const stamped = stamp(drafts, sessionId);
        if (stamped.length === 0) return [];
        set((s) => {
          const events = [...s.events, ...stamped];
          const topicStates = { ...s.topicStates };
          for (const tid of new Set(stamped.map((e) => e.topicId))) {
            const topic = getTopic(tid);
            if (topic) {
              topicStates[tid] = applyEvents(
                topicStates[tid] ?? initialTopicState(topic), topic, stamped.filter((e) => e.topicId === tid), events,
              );
            }
          }
          return { events, topicStates };
        });
        return stamped;
      },

      rebuildStates: () => {
        const { events } = get();
        // 单遍按 topicId 分桶,消除 replayTopicState 对每个 topic 的全量重扫(O(topics×events)→O(events));
        // replayTopicState 内部仍按 topicId 过滤,喂已过滤切片 = 无操作,重放语义与整流逐字一致
        const byTopic = new Map<string, LearnEvent[]>();
        for (const ev of events) {
          const bucket = byTopic.get(ev.topicId);
          if (bucket) bucket.push(ev);
          else byTopic.set(ev.topicId, [ev]);
        }
        const EMPTY: LearnEvent[] = [];
        const topicStates: Record<string, TopicState> = {};
        for (const topic of getAllTopics()) {
          if (!topic.locked) topicStates[topic.topicId] = replayTopicState(topic, byTopic.get(topic.topicId) ?? EMPTY);
        }
        set({ topicStates });
      },

      loadCustomTopics: async (force = false) => {
        if (!force && (get().customTopicsStatus === 'loading' || get().customTopicsStatus === 'ready')) return;
        const sequence = ++customTopicsLoadSequence;
        set({ customTopicsStatus: 'loading' });
        let raw: unknown[] | null = null;
        for (let attempt = 0; attempt <= CUSTOM_TOPICS_RETRY_MS.length; attempt += 1) {
          try {
            raw = await listPublishedCustomTopics();
            break;
          } catch {
            if (sequence !== customTopicsLoadSequence) return;
            const delay = CUSTOM_TOPICS_RETRY_MS[attempt];
            if (delay === undefined) break;
            await new Promise((resolve) => window.setTimeout(resolve, delay));
          }
        }
        if (sequence !== customTopicsLoadSequence) return;
        if (!raw) {
          set({ customTopicsStatus: 'error' });
          return;
        }
        const topics = raw.map(hydrateRuntimeTopic).filter((topic): topic is Topic => topic !== null);
        registerRuntimeTopics(topics);
        set((state) => ({
          customTopics: topics,
          customTopicsStatus: 'ready',
          global: {
            ...state.global,
            learningLevel: deriveEvolution(state.events, getAllTopics()).stage,
          },
        }));
        get().rebuildStates();
      },

      clearCustomTopics: () => {
        customTopicsLoadSequence += 1;
        registerRuntimeTopics([]);
        set((state) => ({
          customTopics: [],
          customTopicsStatus: 'idle',
          global: {
            ...state.global,
            learningLevel: deriveEvolution(state.events, getAllTopics()).stage,
          },
        }));
        get().rebuildStates();
      },

      startSession: async (topicId, mode) => {
        const topic = getTopic(topicId);
        if (!topic || topic.locked) return;
        revokeLiveImages(get().live);
        const g = get().global;
        const state = get().topicState(topicId);
        const sessionId = `T${now().slice(0, 10).replaceAll('-', '')}-${uid().slice(0, 4)}`;

        const opening = openingCard(mode, topic, state, g);
        const live: LiveSession = {
          sessionId, topicId, mode, startedAt: now(),
          messages: [], traces: [], mood: opening.mood,
          pendingMcId: opening.pendingMcId,
          lookupChecklistId: null, ended: false, busy: true,
        };
        set({ live });
        get().appendEvents(
          [{ type: 'session_started', topicId, payload: { mode }, evidence: `开始${mode === 'teach' ? '讲解' : mode === 'reteach' ? '重讲验证' : '复习'}会话` }],
          sessionId,
        );

        // 跨会话回忆必须在 await 前取材(长渲染期间事件流可能变化);excludeSessionId 滤掉刚开的本场。
        // 冷启动(无任何往史)返回 null,开场白与从前一字不差;仅 teach 模式追加,reteach/review 不动
        const recall = mode === 'teach'
          ? recallGreetingLine({ topic, events: get().events, reports: get().reports, excludeSessionId: sessionId })
          : null;
        // 学伴记忆提示同样在 await 前取材:长渲染期间记忆可能被清空/暂停
        const memoryHints = get().memory.paused ? [] : memoryHintsForXiaobai({
          items: get().memory.items, topicId, course: topic.course, topic,
          hitChecklist: state.hitChecklist, now: now(),
        });
        // 开场小本本:空对话,但 reteach/review 里"已听懂的要点"已有内容,值得进【这堂课到现在】
        const sessionBrief = deriveSessionBrief({ topic, state, messages: [], traces: [], pendingMcId: opening.pendingMcId });
        const speak = await speakXiaobai({
          card: opening.card, topic, state, recentMessages: [], settings: get().settings, seed: 0, memoryHints, sessionBrief,
        });
        // api 模式下渲染可能耗时数秒,期间用户可能已退出/切换会话 —— 续体只允许写回本会话
        if (get().live?.sessionId !== sessionId) return;
        const greeting =
          mode === 'teach'
            ? `老师好!今天你要给我讲「${topic.title}」呀?我搬好小板凳了!${recall ? `\n${recall}` : ''}`
            : mode === 'reteach'
              ? `老师,上次那个问题我后来想了想,还是没转过弯来……`
              : `老师……上次学的东西,我好像有点忘了。`;
        set((s) => s.live && s.live.sessionId === sessionId ? {
          live: {
            ...s.live, busy: false, mood: speak.mood,
            messages: [msg('xiaobai', `${greeting}\n${speak.text}`, { action: opening.action, mood: speak.mood })],
          },
        } : {});
        if (opening.pendingMcId) {
          get().appendEvents([{
            type: 'misconception_injected', topicId,
            payload: { mcId: opening.pendingMcId, replay: true },
            evidence: `重放误区 ${opening.pendingMcId},验证是否已能纠正`,
          }], sessionId);
        }
      },

      submitTeaching: async (text, image) => {
        const { live, settings } = get();
        const topic = live ? getTopic(live.topicId) : undefined;
        const visibleText = text.trim();
        if (!live || !topic || live.busy || live.ended || (!visibleText && !image)) {
          return { accepted: false };
        }

        const sessionId = live.sessionId;
        const safeUtterance = visibleText || '（老师展示了一张辅助讲图）';
        const createTeacherMessage = () => msg('teacher', visibleText, image ? {
          image: {
            ...image.attachment,
            // 待发预览与气泡分持两个 URL：页面卸载可立即收回预览，不会截断在飞识图。
            objectUrl: URL.createObjectURL(image.blob),
          },
        } : undefined);
        let teacherMsg: ChatMessage | null = null;
        let teacherAccepted = false;
        set((s) => s.live?.sessionId === sessionId ? {
          live: { ...s.live, busy: true, mood: 'thinking', lookupChecklistId: null },
        } : {});

        // 入口守门:这一轮若是「套答案/角色反转/窃取提示词」而非讲课,当场婉拒,
        // 不进评估/导演/渲染链,不推进任何状态(检查清单命中、误区判定一概不发生)。
        if (isExtractionAttempt(visibleText)) {
          teacherMsg = { ...createTeacherMessage(), blocked: true };
          set((s) => {
            if (!s.live || s.live.sessionId !== sessionId || !teacherMsg) return {};
            teacherAccepted = true;
            return {
              live: {
                ...s.live, busy: false, mood: 'confused',
                messages: [
                  ...s.live.messages,
                  teacherMsg,
                  msg('xiaobai', DEFLECTION_LINE, { mood: 'confused' }),
                ],
              },
            };
          });
          if (!teacherAccepted && teacherMsg.image) URL.revokeObjectURL(teacherMsg.image.objectUrl);
          return { accepted: teacherAccepted };
        }

        try {
          const lastXiaobaiText = recentXiaobaiQuestionText(live.messages);
          const clarificationSource = questionClarificationSource(
            visibleText, lastXiaobaiText,
          );
          // 明确的“请小白重述上一问”整轮按元对话处理；图片也不送视觉模型，
          // 避免引用问题中的关键词被评估器误记为要点、认同、纠正或复习通过。
          const description = clarificationSource
            ? null
            : image ? await describeTeachingImage(image.blob, settings) : null;
          if (get().live?.sessionId !== sessionId) return { accepted: false, error: 'teaching-stale' };
          const privateUtterance = description
            ? privateImageUtterance(visibleText, description)
            : visibleText;
          teacherMsg = createTeacherMessage();
          const privateTeacherMsg: ChatMessage = { ...teacherMsg, text: privateUtterance };
          set((s) => {
            if (!s.live || s.live.sessionId !== sessionId || !teacherMsg) return {};
            teacherAccepted = true;
            return { live: { ...s.live, messages: [...s.live.messages, teacherMsg] } };
          });
          if (!teacherAccepted) {
            if (teacherMsg.image) URL.revokeObjectURL(teacherMsg.image.objectUrl);
            return { accepted: false, error: 'teaching-stale' };
          }

          const state = get().topicState(topic.topicId);
          const g = get().global;
          // 老师最近说过的本课术语:一次算清,交给导演填指令卡(可见消息,不含图片识别文本)
          // 守门拦截过的老师发言(blocked)不进术语提取与小本本:被拦的注入句不得在下一轮以「老师上一轮讲解」回流评估器
          const unblockedMessages = live.messages.filter((m) => !m.blocked);
          const recentTeacherTerms = extractTeacherTerms([...unblockedMessages, teacherMsg], topic);
          // 课堂小本本:本轮评估前的课堂全貌(轮次/已懂要点/自己上一问/老师上一轮讲解/讲法),评估器与小白共用
          const sessionBrief = deriveSessionBrief({
            topic, state, messages: [...unblockedMessages, teacherMsg], traces: live.traces, pendingMcId: live.pendingMcId,
          });
          // 老师是在请小白解释自己上一问，不是“不会讲”。在进入评估/导演前截住，
          // 不写事件、不推进 trace 或 R1-R4；明确的讲解请放到下一轮，避免一轮双重语义。
          if (clarificationSource) {
            const speak = await speakQuestionClarification({
              questionSource: clarificationSource,
              topic,
              state,
              global: g,
              recentMessages: [...live.messages, teacherMsg],
              settings,
              seed: live.traces.length + 1,
            });
            if (get().live?.sessionId !== sessionId) return { accepted: true };
            set((s) => {
              if (!s.live || s.live.sessionId !== sessionId) return {};
              const currentTopic = s.topicStates[topic.topicId] ?? state;
              return {
                topicStates: {
                  ...s.topicStates,
                  [topic.topicId]: { ...currentTopic, stuckStreak: 0 },
                },
                live: {
                  ...s.live,
                  busy: false,
                  mood: speak.mood,
                  messages: [
                    ...s.live.messages,
                    msg('xiaobai', speak.text, { mood: speak.mood }),
                  ],
                },
              };
            });
            return { accepted: true };
          }
          const privateEval = await evaluate({
            utterance: privateUtterance, lastXiaobaiText, topic, state,
            pendingMcId: live.pendingMcId, settings, sessionBrief,
          });
          // 诚实降级标记只落 trace 顶层,不随 EvalResult 进导演/事件/复盘
          const { evalSource, ...privateEvalCore } = privateEval;
          const evalResult = image ? privateEvalToRecord(privateEvalCore, visibleText) : privateEvalCore;
          // 长 await 期间用户可能已退出教室/开启新会话:陈旧续体不得写入事件流与新会话
          if (get().live?.sessionId !== sessionId) return { accepted: true };
          const decision = decide({
            evalResult, topic, state, global: g, mode: live.mode,
            pendingMcId: live.pendingMcId, utterance: safeUtterance, recentTeacherTerms,
          });

          // 复习模式:纠正成功即复习通过
          if (live.mode === 'review' && evalResult.mcEvent?.result === 'corrected') {
            decision.events.push({
              type: 'review_passed', topicId: topic.topicId,
              payload: { mcId: evalResult.mcEvent.mcId },
              evidence: '复习验证通过,小白"想起来了",图谱重新点亮',
            });
          }

          const stamped = get().appendEvents(decision.events, live.sessionId);
          // 会话内状态(卡壳/救援级别)不走事件流,直接合并
          set((s) => {
            const topicStates = { ...s.topicStates };
            const cur = topicStates[topic.topicId] ?? initialTopicState(topic);
            topicStates[topic.topicId] = { ...cur, ...decision.stateDelta, mcStates: { ...cur.mcStates, ...(decision.stateDelta.mcStates ?? {}) } };
            return { topicStates };
          });

          const stateAfter = get().topicState(topic.topicId);
          const privateMessages = [...live.messages, privateTeacherMsg];
          // 图片脱敏接缝(不是双重补丁):trace 记 decision.card(只含可见发言的术语);
          // 只有带图片识别文本时才另起一份私有卡给渲染层——复述素材与术语镜像可用图片描述,但不入档。
          const privateCard = description ? {
            ...decision.card,
            paraphraseSource: decision.card.paraphraseSource === safeUtterance
              ? privateUtterance
              : decision.card.paraphraseSource,
            recentTeacherTerms: extractTeacherTerms(privateMessages, topic),
          } : decision.card;
          // 金句一出即边讲边记(事件已 append):本轮的「爱打比方」习惯就能进这一轮的提示
          const golden = stamped.find((e) => e.type === 'golden_analogy_saved');
          if (golden) {
            get().memorizeGoldenAnalogy({
              topicId: topic.topicId, eventId: golden.id, quote: String(golden.payload.text ?? ''),
            });
          }
          const memoryHints = get().memory.paused ? [] : memoryHintsForXiaobai({
            items: get().memory.items, topicId: topic.topicId, course: topic.course, topic,
            hitChecklist: stateAfter.hitChecklist, now: now(),
          });
          const speak = await speakXiaobai({
            card: privateCard, topic, state: stateAfter,
            recentMessages: privateMessages,
            settings, seed: live.traces.length + 1, memoryHints, sessionBrief,
          });
          if (get().live?.sessionId !== sessionId) return { accepted: true };

          const shouldCueExam = decision.examReady === true && live.examCuedAt === undefined;
          const newMessages: ChatMessage[] = [
            msg('xiaobai', speak.text, { action: decision.action, mood: speak.mood }),
          ];
          if (shouldCueExam) {
            newMessages.push(msg('xiaobai', XIAOBAI_EXAM_READY_LINE, { mood: 'happy' }));
          }
          if (decision.systemNote) newMessages.push(msg('system', decision.systemNote));
          // mock 模式看不见提示词:开窍复述那一轮补一条旁注,让记忆的影响在课堂上可见(一场只一次)
          if (
            memoryHints.length > 0 && decision.action === 'express_understanding' && decision.card.paraphraseSource
            && !live.messages.some((m) => m.role === 'system' && m.text.startsWith(MEMORY_NOTE_PREFIX))
          ) {
            newMessages.push(msg('system', `${MEMORY_NOTE_PREFIX}${memoryHints[0]}`));
          }

          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live,
              busy: false,
              mood: shouldCueExam ? 'happy' : speak.mood,
              pendingMcId: decision.pendingMcAfter,
              lookupChecklistId: decision.action === 'propose_lookup' ? decision.card.targetChecklistId : null,
              examCuedAt: shouldCueExam ? s.live.traces.length + 1 : s.live.examCuedAt,
              ended: decision.forceEnd,
              messages: [...s.live.messages, ...newMessages],
              traces: [...s.live.traces, {
                turn: s.live.traces.length + 1,
                teacherText: safeUtterance,
                evalResult, card: decision.card,
                xiaobaiText: speak.text,
                leakageRetries: speak.leakageRetries,
                t: now(),
                renderSource: speak.source,
                evalSource: evalSource ?? (settings.mode === 'mock' ? 'rules' : undefined),
                moodSource: speak.moodSource,
                llmMode: settings.mode,
              }],
            },
          } : {});

          // 金句 → 全局层(关系印象改由学伴记忆承担,不再往 relationshipMemory 写死字符串)
          if (golden) {
            set((s) => ({
              global: {
                ...s.global,
                goldenAnalogies: [...s.global.goldenAnalogies, {
                  id: golden.id, topicId: topic.topicId,
                  text: String(golden.payload.text ?? ''), t: golden.t,
                }],
              },
            }));
          }
          return { accepted: true };
        } catch (error) {
          if (!teacherAccepted) {
            set((s) => s.live?.sessionId === sessionId ? {
              live: { ...s.live, busy: false, mood: 'confused' },
            } : {});
            return {
              accepted: false,
              error: error instanceof Error ? error.message : 'vision-failed',
            };
          }
          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live, busy: false, mood: 'confused',
              messages: [...s.live.messages, msg('xiaobai', '呀,我走神了……老师你刚说到哪了?再讲一遍呗。', { mood: 'confused' })],
            },
          } : {});
          return { accepted: true };
        }
      },

      closeLookup: () => set((s) => s.live ? { live: { ...s.live, lookupChecklistId: null } } : {}),

      endSession: () => {
        const { live, global: g, reports } = get();
        const topic = live ? getTopic(live.topicId) : undefined;
        if (!live || !topic) return null;

        const state = get().topicState(topic.topicId);
        const quiz = live.mode === 'review' ? null : runXiaobaiQuiz(topic, state);
        if (quiz) {
          get().appendEvents([{
            type: 'xiaobai_quiz_scored', topicId: topic.topicId,
            payload: { score: quiz.score, failed: quiz.failedChecklist },
            evidence: `随堂小测考小白:${quiz.score} 分${quiz.failedChecklist.length ? `,错在 ${quiz.failedChecklist.join('/')}` : ',全对!'}`,
          }], live.sessionId);
        }

        const prevRadar = [...reports].reverse().find((r) => r.topicId === topic.topicId && r.mode !== 'review')?.radar ?? null;
        const report = buildReport({
          sessionId: live.sessionId, topic, mode: live.mode,
          startedAt: live.startedAt, endedAt: now(),
          traces: live.traces, state, quiz, prevRadar,
        });

        if (report.masteredNow && state.knowledgeState !== '出师') {
          get().appendEvents([{
            type: 'topic_mastered', topicId: topic.topicId,
            payload: { turns: live.traces.length },
            evidence: `「${topic.title}」出师:要点全覆盖、误区全纠正、小测 ${quiz?.score} 分`,
          }], live.sessionId);
          const mastered = g.topicsMastered + 1;
          const record = `${live.traces.length} 轮出师`;
          // 进化新规则(出师深度 + 跨课程广度)从新鲜事件流重算修行阶——topic_mastered 已 append,get().events 含之
          const stage = deriveEvolution(get().events, getAllTopics()).stage;
          set((s) => ({
            global: {
              ...s.global,
              topicsMastered: mastered,
              // 五阶形象跃迁 = 进化:出师深度够、还需跨课程广度才升更高阶(不再单课深耕即跳级)
              learningLevel: stage,
              bestRecord: !s.global.bestRecord || live.traces.length < parseInt(s.global.bestRecord, 10)
                ? record : s.global.bestRecord,
            },
          }));
        }
        get().appendEvents([{
          type: 'session_ended', topicId: topic.topicId,
          payload: { turns: live.traces.length },
          evidence: `会话结束,共 ${live.traces.length} 轮讲解`,
        }], live.sessionId);
        // 下课即记:须在 live 置空前取对话与判定
        get().memorizeSession({
          sessionId: live.sessionId, topicId: topic.topicId, messages: live.messages, traces: live.traces, report,
        });

        set((s) => ({ reports: [...s.reports, report], live: null }));
        revokeLiveImages(live);
        return report.sessionId;
      },

      abandonSession: () => {
        const { live } = get();
        if (live) {
          // 事件溯源一致性:中途离开也落 session_ended,悬置的"已注入"误区由重放逻辑退回"待注入"
          get().appendEvents([{
            type: 'session_ended', topicId: live.topicId,
            payload: { turns: live.traces.length, abandoned: true },
            evidence: `中途离开教室(第 ${live.traces.length} 轮),悬置误区退回待注入`,
          }], live.sessionId);
          if (live.traces.length >= 1) {
            get().memorizeSession({
              sessionId: live.sessionId, topicId: live.topicId, messages: live.messages, traces: live.traces,
              report: null,
            });
          }
        }
        set({ live: null });
        revokeLiveImages(live);
      },

      completePrep: (topicId, correctCount, total) => {
        get().appendEvents([{
          type: 'prep_completed', topicId,
          payload: { correctCount, total },
          evidence: `备课完成,摸底快测 ${correctCount}/${total}`,
        }], null);
      },

      completeRemedy: (topicId, mcId) => {
        get().appendEvents([{
          type: 'remedy_completed', topicId,
          payload: { mcId },
          evidence: `补学微路径完成(${mcId}),待回讲解舱重讲验证`,
        }], null);
      },

      startReview: async (topicId) => {
        get().appendEvents([{
          type: 'review_triggered', topicId,
          payload: {},
          evidence: '战术性遗忘触发:小白按学生的遗忘曲线主动求复习',
        }], null);
        await get().startSession(topicId, 'review');
      },

      setPersona: (p) => set((s) => ({ global: { ...s.global, persona: p } })),
      setSettings: (partial) => set((s) => ({ settings: { ...s.settings, ...partial } })),
      setAsrSettings: (partial) => set((s) => ({ asrSettings: { ...s.asrSettings, ...partial } })),
      resetAll: () => {
        revokeLiveImages(get().live);
        set({
          global: DEFAULT_GLOBAL, events: [], reports: [], topicStates: {}, live: null, memory: EMPTY_MEMORY,
        });
      },

      memorizeSession: ({ sessionId, topicId, messages, traces, report }) => {
        if (get().memory.paused) return;
        const topic = getTopic(topicId);
        if (!topic) return;
        const at = now();
        const drafts = extractSessionMemories({
          sessionId, events: get().events.filter((e) => e.sessionId === sessionId), report, topic,
          messages, traces, existing: get().memory.items, piiTerms: memoryPiiProvider(), now: at,
        });
        applyDrafts(get, set, drafts, at);
      },

      memorizeGoldenAnalogy: ({ topicId, eventId, quote }) => {
        if (get().memory.paused || !getTopic(topicId)) return;
        const at = now();
        const memory = get().memory;
        // 引文与抽取器同一道闸:含号码/邮箱/联系方式/用户名整条丢弃(留事件 id),其余截 20 字
        const q = scrubQuote(quote, memoryPiiProvider());
        const { items } = reconcileMemories(memory.items, [{
          kind: 'habit', scope: {}, dedupeKey: 'analogy', text: '先生讲课爱打比方', confidence: 0.8,
          evidence: [eventId, ...(q ? [q] : [])],
        }], at);
        set({ memory: { ...memory, items } });
      },

      pinMemory: (id, pinned) => set((s) => ({
        memory: { ...s.memory, items: touchItem(s.memory.items, id, (it) => ({ ...it, pinned, updatedAt: now() })) },
      })),
      muteMemory: (id, muted) => set((s) => ({
        memory: { ...s.memory, items: touchItem(s.memory.items, id, (it) => ({ ...it, muted, updatedAt: now() })) },
      })),
      editMemory: (id, text) => {
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!clean) return;
        set((s) => ({
          memory: {
            ...s.memory,
            items: touchItem(s.memory.items, id, (it) => ({
              ...it, text: clean, source: 'explicit', pinned: true, confidence: 1, updatedAt: now(),
            })),
          },
        }));
      },
      deleteMemory: (id) => set((s) => ({
        memory: { ...s.memory, items: s.memory.items.filter((it) => it.id !== id) },
      })),
      addExplicitMemory: (text, scope) => {
        const item = explicitMemory(text, scope, now());
        if (!item) return;
        set((s) => ({
          memory: { ...s.memory, items: [...s.memory.items.filter((it) => it.id !== item.id), item] },
        }));
      },
      setMemoryPaused: (paused) => set((s) => ({ memory: { ...s.memory, paused } })),
      recomposeProfile: () => {
        const { memory, events } = get();
        set({ memory: { ...memory, profile: composeLearnerProfile({ items: memory.items, events, now: now() }) } });
      },
      resetMemory: () => set({ memory: EMPTY_MEMORY }),
    }),
    {
      name: 'xiaobai-store-v1',
      version: 5,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        global: s.global, events: s.events, reports: s.reports,
        settings: s.settings, asrSettings: s.asrSettings, memory: s.memory,
      }),
      // v3 修正旧存档的跳级值,让五阶成长从既有出师数重新连续派生
      // v4 进化新规则(跨课程广度)重算:从事件流按 deriveEvolution 复算 learningLevel
      //    —— 深耕单课程的旧档会诚实降阶,属新规则下的确定性重算,接受
      // v5 学伴记忆:从事件流+报告回填 memory(对话不持久化,说话风格类条目回填中天然缺席)
      migrate: (persisted, version) => {
        const state = persisted as Partial<AppState>;
        if (version < 3 && state.global) {
          const mastered = Math.max(0, Number(state.global.topicsMastered) || 0);
          state.global = {
            ...state.global,
            learningLevel: Math.min(5, 1 + mastered) as XiaobaiGlobal['learningLevel'],
          };
        }
        if (version < 4 && state.global && Array.isArray(state.events)) {
          // events 缺失/非数组时保持原值(不硬把等级抹成 1);正常档按跨课程广度重算
          state.global = {
            ...state.global,
            learningLevel: deriveEvolution(state.events, TOPICS).stage,
          };
        }
        if (version < 5 && Array.isArray(state.events)) {
          state.memory = rebuildMemoryFromHistory({
            events: state.events, reports: Array.isArray(state.reports) ? state.reports : [],
            topics: TOPICS, now: new Date().toISOString(),
          });
        }
        return state;
      },
      // 构建期注入了 LLM 凭据、而存档从未配置过 key 时,以注入配置为准;
      // 用户手动配置过的 key 一律保留不动。放在 merge(每次加载幂等)而非 migrate(版本升级只跑一次):
      // 否则"无 key 构建"先打上版本戳后,后补的凭据永远无法生效
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<AppState> | undefined ?? {}) };
        if (ENV_LLM_DEFAULT && !merged.settings?.apiKey) {
          merged.settings = { ...ENV_LLM_DEFAULT, temperature: merged.settings?.temperature ?? 0.8 };
        }
        // 记忆切片每次加载都过校验:手工改坏/损坏的存档不得让记忆匣白屏
        merged.memory = sanitizeMemoryState(merged.memory) ?? EMPTY_MEMORY;
        return merged;
      },
      onRehydrateStorage: () => (state) => {
        state?.rebuildStates();
      },
    },
  ),
);
