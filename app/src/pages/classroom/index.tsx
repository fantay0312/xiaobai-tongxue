/**
 * 讲解舱 /teach/:topicId?mode=teach|reteach|review —— 亮书斋教室 + 木框黑板。
 * 房间是纸色的(与全站同一世界),黑板是挂在教室里的一件家具(--board 系只住在板内);
 * 左 1/3 讲台(暖光晕下的小白 + 木桌牌),右 2/3 木框黑板上的对话流,板下讲桌是输入区。
 * 挂载契约:store.live 存在且 topicId 吻合则直接接管,否则 startSession(topicId, mode)。
 * 下课:endSession() → /exam/:sessionId → /review/:sessionId;R4 退回备课:abandonSession() → /prep/:topicId。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { getDemoScript, getTopic } from '../../data';
import { Md } from '../../components/Md';
import { Icon } from '../../components/ui/Icon';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { ChatMessage, SessionMode, XiaobaiMood } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
import s from './classroom.module.css';

// 讲课进行中「不给学生看牌」:导演动作(误区注入/开窍复述/救援层级)一律不在现场显示——
// 它会直接告诉学生"这句是陷阱,别认同"或"你刚讲对了"。动作仍随消息落库,只在复盘/成长/教师页事后揭示。
// 现场粉笔小字只注小白的「心情」,是角色表达,不泄露教学机关。

const MOOD_ZH: Record<XiaobaiMood, string> = {
  idle: '平静',
  curious: '好奇',
  confused: '困惑',
  thinking: '琢磨中',
  aha: '开窍了',
  happy: '开心',
  proud: '得意',
  shy: '不好意思',
};

const LEVEL_NAME = ['嫩芽期', '开窍期', '求索期', '问难期', '出师期'] as const;

/** 打字机逐字浮现(像在想怎么说) */
function TypewriterText({ text, animate, onTick, onDone }: {
  text: string;
  animate: boolean;
  onTick?: () => void;
  onDone?: () => void;
}) {
  const [n, setN] = useState(animate ? 0 : text.length);
  const cbRef = useRef({ onTick, onDone });
  cbRef.current = { onTick, onDone };

  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    let v = 0;
    const id = window.setInterval(() => {
      v += 1;
      setN(v);
      cbRef.current.onTick?.();
      if (v >= text.length) {
        window.clearInterval(id);
        cbRef.current.onDone?.();
      }
    }, 26);
    return () => window.clearInterval(id);
  }, [text, animate]);

  const typing = animate && n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {typing ? <span className={s.caret} aria-hidden="true">▍</span> : null}
    </>
  );
}

/** 情绪 → 粉笔配色档:开窍系黛绿(aha 额外闪一次水洗光)、受挫系藤黄,其余默认灰粉笔 */
const MOOD_TONE: Partial<Record<XiaobaiMood, string>> = {
  aha: `${s.moodGlad} ${s.moodAha}`, happy: s.moodGlad, proud: s.moodGlad,
  confused: s.moodWarm, shy: s.moodWarm,
};

function XiaobaiBubble({ m, animate, onTick, onDone }: {
  m: ChatMessage;
  animate: boolean;
  onTick: () => void;
  onDone: () => void;
}) {
  const tone = m.mood ? MOOD_TONE[m.mood] ?? '' : '';
  return (
    <div className={`${s.rowX} ${tone}`}>
      {m.mood ? <span className={s.anno}>﹝{MOOD_ZH[m.mood]}﹞</span> : null}
      <div className={s.bubbleX}>
        <TypewriterText text={m.text} animate={animate} onTick={onTick} onDone={onDone} />
      </div>
    </div>
  );
}

