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
  return realms.map((realm) => {
    const sameTitle = realms.filter((candidate) => candidate.course === realm.course);
    if (sameTitle.length <= 1) return realm;
    if (!realm.key.startsWith('custom:')) return { ...realm, course: `${realm.course} · 内置` };
    const index = sameTitle.filter((candidate) => candidate.key.startsWith('custom:')).findIndex((candidate) => candidate.key === realm.key) + 1;
    return { ...realm, course: `${realm.course} · 自选 ${index}` };
  });
}

export const ORBIT_RINGS = [
  { rx: 285, ry: 115, tilt: -0.42 },
  { rx: 360, ry: 152, tilt: 0.33 },
  { rx: 405, ry: 190, tilt: -0.12 },
] as const;

export function orbitalPoint(ringIndex: number, angle: number, compact = false): SeaPoint {
  const ring = ORBIT_RINGS[ringIndex % ORBIT_RINGS.length];
  const x = Math.cos(angle) * ring.rx;
  const y = Math.sin(angle) * ring.ry * (compact ? 1.1 : 1);
  const tilt = compact ? ring.tilt * 0.45 : ring.tilt;
  return {
    x: SEA_WIDTH * 0.5 + x * Math.cos(tilt) - y * Math.sin(tilt),
    y: SEA_HEIGHT * 0.52 + x * Math.sin(tilt) + y * Math.cos(tilt),
  };
}

export function layoutSea(
  nodes: MapNode[],
  focused: boolean,
  compact: boolean,
  selectedId: string | null = null,
): Map<string, SeaPoint> {
  const points = new Map<string, SeaPoint>();
  const ringCount = Math.min(3, Math.max(1, Math.ceil(nodes.length / 12)));
  nodes.forEach((node, index) => {
    const ring = index % ringCount;
    const count = Math.ceil((nodes.length - ring) / ringCount);
    const angle = Math.floor(index / ringCount) / count * Math.PI * 2 + ring * 0.83 + (focused ? 0.2 : 0);
    const point = orbitalPoint(ring, angle, compact);
    points.set(node.topic.topicId, selectedId ? { x: point.x, y: point.y * 0.62 + 22 } : point);
  });
  if (selectedId && points.has(selectedId)) {
    points.set(selectedId, { x: compact ? 650 : 720, y: 190 });
    const links = activeStarLinks(selectedId, points);
    const linked = links.map((link) => link.a === selectedId ? link.b : link.a);
    linked.forEach((id, index) => points.set(id, {
      x: [440, 810, 630][index], y: [125, 95, 305][index],
    }));
  }
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

/** 平时公转角速度（弧度/秒）。全体相同。拖动地球时会暂时加快，再降回这个速度。 */
export const SATELLITE_SPEED = 0.05;

/** 拖动地球时卫星沿轨道冲刺的角速度，全体相同。 */
export const SATELLITE_BURST_SPEED = 1.45;

/** 俯仰压扁轨道，使三圈椭圆的横纵比例接近参考图。 */
export const ORBIT_VIEW_PITCH = 0.5;

export interface SatelliteOrbit {
  radius: number;
  tilt: number;
  node: number;
  phase: number;
}

const ORBIT_LANES = 3;

/** 三圈拉开的椭圆，多颗卫星共用一条。间距对应参考图：贴着地球、中间一圈、靠外缘一圈。 */
export function satelliteOrbit(id: string, index: number, count: number): SatelliteOrbit {
  const lane = index % ORBIT_LANES;
  const seat = Math.floor(index / ORBIT_LANES);
  const seats = Math.max(1, Math.ceil(count / ORBIT_LANES));
  return {
    radius: lane / (ORBIT_LANES - 1),
    tilt: 0.16,
    node: 0.22 + lane * 0.48,
    phase: (seat / seats) * Math.PI * 2 + hash01(id, 31) * 0.2,
  };
}

export function orbitLaneKey(orbit: SatelliteOrbit): string {
  return `${orbit.radius.toFixed(4)}:${orbit.tilt.toFixed(4)}:${orbit.node.toFixed(4)}`;
}

/** 单位轨道上某个真近点角的位置。观看俯仰固定，不跟地球拖动耦合。 */
export function orbitVector(
  orbit: SatelliteOrbit,
  angle: number,
): { x: number; y: number; z: number } {
  const x0 = Math.cos(angle);
  const z0 = Math.sin(angle);
  const y = -Math.sin(orbit.tilt) * z0;
  const z1 = Math.cos(orbit.tilt) * z0;
  const nodeC = Math.cos(orbit.node);
  const nodeS = Math.sin(orbit.node);
  const x = x0 * nodeC + z1 * nodeS;
  const z = -x0 * nodeS + z1 * nodeC;
  const cp = Math.cos(ORBIT_VIEW_PITCH);
  const sp = Math.sin(ORBIT_VIEW_PITCH);
  return {
    x,
    y: y * cp - z * sp,
    z: y * sp + z * cp,
  };
}

/** 单位轨道上的位置。angleRad 是全体卫星共用的公转角。 */
export function satelliteVector(
  orbit: SatelliteOrbit,
  angleRad: number,
): { x: number; y: number; z: number } {
  return orbitVector(orbit, orbit.phase + angleRad);
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
