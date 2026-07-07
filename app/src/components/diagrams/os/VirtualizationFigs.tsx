/**
 * 虚拟机和容器(《操作系统原理》第 29 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/virtualization.ts 的 microLecture 咬合:
 * 图一「整层楼 vs 小隔间」——虚拟机边界厚、容器共享底座;朱砂只标「把小隔间当整层楼」这个坑。
 * 图二「门牌表 + 水电表」——一张表管看见什么,一张表管能用多少;朱砂只标「只有门牌没有限额」这个坑。
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
const DISPLAY = 'var(--font-display)';

/** 图一:整层楼 vs 小隔间 —— 一边边界厚,一边共享底座 */
export function OsVirtualizationBuildingSvg({ className }: { className?: string }) {
  const thickRooms = [
    { x: 76, y: 78, label: '门' },
    { x: 176, y: 78, label: '水电' },
    { x: 276, y: 78, label: '地基' },
  ];
  const lightRooms = [
    { x: 438, label: '小店 A' },
    { x: 532, label: '小店 B' },
    { x: 626, label: '小店 C' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:左侧是一整层独立小楼,门、水电、地基都单独带着;右侧是同一栋楼里的三个轻隔间,各有门牌,但共用底座。朱砂标注的坑:别把轻隔间当成整层楼"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一边像整层楼,一边像轻隔间
      </text>

      <rect x="50" y="58" width="300" height="186" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="200" y="56" textAnchor="middle" fontSize="13" fill={SOFT}>边界厚:自带一整套底层</text>
      {thickRooms.map((r) => (
        <g key={r.label}>
          <rect x={r.x} y={r.y} width="74" height="58" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={r.x + 37} y={r.y + 35} textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
            {r.label}
          </text>
        </g>
      ))}
      <rect x="78" y="166" width="244" height="44" rx="6" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.4" />
      <text x="200" y="194" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        自己的一整套管事层
      </text>
      <text x="200" y="274" textAnchor="middle" fontSize="13" fill={SOFT}>搬来慢一些,边界厚一些</text>

      <rect x="406" y="58" width="260" height="186" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="536" y="56" textAnchor="middle" fontSize="13" fill={SOFT}>开得快:共用楼的底座</text>
      {lightRooms.map((r) => (
        <g key={r.label}>
          <rect x={r.x - 34} y="82" width="68" height="80" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.2" />
          <text x={r.x} y="126" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>
            {r.label}
          </text>
          <text x={r.x} y="146" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>自己的门牌</text>
        </g>
      ))}
      <rect x="426" y="190" width="220" height="32" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="536" y="211" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>
        共用同一套底座
      </text>

      <path
        d="M 418 72 Q 536 40 656 72"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="540" y="274" textAnchor="middle" fontSize="13" fill={CINNABAR}>
        坑:别把轻隔间当成整层楼
      </text>

      <line x1="368" y1="82" x2="386" y2="220" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 5" />
      <text x="360" y="308" textAnchor="middle" fontSize="13.5" fill={JADE_INK}>
        轻的好搬,厚的更像独门独院;讲取舍,别讲成完全一样
      </text>
    </svg>
  );
}

/** 图二:门牌表 + 水电表 —— 视野隔离和用量限制互不替代 */
export function OsContainerMetersSvg({ className }: { className?: string }) {
  const shops = [
    { y: 84, label: '小店 A', door: '门牌 A', meter: '用量 2 格' },
    { y: 148, label: '小店 B', door: '门牌 B', meter: '用量 5 格' },
    { y: 212, label: '小店 C', door: '门牌 C', meter: '用量 1 格' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:三家小店各有自己的门牌表,也各有一张水电表限制用量。朱砂标注的坑:只有门牌没有限额,仍可能把整栋楼的水电用光"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        门牌表管看见什么,水电表管能用多少
      </text>

      <rect x="52" y="62" width="612" height="214" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="154" y="70" textAnchor="middle" fontSize="13" fill={SOFT}>同一栋楼</text>
      <text x="286" y="70" textAnchor="middle" fontSize="13" fill={SOFT}>门牌表</text>
      <text x="486" y="70" textAnchor="middle" fontSize="13" fill={SOFT}>水电表</text>

      {shops.map((s) => (
        <g key={s.label}>
          <rect x="90" y={s.y} width="112" height="42" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.1" />
          <text x="146" y={s.y + 27} textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
            {s.label}
          </text>
          <rect x="238" y={s.y} width="98" height="42" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.2" />
          <text x="287" y={s.y + 27} textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>
            {s.door}
          </text>
          <rect x="420" y={s.y} width="126" height="42" rx="5" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.1" />
          <text x="483" y={s.y + 27} textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>
            {s.meter}
          </text>
          <line x1="202" y1={s.y + 21} x2="238" y2={s.y + 21} stroke={FAINT} strokeWidth="1.1" strokeDasharray="3 4" />
          <line x1="336" y1={s.y + 21} x2="420" y2={s.y + 21} stroke={FAINT} strokeWidth="1.1" strokeDasharray="3 4" />
        </g>
      ))}

      <path
        d="M 376 84 C 382 126 382 212 376 254"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="6 4"
        strokeLinecap="round"
      />
      <text x="616" y="116" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:只有门牌
      </text>
      <text x="616" y="134" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        没有限额也会抢水电
      </text>
      <text x="360" y="306" textAnchor="middle" fontSize="13.5" fill={JADE_INK}>
        两张表合在一起,小店才既像各过各的,又不会互相拖垮
      </text>
    </svg>
  );
}