export default function ClassroomPage() {
  const { topicId = '' } = useParams();
  const [sp] = useSearchParams();
  const rawMode = sp.get('mode');
  const mode: SessionMode =
    rawMode === 'reteach' || rawMode === 'review' ? rawMode : 'teach';
  const navigate = useNavigate();

  const live = useAppStore((st) => st.live);
  const g = useAppStore((st) => st.global);
  const submitTeaching = useAppStore((st) => st.submitTeaching);
  const closeLookup = useAppStore((st) => st.closeLookup);
  const endSession = useAppStore((st) => st.endSession);
  const abandonSession = useAppStore((st) => st.abandonSession);

  const topic = getTopic(topicId);
  useDocTitle(topic ? `学堂夜课 · ${topic.title}` : undefined);
  // 演示助手是一键满分讲稿 = 内置答案键,正式部署里对学生隐藏。
  // 只在本地开发(npm run dev)或答辩时显式带 ?demo=1 才出现,生产构建默认剥离。
  const demoEnabled = import.meta.env.DEV || sp.get('demo') === '1';
  const demoLines = demoEnabled ? getDemoScript(topicId) : [];

  const [draft, setDraft] = useState('');
  const [demoOpen, setDemoOpen] = useState(false);
  const [typingNow, setTypingNow] = useState(false);

  /** 挂载时已存在的消息不再重放打字机 */
  const preExistingRef = useRef<Set<string> | null>(null);
  let preIds = preExistingRef.current;
  if (preIds === null) {
    preIds = new Set((useAppStore.getState().live?.messages ?? []).map((m) => m.id));
    preExistingRef.current = preIds;
  }
  const finishedRef = useRef(new Set<string>());
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── 跨页契约:接管或开新会话 ──
  useEffect(() => {
    if (!topic || topic.locked) return;
    const st = useAppStore.getState();
    if (st.live && st.live.topicId === topicId) return; // 直接接管
    void st.startSession(topicId, mode);
  }, [topicId, mode, topic]);

  // force=false 时只在贴近底部才跟随:打字机每帧置底会把用户往上回看的滚动反复拽回去
  const scrollToBottom = (force = true) => {
    const el = streamRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  };
  const prevCountRef = useRef(0);

  const msgCount = live?.messages.length ?? 0;
  const lastXiaobai = live
    ? [...live.messages].reverse().find((m) => m.role === 'xiaobai')
    : undefined;
  const animateId =
    lastXiaobai && !preIds.has(lastXiaobai.id) && !finishedRef.current.has(lastXiaobai.id)
      ? lastXiaobai.id
      : null;

  useEffect(() => {
    if (animateId) setTypingNow(true);
    // 只有新消息落地才强制置底;打字结束/忙碌翻转不把回看中的用户拽回去
    const isNewMessage = msgCount > prevCountRef.current;
    prevCountRef.current = msgCount;
    scrollToBottom(isNewMessage);
  }, [animateId, msgCount, live?.busy]);

  if (!topic || topic.locked) {
    return (
      <div className={s.holder}>
        <p>
          这间教室还没有开放。<Link to="/study"><Icon name="arrow-left" size={15} />回书斋</Link>
        </p>
      </div>
    );
  }
  if (!live || live.topicId !== topicId) {
    return (
      <div className={s.holder}>
        <p>正在把教室的灯打开……</p>
      </div>
    );
  }

  const canSend = !live.busy && !live.ended && draft.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void submitTeaching(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const quit = () => {
    abandonSession();
    navigate('/study');
  };
  const dismissClass = () => {
    const sid = endSession();
    navigate(sid ? (mode === 'review' ? `/review/${sid}` : `/exam/${sid}`) : '/study');
  };
  const backToPrep = () => {
    abandonSession();
    navigate(`/prep/${topicId}`);
  };
  const handleTypeDone = (id: string) => {
    finishedRef.current.add(id);
    setTypingNow(false);
  };

  const lookupItem = live.lookupChecklistId
    ? topic.checklist.find((c) => c.id === live.lookupChecklistId) ?? null
    : null;
  const lastSystemText = [...live.messages].reverse().find((m) => m.role === 'system')?.text;
  const finishLabel = mode === 'review' ? '完成温故' : '送小白赴考';
  const finishIcon = mode === 'review' ? 'pen' : 'route';

  return (
    <div className={s.room}>
      {/* ── 顶栏 ── */}
      <header className={s.topbar}>
        <button type="button" className={s.quitBtn} onClick={quit}>
          <Icon name="arrow-left" size={16} />
          <span>暂离学堂</span>
        </button>
        <div className={s.topTitle}>
          <span className={s.topCourse}>第二章 · 学堂夜课 · {topic.course}</span>
          <span className={s.topName}>{topic.title}</span>
        </div>
        {!live.ended && (
          <button
            type="button"
            className={s.endBtn}
            onClick={dismissClass}
            disabled={live.busy}
          >
            <Icon name={finishIcon} size={16} />
            {finishLabel}
          </button>
        )}
      </header>
      {mode !== 'teach' && (
        <div className={s.modeBanner}>
          {mode === 'reteach'
            ? '重讲验证 —— 上次被带偏的地方,这次要把它讲明白。'
            : '帮小白复习 —— 它把上次学的忘了一些,快帮它想起来。'}
        </div>
      )}

      <div className={s.main}>
        {/* ── 左 1/3:讲台(暖光晕下的小白) ── */}
        <aside className={s.stage}>
          <div className={s.boardFrame}>
            <XiaobaiAvatar
              mood={live.busy ? 'thinking' : live.mood}
              level={g.learningLevel}
              speaking={typingNow}
              size={170}
              variant="paper"
            />
          </div>
          <div className={s.plate}>
            <div className={s.plateName}>小白</div>
            <div className={s.plateRow}>{LEVEL_NAME[g.learningLevel - 1]} · {g.persona}</div>
            <div className={s.plateRow}>在学:{topic.title}</div>
            <div className={s.plateRow}>
              心情:{MOOD_ZH[live.busy ? 'thinking' : live.mood]} · 已讲 {live.traces.length} 轮
            </div>
          </div>
          {live.busy && <div className={s.stageThinking}>小白正在琢磨…</div>}
          <p className={s.stageHint}>
            把知识讲给小白听——它没读过标准答案,你的话就是它的全部教材。
          </p>
        </aside>

        {/* ── 右 2/3:木框黑板(对话流写在板上,板下粉笔槽) ── */}
        <section className={s.chat}>
          <div className={s.boardObj}>
            <div className={s.stream} ref={streamRef}>
              {live.messages.map((m) =>
              m.role === 'system' ? (
                <div key={m.id} className={s.rowSys}>
                  <span className={s.sysTag}>导演</span>
                  {m.text}
                </div>
              ) : m.role === 'teacher' ? (
                <div key={m.id} className={s.rowT}>
                  <div className={s.bubbleT}>{m.text}</div>
                </div>
              ) : (
                <XiaobaiBubble
                  key={m.id}
                  m={m}
                  animate={m.id === animateId}
                  onTick={() => scrollToBottom(false)}
                  onDone={() => handleTypeDone(m.id)}
                />
              ),
            )}
            {live.busy && (
              <div className={s.rowX}>
                <div className={s.thinking}>
                  小白正在琢磨
                  <span className={s.dots}><i>.</i><i>.</i><i>.</i></span>
                </div>
              </div>
            )}
              <p className={s.srOnly} aria-live="polite">
                {!typingNow && !live.busy ? lastXiaobai?.text ?? '' : ''}
              </p>
            </div>
            {/* 粉笔槽:板下木沿,搁着一截粉笔和板擦 */}
            <div className={s.tray} aria-hidden="true" />
          </div>

          {/* ── 底部讲桌:结束面板 或 演示助手 + 输入区 ── */}
          <div className={s.dock}>
            {live.ended ? (
              <div className={s.endedPanel}>
                <p className={s.endedTitle}>本轮讲解已结束</p>
                <p className={s.endedNote}>
                  {lastSystemText ?? '导演:这一轮先到这里,盲区已记录在案。'}
                </p>
                <div className={s.endedBtns}>
                  <button type="button" className={s.primaryBtn} onClick={backToPrep}>
                    回去备课
                  </button>
                  <button type="button" className={s.ghostBtn} onClick={dismissClass}>
                    {mode === 'review' ? '查看温故记录' : '送小白赴考'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {demoLines.length > 0 && (
                  <div className={s.demoWrap}>
                    <button
                      type="button"
                      className={s.demoToggle}
                      aria-expanded={demoOpen}
                      onClick={() => setDemoOpen((o) => !o)}
                    >
                      <Icon
                        name="chevron-right"
                        size={15}
                        className={demoOpen ? s.chevronOpen : s.chevron}
                      />
                      {demoOpen ? '演示助手(点击话术填入输入框,不会直接发送)' : '演示助手'}
                    </button>
                    <div className={`${s.demoBody} ${demoOpen ? s.demoBodyOpen : ''}`}>
                      <div className={s.demoInner}>
                        {demoLines.map((l) => (
                          <button
                            key={l.label}
                            type="button"
                            className={s.demoLine}
                            onClick={() => {
                              setDraft(l.text);
                              inputRef.current?.focus();
                            }}
                          >
                            <span className={s.demoLabel}>{l.label}</span>
                            <span className={s.demoNote}>{l.note}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className={s.inputBar}>
                  <textarea
                    ref={inputRef}
                    className={s.input}
                    value={draft}
                    rows={3}
                    placeholder="把这个知识点讲给小白听……(Enter 发送,Shift+Enter 换行)"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    disabled={live.busy}
                  />
                  <div className={s.inputSide}>
                    <span className={s.count}>{draft.length} 字</span>
                    <button
                      type="button"
                      className={s.sendBtn}
                      onClick={send}
                      disabled={!canSend}
                    >
                      <Icon name="send" size={16} />
                      讲给小白
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── R2 查书侧栏:黑教室里一页被台灯照亮的书 ── */}
      {lookupItem && !live.ended && (
        <aside className={s.lookup}>
          <p className={s.lookupTag}>一起查书 · R2</p>
          <h3 className={s.lookupTitle}>{lookupItem.point}</h3>
          <Md text={lookupItem.lookupCard} className={s.lookupMd} />
          <button type="button" className={s.lookupBtn} onClick={closeLookup}>
            我来接着讲
          </button>
        </aside>
      )}
    </div>
  );
}
