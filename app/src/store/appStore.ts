/**
 * 全局状态编排 —— FROZEN(页面只消费此 store,不直接调 engine)
 * 单轮两跳:评估(发生了什么) → 导演(接下来做什么) → 小白(怎么说出来) → 出口守门
 * 持久化:事件流 / 全局 profile / 复盘报告 / 设置;TopicState 由事件流重放派生。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AsrSettings, ChatMessage, EvalResult, LearnEvent, LiveSession, LlmSettings, Persona,
  SessionMode, SessionReport, TopicState, XiaobaiGlobal,
} from '../types';
import { getTopic, TOPICS } from '../data';
import { XIAOBAI_EXAM_READY_LINE } from '../data/xiaobaiLines';
import {
  applyEvents, buildReport, decide, DEFLECTION_LINE, evaluate, extractTeacherTerms,
  initialTopicState, isExtractionAttempt, openingCard, replayTopicState, runXiaobaiQuiz, speakXiaobai,
} from '../engine';
import type { EventDraft } from '../engine';
// 跨会话回忆:直接从 recall 模块导入,不走 engine barrel(simulate 在 Node 加载 barrel,recall 不得混入)
import { recallGreetingLine } from '../engine/recall';
// 进化派生(升期):同为不进 barrel 的纯函数,按路径直连
import { deriveEvolution } from '../engine/evolution';
// 语音转写默认配置:同为浏览器专用模块,不走 barrel
import { DEFAULT_ASR } from '../engine/asr';
import type { PreparedImageAttachment } from '../lib/imageAttachment';
import { describeTeachingImage } from '../lib/vision';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

/** 导出给 sync 拉档时兜底:远端 global 缺字段(或被手工改坏)不得让页面派生层崩掉 */
export const DEFAULT_GLOBAL: XiaobaiGlobal = {
  persona: '好奇型',
  learningLevel: 1,
  relationshipMemory: [],
  goldenAnalogies: [],
  topicsMastered: 0,
  bestRecord: null,
};

// 构建期注入的 LLM 凭据(.env.local,不入库):有 key → 默认直连 API,否则纯本地演示模式
const ENV_KEY = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim() ?? '';
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

  topicState: (topicId: string) => TopicState;
  appendEvents: (drafts: EventDraft[], sessionId: string | null) => LearnEvent[];
  rebuildStates: () => void;

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
        const topicStates: Record<string, TopicState> = {};
        for (const topic of TOPICS) {
          if (!topic.locked) topicStates[topic.topicId] = replayTopicState(topic, events);
        }
        set({ topicStates });
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
        const speak = await speakXiaobai({
          card: opening.card, topic, state, recentMessages: [], settings: get().settings, seed: 0,
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
          teacherMsg = createTeacherMessage();
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
          const description = image ? await describeTeachingImage(image.blob, settings) : null;
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
          const lastXiaobaiText = [...live.messages].reverse()
            .find((message) => message.role === 'xiaobai')?.text ?? null;
          const privateEval = await evaluate({
            utterance: privateUtterance, lastXiaobaiText, topic, state,
            pendingMcId: live.pendingMcId, settings,
          });
          const evalResult = image ? privateEvalToRecord(privateEval, visibleText) : privateEval;
          // 长 await 期间用户可能已退出教室/开启新会话:陈旧续体不得写入事件流与新会话
          if (get().live?.sessionId !== sessionId) return { accepted: true };
          const decision = decide({
            evalResult, topic, state, global: g, mode: live.mode,
            pendingMcId: live.pendingMcId, turn: live.traces.length, utterance: safeUtterance,
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
          const recordCard = {
            ...decision.card,
            recentTeacherTerms: extractTeacherTerms([...live.messages, teacherMsg], topic),
          };
          const privateMessages = [...live.messages, privateTeacherMsg];
          const privateCard = {
            ...decision.card,
            paraphraseSource: decision.card.paraphraseSource === safeUtterance
              ? privateUtterance
              : decision.card.paraphraseSource,
            recentTeacherTerms: extractTeacherTerms(privateMessages, topic),
          };
          const speak = await speakXiaobai({
            card: privateCard, topic, state: stateAfter,
            recentMessages: privateMessages,
            settings, seed: live.traces.length + 1,
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

          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live,
              busy: false,
              mood: shouldCueExam ? 'happy' : speak.mood,
              pendingMcId: decision.pendingMcAfter,
              lookupChecklistId: decision.action === 'propose_lookup' ? recordCard.targetChecklistId : null,
              examCuedAt: shouldCueExam ? s.live.traces.length + 1 : s.live.examCuedAt,
              ended: decision.forceEnd,
              messages: [...s.live.messages, ...newMessages],
              traces: [...s.live.traces, {
                turn: s.live.traces.length + 1,
                teacherText: safeUtterance,
                evalResult, card: recordCard,
                xiaobaiText: speak.text,
                leakageRetries: speak.leakageRetries,
                t: now(),
              }],
            },
          } : {});

          // 金句/关系记忆 → 全局层
          const golden = stamped.find((e) => e.type === 'golden_analogy_saved');
          if (golden) {
            set((s) => ({
              global: {
                ...s.global,
                goldenAnalogies: [...s.global.goldenAnalogies, {
                  id: golden.id, topicId: topic.topicId,
                  text: String(golden.payload.text ?? ''), t: golden.t,
                }],
                relationshipMemory: s.global.relationshipMemory.includes('老师爱打比方,一举例我就懂')
                  ? s.global.relationshipMemory
                  : [...s.global.relationshipMemory, '老师爱打比方,一举例我就懂'].slice(-5),
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
          traces: live.traces, state, quiz, prevRadar, global: g,
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
          const stage = deriveEvolution(get().events, TOPICS).stage;
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
          global: DEFAULT_GLOBAL, events: [], reports: [], topicStates: {}, live: null,
        });
      },
    }),
    {
      name: 'xiaobai-store-v1',
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        global: s.global, events: s.events, reports: s.reports,
        settings: s.settings, asrSettings: s.asrSettings,
      }),
      // v3 修正旧存档的跳级值,让五阶成长从既有出师数重新连续派生
      // v4 进化新规则(跨课程广度)重算:从事件流按 deriveEvolution 复算 learningLevel
      //    —— 深耕单课程的旧档会诚实降阶,属新规则下的确定性重算,接受
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
        return merged;
      },
      onRehydrateStorage: () => (state) => {
        state?.rebuildStates();
      },
    },
  ),
);
