import { useMemo, useState } from 'react';
import { ChevronRight, Network } from 'lucide-react';
import { Button } from '../../../components/ui';
import type { LearningMindNode, LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { BlockCard, ScrollX } from './parts';
import styles from './genui.module.css';

/** 所有带子节点的路径；path 用「0.2.1」这样的下标串标识节点。 */
function branchPaths(node: LearningMindNode, path = '0', depth = 0): { path: string; depth: number }[] {
  if (!node.children?.length) return [];
  return [{ path, depth }, ...node.children.flatMap((child, index) => branchPaths(child, `${path}.${index}`, depth + 1))];
}
const countNodes = (node: LearningMindNode): number => 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

function Node({ node, path, depth, collapsed, onToggle }: {
  node: LearningMindNode;
  path: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const children = node.children ?? [];
  const open = children.length > 0 && !collapsed.has(path);
  return (
    <li className={styles.mindNode} role="treeitem" aria-expanded={children.length ? open : undefined} aria-level={depth + 1}>
      <div className={styles.mindLabel} data-depth={Math.min(depth, 3)} data-branch={children.length > 0}>
        <span className={styles.mindText}>
          {node.label}
          {node.note ? <small>{node.note}</small> : null}
        </span>
        {children.length > 0 && (
          <button type="button" className={styles.mindToggle} data-open={open} aria-label={open ? `收起「${node.label}」` : `展开「${node.label}」的 ${children.length} 个分支`} onClick={() => onToggle(path)}>
            {open ? <ChevronRight size={13} strokeWidth={2} /> : children.length}
          </button>
        )}
      </div>
      {open && (
        <ul className={styles.mindChildren} role="group">
          {children.map((child, index) => (
            <Node key={index} node={child} path={`${path}.${index}`} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function MindMapBlock({ item }: { item: LearningUiBlockOf<'mindmap'> }) {
  const branches = useMemo(() => branchPaths(item.root), [item.root]);
  const total = useMemo(() => countNodes(item.root), [item.root]);
  // 节点多时先收起第三层，让第一眼看到的是骨架
  const [collapsed, setCollapsed] = useState(() => new Set(total > 18 ? branches.filter((branch) => branch.depth >= 2).map((branch) => branch.path) : []));
  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const allOpen = collapsed.size === 0;
  return (
    <BlockCard
      item={item}
      icon={<Network size={16} strokeWidth={1.75} />}
      meta={`${total} 个节点`}
      actions={branches.length > 1 ? (
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(allOpen ? branches.filter((branch) => branch.depth >= 1).map((branch) => branch.path) : []))}>
          {allOpen ? '只看主干' : '全部展开'}
        </Button>
      ) : undefined}
    >
      <ScrollX label={`${item.title}结构图`} className={styles.mindWrap}>
        <ul className={styles.mind} role="tree" aria-label={item.title}>
          <Node node={item.root} path="0" depth={0} collapsed={collapsed} onToggle={toggle} />
        </ul>
      </ScrollX>
    </BlockCard>
  );
}
