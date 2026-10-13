/**
 * 解锁时刻 —— 哪几项课业是「刚做完、还没庆祝过」的，科名有没有刚晋阶。
 * 进度本身从事件流派生；这里只在当前浏览器记一笔「已经看过」，免得每次进页面都重放落印。
 */
import { useEffect, useState } from 'react';
import { toast } from '../../../../components/ui';
import type { QuestBoard } from '../../../../engine/quests';

interface Seen {
  day: string;
  quests: string[];
  stage: number;
}

export interface Celebration {
  /** 刚完成、要落印的课业 key */
  quests: string[];
  /** 科名刚晋阶 */
  stageUp: boolean;
}

const PREFIX = 'xiaobai-feynman-seen-v1:';
const storageKey = (owner: string | null) => PREFIX + encodeURIComponent(owner ?? 'local');

function loadSeen(owner: string | null): Seen | null {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(owner)) ?? 'null');
    if (!raw || typeof raw.day !== 'string' || !Array.isArray(raw.quests)) return null;
    return {
      day: raw.day,
      quests: raw.quests.filter((key: unknown): key is string => typeof key === 'string'),
      stage: typeof raw.stage === 'number' ? raw.stage : 1,
    };
  } catch {
    return null;
  }
}

function saveSeen(owner: string | null, seen: Seen): void {
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(seen));
  } catch {
    /* 存不下也不影响页面，只是下次会再庆祝一遍 */
  }
}

export function useCelebration(owner: string | null, board: QuestBoard, stage: number, stageName: string): Celebration {
  const [fresh, setFresh] = useState<Celebration>({ quests: [], stageUp: false });
  const doneKeys = board.quests.filter((quest) => quest.done).map((quest) => quest.key).join(',');
  const { dayKey, total } = board;

  useEffect(() => {
    const seen = loadSeen(owner);
    const sameDay = seen?.day === dayKey;
    const known = new Set(sameDay && seen ? seen.quests : []);
    const done = doneKeys ? doneKeys.split(',') : [];
    const newly = done.filter((key) => !known.has(key));
    // 第一次打开这页没有旧记录可比，不为历史进度补庆祝
    const stageUp = seen !== null && stage > seen.stage;

    if (newly.length > 0 || stageUp) {
      setFresh((previous) => ({
        quests: [...new Set([...previous.quests, ...newly])],
        stageUp: previous.stageUp || stageUp,
      }));
      if (stageUp) toast.success(`小白晋为「${stageName}」`);
      else if (done.length === total) toast.success('今日课业全部完成');
      else toast.success(`完成 ${newly.length} 项今日课业`);
    }
    if (newly.length > 0 || stageUp || !sameDay) {
      saveSeen(owner, { day: dayKey, quests: done, stage });
    }
  }, [owner, dayKey, doneKeys, total, stage, stageName]);

  return fresh;
}
