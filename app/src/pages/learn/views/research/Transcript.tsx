/** 控制台时间线：用户的话、思考、工具调用、审批、提问、计划书、提示与结论。 */
import { useState, type ReactNode } from 'react';
import {
  Check, ChevronRight, CircleAlert, CircleHelp, CircleSlash, ClipboardList, FileText, Info, Paperclip, ShieldAlert, ShieldCheck, TriangleAlert, X,
} from 'lucide-react';
import { Badge, Button, Input, Shimmer, Textarea, ThinkingDots } from '../../../../components/ui';
import { IconSpark } from '../../../../components/ui/icons';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { SendTo } from '../../../../components/handoff';
import { planToMarkdown, toolLabel, type ApprovalAnswer, type FileMeta, type ResearchEvent, type ResearchProject, type ResearchSession } from '../../../../engine/research';
import { ToolCard } from './ToolCard';
import { WorkspaceMarkdown } from './WorkspaceMarkdown';
import r from './research.module.css';

type EventOf<T extends ResearchEvent['type']> = Extract<ResearchEvent, { type: T }>;

interface Handlers {
  onOpenFile: (path: string) => void;
  onApproval: (eventId: string, answer: ApprovalAnswer) => void;
  onAnswer: (eventId: string, answer: string) => void;
  onPlan: (eventId: string, action: 'approve' | 'dismiss', edited?: string) => void;
}

interface Props extends Handlers {
  owner: string | null;
  project: ResearchProject;
  session: ResearchSession;
  files: FileMeta[];
  /** 这次会话此刻是否真的在跑（刷新后残留的「运行中」不算） */
  live: boolean;
}

