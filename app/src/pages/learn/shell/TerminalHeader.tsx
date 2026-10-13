import { Link } from 'react-router';
import { ChevronRight, GraduationCap, Library, PanelLeft, Sparkles } from 'lucide-react';
import { Badge, Button, IconButton } from '../../../components/ui';
import type { Topic } from '../../../types';
import t from '../terminal.module.css';

export type InspectorPanel = 'sources' | 'tools';

export function TerminalHeader({
  topic, viewLabel, sidebarOpen, onShowSidebar, showPanels, inspector, sourceCount, onInspector, onCourse, onTopic,
}: {
  topic?: Topic;
  /** 面包屑最后一级；对话首页不显示 */
  viewLabel?: string;
  sidebarOpen: boolean;
  onShowSidebar: () => void;
  /** 当前视图是否提供资料与工具侧面板 */
  showPanels: boolean;
  inspector: InspectorPanel | null;
  sourceCount: number;
  onInspector: (panel: InspectorPanel) => void;
  onCourse: () => void;
  onTopic: () => void;
}) {
  return (
    <header className={t.header}>
      <IconButton label="展开侧栏" tip="bottom" className={t.showSidebar} data-collapsed={!sidebarOpen || undefined} onClick={onShowSidebar}>
        <PanelLeft size={18} strokeWidth={1.75} />
      </IconButton>

      <nav className={t.breadcrumb} aria-label="当前位置">
        {topic ? (
          <>
            <button type="button" className={t.crumb} data-level="course" onClick={onCourse}>{topic.course}</button>
            <ChevronRight size={14} strokeWidth={1.75} data-level="course" />
            <button type="button" className={t.crumb} data-current={!viewLabel || undefined} onClick={onTopic}>{topic.title}</button>
          </>
        ) : (
          <button type="button" className={t.crumb} data-current={!viewLabel || undefined} onClick={onTopic}>学习终端</button>
        )}
        {viewLabel && (
          <>
            <ChevronRight size={14} strokeWidth={1.75} />
            <span className={t.crumb} data-current aria-current="page">{viewLabel}</span>
          </>
        )}
      </nav>

      <div className={t.headerActions}>
        {showPanels && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label="资料"
              aria-pressed={inspector === 'sources'}
              className={t.headerButton}
              icon={<Library size={16} strokeWidth={1.75} />}
              onClick={() => onInspector('sources')}
            >
              <span className={t.headerLabel}>资料</span>
              <Badge tone={sourceCount ? 'accent' : 'neutral'}>{sourceCount}</Badge>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="工具与产物"
              aria-pressed={inspector === 'tools'}
              className={t.headerButton}
              icon={<Sparkles size={16} strokeWidth={1.75} />}
              onClick={() => onInspector('tools')}
            >
              <span className={t.headerLabel}>工具与产物</span>
            </Button>
          </>
        )}
        {topic && (
          <Button asChild variant="solid" size="sm" icon={<GraduationCap size={16} strokeWidth={1.75} />}>
            <Link to={`/teach/${encodeURIComponent(topic.topicId)}`}>教小白</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
