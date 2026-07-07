/**
 * 协程与异步编程(《操作系统原理》第 19 讲「异步编程模型」)—— 手绘教学示意图(纯 SVG,水墨线稿)。
 * 口径与 data/topics/os/async.ts 的 microLecture 咬合:
 * 图一「轮流用一支麦克风,一个干等全体卡住」——协程共用一条执行流,靠主动让出轮流跑;
 *   只要有谁去调会阻塞的调用干等,整条流就停,别的协程一起卡住。朱砂只标「一个卡住、全体卡住」这个坑,
 *   解法(非阻塞 + EAGAIN 就让出)留给正文,图里只点一句。
 * 图二「并发不是并行:省的是等,不是算」——左边一个人把等待重叠起来(I/O 密集,并发),
 *   右边多核真的一起算(CPU 密集才靠得上)。朱砂只标「以为加异步纯计算就变快」这个坑。
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
const CODE = 'var(--font-code)';
const DISPLAY = 'var(--font-display)';

/** 图一:轮流用一支麦克风,一个干等全体卡住 —— 一条执行流上协程接力,朱砂标「全体卡住」的坑 */
export function AsyncBatonSvg({ className }: { className?: string }) {
  // 时间轴上的片段:A 跑→让出→B 跑→让出→C 撞上「干等」→ 整条流停
  const segs = [
    { x: 70, w: 118, label: '协程A', fill: AZURE_WASH, stroke: AZURE, text: AZURE_DEEP, live: true },
    { x: 200, w: 118, label: '协程B', fill: PAPER_WARM, stroke: PAPER_EDGE, text: INK, live: true },
    { x: 332, w: 150, label: '协程C:干等 read', fill: PAPER_WARM, stroke: CINNABAR, text: CINNABAR, live: false },
  ];
  return (
    <svg
      viewBox="0 0 720 330"
      width="100%"
      role="img"
      aria-label="示意图:同一条执行流上,协程 A 跑一段主动让出、协程 B 接手再让出,轮流往前;轮到协程 C 时它去调了会一直干等的 read,整条执行流就停在这里,协程 A、B 也跟着卡住。朱砂标注的坑:一个卡住,全体卡住"
      className={className}
    >
      <text x="360" y="30" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        一条执行流,轮流用一支麦克风
      </text>
      <text x="70" y="58" fontSize="12.5" fill={SOFT}>只在自己「主动让出」时才交棒——没人能抢</text>

      {/* 一条执行流的底座 */}
      <line x1="60" y1="150" x2="660" y2="150" stroke={FAINT} strokeWidth="1.2" strokeDasharray="2 5" strokeLinecap="round" />

      {/* 片段块 */}
      {segs.map((s) => (
        <g key={s.label}>
          <rect x={s.x} y="92" width={s.w} height="46" rx="7" fill={s.fill} stroke={s.stroke} strokeWidth={s.live ? 1.4 : 2} />
          <text x={s.x + s.w / 2} y="120" textAnchor="middle" fontSize={s.live ? 15 : 13} fontFamily={DISPLAY} fill={s.text}>
            {s.label}
          </text>
        </g>
      ))}

      {/* 让出交棒的手绘弧(A→B、B→C) */}
      {[[188, 200], [318, 332]].map(([x1, x2]) => (
        <g key={x1}>
          <path d={`M ${x1} 100 Q ${(x1 + x2) / 2} 74 ${x2} 100`} fill="none" stroke={AZURE} strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
          <text x={(x1 + x2) / 2} y="72" textAnchor="middle" fontSize="11.5" fill={AZURE_DEEP}>让出</text>
        </g>
      ))}

      {/* 时间箭头 */}
      <line x1="70" y1="168" x2="640" y2="168" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 632 164 L 642 168 L 632 172" fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round" />
      <text x="656" y="172" fontSize="13" fill={SOFT}>时间</text>

      {/* 坑:朱砂圈住「干等」,整条流停 */}
      <line x1="407" y1="80" x2="407" y2="176" stroke={CINNABAR} strokeWidth="1.6" strokeDasharray="6 4" strokeLinecap="round" />
      <path d="M 482 115 L 640 115" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="5 4" strokeLinecap="round" />
      <path d="M 632 111 L 642 115 L 632 119" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeLinecap="round" />
      <text x="560" y="108" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>整条流停在这儿</text>
      <text x="407" y="200" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>坑:一个去干等</text>
      <text x="407" y="216" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>协程 A、B 全跟着卡住</text>

      {/* A、B 被拖住的灰影 */}
      {[segs[0], segs[1]].map((s) => (
        <text key={s.label} x={s.x + s.w / 2} y="234" textAnchor="middle" fontSize="12" fill={FAINT}>（也停了）</text>
      ))}

      <text x="360" y="286" textAnchor="middle" fontSize="13.5" fill={JADE_INK}>
        解法:别让它干等——改成「拿不到就先让出」,等数据到了再回来
      </text>
      <text x="360" y="308" textAnchor="middle" fontSize="12.5" fill={SOFT}>
        (讲义里叫非阻塞 I/O:拿不到返回 EAGAIN 就 yield,epoll 盯着谁就绪了再叫醒)
      </text>
    </svg>
  );
}

