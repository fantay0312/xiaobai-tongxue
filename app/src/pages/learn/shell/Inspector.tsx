import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton, Segmented } from '../../../components/ui';
import type { InspectorPanel } from './TerminalHeader';
import t from '../terminal.module.css';

/** 按需打开的右侧面板：资料与「工具与产物」共用一个位置 */
export function Inspector({ panel, sourceCount, onPanel, onClose, children }: {
  panel: InspectorPanel;
  sourceCount: number;
  onPanel: (panel: InspectorPanel) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className={t.inspector} aria-label={panel === 'sources' ? '资料' : '工具与产物'}>
      <header className={t.inspectorHead}>
        <Segmented<InspectorPanel>
          size="sm"
          label="侧面板内容"
          value={panel}
          onChange={onPanel}
          options={[
            { value: 'sources', label: `资料 ${sourceCount}` },
            { value: 'tools', label: '工具与产物' },
          ]}
        />
        <IconButton label="关闭侧面板" size="sm" tip="left" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </header>
      {children}
    </aside>
  );
}
