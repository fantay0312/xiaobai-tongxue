/**
 * 复盘页 /review/:sessionId —— 宣纸教学档案。
 * 顺序铁律(方案 §8.2):先高光,后盲区;盲区话术永远「小白还没懂」。
 * 证据链:本 session 事件流 evidence + (会话未关闭时)逐轮评估判语。
 * 叙事层(证书/战报/日记)全部从本场 misconception_* 事件派生,不读 mcStates 快照
 * (session_ended 重放会把悬置误区退回待注入,快照会抹掉本场遭遇记录)。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LearnEventType, SessionMode } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { deriveDemonReport, deriveDiary, type DemonEncounter } from '../../engine/story';
import { MasteryCertificate } from '../../components/story/MasteryCertificate';
import { XiaobaiDiary } from '../../components/story/XiaobaiDiary';
import { Radar } from './Radar';
import { RemedyPath } from './RemedyPath';
import s from './review.module.css';

const MODE_LABEL: Record<SessionMode, string> = {
  teach: '常规讲解', reteach: '重讲验证', review: '复习课',
};

const SEVERITY_LABEL = { high: '被带偏', medium: '还没讲到', low: '小测暴露' } as const;
const SEVERITY_DOT = { high: 'dotHigh', medium: 'dotMedium', low: 'dotLow' } as const;

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

function tagClass(type: LearnEventType): string {
  if (['misconception_corrected', 'golden_analogy_saved', 'topic_mastered', 'review_passed', 'checklist_hit'].includes(type)) {
    return `${s.tag} ${s.tagGood}`;
  }
  if (['misconception_adopted', 'accuracy_flag'].includes(type)) return `${s.tag} ${s.tagBad}`;
  if (['misconception_injected', 'stuck_rescued'].includes(type)) return `${s.tag} ${s.tagWarn}`;
  return s.tag;
}

/** 心魔结局 → 卡片配色类:击退归黛绿,拐走归朱砂(真警示语境),照面归淡墨 */
const OUTCOME_CLASS: Record<DemonEncounter['outcome'], 'demonVanquished' | 'demonStray' | 'demonPassed'> = {
  vanquished: 'demonVanquished',
  stray: 'demonStray',
  passed: 'demonPassed',
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const rise = (i: number) => ({ animationDelay: `${i * 75}ms` });

export default function ReviewPage() {
  const { sessionId } = useParams();
  const reports = useAppStore((st) => st.reports);
  const events = useAppStore((st) => st.events);
  const live = useAppStore((st) => st.live);

  const report = reports.find((r) => r.sessionId === sessionId);
  const topic = report ? getTopic(report.topicId) : undefined;

  const [openRemedy, setOpenRemedy] = useState<string | null>(
    () => report?.blindSpots.find((b) => b.mcId)?.mcId ?? null,
  );
  const [openEvidence, setOpenEvidence] = useState(false);

  if (!report) {
    return (
      <div className={s.page}>
        <div className={`${s.empty} ${s.rise}`}>
          <h1 className={s.emptyTitle}>这份教学档案还不存在</h1>
          <p className={s.emptyText}>
            可能链接有误,或者演示数据刚被重置。先回书斋门厅给小白讲一课,这里就会长出属于你的第一份档案。
          </p>
          <Link to="/study" className={s.btnPrimary}>回书斋门厅</Link>
        </div>
      </div>
    );
  }

  const sessionEvents = events.filter((e) => e.sessionId === sessionId);
  const traces = live && live.sessionId === sessionId ? live.traces : [];
  const hasPrev = !!report.radarDelta && Object.keys(report.radarDelta).length > 0;

  // 叙事派生:纯函数、小数组,每帧直接算,不值得 memo
  const encounters = topic ? deriveDemonReport(topic, sessionEvents) : [];
  const diary = topic ? deriveDiary({ topic, sessionEvents, report }) : null;

  /** 「去救小白」:展开该心魔的补学微路径,并把对应盲区条目滚进视野 */
  const rescueXiaobai = (mcId: string) => {
    setOpenRemedy(mcId);
    // 滚动必须推迟到 React 提交 + 折叠过渡(--t-med 320ms)结束后:同步滚会用旧布局坐标,
    // 上方原本展开的补学路径收起时内容整体上移,目标就滚偏了。reduced-motion 下全局
    // 开关已把过渡压到 0.01ms,0ms 延时(等提交)即可
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      document.getElementById(`blind-${mcId}`)?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    }, reduce ? 0 : 360);
  };

  return (
    <div className={s.page}>
      <header className={`${s.head} ${s.rise}`} style={rise(0)}>
        <p className={s.crumb}><Link to="/study">书斋门厅</Link> / 教学档案</p>
        <h1 className={s.title}>{topic?.title ?? report.topicId}</h1>
        <p className={s.subTitle}>一次讲解的完整复盘 —— 教然后知困</p>
        <p className={s.meta}>
          {MODE_LABEL[report.mode]} · {fmtDate(report.startedAt)} · 共 {report.turnCount} 轮讲解 · 档案号 {report.sessionId}
          {report.masteredNow && <span className={s.masteredBadge}>本次出师</span>}
        </p>
      </header>

      {/* 出师那一课:结业证书顶格,先于一切分栏(doc §7 仪式资产) */}
      {report.masteredNow && topic && <MasteryCertificate topic={topic} report={report} />}

      <div className={s.layout}>
        <div className={s.main}>
          {/* 壹 · 高光在前 —— 顺序铁律 */}
          <section className={`${s.section} ${s.rise}`} style={rise(1)}>
            <h2 className={s.h2}>壹 · 高光时刻<small>金句会被收进教学素材库,劳动被珍视</small></h2>
            <ul className={s.highlightList}>
              {report.highlights.map((h) => (
                <li key={h} className={s.highlightItem}>{h}</li>
              ))}
            </ul>
            {report.goldenAnalogies.length > 0 && (
              <div className={s.goldenRow}>
                {report.goldenAnalogies.map((g) => (
                  <figure key={g} className={s.goldenCard}>
                    <blockquote className={s.goldenText}>{g}</blockquote>
                    <figcaption className={s.goldenFrom}>金句收藏 · 已收录进教学素材库 · 出自「{topic?.title ?? report.topicId}」</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          {/* 贰 · 五维雷达 */}
          <section className={`${s.section} ${s.rise}`} style={rise(2)}>
            <h2 className={s.h2}>贰 · 五维讲解画像</h2>
            <div className={s.radarWrap}>
              <Radar radar={report.radar} delta={report.radarDelta} />
            </div>
            <div className={s.legend}>
              <span className={s.legendNow}>── 本次</span>
              {hasPrev && <span className={s.legendPrev}>╌╌ 上次</span>}
              <span className={s.legendNote}>雷达只和你自己的上一次比,不与任何人排名</span>
            </div>
          </section>

          {/* 叁 · 盲区在后 —— 永远说「小白还没懂」 */}
          <section className={`${s.section} ${s.rise}`} style={rise(3)}>
            <h2 className={s.h2}>叁 · 小白还没懂的地方<small>不是你不行,是它还没被讲明白</small></h2>
            {/* 心魔战报(doc §3.2):注入当下零提示,一切戏剧化只落在课后这里 */}
            {encounters.length > 0 && (
              <div className={s.demonReport}>
                <p className={s.demonHead}>⚔ 本课遭遇心魔 ×{encounters.length}</p>
                <ul className={s.demonList}>
                  {encounters.map((en) => (
                    <li key={en.mcId} className={`${s.demonCard} ${s[OUTCOME_CLASS[en.outcome]]}`}>
                      <div className={s.demonRow}>
                        <span className={s.demonChip}>{en.name}</span>
                        {en.belief && <span className={s.demonBelief}>「{en.belief}」</span>}
                      </div>
                      <p className={s.demonLine}>{en.line}</p>
                      {en.outcome === 'stray' && (
                        <button type="button" className={s.rescueBtn} onClick={() => rescueXiaobai(en.mcId)}>
                          去救小白 →
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.blindSpots.length === 0 ? (
              <p className={s.muted}>这次没有留下盲区——小白全都听懂了。</p>
            ) : (
              <>
                <p className={s.blindLead}>下面每一条,都是小白还没转过弯来的地方。带补学微路径的,三步就能把它讲明白。</p>
                <ul className={s.blindList}>
                  {report.blindSpots.map((spot, i) => {
                    const mc = spot.mcId ? topic?.misconceptions.find((m) => m.mcId === spot.mcId) : undefined;
                    const opened = !!mc && openRemedy === mc.mcId;
                    return (
                      <li
                        key={`${spot.knowledgePoint}-${i}`}
                        id={spot.mcId ? `blind-${spot.mcId}` : undefined}
                        className={spot.severity === 'high' ? `${s.blindItem} ${s.blindItemHigh}` : s.blindItem}
                      >
                        <div className={s.blindHead}>
                          <span className={`${s.dot} ${s[SEVERITY_DOT[spot.severity]]}`} />
                          <span className={s.blindPoint}>{spot.knowledgePoint}</span>
                          <span className={s.sevTag}>{SEVERITY_LABEL[spot.severity]}</span>
                        </div>
                        <p className={s.blindEvidence}>{spot.evidence}</p>
                        {mc && (
                          <>
                            <button
                              type="button"
                              className={s.remedyToggle}
                              onClick={() => setOpenRemedy(opened ? null : mc.mcId)}
                            >
                              <span className={`${s.chev} ${opened ? s.chevOpen : ''}`}>▸</span>
                              {opened ? '收起补学微路径' : '展开补学微路径 —— 三步把它讲明白'}
                            </button>
                            <div className={`${s.collapse} ${opened ? s.open : ''}`}>
                              <div inert={!opened}>
                                <RemedyPath topicId={report.topicId} mc={mc} />
                              </div>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* 肆 · 小白测验成绩单 */}
          <section className={`${s.section} ${s.rise}`} style={rise(4)}>
            <h2 className={s.h2}>肆 · 随堂小测成绩单<small>考的是小白,不是你</small></h2>
            {report.quiz ? (
              <div className={s.quizCard}>
                <div>
                  <span className={s.quizScore}>{report.quiz.score}</span>
                  <span className={s.quizUnit}>分</span>
                  <p className={s.quizCaption}>小白只答得出你教明白的东西——它答错的题,就是你没讲清的地方。</p>
                </div>
                <ul className={s.quizList}>
                  {report.quiz.answers.map((a, i) => {
                    const q = topic?.quizBank.find((x) => x.id === a.quizId);
                    const point = topic?.checklist.find((c) => c.id === a.checklistRef)?.point ?? a.checklistRef;
                    return (
                      <li key={a.quizId} className={s.quizItem}>
                        <span className={a.correct ? s.markRight : s.markWrong}>{a.correct ? '✓' : '✗'}</span>
                        <div>
                          <p className={s.quizQ}>{i + 1}. {q?.question ?? a.quizId}</p>
                          <p className={s.quizNote}>
                            {a.correct
                              ? `小白答对了——「${point}」你讲清了`
                              : `小白答错了——「${point}」正是你还没讲清的地方`}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className={s.muted}>本次是复习课,没有安排随堂小测。</p>
            )}
          </section>

          {/* 伍 · 证据链 —— 可审计的教学录像带 */}
          <section className={`${s.section} ${s.rise}`} style={rise(5)}>
            <h2 className={s.h2}>伍 · 证据链</h2>
            <button
              type="button"
              className={s.evidenceToggle}
              aria-expanded={openEvidence}
              onClick={() => setOpenEvidence((v) => !v)}
            >
              <span className={`${s.chev} ${openEvidence ? s.chevOpen : ''}`}>▸</span>
              这些分数怎么来的?——展开一卷可审计的教学录像带
            </button>
            <div className={`${s.collapse} ${openEvidence ? s.open : ''}`}>
              <div className={s.evidenceBody} inert={!openEvidence}>
                <ol className={s.timeline}>
                  {sessionEvents.length === 0 && (
                    <li className={s.mutedSmall}>本会话没有留下事件记录。</li>
                  )}
                  {sessionEvents.map((e) => (
                    <li key={e.id} className={s.timelineItem}>
                      <span className={s.timelineTime}>{fmtTime(e.t)}</span>
                      <span className={tagClass(e.type)}>{EVENT_LABEL[e.type] ?? e.type}</span>
                      <span className={s.timelineText}>{e.evidence}</span>
                    </li>
                  ))}
                </ol>
                {traces.length > 0 ? (
                  <div className={s.traceBlock}>
                    <h3 className={s.h3}>逐轮评估判语</h3>
                    <ol className={s.traceList}>
                      {traces.map((t) => (
                        <li key={t.turn} className={s.traceItem}>
                          <span className={s.traceTurn}>第 {t.turn} 轮</span>
                          <span>{t.evalResult.reasoning}</span>
                          <span className={s.traceAction}>→ {t.card.action}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className={s.mutedSmall} style={{ marginTop: 'var(--gap)' }}>
                    逐轮评估判语随讲解舱会话窗口关闭而释放;上面的事件流是永久留存的证据,每一分都能回放到它发生的那一刻。
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 陆 · 小白的日记 —— 记岔的那段以最自信的语气写下,零报错样式,天气是唯一信号 */}
          {diary && (
            <section className={`${s.section} ${s.rise}`} style={rise(6)}>
              <h2 className={s.h2}>陆 · 小白的日记<small>课后小白写的——它眼里的今天</small></h2>
              <XiaobaiDiary page={diary} />
            </section>
          )}

          {/* 底部去处 —— 档案读完不留死胡同(出师后主按钮已指向书斋,不再重复给次链接) */}
          <footer className={`${s.footNav} ${s.rise}`} style={rise(7)}>
            <Link
              to={report.masteredNow ? '/study' : `/teach/${report.topicId}`}
              className={s.btnPrimary}
            >
              {report.masteredNow ? '回书斋,再挑一本' : '回讲台,把盲区讲明白'}
            </Link>
            {!report.masteredNow && (
              <Link to="/study" className={s.footLink}>回书斋门厅 →</Link>
            )}
          </footer>
        </div>

        {/* 眉批侧注 —— 红笔批注气质 */}
        <aside className={`${s.rail} ${s.rise}`} style={rise(2)}>
          <div className={s.seal}>批阅讫</div>
          <p className={s.railNote}>先看高光,再看盲区——顺序是故意的。</p>
          <p className={s.railNote}>雷达只跟你自己的上一次比。</p>
          <p className={s.railNote}>盲区的意思是「小白还没懂」,不是「你不行」。</p>
          <p className={s.railNote}>每个分数都有证据,翻到卷伍展开。</p>
          <p className={s.railNote}>日记里小白写下的,它都当真——包括记岔的那一处。</p>
        </aside>
      </div>
    </div>
  );
}