/** 图二:并发不是并行 —— 左「一个人重叠等待」右「多核真并行」,朱砂标「加异步纯计算就变快」的坑 */
export function AsyncConcurrencySvg({ className }: { className?: string }) {
  // 左:一个人,干活短、等待长,把等待叠起来(I/O 密集)
  const jobs = [
    { y: 96, label: 'A', work: 30, wait: 150 },
    { y: 128, label: 'B', work: 30, wait: 150 },
    { y: 160, label: 'C', work: 30, wait: 150 },
  ];
  const x0 = 60;
  // 右:多核,各算各的一段(CPU 密集才靠得上)
  const cores = [
    { y: 96, label: '核1:算A' },
    { y: 128, label: '核2:算B' },
    { y: 160, label: '核3:算C' },
  ];
  const rx = 400;
  return (
    <svg
      viewBox="0 0 720 340"
      width="100%"
      role="img"
      aria-label="示意图:左边一个人,每件事干活短、等待长,把三件事的等待重叠起来,总时间大大缩短——这叫并发,专治大量等待的 I/O 密集活儿;右边三个核各算一段,真的同时在算——这叫并行,纯计算(CPU 密集)只能靠它。朱砂标注的坑:以为把纯计算写成异步就能变快"
      className={className}
    >
      <text x="360" y="28" textAnchor="middle" fontSize="15" fontFamily={DISPLAY} fill={INK}>
        并发不是并行:省的是「等」,不是「算」
      </text>

      {/* 左半:并发 */}
      <text x={x0} y="60" fontSize="13.5" fontFamily={DISPLAY} fill={AZURE_DEEP}>并发 · 一个人,把等待叠起来</text>
      <text x={x0} y="78" fontSize="12" fill={SOFT}>擅长:大量网络请求等 I/O 密集</text>
      {jobs.map((j) => (
        <g key={j.label}>
          <rect x={x0} y={j.y} width={j.work} height="20" rx="4" fill={AZURE} stroke={AZURE_DEEP} strokeWidth="1" />
          <rect x={x0 + j.work} y={j.y} width={j.wait} height="20" rx="4" fill={AZURE_WASH} stroke={AZURE} strokeWidth="1" strokeDasharray="4 3" />
          <text x={x0 + j.work / 2} y={j.y + 14} textAnchor="middle" fontSize="10.5" fill="#fff" fontFamily={CODE}>{j.label}</text>
          <text x={x0 + j.work + j.wait / 2} y={j.y + 14} textAnchor="middle" fontSize="10.5" fill={AZURE_DEEP}>等（去干别的）</text>
        </g>
      ))}
      <text x={x0} y="200" fontSize="12" fill={JADE_INK}>等 A 的空当,先去干 B、C —— 等待重叠,总时间大降</text>

      {/* 中间分隔 */}
      <line x1="378" y1="52" x2="378" y2="214" stroke={FAINT} strokeWidth="1.2" strokeDasharray="3 5" />

      {/* 右半:并行 */}
      <text x={rx} y="60" fontSize="13.5" fontFamily={DISPLAY} fill={INK}>并行 · 多核,真的一起算</text>
      <text x={rx} y="78" fontSize="12" fill={SOFT}>纯计算 CPU 密集只能靠它</text>
      {cores.map((c) => (
        <g key={c.label}>
          <rect x={rx} y={c.y} width="200" height="20" rx="4" fill={PAPER_WARM} stroke={PAPER_EDGE} strokeWidth="1.2" />
          <text x={rx + 100} y={c.y + 14} textAnchor="middle" fontSize="11" fontFamily={DISPLAY} fill={INK}>{c.label}（一直在算）</text>
        </g>
      ))}
      <text x={rx} y="200" fontSize="12" fill={SOFT}>三个核同一时刻都在算 —— 这才是真并行</text>

      {/* 坑:朱砂标「纯计算写成异步不会变快」 */}
      <rect x="60" y="240" width="600" height="40" rx="8" fill="none" stroke={CINNABAR} strokeWidth="1.4" strokeDasharray="6 4" />
      <text x="360" y="258" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        坑:把一段纯烧 CPU 的计算写成 async,并不会变快——它没有「等」可以省
      </text>
      <text x="360" y="274" textAnchor="middle" fontSize="12.5" fill={CINNABAR}>
        想真快,得动用右边这种多核真并行
      </text>

      <text x="360" y="306" textAnchor="middle" fontSize="13" fill={SOFT}>
        一句话:异步把「等待」叠起来(并发),多核让「计算」同时跑(并行)——别搞混
      </text>
    </svg>
  );
}
