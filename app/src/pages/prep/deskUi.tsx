/**
 * 备课桌的学法条、跟读、例题、缺口标记、备课夹和试讲入口。
 * 状态由备课页持有；这里只渲染。讲稿与小砚草稿是同一份 localStorage。
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, FolderOpen, Swords } from 'lucide-react';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Button, Field, Input, Segmented, Textarea, cx } from '../../components/ui';
import { getDraft, setDraft, subscribeDraft } from '../../engine/coach';
import {
  PREP_METHODS, safeHttpUrl,
  type GapsView, type PointMark, type PrepDesk, type PrepMethod,
} from '../../engine/prepDesk';
import { codeFence, hasRichMarkup, lectureMarkdown } from './flow';
import s from './prep.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const METHOD_OPTIONS = PREP_METHODS.map((item) => ({
  value: item.id,
  label: item.label,
  title: item.hint,
}));

export function MethodBar({
  method,
  onChange,
}: {
  method: PrepMethod;
  onChange: (method: PrepMethod) => void;
}) {
  const current = PREP_METHODS.find((item) => item.id === method) ?? PREP_METHODS[0];
  return (
    <div className={s.methodBar} data-method={method}>
      <span className={s.methodLabel}>这一课怎么学</span>
      <div className={s.methodSeg}>
        <Segmented value={method} onChange={onChange} options={METHOD_OPTIONS} label="这一课怎么学" />
      </div>
      <p className={s.methodHint}>{current.hint}</p>
    </div>
  );
}

const MARKS: { id: PointMark; label: string; className: string }[] = [
  { id: 'know', label: '会', className: s.gapKnow },
  { id: 'fuzzy', label: '模糊', className: s.gapFuzzy },
  { id: 'gap', label: '不会', className: s.gapGap },
];

export function GapMarks({
  value,
  onChange,
}: {
  value: PointMark | undefined;
  onChange: (mark: PointMark) => void;
}) {
  return (
    <div className={s.gapMarks} role="group" aria-label="这一处你会吗">
      {MARKS.map((mark) => (
        <button
          key={mark.id}
          type="button"
          aria-pressed={value === mark.id}
          className={cx(s.gapMark, mark.className, value === mark.id && s.gapOn)}
          onClick={() => onChange(mark.id)}
        >
          {mark.label}
        </button>
      ))}
    </div>
  );
}

export function GapsHold({
  view,
  onPeek,
  onRoadmap,
}: {
  view: GapsView;
  onPeek: () => void;
  /** 回到「讲课路线图」那一步去标 */
  onRoadmap?: () => void;
}) {
  if (view.showCore) return null;
  if (view.held) {
    return (
      <div className={s.gapsNote}>
        <p>这几处你都标会了。材料先收着。想讲的话，小白仍按原来的顺序问。</p>
        <Button variant="outline" size="sm" onClick={onPeek}>还是翻开看看</Button>
      </div>
    );
  }
  return (
    <div className={s.gapsNote}>
      <p>
        {view.waiting
          ? '先在「讲课路线图」那一步标会、模糊、不会。模糊和不会的材料才会摊开。全标会也可以直接合上。'
          : '标了会的先收着。还没标出模糊或不会，材料先不摊开。标一处，才按那里补。'}
      </p>
      {onRoadmap ? (
        <Button variant="outline" size="sm" onClick={onRoadmap}>回路线图去标</Button>
      ) : null}
    </div>
  );
}

export function RetellLecture({
  segments,
  visible,
  retells,
  onRetell,
  onShow,
  className,
}: {
  segments: { text: string }[];
  visible: number;
  retells: readonly string[];
  onRetell: (index: number, text: string) => void;
  onShow?: () => void;
  className?: string;
}) {
  const fieldId = useId();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    onShow?.();
  }, [onShow]);
  return (
    <div className={s.retell} data-visible={visible} data-total={segments.length}>
      {segments.map((segment, index) => {
        if (index >= visible) return null;
        const written = (retells[index] ?? '').trim().length >= 4;
        const lastOpen = index === visible - 1 && index < segments.length - 1;
        return (
          <div key={index} className={s.retellSeg}>
            <p className={s.retellNo}>第 {index + 1} / {segments.length} 段</p>
            <div className={className}>
              <CoachMarkdown text={lectureMarkdown(segment.text)} />
            </div>
            {index < segments.length - 1 && (
              <Field label="用自己的话说一句，才打开下一段" htmlFor={`${fieldId}-${index}`}>
                <Textarea
                  id={`${fieldId}-${index}`}
                  className={s.deskFieldSm}
                  maxLength={400}
                  value={retells[index] ?? ''}
                  aria-label={`第 ${index + 1} 段的复述`}
                  placeholder="写一句你自己的话，至少四个字"
                  onChange={(event) => onRetell(index, event.target.value)}
                />
              </Field>
            )}
            {lastOpen && !written && <p className={s.retellWait}>写下这一句，下一段才打开。</p>}
          </div>
        );
      })}
    </div>
  );
}

