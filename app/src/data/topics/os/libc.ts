/**
 * 知识点:C 标准库和实现(《操作系统原理》第 9 讲)。
 * 讲义:https://jyywiki.cn/OS/2026/lect9.md
 * 视频:https://www.bilibili.com/video/BV1GHXCBkEZf(UP 主「绿导师原谅你了」,jyy 官方号)
 * 关键词组与本文件导出的 osLibcDemo 预埋话术互相咬合,
 * 改动任一侧必须同步校验(scripts/simulate.ts)。
 *
 * 演示编排(与 attention 同构):
 *   ① c1(为什么要有标准库)→ ② c2(printf 的真身)+金句 → 注入 M1(喊一次跑一趟,injectAfter c2)
 *   ③b 纠正 M1 + 顺势命中 c3(先攒后送)→ ④ 串讲无新命中(Lv5 在此轮提前迁移)
 *   ⑤ c4(两类函数的分水岭)→ 注入 M3(malloc 是系统调用?freshness 压过 M2)
 *   ⑥ 纠正 M3 + 命中 c5(开场与谢幕)→ 同轮衔接注入 M2(程序从 main 开始?)→ ⑦ 纠正 M2 收尾
 *
 * 内容红线(备课研究核定):
 *   - 缓冲策略不说死:只说「主流实现中:连终端行缓冲、写文件全缓冲、stderr 通常不缓冲」,并留 setvbuf 可改的口子;
 *   - 不说「malloc 从不进内核」,说「主流实现平时在用户态仓库切块零售,见底才通过 brk/mmap 等系统调用批发」;
 *   - 「_start → __libc_start_main → main」是主流 Linux(glibc/musl)上的动态,freestanding/嵌入式场景另说;
 *   - 不说「库函数比系统调用快」,只说「缓冲省的是进出内核的趟数」;
 *   - 「系统调用开销大」加限定语:一般显著大于普通函数调用,不给具体倍数。
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osLibcTopic: Topic = {
  topicId: 'os-libc',
  title: 'C 标准库和实现',
  course: '操作系统原理',
  tagline: 'printf 背后的旅程',
  transferHint: '用 Python 打印一行字',
  checklist: [
    {
      id: 'c1',
      point: '应用世界的第一级抽象',
      groundTruth:
        '程序办正事(读写文件、打印、退出)最终都要通过系统调用请操作系统出手;直接用系统调用编程既繁琐又不可移植。' +
        'C 标准库(libc)把系统调用和常用功能封装成标准函数,是应用与操作系统之间的第一级抽象;' +
        'ISO C 标准化带来稳定可靠与世界级移植性,POSIX 在其上再补一层类 UNIX 接口' +
        '(几乎所有"能用"的操作系统都提供一定 POSIX 兼容)。C++/Java/Python 等更高层生态都建立在这层抽象之上。',
      keywords: [
        ['第一级', '抽象'],
        ['第一层', '台阶'],
        ['封装', '系统调用'],
        ['标准化', '移植'],
      ],
      terms: ['标准库', '系统调用', 'libc'],
      level: 'L1',
      lookupCard:
        '**为什么要有标准库?**\n\n程序办正事(打字、开文件、退出)最终都要靠**系统调用**请操作系统出手;' +
        '可直接用系统调用写程序,又苦又不可移植。\n\n**libc** 把它们封装成标准函数,' +
        '是应用与操作系统之间的**第一级抽象**:\n\n- ISO C 标准化 → 稳定、可靠、世界级移植性;\n' +
        '- POSIX 在其上再补一层类 UNIX 接口,几乎所有"能用"的操作系统都提供一定兼容。\n\n' +
        'C++、Java、Python 的运行时,底下踩的都是这层楼梯。',
      probeLine: '老师,程序想在屏幕上说句话、开个文件,这些事它自己就能干吗?还是得找谁帮忙呀?',
    },
    {
      id: 'c2',
      point: '打印那位只是个跑腿的',
      groundTruth:
        'printf 是 libc 的库函数、不是系统调用,运行在用户态;printf/fprintf/sprintf 一家最终都汇到 vfprintf ' +
        '一个实现(这类代码理应没有 code clones);FILE* 背后包着一个文件描述符,stdio 封装了文件描述符上的系统调用;' +
        '真正把字交给操作系统的,是最底下那次 write 系统调用。',
      keywords: [
        ['库函数', '不是系统调用'],
        ['文件描述符', '包着'],
        ['汇到'],
        ['write', '交给'],
      ],
      terms: ['printf', '库函数', '文件描述符', 'write'],
      level: 'L2',
      lookupCard:
        '**printf 的真身**\n\n**printf** 不是系统调用,是 libc 里的**库函数**,跑在你程序自己家(用户态)。\n\n' +
        '- printf/fprintf/sprintf 一家子,活儿最后都汇到 vfprintf 一个实现——这类代码理应没有 code clones;\n' +
        '- FILE* 背后其实包着一个**文件描述符**,stdio 封装了它上面的系统调用;\n' +
        '- 真正把字交给操作系统的,是最底下那一次 **write** 系统调用。',
      probeLine: '那我平时让程序在屏幕上打一行字,那个帮我干活的家伙,它自己就是那扇门吗,还是只是个跑腿的呀?',
    },
    {
      id: 'c3',
      point: '先攒一批,再过一次门',
      groundTruth:
        '系统调用要在用户态和内核态之间切换,开销一般显著大于普通函数调用;所以 stdio 在用户态设缓冲区:' +
        'printf 先把字符写进缓冲区攒着,到冲刷条件才通过一次 write 批量交给操作系统。主流实现中:' +
        '连接终端时行缓冲(遇换行冲刷),重定向到文件/管道时全缓冲,stderr 通常不缓冲(setvbuf 可改);' +
        'exit 正常退出会冲刷所有 stdio 缓冲区,异常终止(如 abort)时未冲刷内容可能丢失。',
      keywords: [
        ['缓冲区', '攒'],
        ['行缓冲'],
        ['换行', '冲刷'],
        ['先存着', '一次性'],
      ],
      terms: ['缓冲区', '行缓冲', '内核态'],
      level: 'L3',
      lookupCard:
        '**先攒后送:缓冲区**\n\n进出内核一趟(用户态↔**内核态**切换)的开销,一般显著大于普通函数调用。' +
        '所以 stdio 在用户态设了**缓冲区**:\n\n- printf 先把字攒进缓冲区;\n' +
        '- 到冲刷条件才一次 write 送一批——主流实现:连终端时**行缓冲**(遇换行冲刷),' +
        '写文件/管道时全缓冲,stderr 通常不缓冲;\n' +
        '- exit 正常退出会冲刷所有缓冲区;异常终止(abort/崩溃)时,没送走的字可能就丢了。\n\n' +
        '(想自己改策略,有 setvbuf。)',
      probeLine: '那它拿到我要打的字之后,是一个字一个字马上送出去,还是先在手里存一存再说呀?',
    },
    {
      id: 'c4',
      point: '有些活儿根本不用出门',
      groundTruth:
        '标准库函数分两类:纯计算的(memcpy、strlen、qsort、atoi 这类"随手可实现"的)只操作内存和寄存器,' +
        '不需要任何系统调用,在不依赖宿主操作系统的 freestanding 环境也能用;另一类(putchar、exit、fopen)' +
        '必须依赖系统调用。机器/平台相关的常数与定义封装在 stddef.h、limits.h、stdint.h 等头文件里。' +
        'malloc 夹在中间:主流实现先通过 brk/mmap 批发一大块,平时在用户态切块零售,见底才再批发。',
      keywords: [
        ['纯计算'],
        ['两类', '函数'],
        ['自己就能算完'],
        ['freestanding'],
      ],
      terms: ['memcpy', 'freestanding', '纯计算'],
      level: 'L3',
      lookupCard:
        '**两类函数的分水岭**\n\n- **纯计算**一类:**memcpy**、strlen、qsort、atoi……只动内存和寄存器,' +
        '零系统调用,在不依赖宿主操作系统的 **freestanding** 环境也能用;\n' +
        '- 必须出门一类:putchar、exit、fopen……离了系统调用办不成事;\n' +
        '- 夹在中间:malloc——主流实现先用 brk/mmap 批发一大块,平时在用户态仓库切块零售,见底才再批发。\n\n' +
        '机器相关的常数和定义(stddef.h、limits.h、stdint.h)也归标准库管:你所有"不知道"的定义都在里面。',
      probeLine: '那这一大箱工具里的每一件,用的时候都得去敲操作系统的门吗?有没有自己就能干完的呀?',
    },
    {
      id: 'c5',
      point: '开场有人搭台,谢幕有人收场',
      groundTruth:
        '主流 Linux 上,可执行文件真正的入口是 _start(来自 crt1.o,即 C runtime 的一部分),它把控制权交给 ' +
        '__libc_start_main:按 System V ABI 从初始进程栈取得 argc/argv/envp、给全局变量 environ 赋值、' +
        '完成 libc 初始化,然后才调用 main;main 返回后,exit 还要倒序执行 atexit 注册的收尾函数、' +
        '冲刷 stdio 缓冲区,最后才通过 exit 系统调用真正退出。',
      keywords: [
        ['_start'],
        ['真正的入口'],
        ['atexit'],
        ['搭好', '上场'],
      ],
      terms: ['_start', 'atexit', 'main'],
      level: 'L5',
      lookupCard:
        '**开场与谢幕**\n\n主流 Linux 上,程序真正的入口是 **_start**(crt1.o,C runtime 的一部分),' +
        '它把控制权交给 __libc_start_main:\n\n' +
        '1. 按 System V ABI 从初始进程栈取得 argc/argv/envp,给全局变量 environ 赋值;\n' +
        '2. 完成 libc 初始化,然后才调用 **main**;\n' +
        '3. main 返回后,exit 倒序执行 **atexit** 登记的收尾函数、冲刷 stdio 缓冲区,' +
        '最后才用 exit 系统调用真正退出。\n\n所以 main 只是主角:开场有人搭台,谢幕有人收场。',
      probeLine: '对了老师,我一按运行,程序是一睁眼就站在我写的第一行代码上吗?开场之前和收尾之后,都发生了什么呀?',
    },
  ],
  misconceptions: [
    {
      mcId: 'os_libc_M1',
      topicId: 'os-libc',
      belief: 'printf 每喊一次,操作系统就立刻收到一次,字马上就上屏',
      triggerLine:
        '哦!那我懂了:printf 就是我家门口的门铃嘛——我每按一次,操作系统立刻应一次门,' +
        '字马上就送到屏幕上;喊十次它就跑十趟,一次都不会少,对吧?',
      correctionCriteria: [
        '指出 printf 先把字写进用户态缓冲区,不会每喊一次就惊动操作系统一次',
        '说明攒到冲刷条件(主流实现:连终端遇换行、缓冲区满、正常退出)才通过一次 write 批量交给操作系统',
        '(可选)指出进出内核一趟的开销一般远大于普通函数调用,缓冲正是为了少跑几趟',
      ],
      correctionKeywords: [
        ['不是', '喊一次'], ['缓冲区', '攒'], ['一口气', '交给'], ['先存', '再送'],
      ],
      adoptionKeywords: [
        ['喊一次', '跑一趟'], ['立刻收到'], ['马上就上屏'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: 'printf 每被调用一次,操作系统就立刻收到一次输出,字马上显示在屏幕上。',
        isTrue: false,
        explanation:
          'printf 先把字写进用户态缓冲区,攒到冲刷条件(如连终端时遇换行)才通过一次 write 系统调用' +
          '批量交给操作系统——喊十次可能只送一趟。',
      },
      remedy: {
        microLesson: {
          title: '先攒后送:printf 的快递集散点',
          body:
            '拿三行代码做个实验,看看"喊一次跑一趟"到底成不成立:\n\n' +
            '```\nprintf("A");\nprintf("B");\nsleep(3);      // 这 3 秒,屏幕上一个字都没有\n' +
            'printf("C\\n"); // 换行一到,ABC 一起冒出来\n```\n\n' +
            '前 3 秒屏幕空白,不是字丢了,而是它们都躺在 printf 的**用户态缓冲区**里等着凑批;' +
            '换行一到(主流实现连终端时是行缓冲),才由一次 **write** 系统调用把 "ABC\\n" 一口气交给操作系统。' +
            '用 strace 观察,只会看到一次 write,而不是四次。\n\n' +
            '为什么这么设计?进出内核一趟的开销一般远大于普通函数调用——先攒后送,省的是趟数。\n\n' +
            '再补一个分寸:缓冲策略取决于实现与输出对象——终端典型行缓冲、文件典型全缓冲、' +
            'stderr 通常不缓冲,还可以用 setvbuf 自己改;别把"遇换行才冲刷"说成铁律。',
          askBack: '下次小白再说「喊一次跑一趟」,你打算用哪三行代码让它亲眼看到字被攒住了?',
        },
        predictionQuiz: [
          {
            id: 'r1-1',
            code: 'printf("A");\nprintf("B");\nsleep(3);      // 这 3 秒屏幕一片空白\nprintf("C\\n"); // ABC 一起冒出来',
            question: '为什么前 3 秒屏幕上一个字都没有?',
            options: [
              '操作系统把输出弄丢了',
              '字都先写进了用户态缓冲区,没到冲刷条件不出门',
              'sleep 会吞掉它前面的输出',
              '终端在假装没看见',
            ],
            answerIndex: 1,
            explanation: '主流实现连终端时行缓冲:不见换行不冲刷——字被攒住了,不是丢了。',
            checklistRef: 'c3',
            mcRef: 'os_libc_M1',
          },
          {
            id: 'r1-2',
            question: '循环里喊了 100 次 printf,用 strace 观察,write 系统调用的次数最可能是?',
            options: [
              '正好 100 次,一次不少',
              '远少于 100 次——攒一批送一趟',
              '0 次,printf 用不着 write',
              '至少 200 次,一来一回各算一次',
            ],
            answerIndex: 1,
            explanation: '缓冲区把多次 printf 合并成少数几次 write——这正是"先攒后送"的直接证据。',
            checklistRef: 'c3',
            mcRef: 'os_libc_M1',
          },
          {
            id: 'r1-3',
            question: '标准库费劲设缓冲区、先攒后送,图的是什么?',
            options: [
              '让输出显得更有悬念',
              '进出内核一趟的开销一般远大于普通函数调用,少跑几趟更划算',
              '为了防止字打重复',
              '纯属历史习惯,没有原因',
            ],
            answerIndex: 1,
            explanation: '缓冲省的是用户态和内核态之间来回切换的趟数——系统调用不是不要钱的普通函数。',
            checklistRef: 'c3',
            mcRef: null,
          },
        ],
      },
    },
    {
      mcId: 'os_libc_M2',
      topicId: 'os-libc',
      belief: '程序就是从 main 的第一行开始跑的,main 一返回,一切就立刻结束了',
      triggerLine:
        '可是老师,这条我还是犯嘀咕:我写代码的时候,第一行明明就写在 main 里呀?' +
        '那程序肯定就是从 main 开始跑的嘛,main 一返回就全剧终了,前后哪还有别人干活的份?对吧?',
      correctionCriteria: [
        '指出真正的入口是 _start(C runtime),它先摆好命令行参数和环境、完成初始化,才调用 main',
        '说明 main 返回后 exit 还要收场:倒序跑 atexit 登记的收尾函数、冲刷缓冲区,最后才真正退出',
        '(可选)点出 environ/argc/argv 是 libc 启动代码从初始进程栈上取来摆好的',
      ],
      correctionKeywords: [
        ['搭台'], ['收场'], ['不是', '整场戏'], ['前后', '都有人'],
      ],
      adoptionKeywords: [
        ['全剧终'], ['一返回', '就结束'], ['就是从', '开始跑的'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: 'C 程序从 main 的第一行开始执行,main 一返回,程序就立刻结束了。',
        isTrue: false,
        explanation:
          '主流 Linux 上真正的入口是 _start:libc 先摆好参数和环境才调用 main;' +
          'main 返回后 exit 还要倒序跑 atexit 收尾、冲刷缓冲区,最后才通过 exit 系统调用真正退出。',
      },
      remedy: {
        microLesson: {
          title: '开场与谢幕:main 只是主角',
          body:
            '把一场演出的完整时间线画出来,你写的部分其实只是中间那一段:\n\n' +
            '```\n_start(真正的入口,来自 C runtime 的 crt1.o)\n' +
            '  └→ __libc_start_main:从初始进程栈摆好 argc/argv/环境,libc 初始化\n' +
            '       └→ main(...)            ← 你写的戏,这才开演\n' +
            '            └→ return 之后,exit 接手:\n' +
            '                 ├ 倒序执行 atexit 登记的收尾函数\n' +
            '                 ├ 冲刷 stdio 缓冲区\n' +
            '                 └ exit 系统调用,真正谢幕\n```\n\n' +
            '两件小事可以当场验证:用 readelf -h 看 Entry point,再用 nm 找 _start,' +
            '就能看到入口不是 main;写个 atexit 小实验,main 返回之后注册过的函数照样被叫起来干活。\n\n' +
            '分寸:这是主流 Linux(glibc/musl)上的动态;完全不依赖操作系统的 freestanding 场景里,' +
            '开场谢幕就得自己安排了。',
          askBack: '下次小白再说「main 一返回全剧终」,你打算用 atexit 的哪个小实验让收场人员现身?',
        },
        predictionQuiz: [
          {
            id: 'r2-1',
            question: '主流 Linux 上,可执行文件真正的入口是?',
            options: [
              'main,天经地义',
              '_start——C runtime 的一部分,搭好台才调 main',
              '第一个 printf',
              'exit,凡事先想好退路',
            ],
            answerIndex: 1,
            explanation: 'readelf 看到的 Entry point 对应 _start;main 是被 libc 启动代码请上台的。',
            checklistRef: 'c5',
            mcRef: 'os_libc_M2',
          },
          {
            id: 'r2-2',
            question: 'main return 之后,程序还会做什么?',
            options: [
              '立刻消失,什么都不做',
              '倒序执行 atexit 登记的收尾函数、冲刷 stdio 缓冲区,最后才通过 exit 系统调用真正退出',
              '重新跑一遍 main 确认没漏',
              '向用户发一封感谢信',
            ],
            answerIndex: 1,
            explanation: '谢幕后还有收场:atexit 收尾、冲刷缓冲区,然后才真正退出——这也是 libc 的活儿。',
            checklistRef: 'c5',
            mcRef: 'os_libc_M2',
          },
          {
            id: 'r2-3',
            question: 'main 拿到的 argc、argv 和环境变量,是谁摆好的?',
            options: [
              '键盘驱动实时输入的',
              'libc 的启动代码——按 System V ABI 从初始进程栈上取来摆好,environ 也是它赋的值',
              '编译器写死在程序里的',
              '天生就有,不用谁摆',
            ],
            answerIndex: 1,
            explanation: '进程初始栈上的 envp 位置因 ASLR 而不定,全局变量 environ 正是 libc 启动时赋值的。',
            checklistRef: 'c5',
            mcRef: null,
          },
        ],
      },
    },
    {
      mcId: 'os_libc_M3',
      topicId: 'os-libc',
      belief: 'malloc 每次都要请操作系统亲自分配内存,它就是一个系统调用',
      triggerLine:
        '懂了懂了!那我自己再推一步:malloc 是要内存的,内存可是操作系统管的大事,' +
        '所以每喊一次 malloc,肯定都是操作系统亲自出面分给我——malloc 妥妥就是个系统调用,对吧?',
      correctionCriteria: [
        '指出 malloc 也是库函数,不是系统调用',
        '说明主流实现是"批发—零售"两级:先通过 brk/mmap 等系统调用批发一大块,平时在用户态仓库切块零售',
        '(可选)点出只有仓库见底才再次惊动操作系统,大多数调用零系统调用',
      ],
      correctionKeywords: [
        ['批发', '零售'], ['也是', '库函数'], ['不惊动'], ['仓库', '切'],
      ],
      adoptionKeywords: [
        ['亲自出面'], ['妥妥', '系统调用'], ['每次都', '操作系统'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: 'malloc 是一个系统调用,每次申请内存都由操作系统直接分配。',
        isTrue: false,
        explanation:
          'malloc 是库函数:主流实现先通过 brk/mmap 等系统调用批发一大块内存,' +
          '之后多数调用只在用户态仓库里切块零售,根本不惊动操作系统,见底才再批发。',
      },
      remedy: {
        microLesson: {
          title: '批发与零售:malloc 的仓库',
          body:
            '"要内存"听着像大事,但 malloc 的账本其实是两级的:\n\n' +
            '```\n第 1 次 malloc(64)   → 仓库是空的:先用 brk/mmap 系统调用\n' +
            '                       找操作系统批发一大块 → 切 64 字节给你\n' +
            '第 2~100 次 malloc   → 都在自家仓库里切块零售,零系统调用\n' +
            '仓库见底             → 再出门批发一趟\n```\n\n' +
            '所以"malloc = 系统调用"这笔账算错在:把偶尔的批发,当成了每次的零售。' +
            '大多数 malloc 根本不进内核——这也是它作为**库函数**存在的意义:' +
            '把昂贵的系统调用摊薄到成百上千次小额申请里。\n\n' +
            '分寸:这是主流实现(glibc/musl 等)的典型做法;不同 libc 策略不同,' +
            '比如超过阈值的大块申请可能直接走 mmap——说"通常""主流实现中"最稳。',
          askBack: '下次小白再说「malloc 就是系统调用」,你打算怎么用"批发—零售"把这笔账算给它看?',
        },
        predictionQuiz: [
          {
            id: 'r3-1',
            question: '主流实现里,你调用 malloc 要一小块内存,大多数时候发生的是?',
            options: [
              '操作系统亲自出面,现场划一块给你',
              'malloc 在自家用户态仓库里切一块给你,根本不进内核',
              '编译器早就提前替你分好了',
              '抛硬币随机决定',
            ],
            answerIndex: 1,
            explanation: 'malloc 是库函数:多数调用只是在已批发的内存里切块零售,零系统调用。',
            checklistRef: 'c4',
            mcRef: 'os_libc_M3',
          },
          {
            id: 'r3-2',
            question: 'malloc 什么时候才真正惊动操作系统?',
            options: [
              '每一次调用都惊动',
              '自家仓库不够用了,才通过 brk/mmap 这类系统调用再批发一大块',
              '只在程序退出的时候',
              '从来不惊动,内存是无限的',
            ],
            answerIndex: 1,
            explanation: '批发—零售两级结构:偶尔批发、平时零售,把昂贵的系统调用摊薄掉。',
            checklistRef: 'c4',
            mcRef: 'os_libc_M3',
          },
          {
            id: 'r3-3',
            question: '下面哪个函数,一辈子都不需要系统调用?',
            options: [
              'fopen——总得开文件',
              'strlen——数个长度,纯计算',
              'exit——退出得跟操作系统打招呼',
              'putchar——字要上屏',
            ],
            answerIndex: 1,
            explanation: '纯计算函数只动内存和寄存器,freestanding 环境也能用;其余三个离了系统调用办不成。',
            checklistRef: 'c4',
            mcRef: null,
          },
        ],
      },
    },
  ],
  quizBank: [
    {
      id: 'q1',
      question: '为什么几乎没人直接用系统调用写应用,而要经过 C 标准库这一层?',
      options: [
        '因为系统调用要收费,标准库免费',
        '标准库把系统调用封装成标准函数:好用,且因 ISO 标准化获得世界级移植性',
        '因为操作系统禁止程序直接发系统调用',
        '因为标准库能绕过操作系统直接操作硬件',
      ],
      answerIndex: 1,
      explanation: '直接用系统调用又苦又不可移植;libc 作为第一级抽象,让同一份代码几乎到哪儿都能编译运行。',
      checklistRef: 'c1',
      mcRef: null,
    },
    {
      id: 'q2',
      question: 'printf 的真实身份是?',
      options: [
        '一条 CPU 指令',
        '一个系统调用,由操作系统内核实现',
        '标准库里的库函数,跑在用户态,最终靠 write 系统调用把字交给操作系统',
        '终端自带的一个小程序',
      ],
      answerIndex: 2,
      explanation: 'printf 是 libc 的库函数:整理格式、写缓冲区,真正出门的是底下那次 write 系统调用。',
      checklistRef: 'c2',
      mcRef: 'os_libc_M1',
    },
    {
      id: 'q3',
      code: 'printf("A");\nprintf("B");\nsleep(3);\nprintf("C\\n");',
      question: '连着终端跑这段,前三秒屏幕上大概率能看到什么?',
      options: [
        'AB 立刻出现,三秒后出现 C',
        '什么都没有——ABC 都躺在缓冲区里,换行一到一起冒出来',
        'A 先出现,B 和 C 慢慢排队',
        '三个问号',
      ],
      answerIndex: 1,
      explanation: '主流实现连终端时行缓冲:不遇换行不冲刷,三个 printf 的字都攒在用户态缓冲区里。',
      checklistRef: 'c3',
      mcRef: 'os_libc_M1',
    },
    {
      id: 'q4',
      question: '下面哪一组函数,不需要任何系统调用、在没有操作系统的裸机上也能用?',
      options: [
        'open、read、write',
        'memcpy、strlen、qsort 这类纯计算函数',
        'putchar、exit',
        '一个都没有,标准库函数都离不开操作系统',
      ],
      answerIndex: 1,
      explanation: '纯计算函数只动内存和寄存器,属于 freestanding 环境也能用的那一类;读写、退出必须靠系统调用。',
      checklistRef: 'c4',
      mcRef: 'os_libc_M3',
    },
    {
      id: 'q5',
      question: '一个 C 程序真正的起点和终点是?',
      options: [
        '从 main 第一行开始,到 main return 那一刻彻底结束',
        '入口是 _start:libc 先摆好参数环境再调 main;main 返回后还要跑 atexit、冲刷缓冲区,最后才真正退出',
        '从第一个 printf 开始,到最后一个 printf 结束',
        '由编译器每次随机决定',
      ],
      answerIndex: 1,
      explanation: 'main 只是主角:开场前 C runtime 先搭台,谢幕后 exit 还要收场,才真正退出。',
      checklistRef: 'c5',
      mcRef: 'os_libc_M2',
    },
    {
      id: 'q6',
      question: 'printf、fprintf、sprintf 这一家子,实现上有什么讲究?',
      options: [
        '各写各的,互不相干',
        '都汇到同一个 vfprintf 实现,避免同样的格式化代码抄好几份',
        '由操作系统内核统一实现',
        '每次编译时现场生成一份',
      ],
      answerIndex: 1,
      explanation: '一家子只养一位老师傅:格式化逻辑集中在 vfprintf,其余都是薄薄的包装——理应没有 code clones。',
      checklistRef: 'c2',
      mcRef: null,
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟看懂:printf 背后的旅程',
      body:
        '把这一讲想成"一行字的旅程",五个要点就串起来了:\n\n' +
        '1. **为什么要有标准库**。程序办正事(读写文件、打印、退出)最终都得靠系统调用请操作系统出手;' +
        '直接用系统调用编程又苦又不可移植。C 标准库把它们封装成标准函数,是应用与操作系统之间的' +
        '**第一级抽象**;ISO C 标准化带来世界级移植性,POSIX 再补一层类 UNIX 接口。\n' +
        '2. **printf 的真身**。printf 是库函数、不是系统调用,跑在你程序自己家(用户态);' +
        'printf 一家子都汇到 vfprintf 一个实现;FILE* 背后包着一个文件描述符,' +
        '真正把字交给操作系统的是 write 系统调用。\n' +
        '3. **先攒后送**。进出内核一趟的开销一般远大于普通函数调用,所以 stdio 在用户态设缓冲区:' +
        '字先攒着,到冲刷条件(主流实现:连终端遇换行、写文件攒满)才一次 write 送一批;exit 时冲刷所有缓冲区。\n' +
        '4. **两类函数**。memcpy、qsort、atoi 这类纯计算函数只动内存和寄存器,不需要操作系统,' +
        'freestanding 环境也能用;open、write、exit 离了系统调用办不成;malloc 夹在中间——' +
        '主流实现先批发(brk/mmap)再在用户态零售。\n' +
        '5. **开场与谢幕**。真正的入口是 _start(C runtime),__libc_start_main 从初始进程栈摆好' +
        ' argc/argv/环境、完成初始化才请 main 上场;main 返回后,exit 还要倒序跑 atexit 收尾、' +
        '冲刷缓冲区,最后才真正退出。\n\n' +
        '判断口诀:**printf 是家里人,write 才是门;能自己算的不出门,要出门的攒一批;' +
        '开场有人搭台,谢幕有人收场**。小白最容易问倒你的地方:「printf 是不是喊一次,操作系统就跑一趟?」\n\n' +
        '**讲课节奏建议**\n\n' +
        '- **先讲①②立好画面**:①用"直接跟操作系统打交道太苦、还搬不了家"引出标准库这层楼梯,' +
        '②马上落到最熟的 printf——它只是个跑腿的库函数,门在最底下。画面立住,后面全是顺水推舟。\n' +
        '- **②讲完,警报拉响**:小白八成会顺着直觉起哄——「喊一次跑一趟呗!」先明确否定,再上三行代码:' +
        '两个不带换行的 printf 加一个 sleep,三秒里屏幕空白——字都躺在缓冲区里。纠正站稳了,顺势把③讲透。\n' +
        '- **中场把①②③串成一条流水线**再进④:分两类函数时多举几个例子(搬内存的、排序的、开文件的),' +
        '让它自己分分看哪些要出门。\n' +
        '- **讲完④,它还会来一次**:「malloc 总该是系统调用了吧?」用批发—零售顶回去,记得留分寸' +
        '(主流实现如此);末尾它多半还嘀咕「程序就是从 main 开始的呀」——用 atexit 小实验带出⑤收尾。\n\n' +
        '**一句话收束**\n\n' +
        '**标准库是应用世界的第一级抽象:能自己算的不惊动操作系统,要出门的攒一批再走,' +
        '连开场和谢幕都替你安排好了。**\n\n' +
        '**再深一锹(选读)**\n\n' +
        '- **想读源码,选 musl 别选 glibc**。glibc 历史包袱和优化太重,新手阅读体验极差;' +
        '讲义推荐用 musl 学习——代码干净,配一个带调试信息的 musl-gcc,就能从第一条指令单步走到 main。\n' +
        '- **错误处理的统一出口**。绝大多数系统调用都可能失败(getpid 这类少数例外规定必然成功),' +
        '错误码在手册 ERRORS 一节写得明明白白;' +
        '你在各种工具里反复见到同一句 "No such file or directory",都是同一套 errno 报出来的——这不是巧合。\n' +
        '- **两篇著名的"泼冷水"**。"C is not a low-level language":今天的 C 只是看起来贴机器;' +
        '"C isn\'t a programming language anymore":C 的接口约定成了各种语言互通绕不开的"世界语"——' +
        'libc 这层抽象的地位,比语言本身还稳。',
    },
    examples: [
      {
        title: '例 1:三秒空白——字被攒住了',
        code:
          'printf("A");\n' +
          'printf("B");\n' +
          'sleep(3);       // 这 3 秒,屏幕上一个字都没有\n' +
          'printf("C\\n");  // 换行一到,ABC 一起冒出来\n' +
          '// strace ./a.out 只看到一次 write(1, "ABC\\n", 4)',
        walkthrough:
          '三个 printf、一次 write:字先躺在用户态缓冲区里,换行一到才批量出门——' +
          '这是驳倒「喊一次跑一趟」的现场证据。注意分寸:连终端时典型行缓冲、写文件典型全缓冲、' +
          'stderr 通常不缓冲,还能用 setvbuf 改,别把"遇换行才冲刷"讲成铁律。',
      },
      {
        title: '例 2:两类函数,一道分水岭',
        code:
          '不出门就能干完 : memcpy  strlen  qsort  atoi   (纯计算,只动内存和寄存器)\n' +
          '必须出门办事   : open  read  write  exit       (离了系统调用办不成)\n' +
          '夹在中间       : malloc —— 平时在自家仓库切块零售,\n' +
          '                 仓库见底才用 brk/mmap 批发一大块',
        walkthrough:
          '纯计算一类在完全没有操作系统的 freestanding 环境也能用;malloc 是最好的追问案例:' +
          '它不是系统调用,主流实现用"批发—零售"把昂贵的进内核次数摊薄——小白问「malloc 呢?」时,' +
          '这张分类表就是你的答案卡。',
      },
      {
        title: '例 3:main 谢幕之后,还有人干活',
        code:
          '#include <stdio.h>\n#include <stdlib.h>\n' +
          'void bye(void) { printf("散场:关灯锁门\\n"); }\n' +
          'int main(void) {\n' +
          '  atexit(bye);              // 登记收尾活儿\n' +
          '  printf("main 说:再见\\n");\n' +
          '  return 0;                 // main 谢幕,但戏还没散\n' +
          '}\n// 输出:main 说:再见 → 散场:关灯锁门\n// readelf -h a.out | grep Entry  → 入口不是 main,是 _start',
        walkthrough:
          'main 返回之后,bye 照样被叫起来干活——exit 在替整场演出收场(倒序跑 atexit、冲刷缓冲区,' +
          '最后才真正退出);再配 readelf 看 Entry point,「程序从 main 开始、到 main 结束」两头都被推翻了。',
      },
    ],
    selfCheck: [
      '能一句话说清 printf 和 write 的分工吗?(谁是家里的跑腿,谁是真正的门)',
      '小白若咬定「printf 喊一次操作系统跑一趟」,你的三秒空白小实验(sleep + 不带换行)想好了吗?',
      '标准库里哪些函数压根不需要操作系统?能随口举出三个,并说清它们为什么在裸机上也能用吗?',
      'malloc 的「批发—零售」两级结构,能讲清什么时候才真正惊动操作系统吗?',
      '程序在 main 之前和之后各发生了什么?_start、atexit、冲刷缓冲区的先后顺序能排对吗?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「printf 是不是每喊一次,操作系统就立刻收到一次、字马上就上屏?」' +
      '带着这个问题去读下面的材料,想好你打算怎么给它讲明白。纠不动它,它会开心地把错的学走。',
    references: [
      {
        title: 'C 标准库和实现',
        url: 'https://jyywiki.cn/OS/2026/lect9.md',
        kind: '讲义',
        note:
          '本讲原始讲义:从 Freestanding 环境到系统调用的封装再到 C Runtime,' +
          '课上的例子(musl、environ、_start)全部出自这里,备课先通读一遍。',
      },
      {
        title: '09 - C 标准库原理 [2026 南京大学操作系统原理]',
        url: 'https://www.bilibili.com/video/BV1GHXCBkEZf',
        kind: '视频',
        note:
          'UP 主「绿导师原谅你了」(jyy 官方号)的课程回放:现场调试 musl、' +
          '用 watchpoint 抓 environ 是谁赋值的,配合讲义食用最佳。',
      },
      {
        title: 'Operating Systems: Three Easy Pieces',
        url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
        kind: '教程',
        note:
          '课程指定参考书《操作系统导论》官网,全书各章 PDF 免费;' +
          '进程 API 与系统调用相关章节是理解"libc 封装了什么"的地基。',
      },
      {
        title: 'musl libc',
        url: 'https://musl.libc.org/',
        kind: '官方文档',
        note:
          '讲义钦点的学习用 libc 实现官网:比 glibc 干净得多,' +
          '配上调试符号就能从第一条指令一路读到 printf 和 malloc 的真实实现。',
      },
      {
        title: 'C 参考手册 - cppreference.com',
        url: 'https://zh.cppreference.com/w/c',
        kind: '官方文档',
        note:
          '中文的 C 标准库权威速查:每个头文件、每个函数的标准行为与版本沿革,' +
          '备课核对细节(比如缓冲、atexit 的倒序约定)最方便。',
      },
      {
        title: 'stdio(3) - Linux manual page',
        url: 'https://man7.org/linux/man-pages/man3/stdio.3.html',
        kind: '官方文档',
        note:
          'Linux 手册的 stdio 总览页:FILE 流与文件描述符的关系、三种缓冲模式一页讲清,' +
          '是验证本讲要点③的第一手材料。',
      },
    ],
  },
};

export const osLibcDemo: DemoLine[] = [
  {
    label: '① 讲:为什么要有标准库',
    text:
      '我先说说为什么要有这么个东西。程序想办任何正事——在屏幕上打一行字、打开一个文件、体面地退出——' +
      '最终都得请操作系统出手,可直接用系统调用写程序,又苦又琐碎,换个操作系统还得重写。' +
      '所以前辈们把常用的系统调用封装起来,配上一批现成功能,做成一套标准工具箱:它对上服务各种程序,' +
      '对下贴着操作系统,是应用世界的第一级抽象;而且有国际标准撑腰,同一份代码几乎到哪儿都能编译运行,' +
      '标准化换来了世界级的移植性。',
    note: '命中 c1(封装系统调用/第一级抽象/标准化移植)→ 小白开窍复述,追问 c2(打字那位是门还是跑腿的)',
  },
  {
    label: '② 讲:printf 的真身',
    text:
      '那就从最熟的 printf 说起。printf 不是系统调用,它是标准库里的一个库函数,就住在你的程序自己家里,' +
      '它就像餐厅前台的服务员:你把要说的话交给它,它负责整理格式、登记去向,真正把字递出门的,' +
      '是最底下那一次 write 系统调用,由它交给操作系统。而且 printf、fprintf、sprintf 这一家子,' +
      '活儿最后都汇到同一位老师傅 vfprintf 手上,免得同一份手艺抄好几遍;它们手里那张 FILE 单据,' +
      '背后其实包着一个文件描述符。',
    note: '命中 c2 + 金句类比收录(餐厅前台服务员)→ 触发 M1 注入:「喊一次它就跑一趟?」(高潮)',
  },
  {
    label: '③a 被带偏(演示盲区暴露)',
    text:
      '呃,好像还真是这么回事……你想啊,喊人干活哪有拖着的道理!那我记住啦:printf 就是喊一次跑一趟,' +
      '操作系统立刻收到一次,字马上就上屏,一个字都不带耽搁的——又直接又痛快!',
    note: 'M1 判定"被带偏"(命中「喊一次+跑一趟/立刻收到」)→ 小白开心地学错了,盲区落档(severity=high),考小白关联题必错',
  },
  {
    label: '③b 正确纠正(对照分支)',
    text:
      '不对,不是喊一次就送一次。printf 收到你的字,会先写进自己屋里的缓冲区,攒着;' +
      '要等攒到条件了——比如连着屏幕的时候碰到换行——才通过一次 write 系统调用,把这一批一口气交给操作系统。' +
      '所以你喊十次 printf,操作系统可能只听见一次动静。之所以设计成先攒后送,是因为进出操作系统一趟的开销,' +
      '一般比普通函数调用大得多,能少跑一趟是一趟。',
    note: 'M1 判定"已纠正"(命中「不是+喊一次/缓冲区+攒」)+ 顺势命中 c3 → Aha 复述后追问 c4,纠错力 +1',
  },
  {
    label: '④ 串讲:一层一层递话',
    text:
      '我把前面的串一串:首先,程序办正事最终都要过操作系统这道门,可直接敲门又苦又不好搬家,' +
      '所以大家共用一套标准工具箱,当好第一级抽象这层楼梯;然后,printf 这些名字听着神通广大,' +
      '其实都是住在你家里的跑腿伙计;最后,它们也不傻,不会一个字一个字地跑腿,而是先把字揣在兜里,' +
      '凑够一批才出门交一趟差。',
    note: '复述巩固(无新命中)→ 小白就 c4(有没有不用出门的活儿)发起边界追问;Lv5 人格在此轮提前发起迁移追问',
  },
  {
    label: '⑤ 讲:两类函数的分水岭',
    text:
      '接下来是个分水岭:这套工具箱里的家伙什,其实分两类。一类是纯计算的函数,比如 memcpy 搬一段内存、' +
      'qsort 排个序、atoi 把字符串变成数,它们只摆弄内存和寄存器,自己就能算完,压根不用请操作系统出手——' +
      '这一类在完全没有操作系统的裸机环境里也能用,行话叫 freestanding;另一类,像 putchar 打字、' +
      'exit 退出、打开文件,离了系统调用就办不成事。',
    note: '命中 c4 → 触发 M3 注入(malloc 妥妥是个系统调用?)——freshness 规则保证 M3 压过 M2 先注入',
  },
  {
    label: '⑥ 纠正 M3 + 讲开场谢幕',
    text:
      '不对,malloc 还真不是系统调用,它也是个库函数。主流实现里,它先通过系统调用找操作系统批发一大块内存,' +
      '之后你每次 malloc,多半就在这自家仓库里切一小块零售给你,所以大多数时候根本不惊动操作系统;' +
      '等仓库见底了,才再出门批发一趟。另外还有件有意思的事:你的程序其实也不是一睁眼就站在你写的第一行代码上——' +
      '可执行文件真正的入口叫 _start,它先把命令行参数、环境这些道具摆好,再请 main 上场;等 main 谢幕,' +
      '还要把缓冲区里没送走的字送出去、把 atexit 登记过的收尾活儿一件件干完,最后才真正跟操作系统道别。',
    note: '纠正 M3(命中「批发+零售/也是+库函数/不惊动」)+ 命中 c5(_start/真正的入口/atexit)→ 同轮衔接注入 M2(程序从 main 开始?)',
  },
  {
    label: '⑦ 纠正 M2(收尾)',
    text:
      '还真不是——main 只是主角,不是整场戏。开机大幕拉开时,先跑的是后台工作人员:它搭台,' +
      '把命令行参数、环境这些道具一样样摆到位,然后才请 main 上台;等 main 鞠躬下台,戏也没散:' +
      '工作人员还要收场,把攒在后台没送出去的字统统送走,把登记过的收尾活儿一件件干完,最后才关灯锁门,' +
      '跟操作系统说再见。所以是先有人搭台,后有人收场,main 前后都有人干活。',
    note: '纠正 M2(命中「搭台/收场/不是+整场戏」)→ 三误区全纠正、五要点全命中,可下课考小白(预期 100 分出师)',
  },
  {
    label: '卡壳演示(触发 R1 救援)',
    text: '嗯……这里我卡住了,后面该怎么讲一下子想不起来了……',
    note: '卡壳信号 → 小白递台阶(R1);连续两次 → 一起查书(R2)',
  },
  {
    label: '偏题演示(内容围栏)',
    text: '小白,天台的猫又下崽了,毛茸茸的一窝,放学要不要一起去看看,再给猫妈妈带点小鱼干?',
    note: '偏题 → 小白角色内拉回:「这跟今天的知识点没关系吧」',
  },
];

/**
 * 摸底快测题组(聚合于 src/data/selfTest.ts)。
 * 出题纪律:不与 quizBank / probe 题干重复,只考同一要点的另一侧面;
 * 干扰项须是"听着有道理的常见误解",每题只留一个略带幽默的。
 * 分寸沿用文件头内容红线:缓冲策略说"主流实现",malloc 只说"批发—零售、通常不进内核"。
 */
