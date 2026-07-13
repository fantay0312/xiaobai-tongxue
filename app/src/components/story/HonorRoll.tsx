/**
 * 下课钤印 —— 复盘页的落印仪式条。
 * 一堂课新落的印章、师道晋级、小白升期,在批注开卷前先钤下来;
 * 没有新荣誉的课整条不渲染,不占版面、不发空贺。
 * 数据全部来自 deriveSessionHonors 的事件流复算,组件不算账、不发明事实。
 * 印章语境配色走 --seal-red(豁免制度),金印走 --amber-ink,墨印走 --ink。
 */
import type { SessionHonors } from '../../engine/honors';
import s from './honorRoll.module.css';

/** 与讲解舱名牌/成长册弟子阶同一套学级名 */
const LEVEL_NAME = ['嫩芽期', '开窍期', '求索期', '问难期', '出师期'] as const;

const TIER_CLASS = { ink: 'tierInk', cinnabar: 'tierCinnabar', gold: 'tierGold' } as const;

/** 落印错峰:与全站入场 stagger 同纪律,封顶 300ms */
const stamp = (i: number) => ({ animationDelay: `${Math.min(i * 120, 300)}ms` });

export function HonorRoll({ honors }: { honors: SessionHonors }) {
  const { newSeals, promoted, levelUp, xpGained, xpLevelUp } = honors;
  // 学识晋级(升级轨)也是一件值得钤下的荣誉,单它成真也让钤印条现身
  if (newSeals.length === 0 && !promoted && !levelUp && !xpLevelUp) return null;

  const levelName = (lv: number) => LEVEL_NAME[Math.min(5, Math.max(1, lv)) - 1];

  return (
    <section className={s.roll} aria-label="下课钤印">
      <header className={s.head}>
        <h2 className={s.title}>下课钤印</h2>
        <p className={s.note}>这一课落下的荣誉,件件有据——印匣全帙收在成长册卷一。</p>
      </header>
      <div className={s.row}>
        {newSeals.map((a, i) => (
          <div key={a.id} className={`${s.chip} ${s[TIER_CLASS[a.tier]]}`} style={stamp(i)}>
            <span className={s.glyph} aria-hidden="true">{a.glyph}</span>
            <span className={s.body}>
              <b className={s.name}>新印 · {a.name}</b>
              <span className={s.desc}>{a.desc}</span>
            </span>
          </div>
        ))}
        {promoted && (
          <div className={`${s.chip} ${s.rankChip}`} style={stamp(newSeals.length)}>
            <span className={s.glyph} aria-hidden="true">晋</span>
            <span className={s.body}>
              <b className={s.name}>师道晋级 · {honors.rankAfter.title}</b>
              <span className={s.desc}>
                {honors.rankBefore.title} → {honors.rankAfter.title},本课履历 +{honors.scoreGained} 分
                {/* 学识进账并入这条现成的进账句;若本课学识晋了级,进账改由下面的学识签细说,此处不重复 */}
                {xpGained > 0 && !xpLevelUp && ` · 学识 +${xpGained} 点`}
              </span>
            </span>
          </div>
        )}
        {levelUp && (
          <div className={`${s.chip} ${s.pupilChip}`} style={stamp(newSeals.length + (promoted ? 1 : 0))}>
            <span className={s.glyph} aria-hidden="true">升</span>
            <span className={s.body}>
              <b className={s.name}>小白升期 · {levelName(honors.pupilLevelAfter)}</b>
              <span className={s.desc}>
                从{levelName(honors.pupilLevelBefore)}长到了{levelName(honors.pupilLevelAfter)},是先生教出来的
              </span>
            </span>
          </div>
        )}
        {xpLevelUp && (
          <div
            className={`${s.chip} ${s.wisdomChip}`}
            style={stamp(newSeals.length + (promoted ? 1 : 0) + (levelUp ? 1 : 0))}
          >
            <span className={s.glyph} aria-hidden="true">识</span>
            <span className={s.body}>
              <b className={s.name}>学识晋级 · 第 {honors.xpLevelAfter} 级</b>
              <span className={s.desc}>
                学识 +{xpGained} 点,从第 {honors.xpLevelBefore} 级长到第 {honors.xpLevelAfter} 级
              </span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
