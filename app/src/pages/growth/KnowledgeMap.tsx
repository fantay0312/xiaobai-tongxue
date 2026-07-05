/**
 * 盲区图谱 —— 星图/枝干 SVG,自绘不装图表库。
 * 节点四态:黛绿=出师 / 藤黄=衰减待复习 / 墨青描边=学习中 / 灰=未学;locked 更淡。
 * hover 显示掌握度;节点连成知识脉络。
 */
import { useState } from 'react';
import type { Topic, TopicState } from '../../types';
import s from './growth.module.css';

export type NodeStatus = 'locked' | 'unlearned' | 'learning' | 'forgotten' | 'mastered';

export interface MapNode {
  topic: Topic;
  state: TopicState | null;
  status: NodeStatus;
}

const W = 960;
const H = 300;

/** 星图散点:横向铺开,纵向错落(确定性抖动,像手点上去的星子) */
function posOf(i: number, n: number): [number, number] {
  const x = 80 + (i * (W - 160)) / Math.max(1, n - 1);
  const y = (i % 2 === 0 ? 188 : 100) + Math.sin(i * 7.31) * 16;
  return [x, y];
}

const CORE_CLASS: Record<NodeStatus, string> = {
  mastered: 'coreMastered',
  forgotten: 'coreForgotten',
  learning: 'coreLearning',
  unlearned: 'coreUnlearned',
  locked: 'coreLocked',
};

const STATUS_TEXT: Record<NodeStatus, string> = {
  mastered: '已出师',
  forgotten: '小白说它忘了',
  learning: '学习中',
  unlearned: '未学',
  locked: '未开放',
};

export function KnowledgeMap({
  nodes, selectedId, onSelect,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const positions = nodes.map((_, i) => posOf(i, nodes.length));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.mapSvg} role="img" aria-label="盲区图谱:课程知识点星图">
      {/* 知识脉络 */}
      {positions.slice(0, -1).map(([x1, y1], i) => {
        const [x2, y2] = positions[i + 1];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 24;
        return (
          <path
            key={nodes[i].topic.topicId}
            d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
            className={s.vein}
          />
        );
      })}

      {nodes.map((node, i) => {
        const [x, y] = positions[i];
        const { topic, state, status } = node;
        const locked = status === 'locked';
        const r = locked ? 11 : 15;
        const isHover = hovered === topic.topicId;
        const isSelected = selectedId === topic.topicId;
        const mastery = state ? Math.round(state.mastery * 100) : null;
        return (
          <g
            key={topic.topicId}
            className={locked ? s.nodeLocked : s.node}
            onMouseEnter={() => setHovered(topic.topicId)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => { if (!locked) onSelect(topic.topicId); }}
          >
            <title>
              {topic.title} · {STATUS_TEXT[status]}{mastery !== null ? ` · 掌握度 ${mastery}` : ''}
            </title>
            {status === 'mastered' && <circle cx={x} cy={y} r={r + 7} className={s.halo} />}
            {status === 'forgotten' && <circle cx={x} cy={y} r={r + 7} className={s.haloForgot} />}
            {isSelected && <circle cx={x} cy={y} r={r + 12} className={s.haloSelected} />}
            <circle cx={x} cy={y} r={r} className={s[CORE_CLASS[status]]} />
            <text x={x} y={y + r + 22} className={locked ? `${s.nodeLabel} ${s.nodeLabelFaint}` : s.nodeLabel}>
              {topic.title}
            </text>
            {isHover && (
              <text x={x} y={y - r - 12} className={s.hoverText}>
                {locked ? '未开放' : `掌握度 ${mastery} · ${STATUS_TEXT[status]}`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
