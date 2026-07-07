/**
 * 并发控制:条件变量(《操作系统原理》第 15 讲)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/condvar.ts 的 microLecture 咬合:
 * 图一「原子的一步,不给唤醒留缝隙」——cond_wait 把「放锁 + 睡下」捏成一个原子动作;
 *   朱砂只标「手写成 unlock; sleep 两步,别人的喊醒掉进缝隙里丢了 → 睡死」这个坑(丢失唤醒);
 * 图二「万能同步模板」——等待方(上锁→while 查条件→睡下)与唤醒方(改状态→broadcast);
 *   朱砂只标「把 while 写成 if,被叫醒扑个空」这个坑。
 * 图内文字一律生活语言;朱砂 var(--cinnabar) 只出现在「坑」上。
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

/** 图一:原子的一步,不给唤醒留缝隙 —— 上排 cond_wait 一步到位,下排拆两步漏唤醒(朱砂标坑) */
export function CondvarAtomicWaitSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:上排 cond_wait 把『放开锁』和『躺下睡』捏成一个动作,一步做完,被喊醒后重新拿回锁接着走;下排把它手写成先解锁、再睡下两步,中间裂开一道缝隙,别人的喊醒正好掉进缝隙里被丢掉,线程睡死。朱砂标注的坑:拆成两步会丢失唤醒"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        放锁和睡下,要捏成「一步」——中间不给别人插空的缝隙
      </text>

      {/* 上排:cond_wait 原子一步 */}
      <text x="40" y="86" fontSize="14" fontFamily={DISPLAY} fill={JADE_INK}>对:cond_wait</text>
      <rect x="150" y="66" width="230" height="40" rx="8" fill={AZURE_WASH} stroke={AZURE} strokeWidth="2" />
      <text x="265" y="91" textAnchor="middle" fontSize="14" fontFamily={DISPLAY} fill={AZURE_DEEP}>
        放开锁 + 躺下睡(一步做完)
      </text>
      <line x1="380" y1="86" x2="470" y2="86" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 462 82 L 472 86 L 462 90" fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="470" y="66" width="210" height="40" rx="8" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="575" y="91" textAnchor="middle" fontSize="13.5" fill={INK}>被喊醒→重新拿回锁→接着走</text>
      <text x="150" y="126" fontSize="12.5" fill={SOFT}>别人的喊醒,要么在它睡前(while 会再查到)、要么在它睡后(叫得醒)——绝不会掉空</text>

      {/* 分隔 */}
      <line x1="40" y1="150" x2="680" y2="150" stroke={FAINT} strokeWidth="1" strokeDasharray="4 5" />

      {/* 下排:拆两步,缝隙漏唤醒 */}
      <text x="40" y="196" fontSize="14" fontFamily={DISPLAY} fill={CINNABAR}>坑:手写两步</text>
      <rect x="150" y="176" width="120" height="40" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="210" y="201" textAnchor="middle" fontSize="13.5" fontFamily={CODE} fill={INK}>解锁</text>
      {/* 缝隙(朱砂) */}
      <rect x="290" y="176" width="120" height="40" rx="8" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x="350" y="201" textAnchor="middle" fontSize="13" fill={CINNABAR}>缝隙</text>
      <rect x="430" y="176" width="120" height="40" rx="8" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.2" />
      <text x="490" y="201" textAnchor="middle" fontSize="13.5" fontFamily={CODE} fill={INK}>睡下</text>

      {/* 别人的喊醒,箭头砸进缝隙 */}
      <text x="350" y="256" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>别人这会儿喊了一嗓子</text>
      <path d="M 350 250 L 350 220" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 3" />
      <path d="M 346 228 L 350 218 L 354 228" fill="none" stroke={CINNABAR} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="350" cy="196" r="26" fill="none" stroke={CINNABAR} strokeWidth="1.3" strokeDasharray="2 4" />

      <text x="360" y="300" textAnchor="middle" fontSize="13.5" fill={CINNABAR}>
        坑:喊醒掉进缝隙被丢掉 → 它随后睡下,再没人叫 → 睡死(丢失唤醒)
      </text>
      <text x="360" y="322" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        所以「放锁 + 睡下」必须由 cond_wait 一口气做完,自己拿 unlock、sleep 拼不出来
      </text>
    </svg>
  );
}

