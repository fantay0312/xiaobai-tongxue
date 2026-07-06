/**
 * 结业证书 —— 出师那一刻的仪式资产(doc §7),只在 report.masteredNow 时由复盘页挂载。
 * 最重要的一行是「授业师:{学生名}」——落款放大,登录名缺席时退「先生」。
 * 全部字段来自真实数据:课程/知识点出自 Topic,问难回数出自 report.turnCount,
 * 落款干支出自 report.endedAt —— 证书不发明任何事实。
 */
import { useAuthStore } from '../../store/authStore';
import { sexagenaryLabel } from '../../engine/story';
import type { SessionReport, Topic } from '../../types';
import s from './certificate.module.css';

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1~99 → 中文数字(问难回数展示用);超界回退阿拉伯数字,证书不许出现怪写法 */
function cnCount(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 99) return String(n);
  if (n < 10) return CN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tenPart = tens === 1 ? '十' : `${CN_DIGITS[tens]}十`;
  return ones ? `${tenPart}${CN_DIGITS[ones]}` : tenPart;
}

export function MasteryCertificate({ topic, report }: { topic: Topic; report: SessionReport }) {
  const user = useAuthStore((st) => st.user);
  const teacherName = user ?? '先生';

  return (
    <section className={s.cert} aria-label="结业证书">
      <h2 className={s.certTitle}>结业证书</h2>
      <p className={s.certBody}>兹有弟子小白,习《{topic.course} · {topic.title}》</p>
      <p className={s.certBody}>问难{cnCount(report.turnCount)}回,心魔尽除,今已出师</p>
      <p className={s.certTeacher}>授业师:{teacherName}</p>
      <p className={s.certDate}>{sexagenaryLabel(report.endedAt)} 于书院</p>
      <span className={s.certSeal} aria-hidden="true">出师</span>
    </section>
  );
}
