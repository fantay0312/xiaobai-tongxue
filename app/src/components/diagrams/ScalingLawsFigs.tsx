/**
 * Scaling Laws —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/scalingLaws.ts 的 microLecture 咬合:
 * 图一画双对数坐标:损失沿近似直线下降(幂律=可预测的收益递减),实测点之外用虚线外推,
 * 并明写「一直外推是否成立,有争议」;三原料(参数 N/数据 D/算力 C)作横轴注记。
 * 图二画 Chinchilla 配平:同一笔算力,70B 吃 4 倍数据全面胜过 280B——
 * 「每参数约 20 token」带限定语,朱砂只标「只堆参数不喂数据」这个坑。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const JADE = 'var(--jade)';
const JADE_INK = 'var(--jade-ink)';
const JADE_WASH = 'var(--jade-wash)';
const CINNABAR = 'var(--cinnabar)';
const PAPER = 'var(--paper)';
const PAPER_WARM = 'var(--paper-warm)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:双对数坐标下,损失沿近似直线下降;外推段用虚线并标注争议 */
export function SlLogLogSvg({ className }: { className?: string }) {
  const measured = [
    [150, 80],
    [270, 106],
    [390, 132],
    [510, 158],
  ] as const;
  const ticks = [
    { x: 150, label: '1×' },
    { x: 270, label: '10×' },
    { x: 390, label: '100×' },
    { x: 510, label: '1000×' },
    { x: 630, label: '10⁴×' },
  ];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:双对数坐标下,损失随规模沿一条近似直线下降,规模每翻一倍只按固定比例再降一点;实测点之外的虚线外推是否一直成立仍有争议,下方还有数据噪声决定的不可约底线"
      className={className}
    >
      <defs>
        <marker id="sl1-axis" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 坐标轴 */}
      <line x1="90" y1="240" x2="690" y2="240" stroke={INK} strokeWidth="1.5" markerEnd="url(#sl1-axis)" />
      <line x1="90" y1="240" x2="90" y2="42" stroke={INK} strokeWidth="1.5" markerEnd="url(#sl1-axis)" />
      <text x="98" y="36" fontSize="13" fill={SOFT}>损失(对数刻度,越低越好)</text>
      <text x="690" y="262" textAnchor="end" fontSize="13" fill={SOFT}>规模(对数刻度)</text>
      {ticks.map((t) => (
        <g key={t.x}>
          <line x1={t.x} y1="240" x2={t.x} y2="246" stroke={INK} strokeWidth="1.2" />
          <text x={t.x} y="261" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={FAINT}>{t.label}</text>
        </g>
      ))}

      {/* 不可约底线 */}
      <line x1="90" y1="222" x2="688" y2="222" stroke={FAINT} strokeWidth="1" strokeDasharray="3 4" />
      <text x="100" y="214" fontSize="13" fill={FAINT}>不可约底线:数据噪声,压不下去的部分</text>

      {/* 实测直线 + 外推虚线 */}
      <polyline
        points={measured.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={AZURE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line x1="510" y1="158" x2="666" y2="192" stroke={FAINT} strokeWidth="1.6" strokeDasharray="6 5" />
      {measured.map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="3.5" fill={AZURE} />
      ))}
      <circle cx="630" cy="184" r="3.5" fill={PAPER} stroke={AZURE} strokeWidth="1.4" />

      {/* 读图注 */}
      <text x="350" y="96" fontSize="14" fill={INK}>每翻一倍,只按固定比例再降一点</text>
      <text x="688" y="66" textAnchor="end" fontSize="13" fill={SOFT}>● 小模型实测:近似一条直线</text>
      <text x="688" y="86" textAnchor="end" fontSize="13" fill={FAINT}>○ 往更大外推:是否一直成立,有争议</text>

      {/* 三原料注记 */}
      <text x="90" y="284" fontSize="13" fill={AZURE_DEEP}>
        横轴的「规模」换成 参数 N、数据 D、算力 C,都近似如此
      </text>
    </svg>
  );
}

