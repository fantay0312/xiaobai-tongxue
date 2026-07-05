/**
 * 成长页 /growth —— 小白的成长册。
 * 成长阶梯 + 人格皮肤 + 盲区图谱(星图) + 教学履历 + 每个节点可展开掌握度证据链。
 * 复习契约:await startReview(topicId) → navigate(`/teach/${topicId}?mode=review`)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LearnEventType, Persona, XiaobaiMood } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic, TOPICS } from '../../data';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { KnowledgeMap, type MapNode } from './KnowledgeMap';
import s from './growth.module.css';

const LEVELS = [
  { lv: 1, name: 'Lv1 嫩芽', desc: '初入学堂' },
  { lv: 2, name: 'Lv2 灯泡', desc: '偶有灵光' },
  { lv: 3, name: 'Lv3 眼镜', desc: '追问成性' },
  { lv: 4, name: 'Lv4 眼镜', desc: '刨根问底' },
  { lv: 5, name: 'Lv5 学士帽', desc: '可以出师' },
] as const;

const PERSONAS: { name: Persona; line: string }[] = [
  { name: '好奇型', line: '「哇,为什么会这样?然后呢然后呢?」' },
  { name: '严谨型', line: '「等等,这个说法有依据吗?边界在哪儿?」' },
  { name: '杠精型', line: '「我不信。你要是对的,这段代码怎么解释?」' },
];

const EVENT_LABEL: Record<LearnEventType, string> = {
  session_started: '开课',
  checklist_hit: '要点命中',
  accuracy_flag: '表述存疑',
  misconception_injected: '误区注入',
  misconception_corrected: '误区纠正',
  misconception_adopted: '被带偏',
  golden_analogy_saved: '金句收录',
  stuck_rescued: '卡壳救援',
  prep_completed: '备课完成',
  remedy_completed: '补学完成',
  topic_mastered: '出师',
  review_triggered: '复习触发',
  review_passed: '复习通过',
  xiaobai_quiz_scored: '小测计分',
  session_ended: '下课',
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const rise = (i: number) => ({ animationDelay: `${i * 75}ms` });

export default function GrowthPage() {
  const navigate = useNavigate();
  const global = useAppStore((st) => st.global);
  const events = useAppStore((st) => st.events);
  const topicStates = useAppStore((st) => st.topicStates);
  const topicStateOf = useAppStore((st) => st.topicState);
  const setPersona = useAppStore((st) => st.setPersona);
  const startReview = useAppStore((st) => st.startReview);
  const resetAll = useAppStore((st) => st.resetAll);

  const [selected, setSelected] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const nodes: MapNode[] = TOPICS.map((t) => {
    if (t.locked) return { topic: t, state: null, status: 'locked' as const };
    const st = topicStates[t.topicId] ?? topicStateOf(t.topicId);
    const touched =
      st.hitChecklist.length > 0 || st.prepDone || st.knowledgeState !== '没懂' ||
      events.some((e) => e.topicId === t.topicId);
    const status = st.forgotten
      ? ('forgotten' as const)
      : st.knowledgeState === '出师'
        ? ('mastered' as const)
        : touched
          ? ('learning' as const)
          : ('unlearned' as const);
    return { topic: t, state: st, status };
  });

  const selNode = nodes.find((n) => n.topic.topicId === selected) ?? null;
  const selEvents = selected ? events.filter((e) => e.topicId === selected) : [];
  const forgottenNodes = nodes.filter((n) => n.status === 'forgotten');

  const mood: XiaobaiMood =
    global.learningLevel >= 5 ? 'proud' : global.topicsMastered > 0 ? 'happy' : 'idle';

  const goReview = async (topicId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await startReview(topicId);
      navigate(`/teach/${topicId}?mode=review`);
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div className={s.page}>
      {/* 顶部:小白 + 成长阶梯 + 人格皮肤 */}
      <header className={`${s.hero} ${s.rise}`} style={rise(0)}>
        <div className={s.avatarBox}>
          <XiaobaiAvatar mood={mood} level={global.learningLevel} variant="paper" size={200} />
        </div>
        <div>
          <h1 className={s.heroTitle}>小白的成长册</h1>
          <p className={s.heroSub}>
            它现在是 <span className={s.levelNow}>{LEVELS[global.learningLevel - 1].name} · {LEVELS[global.learningLevel - 1].desc}</span>
            ——你教得越明白,它追问得越刁钻。
          </p>

          <div className={s.ladder}>
            {LEVELS.map((l) => (
              <div
                key={l.lv}
                className={
                  l.lv === global.learningLevel
                    ? `${s.rung} ${s.rungNow}`
                    : l.lv < global.learningLevel
                      ? `${s.rung} ${s.rungPast}`
                      : s.rung
                }
              >
                <span className={s.rungDot} />
                <div className={s.rungName}>{l.name}</div>
                <div className={s.rungDesc}>{l.desc}</div>
              </div>
            ))}
          </div>

          <div className={s.personaRow}>
            {PERSONAS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={global.persona === p.name ? `${s.personaCard} ${s.personaActive}` : s.personaCard}
                onClick={() => setPersona(p.name)}
              >
                <span className={s.personaName}>{p.name}</span>
                <p className={s.personaLine}>{p.line}</p>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 盲区图谱 */}
      <section className={`${s.section} ${s.rise}`} style={rise(1)}>
        <h2 className={s.h2}>盲区图谱<small>点一个节点,展开它的掌握度证据链</small></h2>
        <div className={s.mapWrap}>
          <KnowledgeMap
            nodes={nodes}
            selectedId={selected}
            onSelect={(tid) => setSelected(selected === tid ? null : tid)}
          />
        </div>
        <div className={s.legendRow}>
          <span><span className={`${s.swatch} ${s.swJade}`} />出师</span>
          <span><span className={`${s.swatch} ${s.swAmber}`} />衰减待复习</span>
          <span><span className={`${s.swatch} ${s.swAzure}`} />学习中</span>
          <span><span className={`${s.swatch} ${s.swDust}`} />未学</span>
          <span><span className={`${s.swatch} ${s.swLocked}`} />未开放</span>
        </div>

        {forgottenNodes.map((n) => (
          <div key={n.topic.topicId} className={s.forgotRow}>
            <span className={s.forgotText}>
              小白说「{n.topic.title}」它有点忘了……当时讲的那个关键地方,是怎么回事来着?
            </span>
            <button
              type="button"
              className={s.btnGhost}
              disabled={reviewBusy}
              onClick={() => goReview(n.topic.topicId)}
            >
              帮它复习
            </button>
          </div>
        ))}

        <div className={`${s.collapse} ${selNode ? s.open : ''}`}>
          <div>
            {selNode && selNode.state && (
              <div className={s.nodePanel}>
                <div className={s.panelHead}>
                  <h3 className={s.panelTitle}>{selNode.topic.title}</h3>
                  <span className={
                    selNode.status === 'mastered' ? `${s.chip} ${s.chipJade}`
                      : selNode.status === 'forgotten' ? `${s.chip} ${s.chipAmber}`
                        : `${s.chip} ${s.chipAzure}`
                  }>
                    {selNode.status === 'mastered' ? '已出师'
                      : selNode.status === 'forgotten' ? '小白说它忘了'
                        : selNode.state.knowledgeState}
                  </span>
                  <span className={s.chip}>掌握度 {Math.round(selNode.state.mastery * 100)}</span>
                  <span className={s.chip}>
                    要点 {selNode.state.hitChecklist.length}/{selNode.topic.checklist.length}
                  </span>
                </div>
                {selNode.status === 'forgotten' && (
                  <button
                    type="button"
                    className={s.btnGhost}
                    disabled={reviewBusy}
                    onClick={() => goReview(selNode.topic.topicId)}
                  >
                    小白说它忘了 → 帮它复习
                  </button>
                )}
                <h3 className={s.h3} style={{ marginTop: 'var(--gap-tight)' }}>掌握度证据链</h3>
                {selEvents.length === 0 ? (
                  <p className={s.muted}>还没有任何事件——这个知识点还没开讲。</p>
                ) : (
                  <ol className={s.timeline}>
                    {selEvents.map((e) => (
                      <li key={e.id} className={s.timelineItem}>
                        <span className={s.timelineTime}>{fmtDateTime(e.t)}</span>
                        <span className={s.chip}>{EVENT_LABEL[e.type] ?? e.type}</span>
                        <span className={s.timelineText}>{e.evidence}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 教学履历 */}
      <section className={`${s.section} ${s.rise}`} style={rise(2)}>
        <h2 className={s.h2}>教学履历<small>期末可导出的「我真的懂了」过程证据</small></h2>
        <div className={s.statRow}>
          <div className={s.stat}>
            <div className={s.statNum}>{global.topicsMastered}</div>
            <div className={s.statLabel}>已教会小白的知识点</div>
          </div>
          <div className={s.stat}>
            <div className={s.statNum}>{global.bestRecord ?? '——'}</div>
            <div className={s.statLabel}>最快出师纪录</div>
          </div>
          <div className={s.stat}>
            <div className={s.statNum}>×{global.goldenAnalogies.length}</div>
            <div className={s.statLabel}>金句类比收藏</div>
          </div>
        </div>

        {global.goldenAnalogies.length > 0 && (
          <>
            <h3 className={s.h3}>金句收藏</h3>
            <div className={s.goldenRow}>
              {global.goldenAnalogies.map((g) => (
                <figure key={g.id} className={s.goldenCard}>
                  <blockquote className={s.goldenText}>{g.text}</blockquote>
                  <figcaption className={s.goldenFrom}>
                    出自「{getTopic(g.topicId)?.title ?? g.topicId}」 · {fmtDateTime(g.t)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        <h3 className={s.h3} style={{ marginTop: 'var(--gap-loose)' }}>小白眼里的你</h3>
        {global.relationshipMemory.length === 0 ? (
          <p className={s.muted}>还没熟起来——多讲几课,小白会慢慢记住你的教学风格。</p>
        ) : (
          <ul className={s.memoryList}>
            {global.relationshipMemory.map((m) => (
              <li key={m} className={s.memoryItem}>{m}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 角落:演示重置(行内二次确认,不用弹窗) */}
      <div className={s.corner}>
        {confirming ? (
          <>
            <span className={s.cornerConfirm}>确认清空全部演示数据?撤销不了哦。</span>
            <button
              type="button"
              className={s.cornerYes}
              onClick={() => { resetAll(); setConfirming(false); setSelected(null); }}
            >
              确认重置
            </button>
            <button type="button" className={s.cornerNo} onClick={() => setConfirming(false)}>
              算了
            </button>
          </>
        ) : (
          <button type="button" className={s.cornerBtn} onClick={() => setConfirming(true)}>
            演示重置
          </button>
        )}
      </div>
    </div>
  );
}
