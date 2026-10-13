/**
 * 备课桌的学法条、跟读、例题、缺口标记和备课夹。
 * 状态由备课页持有；这里只渲染。讲稿与小砚草稿是同一份 localStorage。
 */
import { useEffect, useRef, useState } from 'react';
import { Md } from '../../components/Md';
import { getDraft, setDraft, subscribeDraft } from '../../engine/coach';
import {
  PREP_METHODS, safeHttpUrl,
  type GapsView, type PointMark, type PrepDesk, type PrepMethod,
} from '../../engine/prepDesk';
import s from './prep.module.css';

export function MethodBar({
  method,
  onChange,
}: {
  method: PrepMethod;
  onChange: (method: PrepMethod) => void;
}) {
  const current = PREP_METHODS.find((item) => item.id === method) ?? PREP_METHODS[0];
  return (
    <div className={s.methodBar} role="radiogroup" aria-label="这一课怎么学" data-method={method}>
      <div className={s.methodRow}>
        {PREP_METHODS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={method === item.id}
            className={`${s.methodBtn} ${method === item.id ? s.methodOn : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
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
          className={`${s.gapMark} ${mark.className} ${value === mark.id ? s.gapOn : ''}`}
          onClick={() => onChange(mark.id)}
        >
          {mark.label}
        </button>
      ))}
    </div>
  );
}

export function GapsHold({ view, onPeek }: { view: GapsView; onPeek: () => void }) {
  if (view.showCore) return null;
  if (view.held) {
    return (
      <div className={s.gapsNote}>
        <p>这几处你都标会了。材料先收着。想讲的话，小白仍按原来的顺序问。</p>
        <button type="button" className={s.ghostBtnSm} onClick={onPeek}>还是翻开看看</button>
      </div>
    );
  }
  if (view.waiting) {
    return (
      <p className={s.gapsNote}>
        先在上面的路线图上标一会、模糊、不会。模糊和不会的材料才会摊开。全标会也可以直接合上。
      </p>
    );
  }
  return (
    <p className={s.gapsNote}>
      标了会的先收着。还没标出模糊或不会，材料先不摊开。标一处，才按那里补。
    </p>
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
            <Md text={segment.text} className={className} />
            {index < segments.length - 1 && (
              <label className={s.retellLabel}>
                用自己的话说一句，才打开下一段
                <textarea
                  className={s.deskField}
                  maxLength={400}
                  value={retells[index] ?? ''}
                  aria-label={`第 ${index + 1} 段的复述`}
                  placeholder="写一句你自己的话，至少四个字"
                  onChange={(event) => onRetell(index, event.target.value)}
                />
              </label>
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
  walkthrough,
  locked,
  note,
  onNote,
  onReveal,
}: {
  title: string;
  code: string;
  walkthrough: string;
  locked: boolean;
  note: string;
  onNote: (text: string) => void;
  onReveal: () => void;
}) {
  const [folded, setFolded] = useState(true);
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (wasLocked.current && !locked) setFolded(false);
    wasLocked.current = locked;
  }, [locked]);
  return (
    <div className={s.exampleStudy}>
      <pre className={s.code}><code>{code}</code></pre>
      {locked ? (
        <div className={s.exampleGate}>
          <label className={s.retellLabel}>
            先写下你的判断
            <textarea
              className={s.deskField}
              maxLength={800}
              value={note}
              aria-label={`${title}的判断`}
              placeholder="这题你怎么看，至少四个字"
              onChange={(event) => onNote(event.target.value)}
            />
          </label>
          <button type="button" className={s.ghostBtnSm} onClick={onReveal}>先看讲解</button>
        </div>
      ) : (
        <>
          <button type="button" className={s.ghostBtnSm} onClick={() => setFolded((value) => !value)}>
            {folded ? '看走查' : '收起走查'}
          </button>
          {!folded && <p className={s.walkthrough} data-walkthrough="open">{walkthrough}</p>}
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
  const [draft, setLocal] = useState(() => getDraft(topicId));
  useEffect(() => subscribeDraft(topicId, setLocal), [topicId]);
  const href = safeHttpUrl(folder.link);
  return (
    <section className={s.folder} aria-label="我的备课夹">
      <div className={s.secHead}>
        <h2 className={s.sectionTitle}>我的备课夹</h2>
      </div>
      <p className={s.sectionHint}>
        笔记、例子和链接只留给你和小砚。不会写进这一课的标准答案，也不会变成小白的台词。
      </p>
      <label className={s.folderLabel}>
        笔记
        <textarea
          className={s.deskField}
          maxLength={2000}
          value={folder.note}
          aria-label="备课笔记"
          onChange={(event) => onChange({ ...folder, note: event.target.value })}
        />
      </label>
      <label className={s.folderLabel}>
        自己的例子
        <textarea
          className={s.deskField}
          maxLength={800}
          value={folder.example}
          aria-label="自己的例子"
          onChange={(event) => onChange({ ...folder, example: event.target.value })}
        />
      </label>
      <label className={s.folderLabel}>
        一条链接
        <input
          className={s.deskInput}
          maxLength={300}
          value={folder.link}
          aria-label="一条链接"
          placeholder="https://"
          onChange={(event) => onChange({ ...folder, link: event.target.value })}
        />
      </label>
      {folder.link.trim() && !href ? <p className={s.folderWarn}>只收 http 或 https 链接。</p> : null}
      {href ? (
        <a className={s.refLink} href={href} target="_blank" rel="noreferrer noopener">{href}</a>
      ) : null}
      <label className={s.folderLabel}>
        讲稿
        <span className={s.folderNote}>和右下角小砚的草稿是同一份。</span>
        <textarea
          className={s.deskField}
          maxLength={3000}
          value={draft}
          aria-label="讲稿草稿"
          onChange={(event) => {
            const text = event.target.value;
            setLocal(text);
            setDraft(topicId, text);
          }}
        />
      </label>
    </section>
  );
}

export function RehearseEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className={s.rehearseEntry} aria-label="试讲">
      <div className={s.secHead}>
        <h2 className={s.sectionTitle}>试讲</h2>
      </div>
      <p className={s.sectionHint}>摸完底之后才能练。小砚扮小白抛一个误区，你现场接。不进讲解舱。</p>
      <button type="button" className={s.ghostBtn} onClick={onOpen}>让小砚扮小白</button>
    </section>
  );
}
