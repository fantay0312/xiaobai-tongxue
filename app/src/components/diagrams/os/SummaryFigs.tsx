/**
 * 课程总结:AI 与未来(《操作系统原理》第 30 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/summary.ts 的 microLecture 咬合:
 * 图一「三件事撑起一栋楼」——虚拟化/并发/持久化是三根承重柱,上顶应用程序、下接硬件;
 *   朱砂只标「别以为把这三个名词背下来就等于学会了」这个坑(呼应误区 M1)。
 * 图二「从需求推概念:什么是 Git」——需求 → 抓本质(快照=blob 树、历史=commit 有向无环图)→
 *   顺着推出 branch/stash/worktree;朱砂只标「别上来就背命令,要从本质一步步推」这个坑。
 * 两张图都不展开讲者较激进的 vision(留给正文分寸),图内文字尽量用生活语言。
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

/** 图一:三件事撑起一栋楼 —— 三根承重柱,朱砂标「别把名词当成学会了」的坑 */
export function SummaryPillarsSvg({ className }: { className?: string }) {
  const pillars = [
    { x: 96, label: '虚拟化', note: '让程序以为独占机器' },
    { x: 300, label: '并发', note: '一起干活不打架' },
    { x: 504, label: '持久化', note: '数据长长久久存住' },
  ];
  const pw = 120;
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:最上面一横条是各种应用程序,下面立着三根柱子,分别写着虚拟化、并发、持久化,再往下是硬件。三根柱子撑起整栋楼。朱砂标注的坑:别以为把这三个名词背下来,就等于学会了这门课"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        整门课就三件事 —— 三根柱子撑起一栋楼
      </text>

      {/* 楼顶:应用程序 */}
      <rect x="72" y="50" width="576" height="46" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="360" y="78" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
        各种应用程序(桌面、浏览器、你写的程序……)
      </text>

      {/* 三根承重柱 */}
      {pillars.map((p) => (
        <g key={p.label}>
          <rect x={p.x} y="120" width={pw} height="118" rx="7" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
          <text x={p.x + pw / 2} y="166" textAnchor="middle" fontSize="18" fontFamily={DISPLAY} fill={AZURE_DEEP}>
            {p.label}
          </text>
          <text x={p.x + pw / 2} y="196" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>
            {p.note}
          </text>
          {/* 柱脚落在硬件上的短线 */}
          <line x1={p.x + pw / 2} y1="238" x2={p.x + pw / 2} y2="262" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
          {/* 楼顶压在柱头上的短线 */}
          <line x1={p.x + pw / 2} y1="96" x2={p.x + pw / 2} y2="118" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
        </g>
      ))}

      {/* 坑:朱砂括线,罩住三根柱子的名词 */}
      <path
        d="M 100 116 Q 360 100 620 116"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <text x="360" y="112" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:别以为把这三个名词背下来,就等于学会了
      </text>

      {/* 楼基:硬件 */}
      <rect x="72" y="264" width="576" height="44" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1" />
      <text x="360" y="291" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
        硬件:处理器 · 内存 · 磁盘
      </text>

      <text x="360" y="330" textAnchor="middle" fontSize="13" fill={JADE_INK}>
        每根柱子都先有一个「应用想要什么」的需求,机制是顺着需求配上去的
      </text>
    </svg>
  );
}

/** 图二:从需求推概念(什么是 Git)—— 三段推导链,朱砂标「别上来就背命令」的坑 */
export function SummaryDeriveSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:从左到右三步。第一步需求:想给文件的历史拍快照、还能回退分叉。第二步抓本质:Git 是管理文件快照的数据结构,快照是一棵 blob 树、历史是 commit 有向无环图。第三步:branch、stash、worktree 这些用法顺着需求自己就推出来了。朱砂标注的坑:别上来就死背命令,要从本质一步步推"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        从需求推概念:面试题「什么是 Git」
      </text>

      {/* 第一步:需求 */}
      <rect x="40" y="70" width="176" height="120" rx="9" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="128" y="98" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>① 先问需求</text>
      <text x="128" y="128" textAnchor="middle" fontSize="12.5" fill={SOFT}>想给文件的历史</text>
      <text x="128" y="148" textAnchor="middle" fontSize="12.5" fill={SOFT}>拍快照,</text>
      <text x="128" y="168" textAnchor="middle" fontSize="12.5" fill={SOFT}>还能回退、分叉</text>

      {/* 第二步:抓本质 */}
      <rect x="264" y="70" width="192" height="120" rx="9" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="360" y="98" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>② 抓住本质</text>
      <text x="360" y="126" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>管理文件快照的</text>
      <text x="360" y="144" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>数据结构</text>
      <text x="360" y="166" textAnchor="middle" fontSize="11.5" fontFamily={CODE} fill={AZURE_DEEP}>快照=blob 树</text>
      <text x="360" y="182" textAnchor="middle" fontSize="11.5" fontFamily={CODE} fill={AZURE_DEEP}>历史=commit 图</text>

      {/* 第三步:推出用法 */}
      <rect x="504" y="70" width="176" height="120" rx="9" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="592" y="98" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>③ 顺势推出</text>
      <text x="592" y="128" textAnchor="middle" fontSize="12.5" fill={SOFT}>branch · stash</text>
      <text x="592" y="148" textAnchor="middle" fontSize="12.5" fill={SOFT}>worktree ……</text>
      <text x="592" y="168" textAnchor="middle" fontSize="12.5" fill={SOFT}>自己就冒出来了</text>

      {/* 推导箭头 */}
      {[228, 468].map((x) => (
        <g key={x}>
          <line x1={x} y1="130" x2={x + 32} y2="130" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" />
          <path d={`M ${x + 24} 125 L ${x + 34} 130 L ${x + 24} 135`} fill="none" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}

      {/* 坑:朱砂虚线圈住第三步,提醒别跳过前两步直接背命令 */}
      <path d="M 500 200 Q 592 214 684 200" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="5 4" strokeLinecap="round" opacity="0.85" />
      <text x="592" y="228" textAnchor="middle" fontSize="12" fill={CINNABAR}>坑:别上来就背这些命令</text>
      <text x="592" y="245" textAnchor="middle" fontSize="12" fill={CINNABAR}>——要从本质一步步推</text>

      <line x1="40" y1="276" x2="680" y2="276" stroke={FAINT} strokeWidth="1" strokeDasharray="2 5" strokeLinecap="round" />
      <text x="360" y="300" textAnchor="middle" fontSize="13" fill={JADE_INK}>
        抓住本质,用法自己长出来 —— 这就是这门课要的「第一性原理」
      </text>
    </svg>
  );
}
