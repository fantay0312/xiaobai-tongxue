import type { LearningStage } from './landingData';
import type { DemoMotionMode } from './useLearningDemo';
import {
  PrepScene,
  ReteachScene,
} from './WorkspaceLessonScenes';
import { TeachScene } from './WorkspaceTeachScene';
import type { TeachDemoSessionSummary } from './landingTeachDemo';
import {
  ExamScene,
  RemedyScene,
  ReviewScene,
} from './WorkspaceReviewScenes';

interface WorkspaceSceneProps {
  stageId: LearningStage['id'];
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  teachSession: TeachDemoSessionSummary;
  onInteract: () => void;
  onTeachSessionChange: (session: TeachDemoSessionSummary) => void;
}

export function WorkspaceScene({
  stageId,
  motionMode,
  reducedMotion,
  teachSession,
  onInteract,
  onTeachSessionChange,
}: WorkspaceSceneProps) {
  if (stageId === 'prep') {
    return <PrepScene motionMode={motionMode} onInteract={onInteract} />;
  }
  if (stageId === 'teach') {
    return (
      <TeachScene
        motionMode={motionMode}
        reducedMotion={reducedMotion}
        onInteract={onInteract}
        onSessionChange={onTeachSessionChange}
      />
    );
  }
  if (stageId === 'exam') {
    return (
      <ExamScene
        motionMode={motionMode}
        reducedMotion={reducedMotion}
        teachOutcome={teachSession.outcome}
      />
    );
  }
  if (stageId === 'review') {
    return <ReviewScene motionMode={motionMode} teachOutcome={teachSession.outcome} />;
  }
  if (stageId === 'remedy') {
    return (
      <RemedyScene
        motionMode={motionMode}
        onInteract={onInteract}
        teachOutcome={teachSession.outcome}
      />
    );
  }
  return (
    <ReteachScene
      motionMode={motionMode}
      reducedMotion={reducedMotion}
      teachOutcome={teachSession.outcome}
    />
  );
}
