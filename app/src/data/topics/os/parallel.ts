/**
 * 知识点:并行算法与数据结构(《操作系统原理》第 18 讲)。
 * 讲义:https://jyywiki.cn/OS/2026/lect18.md
 * 视频:https://www.bilibili.com/video/BV1WqdTBiEkN
 * 关键词组与本文件导出的 osParallelDemo 预埋话术互相咬合,
 * 改动任一侧必须同步校验(scripts/simulate.ts)。
 *
 * 演示编排(与 attention/osOverview 同构):
 *   ① c1(正确不等于跑得快) → ② c2(把大活拆成少抢门的活)+金句 → 注入 M1(线程越多越快)
 *   ③b 纠正 M1 + 顺势命中 c3(静态切分的算力农活) → ④ 串讲无新命中(Lv5 在此轮提前迁移)
 *   ⑤ c4(先记小账再汇总) → 注入 M3(每人一份就彻底不用管共享)
 *   ⑥ 纠正 M3 + 命中 c5(拆锁也会拆出坑) → 同轮衔接注入 M2(锁越细越好) → ⑦ 纠正 M2 收尾
 *
 * 内容红线(备课研究核定):
 *   - 不说「加锁就一定慢」:小规模、低竞争、临界区少时,一把锁可能已经足够;性能必须看 workload 和实测;
 *   - 不说「最终一致性总是可以接受」:只有读到旧值不伤业务语义时才可放松精确顺序;
 *   - 不把 thread_local 说成「共享变量的替代品」:它只是每线程一份拷贝,需要全局结果时仍要合并;
 *   - 不说「细粒度锁必然更快」:锁拆多会带来顺序、死锁、resize、遍历等复杂度,脱离负载优化就是耍流氓;
 *   - 关键数字皆来自讲义/OSTEP:求和实验 T=1/2/4/8/16 且重复 5 次;Sloppy counter 示例阈值 100;
 *     CRAY-1(1976)为 138 MFLOPS @ 115kW;OpenMP 示例 num_threads(128)、循环 1024 次;
 *     OSTEP 近似计数器阈值 S 越大越可扩展,但全局值最多落后 CPU 数 × S。
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osParallelTopic: Topic = {
  topicId: 'os-parallel',
  title: '并行算法与数据结构',
  course: '操作系统原理',
  tagline: '少抢同一扇门,才跑得起来',
  transferHint: '一群人同时往同一本登记册写名字时,能不能先各自记小纸条,隔一会儿再汇总',
  checklist: [
    {
      id: 'c1',
      point: '正确不等于跑得快',
      groundTruth:
        'sum++ 用互斥锁包住可以得到完全的 serializability:release → acquire,并确保可见,因此结果正确;' +
        '但如果每次操作都挤进同一个小临界区,同步开销和等待会成为瓶颈,scalability 很差,性能不能随 CPU、线程或机器增加而增长。' +
        '讲义要求对自旋锁、互斥锁、原子指令做控制变量实验:总 sum++ 次数固定,T=1/2/4/8/16 个线程,每种实现重复 5 次并画 error bar。' +
        '结论不是「锁必慢」,而是先确认共享瓶颈和 workload,再减少不必要同步。',
      keywords: [
        ['serializability', 'scalability'],
        ['性能', '线程', '增长'],
        ['同步', '瓶颈'],
        ['临界区', '等待'],
      ],
      terms: ['serializability', 'scalability', '互斥锁', '同步', '临界区', 'sum++'],
      level: 'L1',
      lookupCard:
        '**先保正确,再问能不能跑快**\n\n' +
        '`sum++` 外面包一把**互斥锁**,能让每次更新像排队过独木桥一样发生:前一次放手(release),后一次再拿到(acquire),结果可见且正确。\n\n' +
        '问题是:如果所有人每次都挤进同一个**临界区**,线程越多,等待越多,**scalability** 反而很差。' +
        '讲义让你固定总次数,用 T=1/2/4/8/16 个线程比较自旋锁、互斥锁和原子指令,每组重复 5 次画误差线。\n\n' +
        '分寸:小负载下一把锁可能够用;性能结论必须看 workload 和实测。',
      probeLine: '老师,是不是只要给门口加一位看门人,来的人越多,办事就一定越快呀?',
    },
    {
      id: 'c2',
      point: '把大活拆成少抢门的活',
      groundTruth:
        'Scale up/scale out 的第一步是分解问题:只在 get() 取任务时短暂进入临界区,拿到 job 后把 job->run() 放到 mostly thread-local computation 中执行,' +
        '完成后 job->done() 唤醒后继任务。job->run() 的同步条件是所有 predecessors 完成;可以用条件变量直接等这个条件,也可以用信号量表示还差几把钥匙。' +
        '只要 job->run() 的时间远大于互斥时间,就有机会扩展;计算图的深度限制关键路径,宽度提供可并行空间。',
      keywords: [
        ['分解', '局部'],
        ['job->run'],
        ['DAG'],
        ['前驱'],
        ['宽度', '深度'],
      ],
      terms: ['job->run', 'DAG', '前驱', '条件变量', '信号量', '局部计算'],
      level: 'L2',
      lookupCard:
        '**少抢门,多干自己的活**\n\n' +
        '讲义里的骨架是:\n\n' +
        '```c\nmutex_lock(&lk);\njob = get();\nmutex_unlock(&lk);\n\njob->run();   // mostly thread-local computation\njob->done();  // enable other jobs\n```\n\n' +
        '关键是把共享的门口缩短:只在取任务时排一下队,真正耗时的 **job->run** 尽量变成**局部计算**。' +
        '若任务之间有依赖,就把它看成 **DAG**:所有**前驱**完成,这个任务才能跑。深度是最短也绕不开的关键路径,宽度才是能并排开的活。',
      probeLine: '老师,能不能把一大摊活切成好多小摊,让大家各干各的,最后再合起来呀?',
    },
    {
      id: 'c3',
      point: '静态切分的算力农活',
      groundTruth:
        '高性能计算常见于数值密集型任务,很多问题有空间局部性:划分网格后,除边界外可独立计算;Linpack 的稠密矩阵 Ax=b、有限元、Mandelbrot 每像素求值都适合静态切分。' +
        'Embarrassingly parallel 几乎不需要同步/通信,如 fork-based dfs、Monte Carlo、视频逐帧处理。' +
        '并行编程通常做机器-线程两级任务分解,用生产者-消费者按轮同步;MPI 是 message passing libraries,OpenMP 是 C/C++/Fortran 上的共享内存并行编程接口。' +
        '讲义的 gpt.c 示例中,若没有 -fopenmp 编译选项,#pragma 会被直接忽略。',
      keywords: [
        ['高性能计算'],
        ['Mandelbrot'],
        ['OpenMP'],
        ['MPI'],
        ['静态切分'],
        ['像素', '独立'],
      ],
      terms: ['高性能计算', 'Mandelbrot', 'OpenMP', 'MPI', 'Linpack', 'Embarrassingly parallel'],
      level: 'L3',
      lookupCard:
        '**适合并排干的活,长得很像农田**\n\n' +
        '**高性能计算**里的很多任务有空间局部性:把区域切成小块,中间大多能各算各的,只在边界交换一点消息。' +
        '**Mandelbrot** 更极端:每个像素的计算完全独立,天然适合静态切分。\n\n' +
        '工具层面,**MPI** 适合机器之间传消息,**OpenMP** 适合同一台机器的共享内存并行。' +
        '但工具不是魔法:没有足够独立的活,开再多线程也只是排队。',
      probeLine: '老师,哪些活真的能一人分一块,几乎不用互相等来等去呀?',
    },
    {
      id: 'c4',
      point: '先记小账再汇总',
      groundTruth:
        '并行数据结构不一定都需要完全严格的顺序:如果业务允许 load 看到“不太离谱”的旧值,仍保持最终一致性,就可以放松全局精确更新。' +
        '讲义的 Sloppy counter 示例让每个线程先更新 sum_local[tid],局部计数到 100 才拿全局锁把值加到 sum,再把本地清零。' +
        'C/C++ 的 thread_local 提供每线程一份自动拷贝,避免维护全局 map<tid, storage>;实现上通常有 .tdata/.tbss,大小编译期确定,x86-64 可用 fs 段寄存器作为 TLS base。' +
        'OSTEP 的近似计数器同样展示阈值 S 的权衡:S 小更精确但性能差,S 大更可扩展但全局值最多落后 CPU 数 × S。',
      keywords: [
        ['最终一致性'],
        ['本地', '攒'],
        ['100', '汇总'],
        ['旧值', '不离谱'],
        ['thread_local'],
      ],
      terms: ['最终一致性', 'Sloppy counter', 'thread_local', 'TLS', '全局计数', '近似计数器'],
      level: 'L3',
      lookupCard:
        '**有些账,不用每一笔都立刻进总账**\n\n' +
        '如果读者偶尔看到稍旧的数也不伤大局,可以追求**最终一致性**:先在本地攒,隔一段再汇总。' +
        '讲义的 **Sloppy counter** 是这样写的:每个线程先改自己的 `sum_local[tid]`,攒到 100 才拿一次全局锁合入总数。\n\n' +
        '**thread_local** 是语言给你的每线程一份小抽屉;OSTEP 的**近似计数器**也有同一个分寸:阈值越大越快,但总账越可能暂时落后。',
      probeLine: '老师,如果大家只是往总账上添一笔,能不能先记在自己的小本子里,隔一会儿再汇总呀?',
    },
    {
      id: 'c5',
      point: '拆锁也会拆出坑',
      groundTruth:
        '并行数据结构的核心是减少共享冲突:数据结构天然分散存储,读写一部分未必需要锁住整个结构;能用原子指令就不用锁,也可以用 reader/writer lock、segment/element-wise lock。' +
        '哈希表可按 bucket 加锁,甚至用读写锁,让不同 key 的操作并行。' +
        '但 open addressing 会让并发查找、删除、遍历和 tombstone 管理变复杂;resize 会摧毁已有数组,简单做法是阻止 resize 与任何并发访问,相当于持有 write lock。' +
        '每个操作若同时拿 bucket lock 和 resize lock,必须规定顺序,否则可能死锁。复杂方案很难,所以要对库函数保持敬畏。',
      keywords: [
        ['原子指令'],
        ['读写锁'],
        ['bucket', 'resize'],
        ['拆锁'],
        ['死锁'],
        ['open addressing'],
      ],
      terms: ['原子指令', '读写锁', 'per-bucket lock', 'resize', 'open addressing', 'tombstone', '死锁'],
      level: 'L5',
      lookupCard:
        '**把整本账本抱走,不如只管正在写的那页**\n\n' +
        '数据结构本来就是分散的:数组格子、链表节点、树枝、哈希桶。能用**原子指令**就不用上锁;要上锁,也可用**读写锁**、分段锁、逐元素锁。' +
        '哈希表常见办法是 **per-bucket lock**:不同 key 落到不同桶,就能并行。\n\n' +
        '坑在维护动作: **resize** 可能搬空整个数组,**open addressing** 还有删除和 **tombstone** 的麻烦。' +
        '一旦同一操作要拿多把锁,顺序错了就可能**死锁**。细粒度不是免费午餐。',
      probeLine: '老师,一本大账本能不能只闩住正在写的那一页,别把整本都抱走呀?',
    },
  ],
  misconceptions: [
    {
      mcId: 'os_parallel_M1',
      topicId: 'os-parallel',
      belief: '只要把任务分给更多线程,速度就会按线程数一路线性变快',
      triggerLine:
        '哦!那我明白了:并行就是人多力量大嘛,任务只要切开,线程越多就肯定越快,最好有几个核就开满几个核,' +
        '速度应该差不多按人数翻倍,对吧?',
      correctionCriteria: [
        '指出线程数增加不保证线性加速,共享瓶颈、同步和通信会吃掉收益',
        '说明只有独立工作足够多、关键路径短、同步时间远小于本地计算时间时才可能扩展',
        '能用 Mandelbrot/网格/Monte Carlo 等静态切分例子说明什么样的任务适合并行',
      ],
      correctionKeywords: [
        ['不是', '线性'],
        ['同步', '通信'],
        ['独立', '切分'],
        ['关键路径'],
      ],
      adoptionKeywords: [
        ['线程越多', '越快'],
        ['按人数', '翻倍'],
        ['开满', '核'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: '任务只要能切开,线程越多速度就一定按线程数线性变快。',
        isTrue: false,
        explanation: '线程多只提供机会;共享瓶颈、同步、通信和关键路径都会吃掉收益,只有独立工作足够多且同步很少才可能扩展。',
      },
      remedy: {
        microLesson: {
          title: '人多不是魔法,门口堵住就没用',
          body:
            '把并行想成一群人搬书:如果每个人都能抱一摞去不同书架,当然快;可如果所有人每抱一本都要回同一个门口盖章,门口就成了队伍。\n\n' +
            '判断能不能快,先看三件事:\n\n' +
            '1. 活是不是足够独立,能不能静态切成块;\n' +
            '2. 关键路径有多长,有没有必须前一个干完后一个才能动的链条;\n' +
            '3. 等门口、传消息、合并结果的时间,是不是远小于各自干活的时间。\n\n' +
            '像 Mandelbrot 每个像素独立,开人手很划算;像每一步都要抢同一本总账,开再多人也只是在排队。\n\n' +
            'askBack: 下次小白再说「线程越多越快」,你准备用哪三个问题先拆它的直觉?',
          askBack: '下次小白再说「线程越多越快」,你准备用哪三个问题先拆它的直觉?',
        },
        predictionQuiz: [
          {
            id: 'pa-r1-1',
            question: '同一个小门口每次只放一个人通过,来的人从 2 个变 16 个,最可能发生什么?',
            options: ['大家飞一样通过', '门口排队变长,总速度未必变好', '门口自动变成 16 个', '管理员开始发奶茶'],
            answerIndex: 1,
            explanation: '共享瓶颈没拆掉,增加人手只会增加等待;并行的前提是门口之外有足够多独立工作。',
            checklistRef: 'c1',
            mcRef: 'os_parallel_M1',
          },
          {
            id: 'pa-r1-2',
            question: '哪种活最像讲义里的 Mandelbrot 图?',
            options: [
              '每个格子的答案几乎都能单独算',
              '所有人必须轮流改同一个数字',
              '下一步必须等上一步的结果',
              '大家先猜拳决定谁工作',
            ],
            answerIndex: 0,
            explanation: '每块几乎独立,同步/通信少,才适合静态切分后并排干。',
            checklistRef: 'c3',
            mcRef: 'os_parallel_M1',
          },
          {
            id: 'pa-r1-3',
            question: '看到「开 8 个线程比 4 个线程还慢」,最合理的第一反应是?',
            options: [
              '并行理论被推翻了',
              '先查共享瓶颈、同步/通信开销和负载是否真的够大',
              '马上开 800 个线程压过去',
              '把电脑夸一夸让它努力',
            ],
            answerIndex: 1,
            explanation: '性能要看 workload 和实测;线程数只是变量之一,不是加速保证书。',
            checklistRef: 'c1',
            mcRef: 'os_parallel_M1',
          },
        ],
      },
    },
    {
      mcId: 'os_parallel_M2',
      topicId: 'os-parallel',
      belief: '把每个小格子都单独上锁,锁拆得越细就一定越安全、越快',
      triggerLine:
        '可是老师,我觉得这事也没那么难吧:整本账本不能锁,那就每个小格子都单独上锁呗。' +
        '锁越细,大家越不互相挡路,应该一定更安全也一定更快,对吧?',
      correctionCriteria: [
        '指出细粒度锁会增加拿锁顺序、死锁、遍历、删除、resize 等复杂度',
        '说明哈希表 per-bucket lock 有用,但 resize/open addressing/tombstone 让问题变难',
        '强调是否值得拆锁必须结合 workload 实测,不是越细越好',
      ],
      correctionKeywords: [
        ['不是越细越好'],
        ['固定顺序'],
        ['resize', '死锁'],
        ['workload', '实测'],
      ],
      adoptionKeywords: [
        ['越细', '越好'],
        ['每个小格子', '上锁'],
        ['一定更安全', '一定更快'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: '细粒度锁只会带来好处:锁越细,一定越安全、越快。',
        isTrue: false,
        explanation: '细粒度能减少冲突,也会带来拿锁顺序、死锁、resize、遍历等复杂度;是否划算必须看负载并实测。',
      },
      remedy: {
        microLesson: {
          title: '锁拆细以后,顺序也得管起来',
          body:
            '给哈希表每个桶一把锁,确实能让不同桶并行;但难点马上来了:\n\n' +
            '```text\n普通插入:拿 bucket lock\n扩容搬家:拿 resize lock,还要阻止所有桶访问\n坏顺序:A 先拿 bucket 再等 resize;B 先拿 resize 再等 bucket → 两边互等\n```\n\n' +
            '开放寻址还会让查找、删除、墓碑管理和遍历绑在一起,不是给每格挂一把锁就万事大吉。\n\n' +
            '真正的判断是:热点是否分散?扩容是否频繁?遍历是否多?多拿几把锁的开销有没有超过省下的等待?答案只能靠 workload 和实测。\n\n' +
            'askBack: 下次小白再说「锁越细越好」,你准备用哪个 resize 死锁故事让它刹车?',
          askBack: '下次小白再说「锁越细越好」,你准备用哪个 resize 死锁故事让它刹车?',
        },
        predictionQuiz: [
          {
            id: 'pa-r2-1',
            question: '哈希表正在扩容搬家时,为什么不能随便让普通操作并发访问旧数组?',
            options: [
              '旧数组可能正在被搬空,访问会看到不一致的结构',
              '因为扩容时 CPU 会睡觉',
              '因为哈希表会变成链表',
              '因为程序员需要休息',
            ],
            answerIndex: 0,
            explanation: 'resize 会重排底层数组;简单做法是把它当成大写锁,阻止并发访问。',
            checklistRef: 'c5',
            mcRef: 'os_parallel_M2',
          },
          {
            id: 'pa-r2-2',
            question: '一个操作要同时拿两把锁时,最基本的安全纪律是什么?',
            options: ['想拿哪把拿哪把', '所有路径按固定顺序拿,避免互相等待', '先拿颜色好看的', '只在周一拿锁'],
            answerIndex: 1,
            explanation: '固定顺序是避免死锁的基本办法;越细的锁越需要这类纪律。',
            checklistRef: 'c5',
            mcRef: 'os_parallel_M2',
          },
          {
            id: 'pa-r2-3',
            question: '什么时候一把大锁反而可能比一堆小锁更合适?',
            options: [
              '操作很少、竞争很低、复杂拆锁收益不明显时',
              '永远不可能',
              '只要代码写得短就一定更慢',
              '当变量名字很长时',
            ],
            answerIndex: 0,
            explanation: '简单方案如果已满足负载,硬拆锁只会增加复杂度;性能优化要看实测。',
            checklistRef: 'c1',
            mcRef: 'os_parallel_M2',
          },
        ],
      },
    },
    {
      mcId: 'os_parallel_M3',
      topicId: 'os-parallel',
      belief: '只要给每个线程一份自己的本地数据,所有共享问题就都消失了,最后也不用再管全局结果',
      triggerLine:
        '那我这下悟了:既然每个人先记自己的小账本这么好,以后所有东西都给每个线程一份不就行了?' +
        '大家互不打扰,彻底不用锁,最后也不用再管什么总账,对吧?',
      correctionCriteria: [
        '指出 thread_local/本地计数只隔离每线程私有副本,不能自动替代需要共享的全局结果',
        '说明需要全局观察时必须按阈值或时机合并,阈值越大越快但越不精确',
        '顺势说明真正共享的数据结构还要靠原子指令、读写锁、分段锁等缩小冲突范围',
      ],
      correctionKeywords: [
        ['不是', '全都不用'],
        ['最后', '合并'],
        ['阈值', '不精确'],
        ['共享结构', '原子指令'],
      ],
      adoptionKeywords: [
        ['所有东西', '每个线程一份'],
        ['彻底不用锁'],
        ['不用再管', '总账'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: '给每个线程一份自己的本地数据后,所有共享问题都消失了,全局结果也不用再合并。',
        isTrue: false,
        explanation: '本地副本只能减少争用;只要还需要全局观察,就必须合并,而合并频率决定精确性与性能的取舍。',
      },
      remedy: {
        microLesson: {
          title: '每人小账本,最后还得交总账',
          body:
            '本地小账本解决的是「别每写一笔都挤同一个门口」,不是让总账消失。\n\n' +
            '```text\n每人先记 1、1、1……\n攒到阈值 S → 去总账合并一次 → 本地清零\nS 小:总账准,但跑得慢\nS 大:跑得快,但总账暂时落后\n```\n\n' +
            '这就是 Sloppy counter / 近似计数器的核心取舍。thread_local 只是让每个线程自动得到自己的抽屉;抽屉里的东西不会自己飞进总账。\n\n' +
            '遇到真正共享的结构,还是要继续缩小冲突:能原子更新就原子更新,读多写少可用读写锁,热点分散可分段或按桶管理。\n\n' +
            'askBack: 下次小白再说「每人一份就不用总账」,你准备用 S 小/S 大这笔账怎么说明取舍?',
          askBack: '下次小白再说「每人一份就不用总账」,你准备用 S 小/S 大这笔账怎么说明取舍?',
        },
        predictionQuiz: [
          {
            id: 'pa-r3-1',
            question: '本地小账本攒得越久才汇总,最直接的好处和代价是什么?',
            options: [
              '好处是少抢总账;代价是别人看到的总数可能暂时偏旧',
              '好处是总数永远最精确;代价是纸张变厚',
              '没有代价,只有好处',
              '代价是所有线程会自动停工',
            ],
            answerIndex: 0,
            explanation: '汇总阈值越大越可扩展,但全局值越可能暂时落后。',
            checklistRef: 'c4',
            mcRef: 'os_parallel_M3',
          },
          {
            id: 'pa-r3-2',
            question: 'thread_local 变量最准确的理解是?',
            options: [
              '所有线程共用同一个变量名和同一块地址',
              '每个线程自动得到一份自己的拷贝',
              '它能自动替你完成总账汇总',
              '它会把变量藏进键盘里',
            ],
            answerIndex: 1,
            explanation: 'thread_local 给每线程一份独立拷贝;需要全局结果时仍要设计合并。',
            checklistRef: 'c4',
            mcRef: 'os_parallel_M3',
          },
          {
            id: 'pa-r3-3',
            question: '读很多、写很少的数据结构,更可能先考虑哪类办法?',
            options: ['所有读也排队', '读写锁:允许多个读者并行,写者独占', '每次读取都扩容', '先把表名改长'],
            answerIndex: 1,
            explanation: '读多写少时,读写锁能减少读者之间不必要的互相阻塞。',
            checklistRef: 'c5',
            mcRef: null,
          },
        ],
      },
    },
  ],
  quizBank: [
    {
      id: 'pa-q1',
      question: '为什么把 `sum++` 严格包在一把锁里,线程多了也可能不快?',
      options: [
        '因为加锁会让 CPU 不认识加法',
        '每次更新都挤进同一个小临界区,等待和同步开销会成为瓶颈',
        '因为线程越多程序越害羞',
        '因为 sum 只能在单核机器上用',
      ],
      answerIndex: 1,
      explanation: '正确性有了,扩展性未必有;所有人反复抢同一小段代码,线程越多越容易排队。',
      checklistRef: 'c1',
      mcRef: 'os_parallel_M1',
    },
    {
      id: 'pa-q2',
      question: '任务图里,哪一项最像“绕不开的最短工期”?',
      options: ['宽度', '深度/关键路径', '变量名长度', '注释数量'],
      answerIndex: 1,
      explanation: '宽度提供并排干的空间,深度/关键路径决定再多人也绕不开的等待链。',
      checklistRef: 'c2',
      mcRef: null,
    },
    {
      id: 'pa-q3',
      question: 'Mandelbrot 图为什么是并行教学里的常见例子?',
      options: [
        '每个像素几乎可以独立计算,天然适合静态切分',
        '它只能在一条线程里画',
        '它需要所有像素每步互相等待',
        '因为名字比较长',
      ],
      answerIndex: 0,
      explanation: '像素彼此独立,同步/通信少,很适合展示“可并排干”的任务形状。',
      checklistRef: 'c3',
      mcRef: 'os_parallel_M1',
    },
    {
      id: 'pa-q4',
      question: 'Sloppy counter 的核心取舍是什么?',
      options: [
        '越早汇总越快,越晚汇总越准',
        '本地先攒再汇总:少抢总账但读数可能暂时偏旧',
        '永远不汇总也能得到精确总数',
        '只要写成英文就会变快',
      ],
      answerIndex: 1,
      explanation: '它用暂时不完全精确换取少争用;阈值决定性能和精确性的平衡。',
      checklistRef: 'c4',
      mcRef: 'os_parallel_M3',
    },
    {
      id: 'pa-q5',
      question: '哈希表按桶加锁的好处和坑分别是什么?',
      options: [
        '好处是不同桶可并行;坑是 resize、遍历、删除和拿锁顺序会变复杂',
        '好处是代码自动变短;坑是键会消失',
        '好处是不用考虑正确性;坑是不能插入',
        '好处是每个桶会自己扩容;坑是桶会吵架',
      ],
      answerIndex: 0,
      explanation: '按桶能减少冲突,但维护整个结构时仍可能要全局协调,尤其是扩容。',
      checklistRef: 'c5',
      mcRef: 'os_parallel_M2',
    },
    {
      id: 'pa-q6',
      question: '看到一个并行优化方案,最该先追问什么?',
      options: [
        '它用了几个时髦词',
        '真实负载是什么、热点在哪、实测是不是更快',
        '作者头像好不好看',
        '代码行数是不是变多',
      ],
      answerIndex: 1,
      explanation: '脱离 workload 做优化就是耍流氓;性能方案必须用真实负载和测量说话。',
      checklistRef: 'c1',
      mcRef: null,
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟看懂:并行不是多开人手这么简单',
      body:
        '1. **正确不等于跑得快**。`sum++` 外包一把锁能保证严格顺序和可见性,但所有线程反复挤同一个小门口,scalability 会很差。讲义要求固定总次数,测 T=1/2/4/8/16 并重复 5 次,就是为了用数据看瓶颈。\n' +
        '2. **先把活拆开**。真正能 scale 的结构是:取任务时短暂排队,拿到任务后长期干自己的本地活;任务之间的依赖可看成一张图,深度是关键路径,宽度才是并排空间。\n' +
        '3. **适合并行的活长得有局部性**。网格、矩阵分块、Mandelbrot 像素、Monte Carlo、逐帧视频,共同点是大部分小块能独立算。OpenMP/MPI 是工具,不是魔法。\n' +
        '4. **数据结构要问精确性需求**。如果读到稍旧数不伤语义,Sloppy counter 可让每人先记小账,攒到 100 再汇总;thread_local 给每线程一份抽屉,但总账仍要合并。\n' +
        '5. **拆锁也会拆出坑**。原子指令、读写锁、按桶上锁能缩小冲突;可 resize、open addressing、tombstone 和多把锁顺序会制造新麻烦。\n\n' +
        '判断口诀:**门口越短越好,本地越长越好;旧数能忍才放松,锁拆越细越要守顺序。**\n\n' +
        '**讲课节奏建议**\n先用 `sum++` 让小白感到“一把锁保正确但排队”;再用厨房分工类比讲任务图;随后用 Mandelbrot 把“真能切”的样子钉住。讲数据结构时,一定先问“能不能接受暂时旧值”,再讲本地小账本。最后用哈希表 resize 收尾,提醒它细锁不是免费午餐。\n\n' +
        '**一句话收束**\n并行优化的本质不是多开线程,而是把共享门口缩到最小,把能独立干的活放到最大,再用真实负载验证是否值得。\n\n' +
        '**再深一锹(选读)**\nOSTEP 的近似计数器把阈值 S 讲得很清楚:S 越大越少抢全局锁,但全局值最多落后 CPU 数 × S;这就是性能与精确性的显式交换。',
    },
    examples: [
      {
        title: '例 1:同一把门闩上的 sum++',
        code:
          'void T_sum() {\n' +
          '  mutex_lock(&lk);\n' +
          '  sum++;\n' +
          '  mutex_unlock(&lk);\n' +
          '}\n\n' +
          '实验:总次数固定,T=1/2/4/8/16,每组重复 5 次,画 error bar',
        walkthrough:
          '这段代码正确,但每次加一都要排队。讲它时不要直接喊“锁慢”,而要说清变量:总工作量固定、线程数变化、实现变化、重复测量。' +
          '如果图上线程越多越慢,不是并行错了,而是小门口成了热点。',
      },
      {
        title: '例 2:每人小账本的粗略计数',
        code:
          'int sum_local[MAX_TID];\n\n' +
          'void T_sum(int tid) {\n' +
          '  if (++sum_local[tid] == 100) {\n' +
          '    mutex_lock(&lk);\n' +
          '    sum += sum_local[tid];\n' +
          '    mutex_unlock(&lk);\n' +
          '    sum_local[tid] = 0;\n' +
          '  }\n' +
          '}',
        walkthrough:
          '这不是偷偷牺牲正确性,而是改了需求:允许总数暂时少一点,最后仍会追上。阈值 100 越大,抢总账越少,但别人看到的数越旧。' +
          '要强调“能不能接受旧值”是业务问题,不能无脑套。',
      },
      {
        title: '例 3:哈希表按桶分门,扩容要封场',
        code:
          'put(key, value):\n' +
          '  lock(bucket[hash(key)])\n' +
          '  写这个桶\n' +
          '  unlock(bucket[hash(key)])\n\n' +
          'resize():\n' +
          '  拿全局写门闩,阻止所有并发访问\n' +
          '  搬整张表',
        walkthrough:
          '按桶分门让不同 key 可以并行,但扩容会重排全表,不能和普通访问乱跑。若普通操作同时要拿桶门闩和扩容门闩,必须统一顺序。' +
          '这正是“锁拆细以后,复杂度也被拆出来”的分寸。',
      },
    ],
    selfCheck: [
      '能用 `sum++` 解释为什么“完全排队”正确但不一定可扩展吗?',
      '能把一个任务分解成“短暂取活 + 长时间本地干活 + 完成后唤醒后继”的图吗?',
      '能举出 Mandelbrot/网格/Monte Carlo 这类几乎不用互相等的例子吗?',
      '小白要是说“每人一份就不用总账”,你能用阈值 100 或 S 的取舍讲清吗?',
      '能解释哈希表按桶上锁为什么有用,又为什么 resize 可能把事情变难吗?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「并行不就是线程越多越快吗?有几个核就开满几个核,速度应该按人数翻倍吧?」' +
      '带着这个问题去读下面的材料,想好你打算怎么让它看到共享门口、关键路径和通信成本。纠不动它,它会开心地把错的学走。',
    references: [
      {
        title: '并行算法与数据结构',
        url: 'https://jyywiki.cn/OS/2026/lect18.md',
        kind: '讲义',
        note: '本讲 jyywiki 官方讲义:从 `sum++` 的可扩展性瓶颈讲到任务分解、HPC、thread_local 和并行数据结构。',
      },
      {
        title: '18 - 并行算法和数据结构 [2026 南京大学操作系统原理]',
        url: 'https://www.bilibili.com/video/BV1WqdTBiEkN',
        kind: '视频',
        note: 'UP 主「绿导师原谅你了」(jyy 官方号)的 2026 春第 18 讲回放,建议配合讲义中的实验和代码片段观看。',
      },
      {
        title: 'Operating Systems: Three Easy Pieces',
        url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
        kind: '教程',
        note: '课程推荐教材官网;本讲尤其对应 Concurrency 部分的 Locks 与 Lock-based Concurrent Data Structures。',
      },
      {
        title: 'Lock-based Concurrent Data Structures',
        url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks-usage.pdf',
        kind: '教程',
        note: 'OSTEP 第 29 章:近似计数器、链表、队列、哈希表的加锁方案与性能/正确性取舍都在这里。',
      },
      {
        title: 'The OpenMP API specification for parallel programming',
        url: 'https://www.openmp.org/',
        kind: '官方文档',
        note: 'OpenMP 官方站:理解讲义中 `#pragma omp parallel for` 为什么适合共享内存机器上的静态切分。',
      },
      {
        title: 'MPI Documents',
        url: 'https://www.mpi-forum.org/docs/',
        kind: '官方文档',
        note: 'MPI Forum 标准文档入口:对应讲义里多机消息传递这条线,适合想继续看 scale out 的同学。',
      },
    ],
  },
};

export const osParallelDemo: DemoLine[] = [
  {
    label: '① 讲:sum++ 的小门口',
    text:
      '我们先从最熟的 sum++ 说起。给它外面包一把互斥锁,确实能让每次更新排好队,前一个放手、后一个再进去,' +
      '所以结果是可见而且正确的;但如果所有线程每加一次都要挤进同一个临界区,同步和等待就会变成瓶颈,' +
      '线程数上去,性能不一定跟着增长。讲义才会要求固定总次数,分别测 1、2、4、8、16 个线程,每种实现重复 5 次,' +
      '用数据看 serializability 和 scalability 到底怎么打架。',
    note: '命中 c1 → 小白开窍复述,追问 c2(能不能把大活拆开少抢门)',
  },
  {
    label: '② 讲:厨房分工少抢门',
    text:
      '要跑起来,第一招是分解:取任务时短暂排一下队,拿到 job 之后,真正花时间的 job->run 尽量变成局部计算,' +
      '自己干自己的,干完再通知后面的任务。依赖关系可以看成一张 DAG,前驱都做完,当前活才能开工;' +
      '深度是绕不开的最长等待链,宽度才是能并排开的空间。就像厨房出餐,大家只在取单口碰一下,' +
      '回到各自灶台切菜炒菜,门口不堵,后厨才真的忙得起来。',
    note: '命中 c2 + 金句类比收录(厨房分工)→ 触发 M1 注入:「线程越多越快?」',
  },
  {
    label: '③a 被带偏(演示盲区暴露)',
    text:
      '呃……听起来确实就是人多力量大,那我以后就记成:任务只要能切开,线程越多就越快,' +
      '最好把机器上的核都开满,速度基本按人数翻倍,这样准没错。',
    note: 'M1 判定「被带偏」(命中「线程越多+越快」)→ 小白开心学错,关联小测必错',
  },
  {
    label: '③b 正确纠正(对照分支)',
    text:
      '不对,不是线程一多就线性变快。并行收益会被同步、通信和关键路径吃掉,只有独立工作够多、切分清楚、' +
      '等待时间远小于自己干活的时间,才可能扩展。高性能计算里常见的好例子是静态切分:比如 Mandelbrot 图,' +
      '每个像素几乎独立计算;网格中除了边界,内部也能各算各的。OpenMP 和 MPI 只是帮我们组织这些活的工具,' +
      '没有足够独立的活,工具也变不出加速。',
    note: 'M1 判定「已纠正」+ 顺势命中 c3 → Aha 复述后追问 c4,纠错力 +1',
  },
  {
    label: '④ 串讲:少堵门的全景',
    text:
      '我把前面串起来:并行要先看那扇共享的小门是不是太热,再把大活拆成有依赖关系的任务图;' +
      '能并排开的部分越宽、每个人回到自己手头干的时间越长,效果越好。像像素、网格、抽样这类活,' +
      '大多能提前分给不同人;如果每一步都要回同一个门口盖章,那大家只是换个地方排队。',
    note: '复述巩固(无新命中)→ 小白就 c4(能不能先记小账再汇总)发起边界追问;Lv5 在此轮提前迁移',
  },
  {
    label: '⑤ 讲:本地小账本',
    text:
      '并行数据结构还要问一个问题:读数是不是必须每一秒都精确到最新?如果允许别人看到一点点旧值,' +
      '但最后能追上,就可以用最终一致性换性能。Sloppy counter 就是这样:每个线程先在本地小账本里攒,' +
      '比如讲义里攒到 100,才去拿全局锁把这 100 汇总进总账,然后本地清零。thread_local 则是语言直接给每个线程一份自己的抽屉,' +
      '不用手写一个按编号查找的小仓库。',
    note: '命中 c4 → 触发 M3 注入(每人一份就彻底不用管共享?)',
  },
  {
    label: '⑥ 纠正 M3 + 讲拆锁',
    text:
      '不是说全都不用管共享了。每人小账本只是少抢总账,最后只要还要看全局结果,就必须按某个阈值或时机合并;' +
      '阈值越大越少抢门,但读到的总数越可能暂时不精确。遇到真正共享结构,还要继续缩小冲突范围:' +
      '能用原子指令就别上大锁,读多写少可以用读写锁,哈希表可以按 bucket 分门管理。' +
      '但这也会带来新坑:resize 会搬整张表,open addressing 还牵扯删除、遍历和 tombstone,多把锁拿错顺序就可能死锁。',
    note: '纠正 M3(合并/阈值/共享结构)+ 命中 c5 → 同轮衔接注入 M2(锁越细越好?)',
  },
  {
    label: '⑦ 纠正 M2(收尾)',
    text:
      '也不是越细越好。细粒度锁确实能减少互相挡路,但每个操作如果既要拿 bucket 的门,又要拿 resize 的门,' +
      '就必须规定固定顺序,否则两边互等就是死锁;resize 这种会摧毁旧数组的动作,还得像持有 write lock 一样阻止并发访问。' +
      '所以最终还要回到 workload 和实测:热点分散、扩容少、遍历少,拆锁才可能划算;否则复杂度可能比省下的等待更贵。',
    note: '纠正 M2(不是越细越好/固定顺序/resize+死锁/workload+实测)→ 三误区全纠正、五要点全命中',
  },
  {
    label: '卡壳演示(触发 R1 救援)',
    text: '嗯……这块我卡住了,一下子想不起来后面该怎么讲了……',
    note: '卡壳信号 → 小白递台阶(R1);连续两次 → 一起查书(R2)',
  },
  {
    label: '偏题演示(内容围栏)',
    text: '小白,学校门口新开了一家烧烤店,听说烤茄子特别香,下课要不要一起去排队?',
    note: '偏题 → 小白角色内拉回:「这跟今天的知识点没关系吧」',
  },
];

/**
 * 摸底快测题组(聚合于 src/data/selfTest.ts)。
 * 出题纪律:不与 quizBank / probe 题干重复,只考同一要点的另一侧面;
 * 干扰项须是「听着有道理的常见误解」,每题只留一个略带幽默的。
 * 分寸沿用文件头内容红线:并行性能只说 workload 下的可扩展性,不做脱离场景的绝对判断。
 */
