/**
 * 可变默认参数 —— 手绘教学示意图(纯 SVG,时间线图)。
 * 口径与 data/topics/mutableDefault.ts 的 microLecture 咬合:
 * 「默认值只在 def 执行那一刻求值一次」——时间线三事件:def 创建唯一列表 →
 * add(1) 省略参数用它 → add(2) 还用它(上次的 1 还在,朱砂标坑)。
 * 三条虚线都汇向同一个列表盒,视觉上钉死「自始至终同一个对象」。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const JADE_INK = 'var(--jade-ink)';
const CINNABAR = 'var(--cinnabar)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:默认值只求值一次的时间线 */
export function MdTimelineSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="时间线示意图:def add(x, lst=[]) 执行那一刻创建唯一的默认列表;之后 add(1)、add(2) 两次省略参数的调用用的都是同一个列表,第二次调用时上一次 append 的 1 还躺在里面"
      className={className}
    >
      <defs>
        <marker id="md1-axis" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </marker>
        <marker id="md1-ref" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 同一个列表(函数对象上挂着的默认值) */}
      <rect x="210" y="48" width="220" height="66" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="320" y="74" textAnchor="middle" fontSize="14" fill={AZURE_DEEP}>挂在函数对象上的默认列表</text>
      <text x="320" y="100" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>[] → [1] → [1, 2]</text>

      {/* 坑:add(2) 拿到的不是新列表 */}
      <g transform="rotate(-6 494 60)">
        <rect x="482" y="48" width="24" height="24" fill="none" stroke={CINNABAR} strokeWidth="2" />
        <text x="494" y="66" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑</text>
      </g>
      <text x="518" y="60" fontSize="14" fill={INK}>add(2) 拿到的不是新列表</text>
      <text x="518" y="82" fontSize="13" fill={SOFT}>上次 append 的 1 还躺在里面</text>

      {/* 时间线 */}
      <line x1="50" y1="218" x2="690" y2="218" stroke={INK} strokeWidth="1.5" markerEnd="url(#md1-axis)" />
      {[150, 380, 580].map((x) => (
        <line key={x} x1={x} y1="212" x2={x} y2="224" stroke={INK} strokeWidth="1.5" />
      ))}

      {/* 事件:def */}
      <text x="150" y="246" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>def add(x, lst=[])</text>
      <text x="150" y="268" textAnchor="middle" fontSize="13" fill={AZURE}>定义那一刻:求值一次</text>
      <path d="M 150 206 Q 168 150 236 118" fill="none" stroke={AZURE} strokeWidth="1.4" strokeDasharray="5 4" markerEnd="url(#md1-ref)" />
      <text x="196" y="152" textAnchor="middle" fontSize="13" fill={AZURE}>此刻创建</text>

      {/* 事件:add(1) */}
      <text x="380" y="246" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>add(1)</text>
      <text x="380" y="268" textAnchor="middle" fontSize="13" fill={SOFT}>没传 lst,用那份现成的</text>
      <line x1="380" y1="206" x2="380" y2="122" stroke={AZURE} strokeWidth="1.4" strokeDasharray="5 4" markerEnd="url(#md1-ref)" />
      <text x="394" y="168" fontSize="13" fill={SOFT}>用它</text>

      {/* 事件:add(2) */}
      <text x="580" y="246" textAnchor="middle" fontSize="14" fontFamily={CODE} fill={INK}>add(2)</text>
      <text x="580" y="268" textAnchor="middle" fontSize="13" fill={SOFT}>还是那份,不会重置</text>
      <path d="M 580 206 Q 556 150 438 108" fill="none" stroke={AZURE} strokeWidth="1.4" strokeDasharray="5 4" markerEnd="url(#md1-ref)" />
      <text x="540" y="150" fontSize="13" fill={SOFT}>还用它</text>

      {/* 底注:证据与解法 */}
      <text x="50" y="292" fontSize="13" fill={FAINT}>三次拿到的 id 完全相同——同一个对象</text>
      <text x="690" y="292" textAnchor="end" fontSize="13" fill={JADE_INK}>惯用解法:默认写 None,进函数再现建新列表</text>
    </svg>
  );
}
