/**
 * RLHF 与对齐 —— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/rlhf.ts 的 microLecture 咬合:
 * 三步流水:人给示范(SFT)→ 用「哪个更好」的比较练出品味打分器(奖励模型)→
 * 照品味反复练(强化学习,自循环,人不再实时在场)+ KL 缰绳「不许离出发点太远」。
 * 朱砂只标「缰绳一松会刷乱码骗高分」这个坑(reward hacking 口径)。
 */

const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const FAINT = 'var(--ink-faint)';
const AZURE = 'var(--azure)';
const CINNABAR = 'var(--cinnabar)';
const PAPER_WARM = 'var(--paper-warm)';
const PAPER_EDGE = 'var(--paper-edge)';
const DISPLAY = 'var(--font-display)';

/** 图一:三步调教流水 + 第三步的自循环与 KL 缰绳 */
export function RlhfLoopSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 320"
      width="100%"
      role="img"
      aria-label="示意图:RLHF 三步——人先写示范让模型照着学;再用大量『哪个回答更好』的比较练出替人打分的奖励模型;最后模型生成、评委打分、反复练,并拴一条 KL 缰绳不许离出发点太远"
      className={className}
    >
      <defs>
        <marker id="rlhf1-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* 步骤标题 */}
      <text x="130" y="56" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>① 人给示范</text>
      <text x="370" y="56" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>② 练出品味打分器</text>
      <text x="610" y="56" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>③ 照品味反复练</text>

      {/* 三个箱体 */}
      <rect x="30" y="70" width="200" height="100" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} />
      <text x="130" y="100" textAnchor="middle" fontSize="13" fill={SOFT}>人写好示范回答</text>
      <text x="130" y="122" textAnchor="middle" fontSize="13" fill={SOFT}>模型照着学「怎么答」</text>
      <text x="130" y="150" textAnchor="middle" fontSize="13" fill={FAINT}>(监督微调 SFT)</text>

      <rect x="270" y="70" width="200" height="100" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} />
      <text x="370" y="100" textAnchor="middle" fontSize="13" fill={SOFT}>人只比较:哪个回答更好</text>
      <text x="370" y="122" textAnchor="middle" fontSize="13" fill={SOFT}>「A 比 B 好」×很多次</text>
      <text x="370" y="150" textAnchor="middle" fontSize="13" fill={FAINT}>练出替人打分的评委(奖励模型)</text>

      <rect x="510" y="70" width="200" height="100" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} />
      <text x="610" y="100" textAnchor="middle" fontSize="13" fill={SOFT}>模型写回答 → 评委打分</text>
      <text x="610" y="122" textAnchor="middle" fontSize="13" fill={SOFT}>分高的路子多走(强化学习)</text>
      <text x="610" y="150" textAnchor="middle" fontSize="13" fill={FAINT}>人不再实时在场</text>

      {/* 步骤衔接箭头 */}
      <line x1="234" y1="120" x2="264" y2="120" stroke={AZURE} strokeWidth="2" markerEnd="url(#rlhf1-arrow)" strokeLinecap="round" />
      <line x1="474" y1="120" x2="504" y2="120" stroke={AZURE} strokeWidth="2" markerEnd="url(#rlhf1-arrow)" strokeLinecap="round" />

      {/* 第三步的自循环 */}
      <path d="M 660 175 Q 610 248 560 175" fill="none" stroke={AZURE} strokeWidth="1.8" markerEnd="url(#rlhf1-arrow)" strokeLinecap="round" />
      <text x="610" y="240" textAnchor="middle" fontSize="13" fill={AZURE}>反复循环</text>

      {/* KL 缰绳 */}
      <text x="588" y="272" textAnchor="middle" fontSize="13" fill={SOFT}>练时拴根缰绳(KL):不许离出发点太远</text>

      {/* 坑:reward hacking */}
      <g transform="rotate(-6 52 258)">
        <rect x="40" y="246" width="24" height="24" fill="none" stroke={CINNABAR} strokeWidth="2" />
        <text x="52" y="264" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑</text>
      </g>
      <text x="80" y="264" fontSize="14" fill={INK}>缰绳一松,它会刷乱码骗评委的高分(钻空子)</text>
      <text x="80" y="286" fontSize="13" fill={FAINT}>评委只是人类口味的替身,盯着替身的分练过头,真实水平先升后降</text>
    </svg>
  );
}
