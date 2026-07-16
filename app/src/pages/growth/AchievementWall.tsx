import { useEffect, useMemo, useRef, useState } from 'react';
import type { Achievement } from '../../engine/achievements';
import s from './AchievementWall.module.css';
import motion from './AchievementSealMotion.module.css';
import { useSealCeremony } from './useSealCeremony';

const TIER_NAME: Record<Achievement['tier'], string> = {
  ink: '墨印',
  cinnabar: '朱印',
  gold: '金印',
};

function SealTextureDefs() {
  return (
    <svg className={s.textureDefs} aria-hidden="true">
      <defs>
        <filter id="achievement-seal-rough" x="-14%" y="-14%" width="128%" height="128%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.31" numOctaves="3" seed="23" result="edgeNoise" />
          <feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale="1.9" xChannelSelector="R" yChannelSelector="B" result="roughInk" />
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="11" result="paperGrain" />
          <feColorMatrix
            in="paperGrain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .45 .45 .45 0 -1.05"
            result="inkPits"
          />
          <feComposite in="roughInk" in2="inkPits" operator="out" result="wornInk" />
          <feColorMatrix
            in="roughInk"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .18 0"
            result="faintInk"
          />
          <feMerge>
            <feMergeNode in="faintInk" />
            <feMergeNode in="wornInk" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

function SealArtwork({ achievement, earned }: { achievement: Achievement; earned: boolean }) {
  const round = achievement.tier === 'gold';
  const rounded = achievement.tier === 'cinnabar';
  const shape = round ? (
    <>
      <circle cx="64" cy="64" r="48" className={s.outerStroke} />
      <circle cx="64" cy="64" r="39" className={s.innerStroke} />
      <path d="M64 11v8M64 109v8M11 64h8M109 64h8" className={s.registrationMarks} />
    </>
  ) : (
    <>
      <rect x="15" y="15" width="98" height="98" rx={rounded ? 12 : 2} className={s.outerStroke} />
      <rect x="23" y="23" width="82" height="82" rx={rounded ? 8 : 1} className={s.innerStroke} />
      <path d="M15 35h8M15 93h8M105 35h8M105 93h8" className={s.registrationMarks} />
    </>
  );

  return (
    <svg className={`${s.sealArtwork} ${motion.sealArtwork}`} viewBox="0 0 128 128" aria-hidden="true">
      <g className={earned ? s.inkedArtwork : s.carvedArtwork}>
        {shape}
        <text x="64" y="84" textAnchor="middle" className={s.artworkGlyph}>{achievement.glyph}</text>
        {earned ? (
          <g className={s.wearMarks}>
            <path d="M31 45l11-2M88 34l7 4M82 99l13-2" />
            <circle cx="42" cy="91" r="1.8" />
            <circle cx="101" cy="68" r="1.35" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

function StampPress() {
  return (
    <>
      <span className={motion.stampTool} aria-hidden="true">
        <span className={motion.stampKnob} />
        <span className={motion.stampStem} />
        <span className={motion.stampBase} />
      </span>
      <span className={motion.inkBloom} aria-hidden="true" />
      <span className={motion.inkFlecks} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      </span>
    </>
  );
}

interface SealButtonProps {
  achievement: Achievement;
  celebrating: boolean;
  pending: boolean;
  open: boolean;
  onToggle: (fromKeyboard: boolean) => void;
}

function SealButton({ achievement, celebrating, pending, open, onToggle }: SealButtonProps) {
  const earned = achievement.earnedAt !== null;
  const progress = achievement.progress.target > 0
    ? Math.min(100, (achievement.progress.now / achievement.progress.target) * 100)
    : 100;

  return (
    <button
      id={`achievement-${achievement.id}`}
      type="button"
      aria-expanded={open}
      aria-controls="achievement-detail"
      aria-label={earned ? `${achievement.name}，已钤印` : `${achievement.name}，进度 ${achievement.progress.now}/${achievement.progress.target}`}
      className={`${s.seal} ${s[`tier${achievement.tier}`]} ${earned ? s.earned : s.locked} ${open ? s.sealOpen : ''} ${pending ? motion.pending : ''} ${celebrating ? motion.celebrating : ''}`}
      onClick={(event) => onToggle(event.detail === 0)}
    >
      <span className={s.sealWash} aria-hidden="true" />
      <span className={s.sealMeta}>
        <span>{TIER_NAME[achievement.tier]}</span>
        <span>{earned ? '已入谱' : '待落印'}</span>
      </span>
      <span className={s.artworkStage} aria-hidden="true">
        <SealArtwork achievement={achievement} earned={earned} />
        {celebrating ? <StampPress /> : null}
      </span>
      <span className={`${s.sealName} ${motion.sealName}`}>{achievement.name}</span>
      <span className={s.sealCriterion}>{earned ? '此印有据' : achievement.desc}</span>
      {!earned ? (
        <span className={s.sealProgress}>
          <span className={s.sealProgressTrack} aria-hidden="true"><span style={{ transform: `scaleX(${progress / 100})` }} /></span>
          <span className={s.sealProgressText}>{achievement.progress.now}/{achievement.progress.target}</span>
        </span>
      ) : null}
    </button>
  );
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function SealDetail({ achievement }: { achievement: Achievement }) {
  const earned = achievement.earnedAt !== null;
  return (
    <div className={`${s.sealDetail} ${s[`tier${achievement.tier}`]} ${earned ? s.earned : s.locked}`}>
      <SealArtwork achievement={achievement} earned={earned} />
      <div className={s.detailBody}>
        <p className={s.sealDetailName}>{achievement.name}<span> · {TIER_NAME[achievement.tier]}{earned ? '' : '虚位'}</span></p>
        <p className={s.sealDetailDesc}>{achievement.desc}</p>
        <p className={s.sealDetailEvidence}>
          {earned ? (achievement.evidence ?? '印已钤下。') : <>尚差 <b>{Math.max(0, achievement.progress.target - achievement.progress.now)}</b> 步，印位暂留。</>}
          {achievement.earnedAt ? <span> · {fmtDateTime(achievement.earnedAt)} 钤印</span> : null}
        </p>
      </div>
    </div>
  );
}

export function AchievementWall({ achievements }: { achievements: Achievement[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const { celebratingId, pendingIds } = useSealCeremony(achievements);
  const earnedCount = achievements.filter((item) => item.earnedAt !== null).length;
  const openAchievement = achievements.find((item) => item.id === openId) ?? null;
  const lastOpenRef = useRef<Achievement | null>(null);
  if (openAchievement) lastOpenRef.current = openAchievement;
  const shownAchievement = openAchievement ?? lastOpenRef.current;
  const celebratingAchievement = useMemo(
    () => achievements.find((item) => item.id === celebratingId) ?? null,
    [achievements, celebratingId],
  );

  useEffect(() => () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
  }, []);

  const toggleAchievement = (id: string, fromKeyboard: boolean) => {
    const nextId = openId === id ? null : id;
    setOpenId(nextId);
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    if (!nextId) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollImmediately = reduceMotion || fromKeyboard;
    scrollTimerRef.current = window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: scrollImmediately ? 'auto' : 'smooth', block: 'nearest' });
      scrollTimerRef.current = null;
    }, scrollImmediately ? 0 : 360);
  };

  if (achievements.length === 0) return <p className={s.empty}>册页尚空——先去开一课，印章自会一枚枚落上来。</p>;

  return (
    <div className={s.album}>
      <SealTextureDefs />
      <aside className={s.albumSpine} aria-hidden="true">
        <span className={s.spineTitle}>师者印谱</span>
        <span className={s.spineCount}><b>{earnedCount}</b><small>实印</small></span>
        <span className={s.spineSeal}>藏</span>
      </aside>
      <div className={s.albumBody}>
        <div className={s.albumNote}>
          <p>{earnedCount === 0 ? '章坯已备，只等课堂把它们一枚枚唤醒。' : '每一道缺口、每一处浓淡，都对应一段真实课堂。'}</p>
          <span>{earnedCount}/{achievements.length} · 点击印面翻看来历</span>
        </div>
        <div className={s.ceremonySlot}>
          {celebratingAchievement ? (
            <div className={`${s.ceremonyNote} ${motion.ceremonyNote}`} role="status" aria-live="polite">
              <span>新章入谱</span><b>「{celebratingAchievement.name}」</b>
            </div>
          ) : null}
        </div>
        <div className={`${s.detailCollapse} ${openAchievement ? s.detailOpen : ''}`}>
          <div ref={detailRef} id="achievement-detail" role="region" aria-labelledby={shownAchievement ? `achievement-${shownAchievement.id}` : undefined} inert={!openAchievement}>
            {shownAchievement ? <SealDetail achievement={shownAchievement} /> : null}
          </div>
        </div>
        <div className={s.sealWall}>
          {achievements.map((achievement) => (
            <SealButton
              key={achievement.id}
              achievement={achievement}
              celebrating={achievement.id === celebratingId}
              pending={pendingIds.has(achievement.id)}
              open={achievement.id === openId}
              onToggle={(fromKeyboard) => toggleAchievement(achievement.id, fromKeyboard)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
