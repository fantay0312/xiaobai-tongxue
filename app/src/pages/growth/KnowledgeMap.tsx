/**
 * 学问星海：所有课程共用一片连续深空。知识点仍一讲一星，但只让少量主星
 * 常显星芒与题名；其余节点收成可交互星核，选中时才展开真实语义星链。
 * 框内不重复页面题头:顶部只留课程页签与视图切换,底部一行计数与操作提示。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Topic, TopicState } from '../../types';
import { KnowledgeSeaField } from './KnowledgeSeaField';
import { KnowledgeSeaList } from './KnowledgeSeaList';
import { groupByCourse, layoutSea, pickDockCorner } from './knowledgeSeaGeometry';
import s from './KnowledgeSeaFrame.module.css';

export type NodeStatus = 'locked' | 'unlearned' | 'learning' | 'forgotten' | 'mastered';

export interface MapNode {
  topic: Topic;
  state: TopicState | null;
  status: NodeStatus;
}

const STATUS_TEXT: Record<NodeStatus, string> = {
  mastered: '星火已明',
  forgotten: '雾气回拢',
  learning: '星光渐起',
  unlearned: '尚未开讲',
  locked: '此星未开',
};

export function KnowledgeMap({
  nodes,
  selectedId,
  onSelect,
  statusFocus = null,
  bridge = null,
  children = null,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
  statusFocus?: NodeStatus | null;
  bridge?: { toFull: number; seals: number } | null;
  children?: ReactNode;
}) {
  const realms = useMemo(() => groupByCourse(nodes), [nodes]);
  const [courseFocus, setCourseFocus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'list'>('chart');
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (compact && courseFocus === null && realms[0]) setCourseFocus(realms[0].course);
  }, [compact, courseFocus, realms]);

  useEffect(() => {
    if (!compact || !selectedId) return;
    const selected = nodes.find((node) => node.topic.topicId === selectedId);
    if (selected) setCourseFocus(selected.topic.course);
  }, [compact, nodes, selectedId]);

  const visibleNodes = useMemo(
    () => (courseFocus
      ? nodes.filter((node) => node.topic.course === courseFocus)
      : nodes),
    [courseFocus, nodes],
  );
  const litStars = nodes.filter((node) => node.status === 'mastered').length;
  const fogStars = nodes.filter((node) => node.status === 'forgotten').length;
  const selectedNode = nodes.find((node) => node.topic.topicId === selectedId) ?? null;
  const seaPoints = useMemo(
    () => layoutSea(visibleNodes, courseFocus !== null, compact),
    [compact, courseFocus, visibleNodes],
  );
  const dockCorner = useMemo(
    () => pickDockCorner(selectedId, seaPoints),
    [seaPoints, selectedId],
  );
  return (
    <div className={s.atlas}>
      <div className={s.chart} role="group" aria-label="学问星海，一讲一星">
        <div className={s.toolbar}>
          <nav className={s.courseNav} aria-label="按课程巡览星海">
            <button
              type="button"
              className={s.allSea}
              aria-pressed={courseFocus === null}
              onClick={() => setCourseFocus(null)}
            >
              全部
            </button>
            {realms.map((realm) => (
              <button
                key={realm.course}
                type="button"
                aria-pressed={courseFocus === realm.course}
                onClick={() => {
                  setCourseFocus(realm.course);
                  const firstAvailable = realm.nodes.find((node) => node.status !== 'locked');
                  if (firstAvailable && firstAvailable.topic.topicId !== selectedId) {
                    onSelect(firstAvailable.topic.topicId);
                  }
                }}
              >
                {realm.course}
                <small>{realm.nodes.filter((node) => node.status === 'mastered').length}/{realm.nodes.length}</small>
              </button>
            ))}
          </nav>
          <div className={s.viewSwitch} role="group" aria-label="星海视图">
            <button type="button" aria-pressed={viewMode === 'chart'} onClick={() => setViewMode('chart')}>星图</button>
            <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>名录</button>
          </div>
        </div>

        {selectedNode ? (
          <p className={s.srOnly} role="status">
            正在观测《{selectedNode.topic.title}》 · {STATUS_TEXT[selectedNode.status]}
          </p>
        ) : null}

        <div className={s.skyStage} data-corner={dockCorner}>
          {viewMode === 'list' ? (
            <KnowledgeSeaList
              nodes={visibleNodes}
              selectedId={selectedId}
              statusFocus={statusFocus}
              onSelect={onSelect}
            />
          ) : (
            <KnowledgeSeaField
              nodes={visibleNodes}
              selectedId={selectedId}
              statusFocus={statusFocus}
              compact={compact}
              focusedCourse={courseFocus !== null}
              onSelect={onSelect}
              points={seaPoints}
            />
          )}
          {children}
        </div>

        <div className={s.foot}>
          <p className={s.survey}>
            已明 <b>{litStars}</b> · 雾中 <b>{fogStars}</b> · 共 <b>{nodes.length}</b> 讲
            {bridge ? (
              <> · {bridge.toFull > 0 ? <>距全谱 <b>{bridge.toFull}</b> 星</> : '全谱已成'}</>
            ) : null}
          </p>
          <p className={s.hint}>
            {compact ? '先选课程，再点星查看；可切到名录查找。' : '方向键巡星，回车展开证据。'}
          </p>
        </div>
      </div>
    </div>
  );
}
