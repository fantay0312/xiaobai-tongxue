/**
 * 调试 C 标准库 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/libcDebug.ts 的内容红线咬合:
 * 图一只说"典型情况下"printf 最后交一次货、问时间抬头看公告栏(vDSO 有回退路径,不画绝对化);
 * 图二退货箭头指向自家货架(空闲池),标注"不是马上退回仓库"——何时成段归还由店家(分配器)决定。
 * 朱砂 var(--cinnabar) 只用于标「坑」;图内文字全部用生活语言。
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
const DISPLAY = 'var(--font-display)';

/** 图一:printf 的一次出差——大部分活儿在自家大厅干完,最后才去柜台小窗交一次货 */
export function LdPrintfJourneySvg({ className }: { className?: string }) {
  const steps = [
    { x: 168, label: '读格式串' },
    { x: 306, label: '把 42 变成字符' },
    { x: 452, label: '拼进缓冲区' },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:printf 的排版工作全部在用户态的 libc 大厅里完成,典型情况下最后才通过柜台小窗把一次 write 交给内核;问时间的 gettimeofday 抬头看公告栏,常常不进小窗"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        printf 的一次出差:活儿在大厅干完,最后才去小窗交货
      </text>

      {/* 用户态大厅 */}
      <rect x="26" y="52" width="520" height="150" rx="10" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="42" y="76" fontSize="13" fill={JADE_INK}>自家大厅(你的程序 + 帮工的普通代码,全在用户这边)</text>

      {/* 三步排版流水 */}
      {steps.map((s) => (
        <g key={s.label}>
          <rect x={s.x - 62} y="98" width="124" height="40" rx="7" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.4" />
          <text x={s.x} y="123" textAnchor="middle" fontSize="13" fill={AZURE_DEEP}>{s.label}</text>
        </g>
      ))}
      <path d="M 232 118 Q 238 112 244 118" fill="none" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 372 118 Q 378 112 384 118" fill="none" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" />
      <text x="306" y="168" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        排版、拼字……这些全是自家人干的,一步都没出门
      </text>

      {/* 柜台小窗 + 内核 */}
      <rect x="574" y="52" width="120" height="150" rx="10" fill="none" stroke={INK} strokeWidth="1.8" />
      <text x="634" y="78" textAnchor="middle" fontSize="13" fill={INK}>里屋(内核)</text>
      <rect x="560" y="106" width="28" height="44" rx="4" fill={PAPER_WARM} stroke={INK} strokeWidth="1.6" />
      <text x="634" y="126" textAnchor="middle" fontSize="12.5" fill={SOFT}>柜台小窗</text>
      <text x="634" y="146" textAnchor="middle" fontSize="12.5" fill={SOFT}>(进一次登记一次)</text>

      {/* 最后一步:一次交货 */}
      <path d="M 514 118 Q 540 116 556 122" fill="none" stroke={AZURE} strokeWidth="3" strokeLinecap="round" />
      <path d="M 548 116 L 558 122 L 547 127" fill="none" stroke={AZURE} strokeWidth="2" strokeLinecap="round" />
      <text x="540" y="178" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>典型情况:最后交货,就这一趟</text>

      {/* 第二条线:问时间,看公告栏 */}
      <rect x="26" y="232" width="200" height="42" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="126" y="258" textAnchor="middle" fontSize="13" fill={INK}>问一句:现在几点了?</text>
      <path d="M 232 252 Q 280 246 322 252" fill="none" stroke={AZURE} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M 314 246 L 324 252 L 313 257" fill="none" stroke={AZURE} strokeWidth="1.8" strokeLinecap="round" />
      <rect x="330" y="226" width="184" height="54" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.5" />
      <text x="422" y="248" textAnchor="middle" fontSize="13" fill={AZURE_DEEP}>墙上的公告栏</text>
      <text x="422" y="268" textAnchor="middle" fontSize="12" fill={SOFT}>里屋主动把时间贴在外面</text>
      <text x="560" y="252" fontSize="12.5" fill={JADE_INK}>抬头一看就有,</text>
      <text x="560" y="270" fontSize="12.5" fill={JADE_INK}>常常连小窗都不用进</text>

      {/* 朱砂标坑 */}
      <path d="M 96 210 Q 92 222 100 230" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />
      <text x="40" y="304" fontSize="12.5" fill={CINNABAR}>
        坑:以为"每叫一次帮工,就得进一次里屋"——进不进、进几次,拆开数一数才知道
      </text>
    </svg>
  );
}

