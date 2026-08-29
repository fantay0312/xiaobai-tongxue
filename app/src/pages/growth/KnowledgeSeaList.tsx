import type { MapNode, NodeStatus } from './KnowledgeMap';
import { groupByCourse } from './knowledgeSeaGeometry';
import s from './KnowledgeSeaFrame.module.css';

const STATUS_TEXT: Record<NodeStatus, string> = {
  mastered: '已出师',
  forgotten: '待温故',
  learning: '学习中',
  unlearned: '未开讲',
  locked: '未开放',
};

function masteryText(node: MapNode): string {
  if (!node.state) return STATUS_TEXT[node.status];
  return `${STATUS_TEXT[node.status]} · 掌握度 ${Math.round(node.state.mastery * 100)}%`;
}

export function KnowledgeSeaList({
  nodes,
  selectedId,
  statusFocus,
  onSelect,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  statusFocus: NodeStatus | null;
  onSelect: (topicId: string) => void;
}) {
  return (
    <div className={s.seaList} aria-label="学问星海名录">
      {groupByCourse(nodes).map((realm) => (
        <section key={realm.key} className={s.listRealm}>
          <header>
            <h4>《{realm.course}》</h4>
            <span>{realm.nodes.filter((node) => node.status === 'mastered').length}/{realm.nodes.length} 已明</span>
          </header>
          <ul>
            {realm.nodes.map((node) => {
              const locked = node.status === 'locked';
              return (
                <li key={node.topic.topicId} data-star-id={node.topic.topicId}>
                  <button
                    type="button"
                    disabled={locked}
                    data-status={node.status}
                    data-dimmed={statusFocus !== null && statusFocus !== node.status || undefined}
                    aria-pressed={locked ? undefined : selectedId === node.topic.topicId}
                    onClick={() => onSelect(node.topic.topicId)}
                  >
                    <span className={s.listCore} aria-hidden="true" />
                    <span>
                      <b>{node.topic.title}</b>
                      <small>{masteryText(node)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
