/**
 * 视频 / 音频播放器：原生元素 + 自绘控制条，右侧「时间点笔记」。
 * 笔记草稿按账号和文件存在当前浏览器；「保存到笔记」写一条 Markdown 笔记进学习工作台。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { BookmarkPlus, Check, ChevronUp, Gauge, Maximize, Music, Pause, Play, Redo2, Save, Trash2, Undo2, Volume2, VolumeX } from 'lucide-react';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Spinner, Textarea, toast } from '../ui';
import { newId, studyData } from '../../store/studyData';
import { formatClock } from './fileKind';
import { useObjectUrl } from './useObjectUrl';
import { StageLoading, ViewerError } from './viewers';
import s from './preview.module.css';

const RATES = [0.75, 1, 1.25, 1.5, 2];
const STORE_KEY = 'xiaobai-preview-timenotes-v1';

interface TimeNote { id: string; at: number; text: string }
interface NoteDraft { noteId?: string; items: TimeNote[] }

function readDrafts(): Record<string, NoteDraft> {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
function loadDraft(key: string): NoteDraft {
  const draft = readDrafts()[key];
  return draft && Array.isArray(draft.items) ? { noteId: draft.noteId, items: draft.items.filter((item) => item && typeof item.text === 'string' && Number.isFinite(item.at)) } : { items: [] };
}
function storeDraft(key: string, draft: NoteDraft) {
  try {
    const all = readDrafts();
    if (draft.items.length || draft.noteId) all[key] = draft; else delete all[key];
    // 只留最近 60 份文件的草稿
    const kept = Object.fromEntries(Object.entries(all).slice(-60));
    localStorage.setItem(STORE_KEY, JSON.stringify(kept));
  } catch { /* 存储不可用时只在本次打开期间保留 */ }
}