/** 图二:万能同步模板 —— 等待方 / 唤醒方两栏,朱砂标「while 别写成 if」的坑 */
export function CondvarTemplateSvg({ className }: { className?: string }) {
  const waitSteps = [
    { label: '① 上好锁' },
    { label: '② while:反复查「条件够了没」' },
    { label: '③ 不够:躺下等(醒了回②再查)' },
    { label: '④ 够了:干正事,再解锁' },
  ];
  const wakeSteps = [
    { label: 'ⓐ 上好锁' },
    { label: 'ⓑ 改好共享状态' },
    { label: 'ⓒ 招呼所有等着的人(broadcast)' },
    { label: 'ⓓ 解锁' },
  ];
  return (
    <svg
      viewBox="0 0 720 350"
      width="100%"
      role="img"
      aria-label="示意图:左栏是等待方——上锁、用循环反复查条件、不够就躺下等（醒了回去再查）、够了才干活；右栏是唤醒方——上锁、改好共享状态、招呼所有等待的人、解锁。朱砂标注的坑:第二步的循环若写成只查一次的 if,被叫醒后不重查就会扑空"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        万能同步模板:想清楚「继续的条件」,剩下照这两栏抄
      </text>

      {/* 左栏:等待方 */}
      <rect x="40" y="52" width="300" height="248" rx="12" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1.6" />
      <text x="190" y="78" textAnchor="middle" fontSize="14.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>等待方:等条件</text>
      {waitSteps.map((s, i) => (
        <g key={s.label}>
          <rect x="60" y={96 + i * 46} width="260" height="36" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.1" />
          <text x="72" y={119 + i * 46} fontSize="12.5" fill={INK}>{s.label}</text>
        </g>
      ))}

      {/* 右栏:唤醒方 */}
      <rect x="380" y="52" width="300" height="248" rx="12" fill={INK_WASH} stroke={PAPER_EDGE} strokeWidth="1.4" />
      <text x="530" y="78" textAnchor="middle" fontSize="14.5" fontFamily={DISPLAY} fill={JADE_INK}>唤醒方:凑齐条件</text>
      {wakeSteps.map((s, i) => (
        <g key={s.label}>
          <rect x="400" y={96 + i * 46} width="260" height="36" rx="7" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.1" />
          <text x="412" y={119 + i * 46} fontSize="12.5" fill={INK}>{s.label}</text>
        </g>
      ))}

      {/* 唤醒方 broadcast → 等待方醒来(手绘弧) */}
      <path d="M 400 249 Q 360 258 320 165" fill="none" stroke={JADE_INK} strokeWidth="1.4" strokeDasharray="4 4" strokeLinecap="round" opacity="0.7" />

      {/* 坑:while 别写成 if(朱砂,指向左栏第②步) */}
      <line x1="322" y1="160" x2="366" y2="150" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="5 4" strokeLinecap="round" />
      <text x="372" y="140" fontSize="12.5" fill={CINNABAR}>坑:这里若写成</text>
      <text x="372" y="158" fontSize="12.5" fill={CINNABAR}>「只查一次」的 if——</text>
      <text x="372" y="176" fontSize="12.5" fill={CINNABAR}>被叫醒不重查,扑个空</text>

      <text x="360" y="330" textAnchor="middle" fontSize="13" fill={SOFT}>
        查条件、改条件都在锁里做;等待用循环反复查,唤醒想清楚之前先招呼所有人更稳妥
      </text>
    </svg>
  );
}
