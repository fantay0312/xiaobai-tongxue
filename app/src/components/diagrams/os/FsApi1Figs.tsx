/**
 * 文件系统 API (1)(《操作系统原理》第 24 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/fsApi1.ts 的 microLecture 咬合:
 * 图一「借一个格子看外来的柜子」——挂载是临时接入另一棵树,不是复制内容;
 * 朱砂只标「以为复制进来了」这个坑。
 * 图二「名字牌 vs 地址纸条」——硬链接是同一对象的多个名字,软链接是存路径的提示纸条;
 * 朱砂只标「把两者都当快捷方式」这个坑。
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

/** 图一:挂载不是复制 —— 借一个位置看外来柜子,朱砂标「复制进去」的坑 */
export function FsMountShelfSvg({ className }: { className?: string }) {
  const before = [
    { x: 64, y: 120, label: '原本空格' },
    { x: 64, y: 168, label: '本地小纸条' },
  ];
  const device = [
    { x: 470, y: 96, label: '照片' },
    { x: 470, y: 142, label: '视频' },
    { x: 470, y: 188, label: '作业' },
  ];
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:左边是平时书架上的一个格子,右边是一只外来的资料箱。接上后,中间的格子显示外来箱子的内容;拿走后,原来的格子又露出来。朱砂标注的坑:不是复制进来了"
      className={className}
    >
      <text x="360" y="32" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        借一个格子看外来的柜子
      </text>

      <rect x="44" y="78" width="180" height="150" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="134" y="104" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>平时的书架格子</text>
      {before.map((item) => (
        <g key={item.label}>
          <rect x={item.x} y={item.y} width="140" height="30" rx="5" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1" />
          <text x={item.x + 70} y={item.y + 20} textAnchor="middle" fontSize="13" fill={SOFT}>{item.label}</text>
        </g>
      ))}

      <rect x="438" y="70" width="190" height="174" rx="10" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="533" y="94" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>外来的资料箱</text>
      {device.map((item) => (
        <g key={item.label}>
          <rect x={item.x} y={item.y} width="126" height="30" rx="5" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1" />
          <text x={item.x + 63} y={item.y + 20} textAnchor="middle" fontSize="13.5" fill={INK}>{item.label}</text>
        </g>
      ))}

      <path d="M 228 152 C 280 118, 356 118, 432 138" fill="none" stroke={AZURE} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M 420 131 L 434 138 L 419 145" fill="none" stroke={AZURE} strokeWidth="2.2" strokeLinecap="round" />
      <text x="330" y="108" textAnchor="middle" fontSize="13" fill={JADE_INK}>接上:借这个位置看那边</text>

      <rect x="260" y="182" width="160" height="48" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="340" y="203" textAnchor="middle" fontSize="13" fill={INK}>拿走以后</text>
      <text x="340" y="220" textAnchor="middle" fontSize="13" fill={SOFT}>原来的格子又露出来</text>

      <path d="M 278 246 Q 350 270 424 246" fill="none" stroke={CINNABAR} strokeWidth="1.5" strokeDasharray="5 5" strokeLinecap="round" />
      <text x="350" y="286" textAnchor="middle" fontSize="13" fill={CINNABAR}>坑:不是复制进来了</text>
      <text x="360" y="306" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        看到的是外来那柜资料;柜子搬走,这个位置恢复原样
      </text>
    </svg>
  );
}

/** 图二:硬软链接对照 —— 同一本书的名字牌,与一张地址纸条 */
export function FsLinkCardsSvg({ className }: { className?: string }) {
  const tags = [
    { y: 118, label: '名字牌 A' },
    { y: 166, label: '名字牌 B' },
  ];
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:左边两块名字牌都连到同一本书,表示硬链接;右边是一张写着去另一格找书的纸条,表示软链接。朱砂标注的坑:别把两者都当快捷方式"
      className={className}
    >
      <text x="360" y="32" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        名字牌 vs 地址纸条
      </text>

      <text x="178" y="72" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        两块名字牌,同一本书
      </text>
      {tags.map((tag) => (
        <g key={tag.label}>
          <rect x="58" y={tag.y} width="120" height="34" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x="118" y={tag.y + 22} textAnchor="middle" fontSize="13.5" fill={INK}>{tag.label}</text>
          <path
            d={`M 180 ${tag.y + 17} C 230 ${tag.y + 8}, 255 156, 304 156`}
            fill="none"
            stroke={AZURE}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </g>
      ))}
      <rect x="306" y="118" width="112" height="76" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="362" y="148" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>同一本书</text>
      <text x="362" y="169" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>少一块牌</text>
      <text x="362" y="186" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>书还在</text>

      <line x1="448" y1="78" x2="448" y2="238" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 5" />

      <text x="570" y="72" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
        一张写地址的纸条
      </text>
      <rect x="505" y="112" width="138" height="86" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.3" />
      <text x="574" y="140" textAnchor="middle" fontSize="13" fill={INK}>去另一格找</text>
      <text x="574" y="160" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={SOFT}>../book/a</text>
      <text x="574" y="181" textAnchor="middle" fontSize="12.5" fill={SOFT}>地址错了就空</text>

      <path d="M 526 210 C 590 236, 632 234, 654 204" fill="none" stroke={CINNABAR} strokeWidth="1.5" strokeDasharray="5 5" />
      <text x="592" y="260" textAnchor="middle" fontSize="13" fill={CINNABAR}>坑:别都当快捷方式</text>

      <text x="360" y="302" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        左边是多一个名字;右边是多一张去找别人的提示纸
      </text>
    </svg>
  );
}
