import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Achievement } from '../../engine/achievements';
import { getTopic } from '../../data';
import { Icon } from '../../components/ui/Icon';
import s from './AchievementWall.module.css';
import motion from './AchievementSealMotion.module.css';
import { sealButtonId, useSealCeremony } from './useSealCeremony';

const SEALS_PER_PAGE = 4;
const PAGES_PER_SPREAD = 2;
const SEALS_PER_SPREAD = SEALS_PER_PAGE * PAGES_PER_SPREAD;
const TURN_MS = 460;
const DETAIL_GAP = 10;
const DETAIL_VIEWPORT_MARGIN = 10;
const TEMPORARY_CLOSE_MS = 140;

const TIER_NAME: Record<Achievement['tier'], string> = {
  ink: '墨印',
  cinnabar: '朱印',
  gold: '金印',
};

type DetailMode = 'temporary' | 'pinned';
type DetailPlacement = 'above' | 'below';

interface ActiveDetail {
  id: string;
  mode: DetailMode;
}

interface DetailPosition {
  top: number;
  left: number;
  pointerX: number;
  placement: DetailPlacement;
}

type DetailStyle = CSSProperties & { '--detail-pointer-x'?: string };

const sealDetailId = (id: string): string => `achievement-detail-${id}`;
const sealDetailTitleId = (id: string): string => `achievement-detail-title-${id}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

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
  active: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onTemporaryOpen: (anchor: HTMLButtonElement, source: 'pointer' | 'focus') => void;
  onTemporaryClose: (anchor: HTMLButtonElement, delayed?: boolean) => void;
  onPin: (anchor: HTMLButtonElement) => void;
}

function SealButton({
  achievement,
  celebrating,
  pending,
  active,
  buttonRef,
  onTemporaryOpen,
  onTemporaryClose,
  onPin,
}: SealButtonProps) {
  const earned = achievement.earnedAt !== null;
  const progress = achievement.progress.target > 0
    ? Math.min(100, (achievement.progress.now / achievement.progress.target) * 100)
    : 100;

  return (
    <button
      ref={buttonRef}
      id={sealButtonId(achievement.id)}
      type="button"
      data-achievement-seal={achievement.id}
      aria-expanded={active}
      aria-controls={sealDetailId(achievement.id)}
      aria-label={`${earned ? `${achievement.name}，已钤印` : `${achievement.name}，进度 ${achievement.progress.now}/${achievement.progress.target}`}，按回车固定条件卡`}
      className={`${s.seal} ${s[`tier${achievement.tier}`]} ${earned ? s.earned : s.locked} ${active ? s.sealOpen : ''} ${pending ? motion.pending : ''} ${celebrating ? motion.celebrating : ''}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') onTemporaryOpen(event.currentTarget, 'pointer');
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') onTemporaryClose(event.currentTarget, true);
      }}
      onFocus={(event) => onTemporaryOpen(event.currentTarget, 'focus')}
      onBlur={(event) => onTemporaryClose(event.currentTarget)}
      onClick={(event) => onPin(event.currentTarget)}
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

