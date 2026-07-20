/**
 * 盲区星图 —— 命座式星宿图:一门课是一垣,一讲是一颗星。
 * 星位 = 六列蛇形骨架 + topicId 哈希抖动(确定性,刷新不漂移);
 * 星与星之间以星轨相连,两端皆出师的轨段点亮。
 * 节点五态仍由 MapNode.status 驱动,组件不新造任何学习状态;
 * 交互(onSelect/证据链/键盘序)与旧迷雾舆图完全同契约。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { STAR_LINKS } from '../../data/starLinks';
import type { StarLink } from '../../data/starLinks';
import type { Topic, TopicState } from '../../types';
import s from './growth.module.css';

export type NodeStatus = 'locked' | 'unlearned' | 'learning' | 'forgotten' | 'mastered';

export interface MapNode {
  topic: Topic;
  state: TopicState | null;
  status: NodeStatus;
}

interface CourseRealm {
  course: string;
  nodes: MapNode[];
}

interface StarPoint {
  x: number;
  y: number;
}

interface MeasuredStarLink extends StarLink {
  path: string;
  mid: StarPoint;
}

interface LinkOverlayLayout {
  width: number;
  height: number;
  links: MeasuredStarLink[];
}

const COLS = 6;
const VIEW_W = 720;
const COL_W = VIEW_W / COLS;
const ROW_H = 150;
/* 星心在行内的基准高度与抖动夹持区:夹在 [38,74] 保证
   本行星名(最多两行)不压到下一行的星芒 */
const STAR_BASE_Y = 56;
const STAR_MIN_Y = 38;
const STAR_MAX_Y = 74;
const STAR_MIN_X = 46;
const STAR_MAX_X = VIEW_W - 46;

const REALM_NUMS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌'];

/* 三垣星官题号:课名 → 真星官垣名(大楷)。命座考据是本项灵魂,
   缺表课程回退到 REALM_NUMS 泛称,不硬绑下标。 */
const REALM_ENCLOSURES: Record<string, string> = {
  大模型训练: '紫微',
  操作系统原理: '天市',
  Python程序设计: '太微',
  'Python 程序设计': '太微',
};

function enclosureOf(course: string, realmIndex: number): string {
  return REALM_ENCLOSURES[course] ?? `${REALM_NUMS[realmIndex] ?? String(realmIndex + 1)}`;
}

/* 天文星形:实心星核 + 四道长短不一的衍射芒(8 顶点星形多边形,
   四长芒沿正向、四短点在 45° 收腰)。viewBox -14..14 不动,只作为 .glyphStar 的 d。
   三变体按 topicId 哈希取样,让星野有肌理不复读同一 glyph。 */
const STAR_VARIANTS = [
  // 均衡芒
  'M11,0 L1.4,1.4 L0,11.5 L-1.4,1.4 L-11,0 L-1.4,-1.4 L0,-12 L1.4,-1.4 Z',
  // 竖长芒
  'M9,0 L1.3,1.3 L0,12 L-1.3,1.3 L-9,0 L-1.3,-1.3 L0,-12.5 L1.3,-1.3 Z',
  // 横展芒
  'M12.5,0 L1.5,1.5 L0,9.5 L-1.5,1.5 L-12,0 L-1.5,-1.5 L0,-9.5 L1.5,-1.5 Z',
] as const;

/* 星链连接度:一颗星在 STAR_LINKS 中被牵到的次数——牵得多者为星官主星,理应更亮更大。
   由真实策展星链派生(非手写会漂移的数),渲染间稳定。 */
const LINK_DEGREE = (() => {
  const map = new Map<string, number>();
  for (const link of STAR_LINKS) {
    map.set(link.a, (map.get(link.a) ?? 0) + 1);
    map.set(link.b, (map.get(link.b) ?? 0) + 1);
  }
  return map;
})();

/** 星等:主星(牵 ≥2 链)最亮、支线星(牵 1 链)居中、散场星(无链)最暗。
    返回缩放乘数,只作用于内层 .glyphStar 与 drop-shadow 辉光(经 --star-mag 下发)。 */
