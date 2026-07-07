/**
 * 链接和加载 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/linking.ts 的 microLecture 咬合:
 * 图一讲"链接 = 拼接 + 对上号 + 填地址":两块半成品拼起来还不够,空着的地址必须填上,
 *   朱砂只标坑——"光拼不填,跳过去是一片荒地"(对应误区 M1);
 * 图二讲"程序不是第一个上场的":内核先请装载员(ld.so)上场装共用的库、认领名字,
 *   最后才交棒给程序;朱砂标坑——"以为一上来就跑程序自己"(对应 c4/M3 的插队规则)。
 * 图内文字全用生活语言,专业名词不出现(与小白面前的泄漏纪律同一口径)。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const AZURE_DEEP = 'var(--azure-deep)';
const AZURE_WASH = 'var(--azure-wash)';
const JADE = 'var(--jade)';
const JADE_INK = 'var(--jade-ink)';
const CINNABAR = 'var(--cinnabar)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:拼起来还不够——名字对上号,空着的地址填上 */
export function LinkFillSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:两块半成品拼在一起,左边那块里还有一个空着的地址;拼装工先把名字对上号,再把空位填成真地址,程序才能跑;朱砂标注:光拼不填,跳过去是一片荒地"
      className={className}
    >
      <defs>
        <marker id="lk1-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
        <marker id="lk1-bad" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        拼起来还不够:名字要对上号,空着的地址要填上
      </text>

      {/* 左:半成品甲(有个空洞) */}
      <g transform="rotate(-1 130 150)">
        <rect x="46" y="66" width="168" height="130" rx="8" fill={PAPER_WARM} stroke={INK} strokeWidth="1.4" />
        <text x="130" y="90" textAnchor="middle" fontSize="13" fill={SOFT}>半成品甲(主程序)</text>
        <text x="130" y="118" textAnchor="middle" fontSize="13" fontFamily={CODE} fill={INK}>……</text>
        <rect x="66" y="130" width="128" height="30" rx="5" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="5 4" />
        <text x="130" y="150" textAnchor="middle" fontSize="12" fill={CINNABAR}>去找「加法」→ ____</text>
        <text x="130" y="184" textAnchor="middle" fontSize="12" fill={FAINT}>地址还空着,先欠着账</text>
      </g>

      {/* 右:半成品乙(有定义) */}
      <g transform="rotate(1.2 130 150)">
        <rect x="46" y="212" width="168" height="72" rx="8" fill={PAPER_WARM} stroke={INK} strokeWidth="1.4" />
        <text x="130" y="236" textAnchor="middle" fontSize="13" fill={SOFT}>半成品乙(工具箱)</text>
        <rect x="66" y="246" width="128" height="26" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.2" />
        <text x="130" y="264" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>「加法」的正身在这</text>
      </g>

      {/* 中:拼装工两道工序 */}
      <path d="M 226 150 Q 268 150 300 150" fill="none" stroke={AZURE} strokeWidth="2" markerEnd="url(#lk1-arrow)" />
      <path d="M 226 244 Q 268 232 300 190" fill="none" stroke={AZURE} strokeWidth="2" markerEnd="url(#lk1-arrow)" />
      <g transform="rotate(-0.6 372 168)">
        <rect x="308" y="118" width="130" height="100" rx="10" fill="none" stroke={JADE} strokeWidth="1.6" />
        <text x="373" y="146" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={JADE_INK}>拼装工</text>
        <text x="373" y="172" textAnchor="middle" fontSize="12" fill={JADE_INK}>① 名字对上号</text>
        <text x="373" y="196" textAnchor="middle" fontSize="12" fill={JADE_INK}>② 空位填真地址</text>
      </g>

      {/* 右:成品 */}
      <path d="M 442 168 Q 476 168 506 168" fill="none" stroke={AZURE} strokeWidth="2" markerEnd="url(#lk1-arrow)" />
      <g transform="rotate(0.8 600 168)">
        <rect x="514" y="96" width="172" height="150" rx="8" fill={PAPER_WARM} stroke={INK} strokeWidth="1.6" />
        <text x="600" y="122" textAnchor="middle" fontSize="13" fill={SOFT}>拼好的完整程序</text>
        <rect x="534" y="136" width="132" height="28" rx="5" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.2" />
        <text x="600" y="155" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>去找「加法」→ 已填上</text>
        <rect x="534" y="176" width="132" height="28" rx="5" fill="none" stroke={PAPER_EDGE} strokeWidth="1.2" />
        <text x="600" y="195" textAnchor="middle" fontSize="12" fill={INK}>「加法」的正身</text>
        <text x="600" y="230" textAnchor="middle" fontSize="12" fill={JADE_INK}>跳转条条有着落 ✓</text>
      </g>

      {/* 朱砂坑标注 */}
      <path d="M 196 296 Q 150 288 138 206" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="4 4" markerEnd="url(#lk1-bad)" />
      <text x="206" y="300" fontSize="13" fill={CINNABAR}>坑:光拼不填,跳过去是一片荒地</text>
    </svg>
  );
}

