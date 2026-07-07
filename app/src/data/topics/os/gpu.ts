/**
 * 知识点:CPU、GPU 和 SIMT(《操作系统原理》第 20 讲)。
 * 讲义:https://jyywiki.cn/OS/2026/lect20.md
 * 视频:https://www.bilibili.com/video/BV1df536aEMk(UP 主「绿导师原谅你了」,jyy 官方号)
 * 关键词组与本文件导出的 osGpuDemo 预埋话术互相咬合,
 * 改动任一侧必须同步校验(scripts/simulate.ts)。
 *
 * 演示编排(与 attention 同构):
 *   ① c1(CPU 的顺序执行是假象)→ ② c2(SIMD 分摊调度开销)+金句 → 注入 M1(SIMD 就是 GPU 换皮?)
 *   ③a 对照:被带偏 / ③b 纠正 M1 + 顺势命中 c3(shader/CUDA 是海量同构任务)
 *   ④ 串讲:从一条口令到满屏小工(无新命中;Lv5 人格在此轮提前迁移)
 *   ⑤ c4(SIMT:一个 PC 管一束线程)→ 注入 M3(每个小工都有完整大脑?)
 *   ⑥ 纠正 M3 + 命中 c5(访存合并与分支拖慢)→ 同轮衔接注入 M2(GPU 万能替代 CPU?)→ ⑦ 纠正 M2 收尾
 *
 * 内容红线(备课研究核定):
 *   - 不说"CPU 真的串行":讲义原话是顺序执行只是精心维护的假象;下层逻辑门和现代 CPU 内部会挖指令级并行;
 *   - SIMD 的收益是把"调度一条指令"的开销摊到多份数据上,不是凭空多出很多独立线程;
 *   - 讲 GPU 起源要从图形渲染管线、shader、GPGPU 到 CUDA,别倒因为果说"GPU 天生就是 AI 处理器";
 *   - SIMT 不是一堆完整 CPU:同一个取指/译码和一个 Program Counter 管一束线程,线程有各自寄存器和数据;
 *   - 性能数字只按讲义限定:RTX 4060Ti 跑 25600x25600 Mandelbrot 用 6.1s@42W,CPU Ryzen 5 9600X 用 25.1s@65W;
 *   - GPU 不擅长数据中心业务逻辑是讲义分寸:适合海量相同、访存规整、分支少的活,不是替代 CPU 的万能机器。
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osGpuTopic: Topic = {
  topicId: 'os-gpu',
  title: 'CPU、GPU 和 SIMT',
  course: '操作系统原理',
  tagline: '一条口令喊动一整排小工',
  transferHint: '把一张超大照片批量调亮,和处理一堆互相牵扯的订单规则,为什么不该派同一支队伍',
  checklist: [
    {
      id: 'c1',
      point: 'CPU 的顺序执行是假象',
      groundTruth:
        'CPU 看起来按程序顺序一条条执行,但现代处理器内部会利用指令级并行(Instruction-level Parallelism, ILP):' +
        '逻辑门天然并行,处理器可以译码多条指令、分析数据依赖,在没有依赖时乱序发射、最终按序提交。' +
        '这种内部"编译器"能提高单线程性能,但会消耗大量能量;进入暗硅时代后,功耗公式 P = C V² f 和散热上限使频率墙、功耗墙成为单核继续加速的硬边界。',
      keywords: [
        ['顺序执行', '假象'],
        ['指令级并行'],
        ['乱序', '按序提交'],
        ['功耗墙'],
      ],
      terms: ['指令级并行', 'IPC', '功耗墙', '暗硅'],
      level: 'L1',
      lookupCard:
        '**CPU 并不是老老实实一步一步走**\n\n你写的程序看起来是一条接一条执行,但处理器里面会偷偷找能同时做的活:' +
        '先看两条指令有没有数据依赖,没依赖就可以一起发出去,最后再按程序顺序把结果交回来。\n\n' +
        '这叫**指令级并行**。它让单线程跑得快,代价是处理器内部要做依赖分析、队列调度、重命名等复杂工作,这些控制电路也会发热耗电。\n\n' +
        '讲义给出的根子是功耗公式 **P = C V² f**:频率和电压不能无限往上推,散热压住了单核性能继续暴涨的路。',
      probeLine: '老师,一台看起来一步一步干活的机器,怎么会在里面偷偷同时干很多事呀?',
    },
    {
      id: 'c2',
      point: 'SIMD 把调度成本分摊到一排数据',
      groundTruth:
        'SIMD(Single Instruction, Multiple Data)的核心是"调度一条指令"的控制开销大致固定,而一次算术本身能耗不一定高;' +
        '把一个大寄存器切成多个小数据槽,让一条指令同时处理多份数据,就把取指、译码、调度的代价摊薄了。' +
        '典型演进是 MMX 64-bit 寄存器到 SSE、AVX、AVX-512 的更长 packed registers,支持 int8/16/32、float32/64、shuffle、FMA 等操作;但它仍在 CPU 的缓存和动态流水线里竞争资源。',
      keywords: [
        ['SIMD'],
        ['一条指令', '多个数据'],
        ['调度', '分摊'],
        ['Packed', 'Registers'],
      ],
      terms: ['SIMD', 'Packed Registers', 'MMX', 'AVX'],
      level: 'L2',
      lookupCard:
        '**SIMD:一条口令,一排数据一起动**\n\n处理器喊一条指令要付控制成本:取指、译码、排队、分析依赖都要花电。' +
        '如果一条指令只算一个数,这些成本全压在一个数身上;如果一条指令同时算 4 个、8 个、16 个数,成本就被摊薄。\n\n' +
        '做法是增加更长的 **Packed Registers**:从 **MMX** 的 64-bit,一路到 SSE、**AVX**、AVX-512。' +
        '寄存器越长,一条口令能带动的数据越多。\n\n注意分寸:它仍然在 CPU 里调度,会抢缓存、抢流水线、抢功耗。',
      probeLine: '老师,那能不能让一个口令别只搬一块砖,而是一整排砖一起搬?',
    },
    {
      id: 'c3',
      point: 'shader/CUDA 是给海量同构任务发工牌',
      groundTruth:
        '图形渲染天然包含大量 embarrassingly parallel 的任务:例如每个像素、每个顶点都要按相同规则计算颜色或位置。' +
        '早期 fixed-function pipeline GPU 每个线程执行完全相同的固定流程;可编程 shader 让开发者为 vertex、pixel 等对象写同一段程序。' +
        'GPGPU 进一步把非图形问题改写成图形式计算;CUDA 的编程模型就是为屏幕上每个像素等数据元素启动大量轻量线程,例如 1920×1080 可对应 2,073,600 个线程运行同一个 kernel。',
      keywords: [
        ['shader'],
        ['CUDA'],
        ['像素', '同一段代码'],
        ['启动', '线程'],
        ['2,073,600'],
      ],
      terms: ['shader', 'CUDA', 'GPGPU', 'kernel'],
      level: 'L3',
      lookupCard:
        '**从画图到通用计算:给每个小格子一张工牌**\n\n图形渲染里有一种特别适合并行的活:满屏像素都要算颜色,每个顶点都要算位置,' +
        '规则几乎一样,只是手里的坐标和数据不同。\n\n早期 GPU 是固定流水线:每个小工都按同一套流程干。后来有了可编程 **shader**,' +
        '开发者能写一段程序交给很多像素或顶点执行。再往前一步,把普通计算也改写成这种"一大堆小格子各算各的",就是 **GPGPU**。\n\n' +
        '**CUDA** 把这件事包装成编程模型:你写一个 **kernel**,一次给成千上万个数据元素发工牌。',
      probeLine: '老师,画面上那么多小格子都要算颜色,是不是每个小格子都在做差不多的活?',
    },
    {
      id: 'c4',
      point: 'SIMT 用一个口令管一束线程',
      groundTruth:
        'SIMT(Single Instruction, Multiple Threads)保留线程各自的寄存器和数据,但让一套取指/译码单元、一个 Program Counter 管理若干线程。' +
        '在 NVIDIA 术语中,同一束同时执行的线程叫 thread warp,典型是一束 32 个线程。' +
        '如果这些线程执行同一条 store 指令,只是各自的 col、color 等寄存器值不同,硬件就像用一个口令喊动一排小工,省掉为每个线程配完整 CPU 前端的成本。',
      keywords: [
        ['SIMT'],
        ['一个 PC'],
        ['线程束'],
        ['warp'],
        ['同一个取指'],
      ],
      terms: ['SIMT', 'thread warp', 'Program Counter', 'CUDA core'],
      level: 'L3',
      lookupCard:
        '**SIMT:一位领队喊口令,一束小工各写各的格子**\n\n如果给每个小工都配一台完整 CPU,每个人都有自己的取指、译码、调度前端,' +
        '那控制成本又回来了。SIMT 的省钱办法是:小工们各有自己的寄存器和手里那份数据,但同一束小工共享一套口令。\n\n' +
        '讲义里的说法是:一个 **Program Counter** 管多个线程;同一束叫 **thread warp**。典型情况下,一束 32 个线程一起走同一条指令,' +
        '只是每个人寄存器里的 row、col、color 不一样。',
      probeLine: '老师,这么多人一起干活时,是每个人各喊各的口令,还是有人统一喊口令大家照做呀?',
    },
    {
      id: 'c5',
      point: '访存合并与分支分叉决定 GPU 好不好跑',
      groundTruth:
        'SIMT 的高效依赖程序形状:同一 warp 的相邻线程访问连续地址时,Memory coalescing 会把多个访问合成像一次 128-byte store 那样的大访问;' +
        '如果把 map[row*1920+col] 改成 map[row+col*1080],虽然逻辑等价,但访存模式可能导致性能大幅下降。' +
        '同一 warp 内出现不确定 while 循环或分支分叉时,最慢那条路径会拖慢整束线程。讲义示例中,25600×25600 Mandelbrot Set 在 Ryzen 5 9600X 上为 25.1s@65W,在 RTX 4060Ti 16GB 上为 6.1s@42W,但该程序因不确定 while 循环对 CUDA 并不太友好。',
      keywords: [
        ['Memory coalescing'],
        ['连续', '合并'],
        ['最慢', '拖慢'],
        ['row + col'],
        ['不确定', 'while'],
      ],
      terms: ['Memory coalescing', 'load/store stall', 'shared memory', 'Mandelbrot'],
      level: 'L5',
      lookupCard:
        '**GPU 快不快,要看队伍走得齐不齐**\n\n同一束小工如果一起写相邻格子,硬件能把一串小访问**合并**成一次大访问;讲义把它叫 **Memory coalescing**。' +
        '这就是为什么 `map[row * 1920 + col] = t` 和 `map[row + col * 1080] = t` 逻辑等价,速度却可能差很多。\n\n' +
        '另一个坑是分支:一束人共用口令,有人早做完、有人还在 `while` 里绕圈,整束就得等最慢的人。' +
        '所以 GPU 适合海量相同、访问规整、分支少的活;业务逻辑那种到处拐弯的活,它并不拿手。',
      probeLine: '老师,要是大家走的路不一样、拿东西的位置也乱七八糟,会不会一下子就慢下来?',
    },
  ],
  misconceptions: [
    {
      mcId: 'os_gpu_M1',
      topicId: 'os-gpu',
      belief: 'SIMD 已经是一条指令带很多线程了,GPU 只是把寄存器加长一点的换皮版',
      triggerLine:
        '哦!那我懂了:SIMD 不就是一条指令带很多线程一起跑嘛。既然一排数据能一起算,那 GPU 其实只是把寄存器再加长一点,' +
        '本质上就是 CPU 里这套东西换个皮,没必要另讲一条路线,对吧?',
      correctionCriteria: [
        '指出 SIMD 仍在 CPU 的动态调度、缓存和功耗体系里,只是把一条指令的调度成本摊薄',
        '说明 GPU/CUDA 的路线来自海量同构任务:为大量像素或数据元素运行同一段程序',
        '区分 SIMD 的"一条向量指令处理多份数据"与 SIMT 的"多个轻量线程共享取指译码"',
      ],
      correctionKeywords: [
        ['不是', '换皮'],
        ['仍然', 'CPU', '调度'],
        ['同一段代码', '小格子'],
        ['很多线程', '工牌'],
      ],
      adoptionKeywords: [
        ['就是', '换皮'],
        ['加长', '够了'],
        ['一条指令', '很多线程'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: 'SIMD 已经等于很多线程了,GPU 只是把 CPU 的向量寄存器做长一点。',
        isTrue: false,
        explanation:
          'SIMD 只是让一条 CPU 指令处理多份数据,仍吃 CPU 调度和缓存;GPU/CUDA 是为海量同构任务启动大量轻量线程,再用 SIMT 共享控制前端。',
      },
      remedy: {
        microLesson: {
          title: '一排数据,不是一排完整工人',
          body:
            '把 SIMD 想成一把很宽的刷子:刷一下能同时刷四格、八格,所以"挥刷子"的成本被摊薄了。' +
            '但拿刷子的还是同一个 CPU 前端,取指、译码、排队、抢缓存都还在。\n\n' +
            'GPU 走的是另一条路:画面上有几百万个像素,每个像素都要按同一段程序算颜色。于是我们给每个小格子发一张工牌,' +
            '让它们各拿自己的坐标和颜色去跑同一段代码。CUDA 把这种模型包装成 kernel + 大量轻量线程。\n\n' +
            '所以别把"一条向量指令处理多份数据"说成"已经有很多完整线程"。前者是宽刷子,后者是一排小工共享口令。',
          askBack: '下次小白再说「SIMD 就是 GPU 换皮」,你准备用"宽刷子 vs 一排小工"怎么拆开讲?',
        },
        predictionQuiz: [
          {
            id: 'r1-1',
            question: 'SIMD 真正省下来的主要是哪类成本?',
            options: [
              '把每个数据都变成独立线程的成本',
              '一条指令取指、译码、调度的控制成本被多份数据分摊',
              '把内存变大的成本',
              '让程序员不用写代码的成本',
            ],
            answerIndex: 1,
            explanation: 'SIMD 是一条指令同时处理多份数据,摊薄的是指令调度这笔控制账。',
            checklistRef: 'c2',
            mcRef: 'os_gpu_M1',
          },
          {
            id: 'r1-2',
            question: '为什么不能说 SIMD 已经就是 GPU 的轻量线程模型?',
            options: [
              '因为 SIMD 完全不能并行',
              '因为 SIMD 仍在 CPU 里调度,而 CUDA 是给海量数据元素发轻量线程工牌',
              '因为 SIMD 只能处理图片,不能处理数字',
              '因为 GPU 只会显示彩色图标',
            ],
            answerIndex: 1,
            explanation: '两者都利用同构计算,但抽象层不同:SIMD 是向量指令,CUDA 是大量轻量线程。',
            checklistRef: 'c3',
            mcRef: 'os_gpu_M1',
          },
          {
            id: 'r1-3',
            code: 'float4 a, b, c;\nc = a + b;',
            question: '这段向量加法最像什么画面?',
            options: [
              '一把宽刷子一次刷四格',
              '四个完整 CPU 各自取指译码',
              '四个网页互相发消息',
              '四个用户抢同一把锁',
            ],
            answerIndex: 0,
            explanation: '向量加法是一条口令处理多份数据,不是四套完整控制前端。',
            checklistRef: 'c2',
            mcRef: null,
          },
        ],
      },
    },
    {
      mcId: 'os_gpu_M2',
      topicId: 'os-gpu',
      belief: 'GPU 核心多、单位功耗强,所以以后所有程序都应该扔给 GPU,CPU 已经没用了',
      triggerLine:
        '等等老师,那我是不是可以下结论了:GPU 核那么多,还省电,以后程序都扔给 GPU 就好了吧?' +
        'CPU 这种大而复杂的家伙看起来已经过时了,业务逻辑、网页后台、操作系统本身都搬过去跑,对吧?',
      correctionCriteria: [
        '指出 GPU 不是 CPU 的替代品,而是适合特定形状任务的加速器',
        '说明 GPU 适合同一段代码作用在海量数据上,并且分支少、访存规整',
        '说明复杂控制流、少量任务、数据中心业务逻辑通常仍更适合 CPU,实际系统是 CPU 与 GPU 分工协作',
      ],
      correctionKeywords: [
        ['不是', '替代'],
        ['同一段代码', '海量'],
        ['分支少', '规整'],
        ['业务逻辑', '不擅长'],
        ['CPU', 'GPU', '分工'],
      ],
      adoptionKeywords: [
        ['都扔给', 'GPU'],
        ['CPU', '没用'],
        ['所有程序', 'GPU'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: 'GPU 核多又省电,所以所有程序都应该搬到 GPU 上,CPU 可以被淘汰。',
        isTrue: false,
        explanation:
          'GPU 擅长海量同构、分支少、访存规整的任务;复杂控制和业务逻辑仍适合 CPU,真实系统靠两者分工协作。',
      },
      remedy: {
        microLesson: {
          title: '大食堂不是万能厨房',
          body:
            'GPU 像大食堂流水线:同时给一万人打同一份套餐,速度惊人;但如果每个客人都要临时改菜单、问忌口、分开发票,流水线反而被卡住。\n\n' +
            'CPU 像小灶厨师:人少、反应快,能处理复杂分支和临场决策。GPU 像流水线:人多、队伍长,最怕大家走不同路、拿不同地方的东西。\n\n' +
            '所以讲义最后的分寸很重要:GPU 并不擅长执行数据中心里的业务逻辑。它改变世界,是因为矩阵计算、图形渲染、物理模拟这类活刚好长得像流水线。',
          askBack: '下次小白再说「所有程序都扔给 GPU」,你准备用"大食堂 vs 小灶"怎么说明边界?',
        },
        predictionQuiz: [
          {
            id: 'r2-1',
            question: '下面哪类任务最像 GPU 爱吃的饭?',
            options: [
              '一百万张照片都按同一规则调亮',
              '一个客服系统根据每个用户状态走不同规则',
              '一段用户登录逻辑,到处查表和分支',
              '让编辑器响应一次按键',
            ],
            answerIndex: 0,
            explanation: '海量数据、同一规则、分支少,这才像 GPU 的主场。',
            checklistRef: 'c5',
            mcRef: 'os_gpu_M2',
          },
          {
            id: 'r2-2',
            question: '为什么业务后台不一定适合整段搬到 GPU?',
            options: [
              '因为 GPU 不能通电',
              '因为业务逻辑常有复杂分支、少量请求和不规整访存,队伍很难齐步走',
              '因为 GPU 只能画绿色像素',
              '因为 CPU 会吃醋',
            ],
            answerIndex: 1,
            explanation: 'GPU 怕的不是计算,而是队伍走散:分支和访存一乱,优势就被抵消。',
            checklistRef: 'c5',
            mcRef: 'os_gpu_M2',
          },
          {
            id: 'r2-3',
            question: '真实机器里 CPU 和 GPU 最稳妥的关系是?',
            options: [
              'GPU 全面取代 CPU',
              'CPU 负责复杂控制和调度,GPU 接走适合批量并行的重活',
              'CPU 只负责显示器发光',
              '两者互不相见,不能合作',
            ],
            answerIndex: 1,
            explanation: '系统设计靠分工:CPU 像总调度,GPU 像专门的批量加速工厂。',
            checklistRef: 'c1',
            mcRef: 'os_gpu_M2',
          },
        ],
      },
    },
    {
      mcId: 'os_gpu_M3',
      topicId: 'os-gpu',
      belief: 'SIMT 里的每个小工都像一颗完整 CPU,各自取指译码、各自想走哪条路就走哪条路',
      triggerLine:
        '那我明白了:既然都叫线程,那每个小工肯定都像一颗迷你 CPU,自己取指、自己译码、自己想走哪条路就走哪条路。' +
        'GPU 只是把这种完整小 CPU 堆得特别多,所以才快,对吧?',
      correctionCriteria: [
        '指出同一 warp 共享一个 Program Counter 和取指/译码控制,不是每个线程一套完整 CPU 前端',
        '说明线程仍有自己的寄存器和数据,所以同一条指令能写不同地址、算不同颜色',
        '顺势指出共享口令带来的性能边界:访存要连续合并,分支分叉会让整束等最慢路径',
      ],
      correctionKeywords: [
        ['不是', '完整 CPU'],
        ['一个 PC'],
        ['同一套', '取指'],
        ['各自', '寄存器'],
      ],
      adoptionKeywords: [
        ['完整小 CPU'],
        ['完整小CPU'],
        ['各自取指'],
        ['想走哪条路', '就走哪条路'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: 'SIMT 里的每个线程都有自己的取指译码前端,就像很多完整 CPU 堆在一起。',
        isTrue: false,
        explanation:
          'SIMT 省的正是控制前端:一束线程共享一个 PC 和取指译码,但各自有寄存器和数据;分支和访存不齐会让整束变慢。',
      },
      remedy: {
        microLesson: {
          title: '不是每人一颗脑袋,而是一排人听同一个口令',
          body:
            'SIMT 的省法很像军训:教官喊"向前一步",一整排都动,但每个人站的位置不同,最后落点也不同。' +
            '如果每个人都配一个教官,控制成本就爆了。\n\n' +
            '所以同一束线程共享一个口令来源,但每个线程有自己的寄存器:row、col、color 可以各不相同。' +
            '同一条 store 指令发出去,大家把各自颜色写到各自位置。\n\n' +
            '这也解释了为什么队伍要整齐:大家写相邻位置,硬件能合成大访问;有人进 while 绕很久,全束都得等它。',
          askBack: '下次小白再说「每个线程都是完整小 CPU」,你准备用"一位教官喊一排人"怎么说明?',
        },
        predictionQuiz: [
          {
            id: 'r3-1',
            question: 'SIMT 中一束线程最关键的省法是什么?',
            options: [
              '每个线程都配一套完整取指译码',
              '共享一套取指译码和一个口令来源,但各自保留寄存器和数据',
              '所有线程只能写同一个地址',
              '把线程名字改短一点',
            ],
            answerIndex: 1,
            explanation: 'SIMT 的核心是共享控制、保留数据独立,不是复制一堆完整 CPU。',
            checklistRef: 'c4',
            mcRef: 'os_gpu_M3',
          },
          {
            id: 'r3-2',
            question: '同一束线程为什么能写不同像素?',
            options: [
              '因为它们虽然听同一条口令,但各自寄存器里的坐标和颜色不同',
              '因为每个线程偷偷改写了程序',
              '因为显卡随机分配颜色',
              '因为屏幕自己会补全',
            ],
            answerIndex: 0,
            explanation: '同一条指令配上不同寄存器值,就能落到不同地址和不同结果。',
            checklistRef: 'c4',
            mcRef: 'os_gpu_M3',
          },
          {
            id: 'r3-3',
            question: '一束线程里有人很快做完、有人还在循环里转,会怎样?',
            options: [
              '快的人先回家,慢的人自己慢慢算,互不影响',
              '整束往往要等最慢路径,这就是分支分叉的代价',
              '硬件会自动把慢的人开除',
              '循环会被改成睡觉',
            ],
            answerIndex: 1,
            explanation: '共享口令的队伍怕走散:最慢路径会拖住整束线程。',
            checklistRef: 'c5',
            mcRef: 'os_gpu_M3',
          },
        ],
      },
    },
  ],
  quizBank: [
    {
      id: 'q1',
      question: '为什么说 CPU 的"顺序执行"只是一个被维护出来的表象?',
      options: [
        '因为 CPU 会随机跳过一半指令',
        '因为内部会找没有依赖的指令并行做,最后再按程序顺序交结果',
        '因为所有程序其实都在 GPU 上跑',
        '因为屏幕刷新太快骗过了眼睛',
      ],
      answerIndex: 1,
      explanation: '现代 CPU 会挖指令级并行,但对程序员维持按序结果这个抽象。',
      checklistRef: 'c1',
      mcRef: null,
    },
    {
      id: 'q2',
      question: 'SIMD 为什么能提高每瓦性能?',
      options: [
        '一条指令同时处理多份数据,把取指译码调度成本摊薄',
        '它让内存容量翻倍',
        '它让每个数据都拥有一个完整 CPU',
        '它取消了所有发热',
      ],
      answerIndex: 0,
      explanation: 'SIMD 的账本是"一次喊口令,一排数据一起动",控制成本被分摊。',
      checklistRef: 'c2',
      mcRef: 'os_gpu_M1',
    },
    {
      id: 'q3',
      question: 'CUDA 的 kernel 最像下面哪件事?',
      options: [
        '给每个像素或数据元素发同一张作业单,让它们按自己的坐标各算一份',
        '让一个线程独自把所有像素从头算到尾',
        '让操作系统自动猜程序员想干什么',
        '把程序变成屏保',
      ],
      answerIndex: 0,
      explanation: 'CUDA 把海量同构小任务包装成大量轻量线程运行同一段 kernel。',
      checklistRef: 'c3',
      mcRef: 'os_gpu_M1',
    },
    {
      id: 'q4',
      question: 'SIMT 和"堆很多完整 CPU"的区别在哪里?',
      options: [
        'SIMT 一束线程共享取指译码和一个口令来源,各自保留寄存器',
        'SIMT 没有任何寄存器',
        'SIMT 只能处理声音',
        'SIMT 每次只能启动一个线程',
      ],
      answerIndex: 0,
      explanation: 'SIMT 省的是控制前端,不是取消线程各自的数据。',
      checklistRef: 'c4',
      mcRef: 'os_gpu_M3',
    },
    {
      id: 'q5',
      question: '为什么 `map[row * 1920 + col]` 和 `map[row + col * 1080]` 可能速度差很多?',
      options: [
        '后者数学上一定算错',
        '前者更容易让相邻线程访问连续地址,硬件能把访问合并起来',
        '因为 1920 比 1080 更吉利',
        '因为 GPU 不认识加号',
      ],
      answerIndex: 1,
      explanation: '逻辑等价不代表硬件访问形状等价,连续访存能触发合并,乱访存会掉速。',
      checklistRef: 'c5',
      mcRef: 'os_gpu_M3',
    },
    {
      id: 'q6',
      question: '下面哪句话最符合 CPU 与 GPU 的分工?',
      options: [
        'GPU 核多,所有程序都该搬过去',
        'CPU 负责复杂控制和调度,GPU 接走海量同构、访存规整的重活',
        'CPU 只能开机,GPU 只能关机',
        '两者功能完全一样,只是名字不同',
      ],
      answerIndex: 1,
      explanation: 'GPU 是特定形状任务的加速器,不是替代 CPU 的万能机器。',
      checklistRef: 'c5',
      mcRef: 'os_gpu_M2',
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟看懂:为什么显卡能一口气喊动百万小工',
      body:
        '把这讲想成"从一个大厨到一排流水线小工",五个要点就串起来了:\n\n' +
        '1. **CPU 也在偷偷并行**。程序员看到的是一条条顺序执行,但处理器内部会找没依赖的指令同时做,再按顺序交结果。' +
        '这套指令级并行换来单线程速度,也换来复杂调度和发热;功耗公式 P = C V² f 把单核继续提频卡住了。\n' +
        '2. **SIMD 先把口令摊薄**。喊一条指令的成本差不多固定,那就让一条指令同时算一排数据。MMX、SSE、AVX 到 AVX-512,本质都是把更宽的寄存器当成一排格子。\n' +
        '3. **图形任务天生像流水线**。满屏像素、顶点都按同一段规则算,早期固定管线如此,后来 shader 能编程,CUDA 再把它变成"给海量小任务启动轻量线程"。\n' +
        '4. **SIMT 共享口令**。GPU 不给每个线程配完整大脑,而是一束线程共享一个 PC 和取指译码;每个线程保留自己的寄存器,所以同一条指令能写不同像素。\n' +
        '5. **队伍不齐就掉速**。相邻线程访问连续地址会合并成大访问;分支乱、循环长短不一,最慢的人拖住整束。讲义里 Mandelbrot 在 RTX 4060Ti 上 6.1s@42W,比 Ryzen 5 9600X 的 25.1s@65W 快,但它因不确定循环并不算特别友好。\n\n' +
        '判断口诀:**CPU 拼单兵,向量摊口令;GPU 发工牌,一束听同令;队形齐就快,走散就慢。**\n\n' +
        '**讲课节奏建议**\n\n' +
        '- 先讲①②,把"单核快但贵"和"宽刷子摊成本"讲清,小白才不会把 SIMD 误认成 GPU。\n' +
        '- ②讲完马上防 M1:SIMD 不是很多线程,只是宽口令;接着用满屏像素引出 shader/CUDA。\n' +
        '- 中场把"每个小格子跑同一段代码"串稳,再讲 SIMT 的一个口令管一束线程。\n' +
        '- 讲完④后防 M3:不是一堆完整 CPU。再用访存连续、分支拖慢讲清边界,最后防 M2:GPU 不是替代 CPU。\n\n' +
        '**一句话收束**\n\n' +
        '**GPU 的神奇不在每个小工都聪明,而在一大排小工做同一类活、听同一个口令、拿连续材料时,控制成本被摊到极薄。**\n\n' +
        '**再深一锹(选读)**\n\n' +
        '- **从游戏到 AI**。GPU 先为画图而生,可编程 shader 让它越来越像通用机器;CUDA 没先在科学计算里改天换地,却赶上了 AI 的矩阵大潮。\n' +
        '- **内存比算术更像瓶颈**。很多 GPU 程序不是算不过来,而是数据没按队形送到;同一公式换个下标顺序,速度就可能天差地别。\n' +
        '- **SIMT 不是魔法并行**。它省了控制成本,但把"队伍必须齐"这个条件写进了硬件性格里。',
    },
    examples: [
      {
        title: '例 1:一条口令算四格',
        code:
          '普通写法: for (int i = 0; i < 4; i++) c[i] = a[i] + b[i];\n' +
          'SIMD 画面: [a0 a1 a2 a3] + [b0 b1 b2 b3] -> [c0 c1 c2 c3]\n' +
          '一次取指译码,四个小格一起加',
        walkthrough:
          '这不是四个线程各跑一遍循环,而是一条更宽的指令处理四份数据。讲的时候抓住"调度成本被分摊",' +
          '别把它讲成 GPU 已经出现。',
      },
      {
        title: '例 2:每个像素一张工牌',
        code:
          '__global__ void paint(int *screen) {\n' +
          '  int row = blockIdx.y * blockDim.y + threadIdx.y;\n' +
          '  int col = blockIdx.x * blockDim.x + threadIdx.x;\n' +
          '  screen[row * 1920 + col] = f(row, col);\n' +
          '}',
        walkthrough:
          'kernel 里每个线程用自己的 blockIdx、blockDim、threadIdx 算坐标,但大家执行的是同一段代码。' +
          '这正是从 shader 到 CUDA 的桥:不是一个大工人扫完全屏,而是每个小格子各算一份。',
      },
      {
        title: '例 3:同样写一张表,队形不同速度不同',
        code:
          '好队形: map[row * 1920 + col] = t;  // 一排人写相邻格子\n' +
          '坏队形: map[row + col * 1080] = t;  // 一排人跳着拿格子\n' +
          '分支坑: while (没有逃逸) { 继续算; } // 最慢的人拖住整束',
        walkthrough:
          '两种下标写出来的结果可以等价,但硬件看到的访问形状完全不同。连续访问容易合并,跳着访问要东一榔头西一棒槌;' +
          '分支也是同理,一束线程共享口令,有人绕很久,大家就得等。',
      },
    ],
    selfCheck: [
      '能用一句话说清 CPU 为什么"顺序执行是假象",以及这套快法为什么耗电吗?',
      '能把 SIMD 讲成"一条口令一排数据",而不是误讲成"很多完整线程"吗?',
      '能从满屏像素的例子自然过渡到 shader、GPGPU 和 CUDA kernel 吗?',
      '小白要是坚持「SIMT 就是一堆完整小 CPU」,你的反驳(一个 PC 管一束、各自寄存器)想好了吗?',
      '能说清 GPU 为什么适合批量同构任务,却不适合随处拐弯的业务逻辑吗?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「SIMD 不就是一条指令带很多线程吗,GPU 只是把寄存器加长的换皮版吧?」' +
      '带着这个问题去读下面的材料,想好你打算怎么给它讲明白。纠不动它,它会开心地把错的学走。',
    references: [
      {
        title: 'CPU、GPU 和 SIMT 编程模型',
        url: 'https://jyywiki.cn/OS/2026/lect20.md',
        kind: '讲义',
        note:
          '本讲蓝本:从 CPU 指令级并行、SIMD、图形流水线一路讲到 CUDA 与 SIMT,关键数字和课堂实验都以此为准。',
      },
      {
        title: '20 - CPU、SIMD 和 GPU [2026 南京大学操作系统原理]',
        url: 'https://www.bilibili.com/video/BV1df536aEMk',
        kind: '视频',
        note:
          'UP 主「绿导师原谅你了」(jyy 官方号):本讲课堂实录,适合跟着看 Mandelbrot、SIMT 单步执行和访存合并的现场演示。',
      },
      {
        title: 'Operating Systems: Three Easy Pieces',
        url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
        kind: '教程',
        note:
          '课程参考书官网:用来补齐操作系统视角下"并发/并行抽象"的底层世界观,与本讲轻量线程和硬件加速器形成呼应。',
      },
      {
        title: 'CUDA C++ Programming Guide',
        url: 'https://docs.nvidia.com/cuda/cuda-c-programming-guide/',
        kind: '官方文档',
        note:
          'NVIDIA 官方 CUDA 编程指南:查 kernel、threadIdx/blockIdx、warp、memory coalescing 等术语的权威入口。',
      },
      {
        title: 'Fast Matrix Multiplication using Graphics Hardware',
        url: 'https://dl.acm.org/doi/10.1145/383259.383286',
        kind: '论文',
        note:
          '讲义提到的早期 GPGPU 代表工作:把矩阵乘法改写成图形硬件能跑的形式,能看见 shader 被黑进通用计算的历史转折。',
      },
      {
        title: 'NVIDIA GeForce 8800 GPU Architecture Overview',
        url: 'https://www.nvidia.com/content/PDF/technical_briefs/GeForce_8800_GPU_Architecture_Overview.pdf',
        kind: '官方文档',
        note:
          'GeForce 8800/G80 是讲义点名的首个 CUDA GPU 一代,这份架构概览可补充 scalar thread processor 与统一着色架构背景。',
      },
    ],
  },
};

export const osGpuDemo: DemoLine[] = [
  {
    label: '① 讲:CPU 顺序执行是假象',
    text:
      '我们先从 CPU 讲起。你写的程序看上去是一条指令接一条指令顺序执行,但这个顺序执行其实是个被维护出来的假象。' +
      '现代处理器内部会做指令级并行:先译码多条指令,看它们有没有数据依赖,没依赖就可以乱序发射出去一起干,' +
      '最后再按程序顺序把结果提交回来。这样单线程跑得快,代价是处理器里面那套排队、分析、重命名的控制电路很复杂,' +
      '也很费电;到了功耗墙面前,频率和发热都不能无限往上堆。',
    note: '命中 c1(CPU 顺序执行是假象/指令级并行/功耗墙)→ 小白开窍复述,追问 c2(一条口令能不能搬一排砖)',
  },
  {
    label: '② 讲:SIMD 是宽刷子',
    text:
      '于是第一招是 SIMD,也就是一条指令处理多个数据。喊一条指令要付取指、译码、调度这些固定成本,' +
      '如果这条口令只让一个数字干活,成本就全压在它身上;如果把一个大寄存器切成一排小格,让一条指令同时算很多格,' +
      '调度成本就被分摊了。就像刷墙时不用小刷子一格一格刷,而是换一把宽刷子横着刷过去,一次能盖住一整排。',
    note: '命中 c2 + 金句类比收录(宽刷子)→ 触发 M1 注入:「SIMD 就是 GPU 换皮?」',
  },
  {
    label: '③a 被带偏(演示盲区暴露)',
    text:
      '呃……听起来还真像。那我就记成:一条指令带很多线程一起跑,把寄存器加长一点就够了,' +
      'GPU 本质上就是 CPU 里这套宽口令的换皮版,不用再分得那么细。',
    note: 'M1 判定"被带偏"(命中「一条指令+很多线程/就是+换皮」)→ 小白开心学错,关联题必错',
  },
  {
    label: '③b 正确纠正(对照分支)',
    text:
      '不对,它不是换皮。SIMD 仍然是在 CPU 里调度的一条宽指令,会继续参与缓存、流水线和功耗竞争;' +
      'GPU 这条路线来自另一种需求:图形里有海量小格子,比如像素和顶点,每个小格子都要跑同一段代码,只是坐标和数据不同。' +
      '早期固定管线是按死流程画图,后来 shader 允许给这些小格子写程序,再后来 CUDA 把这个想法包装成 kernel:' +
      '一次启动成千上万个轻量线程,给每个像素或数据元素发工牌,让它们各自算一份。',
    note: 'M1 判定"已纠正"(命中「不是+换皮/仍然+CPU+调度」)+ 顺势命中 c3(shader/CUDA/像素同一段代码)→ 追问 c4',
  },
  {
    label: '④ 串讲:从宽口令到满屏小工',
    text:
      '我把前面串一下:CPU 为了让一个大厨快一点,在厨房里偷偷排队、挑能同时做的菜;后来又给大厨一把宽刷子,' +
      '这就是 SIMD 那把宽刷子,一次刷一排。可画图这件事更像满屏小工各自给自己的格子上色:大家拿到的坐标不同,但做的流程差不多,' +
      '所以我们干脆给每个小格子发同一张作业单,让它们一起开工。',
    note: '复述巩固(无新命中,但与 CPU/SIMD/shader/CUDA 路线有交集)→ 小白追问 c4;Lv5 人格在此轮提前迁移',
  },
  {
    label: '⑤ 讲:SIMT 是一位领队喊一束人',
    text:
      '真正省到极致的是 SIMT:Single Instruction, Multiple Threads。它不是给每个线程都配一套完整的前端,' +
      '而是一个 PC 也就是一个 Program Counter 管一束线程;NVIDIA 常把这一束叫 thread warp。' +
      '同一个取指和译码单元喊出同一条指令,这一束人一起执行,但每个线程的寄存器里有自己的 row、col、color,' +
      '所以同一条 store 指令落到不同像素上。典型情况下,一个 warp 是 32 个线程。',
    note: '命中 c4(SIMT/一个 PC/thread warp/同一个取指)→ 触发 M3 注入:「每个线程都是完整小 CPU?」',
  },
  {
    label: '⑥ 纠正 M3 + 讲访存合并',
    text:
      '不对,SIMT 不是把完整 CPU 堆很多份。它省掉的正是每个线程各自取指译码的那套复杂前端:一束线程听同一套取指口令,' +
      '只有一个 PC 控节奏,但各自保留寄存器,所以同一条指令能用不同坐标写不同格子。也正因为大家听同一个口令,' +
      '队形就很重要:如果相邻线程访问连续地址,Memory coalescing 会把许多小访问合并得像一次 128-byte store;' +
      '可你把下标从 map[row * 1920 + col] 改成 map[row + col * 1080],逻辑也许等价,性能可能大跌。' +
      '再比如 Mandelbrot 里有不确定的 while 循环,一束里最慢的那个人会拖慢整束。',
    note: '纠正 M3(命中「不是+完整 CPU/一个 PC/同一套+取指」)+ 命中 c5 → 同轮衔接注入 M2(GPU 万能替代 CPU?)',
  },
  {
    label: '⑦ 纠正 M2(收尾)',
    text:
      '也不能这么说,GPU 不是 CPU 的替代品,而是适合特定形状任务的加速器。它最喜欢同一段代码作用在海量数据上,' +
      '而且分支少、访问位置规整,整队人能齐步走;像图片处理、矩阵计算、物理模拟就很合胃口。' +
      '但业务逻辑、网页后台、操作系统这种活经常到处判断、少量请求、数据位置也散,GPU 并不擅长。' +
      '所以真实机器里是 CPU 和 GPU 分工:CPU 管复杂控制和调度,GPU 接走那些批量、整齐、算得很重的活。',
    note: '纠正 M2(命中「不是+替代/同一段代码+海量/CPU+GPU+分工」)→ 三误区全纠正、五要点全命中',
  },
  {
    label: '卡壳演示(触发 R1 救援)',
    text: '嗯……这段我卡住了,后面该怎么接我一下子想不起来了……',
    note: '卡壳信号 → 小白递台阶(R1);连续两次 → 一起查书(R2)',
  },
  {
    label: '偏题演示(内容围栏)',
    text: '小白,周末江边有露天音乐会,要不要一起去占个前排,顺便买杯热饮?',
    note: '偏题 → 小白角色内拉回:「这跟今天的知识点没关系吧」',
  },
];

/**
 * 摸底快测题组(聚合于 src/data/selfTest.ts)。
 * 出题纪律:不与 quizBank / probe 题干重复,只考同一要点的另一侧面;
 * 干扰项须是"听着有道理的常见误解",每题至多一个略带幽默的。
 * 分寸沿用文件头内容红线:GPU 是特定任务加速器,不是替代 CPU 的万能机器。
 */
