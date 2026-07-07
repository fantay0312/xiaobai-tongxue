/**
 * 多处理器编程(《操作系统原理》第 13 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/multiprocessor.ts 的 microLecture 咬合:
 * 图一「共享白板会抢」——两条路线把一次加一拆成读、改、写,朱砂只标「两边都写回 1」这个坑;
 * 图二「先写不等于马上看见」——写入先停在自己桌边,别人看公共墙可能仍是旧字,朱砂只标「看见旧字」这个坑。
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

/** 图一:共享白板会抢 —— 两条路线都读到旧数,最后只涨一次 */
export function MpSharedBoardSvg({ className }: { className?: string }) {
  const rows = [
    { y: 96, who: '路线 A', steps: ['读到 0', '手里 +1', '写回 1'], fill: AZURE_WASH, stroke: AZURE, text: AZURE_DEEP },
    { y: 174, who: '路线 B', steps: ['读到 0', '手里 +1', '写回 1'], fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
  ];
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:路线 A 和路线 B 都从共享白板读到 0,各自在手里加成 1,最后都写回 1,白板只涨了一次"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一次加一,其实被拆成三小步
      </text>

      <rect x="296" y="46" width="128" height="46" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.3" />
      <text x="360" y="66" textAnchor="middle" fontSize="13" fill={SOFT}>共享白板</text>
      <text x="360" y="84" textAnchor="middle" fontSize="18" fontFamily={CODE} fill={INK}>sum = 0</text>

      {rows.map((r) => (
        <g key={r.who}>
          <text x="72" y={r.y + 28} textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={r.text}>{r.who}</text>
          {r.steps.map((s, i) => (
            <g key={s}>
              <rect x={130 + i * 150} y={r.y} width="112" height="44" rx="6" fill={r.fill} stroke={r.stroke} strokeWidth="1.3" />
              <text x={186 + i * 150} y={r.y + 28} textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={r.text}>{s}</text>
              {i < 2 ? <path d={`M ${244 + i * 150} ${r.y + 22} Q ${266 + i * 150} ${r.y + 12} ${284 + i * 150} ${r.y + 22}`} fill="none" stroke={FAINT} strokeWidth="1.2" strokeLinecap="round" /> : null}
            </g>
          ))}
        </g>
      ))}

      <path d="M 534 106 Q 612 142 534 184" fill="none" stroke={CINNABAR} strokeWidth="1.5" strokeDasharray="5 4" strokeLinecap="round" />
      <text x="618" y="132" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:两边都写回 1</text>
      <text x="618" y="150" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>账本只涨一次</text>

      <rect x="294" y="256" width="132" height="42" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="360" y="282" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>最后:sum = 1</text>
      <text x="360" y="310" textAnchor="middle" fontSize="13" fill={SOFT}>看着是两次加一,实际一次更新被盖掉了</text>
    </svg>
  );
}

/** 图二:先写不等于马上看见 —— 本地便签到公共墙有延迟 */
export function MpVisibilityTrapSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:两张桌子各自先把写入放在自己桌边,公共墙仍旧是旧字;另一边先去看墙时,可能仍看到旧值"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        先写下,不代表别人马上看见
      </text>

      <g>
        <rect x="68" y="70" width="172" height="92" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.5" />
        <text x="154" y="96" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>左桌</text>
        <rect x="102" y="116" width="104" height="30" rx="5" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1" />
        <text x="154" y="136" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={INK}>写:x = 1</text>
      </g>

      <g>
        <rect x="480" y="70" width="172" height="92" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
        <text x="566" y="96" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>右桌</text>
        <rect x="514" y="116" width="104" height="30" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1" />
        <text x="566" y="136" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={AZURE_DEEP}>写:y = 1</text>
      </g>

      <rect x="282" y="92" width="156" height="86" rx="9" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="360" y="120" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>公共墙</text>
      <text x="360" y="146" textAnchor="middle" fontSize="15" fontFamily={CODE} fill={SOFT}>x = 0, y = 0</text>
      <text x="360" y="166" textAnchor="middle" fontSize="12.5" fill={SOFT}>还没来得及换新字</text>

      <path d="M 210 146 Q 256 196 316 172" fill="none" stroke={FAINT} strokeWidth="1.4" strokeDasharray="4 5" strokeLinecap="round" />
      <path d="M 514 146 Q 464 198 404 172" fill="none" stroke={FAINT} strokeWidth="1.4" strokeDasharray="4 5" strokeLinecap="round" />
      <text x="210" y="208" textAnchor="middle" fontSize="13" fill={JADE_INK}>先放在自己桌边</text>
      <text x="510" y="208" textAnchor="middle" fontSize="13" fill={JADE_INK}>晚点才贴到墙上</text>

      <line x1="360" y1="182" x2="360" y2="242" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="6 4" strokeLinecap="round" />
      <circle cx="360" cy="146" r="52" fill="none" stroke={CINNABAR} strokeWidth="1.2" strokeDasharray="3 5" />
      <text x="360" y="262" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:现在去看,可能还是旧字</text>
      <text x="360" y="288" textAnchor="middle" fontSize="13" fill={SOFT}>所以别靠「我刚才写了」来猜别人一定已经看见</text>
    </svg>
  );
}
