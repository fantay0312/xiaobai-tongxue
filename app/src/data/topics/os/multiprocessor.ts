/**
 * 知识点:多处理器编程(《操作系统原理》第 13 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect13.md
 * 视频:https://www.bilibili.com/video/BV1vgQGBREyJ
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osMultiprocessorTopic: Topic = {
  topicId: 'os-multiprocessor',
  title: '多处理器编程',
  course: '操作系统原理',
  tagline: '共享内存的噩梦开场',
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
};

export const osMultiprocessorDemo: DemoLine[] = [];

export const osMultiprocessorSelfTest: SelfTestItem[] = [];
