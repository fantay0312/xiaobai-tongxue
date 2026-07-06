/**
 * 浅拷贝与深拷贝 —— 手绘教学示意图(纯 SVG,内存指针图)。
 * 口径与 data/topics/shallowCopy.ts 的 microLecture 咬合:
 * 「赋值贴名字,浅拷贝换外壳」——b = a.copy() 之后外层各一份,
 * 里层子列表仍是同一个对象,两个外壳的第 0 格都指向它(引用共享)。
 * 朱砂只标「同一个子列表,改一边另一边跟着变」这个最高频的坑。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const AZURE = 'var(--azure)';
const JADE_INK = 'var(--jade-ink)';
const CINNABAR = 'var(--cinnabar)';
const CINNABAR_WASH = 'var(--cinnabar-wash)';
const PAPER_WARM = 'var(--paper-warm)';
const INK_WASH = 'var(--ink-wash)';
const CODE = 'var(--font-code)';

/** 图一:浅拷贝的内存图——新外壳,同一份里层 */
export function ScPointerSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="内存示意图:b = a.copy() 之后,a 和 b 各有一个外层列表,但两个外层的第 0 格都指向同一个子列表 [1, 2]——改一边,另一边跟着变"
      className={className}
    >
      <defs>
        <marker id="sc1-name" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
        </marker>
        <marker id="sc1-ref" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 代码题干 */}
      <rect x="30" y="26" width="300" height="30" rx="5" fill={INK_WASH} />
      <text x="46" y="46" fontSize="14" fontFamily={CODE} fill={INK}>a = [[1, 2], 3];  b = a.copy()</text>

      {/* 名字牌 a / b */}
      <rect x="40" y="110" width="44" height="32" rx="5" fill={PAPER_WARM} stroke={SOFT} strokeWidth="1.2" />
      <text x="62" y="131" textAnchor="middle" fontSize="15" fontFamily={CODE} fill={INK}>a</text>
      <rect x="40" y="210" width="44" height="32" rx="5" fill={PAPER_WARM} stroke={SOFT} strokeWidth="1.2" />
      <text x="62" y="231" textAnchor="middle" fontSize="15" fontFamily={CODE} fill={INK}>b</text>
      <line x1="88" y1="126" x2="144" y2="126" stroke={SOFT} strokeWidth="1.4" markerEnd="url(#sc1-name)" strokeLinecap="round" />
      <line x1="88" y1="226" x2="144" y2="226" stroke={SOFT} strokeWidth="1.4" markerEnd="url(#sc1-name)" strokeLinecap="round" />

      {/* 外层列表 a(原来那份) */}
      <text x="150" y="90" fontSize="13" fill={SOFT}>a 的外壳(原来那份)</text>
      <rect x="150" y="98" width="190" height="56" rx="6" fill="none" stroke={AZURE} strokeWidth="1.5" />
      <line x1="245" y1="98" x2="245" y2="154" stroke={AZURE} strokeWidth="1" />
      <circle cx="198" cy="126" r="4" fill={AZURE} />
      <text x="292" y="133" textAnchor="middle" fontSize="16" fontFamily={CODE} fill={INK}>3</text>

      {/* 外层列表 b(copy 新建) */}
      <rect x="150" y="198" width="190" height="56" rx="6" fill="none" stroke={AZURE} strokeWidth="1.5" />
      <line x1="245" y1="198" x2="245" y2="254" stroke={AZURE} strokeWidth="1" />
      <circle cx="198" cy="226" r="4" fill={AZURE} />
      <text x="292" y="233" textAnchor="middle" fontSize="16" fontFamily={CODE} fill={INK}>3</text>
      <text x="150" y="276" fontSize="13" fill={SOFT}>b 的外壳(copy 新建的一份)</text>

      {/* 两个第 0 格 → 同一个子列表 */}
      <path d="M 204 122 Q 360 112 464 166" fill="none" stroke={AZURE} strokeWidth="1.8" markerEnd="url(#sc1-ref)" strokeLinecap="round" />
      <path d="M 204 230 Q 360 240 464 188" fill="none" stroke={AZURE} strokeWidth="1.8" markerEnd="url(#sc1-ref)" strokeLinecap="round" />

      {/* 共享的子列表(坑) */}
      <rect x="470" y="148" width="170" height="56" rx="6" fill={CINNABAR_WASH} stroke={CINNABAR} strokeWidth="2" strokeDasharray="6 4" />
      <line x1="555" y1="148" x2="555" y2="204" stroke={CINNABAR} strokeWidth="1" strokeDasharray="3 3" />
      <text x="512" y="183" textAnchor="middle" fontSize="16" fontFamily={CODE} fill={INK}>1</text>
      <text x="598" y="183" textAnchor="middle" fontSize="16" fontFamily={CODE} fill={INK}>2</text>
      <text x="555" y="132" textAnchor="middle" fontSize="14" fill={CINNABAR}>同一个子列表,两边共享</text>
      <text x="555" y="228" textAnchor="middle" fontSize="13" fill={SOFT}>b[0].append(9) → a 也跟着变</text>
      <text x="555" y="256" textAnchor="middle" fontSize="13" fill={JADE_INK}>想连里层也复制:copy.deepcopy(a)</text>
    </svg>
  );
}