/** 图二:内存的批发与零售——仓库只按大段发货,小卖部切格子零售;退货先回自家货架 */
export function LdMallocShopSvg({ className }: { className?: string }) {
  const shelves = [
    { y: 118, label: '小格一排(都一样大)', cells: 8, w: 24 },
    { y: 156, label: '中格一排(都一样大)', cells: 5, w: 40 },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:操作系统仓库只按大段批发内存;libc 小卖部把大段切成一样大的格子零售,常客走快路就地取货;退回来的小块先放回自家货架,不是马上退回仓库"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        内存的批发与零售:仓库只发大段,小卖部切格子
      </text>

      {/* 右侧:操作系统仓库 */}
      <rect x="520" y="58" width="176" height="176" rx="10" fill="none" stroke={INK} strokeWidth="1.8" />
      <text x="608" y="84" textAnchor="middle" fontSize="13" fill={INK}>大仓库(上头管的)</text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={544} y={100 + i * 38} width="128" height="28" rx="4" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      ))}
      <text x="608" y="119" textAnchor="middle" fontSize="12" fill={SOFT}>整段一捆</text>
      <text x="608" y="157" textAnchor="middle" fontSize="12" fill={SOFT}>整段一捆</text>
      <text x="608" y="195" textAnchor="middle" fontSize="12" fill={SOFT}>整段一捆</text>
      <text x="608" y="226" textAnchor="middle" fontSize="11.5" fill={SOFT}>零散小块?这里不办</text>

      {/* 批发箭头(仓库 → 小卖部) */}
      <path d="M 516 130 Q 470 122 428 130" fill="none" stroke={AZURE} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M 438 124 L 426 130 L 438 136" fill="none" stroke={AZURE} strokeWidth="2" strokeLinecap="round" />
      <text x="472" y="112" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>批发:一次多要一点(偶尔)</text>

      {/* 左侧:libc 小卖部 */}
      <rect x="60" y="58" width="364" height="176" rx="10" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="78" y="84" fontSize="13" fill={JADE_INK}>小卖部(帮工自营,开在用户这边)</text>
      {shelves.map((s) => (
        <g key={s.y}>
          {Array.from({ length: s.cells }).map((_, i) => (
            <rect
              key={i}
              x={84 + i * (s.w + 4)}
              y={s.y}
              width={s.w}
              height="26"
              rx="3"
              fill={i === 1 ? AZURE_WASH : 'none'}
              stroke={AZURE}
              strokeWidth="1.3"
            />
          ))}
          <text x={84} y={s.y - 6} fontSize="11.5" fill={SOFT}>{s.label}</text>
        </g>
      ))}
      <text x="84" y="212" fontSize="12" fill={SOFT}>每位顾客(每条干活的线)手边都有自己的格子架</text>

      {/* 顾客快路 */}
      <rect x="60" y="262" width="150" height="40" rx="8" fill="none" stroke={INK} strokeWidth="1.6" />
      <text x="135" y="287" textAnchor="middle" fontSize="13" fill={INK}>常客:要个小块</text>
      <path d="M 135 258 Q 130 240 128 190" fill="none" stroke={AZURE} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M 122 200 L 128 188 L 135 199" fill="none" stroke={AZURE} strokeWidth="1.8" strokeLinecap="round" />
      <text x="226" y="282" fontSize="12" fill={AZURE_DEEP}>快路:就地一格发完,不惊动仓库</text>

      {/* 慢路(虚线绕到仓库) */}
      <path
        d="M 226 296 Q 420 316 560 240"
        fill="none"
        stroke={SOFT}
        strokeWidth="1.6"
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
      <text x="450" y="308" fontSize="12" fill={SOFT}>慢路:超大件 / 格子用光,才去仓库再批发</text>

      {/* 退货回货架(朱砂标坑) */}
      <path d="M 320 236 Q 330 214 300 192" fill="none" stroke={CINNABAR} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M 310 200 L 298 190 L 312 187" fill="none" stroke={CINNABAR} strokeWidth="1.5" strokeLinecap="round" />
      <text x="336" y="252" fontSize="12.5" fill={CINNABAR}>坑:退货先回自家货架等复用,</text>
      <text x="336" y="270" fontSize="12.5" fill={CINNABAR}>不是马上退回大仓库</text>
    </svg>
  );
}
