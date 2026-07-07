/**
 * 《操作系统原理》示意图聚合 —— 按讲次注册,diagrams/index.tsx 统一 spread 进 TOPIC_FIGURES。
 * 纪律同 diagrams/index.tsx:每张图口径与对应知识点 microLecture 一致,朱砂只标「坑」。
 * 本文件由集成脚本据各讲交付的图元数据生成,勿手改(改图先改各 Figs 文件与作者交付)。
 */
import type { TopicFigure } from '../index';
import { AsyncBatonSvg, AsyncConcurrencySvg } from './AsyncFigs';
import { CondvarAtomicWaitSvg, CondvarTemplateSvg } from './CondvarFigs';
import { DbConcurrencySvg, DbTransactionSvg } from './DatabaseFigs';
import { FsLinkCardsSvg, FsMountShelfSvg } from './FsApi1Figs';
import { FsApi2BellWatchSvg, FsApi2OverlayWindowSvg } from './FsApi2Figs';
import { FsImplBlocksSvg, FsImplCrashLogSvg } from './FsImplFigs';
import { GpuMemoryShapeSvg, GpuSimtWarpSvg } from './GpuFigs';
import { IoDeskAndMoverSvg, IoWindowsSvg } from './IoDevicesFigs';
import { LdMallocShopSvg, LdPrintfJourneySvg } from './LibcDebugFigs';
import { LibcCurtainSvg, LibcPrintfJourneySvg } from './LibcFigs';
import { LinkFillSvg, LoadChainSvg } from './LinkingFigs';
import { MpSharedBoardSvg, MpVisibilityTrapSvg } from './MultiprocessorFigs';
import { OsLayersSvg, OsTimesliceSvg } from './OverviewFigs';
import { ParallelBottleneckSvg, ParallelLocalLedgerSvg } from './ParallelFigs';
import { SecCiaTriadSvg, SecOverflowSvg } from './SecurityFigs';
import { SemNumberPlateSvg, SemSleepWakeSvg } from './SemaphoreFigs';
import { OsShellPipeSvg, OsShellSignalTripSvg } from './ShellFigs';
import { SummaryDeriveSvg, SummaryPillarsSvg } from './SummaryFigs';
import { TokenCapTriangleSvg, TokenJourneyMapSvg } from './TokenJourneyFigs';
import { OsContainerMetersSvg, OsVirtualizationBuildingSvg } from './VirtualizationFigs';

