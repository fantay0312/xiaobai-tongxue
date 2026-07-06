/**
 * Token 与分词 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/tokenization.ts 的 microLecture 咬合:
 * 「先查词表再切块,有整用整没整拆碎」——图一画三段流水(原句→积木块→编号序列),
 * 图二画粒度对比(常见词整块 / 生僻词拆碎),朱砂只标「字数=块数」这个坑,不作普通强调。
 * 颜色一律走 tokens.css 变量;文字 font-family 继承页面,数字/编号走 --font-code。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const CINNABAR = 'var(--cinnabar)';
const CINNABAR_WASH = 'var(--cinnabar-wash)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const INK_WASH = 'var(--ink-wash)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:一句话 → 积木块 → 编号序列 的三段流水 */
export function TokPipelineSvg({ className }: { className?: string }) {
  const blocks = [
    { x: 274, label: '今天' },
    { x: 342, label: '天气' },
    { x: 410, label: '不错' },
  ];
  const ids = [
    { x: 540, label: '3721' },
    { x: 598, label: '882' },
    { x: 656, label: '1509' },
  ];
  return (
    <svg
      viewBox="0 0 720 260"
      width="100%"
      role="img"
      aria-label="示意图:一句话先照词表切成积木块,再把每块换成编号,模型只读到编号序列"
      className={className}
    >
      <defs>
        <marker id="tok1-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 阶段标号 */}
      <text x="115" y="52" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={SOFT}>① 你发的一句话</text>
      <text x="373" y="52" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={SOFT}>② 切成积木块</text>
      <text x="624" y="52" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={SOFT}>③ 换成编号</text>

      {/* ① 原句卡片 */}
      <rect x="30" y="80" width="170" height="56" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} />
      <text x="115" y="115" textAnchor="middle" fontSize="18" fontFamily={DISPLAY} fill={INK}>今天天气不错</text>

      {/* 箭头一:查词表切块 */}
      <line x1="210" y1="108" x2="260" y2="108" stroke={SOFT} strokeWidth="1.5" markerEnd="url(#tok1-arrow)" strokeLinecap="round" />
      <text x="236" y="92" textAnchor="middle" fontSize="13" fill={SOFT}>查词表切块</text>

      {/* ② 积木块 */}
      {blocks.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y="88" width="62" height="40" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.5" strokeLinejoin="round" />
          <text x={b.x + 31} y="114" textAnchor="middle" fontSize="16" fill={AZURE_DEEP}>{b.label}</text>
        </g>
      ))}
      <text x="373" y="152" textAnchor="middle" fontSize="13" fill={FAINT}>有整用整,没整拆碎</text>

      {/* 箭头二:换编号 */}
      <line x1="484" y1="108" x2="528" y2="108" stroke={SOFT} strokeWidth="1.5" markerEnd="url(#tok1-arrow)" strokeLinecap="round" />
      <text x="506" y="92" textAnchor="middle" fontSize="13" fill={SOFT}>每块一个编号</text>

      {/* ③ 编号序列 */}
      {ids.map((n) => (
        <g key={n.label}>
          <rect x={n.x} y="88" width="52" height="40" rx="5" fill={INK_WASH} />
          <text x={n.x + 26} y="113" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>{n.label}</text>
        </g>
      ))}

      {/* 收束一句 */}
      <text x="360" y="206" textAnchor="middle" fontSize="14" fill={SOFT}>
        模型全程面对的只有这串编号——它眼里没有字,只有块
      </text>
    </svg>
  );
}

/** 图二:常见词整块 vs 生僻词拆碎(字数 ≠ 块数) */
export function TokGranularitySvg({ className }: { className?: string }) {
  const row1 = [
    { x: 252, w: 64, label: '今天' },
    { x: 324, w: 64, label: '天气' },
    { x: 396, w: 64, label: '不错' },
  ];
  const row2 = [
    { x: 252, w: 40, label: '魑' },
    { x: 300, w: 40, label: '魅' },
    { x: 348, w: 40, label: '魍' },
    { x: 396, w: 40, label: '魉' },
  ];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:常见词在词表里有现成整块,一刀一块;生僻词没有整块,被拆成碎块——字数和块数不是一一对应"
      className={className}
    >
      <defs>
        <marker id="tok2-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 第一行:常见词 */}
      <text x="30" y="96" fontSize="17" fontFamily={DISPLAY} fill={INK}>「今天天气不错」</text>
      <text x="95" y="120" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={FAINT}>6 个字</text>
      <line x1="200" y1="90" x2="238" y2="90" stroke={SOFT} strokeWidth="1.5" markerEnd="url(#tok2-arrow)" strokeLinecap="round" />
      {row1.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y="70" width={b.w} height="38" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.5" />
          <text x={b.x + b.w / 2} y="95" textAnchor="middle" fontSize="16" fill={AZURE_DEEP}>{b.label}</text>
        </g>
      ))}
      <text x="478" y="96" fontSize="15" fontFamily={CODE} fill={INK}>3 块</text>
      <text x="540" y="96" fontSize="14" fill={SOFT}>常见词:有现成整块</text>

      {/* 第二行:生僻词 */}
      <text x="30" y="176" fontSize="17" fontFamily={DISPLAY} fill={INK}>「魑魅魍魉」</text>
      <text x="80" y="200" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={FAINT}>4 个字</text>
      <line x1="200" y1="170" x2="238" y2="170" stroke={SOFT} strokeWidth="1.5" markerEnd="url(#tok2-arrow)" strokeLinecap="round" />
      {row2.map((b, i) => (
        <g key={b.label} transform={`rotate(${i % 2 === 0 ? -2 : 2} ${b.x + 20} ${170})`}>
          <rect x={b.x} y="151" width={b.w} height="38" rx="4" fill="none" stroke={AZURE} strokeWidth="1.3" />
          <text x={b.x + 20} y="176" textAnchor="middle" fontSize="16" fill={AZURE_DEEP}>{b.label}</text>
        </g>
      ))}
      <text x="478" y="168" fontSize="15" fontFamily={CODE} fill={INK}>4 块,甚至更碎</text>
      <text x="478" y="192" fontSize="13" fill={SOFT}>生僻词:没整块,拆碎兜底(最坏到字节)</text>

      <line x1="30" y1="224" x2="690" y2="224" stroke={PAPER_EDGE} />

      {/* 坑:字数=块数 */}
      <rect x="120" y="242" width="480" height="42" rx="6" fill={CINNABAR_WASH} stroke={CINNABAR} strokeDasharray="6 4" />
      <g transform="rotate(-6 152 263)">
        <rect x="140" y="251" width="24" height="24" fill="none" stroke={CINNABAR} strokeWidth="2" />
        <text x="152" y="269" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑</text>
      </g>
      <text x="182" y="269" fontSize="14" fill={INK}>「有几个字就有几块」不成立——字数定不了块数</text>
    </svg>
  );
}
