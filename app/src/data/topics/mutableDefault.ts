/**
 * 知识点:可变默认参数(《Python 程序设计》)—— 第二演示知识点。
 * 关键词组与 demoScript.ts 中的预埋话术互相咬合,改动任一侧必须同步校验(scripts/simulate.ts)。
 *
 * 演示编排(与 shallowCopy 同构):
 *   ① c1 → ② c2+金句 → 注入 M1(主打误区,injectAfter c2)
 *   ③b 纠正 M1 + 顺势命中 c3 → ④ 串讲无新命中(Lv5 在此轮提前迁移)
 *   ⑤ c4 → 注入 M3 → ⑥ 纠正 M3 + c5 → 同轮衔接注入 M2 → ⑦ 纠正 M2 收尾
 */
import type { Topic } from '../../types';

export const mutableDefaultTopic: Topic = {
  topicId: 'mutable-default',
  title: '可变默认参数',
  course: 'Python 程序设计',
  tagline: 'def f(x, lst=[]) 埋着 Python 最著名的地雷',
  transferHint: '默认参数是字典的情形',
  checklist: [
    {
      id: 'c1',
      point: '默认值只求值一次',
      groundTruth: 'def 是会被执行的语句,执行到它时默认参数表达式只求值一次,结果绑定在函数对象上,所有调用共享。',
      keywords: [
        ['定义', '一次'],
        ['求值', '一次'],
        ['定义', '求值'],
        ['def', '一次'],
        ['只算一次'],
        ['只求值一次'],
        ['只创建一次'],
        ['默认', '共享'],
      ],
      terms: ['默认参数', '函数对象'],
      level: 'L1',
      lookupCard:
        '**默认值何时求值?**\n\n`def` 是一条会被执行的语句:执行到它的那一刻,默认参数表达式求值**一次**,' +
        '结果作为函数对象的一部分保存下来。之后每次调用,用的都是这份现成的值。\n\n' +
        '```python\ndef f(x, lst=[]):\n    ...\nprint(f.__defaults__)  # ([],) ← 就存在函数对象上\n```',
      probeLine: '那个等号后面的东西,是每次叫它干活的时候都新做一份,还是一开始就做好一份呀?',
    },
    {
      id: 'c2',
      point: '不传参时共用同一个默认列表',
      groundTruth: '省略该参数的所有调用共用同一个默认列表,往里添加的内容会跨调用累积,第二次调用能看到第一次留下的东西。',
      keywords: [
        ['同一个', '列表'],
        ['共用'],
        ['共享', '列表'],
        ['越积越多'],
        ['越攒越多'],
        ['累积'],
        ['第一次', '第二次'],
      ],
      terms: ['可变对象', 'append'],
      level: 'L2',
      lookupCard:
        '**为什么会越积越多?**\n\n省略参数的每次调用,拿到的都是函数对象上那**同一个**列表——它不会被重置。\n\n' +
        '```python\ndef add(x, lst=[]):\n    lst.append(x)\n    return lst\nadd(1)  # [1]\nadd(2)  # [1, 2] ← 上次的还在\n```',
      probeLine: '那我这回用完它,下回再叫这个函数的时候,它里面是干干净净的,还是上回放的东西还在呀?',
    },
    {
      id: 'c3',
      point: '显式传参不受影响',
      groundTruth: '默认值只在调用时省略该参数才被使用;显式传入实参时,函数用的是传入的对象,默认列表完全不参与。',
      keywords: [
        ['省略', '才'],
        ['传', '不参与'],
        ['显式', '传'],
        ['不传', '才用'],
        ['传入', '用不到'],
        ['自己传', '你传的'],
      ],
      terms: ['实参', '显式传参'],
      level: 'L3',
      lookupCard:
        '**传了参数就没事**\n\n默认值只在**省略**该参数时才登场。显式传入实参时,函数用的就是你传的对象,' +
        '默认列表全程不参与。\n\n```python\nadd(9, [])  # [9] ← 用的是你传的新列表\nadd(3)      # 又回到那个共享的默认列表\n```',
      probeLine: '要是我叫它干活的时候,自己带了一个盒子给它呢?它还会去动那个原本备着的吗?',
    },
    {
      id: 'c4',
      point: 'None 哨兵惯用法',
      groundTruth: '惯用写法是把默认值设为 None,在函数体内判断 if lst is None: lst = [],让每次省略参数的调用各自新建列表。',
      keywords: [
        ['None', '判断'],
        ['None', '新建'],
        ['is None'],
        ['哨兵'],
      ],
      terms: ['None', '哨兵'],
      level: 'L3',
      lookupCard:
        '**None 哨兵惯用法**\n\n把默认值写成 `None`,进函数先判断:\n\n' +
        '```python\ndef add(x, lst=None):\n    if lst is None:\n        lst = []  # 每次调用现做一个\n    lst.append(x)\n    return lst\n```\n\n' +
        '`None` 本身不可变,当哨兵绝不会被改坏。',
      probeLine: '那有没有什么办法,能让我每回都拿到一份干干净净的新的呀?',
    },
    {
      id: 'c5',
      point: '不可变默认值天生安全',
      groundTruth: '数字、字符串、None、元组等不可变对象做默认值是安全的,它们无法被原地修改;只有列表、字典、集合等可变默认值才需要哨兵写法。',
      keywords: [
        ['不可变', '默认'],
        ['改不动'],
        ['数字', '字符串', '不用'],
        ['可变', '才', '哨兵'],
        ['不可变', '安全'],
      ],
      terms: ['不可变', '元组'],
      level: 'L5',
      lookupCard:
        '**哪些默认值是安全的?**\n\n数字、字符串、`None`、元组这些**不可变**对象,谁也无法原地改动它们,' +
        '做默认值天生安全。\n\n需要设防的只有可变容器:列表、字典、集合——它们才用哨兵写法。',
      probeLine: '那是不是所有写在等号后面的东西,都得这么小心提防着呀?',
    },
  ],
  misconceptions: [
    {
      mcId: 'mutable_default_M1',
      topicId: 'mutable-default',
      belief: '每次调用不传列表,Python 都会重新给一个新的空列表',
      triggerLine:
        '咦?不对吧老师,括号里明明写着 lst=[] 呀,那我每次调用不传它,' +
        'Python 不就每次都重新给我一个新的空列表吗?怎么会越积越多呢?',
      correctionCriteria: ['指出默认列表只在 def 执行时创建一次,省略参数的调用共享同一个对象', '或用连续调用打印结果 / id() 实验反驳'],
      correctionKeywords: [
        ['只求值一次'], ['只算一次'], ['只做一次'], ['只创建一次'], ['定义', '一次'],
        ['同一个'], ['共用'], ['共享'], ['越积越多'], ['id('],
      ],
      adoptionKeywords: [
        ['每次都是新'], ['都会重新'], ['新的', '放心'], ['你说得对'], ['没错'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: 'def f(x, lst=[]) 中,每次不传 lst 调用,Python 都会新建一个空列表。',
        isTrue: false,
        explanation: '默认值只在 def 执行时求值一次,存在函数对象上;省略参数的调用共享同一个列表。',
      },
      remedy: {
        microLesson: {
          title: '默认值的一生:只在 def 那一刻出生',
          body:
            '把函数想象成一个**随身带储物格的员工**:`def` 执行的那一刻,储物格(默认列表)就装配好了,' +
            '而且只装配这一次。\n\n之后每次你喊他干活却不给他容器(省略参数),他掏出来的都是**同一个储物格**——' +
            '上一单剩下的东西还躺在里面。\n\n' +
            '```python\ndef add(x, lst=[]):\n    lst.append(x)\n    return lst\nadd(1)   # [1]\nadd(2)   # [1, 2] ← 不是 [2]!\nprint(add.__defaults__)  # ([1, 2],) 证据就在函数对象上\n```\n\n' +
            '想验证"同一个",还可以打印 `id()`:两次省略参数的调用,id 一模一样。',
          askBack: '下次小白再问「每次调用不是都会给我一个新的空列表吗」,你打算用哪个实验让它心服口服?',
        },
        predictionQuiz: [
          {
            id: 'r1-1',
            code: 'def add(x, lst=[]):\n    lst.append(x)\n    return lst\nprint(add(1))\nprint(add(2))',
            question: '第二行输出什么?',
            options: ['[2]', '[1, 2]', '[1]', '报错'],
            answerIndex: 1,
            explanation: '两次省略参数的调用共用同一个默认列表,第一次放进去的 1 还在里面。',
            checklistRef: 'c2',
            mcRef: 'mutable_default_M1',
          },
          {
            id: 'r1-2',
            code: 'def f(lst=[]):\n    return id(lst)\nprint(f() == f())',
            question: '输出是什么?',
            options: ['True', 'False', '有时 True 有时 False', '报错'],
            answerIndex: 0,
            explanation: '默认列表只在 def 执行时创建一次,两次调用拿到同一个对象,id 必然相同。',
            checklistRef: 'c1',
            mcRef: 'mutable_default_M1',
          },
          {
            id: 'r1-3',
            code: 'def add(x, lst=[]):\n    lst.append(x)\n    return lst\nprint(add(1, [10]))\nprint(add(2))',
            question: '两行分别输出什么?',
            options: ['[10, 1] 和 [2]', '[10, 1] 和 [10, 1, 2]', '[10, 1] 和 [1, 2]', '报错'],
            answerIndex: 0,
            explanation: '第一次显式传了列表,默认列表没被动过;第二次省略参数,才第一次用到默认列表。',
            checklistRef: 'c3',
            mcRef: 'mutable_default_M1',
          },
        ],
      },
    },
    {
      mcId: 'mutable_default_M2',
      topicId: 'mutable-default',
      belief: '既然只求值一次,整个程序里那个默认列表就永远只有一份',
      triggerLine:
        '老师那我举一反三一下:既然它只求值一次,那是不是整个程序跑完,那个默认列表就永远只有一份?' +
        '哪怕我把 def 写在别的函数肚子里,每次也还是同一份?',
      correctionCriteria: ['指出 def 是会被执行的语句,每执行一次 def 就重新求值一次默认值', '嵌套定义/循环定义时,每次执行 def 都新建函数对象和默认列表'],
      correctionKeywords: [
        ['def', '语句'], ['def', '执行'], ['重新求值'], ['再求值'], ['每执行'], ['def', '再跑'], ['新的函数对象'],
      ],
      adoptionKeywords: [
        ['永远只有一份'], ['就一份'], ['整个程序', '一个'], ['你说得对'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: '默认值只求值一次,所以整个程序运行期间,同一段 def 代码的默认列表永远只有一份。',
        isTrue: false,
        explanation: 'def 是会被执行的语句:写在函数体或循环里,每执行一次 def 就新建一个函数对象,默认值随之重新求值。',
      },
      remedy: {
        microLesson: {
          title: 'def 是句会被执行的话',
          body:
            '「只求值一次」的准确读法是:**每执行一次 def,求值一次**——而不是"整个程序只有一次"。\n\n' +
            '`def` 是普通语句,写在哪儿就在哪儿被执行:写在函数体里,外层函数每调用一遍,这条 `def` 就重新跑一遍,' +
            '造出一个**全新的函数对象**,默认列表也随之新做一份。\n\n' +
            '```python\ndef make():\n    def inner(x, lst=[]):\n        lst.append(x)\n        return lst\n    return inner\na = make()\nb = make()\na(1); a(2)\nprint(a.__defaults__)  # ([1, 2],)\nprint(b.__defaults__)  # ([],) ← b 是另一个函数对象\n```\n\n' +
            '一个函数对象一份默认值:同一个对象内共享累积,不同对象之间互不相干。',
          askBack: '下次小白再说「反正只求值一次,整个程序就一份」,你怎么用嵌套定义的例子拆穿它?',
        },
        predictionQuiz: [
          {
            id: 'r2-1',
            code: 'def make():\n    def inner(x, lst=[]):\n        lst.append(x)\n        return lst\n    return inner\na = make()\nb = make()\nprint(a(1), b(1))',
            question: '输出是什么?',
            options: ['[1] [1]', '[1] [1, 1]', '[1, 1] [1, 1]', '报错'],
            answerIndex: 0,
            explanation: 'make 每执行一次,内部的 def 就重新执行一次:a、b 是两个函数对象,各带各的默认列表。',
            checklistRef: 'c1',
            mcRef: 'mutable_default_M2',
          },
          {
            id: 'r2-2',
            code: 'def make():\n    def inner(x, lst=[]):\n        lst.append(x)\n        return lst\n    return inner\nc = make()\nprint(c(1))\nprint(c(2))',
            question: '两行分别输出什么?',
            options: ['[1] 和 [2]', '[1] 和 [1, 2]', '[2] 和 [2]', '报错'],
            answerIndex: 1,
            explanation: '同一个函数对象内部,默认列表仍是共享累积的——"一份"是指每个函数对象一份,不是整个程序一份。',
            checklistRef: 'c2',
            mcRef: 'mutable_default_M2',
          },
          {
            id: 'r2-3',
            question: '关于默认值的求值时机,哪个说法是对的?',
            options: [
              '整个程序运行期间只求值一次',
              '每次执行到 def 语句时求值一次',
              '每次调用函数时都重新求值',
              '只在第一次调用函数时求值',
            ],
            answerIndex: 1,
            explanation: 'def 是会被执行的语句;每执行一次 def,默认值表达式就求值一次,绑定到新的函数对象上。',
            checklistRef: 'c1',
            mcRef: 'mutable_default_M2',
          },
        ],
      },
    },
    {
      mcId: 'mutable_default_M3',
      topicId: 'mutable-default',
      belief: '为了保险,数字、字符串这些默认值也都得改成 None 哨兵写法',
      triggerLine:
        '啊?那老师,我以后是不是啥默认值都不敢直接写了——像 n=0、name=\'小白\' 这种,' +
        '也得统统改成先写 None 再判断的样子,才保险呀?',
      correctionCriteria: ['指出不可变默认值无法被原地修改,不存在跨调用累积,无需哨兵', '说明只有列表、字典、集合等可变默认值才需要'],
      correctionKeywords: [
        ['不可变'], ['改不动'], ['改不了'], ['不需要'], ['没这个坑'], ['没必要'], ['多余'],
      ],
      adoptionKeywords: [
        ['保险'], ['都改成'], ['稳妥'], ['也行'], ['统统改'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: '为了保险,数字和字符串做默认值时也应该改成 None 哨兵写法。',
        isTrue: false,
        explanation: '数字、字符串是不可变对象,无法被原地改动,不存在跨调用累积的问题;只有列表、字典、集合这类可变默认值才需要哨兵。',
      },
      remedy: {
        microLesson: {
          title: '不可变默认值,天生免疫',
          body:
            '哨兵防的是什么?防**默认对象被原地改动、把状态带到下一次调用**。\n\n' +
            '数字、字符串、元组是不可变的:你以为的"修改"(如 `n += 1`、`s + "x"`)其实都是让局部名字改指一个新对象,' +
            '函数对象上存的默认值分毫未动。风险不存在,设防就是白费。\n\n' +
            '```python\ndef count(n=0):\n    n += 1     # 局部名字 n 改指新对象\n    return n\ncount()  # 1\ncount()  # 1  永远从 0 起步\n```\n\n' +
            '一条线划清:默认值是**列表、字典、集合**这类可变容器 → 哨兵;数字、字符串、`None`、元组 → 直接写。',
          askBack: '下次小白再问「数字默认值要不要也改成哨兵」,你怎么一句话给它划清这条线?',
        },
        predictionQuiz: [
          {
            id: 'r3-1',
            code: 'def count(n=0):\n    n += 1\n    return n\nprint(count())\nprint(count())',
            question: '两行分别输出什么?',
            options: ['1 和 1', '1 和 2', '2 和 2', '报错'],
            answerIndex: 0,
            explanation: '整数不可变,n += 1 只是让局部名字指向新对象,函数对象上的默认值 0 从未被改动。',
            checklistRef: 'c5',
            mcRef: 'mutable_default_M3',
          },
          {
            id: 'r3-2',
            code: "def tag(s='#'):\n    s = s + 'x'\n    return s\nprint(tag())\nprint(tag())",
            question: '两行分别输出什么?',
            options: ['#x 和 #x', '#x 和 #xx', '# 和 #x', '报错'],
            answerIndex: 0,
            explanation: '字符串不可变,拼接产生的是新对象,默认值永远是那个原样的 "#"。',
            checklistRef: 'c5',
            mcRef: 'mutable_default_M3',
          },
          {
            id: 'r3-3',
            question: '下面哪个默认参数必须改成 None 哨兵写法?',
            options: ["n=1", "name='小白'", 'point=(0, 0)', 'history=[]'],
            answerIndex: 3,
            explanation: '只有可变容器做默认值才有跨调用累积的风险;数字、字符串、元组都不可变,直接写即可。',
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
      question: '默认参数表达式在什么时候被求值?',
      options: [
        '每次调用函数时',
        '执行到 def 语句时,且每执行一次 def 求值一次',
        '程序启动时,全程只求值一次',
        '第一次调用函数时',
      ],
      answerIndex: 1,
      explanation: 'def 是会被执行的语句,执行到它时默认值求值一次,绑定在新建的函数对象上。',
      checklistRef: 'c1',
      mcRef: 'mutable_default_M2',
    },
    {
      id: 'q2',
      code: 'def add(x, lst=[]):\n    lst.append(x)\n    return lst\nprint(add(1))\nprint(add(2))',
      question: '两行分别输出什么?',
      options: ['[1] 和 [2]', '[1] 和 [1, 2]', '[1, 2] 和 [1, 2]', '报错'],
      answerIndex: 1,
      explanation: '省略参数的调用共用同一个默认列表,内容跨调用累积。',
      checklistRef: 'c2',
      mcRef: 'mutable_default_M1',
    },
    {
      id: 'q3',
      code: 'def add(x, lst=[]):\n    lst.append(x)\n    return lst\nprint(add(1, [10]))\nprint(add(2))',
      question: '两行分别输出什么?',
      options: ['[10, 1] 和 [2]', '[10, 1] 和 [10, 1, 2]', '[10, 1] 和 [1, 2]', '报错'],
      answerIndex: 0,
      explanation: '显式传参时默认列表不参与;只有第二次省略参数的调用才用到它。',
      checklistRef: 'c3',
      mcRef: 'mutable_default_M1',
    },
    {
      id: 'q4',
      code: 'def add(x, lst=None):\n    if lst is None:\n        lst = []\n    lst.append(x)\n    return lst\nprint(add(1))\nprint(add(2))',
      question: '两行分别输出什么?',
      options: ['[1] 和 [1, 2]', '[1] 和 [2]', '[1, 2] 和 [1, 2]', '报错'],
      answerIndex: 1,
      explanation: 'None 哨兵让每次省略参数的调用都当场新建列表,互不相干。',
      checklistRef: 'c4',
      mcRef: null,
    },
    {
      id: 'q5',
      question: '下面哪个默认参数可以放心直接写,不需要哨兵?',
      options: ['lst=[]', 'd={}', 'n=0', 's=set()'],
      answerIndex: 2,
      explanation: '数字不可变,改不动,天生没有跨调用累积的坑;列表、字典、集合都是可变容器。',
      checklistRef: 'c5',
      mcRef: 'mutable_default_M3',
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟拆雷:def f(x, lst=[]) 埋了什么',
      body:
        '`def` 不是"声明",而是一条**会被执行的语句**。抓住这一点,`def f(x, lst=[])` 这颗雷就好拆了:\n\n' +
        '1. **默认值在 def 执行时求值,只求值一次**。算出来的结果(比如那个空列表)存在函数对象上,所有调用共享。\n' +
        '2. **可变默认值会跨调用累积**。省略参数的调用共用同一个列表:第一次 append 进去的东西,第二次调用还在——' +
        '像一只越用越脏的公用咖啡杯。\n' +
        '3. **显式传参不踩坑**。默认值只在你省略参数时才登场;传了实参,它全程不参与。\n' +
        '4. **惯用解法是 None 哨兵**:默认值写 `None`,函数体里 `if lst is None: lst = []`,每次现做一个新列表。\n' +
        '5. **不可变默认值天生安全**。数字、字符串、元组改不动,直接写;要设防的只有列表、字典、集合这些可变容器。\n\n' +
        '判断口诀:**默认值可变要设防,不可变的随便放**。' +
        '小白最容易问倒你的地方:「写着 lst=[],为什么第二次调用它不是空的?」\n\n' +
        '**讲课节奏建议**\n\n' +
        '- **先讲①②,把"def 是会被执行的语句"钉死**:①默认值在 def 执行那一刻求值、只求值一次,' +
        '存在函数对象上(`f.__defaults__` 就是铁证);②顺势推出"省略参数的调用共用同一个列表,越攒越多",' +
        '配上"越用越脏的公用咖啡杯"这类画面,小白最容易记住。\n' +
        '- **②讲完,警报拉响**:小白几乎必然瞪着括号里的 `lst=[]` 反问——「明明写着空列表,' +
        '每次调用不就该新给一个吗?」别被字面带跑。先明确否定"每次都新建",再上实验:连续 add(1)、add(2),' +
        '第二次输出 [1, 2] 不是 [2];还嫌不服,打印两次调用的 id() 一模一样。纠正站稳了,' +
        '顺势把③"显式传参不受影响、坑只咬不传参数的人"讲掉。\n' +
        '- **中场串一遍**再进④:def 时装配一次储物格 → 不带容器来的都用它 → 自带容器的相安无事,' +
        '小白复述对了,再教④None 哨兵这个正解。\n' +
        '- **讲完④,它还会来两次**:先是「那 n=0、name=\'小白\' 是不是也得改成哨兵才保险?」' +
        '用"不可变的改不动,防不存在的风险就是浪费"顶回去,带出⑤;末尾它可能还举一反三过头——' +
        '「只求值一次,那整个程序就永远只有一份吧?」用嵌套 def 的例子拆穿:每执行一次 def,' +
        '就新建一个函数对象、新求值一份默认值。\n\n' +
        '**一句话收束**\n\n' +
        '**默认值在 def 执行那一刻只做一份,可变容器会把上次的状态带进下次调用——可变要设 None 哨兵,不可变随便放。**',
    },
    examples: [
      {
        title: '例 1:越攒越多的"记事本"',
        code: 'def add(x, lst=[]):\n    lst.append(x)\n    return lst\nprint(add(1))      # [1]\nprint(add(2))      # [1, 2] ← 不是 [2]!\nprint(add(9, []))  # [9] 自己传了列表就没事',
        walkthrough:
          '前两次调用都省略了 lst,拿到的是函数对象上同一个默认列表,内容越积越多;' +
          '第三次显式传入新列表,默认列表全程没被碰——坑只咬"不传参数"的人。',
      },
      {
        title: '例 2:None 哨兵修复',
        code: 'def add(x, lst=None):\n    if lst is None:\n        lst = []   # 每次调用现做一个\n    lst.append(x)\n    return lst\nprint(add(1))  # [1]\nprint(add(2))  # [2] 各自独立',
        walkthrough:
          '默认值换成不可变的 None,真正的空列表挪到函数体里现做——' +
          'def 时存下的只是 None,列表在每次调用时才诞生,自然互不相干。',
      },
      {
        title: '例 3:换成字典,坑还是同一个',
        code:
          'def lookup(x, cache={}):\n' +
          '    if x not in cache:\n' +
          '        cache[x] = x * x\n' +
          '    return cache\n' +
          'print(lookup(2))  # {2: 4}\n' +
          'print(lookup(3))  # {2: 4, 3: 9} ← 上次的还在',
        walkthrough:
          '把 [] 换成 {},规则一个字没变:默认字典也只在 def 执行时创建一次,' +
          '省略参数的调用共用它,键值对跨调用越攒越多。列表、字典、集合——所有可变容器做默认值,' +
          '踩的都是同一颗雷;修法也一样,换成 None 哨兵、进函数再现做一个。',
      },
    ],
    selfCheck: [
      '能说出默认值是在什么时候、被求值几次吗?',
      '能自己写一段代码,演示连续两次调用后默认列表越积越多吗?(不许抄讲义里的)',
      '能说出哪类默认值需要哨兵写法、哪类直接写就行吗?',
      '小白要是坚持「每次调用不传,Python 都会重新给一个新的空列表」,你打算用哪个实验让它当场哑口?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「写着 lst=[],每次调用不传参数,拿到的都是新列表吧?」' +
      '带着这个问题去读下面的材料,想好你打算怎么给它讲明白。纠不动它,它会开心地把错的学走。',
    references: [
      {
        title: 'Python 官方编程 FAQ:为什么对象之间共享默认值?',
        url: 'https://docs.python.org/zh-cn/3/faq/programming.html#why-are-default-values-shared-between-objects',
        kind: '官方文档',
        note:
          '官方亲自回答本课核心问题的小节:一句「默认值在函数定义时仅计算一次」就是标准答案,' +
          '后半段给出的 None 哨兵写法正是推荐修法,纠错时可直接引用。',
      },
      {
        title: 'Python 官方教程 4.9.1 参数默认值(中文版)',
        url: 'https://docs.python.org/zh-cn/3/tutorial/controlflow.html#default-argument-values',
        kind: '官方文档',
        note:
          '官方教程里那个著名的「重要警告」框:默认值只求值一次、可变对象会跨调用累积,' +
          '连示例代码都和讲义的 add(x, lst=[]) 几乎同款,备课时对照读一遍即可校准话术。',
      },
      {
        title: 'wtfpython 中文翻译(GitHub: leisurelicht/wtfpython-cn)',
        url: 'https://github.com/leisurelicht/wtfpython-cn',
        kind: '长文',
        note:
          '著名 Python 怪癖合集的中文版,在目录里搜「谨防默认的可变参数」小节:' +
          '把 __defaults__ 前后变化打印出来的写法,是让小白当场哑口的最短实验脚本。',
      },
      {
        title: '常见陷阱 — The Hitchhiker’s Guide to Python 中文版',
        url: 'https://pythonguidecn.readthedocs.io/zh/latest/writing/gotchas.html',
        kind: '教程',
        note:
          '只看第一节「可变默认参数」:它用「你可能期望什么 / 实际发生了什么 / 你该怎么做」三段式呈现,' +
          '这个结构可以直接搬来当你纠错讲课的骨架。',
      },
      {
        title: '我精心设计的默认参数,怎么就出问题了呢?(码农高天)',
        url: 'https://www.bilibili.com/video/BV1NP4y1g7CT/',
        kind: '视频',
        note:
          '约 6 分钟,UP 主是 CPython 核心开发者:现场演示「默认值在 def 时只算一次」' +
          '如何导致跨调用累积,并给出 None 哨兵修法——纠错话术可以整段照搬。',
      },
      {
        title: '为什么不应该将列表作为函数的默认参数?(Hucci写代码)',
        url: 'https://www.bilibili.com/video/BV1st42177YR/',
        kind: '视频',
        note:
          '约 2 分半的极短复现:现象、原因、替代方案一气呵成,' +
          '适合课前三分钟把「坑长什么样」先过一遍,再用官方 FAQ 补原理。',
      },
      {
        title: '为什么列表不能当默认值?Python 函数参数的那些事儿(水哥澎湃)',
        url: 'https://www.bilibili.com/video/BV1qrubznEad/',
        kind: '视频',
        note:
          '约 12 分钟的函数参数全流程课:直接跳到 04:01 的「避坑」章节看列表/字典当默认值的陷阱,' +
          '前后段落顺带补齐多参数与关键字实参的用法。',
      },
    ],
  },
};
