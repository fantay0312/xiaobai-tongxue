import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Eye, EyeOff, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../../../components/ui';
import { useMediaQuery } from '../../shell/views';
import s from './memory.module.css';

export interface MemoryRowProps {
  text: string;
  /** 文字下方的一行说明：来源、时间、关联课程等 */
  meta?: ReactNode;
  pinned?: boolean;
  muted?: boolean;
  /** 刚记下的那一行，入场时轻轻浮现 */
  fresh?: boolean;
  maxLength?: number;
  /** 返回 false 表示没保存成功，保持编辑状态 */
  onEdit: (text: string) => boolean | void;
  onPin: (pinned: boolean) => void;
  /** 不传则不显示「隐藏」 */
  onMute?: (muted: boolean) => void;
  onDelete: () => void;
  /** 删除前就地确认；不传则直接删除，由调用方提供撤销 */
  confirmDelete?: boolean;
  /** 追加在操作区里的额外控件 */
  extra?: ReactNode;
  /** 额外控件的弹层打开时，保持操作区可见 */
  actionsOpen?: boolean;
  /** 手机上操作收进一个菜单：这里给出追加在菜单里的条目（如「改到哪一类」） */
  menuExtra?: ReactNode;
}

/** 一条记忆：就地编辑、置顶、隐藏、删除。小砚与小白两份记忆共用。 */
export function MemoryRow({
  text, meta, pinned = false, muted = false, fresh, maxLength = 80,
  onEdit, onPin, onMute, onDelete, confirmDelete, extra, actionsOpen, menuExtra,
}: MemoryRowProps) {
  // 手机和触屏没有悬停：一颗始终可见的「更多」，置顶、隐藏、编辑、删除都在菜单里
  const compact = useMediaQuery('(max-width: 760px), (hover: none)');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const beginEdit = () => {
    setDraft(text);
    setConfirming(false);
    setEditing(true);
  };
  const save = () => {
    const next = draft.trim();
    if (!next || next === text) {
      setEditing(false);
      return;
    }
    if (onEdit(next) !== false) setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  };

  return (
    <li className={s.row} data-compact={compact || undefined} data-pinned={pinned || undefined} data-muted={muted || undefined} data-fresh={fresh || undefined}>
      <div className={s.rowMain}>
        {editing ? (
          <div className={s.rowEdit}>
            <Input
              ref={inputRef}
              size="sm"
              wrapClassName={s.rowEditInput}
              value={draft}
              maxLength={maxLength}
              aria-label="编辑这条记忆"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button size="sm" variant="solid" onClick={save} disabled={!draft.trim()}>保存</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
          </div>
        ) : (
          <p className={s.rowText}>
            {pinned && <Pin size={13} strokeWidth={2} className={s.pinMark} aria-label="已置顶" />}
            {text}
          </p>
        )}
        {meta && <div className={s.rowMeta}>{meta}</div>}
      </div>

      {!editing && (
        <div className={s.rowActions} data-open={confirming || actionsOpen || undefined}>
          {confirming ? (
            <>
              <span className={s.confirmAsk} role="status">删掉这条？</span>
              <Button
                size="sm"
                variant="danger"
                autoFocus
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              >
                删除
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>取消</Button>
            </>
          ) : compact ? (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="更多操作" tip={false}><MoreHorizontal strokeWidth={1.75} /></IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={pinned ? <PinOff size={16} strokeWidth={1.75} /> : <Pin size={16} strokeWidth={1.75} />} onSelect={() => onPin(!pinned)}>
                  {pinned ? '取消置顶' : '置顶'}
                </MenuItem>
                {onMute && (
                  <MenuItem
                    icon={muted ? <Eye size={16} strokeWidth={1.75} /> : <EyeOff size={16} strokeWidth={1.75} />}
                    hint={muted ? undefined : '留着但不再用'}
                    onSelect={() => onMute(!muted)}
                  >
                    {muted ? '取消隐藏' : '隐藏'}
                  </MenuItem>
                )}
                <MenuItem icon={<Pencil size={16} strokeWidth={1.75} />} onSelect={beginEdit}>编辑</MenuItem>
                {menuExtra}
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 size={16} strokeWidth={1.75} />} onSelect={() => (confirmDelete ? setConfirming(true) : onDelete())}>
                  删除
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <>
              <IconButton size="sm" label={pinned ? '取消置顶' : '置顶'} aria-pressed={pinned} onClick={() => onPin(!pinned)}>
                {pinned ? <PinOff strokeWidth={1.75} /> : <Pin strokeWidth={1.75} />}
              </IconButton>
              {onMute && (
                <IconButton size="sm" label={muted ? '取消隐藏' : '隐藏：留着但不再用'} aria-pressed={muted} onClick={() => onMute(!muted)}>
                  {muted ? <Eye strokeWidth={1.75} /> : <EyeOff strokeWidth={1.75} />}
                </IconButton>
              )}
              <IconButton size="sm" label="编辑" onClick={beginEdit}>
                <Pencil strokeWidth={1.75} />
              </IconButton>
              {extra}
              <IconButton size="sm" label="删除" onClick={() => (confirmDelete ? setConfirming(true) : onDelete())}>
                <Trash2 strokeWidth={1.75} />
              </IconButton>
            </>
          )}
        </div>
      )}
    </li>
  );
}
