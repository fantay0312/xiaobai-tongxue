/**
 * 注意力机制 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/attention.ts 的内容红线咬合:
 * 线粗表示「信息混合时从那个词取得多」,不说「模型认为重要」(attention ≠ explanation 之争);
 * 权重个个大于零、总和为 1(软分配,人人有份)——示例权重 0.62+0.06+0.22+0.10 = 1.00。
 * 场景选「它」回指:与 checklist 的 transferHint(分清"它"指谁)一致。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const JADE_INK = 'var(--jade-ink)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:「它」在偷看谁——弧线越粗,从那个词取的内容越多 */
export function AttnLinksSvg({ className }: { className?: string }) {
  const words = [
    { cx: 90, w: 74, label: '小狗' },
    { cx: 220, w: 74, label: '叼着' },
    { cx: 340, w: 54, label: '球' },
    { cx: 470, w: 54, label: '它', query: true },
    { cx: 610, w: 94, label: '跑远了' },
  ];
  // 从「它」出发的注意力弧:控制点抬高,粗细 ∝ 权重
  const arcs = [
    { to: 90, ctrl: [280, 60] as const, w: 7, weight: '0.62', lx: 280, ly: 118 },
    { to: 220, ctrl: [345, 110] as const, w: 1.5, weight: '0.06', lx: 345, ly: 142 },
    { to: 340, ctrl: [405, 140] as const, w: 3, weight: '0.22', lx: 405, ly: 164 },
    { to: 610, ctrl: [540, 150] as const, w: 1.5, weight: '0.10', lx: 540, ly: 168 },
  ];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:句子「小狗叼着球,它跑远了」里,「它」向每个词都连了一条弧线,和「小狗」的弧线最粗,权重 0.62;所有权重都大于零、总和为 1"
      className={className}
    >
      <text x="360" y="34" textAnchor="middle" fontSize="14" fill={INK}>
        线越粗 = 信息混合时,从那个词取得越多
      </text>
      <text x="700" y="64" textAnchor="end" fontSize="13" fill={JADE_INK}>权重个个大于零、总和为 1</text>
      <text x="700" y="84" textAnchor="end" fontSize="13" fill={JADE_INK}>人人有份,只是分量不同</text>

      {/* 注意力弧线(从「它」顶边出发) */}
      {arcs.map((a) => (
        <g key={a.to}>
          <path
            d={`M 470 206 Q ${a.ctrl[0]} ${a.ctrl[1]} ${a.to} 206`}
            fill="none"
            stroke={AZURE}
            strokeWidth={a.w}
            strokeLinecap="round"
            opacity="0.8"
          />
          <text x={a.lx} y={a.ly} textAnchor="middle" fontSize="13" fontFamily={CODE} fill={SOFT}>{a.weight}</text>
        </g>
      ))}

      {/* 词块 */}
      {words.map((w) => (
        <g key={w.label}>
          <rect
            x={w.cx - w.w / 2}
            y="210"
            width={w.w}
            height="44"
            rx="6"
            fill={w.query ? AZURE_WASH : PAPER_WARM}
            stroke={w.query ? AZURE : PAPER_EDGE}
            strokeWidth={w.query ? 2 : 1}
          />
          <text
            x={w.cx}
            y="239"
            textAnchor="middle"
            fontSize="17"
            fontFamily={DISPLAY}
            fill={w.query ? AZURE_DEEP : INK}
          >
            {w.label}
          </text>
        </g>
      ))}

      <text x="470" y="280" textAnchor="middle" fontSize="13" fill={SOFT}>「它」拿着问题,问遍全句</text>
      <text x="110" y="280" textAnchor="middle" fontSize="13" fill={SOFT}>回指「小狗」,取得最多</text>
    </svg>
  );
}
