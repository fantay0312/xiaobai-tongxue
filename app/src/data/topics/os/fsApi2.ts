/**
 * 知识点:文件系统 API (2)(《操作系统原理》第 25 讲)—— 全密度教学脚本。
 * 讲义:https://jyywiki.cn/OS/2026/lect25.md
 * 视频:https://www.bilibili.com/video/BV12gVs6SExQ
 *
 * 演示编排:
 *   ① c1 → ② c2+金句 → 注入 M1(把监控误解成轮询)
 *   ③b 纠正 M1 + 顺势命中 c3 → ④ 串讲无新命中(Lv5 在此轮提前迁移)
 *   ⑤ c4 → 注入 M3(把覆盖误解成真合并) → ⑥ 纠正 M3 + c5 → 同轮衔接注入 M2
 *   ⑦ 纠正 M2 收尾。
 *
 * 内容红线(备课研究核定):
 *   - 不把文件系统说死成“磁盘块管理器”;本讲口径是“把文件系统看作数据结构/API”,但仍受权限、
 *     一致性、性能和内核接口约束。
 *   - inotify/FSEvents 等是事件通知机制,不是“永远不需要一致性校验”的魔法;健壮程序仍要考虑丢事件、
 *     race 和重建缓存。
 *   - Git 的快照讲成对象和引用的持久化数据结构;不承诺所有工作区误删都能恢复,讲义分寸是
 *     “除了 git reset --hard 清除的工作区,只要不 git gc 通常可恢复”。
 *   - OverlayFS 展示的是 merged 虚拟视图;写入进 upper,删除 lower 名字靠 whiteout 遮住,不是改掉 lower。
 *   - FUSE 允许用户态实现文件系统操作,但“任意数据结构”是设计空间,不是免费获得高性能或强安全。
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osFsApi2Topic: Topic = {
  topicId: 'os-fs-api-2',
  title: '文件系统 API (2)',
  course: '操作系统原理',
  tagline: '把目录树变成会变戏法的数据结构',
  transferHint: '把远处仓库、数据库或游戏素材伪装成一个本地文件夹',
  checklist: [
    {
      id: 'c1',
      point: '目录树不只会增删改查',
      groundTruth:
        '本讲从“文件系统作为 Abstract Data Type 还可以支持怎样的操作”出发:上一讲的 mount、mkdir、rmdir、getdents、link、symlink、mode、xattr、ACL 仍像 CRUD 小步操作;如果把文件系统看作数据结构,就能设计监控、快照、覆盖、用户态虚拟化等更高层操作。结论不是抛弃 POSIX,而是在 POSIX 之外看到文件系统 API 的设计空间。',
      keywords: [
        ['不只是', '增删改查'],
        ['文件系统', '数据结构'],
        ['Abstract Data Type'],
        ['监控', '快照', '覆盖'],
      ],
      terms: ['CRUD', 'Abstract Data Type'],
      level: 'L1',
      lookupCard:
        '**先把眼界放宽**\n\n上一讲已经会了目录、链接、元数据这些“一小步操作”。本讲的问题是:如果把整棵目录树当成一个数据结构,它还能不能支持更大的动作?\n\n答案是能:可以让变化主动通知你,可以保留历史版本,可以把几层目录叠成一个视图,甚至可以让自己写的程序假装成一套文件夹。\n\n分寸:这不是说传统接口没用,而是说传统接口之外还有更大的设计空间。',
      probeLine: '老师,这棵文件树除了开门、改名、搬东西,还能不能帮我盯变化、留历史呀?',
    },
    {
      id: 'c2',
      point: '变化要被通知,别总全屋巡逻',
      groundTruth:
        '如果只有 CRUD API,应用想知道文件变化只能遍历目录、记录 last modified 再做 diff;目录里有几百万个文件时成本很高。Linux inotify 通过 inotify_init 返回 fd,再用 inotify_add_watch(fd, pathname, mask) 注册 watch;变化发生后,事件可从这个 fd 读出。macOS 有 FSEvents,Python watchdog 可选择 Observer 或 PollingObserver。事件通知减少轮询,但健壮程序仍需处理丢事件、race 和缓存重建。',
      keywords: [
        ['inotify'],
        ['FSEvents'],
        ['watchdog'],
        ['变化', '通知'],
        ['不用', '轮询'],
      ],
      terms: ['inotify', 'FSEvents', 'watchdog', '轮询'],
      level: 'L2',
      lookupCard:
        '**监控:让变化来敲门**\n\n土办法是隔一会儿把目录扫一遍,记下每个文件的修改时间,前后做 diff。文件少还行,文件多就很累。\n\nLinux 的 **inotify** 做法是先 `inotify_init()` 拿到一个 fd,再 `inotify_add_watch(fd, pathname, mask)` 注册想看的文件或目录。之后有变化,程序从这个 fd 读事件。macOS 有 **FSEvents**,Python 的 **watchdog** 也能用系统事件后端。\n\n分寸:事件通知不是“永不出错”;健壮程序仍要考虑 race、队列溢出和重建缓存。',
      probeLine: '老师,要是屋里东西一变我就想知道,是不是只能每隔一会儿进去数一遍?',
    },
    {
      id: 'c3',
      point: '快照靠对象和指针留住历史',
      groundTruth:
        '讲义把 Random read + append-only write 概括为持久化数据结构,并用 Git 说明快照。Git 的三类对象直接存储在 .git/objects:blob 存内容,tree 存 mode/filename/hash 条目,commit 存 tree hash 和 parent hash;refs/heads/[branch] 是指向 commit object 的指针,.git/HEAD 通常是指向 refs/heads/main 的“指针的指针”。Git worktree 自 Git 2.5(2015)起支持多个工作区同时连到同一仓库,本质上仍围绕快照和引用管理。',
      keywords: [
        ['blob', 'tree', 'commit'],
        ['refs/heads', 'HEAD'],
        ['快照', '指针'],
        ['worktree', '分支'],
      ],
      terms: ['快照', '持久化数据结构', 'blob', 'tree', 'commit', 'refs', 'HEAD', 'worktree'],
      level: 'L3',
      lookupCard:
        '**快照不是整屋复印,而是对象和指针**\n\nGit 像一套持久化数据结构:内容进 **blob**,目录条目进 **tree**,一次提交进 **commit**。分支不是神秘开关,`refs/heads/main` 只是指向某个 commit 的小纸条;`.git/HEAD` 常常又指向这张纸条。\n\n所以保留历史时,新内容追加进去,引用再挪一下。`git worktree` 让多个工作区挂在同一个仓库上,方便同时试不同分支。\n\n分寸:没进对象库的工作区改动,尤其被 `git reset --hard` 清掉的,不能指望 Git 替你兜底。',
      probeLine: '老师,如果我想回到昨天那版,是不是得把所有文件都复制一整份才行?',
    },
    {
      id: 'c4',
      point: '覆盖视图把几层目录叠成一层看',
      groundTruth:
        'OverlayFS/UnionFS 把 lower 和 upper 合成 merged 虚拟目录:同名时优先看到 upper,所有写入进入 upper;可以有多个 lower,但典型挂载只有一个 upper,workdir 是同一文件系统上的内部临时目录,用于实现原子性等需要。在 merged 中删除来自 lower 的名字,不会改 lower,而是在 upper 记录 whiteout 让该名字被遮住。Docker 构建中每次 RUN 可形成一层,新的 upper 会加入下一步的 lower stack 顶部。',
      keywords: [
        ['OverlayFS'],
        ['lower', 'upper'],
        ['merged', '虚拟'],
        ['whiteout'],
        ['Docker', 'layer'],
      ],
      terms: ['OverlayFS', 'lower', 'upper', 'merged', 'workdir', 'whiteout', 'Docker', 'layer'],
      level: 'L3',
      lookupCard:
        '**覆盖:看到的是合成视图**\n\n把只读旧层 **lower** 和可写新层 **upper** 叠在一起,挂成一个 **merged** 目录。同名时先看 upper;新写入也落到 upper。这样旧层不动,新改动单独收着。\n\n删除 lower 里的名字时,不是去改 lower,而是在 upper 放一个 **whiteout** 标记:“这个名字在合成视图里别显示”。`workdir` 是内部临时空间。\n\nDocker 镜像层就是这类思想的重要应用:每一步构建产出一层,下一步把它放到层栈顶上继续看。',
      probeLine: '老师,能不能让大家看见一个合成的柜子,旧东西在下面,新改动另放一层?',
    },
    {
      id: 'c5',
      point: '用户态也能造一套文件夹规则',
      groundTruth:
        'FUSE(File System in User Space)把 lookup、read、write 等文件系统操作从内核转发给用户态 FUSE driver;开发者实现 struct fuse_operations 中的回调即可,其中包括 getattr、readlink、mkdir、unlink、rename、link、open、read、write、setxattr、readdir 等。这样远程目录、git 仓库、数据库、JSON 数据甚至非常规规则都能包装成文件系统接口,让普通 UNIX 命令直接使用。分寸:实现自由不等于性能、安全和一致性自动成立。',
      keywords: [
        ['FUSE'],
        ['fuse_operations'],
        ['lookup', 'read', 'write'],
        ['用户态', '文件系统'],
        ['任意数据结构'],
      ],
      terms: ['FUSE', 'fuse_operations', 'lookup', 'read', 'write', 'setxattr', 'sshfs'],
      level: 'L5',
      lookupCard:
        '**自己写规则,也能长得像文件夹**\n\n**FUSE** 的思路是:内核收到“找名字、读内容、写内容”等请求后,转给用户态程序。你实现 **fuse_operations** 里的回调,这套程序就能被挂成一个文件夹。\n\n于是远程目录可以像本地目录,数据库可以像文件树,JSON 也能被普通命令逛。讲义里说这接近“Everything is a file”的终极实现。\n\n分寸:能实现不代表免费好用。权限、缓存、一致性和速度都要自己认真设计。',
      probeLine: '老师,要是我自己写一套规则,能不能也让普通命令把它当文件夹用?',
    },
  ],
  misconceptions: [
    {
      mcId: 'os_fs_api_2_M1',
      topicId: 'os-fs-api-2',
      belief: '文件监控就是定时全目录扫描,系统 API 只是把这个巡逻活自动化',
      triggerLine:
        '哦,老师我懂了!所谓盯变化,其实就是系统帮我每隔几秒把所有文件扫一遍,比对时间戳,' +
        '只是它扫得勤一点、快一点,本质还是全屋巡逻,对吧?',
      correctionCriteria: [
        '指出轮询遍历时间戳只是没有监控 API 时的土办法',
        '说明 inotify/FSEvents/watchdog 的系统事件后端是在变化发生后通知应用,程序从 fd 或事件队列读结果',
        '补充分寸:事件通知减少轮询,但健壮程序仍要处理丢事件、race 和缓存重建',
      ],
      correctionKeywords: [
        ['不是', '全扫'],
        ['不用', '轮询'],
        ['变化', '通知'],
        ['内核', '告诉'],
      ],
      adoptionKeywords: [
        ['定时', '扫一遍'],
        ['遍历', '时间戳'],
        ['一直轮着查'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: '文件监控本质就是系统定时帮你全目录扫描并比对时间戳。',
        isTrue: false,
        explanation:
          '轮询是没有事件 API 时的退路;inotify/FSEvents 等让变化发生后主动通知应用,避免每轮全目录扫描,但仍要处理边界情况。',
      },
      remedy: {
        microLesson: {
          title: '别把门铃说成巡逻',
          body:
            '把监控想成两种办法:\n\n' +
            '```\n土办法:每隔一会儿进屋,把所有抽屉打开数一遍。\n事件办法:抽屉一动,门口铃铛响,你去看是哪一个。\n```\n\n' +
            '讲义里的 `stat ... | diff` 是第一种:拿修改时间做前后对比。目录里只有几十个文件还能忍,几百万个文件就很难受。\n\n' +
            'inotify 走第二种:程序先拿一个 fd,给路径加 watch;后面变化来了,从 fd 里读事件。Python watchdog 的 Observer 也可以接系统后端。分寸要补一句:门铃可能挤爆、可能赶上 race,所以大型程序仍会做一致性检查,必要时重扫一遍。\n\n' +
            '一句话:轮询是备胎,事件通知才是本讲要点。',
          askBack: '下次小白再说「就是系统帮我定时扫」,你准备用“门铃和巡逻”怎么纠正它?',
        },
        predictionQuiz: [
          {
            id: 'm1-1',
            question: '只有 CRUD 小步操作时,想知道目录变化,最直接但很笨的办法是什么?',
            options: [
              '注册事件,变化来了再读事件',
              '遍历目录、记录修改时间,前后做 diff',
              '把目录改名三次观察心情',
              '只看文件名第一个字',
            ],
            answerIndex: 1,
            explanation: '没有监控 API 时只能轮询和对比时间戳;这正是 inotify 这类机制要避免的成本。',
            checklistRef: 'c2',
            mcRef: 'os_fs_api_2_M1',
          },
          {
            id: 'm1-2',
            question: 'inotify 的核心区别是什么?',
            options: [
              '让变化发生后以事件形式通知应用',
              '把每个文件都复制一份',
              '强制所有目录只读',
              '把文件名改成编号',
            ],
            answerIndex: 0,
            explanation: 'inotify 注册 watch 后从 fd 读事件,不是每轮全目录巡逻。',
            checklistRef: 'c2',
            mcRef: 'os_fs_api_2_M1',
          },
          {
            id: 'm1-3',
            question: '事件通知是不是意味着程序永远不用做一致性校验?',
            options: [
              '是,有事件就绝对不会漏',
              '不是,健壮程序仍要考虑丢事件、race 和重建缓存',
              '是,因为内核会替应用写测试',
              '不是,因为事件只能通知天气',
            ],
            answerIndex: 1,
            explanation: '事件通知降低轮询成本,但不是魔法;缓存一致性仍要由应用认真处理。',
            checklistRef: 'c2',
            mcRef: 'os_fs_api_2_M1',
          },
        ],
      },
    },
    {
      mcId: 'os_fs_api_2_M2',
      topicId: 'os-fs-api-2',
      belief: '真正的文件系统必须直接管理磁盘块,FUSE 和覆盖目录只是外面套壳的小技巧',
      triggerLine:
        '可是老师,我还是觉得真正的文件系统就得在磁盘块上安家吧?像 FUSE、OverlayFS 这种听起来只是外面套壳,' +
        '普通命令能看见不代表它真算一套文件系统,对吧?',
      correctionCriteria: [
        '指出本讲核心视角是把文件系统看作数据结构和 API,不只看块设备实现',
        '说明 FUSE 把 lookup/read/write 等请求转发给用户态程序,实现回调后普通命令就能使用这套接口',
        '保留边界:这种自由仍受权限、性能、一致性和内核转发接口约束',
      ],
      correctionKeywords: [
        ['不是', '磁盘块'],
        ['FUSE', '转发'],
        ['任意数据结构'],
        ['普通命令', '使用'],
      ],
      adoptionKeywords: [
        ['必须', '磁盘块'],
        ['只是', '套壳'],
        ['不算真正'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: '只有直接管理磁盘块的才算文件系统,FUSE 这类用户态方案只是表面套壳。',
        isTrue: false,
        explanation:
          '主流实现里磁盘块很重要,但本讲讨论的是文件系统 API 的抽象能力;FUSE 能把操作转发给用户态回调,让任意数据结构长成文件系统接口。',
      },
      remedy: {
        microLesson: {
          title: '看接口,别只盯砖头',
          body:
            '小白把“真文件系统”绑死在磁盘块上,是把实现材料和外部接口混在了一起。\n\n' +
            '本讲要你换个视角:用户看到的是一组操作,比如找名字、读内容、写内容、列目录、改属性。至于背后是磁盘、远程机器、数据库,还是一段用户态程序,只要这组操作被正确接住,普通命令就能使用。\n\n' +
            'FUSE 正是这个分界:内核把请求转发给用户态 driver,driver 实现回调。你可以把远端目录、Git 仓库、JSON 数据包装成文件夹。分寸也要讲:这不是说性能和安全自动没问题,缓存、权限、一致性都还要设计。\n\n' +
            '一句话:磁盘块是常见材料,文件系统接口才是这节课的主角。',
          askBack: '下次小白说「不管磁盘块就不算真的」,你怎么区分“材料”和“接口”?',
        },
        predictionQuiz: [
          {
            id: 'm2-1',
            question: 'FUSE 让用户态程序最关键地接住了什么?',
            options: [
              '文件系统操作请求,如 lookup/read/write 等',
              '显示器亮度变化',
              'CPU 风扇转速',
              '键盘按键颜色',
            ],
            answerIndex: 0,
            explanation: 'FUSE 的核心是内核转发文件系统操作,用户态 driver 实现对应回调。',
            checklistRef: 'c5',
            mcRef: 'os_fs_api_2_M2',
          },
          {
            id: 'm2-2',
            question: '“文件系统 = 数据结构”这句话最想提醒什么?',
            options: [
              '只能把文件存在机械硬盘上',
              '可以围绕一组操作设计更丰富的后端和视图',
              '目录树不需要权限',
              '所有文件都必须叫 data.txt',
            ],
            answerIndex: 1,
            explanation: '本讲强调 API 和数据结构视角,由此才有监控、快照、覆盖和用户态虚拟化。',
            checklistRef: 'c1',
            mcRef: 'os_fs_api_2_M2',
          },
          {
            id: 'm2-3',
            question: '用 FUSE 包一套数据库成文件夹,还需要担心什么?',
            options: [
              '不需要担心,接口一挂就自动完美',
              '只担心图标好不好看',
              '仍要设计权限、性能、缓存和一致性',
              '只能担心文件名太文艺',
            ],
            answerIndex: 2,
            explanation: 'FUSE 给的是接口自由,不是免费性能和免费安全。',
            checklistRef: 'c5',
            mcRef: 'os_fs_api_2_M2',
          },
        ],
      },
    },
    {
      mcId: 'os_fs_api_2_M3',
      topicId: 'os-fs-api-2',
      belief: 'OverlayFS 会把上下两层真的合并成一份,删除时也会删掉下面那层原文件',
      triggerLine:
        '老师,那我懂了:OverlayFS 就是把上面那层和下面那层真的合并成一个目录副本吧?' +
        '如果我在合成目录里删东西,下面那层原文件也就被删掉了,对吧?',
      correctionCriteria: [
        '指出 merged 是虚拟视图,不是把 lower 和 upper 真的复制合并成一份',
        '说明写入进入 upper,同名时 upper 遮住 lower',
        '说明删除 lower 名字时在 upper 记录 whiteout,lower 原文件不被改掉',
      ],
      correctionKeywords: [
        ['不是', '真的合并'],
        ['不会', '改掉下面'],
        ['whiteout'],
        ['upper', '记录'],
      ],
      adoptionKeywords: [
        ['真的合并'],
        ['删掉', '下面'],
        ['复制成', '一份'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: 'OverlayFS 的 merged 目录是 lower 和 upper 真正复制合并后的目录,删除会直接删 lower 原文件。',
        isTrue: false,
        explanation:
          'merged 是虚拟视图;写入在 upper,同名先看 upper,删除 lower 的名字靠 upper 里的 whiteout 遮住,lower 不被直接修改。',
      },
      remedy: {
        microLesson: {
          title: '合成橱窗,不是砸掉仓库',
          body:
            'OverlayFS 最容易被说错的地方,就是把“看起来合在一起”误听成“真的揉成一团”。\n\n' +
            '正确画面是三层:旧货在 lower,新改动在 upper,你站在 merged 橱窗前看。同名商品先看 upper,所以新版本遮住旧版本;写新东西也只进 upper。\n\n' +
            '删除更关键:如果删的是 lower 里的名字,系统不能去改 lower,而是在 upper 放一个 whiteout 标记,意思是“橱窗里别再展示下面这个名字”。所以网吧还原、试升级、Docker 层叠才安全:旧层保持干净,改动集中在新层。\n\n' +
            '分寸:workdir 是内部临时空间,不是给用户放文件的第四层。',
          askBack: '下次小白说「删合成目录就是删下面原件」,你准备用“橱窗和仓库”怎么讲?',
        },
        predictionQuiz: [
          {
            id: 'm3-1',
            question: '在 OverlayFS 的 merged 里,同名文件上下两层都有时先看到哪一份?',
            options: ['lower', 'upper', 'workdir', '随机抽签'],
            answerIndex: 1,
            explanation: '同名时 upper 优先,它遮住 lower 的版本。',
            checklistRef: 'c4',
            mcRef: 'os_fs_api_2_M3',
          },
          {
            id: 'm3-2',
            question: '删除来自 lower 的名字时,OverlayFS 典型做法是什么?',
            options: [
              '直接把 lower 原文件删掉',
              '在 upper 记录 whiteout,让合成视图里看不见它',
              '把文件复制到 workdir 给用户保管',
              '把名字改成“别看我”',
            ],
            answerIndex: 1,
            explanation: 'whiteout 是“遮住”的记录,不是直接改掉 lower。',
            checklistRef: 'c4',
            mcRef: 'os_fs_api_2_M3',
          },
          {
            id: 'm3-3',
            question: 'OverlayFS 的 workdir 应该怎么理解?',
            options: [
              '用户真正写文件的目录',
              '内部临时空间,常用于支撑原子性等实现需要',
              'lower 的别名',
              '专门存放壁纸的目录',
            ],
            answerIndex: 1,
            explanation: 'workdir 是文件系统内部用的临时空间,不是用户视图里的普通层。',
            checklistRef: 'c4',
            mcRef: 'os_fs_api_2_M3',
          },
        ],
      },
    },
  ],
  quizBank: [
    {
      id: 'q1',
      question: '本讲为什么一开始要把文件系统当成数据结构来看?',
      options: [
        '因为传统目录操作全都没用了',
        '为了看到监控、快照、覆盖、用户态虚拟化等更大的 API 设计空间',
        '因为文件名必须改成数字',
        '为了证明所有系统都不需要权限',
      ],
      answerIndex: 1,
      explanation: '本讲不是否定传统操作,而是把目录树提升成可设计的数据结构接口。',
      checklistRef: 'c1',
      mcRef: 'os_fs_api_2_M2',
    },
    {
      id: 'q2',
      question: '和遍历目录比对时间戳相比,inotify 这类机制的优势是什么?',
      options: [
        '变化发生后以事件通知应用,减少反复全目录扫描',
        '把所有文件压缩成一个文件',
        '让文件永远不会被修改',
        '让目录只能有一个文件',
      ],
      answerIndex: 0,
      explanation: '事件通知避免把“盯变化”退化成每轮全屋巡逻。',
      checklistRef: 'c2',
      mcRef: 'os_fs_api_2_M1',
    },
    {
      id: 'q3',
      question: 'Git 里 refs/heads/main 更像什么?',
      options: [
        '一份完整文件内容',
        '指向某个 commit object 的指针',
        '专门存图片的目录',
        '自动清理工作区的扫帚',
      ],
      answerIndex: 1,
      explanation: '分支引用只是指向提交对象的指针,HEAD 通常再指向当前分支引用。',
      checklistRef: 'c3',
      mcRef: null,
    },
    {
      id: 'q4',
      question: 'OverlayFS 中 merged 目录最准确的说法是?',
      options: [
        'lower 和 upper 真正复制合并后的一份目录',
        '由 lower/upper 叠出的虚拟视图,同名优先看 upper',
        '只能显示 workdir 里的文件',
        '删除任何名字都会立刻清空所有层',
      ],
      answerIndex: 1,
      explanation: 'merged 是合成视图;写入进 upper,删除 lower 名字靠 whiteout 遮住。',
      checklistRef: 'c4',
      mcRef: 'os_fs_api_2_M3',
    },
    {
      id: 'q5',
      question: 'FUSE 的核心能力是什么?',
      options: [
        '把所有文件强制放到光盘里',
        '让内核把文件系统操作转发给用户态程序实现',
        '只负责修改文件图标',
        '替程序自动写 README',
      ],
      answerIndex: 1,
      explanation: '实现 fuse_operations 回调后,普通命令就能通过文件系统接口使用你的后端。',
      checklistRef: 'c5',
      mcRef: 'os_fs_api_2_M2',
    },
    {
      id: 'q6',
      question: '下面哪句话最符合本讲结论?',
      options: [
        '文件系统只能是磁盘块上的目录树',
        '把文件系统看作数据结构,就能设计监控、快照、覆盖和定制化接口',
        '只要有 OverlayFS 就不需要备份',
        '只要有 FUSE 就自动拥有最高性能',
      ],
      answerIndex: 1,
      explanation: '本讲主线是接口视角变宽,但每种机制仍有自己的边界。',
      checklistRef: 'c1',
      mcRef: 'os_fs_api_2_M2',
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟串讲:文件树原来还能这么玩',
      body:
        '1. **先换视角**。上一讲的 mkdir、link、mode 像一小步一小步改目录;本讲问的是:如果整棵文件树是一种数据结构,还能不能有更大的动作?答案就是监控、快照、覆盖和用户态虚拟化。\n' +
        '2. **监控不是巡逻**。没有事件 API 时,只能遍历目录、记修改时间再 diff;文件一多就炸。inotify/FSEvents/watchdog 让变化发生后通知应用,程序读事件,不用每轮全扫。分寸是事件也可能丢,健壮程序要能重建缓存。\n' +
        '3. **快照是对象和指针**。Git 用 blob 存内容、tree 存目录、commit 存一次历史;refs/heads 是指向 commit 的小纸条,HEAD 又常指向这张纸条。worktree 让多个工作区并行看不同分支,本质仍是快照管理。\n' +
        '4. **覆盖是合成视图**。OverlayFS 把 lower 和 upper 叠成 merged;同名看 upper,写入进 upper,删除 lower 名字靠 whiteout 遮住。Docker layer、试升级、网吧还原都吃这套。\n' +
        '5. **终极虚拟化是自己写规则**。FUSE 把 lookup/read/write 转给用户态 driver;实现 fuse_operations,远端目录、数据库、JSON 都能长成文件夹。\n\n' +
        '**判断口诀**:盯变化看事件,留历史看对象,叠目录看上下层,造世界看回调。\n\n' +
        '**讲课节奏建议**:先让小白承认“文件树不只会小修小补”,再用门铃类比讲监控。它会立刻误会成定时巡逻,要先纠正再进 Git 快照。中场用“对象库+小纸条”串起 refs/HEAD。讲 OverlayFS 时画三层橱窗,一定强调 whiteout 只是遮住。最后用 FUSE 把视角推到“任何数据结构都能包装成文件夹”,同时提醒性能和一致性不是白送。\n\n' +
        '**一句话收束**:文件系统 API 的想象力,来自把目录树当成可组合、可回溯、可包装的数据结构,而不只是磁盘上的增删改查。\n\n' +
        '**再深一锹(选读)**:讲义提到 eBPF,它把“监控内核行为”继续推进到可编程 probe;又提到 just-in-time systems,说明有了清晰 specification 后,Agent 可以按环境临时合成系统。这里别展开太远,只把它作为“机制与策略分离”的例子。',
    },
    examples: [
      {
        title: '例 1:轮询和事件的差别',
        code:
          '土办法:\n' +
          "diff <(stat -c '%n %y' **) <(sleep 2; date > a.txt; stat -c '%n %y' **)\n\n" +
          '事件办法:\n' +
          'fd = inotify_init();\n' +
          'inotify_add_watch(fd, ".", IN_CREATE | IN_MODIFY | IN_DELETE);',
        walkthrough:
          '第一段每次都把目录里东西数一遍,文件多时成本跟目录规模一起涨。第二段先登记要看的地方,后面变化来了再读事件。讲时要留分寸:事件后端减少巡逻,但队列溢出、race 后仍可能需要重扫校准。',
      },
      {
        title: '例 2:Git 快照的三种对象',
        code:
          '.git/objects/\n' +
          'blob   = 文件内容\n' +
          'tree   = mode + filename + hash\n' +
          'commit = tree hash + parent hash...\n' +
          'refs/heads/main -> 某个 commit\n' +
          'HEAD -> refs/heads/main',
        walkthrough:
          '不要把分支讲成复制出一个完整目录。内容对象追加保存,tree 把名字和 hash 组织起来,commit 串成历史,分支引用只是小纸条。worktree 只是让多个工作区同时指向不同纸条,不是把仓库本体复制散了。',
      },
      {
        title: '例 3:OverlayFS 三层橱窗',
        code:
          'mount -t overlay overlay \\\n' +
          '  -o lowerdir=L1:L2,upperdir=U,workdir=W \\\n' +
          '  merged\n\n' +
          '读:同名先看 U\n' +
          '写:新内容进 U\n' +
          '删 lower 里的名字:U 里放 whiteout',
        walkthrough:
          'merged 是橱窗,lower 是旧仓库,upper 是新改动。删除 lower 的名字不是砸旧仓库,而是在 upper 贴“别展示”的标签。Docker 构建时每次 RUN 形成一层,下一步把上一层放到 lower 栈顶继续看。',
      },
    ],
    selfCheck: [
      '能把“文件系统不只是 CRUD”说成一个数据结构视角的问题吗?',
      '能用门铃 vs 巡逻讲清 inotify 和轮询的区别,并补上事件可能丢的分寸吗?',
      '能画出 Git 的 blob/tree/commit/refs/HEAD 小纸条关系吗?',
      '能解释 OverlayFS 删除 lower 名字为什么是 whiteout,不是改 lower 吗?',
      '能把 FUSE 讲成“内核转发请求给用户态回调”,同时不夸大性能和安全吗?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「监控文件变化不就是系统定时帮我全目录扫描、比对时间戳吗?」' +
      '带着这个问题去读下面的材料,先想好怎么用“门铃不是巡逻”把它纠回来。',
    references: [
      {
        title: '文件系统 API (2)',
        url: 'https://jyywiki.cn/OS/2026/lect25.md',
        kind: '讲义',
        note: '本讲原始讲义,按“监控、快照、覆盖、FUSE”四条主线展开文件系统 API 的设计空间。',
      },
      {
        title: '25 - 文件系统 API (2) [2026 南京大学操作系统原理]',
        url: 'https://www.bilibili.com/video/BV12gVs6SExQ',
        kind: '视频',
        note: 'UP 主「绿导师原谅你了」(jyy 官方号)发布的本讲视频,适合核对讲义中 Git、OverlayFS、FUSE 的课堂讲法。',
      },
      {
        title: 'Operating Systems: Three Easy Pieces',
        url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
        kind: '教程',
        note: 'OSTEP 官方免费教材主页,Persistence 部分的 Files and Directories 与 File System Implementation 可补文件系统基础。',
      },
      {
        title: 'inotify(7) — Linux manual page',
        url: 'https://man7.org/linux/man-pages/man7/inotify.7.html',
        kind: '官方文档',
        note: 'Linux man-pages 对 inotify 的权威说明,重点看 inotify_init、inotify_add_watch 和事件结构。',
      },
      {
        title: 'Git - Git Objects',
        url: 'https://git-scm.com/book/en/v2/Git-Internals-Git-Objects',
        kind: '教程',
        note: 'Git 官方书的对象模型章节,可核对 blob、tree、commit 以及内容寻址存储的细节。',
      },
      {
        title: 'Overlay Filesystem — The Linux Kernel  documentation',
        url: 'https://docs.kernel.org/filesystems/overlayfs.html',
        kind: '官方文档',
        note: 'Linux 内核文档中 OverlayFS 的权威说明,重点看 upper/lower/merged、workdir、whiteout 和 copy_up。',
      },
      {
        title: 'libfuse: fuse_operations Struct Reference',
        url: 'https://libfuse.github.io/doxygen/structfuse__operations.html',
        kind: '官方文档',
        note: 'libfuse 对 fuse_operations 回调表的说明,可核对 read、write、readdir、setxattr 等用户态文件系统入口。',
      },
    ],
  },
};

export const osFsApi2Demo: DemoLine[] = [
  {
    label: '① 讲:文件树不只会小修小补',
    text:
      '我先把这讲的视角立起来:上一讲那些 mkdir、link、mode,都像是在目录树上做一小步一小步的增删改查。' +
      '但文件系统本身也可以被看成一个数据结构,甚至看成一个 Abstract Data Type:除了开文件、列目录、改属性,' +
      '我们还可以设计更大的操作,比如监控变化、保存快照、把目录覆盖成一个视图,甚至把自己写的后端伪装成文件夹。',
    note: '命中 c1(文件系统=数据结构/API 视角)→ Lv1 追问 c2;Lv3 会加速追问 c3',
  },
  {
    label: '② 讲:变化通知像门铃',
    text:
      '先看监控变化。如果只有普通的 CRUD 接口,你想知道谁变了,只能一遍遍遍历目录、记录每个文件的修改时间再 diff;' +
      '目录里有几百万个文件时,这就很痛苦。Linux 的 inotify 是另一种路:inotify_init 先给你一个 fd,' +
      'inotify_add_watch 把路径和事件 mask 登记进去,后面有变化就从这个 fd 读事件。macOS 有 FSEvents,' +
      'Python watchdog 也能接系统事件后端。就像门口装了铃,东西一动铃来叫你,不用你一直轮询着全屋巡逻。',
    note: '命中 c2 + 金句类比收录(门铃 vs 巡逻)→ 触发 M1:小白把监控误解成定时全扫',
  },
  {
    label: '③a 被带偏(演示盲区暴露)',
    text:
      '对,我就顺着这个记:监控其实还是定时扫一遍,把所有文件的时间戳拿来比一比。' +
      '系统只是一直轮着查,查得比我手写脚本快一点,本质没差。',
    note: 'M1 判定“被带偏”(命中定时+扫一遍/时间戳)→ 小白开心学错,关联题会掉分',
  },
  {
    label: '③b 正确纠正(对照分支)',
    text:
      '不对,这不是隔一会儿把目录全扫一遍。遍历时间戳只是没有事件接口时的土办法;有 inotify 这类机制时,' +
      '内核可以在变化发生后通知应用,程序从 fd 里读事件,不用一直轮询。当然队列溢出或 race 还可能让缓存不准,' +
      '所以健壮程序必要时会重建缓存。接着看历史怎么留住:Git 把内容放进 blob,目录条目放进 tree,' +
      '一次历史放进 commit;refs/heads/main 是指向 commit 的指针,HEAD 又常常指向这个 refs。' +
      'git worktree 可以让另一个目录检出别的分支,但核心仍是快照对象加指针。',
    note: '纠正 M1(不是全扫/变化通知)+ 顺势命中 c3(Git 对象与指针快照)→ 追问 c4',
  },
  {
    label: '④ 串讲:接口眼光串起来',
    text:
      '我们把前半段串一下:这节课不是只教某个命令,而是在换眼光。目录树能让变化来报信,也能把历史留成一组对象,' +
      '再用小纸条指向当前版本。也就是说,只要把这棵树当成数据结构,就不必局限在开门、搬东西、改标签这些小动作上。',
    note: '复述巩固,与主题词汇有交集但不命中新 checklist → Lv5 学习力在此轮提前迁移',
  },
  {
    label: '⑤ 讲:覆盖视图三层橱窗',
    text:
      '再看覆盖目录,典型机制叫 OverlayFS。它把 lower 和 upper 叠成一个 merged 虚拟视图:' +
      '同名的时候优先看到 upper,所有写入也进入 upper;可以有多个 lower,但通常只有一个 upper。' +
      'workdir 是内部临时空间,帮助实现原子性这些细节。最容易出错的是删除:如果你在 merged 里删了来自 lower 的名字,' +
      '不是去改 lower,而是在 upper 里留下 whiteout,让合成视图里看不见它。Docker 的 layer 也大量用这种层叠思路。',
    note: '命中 c4 → 触发 M3:小白以为上下层真的合并、删除会改 lower',
  },
  {
    label: '⑥ 纠正 M3 + 讲 FUSE',
    text:
      '不对,OverlayFS 不是把上下两层真的合并成一份,也不会改掉下面那层原文件。merged 只是虚拟视图;' +
      '写入落在 upper,同名时 upper 遮住 lower,删除 lower 里的名字时,upper 记录一个 whiteout 来遮住它。' +
      '最后再往前走一步:既然文件系统是一组操作,我们甚至可以用 FUSE 自己实现规则。内核收到 lookup、read、write 这些请求后,' +
      '把它们转发给用户态的 FUSE driver;你实现 struct fuse_operations 里的回调,比如 read、write、readdir、setxattr,' +
      '就能把远程目录、数据库、JSON 甚至游戏素材包装成普通命令能使用的文件系统。分寸是性能、权限和一致性不会自动免费解决。',
    note: '纠正 M3(不是合并/whiteout/upper 记录)+ 命中 c5 → 同轮衔接注入 M2',
  },
  {
    label: '⑦ 纠正 M2(收尾)',
    text:
      '这个说法也要纠正:真正的文件系统不是必须绑死在磁盘块上。磁盘块是常见材料,但本讲强调的是接口和数据结构。' +
      'FUSE 之所以重要,就是内核把文件操作转发给用户态程序,让任意数据结构只要实现相应回调,就能被普通命令使用。' +
      '所以数据库、远程仓库、JSON 都可以长成文件夹的样子;当然这只是打开设计空间,权限、缓存、性能和一致性仍然要认真做。',
    note: '纠正 M2(不是磁盘块/FUSE 转发/任意数据结构/普通命令使用)→ 三误区全纠正、五要点全命中',
  },
  {
    label: '卡壳演示(触发 R1 救援)',
    text: '嗯……这块我卡住了,后面想不起来该怎么讲了……',
    note: '卡壳信号 → 小白递台阶(R1);连续两次 → 一起查书(R2);再压测进入 R3/R4',
  },
  {
    label: '偏题演示(内容围栏)',
    text: '小白,这节先不聊目录了,我们去看看今天食堂有没有新出的甜品,顺便排个队。',
    note: '偏题 → 小白角色内拉回今天知识点,不产生命中或误区事件',
  },
];

export const osFsApi2SelfTest: SelfTestItem[] = [
  {
    id: 'st1',
    dimension: '概念',
    question: '“文件系统 API (2)”这一讲最核心的视角转换是什么?',
    options: [
      '把目录树只当成一组小命令的集合',
      '把目录树当成可设计的数据结构,继续发明更大的操作',
      '把所有文件都改成只读',
      '把文件名统一改成课程编号',
    ],
    answerIndex: 1,
    explanation: '主线是从 CRUD 小步操作跳到数据结构/API 设计空间。',
    checklistRef: 'c1',
    mcRef: null,
  },
  {
    id: 'st2',
    dimension: '辨析',
    question: '一个编辑器想在源码变化后自动刷新,下面哪种实现最像本讲推荐的方向?',
    options: [
      '每秒全盘扫描所有目录',
      '使用系统事件后端监听目标目录,必要时再做校准',
      '要求用户手动重启编辑器',
      '把源码文件藏进音乐播放器',
    ],
    answerIndex: 1,
    explanation: '事件监听减少轮询成本,但健壮实现仍要能处理异常后校准。',
    checklistRef: 'c2',
    mcRef: 'os_fs_api_2_M1',
  },
  {
    id: 'st3',
    dimension: '推演',
    code: 'refs/heads/exp -> C2\nHEAD -> refs/heads/exp\nC2(parent=C1, tree=T2)',
    question: '此时切换到 exp 分支,最像发生了什么?',
    options: [
      '复制出整套仓库文件作为新历史',
      'HEAD 这张纸条指向 exp 这张纸条,再顺着找到 commit',
      '删除 main 分支所有对象',
      '把 tree 对象改名为 HEAD',
    ],
    answerIndex: 1,
    explanation: 'Git 历史靠对象和引用组织,分支切换主要是指针关系变化与工作区更新。',
    checklistRef: 'c3',
    mcRef: null,
  },
  {
    id: 'st4',
    dimension: '边界',
    question: '在 merged 视图里删除一个只存在于 lower 的文件后,再看 lower 本身,典型情况下会怎样?',
    options: [
      'lower 原文件还在,只是 merged 里被 whiteout 遮住',
      'lower 原文件已经被直接擦掉',
      'lower 会自动变成 workdir',
      'lower 会随机复制十份',
    ],
    answerIndex: 0,
    explanation: 'whiteout 记录在 upper,作用是遮住合成视图中的 lower 名字。',
    checklistRef: 'c4',
    mcRef: 'os_fs_api_2_M3',
  },
  {
    id: 'st5',
    dimension: '应用',
    question: '想把一个远程目录挂成本地文件夹,让 ls、cat 这些命令直接用,最贴近哪类机制?',
    options: [
      'FUSE 这类用户态文件系统机制',
      '只改 shell 提示符颜色',
      '把网线剪短一点',
      '让用户背下所有文件名',
    ],
    answerIndex: 0,
    explanation: 'FUSE 可以把远程、数据库等后端包装成普通文件系统接口。',
    checklistRef: 'c5',
    mcRef: 'os_fs_api_2_M2',
  },
  {
    id: 'st6',
    dimension: '边界',
    question: '把数据库包装成文件夹后,下面哪句最稳妥?',
    options: [
      '普通命令能访问,但权限、缓存和一致性仍要设计',
      '一挂上就天然最高性能',
      '从此数据库不需要备份',
      '所有 SQL 都会自动变押韵',
    ],
    answerIndex: 0,
    explanation: '接口自由不等于工程问题消失,这一点要特别留分寸。',
    checklistRef: 'c5',
    mcRef: 'os_fs_api_2_M2',
  },
  {
    id: 'st7',
    dimension: '推演',
    question: 'Dockerfile 里连续多次 RUN,从文件系统层看更像什么?',
    options: [
      '每次 RUN 都把整个电脑烧成光盘',
      '每步产生一层,下一步把上一层放进层栈继续作为基础视图',
      '每次 RUN 都清空 lower',
      '每步都只改文件图标',
    ],
    answerIndex: 1,
    explanation: '讲义把 Docker 多层构建解释为 upper 变成下一步 lower stack 顶部的过程。',
    checklistRef: 'c4',
    mcRef: null,
  },
];
