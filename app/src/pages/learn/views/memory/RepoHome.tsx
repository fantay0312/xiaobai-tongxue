/**
 * 记忆库入口页（MEMORY.md）下方的说明：记忆从哪里来、怎么用、存在哪。
 * 重点是让人看得见：记忆不只来自对话，做题、闪卡、笔记、上课、资料……整个应用都在往里送。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, toast } from '../../../../components/ui';
import { ACTIVITY_LABELS, useActivities } from '../../../../engine/activityLog';
import type { ActivitySource } from '../../../../engine/activityLog';
import { allEntries, repoOps } from '../../../../engine/memoryRepo';
import type { RepoId, RepoState } from '../../../../engine/memoryRepo';
import { resetTutorTraces, tutorMemoryHints } from '../../../../engine/tutorMemory';
import type { Topic } from '../../../../types';
import { sourceTypeLabel } from './repoShared';
import m from './memory.module.css';
import r from './repo.module.css';

interface Props {
  owner: string | null;
  repo: RepoId;
  state: RepoState;
  paused: boolean;
  topic?: Topic;
}

const WEEK_MS = 7 * 86_400_000;

export function RepoHome({ owner, repo, state, paused, topic }: Props) {
  const activities = useActivities(owner);
  const [hints, setHints] = useState<string[]>([]);
  const [clearOpen, setClearOpen] = useState(false);

  // 条目的出处：按来源类型数一数
  const origins = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { entry } of allEntries(state)) counts.set(entry.source.type, (counts.get(entry.source.type) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [state]);
  // 近 7 天的学习行为：按板块数一数
  const recent = useMemo(() => {
    const since = Date.now() - WEEK_MS;
    const counts = new Map<ActivitySource, number>();
    for (const activity of activities) if (Date.parse(activity.at) >= since) counts.set(activity.source, (counts.get(activity.source) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [activities]);
  const total = recent.reduce((sum, [, count]) => sum + count, 0);
  const outside = recent.filter(([source]) => source !== 'chat').reduce((sum, [, count]) => sum + count, 0);

  // 与对话里实际注入的要点同一个函数，所见即所用（放在 effect 里：它会顺手让记忆库跟上最新的学习行为）
  useEffect(() => {
    if (repo === 'xiaoyan') setHints(tutorMemoryHints(owner, topic?.topicId, 6));
  }, [owner, repo, topic?.topicId, state]);

  const clearAll = () => {
    repoOps.clear(owner, repo);
    resetTutorTraces(owner);
    setClearOpen(false);
    toast('记忆库已清空');
  };
  const deduplicate = () => {
    const count = repoOps.deduplicate(owner, repo);
    toast(count ? `已合并 ${count} 条重复记忆，可在变更历史中撤销` : '没有发现重复记忆');
  };

  return (
    <>
      <section className={r.sources} aria-labelledby="repo-sources-title">
        <h3 id="repo-sources-title">记忆从哪里来</h3>
        {allEntries(state).length > 0 && <Button size="sm" variant="ghost" onClick={deduplicate}>整理重复内容</Button>}
        {repo === 'xiaoyan' ? (
          <>
            <p>
              {total > 0
                ? `近 7 天记下了 ${total} 次学习行为，其中 ${outside} 次在对话之外。透露出卡住、学会、目标或兴趣的会进记忆库；只是「做了」的不记。`
                : '在终端里提问、做题、翻闪卡、读讲义、写笔记、上 AI 课、传资料，都会成为记忆的来源，不只是对话。'}
            </p>
            {recent.length > 0 && (
              <div className={r.sourceRow} aria-label="近 7 天的学习行为">
                {recent.map(([source, count]) => (
                  <span key={source} className={r.sourceCount} data-outside={source !== 'chat' || undefined}>{ACTIVITY_LABELS[source]}<b>{count}</b></span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p>小白的记忆来自你给他上的课（课堂记录在这里只读），和他自己做的梦。</p>
        )}
        {origins.length > 0 && (
          <>
            <p>库里现有条目的出处：</p>
            <div className={r.sourceRow}>
              {origins.map(([type, count]) => <span key={type} className={r.sourceCount}>{sourceTypeLabel(type)}<b>{count}</b></span>)}
            </div>
          </>
        )}
      </section>

      <section className={m.usage} aria-labelledby="repo-usage-title">
        <h3 id="repo-usage-title">这些记忆怎么用</h3>
        {repo === 'xiaoyan' ? (
          <ul>
            <li>你向小砚提问时，只有下面这几行会作为背景交给模型：始终记着的、置顶的、当前课程文件里最相关的几行。记忆库的其余内容不发出去。</li>
            <li>记忆库按账号保存在这个浏览器里。换设备，或清除浏览器数据后，不会跟过去。</li>
            <li>暂停后不再记入新的学习行为，回答时也不带记忆；暂停期间做的事，恢复后也不补记。</li>
            <li>密码、手机号、邮箱这类信息不会被记下。你删掉的自动记录，之后不会再自动记回来。</li>
          </ul>
        ) : (
          <ul>
            <li>小白上课时用到的是「先生怎么教」里的条目，和他梦醒后想问的那一句。</li>
            <li>课堂上发生的事在这里只读：讲明白的要点、打过的比方、想通和没想通的地方，会自动对账进各门课的文件。</li>
            <li>记忆库按账号保存在这个浏览器里；这份记忆不交给小砚。</li>
          </ul>
        )}
        {repo === 'xiaoyan' && (
          <div className={m.hintBox}>
            {paused ? (
              <p>记忆已暂停，现在提问不会带上任何一条。</p>
            ) : hints.length > 0 ? (
              <>
                <p>现在{topic ? `在《${topic.title}》里` : ''}提问，小砚会带上这 {hints.length} 行：</p>
                <ol className={m.hintList}>
                  {hints.map((hint) => <li key={hint}>{hint}</li>)}
                </ol>
              </>
            ) : (
              <p>还没有可以带上的记忆。</p>
            )}
          </div>
        )}
      </section>

      {repo === 'xiaoyan' && allEntries(state).length > 0 && (
        <div className={m.listFoot}>
          <span>每个文件最多 80 条，整库最多 400 条；满了先清最旧的自动记录。</span>
          <Button size="sm" variant="ghost" onClick={() => setClearOpen(true)}>清空记忆库</Button>
        </div>
      )}

      <Dialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        size="sm"
        title="清空小砚的记忆库？"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>取消</Button>
            <Button variant="danger" onClick={clearAll}>清空</Button>
          </>
        )}
      >
        <p className={m.lessonLine}>全部文件和变更历史都会清掉，置顶的也在内，不能撤销。小白的记忆库不受影响。</p>
      </Dialog>
    </>
  );
}
