/**
 * 知识点:协程与异步编程(《操作系统原理》第 19 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect19.md
 * 视频:https://www.bilibili.com/video/BV1dVRdBpEze
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osAsyncTopic: Topic = {
  topicId: 'os-async',
  title: '协程与异步编程',
  course: '操作系统原理',
  tagline: '轻量级的并发',
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

export const osAsyncDemo: DemoLine[] = [];

export const osAsyncSelfTest: SelfTestItem[] = [];
