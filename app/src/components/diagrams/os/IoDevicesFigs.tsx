/**
 * 输入/输出设备(《操作系统原理》第 22 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/ioDevices.ts 的 microLecture 咬合:
 * 图一「小窗口不是普通格子」——中间那颗大脑只能按状态/数据/命令三个窗口同外面握手;
 * 朱砂只标「把窗口当普通格子随便写」这个坑。
 * 图二「大包交给搬运工,程序走统一柜台」——搬运工拿派工单搬大包,普通程序从统一柜台办事;
 * 朱砂只标「统一入口不等于复杂性消失」这个坑。
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

/** 图一:小窗口不是普通格子 —— 看状态、递纸条、按按钮,再等外面回应 */
export function IoWindowsSvg({ className }: { className?: string }) {
  const windows = [
    { y: 92, label: '忙不忙', hint: '先看灯', fill: INK_WASH },
    { y: 152, label: '递纸条', hint: '放内容', fill: PAPER_WARM },
    { y: 212, label: '按按钮', hint: '请开工', fill: AZURE_WASH },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:中间那颗大脑通过三个小窗口和外面的机器说话,先看忙不忙,再递纸条,再按按钮;朱砂标注的坑是不要把这些窗口当普通格子随便写"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        不是抽屉,是小窗口和门铃
      </text>

      <rect x="52" y="108" width="128" height="102" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="116" y="150" textAnchor="middle" fontSize="16" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        中间大脑
      </text>
      <text x="116" y="176" textAnchor="middle" fontSize="12.5" fill={AZURE_DEEP}>
        按说明书办
      </text>

      <rect x="286" y="70" width="152" height="198" rx="10" fill="none" stroke={PAPER_EDGE} strokeWidth="1.5" strokeDasharray="5 5" />
      <text x="362" y="62" textAnchor="middle" fontSize="13" fill={SOFT}>
        露出来的三个窗口
      </text>
      {windows.map((w) => (
        <g key={w.label}>
          <rect x="304" y={w.y} width="116" height="42" rx="7" fill={w.fill} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x="362" y={w.y + 18} textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>
            {w.label}
          </text>
          <text x="362" y={w.y + 34} textAnchor="middle" fontSize="11.5" fill={SOFT}>
            {w.hint}
          </text>
        </g>
      ))}

      <rect x="544" y="100" width="116" height="116" rx="12" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="602" y="142" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        外面的机器
      </text>
      <text x="602" y="166" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        灯、键、纸、相机
      </text>

      <path d="M 180 150 C 230 112, 252 102, 304 108" fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round" strokeDasharray="4 5" />
      <path d="M 180 160 C 236 160, 250 168, 304 172" fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 180 172 C 232 220, 252 232, 304 234" fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round" strokeDasharray="4 5" />
      <path d="M 420 172 C 474 154, 494 150, 544 152" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M 536 146 L 548 152 L 536 158" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />

      <path
        d="M 294 282 Q 364 300 430 280"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.5"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="362" y="305" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:别当普通格子随便写
      </text>
      <text x="360" y="322" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        看灯、递纸条、按按钮,顺序乱了就会出事
      </text>
    </svg>
  );
}

/** 图二:大包交给搬运工,程序走统一柜台 —— 统一入口背后仍有不同专人和说明书 */
export function IoDeskAndMoverSvg({ className }: { className?: string }) {
  const desks = [
    { x: 430, y: 72, label: '打印专人' },
    { x: 430, y: 132, label: '相机专人' },
    { x: 430, y: 192, label: '画图专人' },
  ];
  const parcels = [
    { x: 96, y: 226 },
    { x: 132, y: 226 },
    { x: 168, y: 226 },
  ];
  return (
    <svg
      viewBox="0 0 760 340"
      width="100%"
      role="img"
      aria-label="示意图:普通程序从统一柜台交请求,柜台后面分别找打印、相机、画图专人;大包数据交给搬运工按派工单搬。朱砂标注的坑是统一入口不等于复杂性消失"
      className={className}
    >
      <text x="380" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        大包交给搬运工,办事走统一柜台
      </text>

      <rect x="58" y="76" width="126" height="70" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="121" y="106" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        普通程序
      </text>
      <text x="121" y="128" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>
        只到柜台办事
      </text>

      <rect x="262" y="74" width="120" height="78" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.6" />
      <text x="322" y="106" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        统一柜台
      </text>
      <text x="322" y="128" textAnchor="middle" fontSize="12" fill={SOFT}>
        收请求,找专人
      </text>

      <path d="M 184 112 C 214 110, 232 110, 262 112" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M 252 106 L 264 112 L 252 118" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />

      {desks.map((d) => (
        <g key={d.label}>
          <rect x={d.x} y={d.y} width="112" height="40" rx="7" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={d.x + 56} y={d.y + 25} textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>
            {d.label}
          </text>
          <path d={`M 382 112 C 402 ${d.y + 20}, 410 ${d.y + 20}, 430 ${d.y + 20}`} fill="none" stroke={FAINT} strokeWidth="1.2" strokeLinecap="round" strokeDasharray="4 5" />
        </g>
      ))}

      <rect x="588" y="92" width="116" height="118" rx="12" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.5" />
      <text x="646" y="130" textAnchor="middle" fontSize="14.5" fontFamily={DISPLAY} fill={INK}>
        各种外物
      </text>
      <text x="646" y="154" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        纸张、镜头、画面
      </text>
      <text x="646" y="176" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        规矩各不相同
      </text>
      <path d="M 542 152 C 560 152, 570 152, 588 152" fill="none" stroke={FAINT} strokeWidth="1.3" strokeLinecap="round" />

      <rect x="82" y="248" width="130" height="48" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="147" y="278" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>
        一堆大包
      </text>
      {parcels.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width="24" height="18" rx="3" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1" />
      ))}

      <rect x="302" y="236" width="118" height="72" rx="10" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="361" y="266" textAnchor="middle" fontSize="14.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        搬运工
      </text>
      <text x="361" y="288" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>
        拿派工单搬
      </text>
      <path d="M 212 272 C 246 272, 270 272, 302 272" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M 292 266 L 304 272 L 292 278" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M 420 272 C 482 250, 536 238, 602 214" fill="none" stroke={JADE_INK} strokeWidth="1.7" strokeLinecap="round" strokeDasharray="6 5" />
      <text x="514" y="256" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        搬完要回报
      </text>

      <path
        d="M 258 170 Q 448 226 650 224"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.5"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <text x="476" y="236" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:统一入口不等于复杂性消失
      </text>
      <text x="380" y="326" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        柜台统一了,后面的专人和说明书还在
      </text>
    </svg>
  );
}
