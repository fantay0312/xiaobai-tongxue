/**
 * 旅程带 —— 有履历后替换拜师帖的门厅导航条。
 * 左:师道等级印(真实履历分 + 到下一级的细进度);中:最近落下的一枚成就印(点击去成长册);
 * 右:journey 指的「当下一步」叙事句 + CTA。
 * 页面不算账:等级/成就/下一步全部来自纯函数派生,与成长册同一套口径。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
import { deriveAchievements, deriveTeacherRank } from '../../engine/achievements';
import { nextStep } from '../../engine/journey';
import s from './story.module.css';

export function JourneyRibbon() {
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);

  const { rank, step, latest } = useMemo(() => {
    const input = { events, reports, global, topicStates, topics: TOPICS };
    const earned = deriveAchievements(input)
      .filter((a) => a.earnedAt !== null)
      .sort((a, b) => (a.earnedAt! < b.earnedAt! ? 1 : -1));
    return {
      rank: deriveTeacherRank(input),
      step: nextStep({ events, reports, topicStates, topics: TOPICS }),
      latest: earned[0] ?? null,
    };
  }, [events, reports, global, topicStates]);

  // 进度条 = 履历分 / 下一级门槛;已到宗师则满格
  const ratio = rank.nextAt ? Math.min(1, rank.score / rank.nextAt) : 1;

  return (
    <section className={s.ribbon} aria-label="师道旅程">
      <div className={s.rankSide}>
        <span className={s.rankSeal} aria-hidden="true">{rank.title}</span>
        <div className={s.rankMeta}>
          <span className={s.rankTitle}>师道 · {rank.title}</span>
          <span className={s.rankBar} aria-hidden="true">
            <span className={s.rankFill} style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
          <span className={s.rankNums}>
            {rank.nextTitle
              ? <>履历 <b>{rank.score}</b> / <b>{rank.nextAt}</b> 晋「{rank.nextTitle}」</>
              : <>履历 <b>{rank.score}</b> · 师道至矣</>}
          </span>
        </div>
      </div>

      {latest && (
        <Link
          to="/growth"
          className={`${s.newSeal} ${s[latest.tier]}`}
          title={`「${latest.name}」:${latest.desc}`}
        >
          <span className={s.newSealGlyph} aria-hidden="true">{latest.glyph}</span>
          <span className={s.newSealName}>新印 · {latest.name}</span>
        </Link>
      )}

      <div className={s.stepSide}>
        <p className={s.stepLine}>{step.line}</p>
        <Link className={s.stepCta} to={step.to}>{step.cta}</Link>
      </div>
    </section>
  );
}
