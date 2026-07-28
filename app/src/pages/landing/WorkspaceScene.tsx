import type { LearningStage } from './landingData';
import type { DemoMotionMode } from './useLearningDemo';
import {
  PrepScene,
  ReteachScene,
  TeachScene,
} from './WorkspaceLessonScenes';
import {
  ExamScene,
  RemedyScene,
  ReviewScene,
} from './WorkspaceReviewScenes';

interface WorkspaceSceneProps {
  stageId: LearningStage['id'];
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  onInteract: () => void;
}

export function WorkspaceScene({
  stageId,
  motionMode,
  reducedMotion,
  onInteract,
}: WorkspaceSceneProps) {
  if (stageId === 'prep') {
    return <PrepScene motionMode={motionMode} onInteract={onInteract} />;
  }
  if (stageId === 'teach') {
    return <TeachScene motionMode={motionMode} reducedMotion={reducedMotion} />;
  }
  if (stageId === 'exam') {
    return <ExamScene motionMode={motionMode} reducedMotion={reducedMotion} />;
  }
  if (stageId === 'review') return <ReviewScene motionMode={motionMode} />;
  if (stageId === 'remedy') {
    return <RemedyScene motionMode={motionMode} onInteract={onInteract} />;
  }
  return <ReteachScene motionMode={motionMode} reducedMotion={reducedMotion} />;
}
