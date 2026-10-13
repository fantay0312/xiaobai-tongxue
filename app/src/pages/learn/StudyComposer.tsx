import type { FormEvent, RefObject } from 'react';
import { Icon } from '../../components/ui/Icon';
import type { StudyMode } from '../../engine/studyWorkspace';
import s from './learn.module.css';
import i from './intelligent.module.css';

export function StudyComposer({ input, onInput, mode, onMode, busy, onStop, onSubmit, inputRef, custom, demo, deepAvailable, sourceCount, onAttach, answerFormat, onAnswerFormat, intelligentAvailable }: {
  input: string; onInput: (value: string) => void; mode: StudyMode; onMode: (value: StudyMode) => void;
  busy: boolean; onStop: () => void; onSubmit: (event: FormEvent) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>; custom: boolean; demo: boolean;
  deepAvailable: boolean;
  sourceCount?: number;
  onAttach?: () => void;
  answerFormat: 'auto'|'text';onAnswerFormat:(format:'auto'|'text')=>void;intelligentAvailable:boolean;
}) {
  return <div className={s.composerArea}>
    <form className={s.composer} onSubmit={onSubmit}>
      <div className={s.composerContext}><Icon name="book-open" size={13} /><span>{sourceCount === undefined ? `围绕本课讲义${custom ? '与原始资料' : ''}` : `${sourceCount} 份已选资料`}</span>{demo && <span className={s.demoLabel}>本地演示</span>}{intelligentAvailable&&<label className={i.formatChoice}><Icon name="grid" size={12}/><select aria-label="回答形式" value={answerFormat} disabled={busy} onChange={(event)=>onAnswerFormat(event.target.value as 'auto'|'text')}><option value="auto">自动选择形式</option><option value="text">纯文字</option></select></label>}</div>
      <textarea ref={inputRef} aria-label="向小砚提问" value={input} maxLength={3000} rows={2} placeholder="请输入问题，或者说说你想弄懂的地方…" onChange={(event) => onInput(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!busy) event.currentTarget.form?.requestSubmit();
        }
      }} />
      <div className={s.composerBottom}>
        {onAttach && <button type="button" className={s.textButton} aria-label="从资料库选择文件" onClick={onAttach}><Icon name="plus" size={18} />文件</button>}
        <div className={`${s.modeButtons} ${i.desktopModes}`} aria-label="回答方式"><button type="button" aria-pressed={mode === 'ask'} onClick={() => onMode('ask')}><Icon name="sparkles" size={14} />直接答疑</button><button type="button" aria-pressed={mode === 'socratic'} onClick={() => onMode('socratic')}><Icon name="users-round" size={14} />引导思考</button><button type="button" aria-pressed={mode === 'deep'} disabled={!deepAvailable} title={deepAvailable ? '通过 DeepTutor 核对资料并组织解释，耗时会更长' : '当前服务尚未启用深入答疑'} onClick={() => onMode('deep')}><Icon name="search" size={14} />深入答疑</button></div>
        <label className={i.mobileMode}><select aria-label="回答方式" value={mode} onChange={(event)=>onMode(event.target.value as StudyMode)}><option value="ask">直接答疑</option><option value="socratic">引导思考</option><option value="deep" disabled={!deepAvailable}>深入答疑</option></select></label>
        {busy ? <button type="button" className={s.sendButton} aria-label="停止回答" onClick={onStop}><Icon name="pause" size={17} /></button> : <button type="submit" className={s.sendButton} aria-label="发送问题" disabled={!input.trim() || sourceCount === 0}><Icon name="arrow-right" size={20} /></button>}
      </div>
    </form>
    <p className={s.composerFootnote}>围绕资料理解，重要结论请核对原文。<span>Enter 发送 · Shift + Enter 换行</span></p>
  </div>;
}
