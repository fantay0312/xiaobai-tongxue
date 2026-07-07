/**
 * 计算机系统安全(《操作系统原理》第 28 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/security.ts 的 microLecture 咬合:
 * 图一「安全要三样一起守」——保密/完整/可用,缺一根柱子房子就塌;
 *   朱砂只标「只顾守一样,另两样照样能出事」这个坑(对应 c1 三要素)。
 * 图二「一个 bug 就翻墙」——固定大小的缓冲区被超长输入灌满,多出来的部分
 *   把栈上的返回地址覆盖成坏地址,函数一返回就跳去执行坏人的代码;
 *   朱砂只标「以为门锁好就安全,返回地址被覆盖了」这个坑(对应 c3 缓冲区溢出)。
 * 内容红线:图二不画"必然被利用",只画"没有 ASLR/Canary 等保护时"这条路径成立(正文留分寸)。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
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

/** 图一:安全三要素 —— 三根柱子撑一个"安全",朱砂标「只守一样也不够」的坑 */
export function SecCiaTriadSvg({ className }: { className?: string }) {
  const pillars = [
    { x: 96, label: '保密', sub: '不该看的看不到' },
    { x: 300, label: '完整', sub: '不该改的改不了' },
    { x: 504, label: '可用', sub: '想用时用得上' },
  ];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:一个写着「安全」的横梁,下面由保密、完整、可用三根柱子撑着——保密是不该看的看不到,完整是不该改的改不了,可用是想用时用得上。朱砂标注的坑:只守住其中一根,另外两样照样能出事,房子一样会塌"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        安全,要三样一起守——缺一根柱子,房子就塌
      </text>

      {/* 横梁:安全 */}
      <rect x="80" y="56" width="560" height="42" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="360" y="83" textAnchor="middle" fontSize="17" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        安　全
      </text>

      {/* 三根柱子 */}
      {pillars.map((p) => (
        <g key={p.label}>
          <line x1={p.x + 60} y1="98" x2={p.x + 60} y2="128" stroke={PAPER_EDGE} strokeWidth="1.2" strokeDasharray="3 4" strokeLinecap="round" />
          <rect x={p.x} y="130" width="120" height="120" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.4" />
          <text x={p.x + 60} y="176" textAnchor="middle" fontSize="20" fontFamily={DISPLAY} fill={INK}>
            {p.label}
          </text>
          <text x={p.x + 60} y="210" textAnchor="middle" fontSize="12.5" fill={SOFT}>
            {p.sub}
          </text>
        </g>
      ))}

      {/* 地面 */}
      <line x1="70" y1="250" x2="650" y2="250" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" />

      {/* 坑:朱砂圈住"完整"这根柱子,示意只守保密还不够 */}
      <path
        d="M 296 126 Q 360 112 428 126"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <line x1="300" y1="130" x2="420" y2="250" stroke={CINNABAR} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.75" />
      <line x1="420" y1="130" x2="300" y2="250" stroke={CINNABAR} strokeWidth="1.2" strokeDasharray="4 5" opacity="0.75" />
      <text x="360" y="284" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:只顾守住"保密",
      </text>
      <text x="360" y="302" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        别人把它改了、或搞到你用不了,照样不安全
      </text>

      <text x="360" y="326" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>
        改成绩=毁完整;一行 fork bomb 卡死机器=毁可用
      </text>
    </svg>
  );
}

/** 图二:缓冲区溢出 —— 超长输入覆盖返回地址,朱砂标「门锁好也没用」的坑 */
export function SecOverflowSvg({ className }: { className?: string }) {
  // 栈上一排格子:前 4 格是 buf(留 4 个位置),第 5 格是返回地址
  const cells = [
    { x: 70, label: 'buf', fill: PAPER_WARM },
    { x: 158, label: 'buf', fill: PAPER_WARM },
    { x: 246, label: 'buf', fill: PAPER_WARM },
    { x: 334, label: 'buf', fill: PAPER_WARM },
    { x: 440, label: '返回地址', fill: INK_WASH, ret: true },
  ];
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:栈上一排格子,前四格是缓冲区 buf 只留了固定大小,第五格保存函数的返回地址。正常短输入稳稳放进 buf;超长的恶意输入灌满 buf 后继续往下写,把返回地址覆盖成一个坏地址,函数一返回就跳去执行坏人的代码,绕过了所有权限。朱砂标注的坑:以为门锁好就安全,返回地址被覆盖后权限形同虚设"
      className={className}
    >
      <text x="360" y="28" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一个 bug 就翻墙:超长输入,冲掉了"回家的地址"
      </text>

      {/* 正常输入 */}
      <text x="70" y="66" fontSize="13" fill={JADE_INK}>正常输入 "hi" → 稳稳放进 buf,不越界</text>

      {/* 栈格子 */}
      {cells.map((c, i) => (
        <g key={i}>
          <rect x={c.x} y="86" width={c.ret ? 150 : 84} height="52" rx="6" fill={c.fill} stroke={c.ret ? INK : PAPER_EDGE} strokeWidth={c.ret ? 2 : 1.2} />
          <text x={c.x + (c.ret ? 75 : 42)} y="117" textAnchor="middle" fontSize={c.ret ? 15 : 14} fontFamily={c.ret ? DISPLAY : CODE} fill={INK}>
            {c.label}
          </text>
        </g>
      ))}
      <text x="196" y="160" textAnchor="middle" fontSize="12.5" fill={SOFT}>← 固定大小的缓冲区(只留这么点位置)</text>
      <text x="515" y="160" textAnchor="middle" fontSize="12.5" fill={SOFT}>↑ 函数"回家"要看的地址</text>

      {/* 超长恶意输入:一条朱砂长条从 buf 冲进返回地址 */}
      <path
        d="M 74 198 L 560 198"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.28"
      />
      <text x="74" y="202" fontSize="12.5" fontFamily={CODE} fill={CINNABAR}>
        "AAAAAAAAAAAAAAAA……(超长)……+ 坏地址"
      </text>
      <path d="M 552 190 L 566 198 L 552 206" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />

      {/* 覆盖箭头:从溢出条指向返回地址格子 */}
      <line x1="500" y1="186" x2="500" y2="142" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="5 4" strokeLinecap="round" />
      <text x="360" y="230" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:buf 塞满后继续往下写,把"返回地址"覆盖成坏地址
      </text>

      {/* 结果:跳去坏代码 */}
      <rect x="250" y="252" width="220" height="40" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.6" />
      <text x="360" y="277" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        函数一 return → 跳去执行坏人的代码
      </text>
      <line x1="500" y1="210" x2="430" y2="250" stroke={SOFT} strokeWidth="1.4" strokeDasharray="4 4" strokeLinecap="round" />

      <text x="360" y="314" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        权限设得再严也白搭——坏人没走正门,是从墙洞翻进来的
      </text>
      <text x="360" y="332" textAnchor="middle" fontSize="12" fill={JADE_INK}>
        分寸:这条路成立的前提是没有 ASLR / Canary / NX 等保护;它们只让翻墙更难,不能根除
      </text>
    </svg>
  );
}