function starMagnitude(topicId: string): number {
  const degree = LINK_DEGREE.get(topicId) ?? 0;
  return degree >= 2 ? 1.16 : degree === 1 ? 1.02 : 0.9;
}

/** 星形变体:同一 topicId 永远同一形,刷新不漂移。 */
function starVariant(topicId: string): string {
  return STAR_VARIANTS[Math.floor(hash01(topicId, 3) * STAR_VARIANTS.length)] ?? STAR_VARIANTS[0];
}

const STATUS_TEXT: Record<NodeStatus, string> = {
  mastered: '星火已明',
  forgotten: '雾气回拢',
  learning: '星光渐起',
  unlearned: '迷雾未开',
  locked: '此星未开',
};

const STATUS_CLASS: Record<NodeStatus, string> = {
  mastered: s.starMastered,
  forgotten: s.starForgotten,
  learning: s.starLearning,
  unlearned: s.starUnlearned,
  locked: s.starLocked,
};

/* 未学/未开不再逐星复读状态字(36 颗"迷雾未开"是噪声);
   语义仍完整进 aria-label,视觉上由暗星形态 + 图例承担 */
const STATE_LINE_SHOWN: Record<NodeStatus, boolean> = {
  mastered: true,
  forgotten: true,
  learning: true,
  unlearned: false,
  locked: false,
};

/** 已开讲过的星(轨段"走过"判定用) */
const VISITED: Record<NodeStatus, boolean> = {
  mastered: true,
  forgotten: true,
  learning: true,
  unlearned: false,
  locked: false,
};

/** 按 TOPICS 原顺序分课程,垣与垣之间不连星轨。 */
function groupByCourse(nodes: MapNode[]): CourseRealm[] {
  const realms: CourseRealm[] = [];
  const realmByCourse = new Map<string, CourseRealm>();
  for (const node of nodes) {
    let realm = realmByCourse.get(node.topic.course);
    if (!realm) {
      realm = { course: node.topic.course, nodes: [] };
      realmByCourse.set(node.topic.course, realm);
      realms.push(realm);
    }
    realm.nodes.push(node);
  }
  return realms;
}

/** FNV-1a 变体 → [0,1):同一 topicId 的星位永远一致 */
function hash01(str: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 线性同余伪随机:铺底星尘用,种子取自垣序,渲染间稳定 */
function lcg(seed: number): () => number {
  let s = (seed * 9973 + 1) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 六列蛇形骨架(奇数行左→右,偶数行右→左,DOM/Tab 序即问学序),
 * 叠正弦起伏与哈希抖动,让星宿脱开网格感。
 */
function starPoint(index: number, topicId: string, realmIndex: number): StarPoint {
  const row = Math.floor(index / COLS);
  const offset = index % COLS;
  const column = row % 2 === 0 ? offset : COLS - 1 - offset;
  const jx = (hash01(topicId, 1) - 0.5) * 20;
  const jy = (hash01(topicId, 2) - 0.5) * 24;
  const wave = Math.sin(index * 2.1 + realmIndex * 1.7) * 8;
  return {
    x: clamp((column + 0.5) * COL_W + jx, STAR_MIN_X, STAR_MAX_X),
    y: row * ROW_H + clamp(STAR_BASE_Y + jy + wave, STAR_MIN_Y, STAR_MAX_Y),
  };
}

function realmRows(nodeCount: number): number {
  return Math.max(1, Math.ceil(nodeCount / COLS));
}

function nodeLabel(node: MapNode): string {
  const mastery = node.state ? `,掌握度 ${Math.round(node.state.mastery * 100)}%` : '';
  return `${node.topic.title},${STATUS_TEXT[node.status]}${mastery}`;
}

/** 轨段样式:两端皆出师=点亮;两端皆开过讲=实线;其余为微光虚线 */
function segmentKind(a: MapNode, b: MapNode): 'lit' | 'walked' | 'dim' {
  if (a.status === 'mastered' && b.status === 'mastered') return 'lit';
  if (VISITED[a.status] && VISITED[b.status]) return 'walked';
  return 'dim';
}

/** 只读 layout 坐标，不受 starSlot 入场动画的 transform 影响。 */
function centerWithin(element: HTMLElement, ancestor: HTMLElement): StarPoint | null {
  let x = element.offsetWidth / 2;
  let y = element.offsetHeight / 2;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
  }

  return current === ancestor ? { x, y } : null;
}

/** 星链弧路 + 札记落点:path 与旧版逐字节一致(几何冻结),另返二次贝塞尔 t=0.5 中点。 */
function curvedLink(from: StarPoint, to: StarPoint, index: number): { path: string; mid: StarPoint } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { path: `M ${from.x} ${from.y}`, mid: { x: from.x, y: from.y } };

  const bow = Math.min(48, Math.max(14, length * 0.075)) * (index % 2 === 0 ? 1 : -1);
  const controlX = (from.x + to.x) / 2 - (dy / length) * bow;
  const controlY = (from.y + to.y) / 2 + (dx / length) * bow;
  const round = (value: number) => Number(value.toFixed(1));
  // 二次贝塞尔中点 = 0.25·起 + 0.5·控 + 0.25·止,札记标签就落在这
  const mid = {
    x: round(0.25 * from.x + 0.5 * controlX + 0.25 * to.x),
    y: round(0.25 * from.y + 0.5 * controlY + 0.25 * to.y),
  };
  return {
    path: `M ${round(from.x)} ${round(from.y)} Q ${round(controlX)} ${round(controlY)} ${round(to.x)} ${round(to.y)}`,
    mid,
  };
}

