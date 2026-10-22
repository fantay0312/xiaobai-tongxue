/**
 * 教小白 —— 费曼闭环在学习终端里的家：备课 → 上课 → 赴考 → 批注复盘。
 * 页面只做编排：进度、课业、记录全部由 appStore 的事件流派生，课堂、考场、复盘仍是各自的页面。
 * 导航（当下一步、选课、课堂记录）放进终端侧栏；侧栏收起或在手机上看不到侧栏时，退回主区。
 * 选中的课以路由为准：/prep/<topicId>?view=feynman，刷新和回退都留在同一门课上。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../../store/appStore';
import { Dialog, toast } from '../../../components/ui';
import { useJourneyProgress } from '../../../components/story/useJourneyProgress';
import type { DailyQuest } from '../../../engine/quests';
import { SidebarPortal } from '../shell/sidebarSlot';
import { useMediaQuery } from '../shell/views';
import type { TerminalViewProps } from './types';
import {
  classroomRoute, deriveCourseFocus, deriveCourseRows, derivePrimaryAction, deriveSessionRecords, deriveStations,
  type FocusAction, type Station,
} from './feynman/data';
import { useCelebration } from './feynman/useCelebration';
import { useSidebarVisible } from './feynman/useSidebarVisible';
import { Hero } from './feynman/Hero';
import { CourseFocus } from './feynman/CourseFocus';
import { LoopStations } from './feynman/LoopStations';
import { CoursePicker } from './feynman/CoursePicker';
import { DailyQuests } from './feynman/DailyQuests';
import { SessionLog } from './feynman/SessionLog';
import { StoryShelf } from './feynman/StoryShelf';
import { FeynmanSideNav } from './feynman/SideNav';
import s from './feynman/feynman.module.css';

const LOG_LIMIT = 6;

export default function FeynmanView({ owner, topic, topics, onView }: TerminalViewProps) {
  const navigate = useNavigate();
  const hasSidebar = useSidebarVisible();
  // 手机：页首收紧，选课收进底部抽屉，故事匣横向滑动
  const phone = useMediaQuery('(max-width: 760px)');
  const [pickerOpen, setPickerOpen] = useState(false);
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const global = useAppStore((state) => state.global);
  const live = useAppStore((state) => state.live);
  const startReview = useAppStore((state) => state.startReview);

  const progress = useJourneyProgress(owner);
  const { board, stage, now } = progress;
  const celebration = useCelebration(owner, board, stage.stage, stage.name);

  const [reviewBusy, setReviewBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => deriveCourseRows({ topics, topicStates, events, now }),
    [topics, topicStates, events, now],
  );

  const primary = useMemo(() => derivePrimaryAction({
    events, reports, topicStates, topics, live,
    fallbackTopic: topic && !topic.locked ? topic : rows[0]?.topic,
  }), [events, reports, topicStates, topics, live, topic, rows]);

  // 选中的课：路由里打开的课 > 当下一步指向的课 > 书架第一门
  const selected = useMemo(() => {
    for (const id of [topic?.topicId, primary.topicId]) {
      const row = id ? rows.find((item) => item.topic.topicId === id) : undefined;
      if (row) return row.topic;
    }
    return rows[0]?.topic;
  }, [topic, primary.topicId, rows]);

  const stations = useMemo(() => (selected
    ? deriveStations({ topic: selected, state: topicStates[selected.topicId], events, reports, live, now })
    : []), [selected, topicStates, events, reports, live, now]);

  const focus = useMemo(() => {
    const row = selected ? rows.find((item) => item.topic.topicId === selected.topicId) : undefined;
    return row ? deriveCourseFocus({ row, state: topicStates[row.topic.topicId], events, reports, live }) : null;
  }, [selected, rows, topicStates, events, reports, live]);

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

  const runFocus = (action: FocusAction) => {
    if (action.review && selected) void goReview(selected.topicId);
    else navigate(action.to);
  };

  /** 换课留在本板块：只换路由里的课 */
  const selectCourse = (topicId: string) => {
    setPickerOpen(false);
    if (topicId === topic?.topicId) return;
    navigate(`/prep/${encodeURIComponent(topicId)}?view=feynman`);
  };

  const scrollToPicker = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pickerRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
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
  };

  const quests = (
    <DailyQuests
      board={board}
      fresh={celebration.quests}
      busy={reviewBusy}
      wide={hasSidebar}
      onGo={runQuest}
    />
  );

  return (
    <div className={s.page}>
      <SidebarPortal>
        <FeynmanSideNav
          primary={primary}
          busy={reviewBusy}
          rows={rows}
          selectedId={selected?.topicId ?? null}
          records={records}
          totalSessions={reports.length}
          onPrimary={runPrimary}
          onSelect={selectCourse}
          onOpen={navigate}
        />
      </SidebarPortal>

      <Hero
        compact={phone}
        progress={progress}
        primary={primary}
        busy={reviewBusy}
        stageUp={celebration.stageUp}
        onPrimary={runPrimary}
        onGrowth={() => navigate('/growth')}
      />

      {selected && focus && (
        <CourseFocus
          topic={selected}
          focus={focus}
          busy={reviewBusy}
          onRun={runFocus}
          compact={phone}
          onPick={phone ? () => setPickerOpen(true) : hasSidebar ? undefined : scrollToPicker}
        />
      )}

      <details className={s.secondaryDetails}>
        <summary>查看完整学习流程</summary>
        <LoopStations topic={selected} stations={stations} busy={reviewBusy} onRun={runStation} compact={phone} />
      </details>

      {phone ? (
        <>
          {quests}
          <SessionLog records={records} total={reports.length} onOpen={navigate} />
          <Dialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            title="选一门课教给小白"
            description="掌握度按小白真正听懂的要点计算，久不复习会回落。"
            size="md"
          >
            <CoursePicker sheet rows={rows} selectedId={selected?.topicId ?? null} onSelect={selectCourse} />
          </Dialog>
        </>
      ) : hasSidebar ? quests : (
        <>
          <div className={s.columns}>
            <div ref={pickerRef} className={s.anchor}>
              <CoursePicker rows={rows} selectedId={selected?.topicId ?? null} onSelect={selectCourse} />
            </div>
            {quests}
          </div>
          <SessionLog records={records} total={reports.length} onOpen={navigate} />
        </>
      )}

      <details className={s.secondaryDetails}>
        <summary>故事匣与成就</summary>
        <StoryShelf owner={owner} input={storyInput} records={records} reviewBusy={reviewBusy}
          onReview={(topicId) => void goReview(topicId)} onOpen={navigate} />
      </details>
    </div>
  );
}