/** 图二:同一笔算力的两种花法——Chinchilla 配平胜过 Gopher 堆料 */
export function SlChinchillaSvg({ className }: { className?: string }) {
  const bagsChinchilla = [285, 315, 345, 375, 405, 435, 465, 495];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:同一笔算力,Gopher 用 280B 参数只配约 0.3T token,显著训练不足;Chinchilla 用 70B 参数配约 1.4T token,同算力全面胜出——参数和数据要配平"
      className={className}
    >
      <text x="360" y="40" textAnchor="middle" fontSize="16" fontFamily={DISPLAY} fill={INK}>同一笔算力,两种花法</text>

      {/* Gopher:大脑袋,少口粮 */}
      <text x="30" y="96" fontSize="15" fontFamily={CODE} fill={INK}>Gopher</text>
      <text x="30" y="118" fontSize="13" fontFamily={CODE} fill={SOFT}>280B 参数</text>
      <rect x="150" y="76" width="200" height="56" rx="6" fill={PAPER_WARM} stroke={SOFT} strokeWidth="1.3" />
      <text x="250" y="110" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={SOFT}>大脑袋</text>
      <text x="372" y="110" fontSize="15" fill={FAINT}>×</text>
      <rect x="396" y="90" width="24" height="30" rx="4" fill={PAPER_WARM} stroke={FAINT} strokeWidth="1.2" />
      <rect x="428" y="90" width="24" height="30" rx="4" fill={PAPER_WARM} stroke={FAINT} strokeWidth="1.2" />
      <text x="466" y="103" fontSize="13" fontFamily={CODE} fill={SOFT}>约 0.3T token</text>
      <text x="466" y="122" fontSize="13" fill={FAINT}>只喂了个半饱</text>
      <text x="690" y="110" textAnchor="end" fontSize="14" fill={SOFT}>显著训练不足</text>

      {/* Chinchilla:小一号,喂得饱 */}
      <text x="30" y="186" fontSize="15" fontFamily={CODE} fill={INK}>Chinchilla</text>
      <text x="30" y="208" fontSize="13" fontFamily={CODE} fill={SOFT}>70B 参数</text>
      <rect x="150" y="172" width="90" height="48" rx="6" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.4" />
      <text x="195" y="201" textAnchor="middle" fontSize="13" fill={AZURE_DEEP}>小一号</text>
      <text x="258" y="200" fontSize="15" fill={FAINT}>×</text>
      {bagsChinchilla.map((x) => (
        <rect key={x} x={x} y="180" width="24" height="32" rx="4" fill={JADE_WASH} stroke={JADE} strokeWidth="1.2" />
      ))}
      <text x="285" y="240" fontSize="13" fontFamily={CODE} fill={JADE_INK}>约 1.4T token(每参数约 20 个)</text>

      {/* 胜 印章 */}
      <g transform="rotate(8 662 190)">
        <rect x="636" y="164" width="52" height="52" fill="none" stroke={JADE} strokeWidth="2" />
        <text x="662" y="200" textAnchor="middle" fontSize="24" fontFamily={DISPLAY} fill={JADE_INK}>胜</text>
      </g>
      <text x="662" y="240" textAnchor="middle" fontSize="13" fill={JADE_INK}>同算力全面胜出</text>

      {/* 坑 + 限定语 */}
      <g transform="rotate(-6 42 270)">
        <rect x="30" y="258" width="24" height="24" fill="none" stroke={CINNABAR} strokeWidth="2" />
        <text x="42" y="276" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑</text>
      </g>
      <text x="70" y="276" fontSize="14" fill={INK}>只堆参数不喂数据,等于白烧算力</text>
      <text x="690" y="276" textAnchor="end" fontSize="13" fill={FAINT}>「每参数 20 token」只是量级参考,别当铁律</text>
    </svg>
  );
}
