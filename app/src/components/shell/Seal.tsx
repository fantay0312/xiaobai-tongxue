/**
 * 「白」字白文印 —— 全站唯一品牌标记。
 * 与 public/favicon.svg 同一枚章,改任一侧务必同步另一侧。
 * 朱砂底、留白界格、以负空间勾「白」字(点 + 日字框 + 中横)。
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
        d="M27.4 8.4 Q 24.6 12.8 20.2 15.4"
        fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinecap="round"
      />
      <rect
        x="14.6" y="18.4" width="18.8" height="20.4" rx="1.8"
        fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinejoin="round"
      />
      <path d="M17 28.8 H 31" stroke="var(--paper)" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  );
}
