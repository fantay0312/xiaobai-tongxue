/**
 * 资料库里「生成的内容」这一半用到的小件：来源标记、云端副本状态、自动保存开关、
 * 成果详情、文件的「被用于」与就地生成。列表本身仍在 LibraryPage。
 */
import type { ReactNode } from 'react';
import {
  ArrowUpRight, Bot, Cloud, CloudCheck, CloudOff, CloudUpload, FlaskConical, GraduationCap, HardDrive, Layers, ListChecks, MessageSquare, Network,
  NotebookPen, PencilRuler, Presentation, RefreshCw, TriangleAlert, Upload,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Spinner, Switch } from '../../components/ui';
import { ARTIFACT_LABELS, type Artifact, type ArtifactOrigin } from '../../lib/artifacts';
import type { CrossAction } from '../../lib/crossActions';
import {
  GENERATED_FOLDER, retryLibrarySync, setLibraryAutoSync,
  type CloudCopy, type LibrarySyncState, type LibraryUse, type LibraryUseKind,
} from '../../lib/librarySync';
import s from './library.module.css';

/* ── 来源 ── */
export type OriginId = 'upload' | ArtifactOrigin['section'];
export const ORIGIN_ORDER: OriginId[] = ['upload', 'chat', 'workbench', 'lesson', 'agent', 'research', 'teach'];
export const ORIGIN_LABELS: Record<OriginId, string> = {
  upload: '上传', chat: '对话', workbench: '工作台', lesson: 'AI 课堂', agent: '助理', research: '科研台', teach: '教小白',
};
const ORIGIN_ICONS: Record<OriginId, LucideIcon> = {
  upload: Upload, chat: MessageSquare, workbench: PencilRuler, lesson: Presentation, agent: Bot, research: FlaskConical, teach: GraduationCap,
};
export const originIcon = (origin: OriginId, size = 14): ReactNode => {
  const Glyph = ORIGIN_ICONS[origin] ?? Upload;
  return <Glyph size={size} strokeWidth={1.75} />;
};

/** 列表里的来源标记：小图标 + 板块名 */
export function OriginChip({ origin, title }: { origin: OriginId; title?: string }) {
  return (
    <span className={s.origin} data-origin={origin} title={title}>
      {originIcon(origin, 13)}
      <span>{ORIGIN_LABELS[origin] ?? '其他'}</span>
    </span>
  );
}

/* ── 云端副本状态 ── */
export type CopyState = 'local' | 'synced' | 'stale' | 'syncing';

/** liveFiles 是资料库里现存文件的 id；副本对应的文件不在了就按「本机」算 */
export function copyState(sync: LibrarySyncState, artifact: Artifact, liveFiles: Set<string> | null): CopyState {
  if (sync.active.includes(artifact.key)) return 'syncing';
  const copy = sync.copies[artifact.key];
  if (!copy || copy.removed || (liveFiles && !liveFiles.has(copy.fileId))) return 'local';
  return copy.seen === artifact.updatedAt ? 'synced' : 'stale';
}

export function CopyBadge({ state }: { state: CopyState }) {
  if (state === 'syncing') return <Badge tone="accent" dot>正在保存</Badge>;
  if (state === 'synced') return <Badge tone="ok"><CloudCheck size={12} strokeWidth={2} />已存云端</Badge>;
  if (state === 'stale') return <Badge tone="warn"><Cloud size={12} strokeWidth={2} />云端待更新</Badge>;
  return <Badge tone="outline"><HardDrive size={12} strokeWidth={2} />本机</Badge>;
}

/* ── 自动保存开关与状态 ── */
const clock = (iso?: string) => {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time)) : '';
};

function syncLine(sync: LibrarySyncState, pending: number, reachable: boolean): { tone: 'ok' | 'warn' | 'muted' | 'busy'; text: string } {
  if (sync.phase === 'signed-out') return { tone: 'muted', text: '登录后才会保存到云端。' };
  if (sync.phase === 'syncing') return { tone: 'busy', text: `正在保存 ${sync.active.length} 份…` };
  if (sync.phase === 'off') return { tone: 'muted', text: '已关闭，生成的内容只留在这台设备上。' };
  if (sync.phase === 'offline' || !reachable) return { tone: 'warn', text: '资料库暂时连不上，连上后会自动接着保存。' };
  if (sync.phase === 'budget') return { tone: 'warn', text: `今天自动保存已到上限（${sync.budget} 份），明天继续。` };
  if (pending) return { tone: 'muted', text: `${pending} 份等待保存，停笔一会儿后自动进行。` };
  return { tone: 'ok', text: `生成的内容都已存到云端${sync.lastSyncAt ? ` · 上次 ${clock(sync.lastSyncAt)}` : ''}` };
}

