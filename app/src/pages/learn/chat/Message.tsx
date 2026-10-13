/** 对话流里的三种行：我的提问、小砚的回答、等待中的占位。 */
import { memo, useEffect, useRef, useState } from 'react';
import { Check, CircleSlash, Copy, FolderInput, Forward, RotateCcw, Square, TriangleAlert, Volume2 } from 'lucide-react';
import { CoachMarkdown } from '../../../components/coach/CoachMarkdown';
import { SendTo } from '../../../components/handoff/SendTo';
import { useOpenTarget } from '../../../components/handoff/useOpenTarget';
import h from '../../../components/handoff/handoff.module.css';
import { Button, IconButton, Shimmer, ThinkingDots, toast } from '../../../components/ui';
import type { StudyMessage, StudySource } from '../../../engine/studyWorkspace';
import type { ArtifactOrigin } from '../../../lib/artifacts';
import { EFFORT_LABELS, type Effort } from '../../../store/modelPrefs';
import { IntelligentAnswer } from '../IntelligentAnswer';
import { LearningActivity } from '../LearningActivity';
import { keepStructured, keepableSummary } from './keep';
import { speechSupported, toggleSpeak } from './speech';
import type { ChatFeedProps, ChatHandoff } from './types';
import { XiaoyanAvatar } from './XiaoyanAvatar';
import s from './feed.module.css';

/** 由 ChatFeed 包成引用稳定的回调，消息行才能用 memo 跳过无关重绘 */
export type FeedHandlers = Pick<ChatFeedProps, 'onAsk' | 'onSource' | 'onSaveNote' | 'onInteraction' | 'onRegenerate'>;

const ICON = { size: 15, strokeWidth: 1.75 } as const;

/** 写剪贴板；非安全上下文（局域网 http）退回 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 继续走兜底 */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch { return false; }
}

/** 点一下亮起、过一会儿自己熄灭的小状态（「已复制」对勾） */
function useFlash(duration = 1600): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = () => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), duration);
  };
  return [on, flash];
}

async function copyWithToast(text: string, flash: () => void) {
  if (await copyText(text)) { flash(); toast.success('已复制'); } else toast.error('复制失败，请手动选择文字复制');
}

