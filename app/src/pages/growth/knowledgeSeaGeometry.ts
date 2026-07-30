import { STAR_LINKS } from '../../data/starLinks';
import type { StarLink } from '../../data/starLinks';
import type { MapNode, NodeStatus } from './KnowledgeMap';

export interface SeaPoint {
  x: number;
  y: number;
}

export interface CourseRealm {
  course: string;
  nodes: MapNode[];
}

export interface DecorativeStar extends SeaPoint {
  size: number;
  opacity: number;
  delay: number;
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
    const current = realmByCourse.get(node.topic.course);
    if (current) {
      current.nodes.push(node);
      continue;
    }
    const realm = { course: node.topic.course, nodes: [node] };
    realmByCourse.set(node.topic.course, realm);
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

export function courseLabelPoint(
  realm: CourseRealm,
  points: Map<string, SeaPoint>,
  realmIndex: number,
  realmCount: number,
): SeaPoint {
  if (realmCount > 1) {
    return {
      x: (SEA_WIDTH / (realmCount + 1)) * (realmIndex + 1),
      y: 104,
    };
  }
  const available = realm.nodes.flatMap((node) => {
    const point = points.get(node.topic.topicId);
    return point ? [point] : [];
  });
  if (available.length === 0) return { x: SEA_WIDTH / 2, y: 118 };
  const x = available.reduce((sum, point) => sum + point.x, 0) / available.length;
  const top = Math.min(...available.map((point) => point.y));
  return { x, y: Math.max(104, top - 44) };
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

export function curvedPath(from: SeaPoint, to: SeaPoint, index: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bow = Math.min(42, Math.max(18, length * 0.09)) * (index % 2 === 0 ? 1 : -1);
  const controlX = (from.x + to.x) / 2 - (dy / length) * bow;
  const controlY = (from.y + to.y) / 2 + (dx / length) * bow;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export const DECORATIVE_STARS: DecorativeStar[] = Array.from({ length: 28 }, (_, index) => ({
  x: 28 + hash01(`decor-x-${index}`, 23) * (SEA_WIDTH - 56),
  y: 104 + hash01(`decor-y-${index}`, 29) * (SEA_HEIGHT - 136),
  size: 3 + hash01(`decor-s-${index}`, 31) * 5,
  opacity: 0.07 + hash01(`decor-o-${index}`, 37) * 0.11,
  delay: hash01(`decor-d-${index}`, 41) * 6,
}));
