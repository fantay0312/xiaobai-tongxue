/**
 * 知识点:并发控制：信号量(《操作系统原理》第 16 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect16.md
 * 视频:https://www.bilibili.com/video/BV1yQogB2Esf
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osSemaphoreTopic: Topic = {
  topicId: 'os-semaphore',
  title: '并发控制：信号量',
  course: '操作系统原理',
  tagline: '计数的艺术',
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

export const osSemaphoreDemo: DemoLine[] = [];

export const osSemaphoreSelfTest: SelfTestItem[] = [];
