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

/* 四芒星芒(sparkle):viewBox -14..14,由 CSS 按状态上色/缩放 */
const STAR_PATH =
  'M0,-11 C1.2,-3.6 3.6,-1.2 11,0 C3.6,1.2 1.2,3.6 0,11 C-1.2,3.6 -3.6,1.2 -11,0 C-3.6,-1.2 -1.2,-3.6 0,-11 Z';

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

function curvedLinkPath(from: StarPoint, to: StarPoint, index: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `M ${from.x} ${from.y}`;

  const bow = Math.min(48, Math.max(14, length * 0.075)) * (index % 2 === 0 ? 1 : -1);
  const controlX = (from.x + to.x) / 2 - (dy / length) * bow;
  const controlY = (from.y + to.y) / 2 + (dx / length) * bow;
  const round = (value: number) => Number(value.toFixed(1));
  return `M ${round(from.x)} ${round(from.y)} Q ${round(controlX)} ${round(controlY)} ${round(to.x)} ${round(to.y)}`;
}

function AmbientDust({ realmIndex, rows }: { realmIndex: number; rows: number }) {
  const rand = lcg(realmIndex + 1);
  const count = rows * 16;
  const dots = Array.from({ length: count }, (_, i) => ({
    key: i,
    cx: 12 + rand() * (VIEW_W - 24),
    cy: 8 + rand() * (rows * ROW_H - 16),
    r: 0.7 + rand() * 1.1,
    opacity: 0.1 + rand() * 0.22,
    delay: rand() * 5.2,
  }));
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
  nodes, selectedId, onSelect,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
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
        return from && to ? [{ ...link, path: curvedLinkPath(from, to, index) }] : [];
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
      <div ref={chartRef} className={s.skyChart} role="group" aria-label="盲区星图:按课程分垣,一讲一星">
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
                  {REALM_NUMS[realmIndex] ?? String(realmIndex + 1)}垣
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

              <div className={s.skyField} style={{ height: `${fieldH / 16}rem` }}>
                <svg
                  className={s.skyLines}
                  viewBox={`0 0 ${VIEW_W} ${fieldH}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <AmbientDust realmIndex={realmIndex} rows={rows} />
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
                          <span className={s.starGlyph} data-star-anchor aria-hidden="true">
                            <svg viewBox="-14 -14 28 28" focusable="false">
                              <circle className={s.glyphRing} r="11.5" />
                              <path className={s.glyphStar} d={STAR_PATH} />
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
