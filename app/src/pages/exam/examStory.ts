import type { XiaobaiQuizResult } from '../../types';

export type ExamBeat = 'prompt' | 'thinking' | 'writing' | 'judged';
export type Understanding = 'steady' | 'misled' | 'shaky' | 'unseen';

export const EXAM_BEATS: { key: ExamBeat; no: string; label: string }[] = [
  { key: 'prompt', no: '壹', label: '亮题' },
  { key: 'thinking', no: '贰', label: '心声' },
  { key: 'writing', no: '叁', label: '落笔' },
  { key: 'judged', no: '肆', label: '判定' },
];

export const BEAT_INDEX = Object.fromEntries(
  EXAM_BEATS.map((beat, index) => [beat.key, index]),
) as Record<ExamBeat, number>;

export function deriveUnderstanding(
  answer: XiaobaiQuizResult['answers'][number] | undefined,
  carriedMisconception: boolean,
  hitChecklist: string[],
): Understanding {
  if (answer?.correct) return 'steady';
  if (carriedMisconception) return 'misled';
  if (answer && hitChecklist.includes(answer.checklistRef)) return 'shaky';
  return 'unseen';
}

export function examWhisper(understanding: Understanding, point: string): string {
  if (understanding === 'steady') {
    return `这个先生讲过！是「${point}」……我记得当时那套讲法。`;
  }
  if (understanding === 'misled') {
    return '这题我会。先生当时讲的就是这个意思……我照记住的写。';
  }
  if (understanding === 'shaky') {
    return '这处听过……可中间那一步怎么接来着？……我再想一想。';
  }
  return '呃……这处先生好像没细讲……我只能照自己的理解试一试。';
}

export function thinkingDuration(understanding: Understanding, mastery: number): number {
  const uncertainty = 1 - Math.min(1, Math.max(0, mastery));
  if (understanding === 'steady') return Math.round(1000 + uncertainty * 1000);
  if (understanding === 'misled') return Math.round(1200 + uncertainty * 800);
  if (understanding === 'shaky') return Math.round(3000 + uncertainty * 2000);
  return Math.round(6000 + uncertainty * 2000);
}
