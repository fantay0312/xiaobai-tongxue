/**
 * 教小白板块的侧栏导航：当下一步、选课（该回讲了 / 讲过的 / 还没讲的）、课堂记录。
 * 只用外壳提供的侧栏部件拼装，不带自己的行样式；数据由 FeynmanView 派生后传入。
 */
import { useState, type ReactNode } from 'react';
import {
  BookOpen, ChevronDown, ChevronUp, Circle, CircleAlert, CircleCheck, CircleDashed, NotebookText, RotateCcw,
} from 'lucide-react';
import { SideAction, SideEmpty, SideGroup, SideMeter, SideNavItem, SidePanel, type SideTone } from '../../shell/sidebarSlot';
import { IconLesson, IconPrep, IconReview, IconTeach } from '../../../../components/ui/icons';
import {
  GROUP_HINTS, GROUP_LABELS, type CourseGroup, type CourseRow, type PrimaryAction, type SessionRecord, type Standing,
} from './data';

const GROUP_ORDER: CourseGroup[] = ['reteach', 'taught', 'fresh'];
const GROUP_TONES: Record<CourseGroup, SideTone> = { reteach: 'warn', taught: 'ok', fresh: 'muted' };
const STANDING_TONES: Record<Standing, SideTone> = {
  forgotten: 'warn', strayed: 'bad', mastered: 'ok', learning: 'accent', prepped: 'muted', new: 'muted',
};
/** 一组课超过这个数就先收起，留一行「更多」 */
const COLLAPSE_AFTER = 6;

interface Props {
  primary: PrimaryAction;
  busy: boolean;
  rows: CourseRow[];
  selectedId: string | null;
  records: SessionRecord[];
  totalSessions: number;
  onPrimary: () => void;
  onSelect: (topicId: string) => void;
  onOpen: (to: string) => void;
}

/** 主动作的图标跟着这一步落在四站里的哪一站 */
function primaryIcon(key: string): ReactNode {
  if (key === 'first-prep' || key === 'new-prep') return <IconPrep size={16} />;
  if (key === 'live' || key === 'teach' || key === 'reteach' || key === 'review-due') return <IconLesson size={16} />;
  if (key === 'remedy') return <IconReview size={16} />;
  return <IconTeach size={16} />;
}

const STANDING_ICONS: Record<Standing, typeof Circle> = {
  forgotten: RotateCcw,
  strayed: CircleAlert,
  mastered: CircleCheck,
  learning: CircleDashed,
  prepped: BookOpen,
  new: Circle,
};

function courseIcon(row: CourseRow): ReactNode {
  const Icon = STANDING_ICONS[row.standing];
  return <Icon size={15} strokeWidth={1.75} />;
}

export function FeynmanSideNav({
  primary, busy, rows, selectedId, records, totalSessions, onPrimary, onSelect, onOpen,
}: Props) {
  const [expanded, setExpanded] = useState<Record<CourseGroup, boolean>>({
    reteach: false, taught: false, fresh: false,
  });

  const groups = GROUP_ORDER
    .map((group) => ({ group, items: rows.filter((row) => row.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <SidePanel
      title="教小白"
      hint={rows.length > 0 ? `${rows.length} 门课` : undefined}
      action={<SideAction icon={primaryIcon(primary.key)} onClick={onPrimary} disabled={busy}>{primary.cta}</SideAction>}
    >
      {groups.length === 0 && (
        <SideGroup label="选一门课">
          <SideEmpty>书架上还没有可以教的课。</SideEmpty>
        </SideGroup>
      )}

      {groups.map(({ group, items }) => {
        const open = expanded[group] || items.length <= COLLAPSE_AFTER;
        // 收起时只露前几门；选中的课即使排在后面也要留在眼前
        const head = items.slice(0, COLLAPSE_AFTER);
        const picked = items.find((row) => row.topic.topicId === selectedId);
        const visible = open ? items : picked && !head.includes(picked) ? [...head, picked] : head;
        const hidden = items.length - visible.length;

        return (
          <SideGroup key={group} label={`${GROUP_LABELS[group]} · ${items.length}`} hint={GROUP_HINTS[group]} tone={GROUP_TONES[group]}>
            {visible.map((row) => (
              <SideNavItem
                key={row.topic.topicId}
                icon={courseIcon(row)}
                label={row.topic.title}
                sub={row.standing === 'new' ? undefined : row.label}
                meta={group === 'fresh' ? undefined : <SideMeter value={row.mastery} label={`「${row.topic.title}」掌握度 ${row.mastery}%`} />}
                title={`${row.topic.course} · ${row.topic.title} · ${row.label}${group === 'fresh' ? '' : ` · 掌握 ${row.mastery}%`}`}
                tone={STANDING_TONES[row.standing]}
                active={row.topic.topicId === selectedId}
                onClick={() => onSelect(row.topic.topicId)}
              />
            ))}
            {items.length > COLLAPSE_AFTER && (
              <SideNavItem
                icon={open ? <ChevronUp size={15} strokeWidth={1.75} /> : <ChevronDown size={15} strokeWidth={1.75} />}
                label={open ? '收起' : `更多 ${hidden} 门`}
                onClick={() => setExpanded((current) => ({ ...current, [group]: !open }))}
              />
            )}
          </SideGroup>
        );
      })}

      <SideGroup label="课堂记录">
        {records.length === 0 && <SideEmpty>上完第一堂课，答卷和批注会留在这里。</SideEmpty>}
        {records.map((record) => (
          <SideNavItem
            key={record.report.sessionId}
            icon={<IconReview size={15} />}
            label={record.title}
            sub={`${record.when} · ${record.score !== null ? `${record.score} 分` : record.modeLabel}`}
            meta={record.report.masteredNow ? '出师' : undefined}
            title={`打开「${record.title}」这堂课的批注`}
            onClick={() => onOpen(`/review/${record.report.sessionId}`)}
          />
        ))}
        {totalSessions > records.length && (
          <SideNavItem
            icon={<NotebookText size={15} strokeWidth={1.75} />}
            label={`全部 ${totalSessions} 堂，去成长册看`}
            onClick={() => onOpen('/growth')}
          />
        )}
      </SideGroup>
    </SidePanel>
  );
}
