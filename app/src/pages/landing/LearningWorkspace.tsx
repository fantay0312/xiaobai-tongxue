import { useRef } from 'react';
import { LEARNING_STAGES } from './landingData';
import { PlaybackHeader, StageTabs } from './LearningWorkspaceControls';
import { useLearningDemo } from './useLearningDemo';
import { WorkspaceCourseRail } from './WorkspaceCourseRail';
import { WorkspaceEvidenceRail } from './WorkspaceEvidenceRail';
import { WorkspaceScene } from './WorkspaceScene';
import s from './LearningWorkspace.module.css';

export function LearningWorkspace() {
  const workspaceRef = useRef<HTMLElement>(null);
  const playback = useLearningDemo(workspaceRef);
  const activeStage = LEARNING_STAGES[playback.activeIndex] ?? LEARNING_STAGES[0];
  const chooseStage = (index: number) => playback.selectStage(index);
  return (
    <section
      className={s.workspace}
      ref={workspaceRef}
      aria-label="备课到再讲的产品回放"
      data-motion={playback.motionMode}
      onFocusCapture={playback.pausePlayback}
    >
      <PlaybackHeader
        stage={activeStage}
        intent={playback.intent}
        finished={playback.finished}
        reducedMotion={playback.reducedMotion}
        onNext={playback.nextStage}
        onToggle={playback.togglePlayback}
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
        <WorkspaceCourseRail activeIndex={playback.activeIndex} onStageSelect={chooseStage} />
        <div className={s.sceneFrame} key={activeStage.id}>
          <WorkspaceScene
            stageId={activeStage.id}
            motionMode={playback.motionMode}
            reducedMotion={playback.reducedMotion}
            onInteract={playback.pausePlayback}
          />
        </div>
        <WorkspaceEvidenceRail stageId={activeStage.id} />
      </div>
    </section>
  );
}

export default LearningWorkspace;