export const osGpuSelfTest: SelfTestItem[] = [
  {
    id: 'st1',
    dimension: '概念',
    question: 'CPU 内部那套"偷偷并行"最像下面哪种做法?',
    options: [
      '厨师看到两道菜互不影响,就同时开两个灶,最后仍按菜单顺序上菜',
      '厨师随机把菜单撕掉一半',
      '所有菜都交给隔壁饭店做',
      '厨师闭眼猜哪道菜更香',
    ],
    answerIndex: 0,
    explanation: '没依赖的活可以先并行做,但交付结果仍维持程序顺序。',
    checklistRef: 'c1',
    mcRef: null,
  },
  {
    id: 'st2',
    dimension: '推演',
    code: '64-bit 寄存器当成 4 个 16-bit 小格\n一次加法: [1,2,3,4] + [5,6,7,8]',
    question: '这笔账体现的是哪种思想?',
    options: [
      '一条口令处理多份数据,把控制成本摊薄',
      '四个完整线程分别写四个程序',
      '把数据先变成图片再显示',
      '让寄存器排队买票',
    ],
    answerIndex: 0,
    explanation: '宽寄存器把一条指令变成一排数据一起算,正是 SIMD 的画面。',
    checklistRef: 'c2',
    mcRef: 'os_gpu_M1',
  },
  {
    id: 'st3',
    dimension: '应用',
    question: '要把一张 4000×3000 照片每个像素都调暗 10%,最自然的并行拆法是?',
    options: [
      '每个像素拿同一段小程序,按自己的坐标各算各的',
      '让一个线程独自把所有像素从头算到尾',
      '先把照片打印出来用铅笔涂黑',
      '让操作系统猜哪些像素比较重要',
    ],
    answerIndex: 0,
    explanation: '每个像素同构独立,正适合 shader/CUDA 这种海量小任务模型。',
    checklistRef: 'c3',
    mcRef: null,
  },
  {
    id: 'st4',
    dimension: '辨析',
    question: '说"GPU 快是因为每个线程都有一颗完整小 CPU",问题在哪?',
    options: [
      '问题在太保守,其实每个线程有两颗',
      'SIMT 共享控制前端和口令来源,线程只是各自保留寄存器和数据',
      'GPU 没有线程这个概念',
      '完整小 CPU 只在周末上班',
    ],
    answerIndex: 1,
    explanation: 'SIMT 的省法是共享控制、保留数据独立,不是复制完整 CPU。',
    checklistRef: 'c4',
    mcRef: 'os_gpu_M3',
  },
  {
    id: 'st5',
    dimension: '边界',
    question: '同一束人写内存时,哪种队形更容易跑快?',
    options: [
      '第一个写 0 号格,第二个写 1 号格,第三个写 2 号格,一路相邻',
      '第一个写 0 号格,第二个跳到 1080 号格,第三个再跳很远',
      '每个人写之前先掷骰子决定地址',
      '大家一起写同一张便利贴再抢回来',
    ],
    answerIndex: 0,
    explanation: '相邻线程访问连续地址,硬件才容易把小访问合成大访问。',
    checklistRef: 'c5',
    mcRef: null,
  },
  {
    id: 'st6',
    dimension: '边界',
    question: '一个任务里每个数据都要走不同 if 分支,有的还要循环很久,这对 GPU 意味着什么?',
    options: [
      '正中下怀,越乱越快',
      '同一束线程会被分支和最慢路径拖住,优势可能被吃掉',
      'GPU 会自动把 if 删除',
      '循环久的人会收到加班费',
    ],
    answerIndex: 1,
    explanation: 'SIMT 队伍怕走散,分支分叉和长短不一的循环会拖慢整束。',
    checklistRef: 'c5',
    mcRef: 'os_gpu_M2',
  },
  {
    id: 'st7',
    dimension: '应用',
    question: '给一个网站后台做技术选型,哪种说法最稳?',
    options: [
      '只要有 GPU,数据库查询、权限判断、订单规则都该搬过去',
      '先看任务形状:批量同构重计算可考虑 GPU,复杂控制和少量请求仍让 CPU 主持',
      '后台程序不需要硬件',
      '把服务器显示器换大一点就能加速',
    ],
    answerIndex: 1,
    explanation: 'CPU/GPU 的边界看任务形状,不是看谁核心数更吓人。',
    checklistRef: 'c5',
    mcRef: 'os_gpu_M2',
  },
];