/** 图二:程序不是第一个上场的——装载员先装库、认领名字,再交棒 */
export function LoadChainSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:按下运行后,内核先请装载员上场,装载员把要共用的库一件件搬进屋、把名字认领好,最后才把接力棒交给程序;朱砂标注:别以为一上来就跑程序自己"
      className={className}
    >
      <defs>
        <marker id="lk2-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
        <marker id="lk2-bad" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        按下运行之后:你的程序,排在接力的最后一棒
      </text>

      {/* 第一棒:按下运行 / 内核 */}
      <g transform="rotate(-1 110 150)">
        <rect x="42" y="108" width="136" height="84" rx="10" fill={PAPER_WARM} stroke={INK} strokeWidth="1.4" />
        <text x="110" y="138" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={INK}>按下运行</text>
        <text x="110" y="162" textAnchor="middle" fontSize="12" fill={SOFT}>内核读文件开头:</text>
        <text x="110" y="180" textAnchor="middle" fontSize="12" fill={SOFT}>「先请装载员」</text>
      </g>
      <path d="M 182 150 Q 212 146 240 150" fill="none" stroke={AZURE} strokeWidth="2" markerEnd="url(#lk2-arrow)" />

      {/* 第二棒:装载员 */}
      <g transform="rotate(0.8 330 150)">
        <rect x="248" y="88" width="164" height="124" rx="10" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
        <text x="330" y="116" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={AZURE_DEEP}>装载员先上场</text>
        <text x="330" y="142" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>把共用的库一件件搬进屋</text>
        <text x="330" y="164" textAnchor="middle" fontSize="12" fill={AZURE_DEEP}>把还没着落的名字认领好</text>
        <text x="330" y="192" textAnchor="middle" fontSize="12" fill={SOFT}>规矩:谁先进门,谁先认领</text>
      </g>
      <path d="M 416 150 Q 448 146 478 150" fill="none" stroke={AZURE} strokeWidth="2" markerEnd="url(#lk2-arrow)" />

      {/* 第三棒:程序开跑 */}
      <g transform="rotate(-0.7 590 150)">
        <rect x="486" y="108" width="196" height="84" rx="10" fill={PAPER_WARM} stroke={INK} strokeWidth="1.4" />
        <text x="584" y="138" textAnchor="middle" fontSize="13" fontFamily={DISPLAY} fill={INK}>最后才轮到程序</text>
        <text x="584" y="162" textAnchor="middle" fontSize="12" fill={SOFT}>库全就位、名字全有主,</text>
        <text x="584" y="180" textAnchor="middle" fontSize="12" fill={SOFT}>接过接力棒,正式开跑</text>
      </g>

      {/* 插队小人(顺带交代"插队认领"的规矩) */}
      <g transform="rotate(1 330 262)">
        <rect x="252" y="240" width="156" height="44" rx="8" fill="none" stroke={JADE} strokeWidth="1.4" strokeDasharray="6 4" />
        <text x="330" y="258" textAnchor="middle" fontSize="12" fill={JADE_INK}>想换个函数?让自家小库</text>
        <text x="330" y="276" textAnchor="middle" fontSize="12" fill={JADE_INK}>插队先进门,抢先认领名字</text>
      </g>
      <path d="M 330 238 Q 330 226 330 216" fill="none" stroke={JADE} strokeWidth="1.4" strokeDasharray="4 3" markerEnd="url(#lk2-arrow)" />

      {/* 朱砂坑标注:指向第三棒 */}
      <path d="M 508 66 Q 540 78 560 102" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="4 4" markerEnd="url(#lk2-bad)" />
      <text x="500" y="60" textAnchor="end" fontSize="13" fill={CINNABAR}>坑:以为一按运行,第一步跑的就是程序自己</text>
    </svg>
  );
}