function AmbientDust({ realmIndex, rows, points }: { realmIndex: number; rows: number; points: StarPoint[] }) {
  const rand = lcg(realmIndex + 1);
  const fieldH = rows * ROW_H;
  const count = rows * 16;
  const dots = Array.from({ length: count }, (_, i) => {
    // 六成星尘向星位聚拢(亮星附近密),四成铺散空场——夜空有疏密纵深
    const near = points.length > 0 && rand() < 0.6;
    if (near) {
      const anchor = points[Math.floor(rand() * points.length)];
      // 两个均匀分布相加近高斯:越靠星心越密
      const jx = (rand() + rand() - 1) * 30;
      const jy = (rand() + rand() - 1) * 30;
      return {
        key: i,
        cx: clamp(anchor.x + jx, 6, VIEW_W - 6),
        cy: clamp(anchor.y + jy, 6, fieldH - 6),
        r: 0.6 + rand() * 1.3,
        opacity: 0.14 + rand() * 0.24,
        delay: rand() * 5.2,
      };
    }
    return {
      key: i,
      cx: 12 + rand() * (VIEW_W - 24),
      cy: 8 + rand() * (fieldH - 16),
      r: 0.6 + rand() * 0.85,
      opacity: 0.07 + rand() * 0.16,
      delay: rand() * 5.2,
    };
  });
  return (
    <g>
      {dots.map((d) => (
        <circle
          key={d.key}
          className={s.dustStar}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          style={{ '--dust-o': d.opacity, animationDelay: `${-d.delay}s` } as CSSProperties}
        />
      ))}
    </g>
  );
}

