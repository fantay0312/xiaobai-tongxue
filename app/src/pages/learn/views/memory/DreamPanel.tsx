/**
 * 梦境 —— 两份记忆各自的离线整理（engine/dreams）。
 * 这里只负责说清三件事：做梦是什么、上次和下次什么时候整理、每场梦改了什么。
 * 小砚的梦是普通卡片；小白的梦是故事物件，用纸条 + 他的手写体（data-story 岛）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MoonStar, Trash2 } from 'lucide-react';
import { Badge, Button, Empty, IconButton, Shimmer, Switch, toast } from '../../../../components/ui';
import { useActivities } from '../../../../engine/activityLog';
import {
  DREAM_INTERVAL_HOURS, applyDreamProposal, discardDreamProposal, dreamNow, dreamStatus, removeDream, setDreamReview, useDreams,
} from '../../../../engine/dreams';
import type { DreamChange, DreamEntry, Dreamer } from '../../../../engine/dreams';
import { loadRepo, useRepo } from '../../../../engine/memoryRepo';
import type { ProposalKind } from '../../../../engine/memoryRepo';
import { useAppStore } from '../../../../store/appStore';
import { DiffLines } from './repoShared';
import s from './dream.module.css';
import r from './repo.module.css';

interface Props {
  owner: string | null;
  who: Dreamer;
}

const NAME: Record<Dreamer, string> = { xiaoyan: '小砚', xiaobai: '小白' };
const GROUPS: { kind: DreamChange['kind']; label: string }[] = [
  { kind: 'merged', label: '合并' },
  { kind: 'promoted', label: '提炼' },
  { kind: 'faded', label: '淡忘' },
  { kind: 'kept', label: '加深' },
  { kind: 'question', label: '还想问' },
];
const ABOUT: Record<Dreamer, string> = {
  xiaoyan: '做梦就是空闲时把记忆库重新过一遍：合并重复的，从做题、闪卡、提问这些反复出现的事里提炼出一条，把很久没提起的归档，前后说法相反时对照出处和日期留下站得住的那条。每场梦是记忆库里的一次提交，能看差异，也能撤销；置顶的和你自己写的不会动。',
  xiaobai: '做梦就是空闲时把记下的东西重新过一遍。小白回放的是你最近教他的课：哪些记牢了，哪些开始模糊，还有哪句想问你。他的梦只往自己的记忆库里写（还想问的、开始模糊的），不改课堂上的任何数据。',
};
const PROPOSAL_LABEL: Record<ProposalKind, string> = { merged: '合并', promoted: '提炼', faded: '归档', kept: '加深', question: '还想问', moved: '挪走', ruled: '排除' };
const REVIEW_LABEL: Record<NonNullable<DreamEntry['review']>, string> = { pending: '等你确认', applied: '已采纳', discarded: '没采纳' };

/** 今天 14:05 / 昨天 21:30 / 明天 09:10 / 10月12日 21:30 */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayGap = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = dayGap === 0 ? '今天' : dayGap === -1 ? '昨天' : dayGap === 1 ? '明天' : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${clock}`;
}

function DreamGroups({ changes }: { changes: DreamChange[] }) {
  const groups = GROUPS.map((group) => ({ ...group, items: changes.filter((change) => change.kind === group.kind) })).filter((group) => group.items.length > 0);
  if (!groups.length) return null;
  return (
    <dl className={s.groups}>
      {groups.map((group) => (
        <div key={group.kind} className={s.group} data-kind={group.kind}>
          <dt>{group.label}</dt>
          <dd>
            <ul>
              {group.items.map((change, index) => <li key={index}>{change.text}</li>)}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DreamPanel({ owner, who }: Props) {
  const allDreams = useDreams(owner);
  const dreams = useMemo(() => allDreams.filter((dream) => dream.who === who), [allDreams, who]);
  // 订阅记忆库、学习行为和课堂数据的变动，状态里的「新内容」才会跟着更新
  const repo = useRepo(owner, who);
  const activities = useActivities(owner);
  const events = useAppStore((st) => st.events);
  const xiaobaiPaused = useAppStore((st) => st.memory.paused);
  const status = useMemo(() => dreamStatus(owner, who), [owner, who, allDreams, repo, activities, events, xiaobaiPaused]);
  const pending = repo.pending;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // 换一份记忆看时，清掉上一份的提示
  useEffect(() => {
    setNote(null);
    setFreshId(null);
  }, [owner, who]);

  const name = NAME[who];
  const apply = (ids?: string[]) => {
    applyDreamProposal(owner, who, ids);
    const remaining = loadRepo(owner, who).pending?.changes.filter((change) => !ids || ids.includes(change.id)).length ?? 0;
    if (remaining) toast('部分记忆已被修改，保留了你的修改。请核对后丢弃旧建议。');
    else toast.success('已采纳，记忆库已更新');
  };
  const run = async () => {
    setBusy(true);
    setNote(null);
    const entry = await dreamNow(owner, who);
    if (!mounted.current) return;
    setBusy(false);
    if (entry) {
      setFreshId(entry.id);
      return;
    }
    setNote(status.paused
      ? `${name}的记忆暂停着，暂停期间不整理。先把上面的「暂停记忆」关掉。`
      : status.pendingChanges
        ? '上一场梦提出的改动还没处理完。先在下面采纳或丢弃，再整理下一场。'
        : who === 'xiaoyan'
          ? '没有新的内容可以整理。再学一会儿——提问、做题、翻闪卡都算，有了新记下的东西再来。'
          : '没有新的内容可以整理。再给小白上一课，他才有新的梦可做。');
  };

  const freshLine = who === 'xiaoyan'
    ? status.freshItems || status.freshTurns || status.freshActivities
      ? `${status.freshItems} 条记忆有新增或变动，${status.freshTurns} 次新提问，${status.freshActivities} 次对话之外的学习行为`
      : '没有新内容'
    : status.freshLessons
      ? `新上了 ${status.freshLessons} 门课`
      : '没有新上的课';
  const hasFresh = status.canDreamNow;
  const nextLine = status.paused
    ? '记忆暂停着，暂停期间不整理。'
    : status.nextAutoAt
      ? `最早 ${formatWhen(status.nextAutoAt)} 之后。那时有新内容的话，打开学习终端就会自动整理。`
      : hasFresh
        ? '下次打开学习终端时会自动整理，也可以现在就整理。'
        : '等有了新内容，打开学习终端时会自动整理。';

  return (
    <div className={s.panel}>
      <p className={s.about}>{ABOUT[who]}</p>

      <section className={s.status} aria-label="整理状态">
        <dl className={s.facts}>
          <div>
            <dt>上次整理</dt>
            <dd>{status.lastDreamAt ? formatWhen(status.lastDreamAt) : '还没整理过'}</dd>
          </div>
          <div>
            <dt>攒下的</dt>
            <dd>{freshLine}</dd>
          </div>
          <div>
            <dt>下次整理</dt>
            <dd>{nextLine}</dd>
          </div>
        </dl>
        <div className={s.run}>
          {busy && <Shimmer className={s.running}>{name}正在整理…</Shimmer>}
          <Button variant="solid" icon={<MoonStar size={16} strokeWidth={1.75} />} loading={busy} onClick={() => void run()}>
            现在整理
          </Button>
        </div>
      </section>
      {note && <p className={s.note} role="status">{note}</p>}

      <div className={r.reviewRow}>
        <div>
          <strong>{status.review ? '先给我看再生效' : '做梦后直接生效'}</strong>
          <span>
            {status.review
              ? '梦里想做的改动先列在下面，你逐条采纳或丢弃后才写进记忆库。'
              : '梦里的改动直接写进记忆库；每一场都能在变更历史里看差异、撤销。'}
          </span>
        </div>
        <div className={s.run}>
          <label htmlFor={`dream-review-${who}`}>先给我看</label>
          <Switch id={`dream-review-${who}`} checked={status.review} onCheckedChange={(next) => setDreamReview(owner, who, next)} label="做梦后先给我看再生效" />
        </div>
      </div>

      {pending && (
        <section className={r.proposal} aria-label="等你确认的改动">
          <div className={r.proposalHead}>
            <div>
              <h3>等你确认：{pending.title}</h3>
              <p>{formatWhen(pending.at)} 的梦提出了 {pending.changes.length} 处改动，采纳的才会写进记忆库。</p>
            </div>
            <div className={r.proposalActions}>
              <Button size="sm" variant="ghost" onClick={() => discardDreamProposal(owner, who)}>全部丢弃</Button>
              <Button size="sm" variant="solid" onClick={() => apply()}>全部采纳</Button>
            </div>
          </div>
          <ul className={r.proposalList}>
            {pending.changes.map((change) => (
              <li key={change.id} className={r.proposalItem}>
                <div className={r.proposalTop}>
                  <span className={r.proposalNote}>
                    <Badge tone="warn">{PROPOSAL_LABEL[change.kind]}</Badge>
                    <span>{change.note}{change.toPath ? `（${change.path} → ${change.toPath}）` : `（${change.path}）`}</span>
                  </span>
                  <span className={r.proposalActions}>
                    <Button size="sm" variant="ghost" onClick={() => discardDreamProposal(owner, who, [change.id])}>丢弃</Button>
                    <Button size="sm" variant="outline" onClick={() => apply([change.id])}>采纳</Button>
                  </span>
                </div>
                <DiffLines changes={[change]} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="梦境记录" className={s.panel}>
        <div className={s.journalHead}>
          <h2>梦境记录</h2>
          <span>{dreams.length ? `共 ${dreams.length} 场，最多留 20 场` : `两场自动的梦至少隔 ${DREAM_INTERVAL_HOURS} 小时`}</span>
        </div>

        {dreams.length === 0 ? (
          <Empty
            icon={<MoonStar size={22} strokeWidth={1.75} />}
            title={`${name}还没做过梦`}
            description={who === 'xiaoyan'
              ? '和小砚聊过几轮、她记下一些东西之后，点「现在整理」，或者等下次打开学习终端时自动整理。'
              : '给小白上过课之后，点「现在整理」，或者等下次打开学习终端时自动整理。'}
          />
        ) : (
          <ol className={s.journal}>
            {dreams.map((dream) => (
              <li key={dream.id}>
                {who === 'xiaobai'
                  ? <PaperDream dream={dream} fresh={dream.id === freshId} onRemove={() => removeDream(owner, dream.id)} />
                  : <CardDream dream={dream} fresh={dream.id === freshId} onRemove={() => removeDream(owner, dream.id)} />}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

interface DreamProps { dream: DreamEntry; fresh: boolean; onRemove: () => void }

function CardDream({ dream, fresh, onRemove }: DreamProps) {
  return (
    <article className={s.entry} data-fresh={fresh || undefined}>
      <header className={s.entryHead}>
        <div>
          <h3>{dream.title}</h3>
          <div className={s.entryMeta}>
            <span>{formatWhen(dream.at)}</span>
            <Badge tone={dream.method === 'model' ? 'accent' : 'neutral'}>{dream.method === 'model' ? '模型整理' : '本地规则整理'}</Badge>
            {dream.review && <Badge tone={dream.review === 'pending' ? 'warn' : 'outline'}>{REVIEW_LABEL[dream.review]}</Badge>}
          </div>
        </div>
        <IconButton size="sm" label="删掉这条记录" onClick={onRemove}>
          <Trash2 size={15} strokeWidth={1.75} />
        </IconButton>
      </header>
      <p className={s.narrative}>{dream.narrative}</p>
      <DreamGroups changes={dream.changes} />
    </article>
  );
}

function PaperDream({ dream, fresh, onRemove }: DreamProps) {
  return (
    <article className={s.paper} data-story data-fresh={fresh || undefined}>
      <header className={s.entryHead}>
        <div>
          <h3>{dream.title}</h3>
          <div className={s.entryMeta}>
            <span>{formatWhen(dream.at)}</span>
            <span className={s.paperTag}>{dream.method === 'model' ? '模型整理' : '本地规则整理'}</span>
            {dream.review && <span className={s.paperTag}>{REVIEW_LABEL[dream.review]}</span>}
          </div>
        </div>
        {/* 纸条上不用通用按钮：它的颜色跟着皮肤走，在深色皮肤的浅色纸面上会看不清 */}
        <button type="button" className={s.paperRemove} aria-label="删掉这张纸条" title="删掉这张纸条" onClick={onRemove}>
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </header>
      <p className={s.narrative}>{dream.narrative}</p>
      <p className={s.sign}>—— 小白，醒来记</p>
      <DreamGroups changes={dream.changes} />
    </article>
  );
}
