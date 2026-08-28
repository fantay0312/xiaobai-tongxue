import { useLayoutEffect, useRef, useState } from 'react';
import { LEARNING_STAGES } from './landingData';
import { PlaybackHeader, StageTabs } from './LearningWorkspaceControls';
import { useLearningDemo } from './useLearningDemo';
import { WorkspaceCourseRail } from './WorkspaceCourseRail';
import { WorkspaceEvidenceRail } from './WorkspaceEvidenceRail';
import { WorkspaceScene } from './WorkspaceScene';
import {
  INITIAL_TEACH_DEMO_SESSION,
  type TeachDemoSessionSummary,
} from './landingTeachDemo';
import s from './LearningWorkspace.module.css';

export function LearningWorkspace() {
  const workspaceRef = useRef<HTMLElement>(null);
  const playback = useLearningDemo(workspaceRef);
  const [teachSession, setTeachSession] = useState<TeachDemoSessionSummary>(
    INITIAL_TEACH_DEMO_SESSION,
  );
  const activeStage = LEARNING_STAGES[playback.activeIndex] ?? LEARNING_STAGES[0];
  const sceneKey = `${activeStage.id}-${playback.replayEpoch}`;
  const [settledSceneKey, setSettledSceneKey] = useState<string | null>(null);
  const entranceSettled = playback.intent !== 'playing' || settledSceneKey === sceneKey;
  useLayoutEffect(() => {
    if (playback.intent !== 'playing') setSettledSceneKey(sceneKey);
  }, [playback.intent, sceneKey]);
  const resetTeachSession = () => setTeachSession(INITIAL_TEACH_DEMO_SESSION);
  const chooseStage = (index: number) => {
    if (index === 0) resetTeachSession();
    playback.selectStage(index);
  };
  const viewNextStage = () => {
    if (playback.activeIndex === LEARNING_STAGES.length - 1) resetTeachSession();
    playback.nextStage();
  };
  const togglePlayback = () => {
    if (playback.finished) resetTeachSession();
    playback.togglePlayback();
  };
  return (
    <section
      className={s.workspace}
      ref={workspaceRef}
      aria-label="一堂课演示"
      data-motion={playback.motionMode}
    >
      <PlaybackHeader
        stage={activeStage}
        intent={playback.intent}
        finished={playback.finished}
        reducedMotion={playback.reducedMotion}
        onNext={viewNextStage}
        onToggle={togglePlayback}
      />
      <StageTabs
        activeIndex={playback.activeIndex}
        effectivePlaying={playback.effectivePlaying}
        finished={playback.finished}
        onChoose={chooseStage}
        onPause={playback.pausePlayback}
      />
      <div
        className={s.workspaceBody}
        id="learning-workspace-panel"
        role="tabpanel"
        aria-labelledby={`learning-stage-${activeStage.id}`}
      >
        <WorkspaceCourseRail activeIndex={playback.activeIndex} />
        <div
          className={s.sceneFrame}
          data-entrance-settled={entranceSettled}
          key={sceneKey}
        >
          <WorkspaceScene
            stageId={activeStage.id}
            motionMode={playback.motionMode}
            reducedMotion={playback.reducedMotion}
            teachSession={teachSession}
            onInteract={playback.pausePlayback}
            onTeachSessionChange={setTeachSession}
          />
        </div>
        <WorkspaceEvidenceRail stageId={activeStage.id} teachSession={teachSession} />
      </div>
    </section>
  );
}

export default LearningWorkspace;
