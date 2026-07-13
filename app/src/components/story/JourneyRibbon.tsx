/**
 * 旅程带 —— 有履历后替换拜师帖的门厅导航条(与拜师帖同一容器制式的单层案头条)。
 * 左:师道青印 + 称号行与出师记录;中:journey 指的「当下一步」叙事句;
 * 右:最近落下的一枚成就小印(点击去成长册) + CTA。
 * 页面不算账:称号/成就/下一步全部来自纯函数派生,与成长册同一套口径。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
import { deriveAchievements, deriveTeacherRank } from '../../engine/achievements';
import { nextStep } from '../../engine/journey';
import { deriveWisdom } from '../../engine/evolution';
import { Icon } from '../ui/Icon';
import s from './story.module.css';

const DREAM_GOAL = 5;

export function JourneyRibbon() {
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);

  const { rank, step, latest, nextSeal, wisdomLevel } = useMemo(() => {
    const input = { events, reports, global, topicStates, topics: TOPICS };
    const all = deriveAchievements(input);
    const earned = all
      .filter((a) => a.earnedAt !== null)
      .sort((a, b) => (a.earnedAt! < b.earnedAt! ? 1 : -1));
    // 将落之印:进度比最高的虚印(已开攒才提,零进度不催);比相同差得少者先落
    const ghost = all
      .filter((a) => a.earnedAt === null && a.progress.now > 0)
      .sort((a, b) => {
        const ra = a.progress.now / a.progress.target;
        const rb = b.progress.now / b.progress.target;
        if (rb !== ra) return rb - ra;
        return (a.progress.target - a.progress.now) - (b.progress.target - b.progress.now);
      })[0] ?? null;
    return {
      rank: deriveTeacherRank(input),
      step: nextStep({ events, reports, topicStates, topics: TOPICS }),
      latest: earned[0] ?? null,
      nextSeal: ghost,
      // 小白学识等级(升级轨),并入下方师道行尾作一小段纯文本
      wisdomLevel: deriveWisdom(events).level,
    };
  }, [events, reports, global, topicStates]);

  const dreamLeft = Math.max(0, DREAM_GOAL - global.topicsMastered);

  return (
    <section className={s.ribbon} aria-label="师道旅程" data-tour="story">
      <span className={s.rankSeal} aria-hidden="true">{rank.title}</span>
      <div className={s.rankMeta}>
        <span className={s.rankTitle}>师道 · {rank.title}</span>
        <span className={s.rankSub}>
          已教到出师 {global.topicsMastered} 门
          {dreamLeft > 0
            ? `，再教会 ${dreamLeft} 门，小白就能试着讲给小小白听`
            : '，小白已经准备好把先生的讲法传下去了'}
          {` · 小白学识第 ${wisdomLevel} 级`}
        </span>
      </div>

      <span className={s.ribbonRule} aria-hidden="true" />

      <p className={s.stepLine}>{step.line}</p>

      {(latest || nextSeal) && (
        <div className={s.sealStack}>
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
          {nextSeal && (
            <Link
              to="/growth"
              className={`${s.newSeal} ${s.ghostSeal}`}
              title={`「${nextSeal.name}」:${nextSeal.desc}`}
            >
              <span className={s.newSealGlyph} aria-hidden="true">{nextSeal.glyph}</span>
              <span className={s.newSealName}>
                将落 · {nextSeal.name} {nextSeal.progress.now}/{nextSeal.progress.target}
              </span>
            </Link>
          )}
        </div>
      )}

      <Link className={s.stepCta} to={step.to}>{step.cta}<Icon name="arrow-right" size={16} /></Link>
    </section>
  );
}
