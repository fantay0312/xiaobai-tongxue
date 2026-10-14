/** 变更历史：记忆库的每一次写入。谁写的、为什么、改了哪几行；可以逐次撤销。 */
import { useState } from 'react';
import { ChevronRight, History, Undo2 } from 'lucide-react';
import { Badge, Button, Empty, toast } from '../../../../components/ui';
import { commitDiff, repoOps } from '../../../../engine/memoryRepo';
import type { EntryAuthor, RepoCommit, RepoId, RepoState } from '../../../../engine/memoryRepo';
import { DiffLines, formatWhen } from './repoShared';
import r from './repo.module.css';

interface Props {
  owner: string | null;
  repo: RepoId;
  state: RepoState;
  onOpenFile: (path: string) => void;
}

const AUTHOR: Record<EntryAuthor, { label: string; tone: 'neutral' | 'accent' | 'warn' }> = {
  auto: { label: '自动', tone: 'neutral' },
  user: { label: '我', tone: 'accent' },
  dream: { label: '做梦', tone: 'warn' },
};
const PAGE = 30;

export function RepoHistory({ owner, repo, state, onOpenFile }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const commits = state.commits;

  const revert = (commit: RepoCommit) => {
    const done = repoOps.revert(owner, repo, commit.id);
    if (done) toast.success('已撤销这次改动');
    else toast('这次改动涉及的条目后来都变过了，没有可撤的');
  };

  if (!commits.length) {
    return (
      <Empty
        icon={<History size={22} strokeWidth={1.75} />}
        title="还没有变更"
        description="记忆库每写入一次，这里就多一条：是自动记下的、你亲手改的，还是做梦整理的，改了哪几行，都看得到，也能撤销。"
      />
    );
  }

  return (
    <>
      <ol className={r.history}>
        {commits.slice(0, shown).map((commit) => {
          const classroomSync = commit.changes.some((change) => (change.before ?? change.after)?.id.startsWith('xb:') && !(change.before ?? change.after)?.id.endsWith(':fading'));
          const author = AUTHOR[commit.author];
          const expanded = open === commit.id;
          const files = expanded ? commitDiff(commit) : [];
          return (
            <li key={commit.id} className={r.commit} data-reverted={commit.reverted || undefined}>
              <div className={r.commitHead}>
                <button type="button" className={r.commitToggle} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : commit.id)}>
                  <span className={r.commitTitle}>
                    <ChevronRight size={16} strokeWidth={1.75} />
                    <span>{commit.message || '改动'}</span>
                  </span>
                  <span className={r.commitMeta}>
                    <Badge tone={author.tone}>{author.label}</Badge>
                    <span>{formatWhen(commit.at)}</span>
                    <span>{commit.changes.length} 处改动</span>
                    {commit.reverted && <span>已撤销</span>}
                  </span>
                </button>
                {!commit.reverted && !classroomSync && (
                  <Button size="sm" variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} onClick={() => revert(commit)}>撤销</Button>
                )}
                {classroomSync && <span className={r.commitMeta}>随课堂记录更新</span>}
              </div>
              {expanded && (
                <div className={r.diff}>
                  {files.map((file) => (
                    <div key={file.path} className={r.diffFile}>
                      <button type="button" className={r.diffPath} onClick={() => onOpenFile(file.path)}>{file.path}</button>
                      <DiffLines changes={commit.changes.filter((change) => change.path === file.path)} />
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {commits.length > shown && (
        <Button size="sm" variant="ghost" onClick={() => setShown((value) => value + PAGE)}>再看 {Math.min(PAGE, commits.length - shown)} 条</Button>
      )}
    </>
  );
}
