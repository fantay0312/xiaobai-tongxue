/** 相对日期(册页口吻):今天 / 昨天 / N 天前(≤30)/ M月D日;非法日期返回空串 */
export function relDay(iso: string, nowMs: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor((nowMs - ms) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days <= 30) return `${days} 天前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