/* ── 我的提问 ── */
export const UserMessage = memo(function UserMessage({ message }: { message: StudyMessage }) {
  const [copied, flash] = useFlash();
  const [expanded, setExpanded] = useState(false);
  const long = message.text.length > 520 || message.text.split('\n').length > 12;
  return (
    <article className={s.user} aria-label="我的提问">
      <div className={s.userBubble} data-clamped={(long && !expanded) || undefined}>{message.text}</div>
      <div className={s.userTools}>
        {long && (
          <button type="button" className={s.linkButton} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
        <IconButton size="sm" label={copied ? '已复制' : '复制'} onClick={() => void copyWithToast(message.text, flash)}>
          {copied ? <Check {...ICON} /> : <Copy {...ICON} />}
        </IconButton>
      </div>
    </article>
  );
});

/* ── 来源：编号小签，多于四条时先收起 ── */
function SourceChips({ sources, onSource }: { sources: StudySource[]; onSource: (source: StudySource) => void }) {
  const [all, setAll] = useState(false);
  const limit = 4;
  const visible = all ? sources : sources.slice(0, limit);
  return (
    <div className={s.sources} aria-label={`${sources.length} 处来源`}>
      <span className={s.sourcesLabel}>来源</span>
      {visible.map((source, index) => (
        <button key={`${source.id}:${index}`} type="button" className={s.sourceChip} title={source.title} onClick={() => onSource(source)}>
          <i>{index + 1}</i><span>{source.title}</span>
        </button>
      ))}
      {sources.length > limit && (
        <button type="button" className={s.sourceMore} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? '收起' : `+${sources.length - limit}`}
        </button>
      )}
    </div>
  );
}

const isEffort = (value: string | undefined): value is Effort => Boolean(value && Object.hasOwn(EFFORT_LABELS, value));

function metaLabel(message: StudyMessage, modelLabel?: string): string {
  const parts: string[] = [];
  if (message.local) parts.push('资料摘编');
  if (message.engine === 'deeptutor') parts.push(`DeepTutor · ${message.rounds ?? 1} 轮核对`);
  if (modelLabel) parts.push(modelLabel);
  if (isEffort(message.effort)) parts.push(EFFORT_LABELS[message.effort]);
  return parts.join(' · ');
}

/* ── 小砚的回答 ── */
export const AssistantMessage = memo(function AssistantMessage({ message, streaming, last, busy, speaking, modelLabel, handlers, handoff, origin, asked }: {
  message: StudyMessage;
  streaming: boolean;
  /** 对话里的最后一条：操作条常显 */
  last: boolean;
  busy: boolean;
  speaking: boolean;
  modelLabel?: string;
  handlers: FeedHandlers;
  /** 交给别的板块时带的上下文；不给就不显示「发送到」 */
  handoff?: ChatHandoff;
  /** 这条回答的来源：哪段对话 */
  origin?: ArtifactOrigin;
  /** 这条回答对应的提问，用来给存下来的东西起名 */
  asked?: string;
}) {
  const [copied, flashCopied] = useFlash();
  const [kept, flashKept] = useFlash(2400);
  const seenAt = useRef(Date.now());
  const openTarget = useOpenTarget();

  const hasBody = Boolean(message.ui) || message.text.trim().length > 0;
  const status = message.run?.status;
  const live = streaming || status === 'running';
  const thought = Boolean(message.reasoning?.trim());
  const showProcess = Boolean(message.run) || thought || (message.thinkingMs ?? 0) >= 1000 || (live && !hasBody);
  const meta = metaLabel(message, modelLabel);

  const sendTitle = (asked ?? '').split('\n')[0].trim().slice(0, 28) || undefined;
  // 回答里已经是结构化的小测验、闪卡、计划、导图：可以原样收下
  const keepable = handoff && message.ui ? keepableSummary(message.ui) : '';
  const keep = () => {
    if (!handoff || !message.ui) return;
    const items = keepStructured(handoff.owner, message.ui, { title: sendTitle ?? handoff.topicTitle ?? '对话里的内容', topicId: handoff.topicId, origin });
    if (!items.length) return;
    flashKept();
    toast.success(`已收进工作台：${items.map((item) => item.label).join('、')}`, { action: { label: '打开', onClick: () => openTarget(items[0].open) } });
  };

  return (
    <article className={s.assistant} aria-label="小砚的回答" aria-busy={live || undefined}>
      <header className={s.identity}>
        <XiaoyanAvatar thinking={live && !hasBody} />
        <strong>小砚</strong>
      </header>

      <div className={s.card}>
        {showProcess && (
          <LearningActivity
            run={message.run}
            reasoning={message.reasoning}
            thinkingMs={message.thinkingMs}
            live={live}
            answerStarted={hasBody}
            startedAt={seenAt.current}
          />
        )}

        {hasBody && (
          <div className={s.body} data-streaming={live || undefined}>
            {message.ui ? (
              <IntelligentAnswer
                ui={message.ui}
                sources={message.sources}
                interaction={message.interaction ?? {}}
                onChange={(blockId, state) => handlers.onInteraction(message.id, blockId, state)}
                onAsk={handlers.onAsk}
                onSource={handlers.onSource}
                onSave={(text) => handlers.onSaveNote(text, message.sources)}
              />
            ) : (
              <CoachMarkdown text={message.text} />
            )}
          </div>
        )}

        {status === 'stopped' && (
          <div className={s.runState} role="status">
            <CircleSlash {...ICON} />
            <span>{hasBody ? '已停止生成，上面是已经写出的部分。' : '已停止生成。'}</span>
            {!busy && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => handlers.onRegenerate(message.id)}>重新生成</Button>}
          </div>
        )}
        {status === 'failed' && (
          <div className={s.runState} data-tone="bad" role="alert">
            <TriangleAlert {...ICON} />
            <span>{hasBody ? '这次回答没有写完，已显示的内容已保留。' : '这次回答没有完成，可以再试一次。'}</span>
            {!busy && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => handlers.onRegenerate(message.id)}>重试</Button>}
          </div>
        )}

        {!live && !hasBody && !status && (
          <div className={s.runState} role="status">
            <CircleSlash {...ICON} />
            <span>这条回答没有内容。</span>
            {!busy && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => handlers.onRegenerate(message.id)}>重新生成</Button>}
          </div>
        )}

        {!live && message.sources.length > 0 && <SourceChips sources={message.sources} onSource={handlers.onSource} />}
      </div>

      {!live && (hasBody || meta) && (
        <footer className={s.actions} data-pinned={last || speaking || undefined}>
          {hasBody && (
            <>
              <IconButton size="sm" label={copied ? '已复制' : '复制'} onClick={() => void copyWithToast(message.text, flashCopied)}>
                {copied ? <Check {...ICON} /> : <Copy {...ICON} />}
              </IconButton>
              {handoff && origin && (
                <SendTo
                  owner={handoff.owner}
                  text={message.text}
                  title={sendTitle}
                  topicId={handoff.topicId}
                  topicTitle={handoff.topicTitle}
                  teachTopicId={handoff.teachTopicId}
                  routes={['agent', 'lesson', 'teach']}
                  origin={origin}
                  side="top"
                >
                  <IconButton size="sm" label="发送到：笔记、闪卡、导图、题目、待办…"><Forward {...ICON} /></IconButton>
                </SendTo>
              )}
              {keepable && (
                <button type="button" className={h.trigger} data-wide data-tone={kept ? undefined : 'accent'} title={`原样存进工作台：${keepable}`} onClick={keep}>
                  {kept ? <Check size={14} strokeWidth={2} /> : <FolderInput size={14} strokeWidth={1.75} />}
                  {kept ? '已收进工作台' : '收进工作台'}
                </button>
              )}
            </>
          )}
          {!busy && (
            <IconButton size="sm" label="重新生成" onClick={() => handlers.onRegenerate(message.id)}>
              <RotateCcw {...ICON} />
            </IconButton>
          )}
          {hasBody && speechSupported && (
            <IconButton size="sm" label={speaking ? '停止朗读' : '朗读'} active={speaking} onClick={() => toggleSpeak(message.id, message.text)}>
              {speaking ? <Square size={13} strokeWidth={2} /> : <Volume2 {...ICON} />}
            </IconButton>
          )}
          {meta && <span className={s.meta} title={meta}>{meta}</span>}
        </footer>
      )}
    </article>
  );
});

/* ── 还没有流式消息时的等待行 ── */
export function PendingMessage({ phase }: { phase: string }) {
  return (
    <article className={s.assistant} aria-label="小砚正在准备回答">
      <header className={s.identity}>
        <XiaoyanAvatar thinking />
        <strong>小砚</strong>
      </header>
      <div className={s.pending} role="status">
        <Shimmer>{phase || '小砚正在思考…'}</Shimmer>
        <ThinkingDots label={phase || '正在思考'} />
      </div>
    </article>
  );
}