export function MediaPlayer({ blob, kind, file, owner, onDownload }: {
  blob: Blob; kind: 'video' | 'audio'; file: { id: string; name: string }; owner: string | null; onDownload: () => void;
}) {
  const url = useObjectUrl(blob);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const draftKey = `${owner ?? 'local'}:${file.id}`;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const probingRef = useRef(false);
  const [draft, setDraft] = useState<NoteDraft>(() => loadDraft(draftKey));
  const [text, setText] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 手机上笔记是底部抽屉，平时只露出标题一行；宽屏上这个状态不起作用
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => { const media = mediaRef.current; if (media) media.playbackRate = rate; }, [rate, url]);

  const updateDraft = (next: NoteDraft) => { setDraft(next); storeDraft(draftKey, next); setSavedAt(null); };
  const toggle = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => {}); else media.pause();
  };
  const seek = (time: number, play = false) => {
    const media = mediaRef.current;
    if (!media) return;
    const limit = Number.isFinite(media.duration) ? media.duration : time;
    media.currentTime = Math.min(Math.max(0, time), Math.max(0, limit));
    setCurrent(media.currentTime);
    if (play) void media.play().catch(() => {});
  };
  const fullscreen = () => {
    const player = playerRef.current;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (player?.requestFullscreen) { void player.requestFullscreen().catch(() => {}); return; }
    // iOS Safari 只支持视频元素自身全屏
    (mediaRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };
  const addNote = () => {
    const body = text.trim();
    if (!body) return;
    const items = [...draft.items, { id: newId(), at: Math.floor(mediaRef.current?.currentTime ?? current), text: body }].sort((a, b) => a.at - b.at);
    updateDraft({ ...draft, items });
    setText('');
  };
  const saveNotes = () => {
    if (!draft.items.length) return;
    const body = [
      `来源：资料库「${file.name}」`,
      '',
      ...draft.items.map((item) => `- **${formatClock(item.at)}** ${item.text.replace(/\s*\n\s*/g, ' ')}`),
    ].join('\n');
    const saved = studyData.saveNote(owner, { ...(draft.noteId ? { id: draft.noteId } : {}), title: `${file.name} · 时间点笔记`, body, tags: [kind === 'video' ? '视频笔记' : '音频笔记'] });
    const next = { ...draft, noteId: saved.id };
    setDraft(next); storeDraft(draftKey, next); setSavedAt(Date.now());
    toast.success('已保存到笔记，可在学习工作台查看');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button, [role="menu"]')) return;
    if (event.key === ' ') { event.preventDefault(); toggle(); }
  };

  if (!url) return <StageLoading />;
  if (failed) {
    return <ViewerError title={kind === 'video' ? '这个视频无法播放' : '这段音频无法播放'} description="浏览器不支持这种编码，可以下载后用本机播放器打开。" onDownload={onDownload} />;
  }

  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const percent = total ? Math.min(100, (current / total) * 100) : 0;
  const mediaProps = {
    ref: mediaRef,
    src: url,
    preload: 'metadata' as const,
    playsInline: true,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (event: { currentTarget: HTMLMediaElement }) => { if (!probingRef.current) setCurrent(event.currentTarget.currentTime); },
    onLoadedMetadata: (event: { currentTarget: HTMLMediaElement }) => {
      const media = event.currentTarget;
      setReady(true);
      setDuration(media.duration);
      // 浏览器录制的 WebM 没写时长：先跳到末尾让浏览器算出来，再回到开头
      if (media.duration === Infinity) { probingRef.current = true; media.currentTime = 1e101; }
    },
    onDurationChange: (event: { currentTarget: HTMLMediaElement }) => {
      const media = event.currentTarget;
      setDuration(media.duration);
      if (probingRef.current && Number.isFinite(media.duration)) { probingRef.current = false; media.currentTime = 0; setCurrent(0); }
    },
    onVolumeChange: (event: { currentTarget: HTMLMediaElement }) => setMuted(event.currentTarget.muted),
    onError: () => setFailed(true),
  };

  return (
    <div className={s.media} data-kind={kind} data-notes={notesOpen ? 'open' : 'closed'} onKeyDown={onKeyDown}>
      <div ref={playerRef} className={s.player}>
        {kind === 'video'
          ? (
            <div className={s.screen} onClick={toggle}>
              <video className={s.video} data-pending={!ready || undefined} {...mediaProps} />
              {!ready
                ? <span className={s.screenLoading} role="status"><Spinner size={20} />正在准备视频…</span>
                : !playing && <span className={s.bigPlay} aria-hidden="true"><Play size={26} fill="currentColor" /></span>}
            </div>
          )
          : (
            <div className={s.audioCard}>
              <span className={s.audioDisc} data-playing={playing || undefined} aria-hidden="true"><Music size={30} strokeWidth={1.5} /></span>
              <strong>{file.name}</strong>
              <audio {...mediaProps} />
            </div>
          )}

        <div className={s.controls}>
          <div className={s.seekRow}>
            <span className={s.clock}>{formatClock(current)}</span>
            <div className={s.seekTrack}>
              <input
                type="range"
                className={s.seek}
                aria-label="播放进度"
                min={0}
                max={total || 0}
                step={0.1}
                value={Math.min(current, total || 0)}
                disabled={!total}
                style={{ '--pct': `${percent}%` } as CSSProperties}
                onChange={(event) => seek(Number(event.target.value))}
              />
              {total > 0 && draft.items.map((item) => (
                <i key={item.id} className={s.seekMark} style={{ left: `${Math.min(100, (item.at / total) * 100)}%` }} aria-hidden="true" />
              ))}
            </div>
            <span className={s.clock}>{total ? formatClock(total) : '--:--'}</span>
          </div>
          <div className={s.buttonRow}>
            <IconButton label="后退 10 秒" size="sm" onClick={() => seek(current - 10)}><Undo2 size={16} /></IconButton>
            <IconButton label={playing ? '暂停' : '播放'} variant="solid" round shortcut="空格" onClick={toggle}>
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </IconButton>
            <IconButton label="前进 10 秒" size="sm" onClick={() => seek(current + 10)}><Redo2 size={16} /></IconButton>
            <span className={s.grow} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm" icon={<Gauge size={14} />} aria-label={`播放速度 ${rate} 倍`}>{rate}×</Button>
              </MenuTrigger>
              <MenuContent align="end" side="top">
                <MenuLabel>播放速度</MenuLabel>
                {RATES.map((value) => (
                  <MenuItem key={value} checked={value === rate} onSelect={() => setRate(value)}>{value === 1 ? '1× 正常' : `${value}×`}</MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <IconButton label={muted ? '取消静音' : '静音'} size="sm" onClick={() => { const media = mediaRef.current; if (media) media.muted = !media.muted; }}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>
            {kind === 'video' && <IconButton label="全屏" size="sm" onClick={fullscreen}><Maximize size={16} /></IconButton>}
          </div>
        </div>
      </div>

      <aside className={s.notes} aria-label="时间点笔记">
        <header className={s.notesHead}>
          <IconButton label={notesOpen ? '收起时间点笔记' : '展开时间点笔记'} tip={false} className={s.notesToggle} aria-expanded={notesOpen} onClick={() => setNotesOpen((value) => !value)}>
            <ChevronUp size={18} />
          </IconButton>
          <div onClick={() => setNotesOpen((value) => !value)}>
            <h3>时间点笔记</h3>
            <p>{draft.items.length ? `${draft.items.length} 条 · 点时间跳回原处` : '听到关键处记一条，之后点时间就能跳回'}</p>
          </div>
          <Button
            variant={savedAt ? 'ghost' : 'soft'}
            size="sm"
            icon={savedAt ? <Check size={14} /> : <Save size={14} />}
            disabled={!draft.items.length}
            onClick={saveNotes}
          >
            {savedAt ? '已保存' : draft.noteId ? '更新笔记' : '保存到笔记'}
          </Button>
        </header>

        <ol className={s.noteList}>
          {draft.items.map((item) => (
            <li key={item.id} className={s.noteItem}>
              <button type="button" className={s.noteJump} onClick={() => seek(item.at, true)} aria-label={`跳到 ${formatClock(item.at)}`}>
                <span className={s.noteTime}>{formatClock(item.at)}</span>
                <span className={s.noteText}>{item.text}</span>
              </button>
              <IconButton label="删除这条笔记" size="sm" className={s.noteRemove} onClick={() => updateDraft({ ...draft, items: draft.items.filter((note) => note.id !== item.id) })}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {!draft.items.length && (
            <li className={s.noteEmpty}>
              <BookmarkPlus size={18} strokeWidth={1.75} />
              <span>还没有笔记</span>
            </li>
          )}
        </ol>

        <form className={s.noteForm} onSubmit={(event) => { event.preventDefault(); addNote(); }}>
          <Textarea
            className={s.noteInput}
            aria-label="笔记内容"
            placeholder={`在 ${formatClock(current)} 记一条…`}
            rows={2}
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); addNote(); }
            }}
          />
          <Button type="submit" variant="solid" size="sm" icon={<BookmarkPlus size={14} />} disabled={!text.trim()}>记在 {formatClock(current)}</Button>
        </form>
      </aside>
    </div>
  );
}
