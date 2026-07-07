/**
 * 终端和 UNIX Shell —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/shell.ts 的内容红线咬合:
 * 图一只说「键盘/黑窗口只递字符,操作系统翻译成信号、发给前台那一组」,
 * 朱砂只标「键盘直接杀程序」这条不存在的近道(坑);
 * 图二对照「先存临时文件」的想象与「内核缓冲通道两侧并发」的实际,
 * 朱砂只标想象中的那只临时文件(坑)——数据不落盘,两边同时开工。
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

/** 图一:一个字符的权力之旅——键盘和黑窗口都不动手,操作系统翻译成信号只发前台那组 */
export function OsShellSignalTripSvg({ className }: { className?: string }) {
  const stations = [
    { x: 24, w: 96, label: '键盘', sub: '按下组合键' },
    { x: 176, w: 122, label: '黑窗口', sub: '只递 3 号字符' },
    { x: 358, w: 128, label: '操作系统', sub: '翻译成信号', accent: true },
  ];
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:按下 Ctrl-C 后,键盘和黑窗口都只是传递一个字符,操作系统把它翻译成信号,只发给前台那一组进程,后台那组不受影响;键盘直接杀程序的近道被朱砂叉掉,此路不通"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        按下 Ctrl-C:一个字符的权力之旅
      </text>

      {/* 三个传递站 */}
      {stations.map((s) => (
        <g key={s.label}>
          <rect
            x={s.x}
            y="150"
            width={s.w}
            height="62"
            rx="8"
            fill={s.accent ? AZURE_WASH : PAPER_WARM}
            stroke={s.accent ? AZURE : PAPER_EDGE}
            strokeWidth={s.accent ? 2 : 1.2}
          />
          <text
            x={s.x + s.w / 2}
            y="177"
            textAnchor="middle"
            fontSize="16"
            fontFamily={DISPLAY}
            fill={s.accent ? AZURE_DEEP : INK}
          >
            {s.label}
          </text>
          <text x={s.x + s.w / 2} y="199" textAnchor="middle" fontSize="12" fill={SOFT}>
            {s.sub}
          </text>
        </g>
      ))}

      {/* 站与站之间的字符传递 */}
      <path d="M 122 181 L 172 181" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 165 176 L 173 181 L 165 186" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <text x="147" y="170" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>Ctrl-C</text>

      <path d="M 300 181 L 353 181" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 346 176 L 354 181 L 346 186" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <text x="326" y="170" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>03</text>

      {/* 前台进程组:全组收到信号 */}
      <rect x="560" y="96" width="138" height="76" rx="10" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="629" y="122" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>前台那一组</text>
      <text x="629" y="142" textAnchor="middle" fontSize="12" fill={SOFT}>正在跟你说话的</text>
      <text x="629" y="160" textAnchor="middle" fontSize="12" fill={SOFT}>全组都收到信号</text>

      {/* 后台进程组:照常干活 */}
      <rect x="560" y="212" width="138" height="70" rx="10" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="629" y="238" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>后台那一组</text>
      <text x="629" y="260" textAnchor="middle" fontSize="12" fill={JADE_INK}>不受影响,照常干活</text>

      {/* 操作系统 → 前台(实线信号)/ 后台(点线,不发) */}
      <path d="M 486 168 Q 522 140 556 130" fill="none" stroke={AZURE} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M 546 127 L 557 130 L 549 138" fill="none" stroke={AZURE} strokeWidth="2" strokeLinecap="round" />
      <text x="514" y="122" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>发信号</text>

      <path
        d="M 486 196 Q 522 226 556 240"
        fill="none"
        stroke={SOFT}
        strokeWidth="1.4"
        strokeDasharray="2 6"
        strokeLinecap="round"
      />
      <text x="514" y="248" textAnchor="middle" fontSize="12" fill={SOFT}>不发</text>

      {/* 坑:想象中的「键盘直接杀程序」近道(朱砂) */}
      <path
        d="M 72 146 Q 330 44 600 92"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.8"
        strokeDasharray="7 6"
        strokeLinecap="round"
        opacity="0.9"
      />
      <g stroke={CINNABAR} strokeWidth="2.4" strokeLinecap="round">
        <path d="M 322 62 L 342 82" />
        <path d="M 342 62 L 322 82" />
      </g>
      <text x="332" y="52" textAnchor="middle" fontSize="13" fill={CINNABAR}>
        「键盘直接杀程序」?此路不通
      </text>

      <text x="360" y="304" textAnchor="middle" fontSize="13" fill={SOFT}>
        键盘和黑窗口都只递字符——动不动手、发给谁,全由操作系统说了算
      </text>
    </svg>
  );
}