export const osParallelSelfTest: SelfTestItem[] = [
  {
    id: 'pa-st1',
    dimension: '概念',
    question: '“这段并行程序正确”与“这段程序能扩展”之间是什么关系?',
    options: [
      '正确就一定能扩展',
      '正确只说明结果没乱;能不能扩展还要看共享热点和同步成本',
      '能扩展就一定不正确',
      '两者都由电脑心情决定',
    ],
    answerIndex: 1,
    explanation: '互斥能保正确,但小临界区被频繁争用时,等待会吞掉并行收益。',
    checklistRef: 'c1',
    mcRef: 'os_parallel_M1',
  },
  {
    id: 'pa-st2',
    dimension: '推演',
    code: 'A 完成后 B、C 才能开始;B、C 都完成后 D 才能开始',
    question: '这张小任务图里,再多给人手也绕不开哪条限制?',
    options: [
      'A 到 D 的依赖链',
      'B 和 C 的名字都只有一个字母',
      '人手越多依赖会自动消失',
      'D 会害怕热闹',
    ],
    answerIndex: 0,
    explanation: '依赖链就是关键路径;宽度能并排,深度不能靠堆人手抹掉。',
    checklistRef: 'c2',
    mcRef: null,
  },
  {
    id: 'pa-st3',
    dimension: '应用',
    question: '把一段视频按帧分给很多机器处理,为什么常常比较容易并行?',
    options: [
      '每帧通常能独立处理,只要最后按顺序收回来',
      '视频会自动变短',
      '机器越多画质越高',
      '帧之间会互相鼓励',
    ],
    answerIndex: 0,
    explanation: '逐帧处理接近 embarrassingly parallel:小块之间少依赖,同步少。',
    checklistRef: 'c3',
    mcRef: 'os_parallel_M1',
  },
  {
    id: 'pa-st4',
    dimension: '边界',
    question: '哪种场景最不适合用“先记小账再汇总”的粗略计数?',
    options: [
      '网页点赞数,晚几秒更新也能接受',
      '监控界面上的大致请求量',
      '银行转账余额,每一笔都必须立即精确',
      '游戏里展示在线人数的估计值',
    ],
    answerIndex: 2,
    explanation: '能否放松精确性取决于语义;钱款余额不能接受“不太离谱”的旧值。',
    checklistRef: 'c4',
    mcRef: 'os_parallel_M3',
  },
  {
    id: 'pa-st5',
    dimension: '辨析',
    question: '“把哈希表每个桶都加锁,就再也不用考虑全局协调了。”这句话哪里不稳?',
    options: [
      '桶锁对普通操作有用,但扩容、遍历和删除仍可能需要全局协调',
      '桶锁根本不能保护任何东西',
      '哈希表没有桶',
      '全局协调只在下雨天需要',
    ],
    answerIndex: 0,
    explanation: '局部操作可以分门,结构性维护仍会牵动整张表。',
    checklistRef: 'c5',
    mcRef: 'os_parallel_M2',
  },
  {
    id: 'pa-st6',
    dimension: '推演',
    question: '近似计数器把汇总阈值从 10 调到 1000,最可能发生什么?',
    options: [
      '更少抢总账,但全局读数可能更久地落后',
      '更频繁抢总账,读数更旧',
      '完全没有变化',
      '计数器开始讲笑话',
    ],
    answerIndex: 0,
    explanation: '阈值越大越可扩展,但全局值暂时越可能偏旧。',
    checklistRef: 'c4',
    mcRef: 'os_parallel_M3',
  },
  {
    id: 'pa-st7',
    dimension: '边界',
    question: '评审一个“更复杂但更并行”的数据结构方案,最可靠的结论来源是什么?',
    options: [
      '真实负载下的基准测试和错误路径审查',
      '作者说它很优雅',
      '锁的数量越多越高级',
      '变量名里有 fast',
    ],
    answerIndex: 0,
    explanation: '并发结构同时考正确性和性能;复杂方案必须用 workload、测试和边界路径证明自己。',
    checklistRef: 'c5',
    mcRef: 'os_parallel_M2',
  },
];