export const osLibcSelfTest: SelfTestItem[] = [
  {
    id: 'st1',
    dimension: '推演',
    code: 'printf("饭好了");  // 没有换行\nsleep(60);',
    question: '厨房程序喊了一声「饭好了」,可屏幕上一分钟都没动静,最可能的原因是?',
    options: [
      '操作系统在忙,还没轮到它',
      '这句话没带换行,还躺在用户态缓冲区里等着凑批',
      '屏幕临时黑屏了',
      'printf 在闹情绪,建议给它涨工资',
    ],
    answerIndex: 1,
    explanation: '主流实现连终端时行缓冲:不见换行不冲刷——字被攒住了,不是丢了。',
    checklistRef: 'c3',
    mcRef: 'os_libc_M1',
  },
  {
    id: 'st2',
    dimension: '概念',
    question: '把 C 标准库比作生活里的角色,哪个最贴切?',
    options: [
      '一位替你跑腿办事的驻家管家:对你说人话,对官府替你走正规手续',
      '一台自动印钞机,要多少有多少',
      '操作系统的顶头上司',
      '一堵墙,把程序和操作系统彻底隔死',
    ],
    answerIndex: 0,
    explanation: '标准库对上提供好用的标准函数,对下按规矩替你发系统调用——正是"第一级抽象"这位管家。',
    checklistRef: 'c1',
    mcRef: null,
  },
  {
    id: 'st3',
    dimension: '辨析',
    question: '「库函数」和「系统调用」的关系,哪句站得住脚?',
    options: [
      '库函数就是系统调用的别名,一一对应',
      '每个库函数背后都恰好藏着一次系统调用',
      '库函数是用户态的封装:有的纯计算零系统调用,有的包着一次或多次系统调用',
      '系统调用是库函数的一种,谁实现的都一样',
    ],
    answerIndex: 2,
    explanation: 'memcpy 一次门都不出,printf 攒一批才出一次门,malloc 平时不出门——两者不是一回事。',
    checklistRef: 'c4',
    mcRef: 'os_libc_M3',
  },
  {
    id: 'st4',
    dimension: '边界',
    question: '程序算了半天,最后一行结果没带换行就崩掉了(异常终止),屏幕上那行结果多半会怎样?',
    options: [
      '照样显示,操作系统会兜底',
      '跟着丢了——它还躺在用户态缓冲区里,没来得及冲刷出门',
      '自动存进一个备份文件',
      '下次开机时补印出来',
    ],
    answerIndex: 1,
    explanation: '异常终止不走 exit 的正常收场,缓冲区里没送走的字随进程一起消失——调试打日志常因此加换行或及时冲刷。',
    checklistRef: 'c3',
    mcRef: null,
  },
  {
    id: 'st5',
    dimension: '应用',
    question: '看一场话剧:开演前有人搭台摆道具,主角谢幕后还有人收场、关灯锁门——最像这一讲里的哪个设计?',
    options: [
      '缓冲区先攒一批再送',
      '程序的开场与谢幕:_start 先搭好台才请 main 上台,main 返回后还要收尾才真正退出',
      '两类函数的分水岭',
      '剧院会员卡打折',
    ],
    answerIndex: 1,
    explanation: 'main 只是主角:C runtime 开场搭台、exit 谢幕收场,前后都有人干活。',
    checklistRef: 'c5',
    mcRef: 'os_libc_M2',
  },
  {
    id: 'st6',
    dimension: '概念',
    question: '你让程序说一句话,最后把这句话真正递出家门、交到操作系统手上的是谁?',
    options: [
      'printf 亲自送到屏幕上',
      '编译器',
      '最底下那一次 write 系统调用',
      '鼠标',
    ],
    answerIndex: 2,
    explanation: 'printf 只在家里整理格式、攒批;真正出门过户的,是 write 这道系统调用。',
    checklistRef: 'c2',
    mcRef: null,
  },
  {
    id: 'st7',
    dimension: '推演',
    question: '把程序搬到一块完全没有操作系统的裸板子上跑,下面哪件事还能照常干?',
    options: [
      '用 memcpy 把一段内存搬个家',
      '打开文件写日志',
      '往屏幕 printf 一首诗',
      '优雅地 exit 退出',
    ],
    answerIndex: 0,
    explanation: '纯计算函数只依赖内存和寄存器,freestanding 环境照用;开文件、打印、退出都得有操作系统接活。',
    checklistRef: 'c4',
    mcRef: null,
  },
];