export function SyncControl({ owner, sync, pending, reachable }: {
  owner: string | null; sync: LibrarySyncState;
  /** 还没有云端副本（或副本过期）的份数 */
  pending: number;
  /** 资料库页自己是否读到了列表 */
  reachable: boolean;
}) {
  const line = syncLine(sync, pending, reachable);
  const alert = !!sync.lastError || (sync.auto && sync.phase !== 'signed-out' && (sync.phase === 'offline' || !reachable));
  const Glyph = !sync.auto ? CloudOff : sync.phase === 'syncing' ? CloudUpload : alert ? Cloud : CloudCheck;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={s.syncButton} data-alert={alert || undefined} icon={<Glyph size={15} strokeWidth={1.75} />} aria-label="自动保存到资料库">
          <span>{!sync.auto ? '自动保存已关' : sync.phase === 'syncing' ? '正在保存' : '自动保存'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={s.syncPanel}>
        <div className={s.syncSwitch}>
          <label htmlFor="library-auto-sync">自动把生成的内容存一份到资料库</label>
          <Switch id="library-auto-sync" checked={sync.auto} onCheckedChange={(next) => setLibraryAutoSync(owner, next)} label="自动把生成的内容存一份到资料库" />
        </div>
        <p className={s.syncNote}>
          对话、工作台、AI 课堂、助理和科研台里做出来的内容，会在云端「{GENERATED_FOLDER}」文件夹留一份文件，小砚可以把它当资料引用。
        </p>
        <p className={s.syncStatus} data-tone={line.tone} role="status">
          {line.tone === 'busy' ? <Spinner size={14} /> : line.tone === 'warn' ? <TriangleAlert size={14} strokeWidth={1.75} /> : line.tone === 'ok' ? <CloudCheck size={14} strokeWidth={1.75} /> : <Cloud size={14} strokeWidth={1.75} />}
          <span>{line.text}</span>
        </p>
        {sync.lastError && (
          <p className={s.syncStatus} data-tone="bad" role="alert">
            <TriangleAlert size={14} strokeWidth={1.75} />
            <span>{sync.lastError.text}（{clock(sync.lastError.at)}）</span>
          </p>
        )}
        <div className={s.syncFoot}>
          <span>今天已自动保存 {sync.autoCount} / {sync.budget} 份</span>
          <Button variant="soft" size="sm" icon={<RefreshCw size={14} />} disabled={!sync.auto || sync.phase === 'signed-out' || sync.phase === 'syncing'} onClick={() => retryLibrarySync(owner)}>立即同步</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── 被用于 ── */
const USE_ICONS: Record<LibraryUseKind, LucideIcon> = {
  chat: MessageSquare, course: GraduationCap, lesson: Presentation, agent: Bot, research: FlaskConical, workbench: PencilRuler,
};

export function UsedIn({ uses, empty, onJump }: { uses: LibraryUse[]; empty: string; onJump: (open: NonNullable<LibraryUse['open']>) => void }) {
  if (!uses.length) return <p>{empty}</p>;
  return (
    <>
      {uses.map((use) => {
        const Glyph = USE_ICONS[use.kind] ?? MessageSquare;
        const target = use.open;
        return (
          <div key={`${use.kind}:${use.label}`} className={s.linkRow}>
            <Glyph size={16} strokeWidth={1.75} />
            <span>{use.label}<small>{clock(use.at)}</small></span>
            {target && <Button variant="ghost" size="sm" iconRight={<ArrowUpRight size={14} />} onClick={() => onJump(target)}>去看看</Button>}
          </div>
        );
      })}
    </>
  );
}

/** 「板块 · 说明」；说明本身已经以板块名开头时不重复 */
function originText(artifact: Artifact): string {
  const section = ORIGIN_LABELS[artifact.origin.section] ?? '';
  const label = artifact.origin.label ?? '';
  return label.startsWith(section) ? label : [section, label].filter(Boolean).join(' · ');
}

/* ── 成果详情（预览器「详情」页签） ── */
export function MadeDetails({ artifact, state, copy, copyPath, uses, saving, formatDate, onSave, onShowCopy, onOrigin, onJump }: {
  artifact: Artifact; state: CopyState; copy?: CloudCopy;
  /** 副本在资料库里的位置，如「我生成的 / 笔记」 */
  copyPath?: string;
  uses: LibraryUse[]; saving: boolean;
  formatDate: (iso: string) => string;
  onSave: () => void;
  onShowCopy?: () => void;
  onOrigin?: () => void;
  onJump: (open: NonNullable<LibraryUse['open']>) => void;
}) {
  return (
    <div className={s.details}>
      <dl className={s.facts}>
        <div><dt>类型</dt><dd>{ARTIFACT_LABELS[artifact.kind] ?? '生成的内容'}</dd></div>
        <div><dt>来源</dt><dd>{originText(artifact)}</dd></div>
        {artifact.topicTitle && <div><dt>所属课题</dt><dd>{artifact.topicTitle}</dd></div>}
        <div><dt>怎么来的</dt><dd>{artifact.madeBy === 'ai' ? '小砚生成' : '自己写的'}</dd></div>
        <div><dt>创建时间</dt><dd>{formatDate(artifact.createdAt)}</dd></div>
        <div><dt>最近更新</dt><dd>{formatDate(artifact.updatedAt)}</dd></div>
      </dl>
      <section className={s.detailCard}>
        <header>
          <h3>云端副本</h3>
          <CopyBadge state={state} />
        </header>
        <p>
          {state === 'synced' ? `已在资料库留了一份文件${copyPath ? `：${copyPath} / ${copy?.name ?? ''}` : ''}，可以像上传的资料一样被引用。`
            : state === 'stale' ? '内容在上次保存之后改过，云端那份还是旧的。'
              : state === 'syncing' ? '正在保存到资料库…'
                : '现在只保存在这台设备的浏览器里。存一份到云端后，换设备也能看到，小砚也能把它当资料引用。'}
        </p>
        <div className={s.detailActions}>
          <Button variant="soft" size="sm" icon={<CloudUpload size={14} />} loading={saving} disabled={state === 'syncing'} onClick={onSave}>
            {state === 'local' ? '存一份到云端' : '更新云端副本'}
          </Button>
          {onShowCopy && state !== 'local' && <Button variant="ghost" size="sm" onClick={onShowCopy}>在资料库中查看</Button>}
        </div>
      </section>
      <section className={s.detailCard}>
        <header>
          <h3>被用于</h3>
        </header>
        <UsedIn uses={uses} empty="还没有用在别处。可以把它用于对话，让小砚照着它来讲。" onJump={onJump} />
      </section>
      {onOrigin && (
        <section className={s.detailCard}>
          <header>
            <h3>来源</h3>
            <Button variant="soft" size="sm" iconRight={<ArrowUpRight size={14} />} onClick={onOrigin}>查看来源</Button>
          </header>
          <p>{artifact.origin.label ?? `来自${ORIGIN_LABELS[artifact.origin.section]}`}</p>
        </section>
      )}
    </div>
  );
}

/* ── 上传文件：就地生成 ── */
export type FileMakeAction = Exclude<CrossAction, 'save-note' | 'add-todos'> | 'summary-note';
const MAKE_ACTIONS: { id: FileMakeAction; label: string; icon: LucideIcon }[] = [
  { id: 'make-flashcards', label: '生成闪卡', icon: Layers },
  { id: 'make-mindmap', label: '生成导图', icon: Network },
  { id: 'make-quiz', label: '出题', icon: ListChecks },
  { id: 'summary-note', label: '存摘要为笔记', icon: NotebookPen },
];

export function FileMake({ making, disabled, hint, onMake }: {
  /** 正在进行的动作 */
  making: FileMakeAction | null;
  disabled: boolean;
  hint: string;
  onMake: (action: FileMakeAction) => void;
}) {
  return (
    <section className={s.detailCard}>
      <header>
        <h3>用这份资料生成</h3>
      </header>
      <p>{hint}</p>
      <div className={s.detailActions}>
        {MAKE_ACTIONS.map(({ id, label, icon: Glyph }) => (
          <Button key={id} variant="soft" size="sm" icon={<Glyph size={14} strokeWidth={1.75} />} loading={making === id} disabled={disabled || (making !== null && making !== id)} onClick={() => onMake(id)}>
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** 没有模型时的摘要：从原文里摘小节标题和开头几句，并标明是本地演示 */
export function localSummary(text: string): string {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const heads = lines.filter((line) => /^#{1,4}\s/.test(line)).slice(0, 8).map((line) => `- ${line.replace(/^#+\s*/, '')}`);
  const sentences = text.replace(/^#{1,6}\s.*$/gm, ' ').replace(/\s+/g, ' ').split(/(?<=[。！？!?])/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 12).slice(0, 6);
  return [
    '> 本地演示：没有连接模型，下面是从原文里直接摘出的内容。',
    heads.length ? `## 提到的小节\n\n${heads.join('\n')}` : '',
    sentences.length ? `## 开头几句\n\n${sentences.map((sentence) => `- ${sentence}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
