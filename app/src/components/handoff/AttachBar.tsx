/**
 * 输入区里的「已附加」小签 + 添加按钮 + 选择器。AI 课堂和助理任务的输入区共用。
 * 不带外层容器：小签直接排进调用方自己的那一行。
 */
import { useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import type { NotebookSource } from '../../engine/notebookSources';
import { useArtifacts } from '../../lib/artifacts';
import { AttachPicker, type AttachTab } from './AttachPicker';
import { ArtifactKindIcon } from './kinds';
import type { AttachSelection } from './materials';
import s from './handoff.module.css';

export interface Attachments {
  selection: AttachSelection;
  /** 资料库文件 id → 文件名，仅用于显示 */
  names: Record<string, string>;
  /** 从别的板块直接带过来的一段内容（不在登记处里） */
  carried: NotebookSource[];
}

export const NO_ATTACHMENTS: Attachments = { selection: { fileIds: [], artifactKeys: [] }, names: {}, carried: [] };

export const attachmentCount = (value: Attachments) => value.selection.fileIds.length + value.selection.artifactKeys.length + value.carried.length;

export function AttachBar({ owner, value, onChange, disabled = false, onManage, addLabel = '添加资料', initialTab = 'files' }: {
  owner: string | null;
  value: Attachments;
  onChange: (next: Attachments) => void;
  disabled?: boolean;
  onManage?: () => void;
  addLabel?: string;
  initialTab?: AttachTab;
}) {
  const [open, setOpen] = useState(false);
  const artifacts = useArtifacts(owner);
  const { selection, names, carried } = value;

  return (
    <>
      {carried.map((source) => (
        <span key={source.id} className={s.chip} title={source.title}>
          <Paperclip size={13} strokeWidth={1.75} />
          <span>{source.title}</span>
          <button type="button" aria-label={`移除 ${source.title}`} disabled={disabled} onClick={() => onChange({ ...value, carried: carried.filter((item) => item.id !== source.id) })}>
            <X size={13} strokeWidth={2} />
          </button>
        </span>
      ))}
      {selection.artifactKeys.map((key) => {
        const artifact = artifacts.find((item) => item.key === key);
        const title = artifact?.title || '我的内容';
        return (
          <span key={key} className={s.chip} title={title}>
            {artifact ? <ArtifactKindIcon kind={artifact.kind} size={13} /> : <Paperclip size={13} strokeWidth={1.75} />}
            <span>{title}</span>
            <button
              type="button"
              aria-label={`移除 ${title}`}
              disabled={disabled}
              onClick={() => onChange({ ...value, selection: { ...selection, artifactKeys: selection.artifactKeys.filter((item) => item !== key) } })}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </span>
        );
      })}
      {selection.fileIds.map((id) => {
        const title = names[id] ?? '资料文件';
        return (
          <span key={id} className={s.chip} title={title}>
            <FileText size={13} strokeWidth={1.75} />
            <span>{title}</span>
            <button
              type="button"
              aria-label={`移除 ${title}`}
              disabled={disabled}
              onClick={() => onChange({ ...value, selection: { ...selection, fileIds: selection.fileIds.filter((item) => item !== id) } })}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </span>
        );
      })}
      <button type="button" className={s.chipAdd} disabled={disabled} onClick={() => setOpen(true)}>
        <Paperclip size={13} strokeWidth={1.75} />
        {addLabel}
      </button>
      <AttachPicker
        open={open}
        onOpenChange={setOpen}
        owner={owner}
        selected={selection}
        initialTab={initialTab}
        onManage={onManage ? () => { setOpen(false); onManage(); } : undefined}
        onConfirm={(next, fileNames) => { onChange({ ...value, selection: next, names: { ...names, ...fileNames } }); setOpen(false); }}
      />
    </>
  );
}
