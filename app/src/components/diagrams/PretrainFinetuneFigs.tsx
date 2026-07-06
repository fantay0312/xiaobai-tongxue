/**
 * 预训练与微调 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/pretrainFinetune.ts 的 microLecture 咬合:
 * 「本事靠预训练,规矩靠微调」——两阶段流水:海量杂书自学猜下一个词 → 基座续写机 →
 * 少量专书点拨(千条量级示范,LIMA 口径)→ 守规矩的助手。
 * 朱砂只标「微调 = 灌新知识」这个坑;助手侧用黛绿点「学成」。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const JADE = 'var(--jade)';
const JADE_INK = 'var(--jade-ink)';
const JADE_WASH = 'var(--jade-wash)';
const CINNABAR = 'var(--cinnabar)';
const CINNABAR_WASH = 'var(--cinnabar-wash)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const DISPLAY = 'var(--font-display)';

/** 图一:两阶段流水——先博览群书,再学规矩说话 */
export function PfTwoStageSvg({ className }: { className?: string }) {
  const books = [
    { x: 36, y: 150, w: 128 },
    { x: 44, y: 133, w: 118 },
    { x: 32, y: 116, w: 132 },
    { x: 42, y: 99, w: 122 },
    { x: 38, y: 82, w: 126 },
    { x: 46, y: 65, w: 114 },
  ];
  return (
    <svg
      viewBox="0 0 720 300"
      width="100%"
      role="img"
      aria-label="示意图:大模型先在海量杂书上自学猜下一个词(预训练),得到只会续写的基座模型;再用少量专书点拨(指令微调),才变成守规矩回答的助手"
      className={className}
    >
      <defs>
        <marker id="pf1-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 海量杂书(书堆) */}
      {books.map((b, i) => (
        <rect
          key={b.y}
          x={b.x}
          y={b.y}
          width={b.w}
          height="15"
          rx="2"
          fill={PAPER_WARM}
          stroke={SOFT}
          strokeWidth="1.1"
          transform={`rotate(${i % 2 === 0 ? -1 : 1.5} ${b.x + b.w / 2} ${b.y + 7})`}
        />
      ))}
      <text x="100" y="192" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>海量杂书</text>
      <text x="100" y="212" textAnchor="middle" fontSize="13" fill={FAINT}>没人批改的语料</text>
      <text x="100" y="230" textAnchor="middle" fontSize="13" fill={AZURE}>功课:猜下一个词</text>

      {/* 预训练箭头 */}
      <line x1="182" y1="120" x2="242" y2="120" stroke={AZURE} strokeWidth="2" markerEnd="url(#pf1-arrow)" strokeLinecap="round" />
      <text x="212" y="100" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE}>预训练</text>
      <text x="212" y="140" textAnchor="middle" fontSize="13" fill={FAINT}>先博览群书</text>

      {/* 基座模型 */}
      <rect x="250" y="84" width="190" height="78" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} />
      <text x="345" y="108" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>基座模型:续写机</text>
      <text x="345" y="130" textAnchor="middle" fontSize="13" fill={SOFT}>问:食堂在哪?</text>
      <text x="345" y="150" textAnchor="middle" fontSize="13" fill={FAINT}>答:食堂,是一个让人怀念的词……</text>
      <text x="345" y="184" textAnchor="middle" fontSize="13" fill={SOFT}>会接话,默认不会正面回答</text>

      {/* 指令微调箭头 */}
      <line x1="448" y1="120" x2="502" y2="120" stroke={AZURE} strokeWidth="2" markerEnd="url(#pf1-arrow)" strokeLinecap="round" />
      <text x="475" y="100" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE}>指令微调</text>
      <text x="475" y="140" textAnchor="middle" fontSize="13" fill={FAINT}>少量专书点拨</text>
      <text x="475" y="158" textAnchor="middle" fontSize="13" fill={FAINT}>千条精选示范就见效</text>

      {/* 助手 */}
      <rect x="510" y="84" width="182" height="78" rx="8" fill={JADE_WASH} stroke={JADE} strokeWidth="1.5" />
      <text x="601" y="108" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={JADE_INK}>助手:守规矩说话</text>
      <text x="601" y="130" textAnchor="middle" fontSize="13" fill={SOFT}>问:食堂在哪?</text>
      <text x="601" y="150" textAnchor="middle" fontSize="13" fill={JADE_INK}>答:在三号楼旁。</text>
      <text x="601" y="184" textAnchor="middle" fontSize="13" fill={SOFT}>正面回答,格式规矩</text>

      {/* 坑:微调 ≠ 灌知识 */}
      <rect x="118" y="240" width="484" height="42" rx="6" fill={CINNABAR_WASH} stroke={CINNABAR} strokeDasharray="6 4" />
      <g transform="rotate(-6 150 261)">
        <rect x="138" y="249" width="24" height="24" fill="none" stroke={CINNABAR} strokeWidth="2" />
        <text x="150" y="267" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑</text>
      </g>
      <text x="180" y="267" fontSize="14" fill={INK}>微调 ≠ 灌新知识:教的主要是规矩,硬灌新事实还会加剧幻觉</text>
    </svg>
  );
}
