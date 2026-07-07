/**
 * 一个 Token 的旅程(《操作系统原理》第 21 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/tokenJourney.ts 的 microLecture 咬合:
 * 图一「一个请求跑完这一整趟」——你的手机一跳一跳把话转发到数据中心;第一台迎上来的机器
 *   很大概率只是负载均衡器(门口的导诊台,只分流),后面才是真正干活的业务服务器和数据库;
 *   朱砂只标「第一台不是终点」这个坑(= 误区 M1),延迟 200 毫秒标「典型量级」。
 * 图二「三个角很难同时占全」——CAP:一致、可用、容错;网络一断(分区),一致与可用只能二选一;
 *   朱砂只标「想三个角全占 = 撞墙」这个坑(= 误区 M2 / 要点 c3),「三选二」是课堂通俗简化说法。
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

/** 图一:一个请求跑完这一整趟 —— 一跳一跳到数据中心,门口先分流,朱砂标「第一台不是终点」的坑 */
export function TokenJourneyMapSvg({ className }: { className?: string }) {
  const hops = [150, 192, 234];
  const backends = [
    { y: 104, label: '业务服务器', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { y: 150, label: '业务服务器', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { y: 210, label: '数据库 / 缓存', fill: INK_WASH, stroke: PAPER_EDGE, text: INK },
  ];
  return (
    <svg
      viewBox="0 0 760 330"
      width="100%"
      role="img"
      aria-label="示意图:你的手机把一句话一跳一跳转发到数据中心,跨国约 200 毫秒;数据中心里第一台迎上来的机器是负载均衡器,只负责把请求分流到后面真正干活的业务服务器和数据库。朱砂标注的坑:第一台机器不是终点,它只是门口的导诊台"
      className={className}
    >
      <text x="380" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        你随口一问,一个请求要跑完这一整趟
      </text>

      {/* 你的手机 */}
      <rect x="24" y="138" width="92" height="50" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.6" />
      <text x="70" y="160" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>你的手机</text>
      <text x="70" y="179" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>按下回车</text>

      {/* 一跳一跳:虚线 + 路由器小圈 */}
      <line x1="120" y1="163" x2="290" y2="163" stroke={FAINT} strokeWidth="1.3" strokeDasharray="4 5" strokeLinecap="round" />
      {hops.map((cx) => (
        <circle key={cx} cx={cx} cy="163" r="7" fill={PAPER_WARM} stroke={SOFT} strokeWidth="1.3" />
      ))}
      <path d="M 282 159 L 292 163 L 282 167" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="196" y="132" textAnchor="middle" fontSize="12.5" fill={SOFT}>一跳一跳转发(路由器接力)</text>
      <text x="196" y="196" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={JADE_INK}>跨国约 200 毫秒 · 不是嗖一下</text>

      {/* 数据中心 大框 */}
      <rect x="300" y="66" width="436" height="240" rx="12" fill="none" stroke={SOFT} strokeWidth="1.4" strokeDasharray="2 5" />
      <text x="316" y="88" fontSize="13" fontFamily={DISPLAY} fill={SOFT}>数据中心(一整片机器)</text>

      {/* 负载均衡器 */}
      <rect x="324" y="112" width="150" height="52" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="399" y="134" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>负载均衡器</text>
      <text x="399" y="153" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>只分流,不干活</text>

      {/* 坑:朱砂括线指向负载均衡器 */}
      <path d="M 326 106 Q 400 86 474 104" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="5 4" strokeLinecap="round" opacity="0.85" />
      <text x="399" y="82" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:第一台不是终点 —— 它只是门口的导诊台</text>

      {/* 手机 → 负载均衡器 的入口箭头 */}
      <path d="M 292 163 Q 310 150 322 140" fill="none" stroke={AZURE} strokeWidth="1.5" strokeLinecap="round" />

      {/* 负载均衡 → 后端:分流箭头 */}
      {backends.map((b) => (
        <g key={b.label + b.y}>
          <line x1="474" y1="138" x2="556" y2={b.y + 18} stroke={AZURE} strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
          <rect x="558" y={b.y} width="150" height="38" rx="6" fill={b.fill} stroke={b.stroke} strokeWidth="1.2" />
          <text x="633" y={b.y + 24} textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={b.text}>{b.label}</text>
        </g>
      ))}
      <text x="516" y="196" textAnchor="middle" fontSize="12" fill={SOFT}>分流</text>

      <text x="380" y="324" textAnchor="middle" fontSize="13" fill={SOFT}>
        「那台服务器」几乎从来不是一台 —— 先分流,再干活,后面还连着一大串
      </text>
    </svg>
  );
}

/** 图二:三个角很难同时占全 —— CAP 三角,朱砂标「想三个全占 = 撞墙」的坑 */
export function TokenCapTriangleSvg({ className }: { className?: string }) {
  const nodes = [
    { cx: 360, cy: 96, label: '一致', sub: '数据都对得上' },
    { cx: 150, cy: 262, label: '可用', sub: '随时能答上' },
    { cx: 570, cy: 262, label: '容错', sub: '掉线也不停' },
  ];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:CAP 三角形的三个角分别是一致、可用、容错。网络一旦断开(分区),一致和可用只能二选一。朱砂标注的坑:想三个角全占就是撞墙,机器加得再多也绕不开"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一致、可用、容错 —— 三个角,很难同时占全
      </text>

      {/* 三角形连线 */}
      <path
        d="M 360 96 L 150 262 L 570 262 Z"
        fill={AZURE_WASH}
        stroke={AZURE}
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.85"
      />

      {/* 网线一断:朱砂在「一致—可用」这条边上画一道断口 */}
      <line x1="248" y1="185" x2="272" y2="163" stroke={CINNABAR} strokeWidth="2.2" strokeLinecap="round" />
      <line x1="256" y1="192" x2="280" y2="170" stroke={CINNABAR} strokeWidth="2.2" strokeLinecap="round" />
      <text x="196" y="150" textAnchor="middle" fontSize="12" fill={CINNABAR}>网线一断</text>
      <text x="196" y="166" textAnchor="middle" fontSize="12" fill={CINNABAR}>(分区)</text>

      {/* 中心提示 */}
      <text x="374" y="212" textAnchor="middle" fontSize="12.5" fill={SOFT}>网线一断,这一刻</text>
      <text x="374" y="230" textAnchor="middle" fontSize="12.5" fill={SOFT}>「一致」和「可用」只能二选一</text>

      {/* 三个角节点 */}
      {nodes.map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy={n.cy} r="34" fill={PAPER_WARM} stroke={AZURE} strokeWidth="1.6" />
          <text x={n.cx} y={n.cy - 2} textAnchor="middle" fontSize="16" fontFamily={DISPLAY} fill={AZURE_DEEP}>{n.label}</text>
          <text x={n.cx} y={n.cy + 16} textAnchor="middle" fontSize="10.5" fill={SOFT}>{n.sub}</text>
        </g>
      ))}

      {/* 坑:朱砂圈住整个三角顶部,标「想三个全占 = 撞墙」 */}
      <circle cx="360" cy="96" r="46" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="3 4" opacity="0.8" />
      <text x="600" y="150" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:想三个角全占</text>
      <text x="600" y="166" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>= 撞墙(加机器也没用)</text>

      <text x="360" y="320" textAnchor="middle" fontSize="13" fill={JADE_INK}>
        课堂常简化成一句「三选二」——严格说,是分区那一刻在一致与可用里取舍
      </text>
    </svg>
  );
}
