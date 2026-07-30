import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import starGlyphUrl from '../../assets/knowledge-star.svg';
import type { MapNode, NodeStatus } from './KnowledgeMap';
import {
  DECORATIVE_STARS,
  SEA_HEIGHT,
  SEA_WIDTH,
  activeStarLinks,
  courseLabelPoint,
  curvedPath,
  featuredStarIds,
  groupByCourse,
  layoutSea,
} from './knowledgeSeaGeometry';
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
}: {
  nodes: MapNode[];
  selectedId: string | null;
  statusFocus: NodeStatus | null;
  compact: boolean;
  focusedCourse: boolean;
  onSelect: (topicId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const realms = useMemo(() => groupByCourse(nodes), [nodes]);
  const points = useMemo(
    () => layoutSea(nodes, focusedCourse, compact),
    [compact, focusedCourse, nodes],
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
    const nextId = event.key === 'Home' || event.key === 'End'
      ? accessible[nextIndex]
      : directionalTarget(event.key, currentId, accessible, points);
    if (!nextId) return;
    setRovingId(nextId);
    nodeRefs.current.get(nextId)?.focus();
  };

  return (
    <div className={s.field} data-course-focus={focusedCourse || undefined}>
      {DECORATIVE_STARS.slice(0, compact ? 14 : 28).map((star, index) => (
        <img
          key={index}
          className={s.decorStar}
          src={starGlyphUrl}
          alt=""
          aria-hidden="true"
          style={{
            left: `${(star.x / SEA_WIDTH) * 100}%`,
            top: `${(star.y / SEA_HEIGHT) * 100}%`,
            width: `${star.size}px`,
            opacity: star.opacity,
            animationDelay: `${-star.delay}s`,
          }}
        />
      ))}

      {realms.map((realm, realmIndex) => {
        const marker = courseLabelPoint(realm, points, realmIndex, realms.length);
        return (
          <span
            key={realm.course}
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
        className={s.linkLayer}
        viewBox={`0 0 ${SEA_WIDTH} ${SEA_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {links.map((link, index) => {
          const from = points.get(link.a);
          const to = points.get(link.b);
          if (!from || !to) return null;
          const path = curvedPath(from, to, index);
          return (
            <g key={`${link.a}:${link.b}`}>
              <path className={s.linkGlow} d={path} />
              <path className={s.link} d={path} />
            </g>
          );
        })}
      </svg>

      <ol className={s.nodeList} aria-label="知识星列表，使用方向键巡览，回车选择">
        {nodes.map((node) => {
          const point = points.get(node.topic.topicId);
          if (!point) return null;
          const id = node.topic.topicId;
          const locked = node.status === 'locked';
          return (
            <li
              key={id}
              className={s.nodeSlot}
              data-star-id={id}
              style={{
                left: `${(point.x / SEA_WIDTH) * 100}%`,
                top: `${(point.y / SEA_HEIGHT) * 100}%`,
              }}
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
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId((current) => current === id ? null : current)}
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
