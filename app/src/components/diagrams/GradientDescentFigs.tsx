/**
 * 梯度下降与学习率 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/gradientDescent.ts 的 microLecture 咬合:
 * 「方向看梯度,步子看学习率」——图一画等高线山谷 + 小步下坡路径(摸黑下山),
 * 图二画同一座山谷的两种步子:合适 = 稳步到底,太大 = 跨过谷底来回横跳(发散,朱砂标坑)。
 * 发散那串跳点取自讲义 lr=1.5 的数字例子精神:幅度一跳比一跳大。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const JADE = 'var(--jade)';
const JADE_INK = 'var(--jade-ink)';
const CINNABAR = 'var(--cinnabar)';
const PAPER_EDGE = 'var(--paper-edge)';
const DISPLAY = 'var(--font-display)';

/** 图一:等高线山谷 + 摸黑下山的小步路径 */
export function GdContourSvg({ className }: { className?: string }) {
  const rings: Array<[number, number]> = [
    [185, 115],
    [146, 90],
    [108, 66],
    [72, 43],
    [40, 23],
  ];
  const path = [
    [78, 58],
    [128, 92],
    [168, 118],
    [198, 136],
    [216, 148],
    [228, 155],
  ] as const;
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:loss 像一座山谷的等高线,训练从山坡上的起点出发,每一步朝下坡方向挪一小步,一步步走向谷底"
      className={className}
    >
      <defs>
        <marker id="gd1-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 等高线 */}
      {rings.map(([rx, ry]) => (
        <ellipse key={rx} cx="230" cy="158" rx={rx} ry={ry} fill="none" stroke={FAINT} strokeWidth="1.1" />
      ))}
      <circle cx="230" cy="158" r="5" fill={JADE} />
      <line x1="240" y1="152" x2="312" y2="102" stroke={JADE} strokeWidth="1" strokeDasharray="3 3" />
      <text x="318" y="100" fontSize="13" fill={JADE_INK}>谷底(loss 最低)</text>

      {/* 下坡路径 */}
      {path.slice(0, -1).map(([x1, y1], i) => (
        <line
          key={x1}
          x1={x1}
          y1={y1}
          x2={path[i + 1][0]}
          y2={path[i + 1][1]}
          stroke={AZURE}
          strokeWidth="2"
          strokeLinecap="round"
          markerEnd="url(#gd1-arrow)"
        />
      ))}
      <circle cx="78" cy="58" r="4" fill={AZURE} />
      <text x="78" y="40" textAnchor="middle" fontSize="13" fill={SOFT}>起点(随手初始化)</text>

      {/* 右侧读图注 */}
      <text x="450" y="92" fontSize="14" fill={SOFT}>· 等高线:同一圈上 loss 一样高</text>
      <text x="450" y="124" fontSize="14" fill={SOFT}>· 方向听梯度的:哪边下坡最陡走哪边</text>
      <text x="450" y="156" fontSize="14" fill={SOFT}>· 步子听学习率的:一次只挪一小步</text>
      <text x="450" y="212" fontSize="16" fontFamily={DISPLAY} fill={INK}>摸黑下山:看不见全景,</text>
      <text x="450" y="238" fontSize="16" fontFamily={DISPLAY} fill={INK}>用脚感受坡度,一步一步挪</text>
    </svg>
  );
}

/** 图二:步子合适稳步到底 vs 步子太大来回横跳发散 */
export function GdLearningRateSvg({ className }: { className?: string }) {
  // 左谷:y = 70 + 500t - 500t²,x = 40 + 280t(顶点 x=180,谷底 y=195)
  const settle = [
    [74, 123],
    [107, 161],
    [135, 182],
    [158, 192],
    [180, 195],
  ] as const;
  // 右谷同形状(x 平移 360):跳点在谷两侧交替,离谷底越来越远
  const diverge = [
    [518, 192],
    [590, 179],
    [470, 164],
    [640, 131],
    [430, 118],
  ] as const;
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:同一座山谷,学习率合适时沿坡稳步走到谷底;学习率太大时每一步跨过谷底落到对面更高处,来回震荡越甩越远,发散"
      className={className}
    >
      <defs>
        <marker id="gd2-ok" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
        <marker id="gd2-bad" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 左:步子合适 */}
      <text x="180" y="44" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>步子合适:稳步到谷底</text>
      <path d="M 40 70 Q 180 320 320 70" fill="none" stroke={SOFT} strokeWidth="1.5" />
      {settle.slice(0, -1).map(([x1, y1], i) => (
        <line
          key={x1}
          x1={x1}
          y1={y1}
          x2={settle[i + 1][0]}
          y2={settle[i + 1][1]}
          stroke={AZURE}
          strokeWidth="1.8"
          strokeLinecap="round"
          markerEnd="url(#gd2-ok)"
        />
      ))}
      {settle.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill={AZURE} />
      ))}
      <circle cx="180" cy="195" r="5" fill={JADE} />
      <text x="180" y="224" textAnchor="middle" fontSize="13" fill={JADE_INK}>谷底</text>

      <line x1="365" y1="52" x2="365" y2="248" stroke={PAPER_EDGE} strokeDasharray="5 5" />

      {/* 右:步子太大 */}
      <text x="540" y="44" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={CINNABAR}>步子太大:跨过谷底,越甩越远</text>
      <path d="M 400 70 Q 540 320 680 70" fill="none" stroke={SOFT} strokeWidth="1.5" />
      {diverge.slice(0, -1).map(([x1, y1], i) => (
        <line
          key={x1}
          x1={x1}
          y1={y1}
          x2={diverge[i + 1][0]}
          y2={diverge[i + 1][1]}
          stroke={CINNABAR}
          strokeWidth="1.8"
          strokeLinecap="round"
          markerEnd="url(#gd2-bad)"
        />
      ))}
      {diverge.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill={CINNABAR} />
      ))}
      <text x="540" y="224" textAnchor="middle" fontSize="13" fill={FAINT}>每步都落到对面更高处(发散)</text>

      <text x="360" y="282" textAnchor="middle" fontSize="14" fill={SOFT}>
        学习率的关键词是「合适」——太大发散,太小又磨到天荒地老
      </text>
    </svg>
  );
}
