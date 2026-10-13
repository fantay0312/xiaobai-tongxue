import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import starGlyphUrl from '../../assets/knowledge-star.svg';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { MapNode, NodeStatus } from './KnowledgeMap';
import { EarthGlobe, type EarthMotion } from './EarthGlobe';
import {
  SEA_HEIGHT,
  SEA_WIDTH,
  activeStarLinks,
  courseLabelPoint,
  featuredStarIds,
  groupByCourse,
  labelSideFor,
  layoutSea,
  linkPath,
  ORBIT_VIEW_PITCH,
  SATELLITE_BURST_SPEED,
  SATELLITE_SPEED,
  orbitLaneKey,
  orbitVector,
  satelliteOrbit,
  satelliteVector,
  type SatelliteOrbit,
  type SeaPoint,
} from './knowledgeSeaGeometry';
import { StarSkyCanvas } from './StarSkyCanvas';
import s from './KnowledgeSeaField.module.css';

function label(node: MapNode): string {
  const status: Record<NodeStatus, string> = {
    mastered: '星火已明',
    forgotten: '雾气回拢',
    learning: '星光渐起',
    unlearned: '尚未开讲',
    locked: '此星未开',
  };
  const mastery = node.state ? `，掌握度 ${Math.round(node.state.mastery * 100)}%` : '';
  return `${node.topic.course}，${node.topic.title}，${status[node.status]}${mastery}`;
}

function neighborIds(
  links: ReturnType<typeof activeStarLinks>,
  activeId: string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const link of links) {
    if (link.a !== activeId) ids.add(link.a);
    if (link.b !== activeId) ids.add(link.b);
  }
  return ids;
}

function directionalTarget(
  key: string,
  currentId: string,
  ids: string[],
  points: ReturnType<typeof layoutSea>,
): string | null {
  const current = points.get(currentId);
  if (!current) return null;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const candidates = ids.flatMap((id) => {
    const point = points.get(id);
    if (!point || id === currentId) return [];
    const primary = horizontal ? point.x - current.x : point.y - current.y;
    if (primary * sign <= 0) return [];
    const cross = horizontal ? point.y - current.y : point.x - current.x;
    return [{ id, score: Math.abs(primary) + Math.abs(cross) * 2.2 }];
  });
  candidates.sort((left, right) => left.score - right.score);
  return candidates[0]?.id ?? null;
}

