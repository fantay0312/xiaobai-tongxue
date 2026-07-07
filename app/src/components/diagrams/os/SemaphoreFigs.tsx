/**
 * 并发控制：信号量(《操作系统原理》第 16 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/semaphore.ts 的 microLecture 咬合:
 * 图一「一块会加减的号牌」——停车场门口的空位牌,P 进场减一、V 离场加一,数字到 0 排队;
 * 朱砂只标「别当成只有 1 个位子的锁——初值设几就能放几个」这个坑(对应 M1)。
 * 图二「等号牌的人是去睡,不是干瞪眼」——拿不到许可的线程被挂起去睡、让出处理器,
 * 别人 V(归还)时把它唤醒;朱砂只标「以为它在反复空转,其实它在睡觉」这个坑(对应 M2)。
 * 分寸:两图都不画"忙等 vs 自旋锁"的细节,留给正文;图内文字一律生活语言。
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

/** 图一:一块会加减的号牌 —— 停车场空位牌,P 减一 / V 加一,朱砂标「别当成只有一个位子的锁」 */
export function SemNumberPlateSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:停车场门口有一块空位牌,当前显示 3。想进场的人做 P 动作,数字减一;离场的人做 V 动作,数字加一;数字到 0 时后面的人排队等待。朱砂标注的坑:别把它当成只有一个位子的锁,初值设成几就能放几个人同时进"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        信号量:一块会加减的号牌
      </text>

      {/* 空位牌(计数器) */}
      <rect x="300" y="52" width="120" height="76" rx="10" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="360" y="78" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>还剩名额</text>
      <text x="360" y="116" textAnchor="middle" fontSize="34" fontFamily={CODE} fill={AZURE_DEEP}>3</text>

      {/* P:进场,减一 */}
      <g>
        <path d="M 214 90 L 292 90" fill="none" stroke={JADE_INK} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 284 85 L 294 90 L 284 95" fill="none" stroke={JADE_INK} strokeWidth="1.8" strokeLinecap="round" />
        <text x="150" y="80" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>进场(P)</text>
        <text x="150" y="100" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>数字减一,拿走一个名额</text>
      </g>

      {/* V:离场,加一 */}
      <g>
        <path d="M 428 90 L 506 90" fill="none" stroke={JADE_INK} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M 500 85 L 510 90 L 500 95" fill="none" stroke={JADE_INK} strokeWidth="1.8" strokeLinecap="round" />
        <text x="580" y="80" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>离场(V)</text>
        <text x="580" y="100" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>数字加一,放回一个名额</text>
      </g>

      {/* 场内:三个已进场的车位 */}
      <text x="70" y="176" fontSize="13" fill={SOFT}>场内(初值 3,已放 3 个进来):</text>
      {[0, 1, 2].map((i) => (
        <g key={`in-${i}`}>
          <rect x={330 + i * 66} y="160" width="56" height="34" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={358 + i * 66} y="182" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>车{i + 1}</text>
        </g>
      ))}

      {/* 门外排队 */}
      <text x="70" y="236" fontSize="13" fill={SOFT}>数字到 0 时,后面的人排队等:</text>
      {[0, 1].map((i) => (
        <g key={`wait-${i}`}>
          <rect x={330 + i * 66} y="220" width="56" height="34" rx="6" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1" strokeDasharray="4 3" />
          <text x={358 + i * 66} y="242" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={SOFT}>等</text>
        </g>
      ))}
      <text x="474" y="242" fontSize="12.5" fill={FAINT}>有人 V 放回名额,才轮到他们</text>

      {/* 坑:朱砂括线,指向号牌 */}
      <path
        d="M 300 138 Q 250 160 120 150"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <text x="150" y="286" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:别当成只有 1 个位子的锁——</text>
      <text x="150" y="304" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>初值设成几,就能放几个人同时进</text>

      <text x="360" y="328" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        锁只是初值 = 1 的特例;放开初值,它就多了"计数"这一手
      </text>
    </svg>
  );
}

/** 图二:等号牌的人是去睡,不是干瞪眼 —— 拿不到许可就挂起去睡,别人 V 时唤醒,朱砂标「其实在睡」 */
export function SemSleepWakeSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:一条时间轴上,某线程做 P 却发现数字是 0 拿不到许可,于是被挂起去睡、让出处理器,一点也不占用 CPU;后来另一个线程做 V 归还许可,把睡着的它唤醒,它再回来接着抢。朱砂标注的坑:别以为它在反复空转,其实它在睡觉"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        等号牌的人是去睡,不是干瞪眼
      </text>

      {/* 时间轴 */}
      <line x1="60" y1="150" x2="650" y2="150" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 642 146 L 652 150 L 642 154" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="664" y="154" fontSize="13" fill={SOFT}>时间</text>

      {/* 阶段一:P 拿不到 */}
      <g>
        <rect x="86" y="118" width="120" height="64" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.6" />
        <text x="146" y="142" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>做 P:想进</text>
        <text x="146" y="164" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>数字是 0,拿不到</text>
      </g>

      {/* 阶段二:去睡(让出处理器) */}
      <g>
        <rect x="270" y="118" width="150" height="64" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.4" strokeDasharray="5 3" />
        <text x="345" y="140" textAnchor="middle" fontSize="18" fill={SOFT}>Zzz</text>
        <text x="345" y="164" textAnchor="middle" fontSize="12.5" fill={SOFT}>被挂起去睡,不占处理器</text>
      </g>

      {/* 阶段三:被 V 唤醒,回来抢 */}
      <g>
        <rect x="486" y="118" width="132" height="64" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
        <text x="552" y="142" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>被唤醒</text>
        <text x="552" y="164" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>回来接着抢名额</text>
      </g>

      {/* 别的线程做 V,递出"叫醒"箭头 */}
      <text x="345" y="88" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>别的线程做 V(归还一个名额)</text>
      <path d="M 420 96 Q 500 100 540 114" fill="none" stroke={JADE_INK} strokeWidth="1.6" strokeDasharray="5 4" strokeLinecap="round" />
      <path d="M 534 106 L 543 115 L 531 116" fill="none" stroke={JADE_INK} strokeWidth="1.6" strokeLinecap="round" />
      <text x="470" y="112" textAnchor="middle" fontSize="12" fill={JADE_INK}>叫醒它 →</text>

      {/* 阶段衔接短线 */}
      {[206, 420].map((x) => (
        <line key={x} x1={x} y1="150" x2={x + 50} y2="150" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
      ))}

      {/* 坑:朱砂圈住"去睡"那段 */}
      <rect x="264" y="112" width="162" height="76" rx="10" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="6 4" opacity="0.85" />
      <text x="345" y="212" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:以为它在这儿反复空转、干瞪眼——</text>
      <text x="345" y="230" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>其实它睡着了,CPU 让给了别人</text>

      <text x="360" y="266" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        讲义里 P 那圈 while 只是"要等"的示意;真机器靠"睡着等唤醒",不烧 CPU
      </text>
    </svg>
  );
}