function SealDetail({
  achievement,
  pinned,
  onClose,
}: {
  achievement: Achievement;
  pinned: boolean;
  onClose: () => void;
}) {
  const earned = achievement.earnedAt !== null;
  const target = Math.max(1, achievement.progress.target);
  const remaining = Math.max(0, target - achievement.progress.now);
  const progress = Math.min(100, Math.max(0, (achievement.progress.now / target) * 100));
  // 印记来历:落印那一刻触发事件所属的课(仅实印显示,虚位无来历)
  const fromTopic = earned && achievement.triggerTopicId
    ? getTopic(achievement.triggerTopicId)?.title ?? null
    : null;

  return (
    <aside
      id={sealDetailId(achievement.id)}
      className={`${s.sealDetail} ${s[`tier${achievement.tier}`]} ${earned ? s.earned : s.locked}`}
      role="region"
      aria-labelledby={sealDetailTitleId(achievement.id)}
    >
      <header className={s.detailHead}>
        <span>印章档案</span>
        <span className={s.detailState}>{TIER_NAME[achievement.tier]} · {earned ? '已入谱' : '待落印'}</span>
        {pinned ? (
          <button type="button" className={s.detailClose} onClick={onClose} aria-label={`收起${achievement.name}条件卡`}>
            <Icon name="x" size={16} />
          </button>
        ) : <span className={s.temporaryHint} aria-hidden="true">移开即收起</span>}
      </header>
      <div className={s.detailBody}>
        <h3 id={sealDetailTitleId(achievement.id)} className={s.sealDetailName}>{achievement.name}</h3>
        <p className={s.sealDetailDesc}><span>达成条件</span>{achievement.desc}</p>
        <dl className={s.detailLedger}>
          <div>
            <dt>进度</dt>
            <dd>
              <span className={s.detailProgressCopy}>
                <b>{achievement.progress.now}</b> / {target}
                <small>{earned ? '已达成' : `尚差 ${remaining}`}</small>
              </span>
              <span
                className={s.detailProgressBar}
                role="progressbar"
                aria-label={`${achievement.name}达成进度`}
                aria-valuemin={0}
                aria-valuemax={target}
                aria-valuenow={Math.min(target, achievement.progress.now)}
                aria-valuetext={earned ? '已达成' : `尚差 ${remaining}`}
              >
                <span style={{ transform: `scaleX(${progress / 100})` }} />
              </span>
            </dd>
          </div>
          <div>
            <dt>证据</dt>
            <dd>{earned ? (achievement.evidence ?? '已达成，触发证据待补录。') : '尚未落印；达成时将记录触发证据。'}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>
              {fromTopic ? `课堂〈${fromTopic}〉` : earned ? '全局学习履历' : '尚未落印'}
              {achievement.earnedAt ? <time dateTime={achievement.earnedAt}> · {fmtDateTime(achievement.earnedAt)}</time> : null}
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

export function AchievementWall({ achievements, litStars }: { achievements: Achievement[]; litStars?: number }) {
  const [activeDetail, setActiveDetail] = useState<ActiveDetail | null>(null);
  const [detailPosition, setDetailPosition] = useState<DetailPosition | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'prev' | null>(null);
  const albumBodyRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const sealRefs = useRef(new Map<string, HTMLButtonElement>());
  const suppressFocusPreviewRef = useRef<string | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const turnTimerRef = useRef<number | null>(null);
  const temporaryCloseTimerRef = useRef<number | null>(null);
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
  const activeAchievement = achievements.find((item) => item.id === activeDetail?.id) ?? null;
  const celebratingAchievement = useMemo(
    () => achievements.find((item) => item.id === celebratingId) ?? null,
    [achievements, celebratingId],
  );

  const registerSeal = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) {
      sealRefs.current.set(id, node);
      return;
    }
    sealRefs.current.delete(id);
  }, []);

  const cancelTemporaryClose = useCallback(() => {
    if (temporaryCloseTimerRef.current === null) return;
    window.clearTimeout(temporaryCloseTimerRef.current);
    temporaryCloseTimerRef.current = null;
  }, []);

  const dismissDetail = useCallback(() => {
    cancelTemporaryClose();
    setActiveDetail(null);
    setDetailPosition(null);
  }, [cancelTemporaryClose]);

  const closeDetail = useCallback((restoreFocus = true) => {
    const closingId = activeDetail?.id ?? null;
    dismissDetail();
    if (!closingId || !restoreFocus) return;
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      const anchor = sealRefs.current.get(closingId);
      if (anchor?.isConnected) {
        suppressFocusPreviewRef.current = closingId;
        anchor.focus({ preventScroll: true });
        suppressFocusPreviewRef.current = null;
      }
      focusFrameRef.current = null;
    });
  }, [activeDetail?.id, dismissDetail]);

  const showTemporaryDetail = useCallback((
    id: string,
    anchor: HTMLButtonElement,
    source: 'pointer' | 'focus',
  ) => {
    cancelTemporaryClose();
    sealRefs.current.set(id, anchor);
    if (source === 'focus' && suppressFocusPreviewRef.current === id) {
      suppressFocusPreviewRef.current = null;
      return;
    }
    setActiveDetail((current) => current?.mode === 'pinned' ? current : { id, mode: 'temporary' });
  }, [cancelTemporaryClose]);

  const hideTemporaryDetail = useCallback((
    id: string,
    anchor: HTMLButtonElement,
    delayed = false,
  ) => {
    cancelTemporaryClose();
    const finish = () => {
      temporaryCloseTimerRef.current = null;
      const anchorStillActive = document.activeElement === anchor
        || anchor.matches(':hover')
        || detailRef.current?.matches(':hover') === true;
      setActiveDetail((current) => {
        if (!current || current.mode === 'pinned' || current.id !== id) return current;
        return anchorStillActive ? current : null;
      });
    };
    if (!delayed) {
      finish();
      return;
    }
    temporaryCloseTimerRef.current = window.setTimeout(finish, TEMPORARY_CLOSE_MS);
  }, [cancelTemporaryClose]);

  const pinDetail = useCallback((id: string, anchor: HTMLButtonElement) => {
    cancelTemporaryClose();
    sealRefs.current.set(id, anchor);
    if (activeDetail?.id === id && activeDetail.mode === 'pinned') {
      closeDetail();
      return;
    }
    setActiveDetail({ id, mode: 'pinned' });
  }, [activeDetail, cancelTemporaryClose, closeDetail]);

  const measureDetail = useCallback(() => {
    const id = activeDetail?.id;
    const body = albumBodyRef.current;
    const detail = detailRef.current;
    const anchor = id ? sealRefs.current.get(id) : null;
    if (!body || !detail || !anchor) return;

    const bodyRect = body.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    const compact = window.matchMedia('(max-width: 560px)').matches;
    const inset = compact ? 6 : 10;
    const spaceBelow = window.innerHeight - anchorRect.bottom - DETAIL_GAP - DETAIL_VIEWPORT_MARGIN;
    const spaceAbove = anchorRect.top - DETAIL_GAP - DETAIL_VIEWPORT_MARGIN;
    const placement: DetailPlacement = spaceBelow >= detailRect.height || spaceBelow >= spaceAbove
      ? 'below'
      : 'above';
    const idealTop = placement === 'below'
      ? anchorRect.bottom + DETAIL_GAP
      : anchorRect.top - detailRect.height - DETAIL_GAP;
    const topInViewport = clamp(
      idealTop,
      DETAIL_VIEWPORT_MARGIN,
      window.innerHeight - detailRect.height - DETAIL_VIEWPORT_MARGIN,
    );
    const idealLeft = anchorRect.left + anchorRect.width / 2 - detailRect.width / 2;
    const leftInViewport = clamp(
      idealLeft,
      bodyRect.left + inset,
      bodyRect.right - detailRect.width - inset,
    );
    const nextPosition: DetailPosition = {
      top: Math.round(topInViewport - bodyRect.top),
      left: Math.round(leftInViewport - bodyRect.left),
      pointerX: Math.round(clamp(
        anchorRect.left + anchorRect.width / 2 - leftInViewport,
        18,
        detailRect.width - 18,
      )),
      placement,
    };

    setDetailPosition((current) => (
      current
      && current.top === nextPosition.top
      && current.left === nextPosition.left
      && current.pointerX === nextPosition.pointerX
      && current.placement === nextPosition.placement
        ? current
        : nextPosition
    ));
  }, [activeDetail?.id]);

  useEffect(() => {
    if (spreadIndex < spreadCount) return;
    setSpreadIndex(spreadCount - 1);
  }, [spreadCount, spreadIndex]);

  useEffect(() => {
    if (!activeDetail || activeAchievement) return;
    dismissDetail();
  }, [activeAchievement, activeDetail, dismissDetail]);

  useLayoutEffect(() => {
    if (!activeAchievement) {
      setDetailPosition(null);
      return;
    }
    measureDetail();
  }, [activeAchievement, activeDetail?.mode, measureDetail]);

  useEffect(() => {
    if (!activeAchievement) return undefined;
    let positionFrame: number | null = null;
    const scheduleMeasure = () => {
      if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
      positionFrame = window.requestAnimationFrame(() => {
        measureDetail();
        positionFrame = null;
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    if (observer) {
      if (albumBodyRef.current) observer.observe(albumBodyRef.current);
      if (detailRef.current) observer.observe(detailRef.current);
      const anchor = sealRefs.current.get(activeAchievement.id);
      if (anchor) observer.observe(anchor);
    }
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    return () => {
      if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [activeAchievement, measureDetail]);

  useEffect(() => {
    const pendingAchievement = achievements.find((item) => pendingIds.has(item.id));
    if (!pendingAchievement) return;
    const pendingIndex = achievements.findIndex((item) => item.id === pendingAchievement.id);
    const targetSpread = Math.floor(pendingIndex / SEALS_PER_SPREAD);
    if (targetSpread === spreadIndex) return;
    dismissDetail();
    setTurnDirection(targetSpread > spreadIndex ? 'next' : 'prev');
    setSpreadIndex(targetSpread);
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => {
      setTurnDirection(null);
      turnTimerRef.current = null;
    }, TURN_MS);
  }, [achievements, dismissDetail, pendingIds, spreadIndex]);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    if (temporaryCloseTimerRef.current !== null) window.clearTimeout(temporaryCloseTimerRef.current);
  }, []);

  const turnTo = (nextSpread: number) => {
    if (nextSpread < 0 || nextSpread >= spreadCount || nextSpread === spreadIndex) return;
    dismissDetail();
    setTurnDirection(nextSpread > spreadIndex ? 'next' : 'prev');
    setSpreadIndex(nextSpread);
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => {
      setTurnDirection(null);
      turnTimerRef.current = null;
    }, TURN_MS);
  };

  useEffect(() => {
    if (!activeDetail) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeDetail.mode === 'temporary') {
        dismissDetail();
        return;
      }
      event.preventDefault();
      closeDetail();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (activeDetail.mode !== 'pinned') return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const anchor = sealRefs.current.get(activeDetail.id);
      if (detailRef.current?.contains(target) || anchor?.contains(target)) return;
      closeDetail(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [activeDetail, closeDetail, dismissDetail]);

  if (achievements.length === 0) return <p className={s.empty}>册页尚空——先去开一课，印章自会一枚枚落上来。</p>;

  const detailStyle: DetailStyle = detailPosition ? {
    top: detailPosition.top,
    left: detailPosition.left,
    '--detail-pointer-x': `${detailPosition.pointerX}px`,
  } : {};

  return (
    <div className={s.album}>
      <SealTextureDefs />
      <aside className={s.albumSpine} aria-hidden="true">
        <span className={s.spineTitle}>师者印章册</span>
        <span className={s.spineCount}><b>{earnedCount}</b><small>实印</small></span>
        <span className={s.spineSeal}>藏</span>
      </aside>
      <div ref={albumBodyRef} className={s.albumBody}>
        <div className={s.albumNote}>
          <p>
            {earnedCount === 0 ? '章坯已备，只等课堂把它们一枚枚唤醒。' : '每一道缺口、每一处浓淡，都对应一段真实课堂。'}
            {/* 叙事桥:印章册反指星图——同一套成就,一屏落印、一屏点亮 */}
            {typeof litStars === 'number' && litStars > 0 ? <em className={s.albumStars}>星海里已点亮 {litStars} 星。</em> : null}
          </p>
          <span>{earnedCount}/{achievements.length} · 悬停查看，点印固定</span>
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
                    active={achievement.id === activeDetail?.id}
                    buttonRef={(node) => registerSeal(achievement.id, node)}
                    onTemporaryOpen={(anchor, source) => showTemporaryDetail(achievement.id, anchor, source)}
                    onTemporaryClose={(anchor) => hideTemporaryDetail(achievement.id, anchor)}
                    onPin={(anchor) => pinDetail(achievement.id, anchor)}
                  />
                ))}
              </div>
              <span className={s.folio} aria-hidden="true">{page.pageIndex + 1}</span>
            </section>
          ))}
        </div>

        {activeAchievement ? (
          <div
            key={activeAchievement.id}
            ref={detailRef}
            className={[
              s.detailPopover,
              detailPosition ? s.detailPositioned : '',
              detailPosition?.placement === 'above' ? s.detailAbove : s.detailBelow,
              activeDetail?.mode === 'pinned' ? s.detailPinned : s.detailTemporary,
            ].filter(Boolean).join(' ')}
            style={detailStyle}
            onPointerEnter={() => {
              if (activeDetail?.mode === 'temporary') cancelTemporaryClose();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'touch' || activeDetail?.mode !== 'temporary') return;
              const anchor = sealRefs.current.get(activeAchievement.id);
              if (anchor) hideTemporaryDetail(activeAchievement.id, anchor, true);
            }}
          >
            <SealDetail
              achievement={activeAchievement}
              pinned={activeDetail?.mode === 'pinned'}
              onClose={() => closeDetail()}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
