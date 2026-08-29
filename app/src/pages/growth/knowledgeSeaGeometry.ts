import { STAR_LINKS } from '../../data/starLinks';
import type { StarLink } from '../../data/starLinks';
import type { MapNode, NodeStatus } from './KnowledgeMap';
import { topicCourseKey } from '../../data/runtimeTopics';

export interface SeaPoint {
  x: number;
  y: number;
}

export type LabelSide = 'below' | 'above' | 'left' | 'right';

export interface CourseRealm {
  key: string;
  course: string;
  nodes: MapNode[];
}

export interface SkyStar {
  x: number;
  y: number;
  z: number;
  mag: number;
  size: number;
  opacity: number;
  twinkle: number;
  phase: number;
  tint: 0 | 1 | 2 | 3;
}

export const SEA_WIDTH = 960;
export const SEA_HEIGHT = 600;

const STATUS_WEIGHT: Record<NodeStatus, number> = {
  forgotten: 84,
  learning: 76,
  mastered: 68,
  unlearned: 18,
  locked: 0,
};

const LINK_DEGREE = STAR_LINKS.reduce((degrees, link) => {
  degrees.set(link.a, (degrees.get(link.a) ?? 0) + 1);
  degrees.set(link.b, (degrees.get(link.b) ?? 0) + 1);
  return degrees;
}, new Map<string, number>());

function hash01(value: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

export function groupByCourse(nodes: MapNode[]): CourseRealm[] {
  const realms: CourseRealm[] = [];
  const realmByCourse = new Map<string, CourseRealm>();
  for (const node of nodes) {
    const key = topicCourseKey(node.topic);
    const current = realmByCourse.get(key);
    if (current) {
      current.nodes.push(node);
      continue;
    }
    const realm = { key, course: node.topic.course, nodes: [node] };
    realmByCourse.set(key, realm);
    realms.push(realm);
  }
  return realms;
}

function columnsFor(nodeCount: number, focused: boolean, compact: boolean): number {
  if (!focused) return 7;
  if (compact) return Math.max(3, Math.min(5, Math.ceil(Math.sqrt(nodeCount))));
  return Math.max(3, Math.min(7, Math.ceil(Math.sqrt(nodeCount * 1.5))));
}

export function layoutSea(
  nodes: MapNode[],
  focused: boolean,
  compact: boolean,
): Map<string, SeaPoint> {
  const columns = columnsFor(nodes.length, focused, compact);
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const left = focused ? 168 : 68;
  const right = SEA_WIDTH - left;
  const top = focused ? 172 : 150;
  const bottom = SEA_HEIGHT - 74;
  const stepX = columns === 1 ? 0 : (right - left) / (columns - 1);
  const stepY = rows === 1 ? 0 : (bottom - top) / (rows - 1);
  const points = new Map<string, SeaPoint>();

  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const offset = index % columns;
    const column = row % 2 === 0 ? offset : columns - 1 - offset;
    const xJitter = compact ? 0 : (hash01(node.topic.topicId, 11) - 0.5) * (focused ? 34 : 26);
    const yJitter = compact ? 0 : (hash01(node.topic.topicId, 17) - 0.5) * (focused ? 30 : 22);
    const wave = compact ? 0 : Math.sin(index * 1.67) * (focused ? 14 : 9);
    points.set(node.topic.topicId, {
      x: Math.max(42, Math.min(SEA_WIDTH - 42, left + column * stepX + xJitter)),
      y: Math.max(124, Math.min(SEA_HEIGHT - 42, top + row * stepY + yJitter + wave)),
    });
  });
  return points;
}

/* 题签落位:边缘星往内侧挂;中场星按序号奇偶上下交错,同一行相邻主星的题签不再撞在一起。
   首行(y ≤ 200)不往上挂,免得压到课程名。 */
export function labelSideFor(point: SeaPoint, index = 0): LabelSide {
  if (point.y > SEA_HEIGHT - 118) return 'above';
  if (point.x > SEA_WIDTH - 150) return 'left';
  if (point.x < 150) return 'right';
  if (point.y > 200 && index % 2 === 1) return 'above';
  return 'below';
}

export function courseLabelPoint(
  realm: CourseRealm,
  points: Map<string, SeaPoint>,
  realmIndex: number,
  realmCount: number,
): SeaPoint {
  if (realmCount > 1) {
    return {
      x: (SEA_WIDTH / (realmCount + 1)) * (realmIndex + 1),
      y: 72,
    };
  }
  const available = realm.nodes.flatMap((node) => {
    const point = points.get(node.topic.topicId);
    return point ? [point] : [];
  });
  if (available.length === 0) return { x: SEA_WIDTH / 2, y: 72 };
  const x = available.reduce((sum, point) => sum + point.x, 0) / available.length;
  const top = Math.min(...available.map((point) => point.y));
  return { x, y: Math.max(72, top - 56) };
}

