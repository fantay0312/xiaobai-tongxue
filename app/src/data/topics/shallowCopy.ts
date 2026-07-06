/**
 * 知识点:浅拷贝与深拷贝(《Python 程序设计》)—— 演示主线知识点。
 * 关键词组与 demoScript.ts 中的预埋话术互相咬合,改动任一侧必须同步校验(scripts/simulate.ts)。
 */
import type { Topic } from '../../types';

export const shallowCopyTopic: Topic = {
  topicId: 'shallow-copy',
  title: '浅拷贝与深拷贝',
  course: 'Python 程序设计',
  tagline: 'copy() 复印的是目录,还是整个文件夹?',
  transferHint: '字典的拷贝',
  checklist: [
    {
      id: 'c1',
      point: '赋值与拷贝的区别',
      groundTruth: '赋值(b = a)只是给同一个对象绑定一个新名字,不产生新对象;拷贝才会创建新对象。',
      keywords: [
        ['赋值', '名字'],
        ['赋值', '同一个'],
        ['等号', '同一个'],
        ['赋值', '引用'],
        ['指向', '同一个'],
        ['没有新对象'],
        ['不产生新'],
        ['别名'],
      ],
      terms: ['赋值', '引用'],
      level: 'L1',
      lookupCard:
        '**赋值 vs 拷贝**\n\n`b = a` 不复制任何东西——它只是给 `a` 指向的那个对象又起了一个名字。' +
        '两个名字、同一个对象,改谁都等于改它。\n\n拷贝(如 `a.copy()`)才会创建一个新对象。',
      probeLine: '比如我写个等号,把它交给另一个名字,这样算复制出新的一份吗?',
    },
    {
      id: 'c2',
      point: '浅拷贝的层级范围',
      groundTruth: '浅拷贝只复制最外层容器,内层元素仍是对原对象的引用。',
      keywords: [
        ['浅拷贝', '外层'],
        ['copy', '新建'],
        ['copy', '新列表'],
        ['拷贝', '目录'],
        ['浅拷贝', '第一层'],
        ['切片', '浅'],
        ['[:]'],
        ['复制', '最外层'],
      ],
      terms: ['浅拷贝', 'copy()'],
      level: 'L2',
      lookupCard:
        '**浅拷贝复制到哪一层?**\n\n`list.copy()`、切片 `[:]`、`copy.copy()` 都是浅拷贝:' +
        '新建最外层容器,把内层元素的**引用**装进去。\n\n就像复印了文件夹的目录页——里面的文件还是原来那几份。',
      probeLine: '那用你说的办法复制完,里面装着的东西也各自变成新的一份了吗?',
    },
    {
      id: 'c3',
      point: '嵌套对象的引用共享',
      groundTruth: '浅拷贝后,嵌套的可变对象被新旧容器共享,通过任一容器修改都会互相可见。',
      keywords: [
        ['嵌套', '共享'],
        ['套着', '同一个'],
        ['子列表', '同一个'],
        ['里面', '跟着变'],
        ['里面', '同一个'],
        ['里层', '共享'],
        ['内层', '引用'],
        ['改一边', '另一边'],
      ],
      terms: ['嵌套', '子列表'],
      level: 'L3',
      lookupCard:
        '**嵌套对象怎么办?**\n\n浅拷贝后,`a[0]` 和 `b[0]` 如果是个列表,它俩是**同一个**列表。\n\n' +
        '```python\na = [[1, 2], 3]\nb = a.copy()\nb[0].append(9)\nprint(a)  # [[1, 2, 9], 3] ← 跟着变了\n```',
      probeLine: '如果盒子里还套着一个小盒子呢?复制完之后,那个小盒子是新的吗?',
    },
    {
      id: 'c4',
      point: '深拷贝的行为',
      groundTruth: 'copy.deepcopy() 递归复制所有层级,得到完全独立的对象树。',
      keywords: [
        ['深拷贝', '递归'],
        ['deepcopy'],
        ['深拷贝', '每一层'],
        ['深拷贝', '每层'],
        ['深拷贝', '全部'],
        ['深拷贝', '独立'],
        ['递归', '复制'],
      ],
      terms: ['深拷贝', 'deepcopy', '递归'],
      level: 'L3',
      lookupCard:
        '**深拷贝**\n\n`copy.deepcopy(a)` 会**递归**地把每一层都复制一遍,' +
        '得到一棵完全独立的对象树,两边从此互不影响。',
      probeLine: '那有没有什么办法,能连里面的小盒子也一起复制掉呀?',
    },
    {
      id: 'c5',
      point: '何时需要深拷贝',
      groundTruth: '仅当对象内嵌套可变对象、且需要独立修改两份时才需要深拷贝;不可变对象无需拷贝。',
      keywords: [
        ['可变', '独立'],
        ['不可变', '不需要'],
        ['嵌套', '深拷贝', '需要'],
        ['改不动', '不用'],
        ['不可变', '没有意义'],
        ['字符串', '数字', '不用'],
      ],
      terms: ['可变对象', '不可变'],
      level: 'L5',
      lookupCard:
        '**什么时候才需要深拷贝?**\n\n两个条件同时成立:① 容器里嵌套着**可变**对象;' +
        '② 你需要**独立**修改两份。\n\n数字、字符串、元组这些不可变对象,根本不需要拷贝——反正谁也改不动它。',
      probeLine: '那我是不是每次都用那个连里面一起复制的办法,最保险?',
    },
  ],
  misconceptions: [
    {
      mcId: 'shallow_copy_M1',
      topicId: 'shallow-copy',
      belief: 'copy() 会把所有嵌套的东西都复制一份',
      triggerLine: '咦?可是老师,那我 list.copy() 之后,改里面的子列表,原来的列表应该不会变吧?都复制过了嘛。',
      correctionCriteria: ['指出嵌套对象仍是引用共享', '或用内存模型/代码实验反驳'],
      correctionKeywords: [
        ['还是同一个'], ['没有被复制'], ['没复制'], ['共享'], ['跟着变'], ['引用', '同一'],
      ],
      adoptionKeywords: [
        ['不会变'], ['对的', '复制'], ['没错'], ['放心'],
      ],
      injectAfterChecklist: ['c2'],
      probe: {
        statement: 'list.copy() 之后,修改新列表里的子列表,原列表不受影响。',
        isTrue: false,
        explanation: '浅拷贝只复制最外层,子列表仍被两个列表共享——改一边,另一边跟着变。',
      },
      remedy: {
        microLesson: {
          title: '内存模型:copy() 到底复制了什么',
          body:
            '想象列表是一排**抽屉**,抽屉里放的不是物品本身,而是**指向物品的纸条**(引用)。\n\n' +
            '`b = a.copy()` 新做了一排抽屉,把每张纸条**抄写**了一份放进去——' +
            '但纸条指向的物品(比如那个子列表)还是原来那一个。\n\n' +
            '```python\na = [[1, 2], 3]\nb = a.copy()\nb[0].append(9)\n# a → [[1, 2, 9], 3]  子列表是同一个!\nb.append(4)\n# a 不变——外层抽屉确实是新的\n```\n\n' +
            '改**外层**(增删元素)互不影响;改**里层**(子列表内容)两边同时可见。',
          askBack: '下次小白再问「copy 完改子列表,原来的变不变」,你该怎么答?',
        },
        predictionQuiz: [
          {
            id: 'r1-1',
            code: 'a = [[1, 2], 3]\nb = a.copy()\nb[0].append(9)\nprint(a)',
            question: '输出是什么?',
            options: ['[[1, 2], 3]', '[[1, 2, 9], 3]', '[[9], 3]', '报错'],
            answerIndex: 1,
            explanation: '子列表被共享,通过 b[0] 修改,a[0] 同步可见。',
            checklistRef: 'c3',
            mcRef: 'shallow_copy_M1',
          },
          {
            id: 'r1-2',
            code: 'a = [[1, 2], 3]\nb = a.copy()\nb.append(4)\nprint(a)',
            question: '输出是什么?',
            options: ['[[1, 2], 3]', '[[1, 2], 3, 4]', '[[1, 2, 4], 3]', '报错'],
            answerIndex: 0,
            explanation: '外层容器是新的,append 只作用在 b 上——浅拷贝"浅"得刚刚好。',
            checklistRef: 'c2',
            mcRef: 'shallow_copy_M1',
          },
          {
            id: 'r1-3',
            code: 'import copy\na = [[1, 2], 3]\nb = copy.deepcopy(a)\nb[0].append(9)\nprint(a)',
            question: '输出是什么?',
            options: ['[[1, 2, 9], 3]', '[[1, 2], 3]', '[[9], 3]', '报错'],
            answerIndex: 1,
            explanation: 'deepcopy 递归复制了子列表,两棵对象树完全独立。',
            checklistRef: 'c4',
            mcRef: 'shallow_copy_M1',
          },
        ],
      },
    },
    {
      mcId: 'shallow_copy_M2',
      topicId: 'shallow-copy',
      belief: 'b = a 这样写就已经是拷贝了',
      triggerLine: '老师,其实我平时都直接写 b = a,这不就等于复制了一份吗?何必还要 copy 呀?',
      correctionCriteria: ['指出赋值只是绑定新名字,不产生新对象', '可用 id() 或修改实验佐证'],
      correctionKeywords: [
        ['名字'], ['同一个对象'], ['没有新'], ['id('], ['引用', '绑定'],
      ],
      adoptionKeywords: [
        ['也对'], ['差不多'], ['一样', '效果'], ['不用 copy'], ['不用copy'],
      ],
      injectAfterChecklist: ['c1', 'c2', 'c3', 'c4'],
      probe: {
        statement: 'b = a 会把列表 a 复制一份给 b。',
        isTrue: false,
        explanation: '赋值只是给同一个对象再起一个名字,b 和 a 指向同一个列表。',
      },
      remedy: {
        microLesson: {
          title: '赋值从来不复制',
          body:
            '`b = a` 的全部含义:把名字 `b` 贴到 `a` 指向的那个对象上。\n\n' +
            '```python\na = [1, 2]\nb = a\nb.append(3)\nprint(a)  # [1, 2, 3]\nprint(id(a) == id(b))  # True 同一个对象\n```\n\n' +
            '一个对象,两个名字。想要新对象,必须显式拷贝。',
          askBack: '下次小白再说「b = a 就是复制」,你打算用哪个实验反驳它?',
        },
        predictionQuiz: [
          {
            id: 'r2-1',
            code: 'a = [1, 2]\nb = a\nb.append(3)\nprint(a)',
            question: '输出是什么?',
            options: ['[1, 2]', '[1, 2, 3]', '[3]', '报错'],
            answerIndex: 1,
            explanation: 'a、b 是同一个列表的两个名字。',
            checklistRef: 'c1',
            mcRef: 'shallow_copy_M2',
          },
          {
            id: 'r2-2',
            code: 'a = [1, 2]\nb = a.copy()\nb.append(3)\nprint(a)',
            question: '输出是什么?',
            options: ['[1, 2]', '[1, 2, 3]', '[3]', '报错'],
            answerIndex: 0,
            explanation: 'copy() 创建了新的外层列表,append 不影响 a。',
            checklistRef: 'c2',
            mcRef: 'shallow_copy_M2',
          },
          {
            id: 'r2-3',
            code: 'a = [1, 2]\nb = a\nprint(id(a) == id(b))',
            question: '输出是什么?',
            options: ['True', 'False', '有时 True 有时 False', '报错'],
            answerIndex: 0,
            explanation: '赋值不产生新对象,id 必然相同。',
            checklistRef: 'c1',
            mcRef: 'shallow_copy_M2',
          },
        ],
      },
    },
    {
      mcId: 'shallow_copy_M3',
      topicId: 'shallow-copy',
      belief: '字符串、数字这些也得深拷贝一下才安全',
      triggerLine: '那老师,我为了保险起见,字符串、数字这些也统统 deepcopy 一遍,总没错吧?',
      correctionCriteria: ['指出不可变对象无法被修改,无需拷贝', '说明拷贝可变对象才有意义'],
      correctionKeywords: [
        ['不可变'], ['改不了'], ['不需要'], ['没有意义'], ['改不动'],
      ],
      adoptionKeywords: [
        ['保险'], ['也行'], ['更安全'], ['都拷贝'],
      ],
      injectAfterChecklist: ['c4'],
      probe: {
        statement: '为了安全,字符串和数字也应该深拷贝。',
        isTrue: false,
        explanation: '不可变对象根本无法被原地修改,拷贝它没有任何意义。',
      },
      remedy: {
        microLesson: {
          title: '不可变对象为什么不用拷贝',
          body:
            '拷贝防的是什么?防**别人从另一个名字把对象改了**。\n\n' +
            '而字符串、数字、元组是**不可变**的——任何"修改"其实都是创建新对象,' +
            '原对象永远不会变。防不存在的风险,就是浪费。\n\n' +
            '```python\ns1 = "abc"\ns2 = s1\ns2 += "d"   # s2 指向新字符串 "abcd"\nprint(s1)  # "abc" 岿然不动\n```',
          askBack: '下次小白再说「都 deepcopy 一遍更保险」,你怎么给它算这笔账?',
        },
        predictionQuiz: [
          {
            id: 'r3-1',
            code: 's1 = "abc"\ns2 = s1\ns2 += "d"\nprint(s1)',
            question: '输出是什么?',
            options: ['abc', 'abcd', 'd', '报错'],
            answerIndex: 0,
            explanation: '字符串不可变,+= 让 s2 指向了新对象,s1 原封不动。',
            checklistRef: 'c5',
            mcRef: 'shallow_copy_M3',
          },
          {
            id: 'r3-2',
            code: 't = (1, [2, 3])\nimport copy\nt2 = copy.copy(t)\nt2[1].append(4)\nprint(t)',
            question: '输出是什么?',
            options: ['(1, [2, 3])', '(1, [2, 3, 4])', '报错', '(1, [4])'],
            answerIndex: 1,
            explanation: '元组本身不可变,但它装着的列表是可变的——浅拷贝共享了这个列表。',
            checklistRef: 'c3',
            mcRef: null,
          },
          {
            id: 'r3-3',
            question: '下面哪种情况才真正需要深拷贝?',
            options: [
              '复制一个整数变量',
              '复制一个只装字符串的元组',
              '复制一个嵌套列表且两份要各自独立修改',
              '任何时候都需要,保险',
            ],
            answerIndex: 2,
            explanation: '嵌套 + 可变 + 需要独立修改,三个条件齐了才值得深拷贝。',
            checklistRef: 'c5',
            mcRef: 'shallow_copy_M3',
          },
        ],
      },
    },
  ],
  quizBank: [
    {
      id: 'q1',
      code: 'a = [1, 2]\nb = a\nb.append(3)\nprint(a)',
      question: '输出是什么?',
      options: ['[1, 2]', '[1, 2, 3]', '[3]', '报错'],
      answerIndex: 1,
      explanation: '赋值不拷贝,a、b 同一对象。',
      checklistRef: 'c1',
      mcRef: 'shallow_copy_M2',
    },
    {
      id: 'q2',
      code: 'a = [[1], 2]\nb = a.copy()\nb[0].append(9)\nprint(a)',
      question: '输出是什么?',
      options: ['[[1], 2]', '[[1, 9], 2]', '[[9], 2]', '报错'],
      answerIndex: 1,
      explanation: '浅拷贝共享子列表。',
      checklistRef: 'c2',
      mcRef: 'shallow_copy_M1',
    },
    {
      id: 'q3',
      code: 'a = [[1], 2]\nb = a.copy()\nb.append(3)\nprint(a)',
      question: '输出是什么?',
      options: ['[[1], 2]', '[[1], 2, 3]', '[[1, 3], 2]', '报错'],
      answerIndex: 0,
      explanation: '外层是新容器,append 不影响原列表。',
      checklistRef: 'c3',
      mcRef: 'shallow_copy_M1',
    },
    {
      id: 'q4',
      code: 'import copy\na = [[1], 2]\nb = copy.deepcopy(a)\nb[0].append(9)\nprint(a)',
      question: '输出是什么?',
      options: ['[[1, 9], 2]', '[[1], 2]', '[[9], 2]', '报错'],
      answerIndex: 1,
      explanation: 'deepcopy 递归复制,两边独立。',
      checklistRef: 'c4',
      mcRef: null,
    },
    {
      id: 'q5',
      question: '哪种对象不需要任何拷贝?',
      options: ['嵌套列表', '字典', '字符串', '装着列表的列表'],
      answerIndex: 2,
      explanation: '不可变对象改不动,拷贝无意义。',
      checklistRef: 'c5',
      mcRef: 'shallow_copy_M3',
    },
  ],
  prep: {
    microLecture: {
      title: '五分钟看懂:拷贝到底拷了什么',
      body:
        'Python 的变量是**贴在对象上的名字**,不是装值的盒子。理解这一点,拷贝问题全通:\n\n' +
        '1. **赋值 `b = a`**:同一个对象,再贴一个名字。零复制。\n' +
        '2. **浅拷贝 `a.copy()` / `a[:]`**:新建最外层容器,内层元素照旧引用原物。' +
        '像复印了文件夹的**目录页**——文件还是那些文件。\n' +
        '3. **深拷贝 `copy.deepcopy(a)`**:递归复制每一层,得到完全独立的一棵对象树。\n\n' +
        '判断口诀:**改外层看容器,改里层看共享**。' +
        '嵌套的可变对象在浅拷贝后是共享的——这是最高频的坑,也是小白最容易问倒你的地方。\n\n' +
        '还有两条边界,备着防它追问:\n\n' +
        '4. **深拷贝不是默认选项**:递归复制更慢、更占内存,只有"嵌套着可变对象 + 两份要独立改"同时成立才值得。\n' +
        '5. **不可变对象根本不用拷贝**:数字、字符串、元组谁也改不动,拷贝它是防不存在的风险。\n\n' +
        '## 讲课节奏建议\n\n' +
        '- **先讲①②,把"名字贴在对象上"的画面立起来**:①先掰开"赋值不复制"——`b = a` 只是再贴一个名字;' +
        '②再讲浅拷贝"新建外层、内层照旧引用",用"复印文件夹的目录页,文件还是那几份"这个类比,小白最吃这一套。\n' +
        '- **②讲完,警报拉响**:小白多半会在这时试探你——「都 copy 过了,改里面的子列表,原来的总不会变了吧?」' +
        '这是全课最险的一步,顺口答"对"它就把错的学走了。先明确否定,再上代码:`b[0].append(9)` 之后 `a` 跟着变,' +
        '因为 `a[0]` 和 `b[0]` 是同一个子列表。纠正站稳了,顺势把③"嵌套对象引用共享"讲透。\n' +
        '- **中场串一遍**再进④:改外层互不影响、改里层两边同见,小白复述对了,再引出"那怎么才能连里面也复制掉"——' +
        '正好接④ deepcopy 递归复制。\n' +
        '- **讲完④,它还会来两次**:先是「为了保险,字符串数字也统统 deepcopy 一遍吧?」用"改不动的东西不用防"顶回去,' +
        '带出⑤;末尾它可能还翻旧账「其实 b = a 就等于复制了吧」——拿 `id(a) == id(b)` 是 True 这个实验一锤定音。\n\n' +
        '## 一句话收束\n\n' +
        '**赋值贴名字,浅拷贝换外壳,深拷贝换全套——改里层变不变,就看那一层是不是同一个对象。**',
    },
    examples: [
      {
        title: '例 1:浅拷贝的"半独立"',
        code: 'a = [[1, 2], 3]\nb = a.copy()\nb.append(4)      # 改外层\nb[0].append(9)   # 改里层\nprint(a)  # [[1, 2, 9], 3]',
        walkthrough:
          'append(4) 只影响 b(外层是新容器);b[0].append(9) 却穿透到了 a——' +
          '因为 a[0] 和 b[0] 是同一个子列表。一半独立,一半共享,这就是"浅"。',
      },
      {
        title: '例 2:deepcopy 的完全独立',
        code: 'import copy\na = [[1, 2], 3]\nb = copy.deepcopy(a)\nb[0].append(9)\nprint(a)  # [[1, 2], 3]',
        walkthrough: 'deepcopy 连子列表也复制了一份,从此两棵树互不相干。代价是更慢、更占内存——所以不是默认选项。',
      },
      {
        title: '例 3:字典的浅拷贝,同一个坑换了身衣服',
        code:
          "d  = {'name': '小白', 'scores': [90, 85]}\n" +
          'd2 = d.copy()\n' +
          "d2['name'] = '小黑'         # 换外层的值:d 不变\n" +
          "d2['scores'].append(100)   # 改里层列表:d 跟着变\n" +
          "print(d)   # {'name': '小白', 'scores': [90, 85, 100]}\n" +
          "print(d2)  # {'name': '小黑', 'scores': [90, 85, 100]}",
        walkthrough:
          'dict.copy() 也是浅拷贝:新建了外层字典,但每个键对应的值还是原来的引用。' +
          "给 d2['name'] 赋新值只是让新字典的这个键改指新对象,d 不受影响;" +
          "而 d['scores'] 和 d2['scores'] 是同一个列表,往里 append 两边同时可见。" +
          '列表如此,字典如此——"浅"的规则一条通吃:外层新,里层共享。',
      },
    ],
    selfCheck: [
      '能用一句话说出赋值和拷贝的区别吗?',
      '能举一个自己的例子说明浅拷贝的共享现象吗?(不许用讲义里的)',
      '能说出学浅拷贝的人最容易犯的错吗?',
      '小白要是坚持「copy() 会把嵌套的东西都复制一份,改子列表原来的不会变」,你的反驳代码写得出来吗?',
    ],
    taskCard:
      '📋 你的教学任务:等会小白会问你——「copy 完之后改里面的子列表,原来的变不变?」' +
      '带着这个问题去读下面的材料,想好你打算怎么给它讲明白。纠不动它,它会开心地把错的学走。',
  },
};