export const OS_TOPIC_FIGURES: Record<string, TopicFigure[]> = {
  'os-overview': [
    {
      id: "os-overview-layers",
      title: "界面是节目,舞台在底下",
      caption: "你看到的桌面、浏览器、终端全是普通程序在台上演出;操作系统是看不见的舞台管理层——别把最上排的节目当成舞台本身。",
      Svg: OsLayersSvg,
    },
    {
      id: "os-overview-timeslice",
      title: "一个瞬间只跑一个,切得快就像同时",
      caption: "单个处理器的时间轴上,放歌、下载、聊天其实是轮流各占一小片(约几十毫秒);切换够快,看起来就像同时在跑。",
      Svg: OsTimesliceSvg,
    },
  ],
  'os-shell': [
    {
      id: "os-shell-signal",
      title: "一个字符的权力之旅",
      caption: "键盘和黑窗口自己都不动手,只把你敲的字符递进去;是操作系统把 Ctrl-C 翻译成信号,发给前台那一组程序——键盘直接杀程序是条不存在的近道。",
      Svg: OsShellSignalTripSvg,
    },
    {
      id: "os-shell-pipe",
      title: "管道不是临时文件,是两边同时开工的流水线",
      caption: "想象里 a | b 是先把 a 的输出存成临时文件再给 b;实际数据不落盘,内核缓冲通道两侧并发,a 写 b 读同时进行。",
      Svg: OsShellPipeSvg,
    },
  ],
  'os-libc': [
    {
      id: "os-libc-buffer",
      title: "一行字的旅程",
      caption: "printf 先把字攒进自家抽屉,凑够一批(主流实现:碰到换行)才过一次门交给操作系统——不是喊一次就单独跑一趟。",
      Svg: LibcPrintfJourneySvg,
    },
    {
      id: "os-libc-curtain",
      title: "开场与谢幕:main 只是主角",
      caption: "程序不是从 main 开始的:先有人搭台(启动代码、库初始化),main 才上台;main 返回后还有人收场,才真正退出。",
      Svg: LibcCurtainSvg,
    },
  ],
  'os-libc-debug': [
    {
      id: "os-libcdbg-printf",
      title: "printf 的一次出差",
      caption: "大部分活儿(格式化、拼字符)在自家大厅就干完了,典型情况下只在最后去柜台小窗交一次货(写系统调用);问时间也多是抬头看公告栏,未必每次都进柜台。",
      Svg: LdPrintfJourneySvg,
    },
    {
      id: "os-libcdbg-malloc",
      title: "内存的批发与零售",
      caption: "仓库(操作系统)只按大段发货,小卖部(分配器)把大段切成小格子零售;free 先把货退回自家货架(空闲池),不是马上退回仓库,何时成段归还由分配器决定。",
      Svg: LdMallocShopSvg,
    },
  ],
  'os-linking': [
    {
      id: "os-linking-fill",
      title: "拼起来还不够:名字对上号,空地址填上",
      caption: "链接是拼接 + 对上号 + 填地址三件事:两块半成品拼起来,还要把空着的地址一个个填上——光拼不填,跳过去是一片荒地。",
      Svg: LinkFillSvg,
    },
    {
      id: "os-linking-loadchain",
      title: "程序不是第一个上场的",
      caption: "内核先请装载员(ld.so)上场,装好共用的库、认领名字,最后才交棒给你的程序——不是一上来就跑程序自己。",
      Svg: LoadChainSvg,
    },
  ],
  'os-multiprocessor': [
    {
      id: "mp-shared-board",
      title: "共享白板会抢",
      caption: "两条路线都先读到旧数,再各自写回同一个新数,看着加了两次,账本却只涨一次。",
      Svg: MpSharedBoardSvg,
    },
    {
      id: "mp-visibility-trap",
      title: "先写不等于马上看见",
      caption: "写下来的便签可能先停在自己桌边,别人看公共墙时仍旧看到旧字。",
      Svg: MpVisibilityTrapSvg,
    },
  ],
  'os-condvar': [
    {
      id: "condvar-atomic-wait",
      title: "原子的一步,不给唤醒留缝隙",
      caption: "cond_wait 把「放锁 + 睡下」捏成一步做完;你要是拆成先解锁、再睡下两步,别人的喊醒就掉进中间那道缝隙里被丢了——线程睡死(丢失唤醒)。",
      Svg: CondvarAtomicWaitSvg,
    },
    {
      id: "condvar-template",
      title: "万能同步模板",
      caption: "等待方:上锁→反复查条件→不够就躺下等;唤醒方:改好共享状态→招呼所有等着的人。把那个循环写成「只查一次」的 if,被叫醒后不重查就会扑个空。",
      Svg: CondvarTemplateSvg,
    },
  ],
  'os-semaphore': [
    {
      id: "sem-number-plate",
      title: "一块会加减的号牌",
      caption: "信号量就是停车场门口那块空位牌:进场做 P 减一、离场做 V 加一,数字到 0 就排队——初值设成几,就能放几个人同时进(锁只是初值=1 的特例)。",
      Svg: SemNumberPlateSvg,
    },
    {
      id: "sem-sleep-wake",
      title: "等号牌的人是去睡,不是干瞪眼",
      caption: "线程做 P 拿不到许可时,被挂起去睡、让出处理器,一点不占 CPU;别人做 V 归还许可时把它唤醒回来接着抢——讲义里那圈 while 只是'要等'的示意,不是真在空转。",
      Svg: SemSleepWakeSvg,
    },
  ],
  'os-parallel': [
    {
      id: "pa-bottleneck",
      title: "人越多,门越窄",
      caption: "正确排队能保结果;想跑快,要把排队段缩短,把各自干活段拉长。",
      Svg: ParallelBottleneckSvg,
    },
    {
      id: "pa-local-ledger",
      title: "先记小账,再交总账",
      caption: "每人先在小本子里攒,到点再交总账;能不能暂时旧一点,要看这本账的规矩。",
      Svg: ParallelLocalLedgerSvg,
    },
  ],
  'os-async': [
    {
      id: "async-baton",
      title: "轮流用一支麦克风,一个干等全体卡住",
      caption: "协程共用一条执行流,靠主动让出轮流跑;只要有谁去调会阻塞的调用干等,整条流就停,别的协程一起卡住——朱砂标「一个卡住、全体卡住」这个坑。",
      Svg: AsyncBatonSvg,
    },
    {
      id: "async-concurrency",
      title: "并发不是并行:省的是等,不是算",
      caption: "左边一个人把等待重叠起来(I/O 密集、并发),右边多核真的一起算(CPU 密集才靠得上);朱砂标「以为把纯计算写成异步就变快」这个坑。",
      Svg: AsyncConcurrencySvg,
    },
  ],
  'os-gpu': [
    {
      id: "gpu-simt-warp",
      title: "一位领队喊一排人",
      caption: "一束小工共享口令,各自拿着自己的号码和本子,所以不是每人一颗完整大脑。",
      Svg: GpuSimtWarpSvg,
    },
    {
      id: "gpu-memory-shape",
      title: "队形齐就快,走散就慢",
      caption: "相邻写格子能合成大搬运;跳着拿、有人绕远路,整队就被慢下来。",
      Svg: GpuMemoryShapeSvg,
    },
  ],
  'os-token-journey': [
    {
      id: "tj-journey-map",
      title: "一个请求跑完这一整趟",
      caption: "你的手机把一句话一跳一跳转发到数据中心;第一台迎上来的机器往往只是负载均衡器(门口的导诊台,只分流),后面才是真正干活的业务服务器和数据库——朱砂标「第一台不是终点」这个坑。",
      Svg: TokenJourneyMapSvg,
    },
    {
      id: "tj-cap-triangle",
      title: "三个角,很难同时占全",
      caption: "CAP 三角:一致、可用、容错;网线一断(分区),一致和可用只能二选一——朱砂标「想三个角全占 = 撞墙」这个坑,「三选二」是课堂通俗简化说法。",
      Svg: TokenCapTriangleSvg,
    },
  ],
  'os-io-devices': [
    {
      id: "io-windows",
      title: "小窗口不是普通格子",
      caption: "中间那颗大脑要先看灯、递纸条、按按钮,不能把窗口当抽屉乱写。",
      Svg: IoWindowsSvg,
    },
    {
      id: "io-desk-mover",
      title: "搬运工和统一柜台",
      caption: "大包交给搬运工按派工单搬,普通程序走统一柜台,复杂活仍在柜台后面。",
      Svg: IoDeskAndMoverSvg,
    },
  ],
  'os-fs-api-1': [
    {
      id: "fs-mount-shelf",
      title: "借一个格子看外来的柜子",
      caption: "接上时看见外来那柜资料,拿走后原来的格子又露出来——不是复制进去。",
      Svg: FsMountShelfSvg,
    },
    {
      id: "fs-link-cards",
      title: "名字牌 vs 地址纸条",
      caption: "左边是同一本书多一块名字牌,右边是一张去找别人的提示纸。",
      Svg: FsLinkCardsSvg,
    },
  ],
  'os-fs-api-2': [
    {
      id: "fs-api-2-bell-watch",
      title: "门铃不是巡逻",
      caption: "文件多时,别一遍遍全屋巡逻;让变化来敲门,异常时再校准。",
      Svg: FsApi2BellWatchSvg,
    },
    {
      id: "fs-api-2-overlay-window",
      title: "合成橱窗",
      caption: "看到的是合成橱窗:新层遮住旧层,删橱窗不等于砸旧仓库。",
      Svg: FsApi2OverlayWindowSvg,
    },
  ],
  'os-fs-impl': [
    {
      id: "fsimpl-blocks",
      title: "硬盘是格子账本",
      caption: "先看封面目录,小盘可以一段接一段找;名字只是门牌,文件本人另有身份证。",
      Svg: FsImplBlocksSvg,
    },
    {
      id: "fsimpl-crash-log",
      title: "断电怕半张账",
      caption: "追加内容要改多张账,半路断电会互相打架;先写小票,重开后才知道该不该重做。",
      Svg: FsImplCrashLogSvg,
    },
  ],
  'os-database': [
    {
      id: "os-db-transaction",
      title: "要么全成,要么全不成",
      caption: "批量导入选课导到一半断电:电子表格留下半份烂账;关系数据库靠事务的原子性整笔回滚,要么全部生效、要么当没发生过——没有中间态。",
      Svg: DbTransactionSvg,
    },
    {
      id: "os-db-concurrency",
      title: "像一把大锁,其实是真并发",
      caption: "两个互不相干的事务,真拿一把大锁只能排队串行;实际靠两阶段加锁只锁各自用到的几行、或多版本各改各的副本,于是真正并发,结果照样不乱。",
      Svg: DbConcurrencySvg,
    },
  ],
  'os-security': [
    {
      id: "sec-cia-triad",
      title: "安全要三样一起守",
      caption: "保密、完整、可用三根柱子撑起一个「安全」——改成绩毁的是完整、fork bomb 卡死机器毁的是可用;只守住一样,另两样照样能出事,房子一样塌。",
      Svg: SecCiaTriadSvg,
    },
    {
      id: "sec-overflow",
      title: "一个 bug 就翻墙",
      caption: "固定大小的缓冲区被超长输入灌满,多出来的部分把栈上的「返回地址」覆盖成坏地址,函数一返回就跳去执行坏人的代码——权限设得再严也白搭,坏人是从墙洞翻进来的。",
      Svg: SecOverflowSvg,
    },
  ],
  'os-virtualization': [
    {
      id: "os-virtualization-building",
      title: "整层楼 vs 小隔间",
      caption: "虚拟机像整层楼,容器像轻隔间:轻的好搬,但边界也更轻。",
      Svg: OsVirtualizationBuildingSvg,
    },
    {
      id: "os-container-meters",
      title: "门牌表 + 水电表",
      caption: "门牌表让小店各看各的,水电表限制各用各的;两张表缺一不可。",
      Svg: OsContainerMetersSvg,
    },
  ],
  'os-summary': [
    {
      id: "os-summary-pillars",
      title: "整门课就三件事 —— 三根柱子撑起一栋楼",
      caption: "虚拟化、并发、持久化是三根承重柱:上顶各种应用程序、下接硬件。朱砂标的坑:别以为把这三个名词背下来,就等于学会了这门课。",
      Svg: SummaryPillarsSvg,
    },
    {
      id: "os-summary-derive",
      title: "从需求推概念:面试题「什么是 Git」",
      caption: "先问需求(想给历史拍快照、能回退分叉)→ 抓住本质(快照=blob 树、历史=commit 有向无环图)→ branch/stash/worktree 顺着自己就推出来。朱砂标的坑:别上来就背命令,要从本质一步步推。",
      Svg: SummaryDeriveSvg,
    },
  ],
};
