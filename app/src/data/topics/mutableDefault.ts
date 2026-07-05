/**
 * 知识点:可变默认参数 —— 待完整撰写(参照 shallowCopy.ts 的密度与咬合标准)。
 * TODO(DATA): checklist 5 项、误区 3 条、quizBank 5 题、prep 材料、demoScript 咬合。
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
      groundTruth: '函数定义时默认参数表达式只求值一次,绑定在函数对象上,所有调用共享。',
      keywords: [['定义', '一次'], ['默认', '共享']],
      terms: ['默认参数', '函数对象'],
      level: 'L1',
      lookupCard: '**默认值何时求值?**\n\n`def` 执行的那一刻求值一次,存在函数对象上,之后每次调用都用同一个。',
      probeLine: '那个等号后面的东西,是每次调用的时候都新做一份吗?',
    },
  ],
  misconceptions: [],
  quizBank: [],
  prep: {
    microLecture: { title: '可变默认参数', body: '待撰写。' },
    examples: [],
    selfCheck: ['能说出默认值在什么时候被求值吗?'],
    taskCard: '📋 你的教学任务:等会小白会问你——「每次调用函数,默认的空列表都是新的吧?」',
  },
};
