/**
 * 并行算法与数据结构(《操作系统原理》第 18 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/parallel.ts 的 microLecture 咬合:
 * 图一「人越多,门越窄」——正确排队能保结果,但共享小门口会让人手增加后继续排队;
 * 朱砂只标「只加人手」这个坑。
 * 图二「先记小账,再交总账」——每人先在自己的小本子里攒,到点再汇总;
 * 朱砂只标「忘了交总账」这个坑,不把暂时旧值说成普遍可接受。
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

/** 图一:人越多,门越窄 —— 共享小门口是排队热点,朱砂标「只加人手」的坑 */
export function ParallelBottleneckSvg({ className }: { className?: string }) {
  const workers = [
    { x: 64, y: 86, label: '同学甲' },
    { x: 64, y: 136, label: '同学乙' },
    { x: 64, y: 186, label: '同学丙' },
    { x: 64, y: 236, label: '同学丁' },
  ];
  const tasks = [
    { x: 438, y: 86, label: '各自算一块' },
    { x: 438, y: 146, label: '各自算一块' },
    { x: 438, y: 206, label: '各自算一块' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:左边四位同学都想穿过同一个窄门口,门口排起长队;过门后右边才是各自能独立完成的大块工作。朱砂标注的坑:只加人手,不拓宽门口"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        人越多,门越窄:先看哪里在排队
      </text>

      {workers.map((w, i) => (
        <g key={w.label}>
          <circle cx={w.x} cy={w.y} r="18" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.3" />
          <text x={w.x} y={w.y + 5} textAnchor="middle" fontSize="12" fontFamily={DISPLAY} fill={INK}>
            {i + 1}
          </text>
          <text x={w.x + 36} y={w.y + 5} fontSize="13" fill={SOFT}>{w.label}</text>
          <path d={`M ${w.x + 76} ${w.y} C 158 ${w.y} 174 166 236 166`} fill="none" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 4" />
        </g>
      ))}

      <rect x="244" y="106" width="74" height="120" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="281" y="150" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>共享</text>
      <text x="281" y="170" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>小门口</text>
      <text x="281" y="198" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>一次只过一人</text>

      <path d="M 320 166 C 354 166 372 140 412 116" fill="none" stroke={SOFT} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 320 166 C 358 166 378 166 412 166" fill="none" stroke={SOFT} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 320 166 C 354 166 372 192 412 226" fill="none" stroke={SOFT} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 404 110 L 416 112 L 409 122" fill="none" stroke={SOFT} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M 404 160 L 416 166 L 404 172" fill="none" stroke={SOFT} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M 404 220 L 416 226 L 405 232" fill="none" stroke={SOFT} strokeWidth="1.3" strokeLinecap="round" />

      {tasks.map((t) => (
        <g key={`${t.x}-${t.y}`}>
          <rect x={t.x} y={t.y} width="136" height="42" rx="6" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.1" />
          <text x={t.x + 68} y={t.y + 27} textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
            {t.label}
          </text>
        </g>
      ))}
      <text x="574" y="128" fontSize="13" fill={JADE_INK}>门口之外越长,</text>
      <text x="574" y="148" fontSize="13" fill={JADE_INK}>才越值得分工</text>

      <path
        d="M 46 58 Q 166 44 286 74"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="142" y="58" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:只加人手</text>
      <text x="142" y="76" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>不看门口</text>

      <text x="360" y="302" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        正确排队能保结果;想跑快,要把排队段缩短,把各自干活段拉长
      </text>
    </svg>
  );
}

/** 图二:先记小账,再交总账 —— 本地攒到点再汇总,朱砂标「忘了交总账」的坑 */
export function ParallelLocalLedgerSvg({ className }: { className?: string }) {
  const ledgers = [
    { x: 72, y: 92, label: '小本一', marks: '||||' },
    { x: 72, y: 160, label: '小本二', marks: '|||' },
    { x: 72, y: 228, label: '小本三', marks: '|||||' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:三个人先在自己的小本子里记笔画,到约定时刻再把数交到右边总账。朱砂标注的坑:小本子不是终点,忘了交总账就没有全局结果"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        先记小账,再交总账:快一点,但会暂时旧一点
      </text>

      {ledgers.map((l) => (
        <g key={l.label}>
          <rect x={l.x} y={l.y} width="128" height="48" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={l.x + 20} y={l.y + 30} fontSize="13" fontFamily={DISPLAY} fill={INK}>{l.label}</text>
          <text x={l.x + 80} y={l.y + 30} fontSize="15" fill={AZURE_DEEP}>{l.marks}</text>
          <path d={`M ${l.x + 138} ${l.y + 24} C 274 ${l.y + 24} 314 166 398 166`} fill="none" stroke={SOFT} strokeWidth="1.3" strokeDasharray="5 4" />
        </g>
      ))}

      <rect x="410" y="98" width="150" height="136" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="485" y="132" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>总账</text>
      <line x1="438" y1="150" x2="532" y2="150" stroke={AZURE} strokeWidth="1.1" strokeLinecap="round" />
      <text x="485" y="176" textAnchor="middle" fontSize="24" fontFamily={DISPLAY} fill={AZURE_DEEP}>12</text>
      <text x="485" y="204" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>到点才更新</text>

      <text x="594" y="142" fontSize="13" fill={JADE_INK}>少跑总账,</text>
      <text x="594" y="162" fontSize="13" fill={JADE_INK}>争抢就少</text>
      <text x="594" y="196" fontSize="13" fill={SOFT}>代价:别人看到的</text>
      <text x="594" y="216" fontSize="13" fill={SOFT}>可能不是最新</text>

      <path
        d="M 208 250 Q 314 286 438 252"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="322" y="280" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:小本不是终点</text>
      <text x="322" y="298" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>忘了交就没总数</text>

      <text x="360" y="62" textAnchor="middle" fontSize="13" fill={SOFT}>
        能不能接受暂时旧一点,是业务问题;不是所有账都能这么做
      </text>
    </svg>
  );
}