/** 图二:管道不是临时文件,是两边同时开工的流水线 */
export function OsShellPipeSvg({ className }: { className?: string }) {
  const dots = [268, 316, 364, 412];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:上半部分是想象中的做法——左边命令先跑完、存进临时文件再交给右边,临时文件被朱砂叉掉,标注坑,根本没有这个文件;下半部分是实际——两边程序同时开工,数据经内核里的缓冲通道边产边吃,不落盘"
      className={className}
    >
      <text x="360" y="28" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        竖线两边,数据怎么流?
      </text>

      {/* 上:想象中(坑) */}
      <text x="26" y="62" fontSize="13" fill={CINNABAR}>想象中:先跑完、存个文件、再交货</text>
      <rect x="26" y="76" width="150" height="52" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="101" y="107" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>左边的命令</text>

      <path d="M 180 102 L 268 102" fill="none" stroke={SOFT} strokeWidth="1.4" strokeDasharray="5 5" />
      <path d="M 261 97 L 269 102 L 261 107" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="224" y="92" textAnchor="middle" fontSize="11" fill={SOFT}>全部跑完才动笔</text>

      {/* 想象中的临时文件(朱砂标坑) */}
      <g>
        <path
          d="M 274 78 L 354 78 L 372 96 L 372 128 L 274 128 Z"
          fill={PAPER_WARM}
          stroke={CINNABAR}
          strokeWidth="1.8"
          strokeDasharray="6 5"
        />
        <path d="M 354 78 L 354 96 L 372 96" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="6 5" />
        <text x="322" y="110" textAnchor="middle" fontSize="13" fill={CINNABAR}>临时文件?</text>
        <g stroke={CINNABAR} strokeWidth="2.6" strokeLinecap="round">
          <path d="M 306 86 L 340 120" />
          <path d="M 340 86 L 306 120" />
        </g>
      </g>
      <text x="322" y="148" textAnchor="middle" fontSize="12" fill={CINNABAR}>坑:根本没有这个文件</text>

      <path d="M 378 102 L 466 102" fill="none" stroke={SOFT} strokeWidth="1.4" strokeDasharray="5 5" />
      <path d="M 459 97 L 467 102 L 459 107" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="422" y="92" textAnchor="middle" fontSize="11" fill={SOFT}>再从头读一遍</text>

      <rect x="470" y="76" width="150" height="52" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="545" y="107" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>右边的命令</text>

      {/* 分隔淡线 */}
      <path d="M 26 176 L 694 176" stroke={PAPER_EDGE} strokeWidth="1" strokeDasharray="3 7" />

      {/* 下:实际(流水线) */}
      <text x="26" y="204" fontSize="13" fill={JADE_INK}>实际:两边同时开工,边产边吃,不落盘</text>
      <rect x="26" y="220" width="150" height="56" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="101" y="245" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={AZURE_DEEP}>左边的命令</text>
      <text x="101" y="265" textAnchor="middle" fontSize="11" fill={SOFT}>一边产出</text>

      {/* 内核缓冲通道 */}
      <rect x="216" y="230" width="248" height="36" rx="18" fill={PAPER_WARM} stroke={AZURE} strokeWidth="1.6" />
      {dots.map((cx) => (
        <circle key={cx} cx={cx} cy="248" r="5" fill={AZURE} opacity="0.75" />
      ))}
      <path d="M 434 243 L 448 248 L 434 253" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
      <text x="340" y="222" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>大总管肚子里的一截缓冲通道</text>
      <text x="340" y="284" textAnchor="middle" fontSize="11" fill={SOFT}>塞满了,左边先歇会儿——流水线自己会调速</text>

      <rect x="504" y="220" width="150" height="56" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="579" y="245" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={AZURE_DEEP}>右边的命令</text>
      <text x="579" y="265" textAnchor="middle" fontSize="11" fill={SOFT}>一边消化</text>

      <path d="M 180 248 L 212 248" fill="none" stroke={AZURE} strokeWidth="2" strokeLinecap="round" />
      <path d="M 468 248 L 500 248" fill="none" stroke={AZURE} strokeWidth="2" strokeLinecap="round" />
      <path d="M 493 243 L 501 248 L 493 253" fill="none" stroke={AZURE} strokeWidth="1.8" strokeLinecap="round" />

      <text x="360" y="322" textAnchor="middle" fontSize="13" fill={SOFT}>
        所以「看一眼超大文件的第一行」几乎瞬间返回:右边收工,左边也跟着停
      </text>
    </svg>
  );
}
