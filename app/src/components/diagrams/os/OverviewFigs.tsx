/**
 * 操作系统概述(《操作系统原理》第 1 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/overview.ts 的 microLecture 咬合:
 * 图一「界面是节目,舞台在底下」——桌面/浏览器/终端全是普通程序,操作系统是看不见的中间管理层;
 * 朱砂只标「把最上排当成操作系统本体」这个坑。
 * 图二「一个瞬间只跑一个,切得快就像同时」——单个处理器时间轴上放歌/下载/聊天轮流占片,
 * 每段约 20 毫秒(示意量级,非精确值);朱砂只标「同一瞬间其实只有一个在跑」这个坑,
 * 多核可真并行的分寸留给正文,不在图内展开。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const CINNABAR = 'var(--cinnabar)';
const JADE_INK = 'var(--jade-ink)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const INK_WASH = 'var(--ink-wash)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:界面是节目,舞台在底下 —— 三层结构,朱砂标「别把节目当舞台」的坑 */
export function OsLayersSvg({ className }: { className?: string }) {
  const apps = [
    { x: 60, w: 96, label: '桌面' },
    { x: 172, w: 110, label: '浏览器' },
    { x: 298, w: 96, label: '游戏' },
    { x: 410, w: 96, label: '终端' },
  ];
  const hw = [
    { x: 60, w: 106, label: '处理器' },
    { x: 182, w: 96, label: '内存' },
    { x: 294, w: 96, label: '磁盘' },
    { x: 406, w: 100, label: '键盘' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:最上排桌面、浏览器、游戏、终端都是普通程序;中间一层是看不见的操作系统,管理硬件和软件;最底下是处理器、内存、磁盘、键盘等硬件。朱砂标注的坑:别把最上排的界面当成操作系统本体"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        看得见的都是节目,看不见的才是舞台
      </text>

      {/* 顶层:普通程序 */}
      {apps.map((a) => (
        <g key={a.label}>
          <rect x={a.x} y="52" width={a.w} height="42" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={a.x + a.w / 2} y="79" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
            {a.label}
          </text>
        </g>
      ))}
      <text x="530" y="79" fontSize="13" fill={SOFT}>← 全是普通程序</text>

      {/* 坑:朱砂手绘括线,指向最上排 */}
      <path
        d="M 66 44 Q 250 26 500 42"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <text x="620" y="52" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:别把这一排
      </text>
      <text x="620" y="68" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        当成操作系统本体
      </text>

      {/* 中层:操作系统 */}
      <rect x="60" y="130" width="446" height="58" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="283" y="156" textAnchor="middle" fontSize="16" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        操作系统
      </text>
      <text x="283" y="176" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>
        管理硬件和软件的软件 —— 看不见,但全场归它管
      </text>
      <text x="530" y="162" fontSize="13" fill={JADE_INK}>没接屏幕的服务器上,</text>
      <text x="530" y="180" fontSize="13" fill={JADE_INK}>这一层照样跑得好好的</text>

      {/* 底层:硬件 */}
      {hw.map((h) => (
        <g key={h.label}>
          <rect x={h.x} y="224" width={h.w} height="42" rx="6" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1" />
          <text x={h.x + h.w / 2} y="251" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
            {h.label}
          </text>
        </g>
      ))}
      <text x="530" y="251" fontSize="13" fill={SOFT}>← 硬件</text>

      {/* 上下衔接的手绘短线 */}
      {[130, 262, 394].map((x) => (
        <g key={x}>
          <line x1={x} y1="96" x2={x} y2="128" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
          <line x1={x} y1="190" x2={x} y2="222" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
        </g>
      ))}

      <text x="360" y="306" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        桌面换了、浏览器关了,舞台还是那一个——它管着上下两头
      </text>
    </svg>
  );
}

/** 图二:一个瞬间只跑一个,切得快就像同时 —— 单处理器时间轴轮转,朱砂标「同一瞬间」的坑 */
export function OsTimesliceSvg({ className }: { className?: string }) {
  const palette = [
    { label: '放歌', fill: AZURE_WASH, stroke: AZURE, text: AZURE_DEEP },
    { label: '下载', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { label: '聊天', fill: INK_WASH, stroke: PAPER_EDGE, text: INK },
  ];
  const sliceW = 88;
  const slices = Array.from({ length: 6 }, (_, i) => ({
    x: 70 + i * sliceW,
    ...palette[i % 3],
  }));
  const pitX = 70 + sliceW * 2.5; // 「此刻」竖线落在第三片(聊天)中间
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:单个处理器的时间轴被切成小段,放歌、下载、聊天三个程序轮流各占约 20 毫秒;任挑一个瞬间,只有一个程序真正在跑——切得足够快,三个看起来都像一直在动"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一个瞬间只跑一个,切得快就像同时
      </text>

      {/* 三个程序都觉得自己一直在跑 */}
      {palette.map((p, i) => (
        <g key={p.label}>
          <rect x={150 + i * 150} y="52" width={120} height="34" rx="17" fill={p.fill} stroke={p.stroke} strokeWidth="1.4" />
          <text x={210 + i * 150} y="74" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={p.text}>
            {p.label}:「我一直在跑」
          </text>
        </g>
      ))}

      {/* 时间轴主干 */}
      <text x="70" y="130" fontSize="13" fill={SOFT}>同一个处理器:</text>
      {slices.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y="146" width={sliceW - 6} height="46" rx="5" fill={s.fill} stroke={s.stroke} strokeWidth="1.4" />
          <text x={s.x + (sliceW - 6) / 2} y="175" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={s.text}>
            {s.label}
          </text>
        </g>
      ))}
      <line x1="70" y1="212" x2="640" y2="212" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 632 208 L 642 212 L 632 216" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="656" y="216" fontSize="13" fill={SOFT}>时间</text>
      <text x="70" y="234" fontSize="12.5" fontFamily={CODE} fill={FAINT}>每段约 20 毫秒(示意)——一秒钟能轮十几圈</text>

      {/* 坑:朱砂「此刻」竖线 */}
      <line x1={pitX} y1="104" x2={pitX} y2="204" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="6 4" strokeLinecap="round" />
      <circle cx={pitX} cy="169" r="30" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="2 4" />
      <text x={pitX} y="98" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:任挑这一瞬间——
      </text>
      <text x={pitX + 130} y="122" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        其实只有一个在跑
      </text>

      <text x="360" y="272" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        轮得足够勤,断点就被抹平——每个程序都以为自己独占了整台机器
      </text>
    </svg>
  );
}
