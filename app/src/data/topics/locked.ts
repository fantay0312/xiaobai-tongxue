/** 图谱占位知识点(不可进入,展示课程版图用) */
import type { Topic } from '../../types';

const stub = (topicId: string, title: string, tagline: string): Topic => ({
  topicId,
  title,
  course: 'Python 程序设计',
  tagline,
  locked: true,
  transferHint: '',
  checklist: [],
  misconceptions: [],
  quizBank: [],
  prep: {
    microLecture: { title: '', body: '' },
    examples: [],
    selfCheck: [],
    taskCard: '',
  },
});

export const lockedTopics: Topic[] = [
  stub('decorator', '装饰器', '给函数穿一件会做事的外套'),
  stub('generator', '生成器与迭代器', '一次只算一个,用到才算'),
  stub('closure', '闭包与作用域', '函数记得它出生时的环境'),
  stub('gil', 'GIL 与多线程', '为什么多线程不一定更快'),
];