export function ExampleStudy({
  title,
  code,
  language,
  walkthrough,
  locked,
  note,
  onNote,
  onReveal,
}: {
  title: string;
  code: string;
  /** 代码块语言（看得出才给，如 python） */
  language?: string;
  walkthrough: string;
  locked: boolean;
  note: string;
  onNote: (text: string) => void;
  onReveal: () => void;
}) {
  const fieldId = useId();
  const [folded, setFolded] = useState(true);
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (wasLocked.current && !locked) setFolded(false);
    wasLocked.current = locked;
  }, [locked]);
  return (
    <div className={s.exampleStudy}>
      <CoachMarkdown text={codeFence(code, language)} />
      {locked ? (
        <div className={s.exampleGate}>
          <Field label="先写下你的判断" htmlFor={fieldId}>
            <Textarea
              id={fieldId}
              className={s.deskFieldSm}
              maxLength={800}
              value={note}
              aria-label={`${title}的判断`}
              placeholder="这题你怎么看，至少四个字"
              onChange={(event) => onNote(event.target.value)}
            />
          </Field>
          <Button variant="outline" size="sm" onClick={onReveal}>先看讲解</Button>
        </div>
      ) : (
        <>
          <div>
            <Button variant="soft" size="sm" aria-expanded={!folded} onClick={() => setFolded((value) => !value)}>
              {folded ? '看走查' : '收起走查'}
            </Button>
          </div>
          {!folded && (
            hasRichMarkup(walkthrough) ? (
              <div className={s.walkthrough} data-walkthrough="open">
                <CoachMarkdown text={walkthrough} />
              </div>
            ) : (
              <p className={s.walkthrough} data-walkthrough="open">{walkthrough}</p>
            )
          )}
        </>
      )}
    </div>
  );
}

export function PrepFolder({
  topicId,
  folder,
  onChange,
}: {
  topicId: string;
  folder: PrepDesk['folder'];
  onChange: (folder: PrepDesk['folder']) => void;
}) {
  const fieldId = useId();
  const [draft, setLocal] = useState(() => getDraft(topicId));
  useEffect(() => subscribeDraft(topicId, setLocal), [topicId]);
  const href = safeHttpUrl(folder.link);
  const linkInvalid = Boolean(folder.link.trim()) && !href;
  const written = [folder.note, folder.example, folder.link, draft].filter((text) => text.trim()).length;
  // 写过东西的备课夹默认摊开，空的先收着，不抢当前这一步
  const [open, setOpen] = useState(written > 0);
  return (
    <section className={s.folder} aria-label="我的备课夹">
      <button
        type="button"
        className={s.toolHead}
        aria-expanded={open}
        aria-controls={`${fieldId}-body`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={s.toolIcon} aria-hidden="true"><FolderOpen size={18} strokeWidth={1.75} /></span>
        <span className={s.toolText}>
          <span className={s.toolName}>我的备课夹</span>
          <span className={s.toolHint}>
            {written > 0 ? `已写 ${written} 项 · 只留给你和小砚` : '笔记、自己的例子、链接和讲稿，只留给你和小砚'}
          </span>
        </span>
        <ChevronRight className={s.toolChev} {...ICON} aria-hidden="true" />
      </button>
      {open && (
        <div id={`${fieldId}-body`} className={s.folderBody}>
          <p className={s.folderLead}>
            这里写的不会进这一课的标准答案，也不会变成小白的台词。
          </p>
          <Field label="笔记" htmlFor={`${fieldId}-note`}>
            <Textarea
              id={`${fieldId}-note`}
              maxLength={2000}
              value={folder.note}
              aria-label="备课笔记"
              placeholder="读材料时想到的，先记一笔"
              onChange={(event) => onChange({ ...folder, note: event.target.value })}
            />
          </Field>
          <Field label="自己的例子" htmlFor={`${fieldId}-example`}>
            <Textarea
              id={`${fieldId}-example`}
              maxLength={800}
              value={folder.example}
              aria-label="自己的例子"
              placeholder="换一个你自己的例子讲这件事"
              onChange={(event) => onChange({ ...folder, example: event.target.value })}
            />
          </Field>
          <Field
            className={s.folderWide}
            label="一条链接"
            htmlFor={`${fieldId}-link`}
            error={linkInvalid ? '只收 http 或 https 链接。' : undefined}
          >
            <Input
              id={`${fieldId}-link`}
              size="sm"
              maxLength={300}
              value={folder.link}
              invalid={linkInvalid}
              aria-label="一条链接"
              placeholder="https://"
              onChange={(event) => onChange({ ...folder, link: event.target.value })}
            />
            {href ? (
              <a className={s.refLink} href={href} target="_blank" rel="noreferrer noopener">{href}</a>
            ) : null}
          </Field>
          <Field
            className={s.folderWide}
            label="讲稿"
            htmlFor={`${fieldId}-draft`}
            hint="和小砚面板里的「草稿」是同一份。"
          >
            <Textarea
              id={`${fieldId}-draft`}
              maxLength={3000}
              value={draft}
              aria-label="讲稿草稿"
              placeholder="开场怎么说、先讲哪一句，写在这里"
              onChange={(event) => {
                const text = event.target.value;
                setLocal(text);
                setDraft(topicId, text);
              }}
            />
          </Field>
        </div>
      )}
    </section>
  );
}

export function RehearseEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className={s.rehearseEntry} aria-label="试讲">
      <div className={s.toolHead}>
        <span className={s.toolIcon} aria-hidden="true"><Swords size={18} strokeWidth={1.75} /></span>
        <span className={s.toolText}>
          <span className={s.toolName}>试讲</span>
          <span className={s.toolHint}>小砚扮小白抛一个误区，你现场接。不进讲解舱。</span>
        </span>
        <Button variant="outline" onClick={onOpen}>让小砚扮小白</Button>
      </div>
    </section>
  );
}
