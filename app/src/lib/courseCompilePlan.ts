import type { CustomAsset } from './customContent';

export function orderedCourseAssets(assets: CustomAsset[]): CustomAsset[] {
  return [...assets].sort((a, b) => a.filename.localeCompare(b.filename, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id));
}
const key = (owner: string | null, course: string) => `xiaobai-compile-plan-v1:${encodeURIComponent(owner ?? '')}:${course}`;
export function readCompilePlan(owner: string | null, course: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(owner, course)) ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)))].slice(0, 12) : [];
  } catch { return []; }
}
export function saveCompilePlan(owner: string | null, course: string, ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(key(owner, course), JSON.stringify(ids));
    else localStorage.removeItem(key(owner, course));
  } catch { /* The current in-memory selection remains usable without storage. */ }
}
