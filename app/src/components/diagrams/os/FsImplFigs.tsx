/**
 * 文件系统实现(《操作系统原理》第 26 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/fsImpl.ts 的 microLecture 咬合:
 * 图一「硬盘是格子账本」——先看封面目录,小盘可用接力表,UNIX 式做法把门牌和身份证分开;
 * 朱砂只标「改一点不等于只动一点」这个坑。
 * 图二「断电怕半张账」——追加一段内容要改多张账,先写小票再改正式账本;
 * 朱砂只标「只改了一半」这个坑,不承诺新写入内容一定保住。
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

/** 图一:硬盘是格子账本 —— 封面目录、接力表、身份证分工 */
export function FsImplBlocksSvg({ className }: { className?: string }) {
  const blocks = [
    { x: 48, w: 86, label: '封面目录', fill: AZURE_WASH, stroke: AZURE, text: AZURE_DEEP },
    { x: 146, w: 70, label: '占用表', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { x: 228, w: 70, label: '身份证', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { x: 310, w: 70, label: '目录页', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK },
    { x: 392, w: 70, label: '内容', fill: INK_WASH, stroke: PAPER_EDGE, text: INK },
    { x: 474, w: 70, label: '内容', fill: INK_WASH, stroke: PAPER_EDGE, text: INK },
    { x: 556, w: 70, label: '内容', fill: INK_WASH, stroke: PAPER_EDGE, text: INK },
  ];
  const chain = [
    { x: 96, y: 220, next: '19' },
    { x: 182, y: 220, next: '42' },
    { x: 268, y: 220, next: '结尾' },
  ];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:硬盘像一排固定格子的账本,开头有封面目录;小盘用接力表记录下一段,另一边用身份证和目录页分开记录文件本人和名字。朱砂标注的坑:改一点不等于只动一点"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        硬盘不是散沙,是一格一格的账本
      </text>

      {blocks.map((b) => (
        <g key={`${b.label}-${b.x}`}>
          <rect x={b.x} y="62" width={b.w} height="48" rx="6" fill={b.fill} stroke={b.stroke} strokeWidth="1.4" />
          <text x={b.x + b.w / 2} y="91" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={b.text}>
            {b.label}
          </text>
        </g>
      ))}
      <path d="M 48 124 L 626 124" fill="none" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 5" strokeLinecap="round" />
      <text x="360" y="145" textAnchor="middle" fontSize="13" fill={SOFT}>
        先看封面目录,才知道整本账从哪里读、哪里还有空位
      </text>

      <path
        d="M 392 54 Q 485 34 626 52"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="634" y="38" fontSize="12.5" fill={CINNABAR}>坑:改一点</text>
      <text x="634" y="56" fontSize="12.5" fill={CINNABAR}>不等于只动一点</text>

      <text x="96" y="188" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>接力表</text>
      {chain.map((c, i) => (
        <g key={c.next}>
          <rect x={c.x - 34} y={c.y - 20} width="68" height="40" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize="13" fontFamily={CODE} fill={INK}>
            下一段 {c.next}
          </text>
          {i < chain.length - 1 ? (
            <path d={`M ${c.x + 34} ${c.y} C ${c.x + 50} ${c.y - 18}, ${c.x + 66} ${c.y - 18}, ${c.x + 86} ${c.y}`} fill="none" stroke={AZURE} strokeWidth="1.4" strokeLinecap="round" />
          ) : null}
        </g>
      ))}
      <text x="180" y="266" textAnchor="middle" fontSize="13" fill={SOFT}>
        一张纸条接一张纸条,碎了就得一路追
      </text>

      <text x="500" y="188" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>门牌和身份证分开</text>
      <rect x="396" y="204" width="98" height="42" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="445" y="230" textAnchor="middle" fontSize="13.5" fill={INK}>名字 → 编号</text>
      <rect x="528" y="204" width="108" height="42" rx="6" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.4" />
      <text x="582" y="230" textAnchor="middle" fontSize="13.5" fill={AZURE_DEEP}>大小/位置/权限</text>
      <path d="M 494 225 C 510 210, 516 210, 528 225" fill="none" stroke={JADE_INK} strokeWidth="1.4" strokeLinecap="round" />
      <text x="516" y="266" textAnchor="middle" fontSize="13" fill={SOFT}>
        名字只是门牌,文件本人另有身份证
      </text>
      <text x="360" y="314" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        结构不同,目的相同:让内容找得到、改得动,还尽量少绕路
      </text>
    </svg>
  );
}

/** 图二:断电怕半张账 —— 多处更新与先写小票 */
export function FsImplCrashLogSvg({ className }: { className?: string }) {
  const ledgers = [
    { x: 70, y: 88, label: '新内容', detail: '写一格内容', fill: INK_WASH, stroke: PAPER_EDGE },
    { x: 260, y: 88, label: '占用记录', detail: '这格已被用', fill: PAPER_WARM, stroke: PAPER_EDGE },
    { x: 450, y: 88, label: '文件记录', detail: '大小和位置', fill: PAPER_WARM, stroke: PAPER_EDGE },
  ];
  const tickets = ['我要改三处', '确认小票放稳', '完整就重做'];
  return (
    <svg
      viewBox="0 0 720 360"
      width="100%"
      role="img"
      aria-label="示意图:追加内容时要改新内容、占用记录、文件记录三张账;断电可能只改一半。旁边先写小票,重启后小票完整就按它重做,不完整就当没发生"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        断电最怕半张账,所以先写小票
      </text>

      {ledgers.map((l) => (
        <g key={l.label}>
          <rect x={l.x} y={l.y} width="130" height="74" rx="8" fill={l.fill} stroke={l.stroke} strokeWidth="1.4" />
          <text x={l.x + 65} y={l.y + 30} textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
            {l.label}
          </text>
          <text x={l.x + 65} y={l.y + 54} textAnchor="middle" fontSize="12.5" fill={SOFT}>
            {l.detail}
          </text>
        </g>
      ))}
      <path d="M 200 125 C 222 108, 238 108, 260 125" fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 390 125 C 412 108, 428 108, 450 125" fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round" />

      <line x1="380" y1="58" x2="380" y2="178" stroke={CINNABAR} strokeWidth="1.5" strokeDasharray="6 4" strokeLinecap="round" />
      <text x="380" y="198" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:只改了一半</text>
      <text x="380" y="216" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>账本互相打架</text>

      <rect x="96" y="248" width="180" height="56" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.5" />
      <text x="186" y="272" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        旁边先写小票
      </text>
      <text x="186" y="292" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>
        不直接先改正式账本
      </text>

      {tickets.map((t, i) => (
        <g key={t}>
          <rect x={326 + i * 104} y="250" width="86" height="52" rx="6" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={369 + i * 104} y="281" textAnchor="middle" fontSize="12.5" fill={INK}>
            {t}
          </text>
          {i < tickets.length - 1 ? (
            <path d={`M ${412 + i * 104} 276 L ${426 + i * 104} 276`} fill="none" stroke={JADE_INK} strokeWidth="1.5" strokeLinecap="round" />
          ) : null}
        </g>
      ))}

      <path d="M 276 276 C 296 250, 306 250, 326 276" fill="none" stroke={JADE_INK} strokeWidth="1.5" strokeLinecap="round" />
      <text x="360" y="334" textAnchor="middle" fontSize="13.5" fill={SOFT}>
        小票完整就照着重做,小票不完整就当没发生;结构保住,新内容仍要看是否放稳
      </text>
    </svg>
  );
}
