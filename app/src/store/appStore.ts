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
  applyEvents, buildReport, decide, evaluate, extractTeacherTerms,
  initialTopicState, openingCard, replayTopicState, runXiaobaiQuiz, speakXiaobai,
} from '../engine';
import type { EventDraft } from '../engine';

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

const DEFAULT_SETTINGS: LlmSettings = {
  mode: 'mock',
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

        const speak = await speakXiaobai({
          card: opening.card, topic, state, recentMessages: [], settings: get().settings, seed: 0,
        });
        const greeting =
          mode === 'teach'
            ? `老师好!今天你要给我讲「${topic.title}」呀?我搬好小板凳了!`
            : mode === 'reteach'
              ? `老师,上次那个问题我后来想了想,还是没转过弯来……`
              : `老师……上次学的东西,我好像有点忘了。`;
        set((s) => s.live ? {
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

        const teacherMsg = msg('teacher', text.trim());
        set((s) => s.live ? {
          live: { ...s.live, busy: true, mood: 'thinking', lookupChecklistId: null, messages: [...s.live.messages, teacherMsg] },
        } : {});

        try {
          const state = get().topicState(topic.topicId);
          const g = get().global;
          const evalResult = await evaluate({
            utterance: text, topic, state, pendingMcId: live.pendingMcId, settings,
          });
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

          const newMessages: ChatMessage[] = [
            msg('xiaobai', speak.text, { action: decision.action, mood: speak.mood }),
          ];
          if (decision.systemNote) newMessages.push(msg('system', decision.systemNote));

          set((s) => s.live ? {
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
          set((s) => s.live ? {
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
              learningLevel: Math.min(5, 1 + mastered * 2) as XiaobaiGlobal['learningLevel'],
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

      abandonSession: () => set({ live: null }),

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
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        global: s.global, events: s.events, reports: s.reports, settings: s.settings,
      }),
      onRehydrateStorage: () => (state) => {
        state?.rebuildStates();
      },
    },
  ),
);