export function KnowledgeMap({
  nodes, selectedId, onSelect, statusFocus = null, bridge = null,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
  /** 巡天筛选:聚焦某一态,其余星与连线视觉下沉(不卸载,量测/Tab 序不动)。 */
  statusFocus?: NodeStatus | null;
  /** 星图↔印章叙事桥:距《全谱》还差几星、已落印几枚(由 achievements 派生,防御式渲染)。 */
  bridge?: { toFull: number; seals: number } | null;
}) {
  const realms = groupByCourse(nodes);
  const chartRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [linkLayout, setLinkLayout] = useState<LinkOverlayLayout>({
    width: 0,
    height: 0,
    links: [],
  });
  const statusById = new Map(nodes.map((node) => [node.topic.topicId, node.status]));
  const activeIds = new Set(
    [selectedId, hoveredId, focusedId].filter((id): id is string => id !== null),
  );
  const linkedStarIds = new Set<string>();

  for (const link of STAR_LINKS) {
    if (!activeIds.has(link.a) && !activeIds.has(link.b)) continue;
    if (!activeIds.has(link.a)) linkedStarIds.add(link.a);
    if (!activeIds.has(link.b)) linkedStarIds.add(link.b);
  }

  // 巡天总览:满天星总数 / 已出师(点亮)/ 衰减(雾中)——一行真言,不做统计盘
  const totalStars = nodes.length;
  const litStars = nodes.filter((node) => node.status === 'mastered').length;
  const fogStars = nodes.filter((node) => node.status === 'forgotten').length;

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;

    let frame = 0;
    let disposed = false;
    const measure = () => {
      const centers = new Map<string, StarPoint>();
      const slots = chart.querySelectorAll<HTMLElement>('[data-star-id]');
      for (const slot of slots) {
        const starId = slot.dataset.starId;
        const anchor = slot.querySelector<HTMLElement>('[data-star-anchor]');
        if (!starId || !anchor) continue;
        const center = centerWithin(anchor, chart);
        if (center) centers.set(starId, center);
      }

      const links = STAR_LINKS.flatMap((link, index) => {
        const from = centers.get(link.a);
        const to = centers.get(link.b);
        if (!from || !to) return [];
        const { path, mid } = curvedLink(from, to, index);
        return [{ ...link, path, mid }];
      });
      if (!disposed) {
        setLinkLayout({ width: chart.clientWidth, height: chart.clientHeight, links });
      }
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(chart);
    void document.fonts.ready.then(() => {
      if (!disposed) scheduleMeasure();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [nodes]);

  return (
    <div className={s.starAtlas}>
      <div
        ref={chartRef}
        className={[s.skyChart, statusFocus ? s.skyFocused : ''].filter(Boolean).join(' ')}
        role="group"
        aria-label="盲区星图:按课程分垣,一讲一星"
      >
        <p className={s.skySurvey}>
          满天 <b>{totalStars}</b> 星 · 已点亮 <b>{litStars}</b> · 雾中 <b>{fogStars}</b>
          {bridge ? (
            <span className={s.skyBridge}>
              {bridge.toFull > 0 ? <>距《全谱》还差 <b>{bridge.toFull}</b> 星</> : <>《全谱》已成</>}
              {' · '}已落印 <b>{bridge.seals}</b> 枚
            </span>
          ) : null}
        </p>
        <svg
          className={s.crossLinkOverlay}
          width={linkLayout.width}
          height={linkLayout.height}
          aria-hidden="true"
          focusable="false"
        >
          {linkLayout.links.map((link) => {
            const highlighted = activeIds.has(link.a) || activeIds.has(link.b);
            const mastered = statusById.get(link.a) === 'mastered'
              && statusById.get(link.b) === 'mastered';
            const key = `${link.a}:${link.b}`;
            return (
              <g key={key}>
                {(mastered || highlighted) && (
                  <path
                    className={[
                      s.crossLinkGlow,
                      mastered ? s.crossLinkGlowMastered : '',
                      highlighted ? s.crossLinkGlowActive : '',
                    ].filter(Boolean).join(' ')}
                    d={link.path}
                  />
                )}
                <path
                  className={[
                    s.crossLink,
                    mastered ? s.crossLinkMastered : '',
                    highlighted ? s.crossLinkActive : '',
                  ].filter(Boolean).join(' ')}
                  d={link.path}
                />
                {/* 札记只在星链被点亮时显形,楷体小字;stroke 描一圈砚墨底托稳可读性 */}
                {highlighted && (
                  <text
                    className={s.crossLinkNote}
                    x={link.mid.x}
                    y={link.mid.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {link.note}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {realms.map((realm, realmIndex) => {
          const realmTitleId = `knowledge-realm-${realmIndex}`;
          const masteredCount = realm.nodes.filter((node) => node.status === 'mastered').length;
          const allLit = realm.nodes.length > 0 && masteredCount === realm.nodes.length;
          const rows = realmRows(realm.nodes.length);
          const points = realm.nodes.map((node, index) => (
            starPoint(index, node.topic.topicId, realmIndex)
          ));
          const fieldH = rows * ROW_H;

          return (
            <section key={realm.course} className={s.skyRealm} aria-labelledby={realmTitleId}>
              <header className={s.skyHead}>
                <span className={s.skyNo} aria-hidden="true">
                  <b className={s.skyNoChar}>{enclosureOf(realm.course, realmIndex)}</b>垣
                </span>
                <div>
                  <h3 id={realmTitleId} className={s.skyTitle}>《{realm.course}》</h3>
                  <p className={s.skySub}>
                    {realm.nodes.length} 处学问 · 已点亮 {masteredCount}/{realm.nodes.length}
                  </p>
                </div>
                {allLit
                  ? <span className={s.skyDone}>此垣星火已齐</span>
                  : <p className={s.skyHint}>沿星轨而行,点一颗星,看它的证据。</p>}
              </header>

              <div
                className={[s.skyField, [s.skyTintA, s.skyTintB, s.skyTintC][realmIndex % 3]].filter(Boolean).join(' ')}
                style={{ height: `${fieldH / 16}rem` }}
              >
                <svg
                  className={s.skyLines}
                  viewBox={`0 0 ${VIEW_W} ${fieldH}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <AmbientDust realmIndex={realmIndex} rows={rows} points={points} />
                  {realm.nodes.slice(1).map((node, index) => {
                    const kind = segmentKind(realm.nodes[index], node);
                    const from = points[index];
                    const to = points[index + 1];
                    return (
                      <g key={node.topic.topicId}>
                        {kind === 'lit' && (
                          <line
                            className={s.segGlow}
                            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                          />
                        )}
                        <line
                          className={kind === 'lit' ? s.segLit : kind === 'walked' ? s.segWalked : s.segDim}
                          x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                        />
                      </g>
                    );
                  })}
                </svg>

                <ol className={s.starList}>
                  {realm.nodes.map((node, index) => {
                    const point = points[index];
                    const locked = node.status === 'locked';
                    const selected = selectedId === node.topic.topicId;
                    // 星等由星链连接度派生,星形按 topicId 哈希取样(确定性,不漂移)
                    const magnitude = starMagnitude(node.topic.topicId);
                    const glyphD = starVariant(node.topic.topicId);
                    const slotStyle: CSSProperties = {
                      left: `${(point.x / VIEW_W) * 100}%`,
                      top: `${(point.y / fieldH) * 100}%`,
                      // 超长列表入场步进 45ms、封顶 300ms(R6),别让后排星星白屏半秒
                      animationDelay: `${Math.min(index * 45, 300)}ms`,
                    };

                    return (
                      <li
                        key={node.topic.topicId}
                        className={s.starSlot}
                        style={slotStyle}
                        data-star-id={node.topic.topicId}
                      >
                        <button
                          type="button"
                          className={[
                            s.starBtn,
                            STATUS_CLASS[node.status],
                            selected ? s.starSelected : '',
                            linkedStarIds.has(node.topic.topicId) ? s.starLinked : '',
                            statusFocus && node.status !== statusFocus ? s.starDimmed : '',
                          ].filter(Boolean).join(' ')}
                          disabled={locked}
                          aria-label={nodeLabel(node)}
                          aria-pressed={locked ? undefined : selected}
                          onClick={() => onSelect(node.topic.topicId)}
                          onMouseEnter={() => setHoveredId(node.topic.topicId)}
                          onMouseLeave={() => setHoveredId((current) => (
                            current === node.topic.topicId ? null : current
                          ))}
                          onFocus={() => setFocusedId(node.topic.topicId)}
                          onBlur={() => setFocusedId((current) => (
                            current === node.topic.topicId ? null : current
                          ))}
                        >
                          <span className={s.starFog} aria-hidden="true" />
                          <span
                            className={s.starGlyph}
                            data-star-anchor
                            aria-hidden="true"
                            style={locked ? undefined : ({ '--star-mag': magnitude } as CSSProperties)}
                          >
                            <svg viewBox="-14 -14 28 28" focusable="false">
                              <circle className={s.glyphRing} r="11.5" />
                              <path className={s.glyphStar} d={glyphD} />
                            </svg>
                            <span className={s.starOrder}>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                          </span>
                          <span className={s.starName}>{node.topic.title}</span>
                          {STATE_LINE_SHOWN[node.status] && (
                            <span className={s.starState}>{STATUS_TEXT[node.status]}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
