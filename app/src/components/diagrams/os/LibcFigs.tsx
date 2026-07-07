/**
 * C 标准库和实现 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/libc.ts 的内容红线咬合:
 * 图一只说「先攒一批,再过一次门」,冲刷条件标注"主流实现:碰到换行"而非铁律;
 * 图二的开场谢幕时间线与 microLecture 第 5 点一致(搭台 → main 上台 → 收场才真正退出)。
 * 朱砂 var(--cinnabar) 只用来标「坑」:喊一次跑一趟 / 以为程序从 main 开始。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const JADE_INK = 'var(--jade-ink)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const CINNABAR = 'var(--cinnabar)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:一行字的旅程——printf 先把字攒进抽屉,凑一批才过一次门交给操作系统 */
export function LibcPrintfJourneySvg({ className }: { className?: string }) {
  const letters = ['你', '好', '世', '界'];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:程序喊了四次 printf,四个字先攒在屋里的抽屉里,碰到换行才由一次 write 一起过门交给操作系统,最后送到屏幕"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        喊了四次,只过一次门
      </text>

      {/* 你的程序(左) */}
      <rect x="24" y="70" width="132" height="150" rx="10" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="90" y="98" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>你的程序</text>
      {letters.map((ch, i) => (
        <text key={ch} x="90" y={128 + i * 24} textAnchor="middle" fontSize="13" fill={SOFT}>
          {`喊一声「${ch}」`}
        </text>
      ))}

      {/* 四条小箭头进入 printf 的家 */}
      {letters.map((ch, i) => (
        <path
          key={ch}
          d={`M 158 ${122 + i * 24} q 22 ${6 - i * 4} 44 ${8 - i * 5}`}
          fill="none"
          stroke={SOFT}
          strokeWidth="1.4"
          strokeDasharray="4 3"
          markerEnd="none"
        />
      ))}

      {/* printf 的家:用户态,带抽屉(缓冲) */}
      <rect x="206" y="70" width="216" height="170" rx="12" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="314" y="98" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        跑腿的住你家(printf)
      </text>
      {/* 抽屉 */}
      <rect x="230" y="116" width="168" height="52" rx="6" fill={PAPER_WARM} stroke={AZURE} strokeWidth="1.5" />
      {letters.map((ch, i) => (
        <g key={ch}>
          <rect x={240 + i * 34} y="126" width="28" height="32" rx="4" fill="none" stroke={SOFT} strokeWidth="1.2" />
          <text x={254 + i * 34} y="148" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>{ch}</text>
        </g>
      ))}
      <text x="314" y="188" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>先攒进抽屉,不着急出门</text>
      <text x="314" y="208" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>凑一批(主流实现:碰到换行)再走</text>

      {/* 一道门:进操作系统 */}
      <path d="M 468 92 v 148" stroke={INK} strokeWidth="2.5" />
      <path d="M 468 92 a 40 40 0 0 1 40 40" fill="none" stroke={INK} strokeWidth="2" />
      <circle cx="497" cy="170" r="3" fill={INK} />
      <text x="490" y="262" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={INK}>一道门</text>
      <text x="490" y="280" textAnchor="middle" fontSize="12" fill={SOFT}>(过门=交给操作系统,一趟不便宜)</text>

      {/* 批量过门的粗箭头:一次 write */}
      <path d="M 422 152 Q 470 146 540 150" fill="none" stroke={AZURE} strokeWidth="6" strokeLinecap="round" opacity="0.85" />
      <path d="M 533 141 L 549 150 L 532 159" fill="none" stroke={AZURE} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="486" y="132" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={AZURE_DEEP}>一趟送一批</text>

      {/* 屏幕(右) */}
      <rect x="562" y="96" width="134" height="96" rx="10" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <rect x="574" y="108" width="110" height="56" rx="4" fill="none" stroke={SOFT} strokeWidth="1.2" />
      <text x="629" y="142" textAnchor="middle" fontSize="16" fontFamily={DISPLAY} fill={INK}>你好世界</text>
      <text x="629" y="182" textAnchor="middle" fontSize="13" fill={SOFT}>屏幕:一起冒出来</text>

      {/* 朱砂坑标注 */}
      <path d="M 200 292 q 60 -18 120 -6" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x="330" y="298" fontSize="13.5" fontFamily={DISPLAY} fill={CINNABAR}>
        坑:以为「喊一次就跑一趟」——其实先攒着,凑一批才过一次门
      </text>
    </svg>
  );
}

/** 图二:开场与谢幕——main 只是主角,幕前幕后都有人干活 */
export function LibcCurtainSvg({ className }: { className?: string }) {
  const steps = [
    { x: 60, w: 128, title: '搭台(_start)', sub: '真正的入口先跑', accent: false },
    { x: 208, w: 138, title: '摆道具', sub: '参数、环境一样样放好', accent: false },
    { x: 366, w: 128, title: 'main 上台', sub: '你写的戏开演', accent: true },
    { x: 514, w: 146, title: '谢幕后收场', sub: '送走攒下的字·跑完收尾活', accent: false },
  ];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:程序像一场话剧,开演前 _start 先搭台摆道具,main 只是中间上台的主角,谢幕后还要收场送走缓冲的字、跑完收尾函数,最后才跟操作系统道别"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        main 只是主角,不是整场戏
      </text>

      {/* 幕布 */}
      <path d="M 40 48 Q 360 74 680 48" fill="none" stroke={SOFT} strokeWidth="1.6" strokeDasharray="6 4" />
      <text x="672" y="42" textAnchor="end" fontSize="12" fill={SOFT}>大幕拉开</text>

      {/* 时间线主轴 */}
      <path d="M 40 148 H 668" stroke={INK} strokeWidth="2" />
      <path d="M 660 140 L 676 148 L 660 156" fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />

      {/* 步骤盒 */}
      {steps.map((s) => (
        <g key={s.title}>
          <rect
            x={s.x}
            y="110"
            width={s.w}
            height="76"
            rx="10"
            fill={s.accent ? AZURE_WASH : PAPER_WARM}
            stroke={s.accent ? AZURE : PAPER_EDGE}
            strokeWidth={s.accent ? 2.2 : 1.4}
          />
          <text
            x={s.x + s.w / 2}
            y="140"
            textAnchor="middle"
            fontSize="14.5"
            fontFamily={DISPLAY}
            fill={s.accent ? AZURE_DEEP : INK}
          >
            {s.title}
          </text>
          <text x={s.x + s.w / 2} y="164" textAnchor="middle" fontSize="11.5" fill={SOFT}>
            {s.sub}
          </text>
        </g>
      ))}

      {/* 幕前幕后分界 */}
      <text x="124" y="216" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>幕后:开演之前就有人干活</text>
      <text x="587" y="216" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>幕后:下台之后才关灯锁门</text>
      <text x="430" y="216" textAnchor="middle" fontSize="12.5" fill={SOFT}>幕前:只有这段是你写的</text>

      {/* 最终道别 */}
      <text x="672" y="126" textAnchor="end" fontSize="12" fill={SOFT}>跟操作系统道别</text>

      {/* 朱砂坑标注 */}
      <path d="M 366 246 q 30 -26 44 -52" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x="360" y="266" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={CINNABAR}>
        坑:以为「程序从 main 开始、到 main 结束」——其实开场有人搭台,谢幕有人收场
      </text>
    </svg>
  );
}
