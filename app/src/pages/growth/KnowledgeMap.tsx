/**
 * 迷雾舆图 —— 按课程分境的蛇形问学路。
 * 每一境只连自己的知识点，不让不同课程的节点硬连成一条星链；
 * 节点五态仍由 MapNode.status 驱动，组件不新造任何学习状态。
 */
import type { CSSProperties } from 'react';
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

interface TrailPoint {
  x: number;
  y: number;
  column: number;
  row: number;
}

const PATH_COLUMNS = 6;
const PATH_VIEWBOX_WIDTH = 600;
const PATH_ROW_HEIGHT = 140;
const PATH_ROW_GAP = 32;
const PATH_ROW_STEP = PATH_ROW_HEIGHT + PATH_ROW_GAP;
const REALM_NUMS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌'];

const STATUS_TEXT: Record<NodeStatus, string> = {
  mastered: '灯火已明',
  forgotten: '雾气回拢',
  learning: '雾散一半',
  unlearned: '迷雾未开',
  locked: '此地未开蒙',
};

const STATUS_MARK: Record<NodeStatus, string> = {
  mastered: '灯',
  forgotten: '雾',
  learning: '行',
  unlearned: '未',
  locked: '封',
};

const STATUS_CLASS: Record<NodeStatus, string> = {
  mastered: s.mapNodeMastered,
  forgotten: s.mapNodeForgotten,
  learning: s.mapNodeLearning,
  unlearned: s.mapNodeUnlearned,
  locked: s.mapNodeLocked,
};

/** 按 TOPICS 原顺序分课程，境与境之间不产生连线。 */
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

/**
 * 六列蛇形布局：奇数行从左到右，偶数行从右到左。
 * DOM 顺序仍是课程顺序，Tab 键会沿着路径前进。
 */
function trailPoint(index: number): TrailPoint {
  const rowIndex = Math.floor(index / PATH_COLUMNS);
  const offset = index % PATH_COLUMNS;
  const columnIndex = rowIndex % 2 === 0 ? offset : PATH_COLUMNS - 1 - offset;
  return {
    x: (columnIndex + 0.5) * (PATH_VIEWBOX_WIDTH / PATH_COLUMNS),
    y: rowIndex * PATH_ROW_STEP + PATH_ROW_HEIGHT / 2,
    column: columnIndex + 1,
    row: rowIndex + 1,
  };
}

/** 用一条连续曲线串起单境节点；只是装饰，交互由真实 button 承担。 */
function trailPath(count: number): string {
  if (count === 0) return '';
  const first = trailPoint(0);
  let path = `M ${first.x} ${first.y}`;
  let previous = first;
  for (let index = 1; index < count; index += 1) {
    const current = trailPoint(index);
    if (current.row === previous.row) {
      path += ` L ${current.x} ${current.y}`;
    } else {
      const middleY = (previous.y + current.y) / 2;
      path += ` C ${previous.x} ${middleY}, ${current.x} ${middleY}, ${current.x} ${current.y}`;
    }
    previous = current;
  }
  return path;
}

function realmHeight(nodeCount: number): number {
  const rows = Math.max(1, Math.ceil(nodeCount / PATH_COLUMNS));
  return rows * PATH_ROW_HEIGHT + (rows - 1) * PATH_ROW_GAP;
}

function nodeLabel(node: MapNode): string {
  const mastery = node.state ? `，掌握度 ${Math.round(node.state.mastery * 100)}%` : '';
  return `${node.topic.title}，${STATUS_TEXT[node.status]}${mastery}`;
}

export function KnowledgeMap({
  nodes, selectedId, onSelect,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
}) {
  const realms = groupByCourse(nodes);

  return (
    <div className={s.mapAtlas} role="group" aria-label="学问舆图：按课程分境的知识路径">
      {realms.map((realm, realmIndex) => {
        const realmTitleId = `knowledge-realm-${realmIndex}`;
        const masteredCount = realm.nodes.filter((node) => node.status === 'mastered').length;
        const litRatio = `${masteredCount}/${realm.nodes.length}`;

        return (
          <section key={realm.course} className={s.mapRealm} aria-labelledby={realmTitleId}>
            <header className={s.realmHead}>
              <span className={s.realmNo} aria-hidden="true">
                {REALM_NUMS[realmIndex] ?? String(realmIndex + 1)}境
              </span>
              <div>
                <h3 id={realmTitleId} className={s.realmTitle}>《{realm.course}》</h3>
                <p className={s.realmSubtitle}>
                  {realm.nodes.length} 处学问 · 已亮灯火 {litRatio}
                </p>
              </div>
              <p className={s.realmHint}>沿着墨路前行，点一处查看它的证据。</p>
            </header>

            <div className={s.realmTrail}>
              <svg
                className={s.pathLines}
                viewBox={`0 0 ${PATH_VIEWBOX_WIDTH} ${realmHeight(realm.nodes.length)}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <path className={s.pathLineShadow} d={trailPath(realm.nodes.length)} />
                <path className={s.pathLine} d={trailPath(realm.nodes.length)} />
              </svg>

              <ol className={s.realmPath}>
                {realm.nodes.map((node, index) => {
                  const point = trailPoint(index);
                  const locked = node.status === 'locked';
                  const selected = selectedId === node.topic.topicId;
                  const slotStyle: CSSProperties = {
                    gridColumn: point.column,
                    gridRow: point.row,
                    // 超长列表入场步进 45ms、封顶 300ms(R6),别让后排节点白屏半秒
                    animationDelay: `${Math.min(index * 45, 300)}ms`,
                  };

                  return (
                    <li key={node.topic.topicId} className={s.pathSlot} style={slotStyle}>
                      <button
                        type="button"
                        className={[
                          s.mapNode,
                          STATUS_CLASS[node.status],
                          selected ? s.mapNodeSelected : '',
                        ].filter(Boolean).join(' ')}
                        disabled={locked}
                        aria-label={nodeLabel(node)}
                        aria-pressed={locked ? undefined : selected}
                        onClick={() => onSelect(node.topic.topicId)}
                      >
                        <span className={s.nodeMist} aria-hidden="true" />
                        <span className={s.nodeOrder} aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className={s.nodeMarker} aria-hidden="true">
                          {STATUS_MARK[node.status]}
                        </span>
                        <span className={s.nodeTitle}>{node.topic.title}</span>
                        <span className={s.nodeState}>{STATUS_TEXT[node.status]}</span>
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
  );
}
