/**
 * CPU、GPU 和 SIMT(《操作系统原理》第 20 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/gpu.ts 的 microLecture 咬合:
 * 图一「一位领队喊一排人」——一束小工共享口令,但各自有手里的号码和本子;朱砂只标「别当成每人一颗完整大脑」这个坑。
 * 图二「队形齐就快,走散就慢」——相邻写格子可以合并成大搬运,跳着拿和分叉绕路会拖慢整队;朱砂只标队伍走散的坑。
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
const CODE = 'var(--font-code)';

/** 图一:一位领队喊一排人 —— 一束小工共享口令,各自拿着不同本子 */
export function GpuSimtWarpSvg({ className }: { className?: string }) {
  const workers = Array.from({ length: 8 }, (_, i) => ({
    x: 84 + i * 72,
    label: String(i),
  }));

  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:一位领队拿着口令牌,一排小工听同一个口令;每个小工手里有不同号码和小本子。朱砂标注的坑:别把每个小工都当成完整大脑"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一位领队喊口令,一排小工各写各的格子
      </text>

      {/* 领队和口令牌 */}
      <rect x="280" y="56" width="160" height="44" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="360" y="83" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        同一张口令牌
      </text>
      <path d="M 360 102 C 342 126, 302 134, 250 145" fill="none" stroke={AZURE} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 360 102 C 378 126, 432 134, 538 145" fill="none" stroke={AZURE} strokeWidth="1.4" strokeLinecap="round" />
      <text x="360" y="124" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>
        口令只有一份,大家同时听
      </text>

      {/* 小工队列 */}
      {workers.map((w, i) => (
        <g key={w.label}>
          <path
            d={`M ${w.x - 16} 180 Q ${w.x} ${166 + (i % 2) * 3} ${w.x + 16} 180`}
            fill="none"
            stroke={INK}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx={w.x} cy="164" r="11" fill={PAPER_WARM} stroke={INK} strokeWidth="1.2" />
          <rect x={w.x - 22} y="184" width="44" height="42" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={w.x} y="210" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={INK}>
            格{w.label}
          </text>
          <rect x={w.x - 24} y="238" width="48" height="28" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1" />
          <text x={w.x} y="257" textAnchor="middle" fontSize="12" fill={SOFT}>
            小本子
          </text>
        </g>
      ))}

      <line x1="76" y1="286" x2="642" y2="286" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 5" />
      <text x="360" y="310" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        口令相同,本子不同——所以同一句话能落到不同格子
      </text>

      {/* 坑:每人一颗完整大脑 */}
      <path
        d="M 574 78 Q 622 52 662 82 Q 638 122 590 116 Q 558 110 574 78"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.5"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="620" y="82" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:别当成
      </text>
      <text x="620" y="100" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        每人一颗完整大脑
      </text>
    </svg>
  );
}

/** 图二:队形齐就快,走散就慢 —— 连续写格子可合并,跳着拿和分叉会拖慢整队 */
export function GpuMemoryShapeSvg({ className }: { className?: string }) {
  const cells = Array.from({ length: 12 }, (_, i) => ({
    x: 58 + i * 42,
    label: i,
  }));
  const scattered = [0, 4, 8, 2, 10, 6];

  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:上排一队人写相邻格子,许多小箭头合成一次大搬运;下排一队人跳着写格子并有人绕远路,朱砂标注的坑是队伍走散"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        队形齐就快,走散就慢
      </text>

      {/* 好队形 */}
      <text x="54" y="72" fontSize="13.5" fill={JADE_INK}>好队形:一排人写相邻格子</text>
      {cells.slice(0, 8).map((c, i) => (
        <g key={c.label}>
          <rect x={c.x} y="88" width="34" height="34" rx="4" fill={i < 6 ? AZURE_WASH : PAPER_WARM} stroke={i < 6 ? AZURE : PAPER_EDGE} strokeWidth="1.2" />
          <text x={c.x + 17} y="110" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={i < 6 ? AZURE_DEEP : SOFT}>
            {c.label}
          </text>
        </g>
      ))}
      <path d="M 64 142 C 122 166, 236 166, 304 142" fill="none" stroke={AZURE} strokeWidth="7" strokeLinecap="round" opacity="0.75" />
      <text x="184" y="178" textAnchor="middle" fontSize="13" fill={AZURE_DEEP}>
        一串小搬运,合成一次大搬运
      </text>

      {/* 坏队形 */}
      <text x="54" y="226" fontSize="13.5" fill={CINNABAR}>坑:队伍走散,东一格西一格</text>
      {cells.map((c) => (
        <g key={c.label}>
          <rect x={c.x} y="244" width="34" height="34" rx="4" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1" />
          <text x={c.x + 17} y="266" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>
            {c.label}
          </text>
        </g>
      ))}
      {scattered.map((idx, i) => (
        <path
          key={idx}
          d={`M ${86 + i * 36} 214 Q ${92 + i * 48} ${196 - (i % 2) * 18} ${58 + idx * 42 + 17} 242`}
          fill="none"
          stroke={CINNABAR}
          strokeWidth="1.3"
          strokeDasharray="4 4"
          strokeLinecap="round"
          opacity="0.9"
        />
      ))}
      <path d="M 520 192 Q 606 208 576 284" fill="none" stroke={CINNABAR} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="6 4" />
      <text x="602" y="204" fontSize="12.5" fill={CINNABAR}>有人绕远路</text>
      <text x="602" y="222" fontSize="12.5" fill={CINNABAR}>整队等最慢</text>

      <text x="512" y="118" fontSize="13" fill={SOFT}>适合:同一类活、材料排整齐</text>
      <text x="512" y="142" fontSize="13" fill={SOFT}>不适合:每人到处拐弯</text>
      <text x="360" y="322" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        同样是写表,队形决定硬件看到的是一条宽路,还是一堆岔路
      </text>
    </svg>
  );
}
