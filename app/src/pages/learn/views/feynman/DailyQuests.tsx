/**
 * 今日课业：每一项都对着今天真实发生的事件数进度。
 * 做完的那一项落一枚朱印；刚做完的那一下带落印动效（减弱动效时直接盖好）。
 */
import { Check, ChevronRight } from 'lucide-react';
import type { DailyQuest, QuestBoard } from '../../../../engine/quests';
import s from './feynman.module.css';

interface Props {
  board: QuestBoard;
  /** 刚完成、要播放落印的课业 key */
  fresh: string[];
  busy: boolean;
  onGo: (quest: DailyQuest) => void;
}

export function DailyQuests({ board, fresh, busy, onGo }: Props) {
  const allDone = board.total > 0 && board.done === board.total;

  return (
    <section className={s.section} aria-labelledby="feynman-quests-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-quests-title" className={s.sectionTitle}>今日课业</h2>
          <p className={s.sectionNote}>
            {allDone ? '今天的课业都做完了' : `已完成 ${board.done} / ${board.total}`}
            {board.xpToday > 0 && ` · 今日学识 +${board.xpToday}`}
          </p>
        </div>
        <span className={s.questTally} data-done={allDone || undefined} aria-hidden="true">
          {board.done}<i>/</i>{board.total}
        </span>
      </header>

      <ul className={s.panel}>
        {board.quests.map((quest) => {
          const ratio = quest.target > 0 ? Math.min(1, quest.now / quest.target) : 0;
          const body = (
            <>
              <span
                className={s.questSeal}
                data-done={quest.done || undefined}
                data-fresh={(quest.done && fresh.includes(quest.key)) || undefined}
                aria-hidden="true"
              >
                {quest.glyph}
              </span>
              <span className={s.questText}>
                <span className={s.questHead}>
                  <b>{quest.title}</b>
                  <span className={s.questReward} data-xp={quest.rewardXp !== null || undefined}>
                    {quest.rewardLabel}
                  </span>
                </span>
                <span className={s.questHint}>{quest.hint}</span>
                <span className={s.questProgress}>
                  <span className={s.questTrack} data-done={quest.done || undefined}>
                    <i style={{ width: `${ratio * 100}%` }} />
                  </span>
                  <span className={s.questCount}>{quest.now}/{quest.target}</span>
                </span>
              </span>
            </>
          );

          return (
            <li key={quest.key} className={s.questItem}>
              {quest.done ? (
                <div className={s.questRow} data-done>
                  {body}
                  <Check className={s.questState} size={16} strokeWidth={2.25} aria-label="已完成" />
                </div>
              ) : (
                <button
                  type="button"
                  className={s.questRow}
                  disabled={busy}
                  onClick={() => onGo(quest)}
                  aria-label={`${quest.title}，${quest.hint}，进度 ${quest.now}/${quest.target}，去做`}
                >
                  {body}
                  <ChevronRight className={s.questGo} size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