export function KnowledgeSeaField({
  nodes,
  selectedId,
  statusFocus,
  compact,
  focusedCourse,
  onSelect,
  points: pointsProp,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  statusFocus: NodeStatus | null;
  compact: boolean;
  focusedCourse: boolean;
  onSelect: (topicId: string) => void;
  points?: Map<string, SeaPoint>;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const orbitBackRef = useRef<SVGSVGElement>(null);
  const orbitFrontRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const slotRefs = useRef(new Map<string, HTMLLIElement>());
  const livePoints = useRef(new Map<string, SeaPoint>());
  const orbitClock = useRef(0);
  const orbitSpeed = useRef(SATELLITE_SPEED);
  const poseRef = useRef(new Map<string, { x: number; y: number; opacity: number }>());
  const dtRef = useRef(0);
  const earthDragRef = useRef(false);
  const focusRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const motionRef = useRef<EarthMotion>({ yaw: 0.35, pitch: 0.2, spin: 0.4 });
  const realms = useMemo(() => groupByCourse(nodes), [nodes]);
  const points = useMemo(
    () => pointsProp ?? layoutSea(nodes, focusedCourse, compact),
    [compact, focusedCourse, nodes, pointsProp],
  );
  const activeId = hoveredId ?? focusedId ?? selectedId;
  const links = useMemo(() => activeStarLinks(activeId, points), [activeId, points]);
  const neighbors = useMemo(() => neighborIds(links, activeId), [activeId, links]);
  const featured = useMemo(
    () => featuredStarIds(nodes, realms, [selectedId, hoveredId, focusedId], compact ? 4 : 6),
    [compact, focusedId, hoveredId, nodes, realms, selectedId],
  );
  const accessible = useMemo(
    () => nodes.filter((node) => node.status !== 'locked').map((node) => node.topic.topicId),
    [nodes],
  );
  const orbits = useMemo(() => {
    const map = new Map<string, ReturnType<typeof satelliteOrbit>>();
    nodes.forEach((node, index) => {
      map.set(node.topic.topicId, satelliteOrbit(node.topic.topicId, index, nodes.length));
    });
    return map;
  }, [nodes]);
  const orbitLanes = useMemo(() => {
    const lanes = new Map<string, ReturnType<typeof satelliteOrbit>>();
    orbits.forEach((orbit) => {
      const key = orbitLaneKey(orbit);
      if (!lanes.has(key)) lanes.set(key, orbit);
    });
    return [...lanes.entries()];
  }, [orbits]);
  const keepouts = useMemo(
    () => nodes.map(() => ({ x: SEA_WIDTH / 2, y: SEA_HEIGHT / 2 })),
    [nodes],
  );
  const placeRef = useRef<(time: number) => void>(() => {});
  placeRef.current = (time: number) => {
    const field = fieldRef.current;
    const earth = field?.querySelector<HTMLElement>(`.${s.earth}`);
    if (!field || !earth) return;
    const fieldBox = field.getBoundingClientRect();
    if (fieldBox.width < 2 || fieldBox.height < 2) return;
    const ease = focusRef.current * focusRef.current * (3 - 2 * focusRef.current);
    const narrow = fieldBox.height > fieldBox.width * 1.05;
    const idleR = Math.min(fieldBox.width * 0.15, 124);
    const horizonR = narrow
      ? fieldBox.width * 1.7
      : Math.max(fieldBox.width * 1.12, fieldBox.height * 1.5);
    const peak = fieldBox.height * (narrow ? 0.8 : 0.73);
    const horizonEx = fieldBox.width * (narrow ? 0.58 : 0.7);
    const horizonEy = peak + horizonR;
    const idleCx = fieldBox.width / 2;
    const idleCy = fieldBox.height / 2;
    const earthX = idleCx + (horizonEx - idleCx) * ease;
    const earthY = idleCy + (horizonEy - idleCy) * ease;
    const earthR = idleR + (horizonR - idleR) * ease;
    earth.style.left = `${earthX}px`;
    earth.style.top = `${earthY}px`;
    earth.style.width = `${earthR * 2}px`;
    earth.style.height = `${earthR * 2}px`;
    earth.style.setProperty('--horizon', ease.toFixed(3));
    earth.style.pointerEvents = ease > 0.22 ? 'none' : '';

    const minR = idleR + 52;
    const edge = 32;
    const outerX = Math.min(idleCx, fieldBox.width - idleCx) - edge;
    const outerY = (Math.min(idleCy, fieldBox.height - idleCy) - 40) / Math.sin(ORBIT_VIEW_PITCH);
    const outer = Math.max(minR + 120, Math.min(outerX, outerY));
    const dock = document.getElementById('knowledge-evidence')?.getBoundingClientRect();
    const labelPad = 164;
    let openL = 56;
    let openR = fieldBox.width - 56;
    if (dock && dock.width > 8 && dock.height > 8) {
      const dockL = dock.left - fieldBox.left;
      const dockR = dock.right - fieldBox.left;
      if (dockL + dock.width / 2 < fieldBox.width / 2) openL = Math.max(openL, dockR + labelPad);
      else openR = Math.min(openR, dockL - labelPad);
    } else {
      const dockRight = field.parentElement?.dataset.corner === 'right';
      const reserve = narrow ? 0 : Math.min(320, fieldBox.width * 0.38);
      if (dockRight) openR -= reserve;
      else openL += reserve;
    }
    if (openR - openL < 140) {
      openL = 56;
      openR = fieldBox.width - 56;
    }
    const picked = selectedIdRef.current;
    const chosen = new Set<string>();
    if (picked) {
      chosen.add(picked);
      for (const link of activeStarLinks(picked, points)) {
        chosen.add(link.a);
        chosen.add(link.b);
      }
    }
    const flank = [...chosen].filter((id) => id !== picked);
    const ordered = !picked
      ? []
      : flank.length === 0
        ? [picked]
        : flank.length === 1
          ? [flank[0], picked]
          : [flank[0], picked, ...flank.slice(1)];
    const slots = new Map<string, { x: number; y: number }>();
    ordered.forEach((id, order) => {
      const spread = Math.max(1, ordered.length - 1);
      const t = ordered.length === 1 ? 0.5 : order / spread;
      const x = openL + t * Math.max(0, openR - openL);
      const limbDx = x - horizonEx;
      const inside = horizonR * horizonR - limbDx * limbDx;
      const limb = inside > 0 ? horizonEy - Math.sqrt(inside) : fieldBox.height;
      const y = Math.max(56, Math.min(fieldBox.height * (id === picked ? 0.34 : 0.22), limb - 78));
      slots.set(id, { x, y });
    });

    const project = (local: { x: number; y: number; z: number }, orbit: SatelliteOrbit) => {
      const dist = minR + orbit.radius * (outer - minR);
      return {
        x: idleCx + local.x * dist,
        y: idleCy - local.y * dist,
        z: local.z,
      };
    };
    const toSea = (px: number, py: number): SeaPoint => ({
      x: (px / fieldBox.width) * SEA_WIDTH,
      y: (py / fieldBox.height) * SEA_HEIGHT,
    });

    nodes.forEach((node, index) => {
      const id = node.topic.topicId;
      const orbit = orbits.get(id);
      const slot = slotRefs.current.get(id);
      if (!orbit || !slot) return;
      const local = satelliteVector(orbit, time);
      const idle = project(local, orbit);
      const sky = slots.get(id);
      const pulled = sky !== undefined && ease > 0;
      const targetX = sky ? idle.x + (sky.x - idle.x) * ease : idle.x;
      const targetY = sky ? idle.y + (sky.y - idle.y) * ease : idle.y;
      const opacityTarget = pulled ? 1 : Math.max(0, 1 - ease * 1.35);
      let pose = poseRef.current.get(id);
      const gap = pose ? Math.hypot(pose.x - targetX, pose.y - targetY) : 0;
      const glide = dtRef.current > 0 && ease > 0.85 && gap > 4;
      if (!pose || !glide) {
        pose = { x: targetX, y: targetY, opacity: opacityTarget };
      } else {
        const follow = 1 - Math.exp(-7 * dtRef.current);
        pose.x += (targetX - pose.x) * follow;
        pose.y += (targetY - pose.y) * follow;
        pose.opacity += (opacityTarget - pose.opacity) * follow;
      }
      poseRef.current.set(id, pose);
      const point = toSea(pose.x, pose.y);
      livePoints.current.set(id, point);
      const hole = keepouts[index];
      if (hole) {
        hole.x = point.x;
        hole.y = point.y;
      }
      const scale = Math.max(0.8, Math.min(1.08, 0.9 + local.z * 0.12));
      const dx = point.x - SEA_WIDTH / 2;
      const dy = point.y - SEA_HEIGHT / 2;
      slot.style.left = `${(pose.x / fieldBox.width) * 100}%`;
      slot.style.top = `${(pose.y / fieldBox.height) * 100}%`;
      slot.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      slot.style.zIndex = pulled || local.z >= 0 ? '7' : '3';
      slot.style.opacity = pose.opacity.toFixed(3);
      slot.style.pointerEvents = pose.opacity < 0.4 && !pulled ? 'none' : '';
      slot.dataset.label = Math.abs(dx) > Math.abs(dy)
        ? (dx >= 0 ? 'right' : 'left')
        : (dy >= 0 ? 'below' : 'above');
    });

    const lanes = new Map(orbitLanes);
    const paintOrbits = (svg: SVGSVGElement | null, front: boolean) => {
      if (!svg) return;
      svg.style.opacity = String(Math.max(0, 1 - ease));
      for (const path of svg.querySelectorAll<SVGPathElement>('[data-orbit]')) {
        const orbit = lanes.get(path.dataset.orbit ?? '');
        if (!orbit) continue;
        let d = '';
        let pen = false;
        for (let step = 0; step <= 56; step += 1) {
          const local = orbitVector(orbit, (step / 56) * Math.PI * 2);
          if ((local.z >= 0) !== front) {
            pen = false;
            continue;
          }
          const at = project(local, orbit);
          const sea = toSea(at.x, at.y);
          d += `${pen ? 'L' : 'M'}${sea.x.toFixed(1)} ${sea.y.toFixed(1)}`;
          pen = true;
        }
        path.setAttribute('d', d);
      }
    };
    paintOrbits(orbitBackRef.current, false);
    paintOrbits(orbitFrontRef.current, true);

    field.querySelectorAll<HTMLElement>(`.${s.courseMarker}`).forEach((marker) => {
      marker.style.opacity = String(1 - ease * 0.82);
    });

    const svg = svgRef.current;
    if (!svg) return;
    for (const group of svg.querySelectorAll<SVGGElement>('[data-link]')) {
      const spec = group.dataset.link ?? '';
      const splitAt = spec.indexOf(':');
      if (splitAt < 0) continue;
      const from = livePoints.current.get(spec.slice(0, splitAt));
      const to = livePoints.current.get(spec.slice(splitAt + 1));
      if (!from || !to) continue;
      const d = linkPath(from, to);
      for (const path of group.querySelectorAll('path')) path.setAttribute('d', d);
    }
  };

  useLayoutEffect(() => {
    placeRef.current(reduced ? 0 : orbitClock.current);
  }, [nodes, orbits, reduced]);

  useEffect(() => {
    let raf = 0;
    let visible = true;
    let last = performance.now();
    const loop = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const goal = selectedIdRef.current ? 1 : 0;
      if (reduced) focusRef.current = goal;
      else {
        focusRef.current += (goal - focusRef.current) * (1 - Math.exp(-4.2 * dt));
        if (Math.abs(goal - focusRef.current) < 0.001) focusRef.current = goal;
        const targetSpeed = earthDragRef.current ? SATELLITE_BURST_SPEED : SATELLITE_SPEED;
        const easeRate = earthDragRef.current ? 7 : 1.25;
        orbitSpeed.current += (targetSpeed - orbitSpeed.current) * (1 - Math.exp(-easeRate * dt));
        if (!selectedIdRef.current) orbitClock.current += orbitSpeed.current * dt;
      }
      dtRef.current = reduced ? 0 : dt;
      placeRef.current(reduced ? 0 : orbitClock.current);
      raf = window.requestAnimationFrame(loop);
    };
    const resume = () => {
      if (raf || !visible || document.hidden) return;
      raf = window.requestAnimationFrame(loop);
    };
    const field = fieldRef.current;
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) resume();
      else if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.04 });
    if (field) io.observe(field);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', resume);
    };
  }, [reduced]);

  useEffect(() => {
    if (rovingId && accessible.includes(rovingId)) return;
    setRovingId(selectedId && accessible.includes(selectedId) ? selectedId : (accessible[0] ?? null));
  }, [accessible, rovingId, selectedId]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, currentId: string) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || accessible.length === 0) return;
    event.preventDefault();
    const current = Math.max(0, accessible.indexOf(currentId));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? accessible.length - 1
        : current;
    const atlas = livePoints.current.size > 0 ? livePoints.current : points;
    const nextId = event.key === 'Home' || event.key === 'End'
      ? accessible[nextIndex]
      : directionalTarget(event.key, currentId, accessible, atlas);
    if (!nextId) return;
    setRovingId(nextId);
    nodeRefs.current.get(nextId)?.focus();
  };

  return (
    <div ref={fieldRef} className={s.field} data-course-focus={focusedCourse || undefined}>
      <StarSkyCanvas compact={compact} keepouts={keepouts} look={motionRef} />
      <svg
        ref={orbitBackRef}
        className={`${s.orbitLayer} ${s.orbitBack}`}
        viewBox={`0 0 ${SEA_WIDTH} ${SEA_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {orbitLanes.map(([key]) => (
          <path key={key} data-orbit={key} className={s.orbitDash} />
        ))}
      </svg>
      <EarthGlobe motion={motionRef} reduced={reduced} dragging={earthDragRef} />
      <svg
        ref={orbitFrontRef}
        className={`${s.orbitLayer} ${s.orbitFront}`}
        viewBox={`0 0 ${SEA_WIDTH} ${SEA_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {orbitLanes.map(([key]) => (
          <path key={key} data-orbit={key} className={s.orbitDash} />
        ))}
      </svg>

      {realms.map((realm, realmIndex) => {
        const marker = courseLabelPoint(realm, points, realmIndex, realms.length);
        return (
          <span
            key={realm.key}
            className={s.courseMarker}
            style={{
              left: `${(marker.x / SEA_WIDTH) * 100}%`,
              top: `${(marker.y / SEA_HEIGHT) * 100}%`,
            }}
          >
            《{realm.course}》
          </span>
        );
      })}

      <svg
        ref={svgRef}
        className={s.linkLayer}
        viewBox={`0 0 ${SEA_WIDTH} ${SEA_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {links.map((link) => {
          const from = livePoints.current.get(link.a);
          const to = livePoints.current.get(link.b);
          if (!from || !to) return null;
          const path = linkPath(from, to);
          return (
            <g key={`${link.a}:${link.b}`} data-link={`${link.a}:${link.b}`}>
              <path className={s.linkGlow} d={path} />
              <path className={s.link} d={path} />
            </g>
          );
        })}
      </svg>

      <ol className={s.nodeList} aria-label="知识星列表，使用方向键巡览，回车选择">
        {nodes.map((node, index) => {
          const point = points.get(node.topic.topicId);
          if (!point) return null;
          const id = node.topic.topicId;
          const locked = node.status === 'locked';
          return (
            <li
              key={id}
              ref={(element) => {
                if (element) slotRefs.current.set(id, element);
                else slotRefs.current.delete(id);
              }}
              className={s.nodeSlot}
              data-star-id={id}
              data-label={labelSideFor(point, index)}
            >
              <button
                ref={(element) => {
                  if (element) nodeRefs.current.set(id, element);
                  else nodeRefs.current.delete(id);
                }}
                type="button"
                className={s.node}
                disabled={locked}
                tabIndex={locked ? -1 : rovingId === id ? 0 : -1}
                data-status={node.status}
                data-featured={featured.has(id) || undefined}
                data-selected={selectedId === id || undefined}
                data-linked={neighbors.has(id) || undefined}
                data-dimmed={statusFocus !== null && statusFocus !== node.status || undefined}
                aria-label={label(node)}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                aria-pressed={locked ? undefined : selectedId === id}
                aria-controls={locked ? undefined : 'knowledge-evidence'}
                onClick={() => {
                  setRovingId(id);
                  onSelect(id);
                }}
                onKeyDown={(event) => moveFocus(event, id)}
                onPointerEnter={() => setHoveredId(id)}
                onPointerLeave={() => setHoveredId((current) => current === id ? null : current)}
                onFocus={() => {
                  setRovingId(id);
                  setFocusedId(id);
                }}
                onBlur={() => setFocusedId((current) => current === id ? null : current)}
              >
                <span className={s.fog} aria-hidden="true" />
                <span className={s.core} data-star-anchor aria-hidden="true">
                  <img src={starGlyphUrl} alt="" />
                </span>
                <span className={s.nodeCopy}>
                  <b>{node.topic.title}</b>
                  <small>{label(node).split('，')[2]}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
