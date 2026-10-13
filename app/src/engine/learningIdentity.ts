export type CompanionActor = 'xiaobai' | 'xiaoyan';
export interface CompanionPosition { x: number; y: number; }
export interface LearningIdentity {
  acceptedAt: string | null;
  actor: CompanionActor;
  minimized: boolean;
  position: CompanionPosition | null;
  lastTopicId: string | null;
}

const PREFIX = 'xiaobai-learning-identity-v1:';
export const emptyLearningIdentity = (): LearningIdentity => ({ acceptedAt: null, actor: 'xiaoyan', minimized: false, position: null, lastTopicId: null });

export function loadLearningIdentity(owner: string | null): LearningIdentity {
  const base = emptyLearningIdentity();
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + encodeURIComponent(owner ?? 'local-demo')) ?? 'null');
    if (!raw || typeof raw !== 'object') return base;
    return {
      acceptedAt: typeof raw.acceptedAt === 'string' && Number.isFinite(Date.parse(raw.acceptedAt)) ? raw.acceptedAt : null,
      actor: raw.actor === 'xiaobai' ? 'xiaobai' : 'xiaoyan', minimized: raw.minimized === true,
      position: raw.position && Number.isFinite(raw.position.x) && Number.isFinite(raw.position.y) ? { x: raw.position.x, y: raw.position.y } : null,
      lastTopicId: typeof raw.lastTopicId === 'string' ? raw.lastTopicId.slice(0, 180) : null,
    };
  } catch { return base; }
}

export function saveLearningIdentity(owner: string | null, identity: LearningIdentity): void {
  try { localStorage.setItem(PREFIX + encodeURIComponent(owner ?? 'local-demo'), JSON.stringify(identity)); } catch { /* UI choices stay available for this visit. */ }
}

export function clampCompanionPosition(position: CompanionPosition, viewport: { width: number; height: number }, size = { width: 176, height: 240 }): CompanionPosition {
  return {
    x: Math.round(Math.max(8, Math.min(position.x, Math.max(8, viewport.width - size.width - 8)))),
    y: Math.round(Math.max(64, Math.min(position.y, Math.max(64, viewport.height - size.height - 8)))),
  };
}
