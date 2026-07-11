/**
 * 全局状态编排 —— FROZEN(页面只消费此 store,不直接调 engine)
 * 单轮两跳:评估(发生了什么) → 导演(接下来做什么) → 小白(怎么说出来) → 出口守门
 * 持久化:事件流 / 全局 profile / 复盘报告 / 设置;TopicState 由事件流重放派生。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ChatMessage, LearnEvent, LiveSession, LlmSettings, Persona,
  SessionMode, SessionReport, TopicState, XiaobaiGlobal,
} from '../types';
import { getTopic, TOPICS } from '../data';
import {
  applyEvents, buildReport, decide, DEFLECTION_LINE, evaluate, extractTeacherTerms,
  initialTopicState, isExtractionAttempt, openingCard, replayTopicState, runXiaobaiQuiz, speakXiaobai,
} from '../engine';
import type { EventDraft } from '../engine';
// 跨会话回忆:直接从 recall 模块导入,不走 engine barrel(simulate 在 Node 加载 barrel,recall 不得混入)
import { recallGreetingLine } from '../engine/recall';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

const DEFAULT_GLOBAL: XiaobaiGlobal = {
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

export interface AppState {
  global: XiaobaiGlobal;
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  live: LiveSession | null;
  settings: LlmSettings;

  topicState: (topicId: string) => TopicState;
  appendEvents: (drafts: EventDraft[], sessionId: string | null) => LearnEvent[];
  rebuildStates: () => void;

  startSession: (topicId: string, mode: SessionMode) => Promise<void>;
  submitTeaching: (text: string) => Promise<void>;
  closeLookup: () => void;
  endSession: () => string | null;
  abandonSession: () => void;

  completePrep: (topicId: string, correctCount: number, total: number) => void;
  completeRemedy: (topicId: string, mcId: string) => void;
  startReview: (topicId: string) => Promise<void>;

  setPersona: (p: Persona) => void;
  setSettings: (s: Partial<LlmSettings>) => void;
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

      submitTeaching: async (text) => {
        const { live, settings } = get();
        const topic = live ? getTopic(live.topicId) : undefined;
        if (!live || !topic || live.busy || live.ended || !text.trim()) return;

        const sessionId = live.sessionId;
        const teacherMsg = msg('teacher', text.trim());
        set((s) => s.live ? {
          live: { ...s.live, busy: true, mood: 'thinking', lookupChecklistId: null, messages: [...s.live.messages, teacherMsg] },
        } : {});

        // 入口守门:这一轮若是「套答案/角色反转/窃取提示词」而非讲课,当场婉拒,
        // 不进评估/导演/渲染链,不推进任何状态(检查清单命中、误区判定一概不发生)。
        if (isExtractionAttempt(text)) {
          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live, busy: false, mood: 'confused',
              messages: [...s.live.messages, msg('xiaobai', DEFLECTION_LINE, { mood: 'confused' })],
            },
          } : {});
          return;
        }

        try {
          const state = get().topicState(topic.topicId);
          const g = get().global;
          const evalResult = await evaluate({
            utterance: text, topic, state, pendingMcId: live.pendingMcId, settings,
          });
          // 长 await 期间用户可能已退出教室/开启新会话:陈旧续体不得写入事件流与新会话
          if (get().live?.sessionId !== sessionId) return;
          const decision = decide({
            evalResult, topic, state, global: g, mode: live.mode,
            pendingMcId: live.pendingMcId, turn: live.traces.length, utterance: text,
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
          const card = {
            ...decision.card,
            recentTeacherTerms: extractTeacherTerms([...live.messages, teacherMsg], topic),
          };
          const speak = await speakXiaobai({
            card, topic, state: stateAfter,
            recentMessages: [...live.messages, teacherMsg],
            settings, seed: live.traces.length + 1,
          });
          if (get().live?.sessionId !== sessionId) return;

          const newMessages: ChatMessage[] = [
            msg('xiaobai', speak.text, { action: decision.action, mood: speak.mood }),
          ];
          if (decision.systemNote) newMessages.push(msg('system', decision.systemNote));

          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live,
              busy: false,
              mood: speak.mood,
              pendingMcId: decision.pendingMcAfter,
              lookupChecklistId: decision.action === 'propose_lookup' ? card.targetChecklistId : null,
              ended: decision.forceEnd,
              messages: [...s.live.messages, ...newMessages],
              traces: [...s.live.traces, {
                turn: s.live.traces.length + 1,
                teacherText: text,
                evalResult, card,
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
        } catch {
          set((s) => s.live && s.live.sessionId === sessionId ? {
            live: {
              ...s.live, busy: false, mood: 'confused',
              messages: [...s.live.messages, msg('xiaobai', '呀,我走神了……老师你刚说到哪了?再讲一遍呗。', { mood: 'confused' })],
            },
          } : {});
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
          set((s) => ({
            global: {
              ...s.global,
              topicsMastered: mastered,
              // 五阶形象须逐阶可达:嫩芽→灯泡→眼镜→问号→学士帽,不再 1→3→5 跳级
              learningLevel: Math.min(5, 1 + mastered) as XiaobaiGlobal['learningLevel'],
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
      resetAll: () => set({
        global: DEFAULT_GLOBAL, events: [], reports: [], topicStates: {}, live: null,
      }),
    }),
    {
      name: 'xiaobai-store-v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        global: s.global, events: s.events, reports: s.reports, settings: s.settings,
      }),
      // v3 修正旧存档的跳级值,让五阶成长从既有出师数重新连续派生
      migrate: (persisted, version) => {
        const state = persisted as Partial<AppState>;
        if (version < 3 && state.global) {
          const mastered = Math.max(0, Number(state.global.topicsMastered) || 0);
          state.global = {
            ...state.global,
            learningLevel: Math.min(5, 1 + mastered) as XiaobaiGlobal['learningLevel'],
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
