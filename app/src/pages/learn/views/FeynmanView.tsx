/**
 * 教小白 —— 费曼闭环在学习终端里的家：备课 → 上课 → 赴考 → 批注复盘。
 * 页面只做编排：进度、课业、记录全部由 appStore 的事件流派生，课堂、考场、复盘仍是各自的页面。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../../store/appStore';
import { toast } from '../../../components/ui';
import { useJourneyProgress } from '../../../components/story/useJourneyProgress';
import type { DailyQuest } from '../../../engine/quests';
import type { TerminalViewProps } from './types';
import {
  classroomRoute, deriveCourseRows, derivePrimaryAction, deriveSessionRecords, deriveStations,
  type Station,
} from './feynman/data';
import { useCelebration } from './feynman/useCelebration';
import { Hero } from './feynman/Hero';
import { LoopStations } from './feynman/LoopStations';
import { CoursePicker } from './feynman/CoursePicker';
import { DailyQuests } from './feynman/DailyQuests';
import { SessionLog } from './feynman/SessionLog';
import { StoryShelf } from './feynman/StoryShelf';
import s from './feynman/feynman.module.css';

const LOG_LIMIT = 6;

export default function FeynmanView({ owner, topic, topics, onView }: TerminalViewProps) {
  const navigate = useNavigate();
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const global = useAppStore((state) => state.global);
  const live = useAppStore((state) => state.live);
  const startReview = useAppStore((state) => state.startReview);

  const progress = useJourneyProgress(owner);
  const { board, stage, now } = progress;
  const celebration = useCelebration(owner, board, stage.stage, stage.name);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const loopRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => deriveCourseRows({ topics, topicStates, events, now }),
    [topics, topicStates, events, now],
  );

  const primary = useMemo(() => derivePrimaryAction({
    events, reports, topicStates, topics, live,
    fallbackTopic: topic && !topic.locked ? topic : rows[0]?.topic,
  }), [events, reports, topicStates, topics, live, topic, rows]);

  // 默认选中：手动选的 > 终端当前打开的课 > 当下一步指向的课 > 书架第一门
  const selected = useMemo(() => {
    const candidates = [pickedId, topic?.topicId, primary.topicId];
    for (const id of candidates) {
      const row = id ? rows.find((item) => item.topic.topicId === id) : undefined;
      if (row) return row.topic;
    }
    return rows[0]?.topic;
  }, [pickedId, topic, primary.topicId, rows]);

  const stations = useMemo(() => (selected
    ? deriveStations({ topic: selected, state: topicStates[selected.topicId], events, reports, live, now })
    : []), [selected, topicStates, events, reports, live, now]);

  const storyInput = useMemo(
    () => ({ events, reports, global, topicStates, topics }),
    [events, reports, global, topicStates, topics],
  );
  const records = useMemo(() => deriveSessionRecords(storyInput, LOG_LIMIT), [storyInput]);

  /** 温书：先登记一次复习，再进课堂（与成长册同一条契约） */
  const goReview = useCallback(async (topicId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await startReview(topicId);
      navigate(classroomRoute(topicId, 'review'));
    } catch {
      toast.error('暂时进不了课堂，请稍后再试');
    } finally {
      setReviewBusy(false);
    }
  }, [navigate, reviewBusy, startReview]);

  const runStation = (station: Station) => {
    if (!selected) return;
    if (station.review) void goReview(selected.topicId);
    else if (station.to) navigate(station.to);
  };

  const runPrimary = () => {
    if (primary.reviewTopicId) void goReview(primary.reviewTopicId);
    else navigate(primary.to);
  };

  const scrollTo = (target: HTMLElement | null) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const pickCourse = (topicId: string) => {
    setPickedId(topicId);
    scrollTo(loopRef.current);
  };

  const runQuest = (quest: DailyQuest) => {
    if (quest.action === 'flashcards') {
      onView('workbench', { tool: 'flashcards' });
      return;
    }
    if (quest.action === 'review') {
      const forgotten = rows.find((row) => topicStates[row.topic.topicId]?.forgotten);
      if (forgotten) void goReview(forgotten.topic.topicId);
      return;
    }
    const exam = stations.find((station) => station.key === 'exam');
    if (quest.action === 'exam' && exam?.to) {
      navigate(exam.to);
      return;
    }
    // 上课类课业：课堂开着就回课堂，否则进所选课的课堂
    if (live && !live.ended) {
      navigate(classroomRoute(live.topicId, live.mode));
      return;
    }
    const teach = stations.find((station) => station.key === 'teach');
    if (teach) runStation(teach);
    else scrollTo(pickerRef.current);
  };

  return (
    <div className={s.page}>
      <Hero
        progress={progress}
        primary={primary}
        busy={reviewBusy}
        stageUp={celebration.stageUp}
        onPrimary={runPrimary}
        onGrowth={() => navigate('/growth')}
      />

      <div ref={loopRef} className={s.anchor}>
        <LoopStations
          topic={selected}
          stations={stations}
          busy={reviewBusy}
          onRun={runStation}
          onPick={() => scrollTo(pickerRef.current)}
        />
      </div>

      <div className={s.columns}>
        <div ref={pickerRef} className={s.anchor}>
          <CoursePicker rows={rows} selectedId={selected?.topicId ?? null} onSelect={pickCourse} />
        </div>
        <DailyQuests board={board} fresh={celebration.quests} busy={reviewBusy} onGo={runQuest} />
      </div>

      <SessionLog records={records} total={reports.length} onOpen={navigate} />

      <StoryShelf
        owner={owner}
        input={storyInput}
        records={records}
        reviewBusy={reviewBusy}
        onReview={(topicId) => void goReview(topicId)}
        onOpen={navigate}
      />
    </div>
  );
}
