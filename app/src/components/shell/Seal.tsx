/**
 * 问学印 —— 全站唯一品牌标记(纯图形,无字)。
 * 朱砂印底上一笔不闭合的墨白圆(留白的缺口 = 尚未想明白的「困」),
 * 笔锋向内收成一点,像一个正在打转、还没落定的念头 —— 教然后知困。
 * 与 public/favicon.svg 同一枚章,改任一侧务必同步另一侧。
 */
export function Seal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="43" height="43" rx="9" fill="var(--cinnabar)" />
      <rect
        x="6.5" y="6.5" width="35" height="35" rx="5.5"
        fill="none" stroke="var(--paper)" strokeOpacity="0.28" strokeWidth="1.4"
      />
      <path
        d="M22.4 12.61 C29.32 11.64 35.5 17.01 35.5 24 C35.5 30.35 30.35 35.5 24 35.5 C20.5 35.5 17.51 31.37 17.07 28 C16.69 25.02 16.79 22.45 19.17 20.62"
        fill="none" stroke="var(--paper)" strokeWidth="5" strokeLinecap="round"
      />
      <circle cx="25.8" cy="25.3" r="3" fill="var(--paper)" />
    </svg>
  );
}
