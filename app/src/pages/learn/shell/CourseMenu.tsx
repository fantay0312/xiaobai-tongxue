import { useState } from 'react';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger } from '../../../components/ui';
import { archiveCustomCourse, updateCustomCourse } from '../../../lib/customContent';
import { useAuthStore } from '../../../store/authStore';

export function CourseMenu({ id, title, onDone }: { id: string; title: string; onDone: (deleted: boolean) => Promise<void> }) {
  const owner = useAuthStore((state) => state.user);
  const [action, setAction] = useState<'rename' | 'delete' | null>(null);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (busy || !action) return;
    setBusy(true); setError('');
    try {
      if (action === 'delete') await archiveCustomCourse(id);
      else await updateCustomCourse(id, name.trim());
      if (useAuthStore.getState().user !== owner) return;
      await onDone(action === 'delete');
      setAction(null);
    } catch (reason) {
      if (useAuthStore.getState().user === owner) setError(reason instanceof Error && reason.message === 'compile-job-active' ? '请先完成或放弃当前草稿，再编辑或删除课程。' : '操作未完成，请稍后重试。');
    } finally { setBusy(false); }
  };
  return <>
    <Menu modal={false}>
      <MenuTrigger asChild><IconButton label={`课程操作：${title}`} size="sm"><Ellipsis size={16} /></IconButton></MenuTrigger>
      <MenuContent align="end" onCloseAutoFocus={(event) => { if (action) event.preventDefault(); }}>
        <MenuItem icon={<Pencil size={15} />} onSelect={() => { setName(title); setError(''); setAction('rename'); }}>编辑课程名称</MenuItem>
        <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => { setError(''); setAction('delete'); }}>删除课程</MenuItem>
      </MenuContent>
    </Menu>
    <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) setAction(null); }} title={action === 'delete' ? `删除「${title}」？` : '编辑课程名称'} description={action === 'delete' ? '课程及课题将从学习列表移除，资料库原件和历史学习记录会保留。' : undefined} size="sm" footer={<><Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>取消</Button><Button variant={action === 'delete' ? 'danger' : 'solid'} loading={busy} disabled={busy || action === 'rename' && name.trim().length < 2} onClick={() => void submit()}>{action === 'delete' ? '删除课程' : '保存'}</Button></>}>
      {action === 'rename' && <Field label="课程名称"><Input autoFocus aria-label="课程名称" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim().length >= 2) void submit(); }} /></Field>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  </>;
}
