import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Achievement } from '../../engine/achievements';
import { getTopic } from '../../data';
import { Icon } from '../../components/ui/Icon';
import s from './AchievementWall.module.css';
import motion from './AchievementSealMotion.module.css';
import { useSealCeremony } from './useSealCeremony';

const SEALS_PER_PAGE = 4;
const PAGES_PER_SPREAD = 2;
const SEALS_PER_SPREAD = SEALS_PER_PAGE * PAGES_PER_SPREAD;
const TURN_MS = 460;

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

function SealDetail({ achievement, onClose }: { achievement: Achievement; onClose: () => void }) {
  const earned = achievement.earnedAt !== null;
  // 印记来历:落印那一刻触发事件所属的课(仅实印显示,虚位无来历)
  const fromTopic = earned && achievement.triggerTopicId
    ? getTopic(achievement.triggerTopicId)?.title ?? null
    : null;
  return (
    <div className={`${s.sealDetail} ${s[`tier${achievement.tier}`]} ${earned ? s.earned : s.locked}`}>
      <div className={s.previewHead}>
        <span>印面预览</span>
        <button type="button" className={s.previewClose} onClick={onClose} aria-label="收起印章预览">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className={s.previewArtwork}>
        <SealArtwork achievement={achievement} earned={earned} />
      </div>
      <div className={s.detailBody}>
        <p className={s.sealDetailName}>{achievement.name}<span> · {TIER_NAME[achievement.tier]}{earned ? '' : '虚位'}</span></p>
        <p className={s.sealDetailDesc}>{achievement.desc}</p>
        <p className={s.sealDetailEvidence}>
          {earned ? (achievement.evidence ?? '印已钤下。') : <>尚差 <b>{Math.max(0, achievement.progress.target - achievement.progress.now)}</b> 步，印位暂留。</>}
          {achievement.earnedAt ? <span> · {fmtDateTime(achievement.earnedAt)} 钤印</span> : null}
        </p>
        {fromTopic ? <p className={s.sealDetailFrom}>出自〈{fromTopic}〉</p> : null}
      </div>
    </div>
  );
}

