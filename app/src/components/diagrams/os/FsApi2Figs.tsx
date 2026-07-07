/**
 * 文件系统 API (2)(《操作系统原理》第 25 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/fsApi2.ts 咬合:
 * 图一「门铃不是巡逻」对应监控 API:系统事件后端减少全目录轮询,但不承诺永远不需要校准;
 * 图二「合成橱窗」对应覆盖目录:看到的是虚拟视图,写入和遮挡记录在新层,朱砂只标“删橱窗不等于砸旧仓库”这个坑。
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

/** 图一:门铃不是巡逻 —— 左边反复全屋数,右边变化来敲门 */
export function FsApi2BellWatchSvg({ className }: { className?: string }) {
  const shelves = [
    { x: 86, y: 92, label: '抽屉甲' },
    { x: 86, y: 150, label: '抽屉乙' },
    { x: 86, y: 208, label: '抽屉丙' },
  ];
  const events = [
    { y: 110, label: '新建' },
    { y: 162, label: '修改' },
    { y: 214, label: '删除' },
  ];
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:左边是人每隔一会儿打开所有抽屉巡逻,右边是抽屉一动就拉响门铃通知。朱砂标注的坑是别把门铃当成巡逻"
      className={className}
    >
      <text x="360" y="32" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        盯变化:别把门铃说成巡逻
      </text>

      <rect x="44" y="64" width="250" height="208" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="169" y="84" textAnchor="middle" fontSize="13.5" fill={SOFT}>土办法:一遍遍数</text>
      {shelves.map((s) => (
        <g key={s.label}>
          <rect x={s.x} y={s.y} width="126" height="34" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} />
          <text x={s.x + 63} y={s.y + 22} textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={INK}>
            {s.label}
          </text>
        </g>
      ))}
      <path
        d="M 230 92 C 266 120 258 178 224 214"
        fill="none"
        stroke={SOFT}
        strokeWidth="1.4"
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
      <text x="238" y="156" fontSize="12.5" fill={SOFT}>每隔一会儿</text>
      <text x="238" y="174" fontSize="12.5" fill={SOFT}>全屋巡逻</text>

      <rect x="426" y="64" width="250" height="208" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.6" />
      <text x="551" y="84" textAnchor="middle" fontSize="13.5" fill={AZURE_DEEP}>事件办法:变化来敲门</text>
      <circle cx="498" cy="160" r="42" fill={PAPER_WARM} stroke={AZURE} strokeWidth="1.6" />
      <path d="M 482 160 Q 498 118 514 160 Q 498 194 482 160" fill="none" stroke={AZURE_DEEP} strokeWidth="1.5" />
      <circle cx="498" cy="160" r="7" fill={AZURE_DEEP} />
      <text x="498" y="224" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={AZURE_DEEP}>门铃</text>
      {events.map((e) => (
        <g key={e.label}>
          <path d={`M 594 ${e.y} Q 558 ${e.y + 8} 526 144`} fill="none" stroke={JADE_INK} strokeWidth="1.2" strokeLinecap="round" />
          <rect x="604" y={e.y - 14} width="50" height="28" rx="14" fill={PAPER_WARM} stroke={PAPER_EDGE} />
          <text x="629" y={e.y + 5} textAnchor="middle" fontSize="12.5" fill={INK}>{e.label}</text>
        </g>
      ))}

      <path d="M 318 166 Q 356 138 398 166" fill="none" stroke={FAINT} strokeWidth="1.3" strokeDasharray="5 5" />
      <path d="M 388 158 L 400 166 L 388 174" fill="none" stroke={FAINT} strokeWidth="1.3" strokeLinecap="round" />

      <path
        d="M 430 48 Q 548 34 666 50"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="594" y="48" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:门铃不是巡逻</text>

      <text x="360" y="294" textAnchor="middle" fontSize="13" fill={SOFT}>
        文件多时,反复数很贵;让变化来报信,再在异常时校准
      </text>
    </svg>
  );
}

/** 图二:合成橱窗 —— 旧层不动,新改动和遮挡记录在新层 */
export function FsApi2OverlayWindowSvg({ className }: { className?: string }) {
  const lowerItems = [
    { x: 88, label: '旧工具' },
    { x: 194, label: '旧说明' },
    { x: 300, label: '旧钥匙' },
  ];
  const upperItems = [
    { x: 430, label: '新说明' },
    { x: 540, label: '遮挡条' },
  ];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:下面旧仓库保持不动,上面新改动记录新版本和遮挡条,最上方橱窗展示合成结果。朱砂标注的坑是删橱窗不等于砸旧仓库"
      className={className}
    >
      <text x="360" y="32" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        看到的是合成橱窗,不是把仓库揉成一团
      </text>

      <rect x="62" y="222" width="310" height="58" rx="7" fill={INK_WASH} stroke={PAPER_EDGE} />
      <text x="86" y="214" fontSize="13" fill={SOFT}>旧仓库</text>
      {lowerItems.map((item) => (
        <g key={item.label}>
          <rect x={item.x} y="236" width="78" height="30" rx="5" fill={PAPER_WARM} stroke={PAPER_EDGE} />
          <text x={item.x + 39} y="256" textAnchor="middle" fontSize="12.5" fill={INK}>{item.label}</text>
        </g>
      ))}

      <rect x="406" y="222" width="226" height="58" rx="7" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.4" />
      <text x="430" y="214" fontSize="13" fill={AZURE_DEEP}>新改动</text>
      {upperItems.map((item) => (
        <g key={item.label}>
          <rect x={item.x} y="236" width="78" height="30" rx="5" fill={PAPER_WARM} stroke={item.label === '遮挡条' ? CINNABAR : AZURE} />
          <text x={item.x + 39} y="256" textAnchor="middle" fontSize="12.5" fill={item.label === '遮挡条' ? CINNABAR : AZURE_DEEP}>
            {item.label}
          </text>
        </g>
      ))}

      <rect x="120" y="76" width="480" height="78" rx="8" fill={PAPER_WARM} stroke={AZURE} strokeWidth="1.7" />
      <text x="148" y="66" fontSize="13" fill={AZURE_DEEP}>大家看到的橱窗</text>
      {[
        { x: 180, label: '旧工具', fill: INK },
        { x: 320, label: '新说明', fill: AZURE_DEEP },
        { x: 460, label: '旧钥匙', fill: INK },
      ].map((item) => (
        <g key={item.label}>
          <rect x={item.x} y="100" width="88" height="32" rx="6" fill={item.fill === INK ? INK_WASH : AZURE_WASH} stroke={PAPER_EDGE} />
          <text x={item.x + 44} y="121" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={item.fill}>{item.label}</text>
        </g>
      ))}

      <path d="M 214 222 Q 214 188 224 156" fill="none" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 4" />
      <path d="M 470 222 Q 414 182 364 156" fill="none" stroke={AZURE} strokeWidth="1.2" strokeDasharray="4 4" />
      <path d="M 578 222 Q 544 180 506 150" fill="none" stroke={CINNABAR} strokeWidth="1.2" strokeDasharray="4 4" />
      <text x="592" y="182" fontSize="12.5" fill={CINNABAR}>坑:删橱窗</text>
      <text x="592" y="198" fontSize="12.5" fill={CINNABAR}>不等于砸旧仓库</text>

      <text x="360" y="312" textAnchor="middle" fontSize="13" fill={SOFT}>
        新层能盖住旧层,也能贴“别展示”的条;旧仓库本身仍保持原样
      </text>
    </svg>
  );
}