function UserTurn({ event }: { event: EventOf<'user'> }) {
  return (
    <div className={r.turn}>
      <span className={r.turnMark} aria-hidden="true">›</span>
      <div className={r.turnBody}>
        {event.command && <Badge tone="accent">/{event.command}</Badge>}
        <p>{event.command ? event.text.replace(new RegExp(`^/${event.command}\\s*`, 'i'), '') : event.text}</p>
        {event.attachments && event.attachments.length > 0 && (
          <div className={r.chips}>
            {event.attachments.map((name) => (
              <span key={name} className={r.chip} data-static><Paperclip size={13} strokeWidth={1.75} /><span>{name}</span></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingLine({ event }: { event: EventOf<'thinking'> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={r.think} data-open={open || undefined}>
      <button type="button" className={r.thinkHead} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} strokeWidth={1.75} className={r.thinkChevron} aria-hidden="true" />
        {event.streaming ? <Shimmer>正在思考…</Shimmer> : <span>思考过程</span>}
      </button>
      {open && <div className={r.thinkBody}>{event.text}</div>}
    </div>
  );
}

function ApprovalCard({ event, live, onApproval }: { event: EventOf<'approval'>; live: boolean; onApproval: Handlers['onApproval'] }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  if (event.status !== 'pending') {
    const allowed = event.status === 'allowed' || event.status === 'allowed_session';
    return (
      <div className={r.approvalDone} data-tone={allowed ? 'ok' : event.status === 'denied' ? 'bad' : 'muted'}>
        {allowed ? <ShieldCheck size={15} strokeWidth={1.75} /> : <CircleSlash size={15} strokeWidth={1.75} />}
        <span>
          {event.status === 'allowed' && '已允许一次'}
          {event.status === 'allowed_session' && '已允许（本次会话不再询问）'}
          {event.status === 'denied' && `已拒绝${event.reason ? `：${event.reason}` : ''}`}
          {event.status === 'expired' && '没有等到答复，已中断'}
          {' · '}{event.title}
        </span>
      </div>
    );
  }
  return (
    <section className={r.approval} data-risk={event.risk || undefined} aria-label="等待批准">
      <header className={r.approvalHead}>
        <span className={r.approvalIcon}><ShieldAlert size={17} strokeWidth={1.75} /></span>
        <div>
          <strong>{event.title}</strong>
          <span>{toolLabel(event.tool)} · {event.risk ? '需要你的批准' : '每步询问'}</span>
        </div>
      </header>
      {event.detail && <pre className={r.approvalDetail}>{event.detail}</pre>}
      {denying ? (
        <form
          className={r.approvalDeny}
          onSubmit={(submit) => { submit.preventDefault(); onApproval(event.id, { kind: 'deny', reason: reason.trim() }); }}
        >
          <Input autoFocus value={reason} maxLength={200} placeholder="告诉助手为什么不行，或者该怎么改" onChange={(change) => setReason(change.target.value)} aria-label="拒绝的理由" />
          <Button type="submit" variant="danger" size="sm">拒绝</Button>
          <Button variant="ghost" size="sm" onClick={() => setDenying(false)}>返回</Button>
        </form>
      ) : (
        <div className={r.approvalActions}>
          <Button variant="solid" size="sm" disabled={!live} onClick={() => onApproval(event.id, { kind: 'once' })}>允许一次</Button>
          <Button variant="soft" size="sm" disabled={!live} onClick={() => onApproval(event.id, { kind: 'session' })}>本次会话都允许</Button>
          <Button variant="ghost" size="sm" disabled={!live} onClick={() => setDenying(true)}>拒绝并说明</Button>
        </div>
      )}
    </section>
  );
}

function QuestionCard({ event, live, onAnswer }: { event: EventOf<'question'>; live: boolean; onAnswer: Handlers['onAnswer'] }) {
  return (
    <section className={r.question} data-status={event.status} aria-label="助手的提问">
      <header className={r.questionHead}>
        <CircleHelp size={16} strokeWidth={1.75} />
        <p>{event.question}</p>
      </header>
      {event.status === 'pending' && (
        <>
          {event.options.length > 0 && (
            <div className={r.questionOptions}>
              {event.options.map((option) => (
                <Button key={option} variant="outline" size="sm" disabled={!live} onClick={() => onAnswer(event.id, option)}>{option}</Button>
              ))}
            </div>
          )}
          <p className={r.questionHint}>在下面的输入框里回答，助手会接着做。</p>
        </>
      )}
      {event.status === 'answered' && <p className={r.questionAnswer}><span>你的回答</span>{event.answer}</p>}
      {event.status === 'expired' && <p className={r.questionHint}>没有等到回答，这一轮已中断。</p>}
    </section>
  );
}

function PlanList({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <div className={r.planPart}>
      <h4>{title}</h4>
      <List>{items.map((item, index) => <li key={index}>{item}</li>)}</List>
    </div>
  );
}

function PlanCard({ event, live, onPlan }: { event: EventOf<'plan'>; live: boolean; onPlan: Handlers['onPlan'] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { plan } = event;
  const pending = event.status === 'pending';
  return (
    <section className={r.planCard} data-status={event.status} aria-label="计划书">
      <header className={r.planHead}>
        <ClipboardList size={17} strokeWidth={1.75} />
        <strong>计划书</strong>
        {event.status === 'approved' && <Badge tone="ok" dot>已批准</Badge>}
        {event.status === 'dismissed' && <Badge>已放弃</Badge>}
        {pending && <Badge tone="warn" dot>等你批准</Badge>}
      </header>
      {editing ? (
        <Textarea className={r.planEditor} value={draft} rows={12} onChange={(change) => setDraft(change.target.value)} aria-label="修改计划" />
      ) : plan.raw ? (
        <div className={r.planRaw}><CoachMarkdown text={plan.raw} /></div>
      ) : (
        <div className={r.planBody}>
          <p className={r.planObjective}>{plan.objective}</p>
          <PlanList title="步骤" items={plan.steps} ordered />
          <PlanList title="来源" items={plan.sources} />
          <PlanList title="预期产出" items={plan.outputs} />
          <PlanList title="风险与假设" items={plan.risks} />
        </div>
      )}
      {pending && (
        <footer className={r.planActions}>
          {editing ? (
            <>
              <Button variant="solid" size="sm" disabled={live || !draft.trim()} onClick={() => onPlan(event.id, 'approve', draft)}>按修改后的执行</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>取消修改</Button>
            </>
          ) : (
            <>
              <Button variant="solid" size="sm" disabled={live} onClick={() => onPlan(event.id, 'approve')}>批准并执行</Button>
              <Button variant="soft" size="sm" disabled={live} onClick={() => { setDraft(planToMarkdown(plan)); setEditing(true); }}>修改</Button>
              <Button variant="ghost" size="sm" disabled={live} onClick={() => onPlan(event.id, 'dismiss')}>放弃</Button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}

const NOTICE_ICONS = { info: Info, warn: TriangleAlert, bad: CircleAlert } as const;

function NoticeLine({ event }: { event: EventOf<'notice'> }) {
  const Icon = NOTICE_ICONS[event.tone];
  return (
    <p className={r.notice} data-tone={event.tone} role={event.tone === 'bad' ? 'alert' : undefined}>
      <Icon size={15} strokeWidth={1.75} />
      <span>{event.text}</span>
    </p>
  );
}

function FinalCard({ event, owner, project, files, onOpenFile }: {
  event: EventOf<'final'>; owner: string | null; project: ResearchProject; files: FileMeta[];
  onOpenFile: Handlers['onOpenFile'];
}) {
  const unverified = event.sources.filter((source) => !source.verified).length;
  return (
    <section className={r.final} aria-label="结论">
      <header className={r.finalHead}>
        <span className={r.finalMark}><IconSpark size={16} /></span>
        <strong>结论</strong>
        <SendTo
          owner={owner}
          text={event.text}
          title={`${project.title} · 结论`}
          origin={{ section: 'research', label: `科研台：${project.title}`, open: { view: 'research', params: { project: project.id } } }}
          align="end"
        />
      </header>
      <div className={r.finalBody}>
        <WorkspaceMarkdown owner={owner} projectId={project.id} text={event.text} files={files} />
      </div>
      {event.files.length > 0 && (
        <div className={r.finalPart}>
          <h4>产出的文件</h4>
          <div className={r.chips}>
            {event.files.map((file) => (file.exists ? (
              <button key={file.path} type="button" className={r.chip} onClick={() => onOpenFile(file.path)}>
                <FileText size={14} strokeWidth={1.75} /><span>{file.path}</span>
              </button>
            ) : (
              <span key={file.path} className={r.chip} data-missing title="助手列出了这个文件，但课题里没有找到">
                <X size={13} strokeWidth={1.75} /><span>{file.path}（未找到）</span>
              </span>
            )))}
          </div>
        </div>
      )}
      {event.sources.length > 0 && (
        <div className={r.finalPart}>
          <h4>用到的文献</h4>
          <ol className={r.finalSources}>
            {event.sources.map((source, index) => (
              <li key={index} data-verified={source.verified || undefined}>
                {source.verified ? <Check size={14} strokeWidth={2} className={r.okMark} /> : <TriangleAlert size={14} strokeWidth={1.75} className={r.warnMark} />}
                <span>
                  {source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a> : source.label}
                  {!source.verified && <em>未在本次的检索记录里找到，请自行核对</em>}
                </span>
              </li>
            ))}
          </ol>
          {unverified > 0 && <p className={r.finalWarn}>有 {unverified} 条来源无法与检索记录对上，引用前请核对原文。</p>}
        </div>
      )}
    </section>
  );
}

export function Transcript({ owner, project, session, files, live, onOpenFile, onApproval, onAnswer, onPlan }: Props) {
  const nodes: ReactNode[] = session.events.map((event) => {
    switch (event.type) {
      case 'user': return <UserTurn key={event.id} event={event} />;
      case 'thinking': return <ThinkingLine key={event.id} event={event} />;
      case 'text': return <div key={event.id} className={r.say}><CoachMarkdown text={event.text} /></div>;
      case 'tool': return <ToolCard key={event.id} event={event} owner={owner} projectId={project.id} onOpenFile={onOpenFile} />;
      case 'approval': return <ApprovalCard key={event.id} event={event} live={live} onApproval={onApproval} />;
      case 'question': return <QuestionCard key={event.id} event={event} live={live} onAnswer={onAnswer} />;
      case 'plan': return <PlanCard key={event.id} event={event} live={live} onPlan={onPlan} />;
      case 'notice': return <NoticeLine key={event.id} event={event} />;
      case 'final': return <FinalCard key={event.id} event={event} owner={owner} project={project} files={files} onOpenFile={onOpenFile} />;
      default: return null;
    }
  });
  const last = session.events[session.events.length - 1];
  // 模型还没吐出第一个字时给一个「在想」的占位
  const waitingModel = live && session.status === 'running' && (!last || last.type === 'user' || last.type === 'notice' || (last.type === 'tool' && last.status !== 'running') || last.type === 'approval' || last.type === 'question');
  return (
    <div className={r.feed} role="log" aria-label="科研会话">
      {nodes}
      {waitingModel && <div className={r.pending}><ThinkingDots label="科研助手正在工作" /></div>}
    </div>
  );
}