export function AchievementWall({ achievements, litStars }: { achievements: Achievement[]; litStars?: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'prev' | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const turnTimerRef = useRef<number | null>(null);
  const cancelPreviewScroll = useCallback(() => {
    if (scrollTimerRef.current === null) return;
    window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = null;
  }, []);
  const earnedCount = achievements.filter((item) => item.earnedAt !== null).length;
  const pageCount = Math.max(1, Math.ceil(achievements.length / SEALS_PER_PAGE));
  const spreadCount = Math.max(1, Math.ceil(pageCount / PAGES_PER_SPREAD));
  const spreadStart = spreadIndex * SEALS_PER_SPREAD;
  const spreadPages = Array.from({ length: PAGES_PER_SPREAD }, (_, pageOffset) => {
    const pageIndex = spreadIndex * PAGES_PER_SPREAD + pageOffset;
    const start = spreadStart + pageOffset * SEALS_PER_PAGE;
    return {
      pageIndex,
      achievements: achievements.slice(start, start + SEALS_PER_PAGE),
    };
  });
  const visibleSealIds = spreadPages.flatMap((page) => page.achievements.map((item) => item.id));
  const { celebratingId, pendingIds } = useSealCeremony(achievements, visibleSealIds);
  const openAchievement = achievements.find((item) => item.id === openId) ?? null;
  const lastOpenRef = useRef<Achievement | null>(null);
  if (openAchievement) lastOpenRef.current = openAchievement;
  const shownAchievement = openAchievement ?? lastOpenRef.current;
  const celebratingAchievement = useMemo(
    () => achievements.find((item) => item.id === celebratingId) ?? null,
    [achievements, celebratingId],
  );

  useEffect(() => {
    if (spreadIndex < spreadCount) return;
    setSpreadIndex(spreadCount - 1);
  }, [spreadCount, spreadIndex]);

  useEffect(() => {
    const pendingAchievement = achievements.find((item) => pendingIds.has(item.id));
    if (!pendingAchievement) return;
    const pendingIndex = achievements.findIndex((item) => item.id === pendingAchievement.id);
    const targetSpread = Math.floor(pendingIndex / SEALS_PER_SPREAD);
    if (targetSpread === spreadIndex) return;
    cancelPreviewScroll();
    setOpenId(null);
    setTurnDirection(targetSpread > spreadIndex ? 'next' : 'prev');
    setSpreadIndex(targetSpread);
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => {
      setTurnDirection(null);
      turnTimerRef.current = null;
    }, TURN_MS);
  }, [achievements, cancelPreviewScroll, pendingIds, spreadIndex]);

  useEffect(() => () => {
    cancelPreviewScroll();
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
  }, [cancelPreviewScroll]);

  const turnTo = (nextSpread: number) => {
    if (nextSpread < 0 || nextSpread >= spreadCount || nextSpread === spreadIndex) return;
    cancelPreviewScroll();
    setOpenId(null);
    setTurnDirection(nextSpread > spreadIndex ? 'next' : 'prev');
    setSpreadIndex(nextSpread);
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => {
      setTurnDirection(null);
      turnTimerRef.current = null;
    }, TURN_MS);
  };

  const toggleAchievement = (id: string, fromKeyboard: boolean) => {
    const nextId = openId === id ? null : id;
    setOpenId(nextId);
    cancelPreviewScroll();
    if (!nextId) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollImmediately = reduceMotion || fromKeyboard;
    scrollTimerRef.current = window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: scrollImmediately ? 'auto' : 'smooth', block: 'nearest' });
      scrollTimerRef.current = null;
    }, scrollImmediately ? 0 : 360);
  };

  const closePreview = useCallback(() => {
    const closingId = openId;
    cancelPreviewScroll();
    setOpenId(null);
    if (!closingId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`achievement-${closingId}`)?.focus();
    });
  }, [cancelPreviewScroll, openId]);

  useEffect(() => {
    if (!openId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePreview();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePreview, openId]);

  if (achievements.length === 0) return <p className={s.empty}>册页尚空——先去开一课，印章自会一枚枚落上来。</p>;

  return (
    <div className={s.album}>
      <SealTextureDefs />
      <aside className={s.albumSpine} aria-hidden="true">
        <span className={s.spineTitle}>师者印章册</span>
        <span className={s.spineCount}><b>{earnedCount}</b><small>实印</small></span>
        <span className={s.spineSeal}>藏</span>
      </aside>
      <div className={s.albumBody}>
        <div className={s.albumNote}>
          <p>
            {earnedCount === 0 ? '章坯已备，只等课堂把它们一枚枚唤醒。' : '每一道缺口、每一处浓淡，都对应一段真实课堂。'}
            {/* 叙事桥:印章册反指星图——同一套成就,一屏落印、一屏点亮 */}
            {typeof litStars === 'number' && litStars > 0 ? <em className={s.albumStars}>星海里已点亮 {litStars} 星。</em> : null}
          </p>
          <span>{earnedCount}/{achievements.length} · 点印预览，左右翻页</span>
        </div>
        <div className={s.ceremonySlot}>
          {celebratingAchievement ? (
            <div className={`${s.ceremonyNote} ${motion.ceremonyNote}`} role="status" aria-live="polite">
              <span>新章入谱</span><b>「{celebratingAchievement.name}」</b>
            </div>
          ) : null}
        </div>
        <div className={s.bookNav}>
          <button
            type="button"
            className={s.pageButton}
            disabled={spreadIndex === 0}
            onClick={() => turnTo(spreadIndex - 1)}
            aria-label="翻到上一跨页"
          >
            <Icon name="arrow-left" size={16} /> 上一页
          </button>
          <span className={s.spreadStatus} aria-live="polite">
            第 {spreadPages[0].pageIndex + 1}
            {spreadPages[1].pageIndex < pageCount ? `—${spreadPages[1].pageIndex + 1}` : ''} 页
            <small> / 共 {pageCount} 页</small>
          </span>
          <button
            type="button"
            className={s.pageButton}
            disabled={spreadIndex >= spreadCount - 1}
            onClick={() => turnTo(spreadIndex + 1)}
            aria-label="翻到下一跨页"
          >
            下一页 <Icon name="arrow-right" size={16} />
          </button>
        </div>

        <div
          key={spreadIndex}
          className={[
            s.bookSpread,
            turnDirection === 'next' ? s.turnNext : '',
            turnDirection === 'prev' ? s.turnPrev : '',
          ].filter(Boolean).join(' ')}
        >
          {spreadPages.map((page, pageOffset) => (
            <section
              key={page.pageIndex}
              className={`${s.bookPage} ${pageOffset === 0 ? s.pageLeft : s.pageRight}`}
              aria-label={`印章册第 ${page.pageIndex + 1} 页`}
            >
              <header className={s.pageHead}>
                <span>{pageOffset === 0 ? '左叶' : '右叶'}</span>
                <span>SEAL ARCHIVE · {String(page.pageIndex + 1).padStart(2, '0')}</span>
              </header>
              <div className={s.sealWall}>
                {page.achievements.map((achievement) => (
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
              <span className={s.folio} aria-hidden="true">{page.pageIndex + 1}</span>
            </section>
          ))}
        </div>

        <div className={`${s.detailCollapse} ${openAchievement ? s.detailOpen : ''}`}>
          <div ref={detailRef} id="achievement-detail" role="region" aria-labelledby={shownAchievement ? `achievement-${shownAchievement.id}` : undefined} inert={!openAchievement}>
            {shownAchievement ? <SealDetail achievement={shownAchievement} onClose={closePreview} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
