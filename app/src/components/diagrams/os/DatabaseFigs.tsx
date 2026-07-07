/**
 * 数据库系统(《操作系统原理》第 27 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/database.ts 的 microLecture 咬合:
 * 图一「要么全成,要么全不成」——批量导入选课导到一半断电:电子表格留下半份烂账(朱砂标坑),
 *   关系数据库靠事务原子性整笔回滚,要么全成要么全不成;
 * 图二「像一把大锁,其实是真并发」——两个互不相干的事务:真拿一把大锁只能排队串行(朱砂标坑),
 *   两阶段加锁只锁各自用到的几行、多版本各改各的副本,于是真正并发,效果照样不乱。
 * 朱砂 var(--cinnabar) 只标「坑」;图内文字一律生活语言,不写实现术语。
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

/** 图一:要么全成,要么全不成 —— 导到一半断电,两种存法两种下场 */
export function DbTransactionSvg({ className }: { className?: string }) {
  // 50 条批量导入,导到第 30 条时断电
  const rows = Array.from({ length: 10 }, (_, i) => i);
  return (
    <svg
      viewBox="0 0 720 380"
      width="100%"
      role="img"
      aria-label="示意图:批量导入 50 条选课,导到第 30 条时断电。左边的电子表格留下前 29 条、丢了后 21 条,成了对不上的半份烂账(朱砂标注的坑);右边的关系数据库靠事务,整笔要么全部成功、要么一条都不算,断电了就当没发生、重来一次即可。"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        批量导入 50 条选课，导到第 30 条时突然断电……
      </text>

      {/* 断电闪电,居中 */}
      <text x="360" y="70" textAnchor="middle" fontSize="20" fill={CINNABAR}>⚡ 断电</text>
      <line x1="360" y1="80" x2="360" y2="352" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 5" strokeLinecap="round" />

      {/* 左:电子表格 —— 半份烂账 */}
      <text x="180" y="104" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>电子表格</text>
      {rows.map((i) => {
        const kept = i < 6; // 前 6 格代表「前 29 条留下」
        return (
          <rect
            key={`l${i}`}
            x={90}
            y={118 + i * 22}
            width={180}
            height={18}
            rx="3"
            fill={kept ? PAPER_WARM : 'none'}
            stroke={kept ? PAPER_EDGE : FAINT}
            strokeWidth="1"
            strokeDasharray={kept ? undefined : '3 4'}
          />
        );
      })}
      <text x="180" y="352" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>前 29 条留下 · 后 21 条没了</text>

      {/* 坑:朱砂圈住「半份烂账」 */}
      <path
        d="M 84 210 Q 60 260 120 300 Q 200 340 276 300"
        fill="none"
        stroke={CINNABAR}
        strokeWidth="1.5"
        strokeDasharray="6 4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <text x="150" y="140" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑：以为只丢一半</text>
      <text x="168" y="158" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>—— 其实成了对不上的烂账</text>

      {/* 右:关系数据库 —— 事务整笔回滚 */}
      <text x="540" y="104" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>关系数据库（有事务）</text>
      <rect x="450" y="118" width="180" height={18 * 10 + 22 * 9} rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="540" y="235" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>要么全成</text>
      <text x="540" y="262" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={AZURE_DEEP}>要么全不成</text>
      <text x="540" y="352" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>断电就当没发生 · 重来一次即可</text>

      {/* 手绘对照括号 */}
      <text x="360" y="200" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>同一场</text>
      <text x="360" y="216" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>断电</text>
      <text x="360" y="232" textAnchor="middle" fontSize="12" fontFamily={CODE} fill={SOFT}>↓ 两种下场</text>
    </svg>
  );
}

/** 图二:像一把大锁,其实是真并发 —— 两个互不相干的事务,三种跑法 */
export function DbConcurrencySvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:两个互不相干的事务,T1 改学生 A 的课表、T2 改学生 B 的课表。真拿一把大锁,只能 T1 跑完 T2 才开始，白白排队（朱砂标注的坑）；两阶段加锁只锁各自用到的那几行、多版本各改各的副本，于是 T1 和 T2 同时在跑，效果照样不乱。"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        两件互不相干的活：T1 改 A 的课表 · T2 改 B 的课表
      </text>

      <text x="70" y="66" fontSize="13" fill={SOFT}>时间 →</text>
      <line x1="70" y1="72" x2="650" y2="72" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 5" strokeLinecap="round" />

      {/* 第一行:真·一把大锁 —— 排队串行(坑) */}
      <text x="70" y="112" fontSize="13.5" fontFamily={DISPLAY} fill={CINNABAR}>真拿一把大锁</text>
      <rect x="200" y="94" width="200" height="34" rx="6" fill={INK_WASH} stroke={CINNABAR} strokeWidth="1.6" />
      <text x="300" y="116" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>T1</text>
      <rect x="410" y="94" width="200" height="34" rx="6" fill={INK_WASH} stroke={CINNABAR} strokeWidth="1.6" />
      <text x="510" y="116" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={INK}>T2（干等）</text>
      <path d="M 196 132 Q 405 150 614 132" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="6 4" strokeLinecap="round" opacity="0.9" />
      <text x="405" y="166" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑：以为真锁一把大锁、事务只能排队一个个来</text>

      {/* 第二行:两阶段加锁 / 多版本 —— 真并发 */}
      <text x="70" y="228" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>只锁用到的几行</text>
      <text x="70" y="246" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>／各改各的副本</text>
      <rect x="200" y="210" width="410" height="34" rx="6" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.8" />
      <text x="300" y="232" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>T1</text>
      <line x1="405" y1="214" x2="405" y2="240" stroke={AZURE} strokeWidth="1.2" strokeDasharray="3 3" />
      <text x="510" y="232" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>T2（同时在跑）</text>
      <text x="405" y="272" textAnchor="middle" fontSize="12.5" fill={JADE_INK}>互不相干 → 真正一起跑，效果照样不乱</text>

      <text x="360" y="312" textAnchor="middle" fontSize="13.5" fontFamily={DISPLAY} fill={SOFT}>
        「像一把大锁」说的是<tspan fill={INK}>效果</tspan>不乱 —— 底下其实是真并发，所以更快
      </text>
    </svg>
  );
}
