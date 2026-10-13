/**
 * 教室里的小白:宽屏是一张课桌后的半身(桌牌、头顶的小念头、桌角的小本本),
 * 窄屏收成顶栏里的一枚头像签。两种形态共用同一颗头像按钮(点开简介)。
 */
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { BookMarked, Quote, Swords } from 'lucide-react';
import { ThinkingDots, cx } from '../../components/ui';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { XiaobaiMood } from '../../types';
import { MOOD_ZH, clock, moodTone, type FollowState, type NotebookEntry } from './lesson';
import s from './classroom.module.css';

/** 课堂用时:自己每秒走字,不带着整间教室重渲染 */
export function LessonClock({ startedAt, className }: { startedAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const started = Date.parse(startedAt);
  const seconds = Number.isFinite(started) ? (now - started) / 1000 : 0;
  return (
    <time className={className} aria-label={`已上课 ${clock(seconds)}`}>
      {clock(seconds)}
    </time>
  );
}

/** 一串粉笔点:小白每开一次口落一点,颜色是当时的脸色 */
export function FollowTrail({ follow }: { follow: FollowState }) {
  if (follow.trail.length === 0) return null;
  return (
    <span className={s.trail} aria-hidden="true">
      {follow.trail.map((tone, index) => (
        <i key={index} data-tone={tone} />
      ))}
    </span>
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 小本本:一页纸(故事物件)。记下的金句是老师原话,讲退的心魔只记「有这回事」 */
export function Notebook({ entries, follow, compact }: {
  entries: NotebookEntry[];
  follow: FollowState;
  compact?: boolean;
}) {
  const shown = entries.slice(compact ? -3 : -4);
  const hidden = entries.length - shown.length;
  return (
    <section className={cx(s.notebook, compact && s.notebookCompact)} data-story aria-label="小白的小本本">
      <header className={s.notebookHead}>
        <BookMarked size={14} strokeWidth={1.75} aria-hidden="true" />
        <strong>小白的小本本</strong>
      </header>
      <p className={s.notebookFollow} data-tone={follow.tone}>
        <span>听课</span>
        <b>{follow.label}</b>
        <FollowTrail follow={follow} />
      </p>
      {shown.length === 0 ? (
        <p className={s.notebookEmpty}>还空着。老师哪句话讲到我心里，我就记在这儿。</p>
      ) : (
        <ol className={s.notebookList}>
          {hidden > 0 ? <li className={s.notebookMore}>前面还记了 {hidden} 条</li> : null}
          {shown.map((entry) =>
            entry.kind === 'golden' ? (
              <li key={entry.id} data-kind="golden">
                <Quote size={12} strokeWidth={2} aria-hidden="true" />
                <span>{clip(entry.text, compact ? 40 : 46)}</span>
              </li>
            ) : (
              <li key={entry.id} data-kind="cleared">
                <Swords size={12} strokeWidth={2} aria-hidden="true" />
                <span>有一处我想岔了，老师讲回来了</span>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}

export interface SeatProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  /** 科名,写在桌牌上 */
  stageName: string;
  /** 头顶的小念头;null 时不出(正在开口说话) */
  thought: string | null;
  thinking: boolean;
  entries: NotebookEntry[];
  follow: FollowState;
  avatarRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  onAvatarClick: () => void;
  /** 被点了一下时的腮红(key 变一次闪一次) */
  blushKey: number | null;
  /** 简介浮卡 */
  children?: ReactNode;
}

/** 宽屏:小白坐在黑板左手边的课桌后 */
export function XiaobaiSeat({
  mood, level, speaking, stageName, thought, thinking, entries, follow,
  avatarRef, profileOpen, onAvatarClick, blushKey, children,
}: SeatProps) {
  const tone = moodTone(mood);
  return (
    <aside className={s.seat}>
      <Notebook entries={entries} follow={follow} />
      <div className={s.seatBody} data-tour="stage">
        {thought ? (
          <p key={thought} className={s.thought} data-tone={tone} aria-hidden="true">
            <span>{thought}</span>
            {thinking ? <ThinkingDots label="小白在琢磨" /> : null}
          </p>
        ) : null}
        <button
          ref={avatarRef}
          type="button"
          className={s.figure}
          aria-label="查看小白简介"
          aria-expanded={profileOpen}
          aria-controls="classroom-xiaobai-profile"
          onClick={onAvatarClick}
        >
          <XiaobaiAvatar mood={mood} level={level} speaking={speaking} size={224} variant="seat" />
          {blushKey !== null ? <span key={blushKey} className={s.tapBlush} aria-hidden="true" /> : null}
        </button>
        <div className={s.desk}>
          <span className={s.namePlate}>
            <b>小白</b>
            <i>{stageName}</i>
          </span>
          <span className={s.deskMood} data-tone={tone}>{MOOD_ZH[mood]}</span>
        </div>
      </div>
      {children}
    </aside>
  );
}

/** 窄屏:顶栏里的头像签,名字下面一行是他此刻的心情 */
export function XiaobaiChip({
  mood, level, speaking, avatarRef, profileOpen, onAvatarClick, blushKey, children,
}: Pick<SeatProps, 'mood' | 'level' | 'speaking' | 'avatarRef' | 'profileOpen' | 'onAvatarClick' | 'blushKey' | 'children'>) {
  const tone = moodTone(mood);
  return (
    <div className={s.chipWrap} data-tour="stage">
      <button
        ref={avatarRef}
        type="button"
        className={s.chip}
        aria-label={`小白，${MOOD_ZH[mood]}。查看简介`}
        aria-expanded={profileOpen}
        aria-controls="classroom-xiaobai-profile"
        onClick={onAvatarClick}
      >
        <span className={s.chipFace}>
          <XiaobaiAvatar mood={mood} level={level} speaking={speaking} size={38} variant="board" />
          {blushKey !== null ? <span key={blushKey} className={s.tapBlush} aria-hidden="true" /> : null}
        </span>
        <span className={s.chipText}>
          <b>小白</b>
          <i data-tone={tone}>{MOOD_ZH[mood]}</i>
        </span>
      </button>
      {children}
    </div>
  );
}
