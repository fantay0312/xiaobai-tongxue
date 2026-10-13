/**
 * 「发送到」—— 任何一段内容都能就地交出去：存成笔记、做成闪卡、整理成导图、出题、拆成待办，
 * 或者带去助理任务、AI 课堂、讲给小白。桌面是下拉菜单，手机是底部面板。
 */
import { cloneElement, useState, useSyncExternalStore, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Forward } from 'lucide-react';
import type { ArtifactOrigin } from '../../lib/artifacts';
import { CROSS_ACTION_LABELS, runCrossAction, type CrossAction, type CrossActionResult } from '../../lib/crossActions';
import { Dialog, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from '../ui';
import { IconAgent, IconClassroom, IconFlashcard, IconMindmap, IconNote, IconQuiz, IconTeach, IconTodo } from '../ui/icons';
import { stashHandoff } from './stash';
import { useOpenTarget } from './useOpenTarget';
import s from './handoff.module.css';

export type SendRoute = 'agent' | 'lesson' | 'teach';

export interface SendToProps {
  owner: string | null;
  /** 要交出去的内容（Markdown）；传函数则在点选时再取 */
  text: string | (() => string);
  /** 建议的标题；不给由内容推一个 */
  title?: string;
  topicId?: string;
  topicTitle?: string;
  /** 内容从哪儿来，写进成果的来源里 */
  origin: ArtifactOrigin;
  /** 可用的整理动作，默认五个都给 */
  actions?: CrossAction[];
  /** 可用的去向，默认助理与 AI 课；teach 还需要给 teachTopicId */
  routes?: SendRoute[];
  /** 这段内容属于哪门可以讲给小白的课 */
  teachTopicId?: string;
  /** 自定义触发钮（必须是能接 onClick 的单个元素）；不给就是一个图标按钮；给 null 则不渲染触发钮，由外面用 open 控制 */
  children?: ReactElement<{ onClick?: (event: MouseEvent) => void }> | null;
  /** 一律用面板列表（对话框，手机上是底部面板），不用下拉菜单；配合 open / onOpenChange 可由别的菜单项打开 */
  sheet?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  onDone?: (result: CrossActionResult) => void;
}

const ALL_ACTIONS: CrossAction[] = ['save-note', 'make-flashcards', 'make-mindmap', 'make-quiz', 'add-todos'];
const ACTION_ICONS: Record<CrossAction, ReactNode> = {
  'save-note': <IconNote size={16} />,
  'make-flashcards': <IconFlashcard size={16} />,
  'make-mindmap': <IconMindmap size={16} />,
  'make-quiz': <IconQuiz size={16} />,
  'add-todos': <IconTodo size={16} />,
};
const ACTION_HINTS: Record<CrossAction, string> = {
  'save-note': '收进工作台的笔记',
  'make-flashcards': '一卡一问，之后按间隔复习',
  'make-mindmap': '把结构理成一张图',
  'make-quiz': '出一组自测题',
  'add-todos': '列成可以勾掉的步骤',
};
const DONE_LABELS: Record<CrossAction, string> = {
  'save-note': '已存为笔记', 'make-flashcards': '闪卡做好了', 'make-mindmap': '导图整理好了', 'make-quiz': '题目出好了', 'add-todos': '已加入待办',
};

const PHONE_QUERY = '(max-width: 640px)';
function subscribePhone(listener: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

interface Entry { key: string; label: string; hint: string; icon: ReactNode; run: () => void }

export function SendTo({
  owner, text, title, topicId, topicTitle, origin, actions = ALL_ACTIONS, routes = ['agent', 'lesson'], teachTopicId,
  children, label = '发送到', align = 'start', side, onDone, sheet = false, open: controlledOpen, onOpenChange,
}: SendToProps) {
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const [innerOpen, setInnerOpen] = useState(false);
  const sheetOpen = controlledOpen ?? innerOpen;
  const setSheetOpen = (next: boolean) => { setInnerOpen(next); onOpenChange?.(next); };
  const open = useOpenTarget();
  const navigate = useNavigate();

  const content = () => (typeof text === 'function' ? text() : text).trim();
  const named = () => title?.trim() || content().split('\n').find((line) => line.trim())?.replace(/^[#>*\-\s]+/, '').slice(0, 28) || '一段内容';

  const transform = async (action: CrossAction) => {
    const body = content();
    if (!body) { toast.error('这里还没有可以发送的内容'); return; }
    const id = toast.loading(`正在${CROSS_ACTION_LABELS[action]}…`);
    try {
      const result = await runCrossAction(owner, action, {
        text: body, origin,
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(topicId ? { topicId } : {}),
        ...(topicTitle ? { topicTitle } : {}),
      });
      toast.success(`${DONE_LABELS[action]}：${result.title}`, {
        id,
        description: result.method === 'local' ? '本地演示：按规则从内容里整理，没有经过模型。' : undefined,
        action: { label: '打开', onClick: () => open(result.open) },
      });
      onDone?.(result);
    } catch (reason) {
      toast.error(reason instanceof Error && reason.message ? reason.message : '这次没有成功，请再试一次。', { id });
    }
  };

  /** 带着内容去另一个板块：正文进交接暂存，地址里只带短号 */
  const carry = (view: 'agent' | 'classroom') => {
    const body = content();
    if (!body) { toast.error('这里还没有可以发送的内容'); return; }
    const name = named();
    const handoff = stashHandoff({ title: name, text: body, origin });
    open({
      view,
      params: view === 'agent'
        ? { handoff, goal: `根据附上的「${name}」，整理成可以复习的笔记，再出几道题检查理解。` }
        : { handoff },
    });
  };

  const entries: Entry[] = actions.map((action) => ({
    key: action, label: CROSS_ACTION_LABELS[action], hint: ACTION_HINTS[action], icon: ACTION_ICONS[action], run: () => void transform(action),
  }));
  const routeEntries: Entry[] = [
    ...(routes.includes('agent') ? [{ key: 'agent', label: '交给助理', hint: '让小砚接着把事办完', icon: <IconAgent size={16} />, run: () => carry('agent') }] : []),
    ...(routes.includes('lesson') ? [{ key: 'lesson', label: '生成 AI 课', hint: '用这段内容排一堂可以播放的课', icon: <IconClassroom size={16} />, run: () => carry('classroom') }] : []),
    ...(routes.includes('teach') && teachTopicId ? [{ key: 'teach', label: '讲给小白', hint: '把这一课讲出来，检验是不是真懂', icon: <IconTeach size={16} />, run: () => navigate(`/teach/${encodeURIComponent(teachTopicId)}`) }] : []),
  ];

  const trigger = children === null ? null : children ?? <IconButton size="sm" label={label}><Forward size={15} strokeWidth={1.75} /></IconButton>;

  if (phone || sheet || !trigger) {
    const pick = (entry: Entry) => { setSheetOpen(false); entry.run(); };
    return (
      <>
        {trigger && cloneElement(trigger, { onClick: () => setSheetOpen(true) })}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen} title={label} size="sm">
          <ul className={s.sheetList}>
            {entries.map((entry) => (
              <li key={entry.key}>
                <button type="button" className={s.sheetItem} onClick={() => pick(entry)}>
                  <span className={s.sheetIcon}>{entry.icon}</span>
                  <span className={s.sheetText}>{entry.label}<small>{entry.hint}</small></span>
                </button>
              </li>
            ))}
            {entries.length > 0 && routeEntries.length > 0 && <li className={s.sheetLabel} role="presentation">带去别处</li>}
            {routeEntries.map((entry) => (
              <li key={entry.key}>
                <button type="button" className={s.sheetItem} onClick={() => pick(entry)}>
                  <span className={s.sheetIcon}>{entry.icon}</span>
                  <span className={s.sheetText}>{entry.label}<small>{entry.hint}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      </>
    );
  }

  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent align={align} side={side}>
        {entries.length > 0 && <MenuLabel>{label}</MenuLabel>}
        {entries.map((entry) => (
          <MenuItem key={entry.key} icon={entry.icon} hint={entry.hint} onSelect={entry.run}>{entry.label}</MenuItem>
        ))}
        {entries.length > 0 && routeEntries.length > 0 && <MenuSeparator />}
        {routeEntries.map((entry) => (
          <MenuItem key={entry.key} icon={entry.icon} hint={entry.hint} onSelect={entry.run}>{entry.label}</MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