export function featuredStarIds(
  nodes: MapNode[],
  realms: CourseRealm[],
  activeIds: Array<string | null>,
  limit: number,
): Set<string> {
  const leads = new Set(realms.flatMap((realm) => {
    const lead = realm.nodes.find((node) => node.status !== 'locked') ?? realm.nodes[0];
    return lead ? [lead.topic.topicId] : [];
  }));
  const active = new Set(activeIds.filter((id): id is string => id !== null));
  const ranked = [...nodes].sort((left, right) => {
    const score = (node: MapNode) => (
      (active.has(node.topic.topicId) ? 1000 : 0)
      + STATUS_WEIGHT[node.status]
      + (leads.has(node.topic.topicId) ? 46 : 0)
      + (LINK_DEGREE.get(node.topic.topicId) ?? 0) * 8
    );
    return score(right) - score(left);
  });
  return new Set(ranked.slice(0, Math.max(limit, active.size)).map((node) => node.topic.topicId));
}

export function activeStarLinks(
  activeId: string | null,
  points: Map<string, SeaPoint>,
): StarLink[] {
  if (!activeId) return [];
  return STAR_LINKS
    .filter((link) => link.a === activeId || link.b === activeId)
    .filter((link) => points.has(link.a) && points.has(link.b))
    .slice(0, 3);
}

export type DockCorner = 'left' | 'right';

export function pickDockCorner(
  selectedId: string | null,
  points: Map<string, SeaPoint>,
): DockCorner {
  if (!selectedId) return 'left';
  const point = points.get(selectedId);
  if (!point) return 'left';
  return point.x < SEA_WIDTH / 2 ? 'right' : 'left';
}

export function linkPath(from: SeaPoint, to: SeaPoint): string {
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function spectralTint(roll: number): SkyStar['tint'] {
  if (roll < 0.11) return 1;
  if (roll < 0.16) return 2;
  if (roll < 0.22) return 3;
  return 0;
}

function rotateGalactic(x: number, y: number, z: number, tilt: number, spin: number) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const y2 = y * ct - z * st;
  const z2 = y * st + z * ct;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  return {
    x: x * cs - z2 * ss,
    y: y2,
    z: x * ss + z2 * cs,
  };
}

export function seedSkyStars(count: number): SkyStar[] {
  const total = Math.max(80, Math.min(1800, Math.round(count)));
  return Array.from({ length: total }, (_, index) => {
    const y = 1 - (index / Math.max(1, total - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * index + hash01(`sky-j-${index}`, 2) * 0.08;
    const mag = Math.pow(hash01(`sky-m-${index}`, 11), 0.58) * 6.4;
    return {
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      mag,
      size: Math.max(0.22, 2.35 * Math.pow(10, -0.17 * mag)),
      opacity: Math.max(0.1, 1.02 * Math.pow(10, -0.13 * mag)),
      twinkle: 0.00045 + hash01(`sky-w-${index}`, 17) * 0.0018,
      phase: hash01(`sky-p-${index}`, 19) * Math.PI * 2,
      tint: spectralTint(hash01(`sky-t-${index}`, 53)),
    };
  });
}

export function seedMilkyWay(count: number): SkyStar[] {
  const total = Math.max(48, Math.min(1100, Math.round(count)));
  return Array.from({ length: total }, (_, index) => {
    const lon = hash01(`mw-l-${index}`, 3) * Math.PI * 2;
    const lat = (hash01(`mw-b-${index}`, 5) - 0.5) * 0.42;
    const local = {
      x: Math.cos(lat) * Math.sin(lon),
      y: Math.sin(lat),
      z: Math.cos(lat) * Math.cos(lon),
    };
    const rotated = rotateGalactic(local.x, local.y, local.z, 0.51, 0.84);
    const mag = 4.1 + hash01(`mw-m-${index}`, 11) * 2.2;
    return {
      ...rotated,
      mag,
      size: 0.22 + hash01(`mw-s-${index}`, 13) * 0.55,
      opacity: 0.07 + hash01(`mw-o-${index}`, 17) * 0.16,
      twinkle: 0.0003 + hash01(`mw-w-${index}`, 19) * 0.001,
      phase: hash01(`mw-p-${index}`, 23) * Math.PI * 2,
      tint: 0,
    };
  });
}
