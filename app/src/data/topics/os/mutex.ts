/**
 * 知识点:并发控制：互斥(《操作系统原理》第 14 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect14.md
 * 视频:https://www.bilibili.com/video/BV1hNdhB1Efe
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osMutexTopic: Topic = {
  topicId: 'os-mutex',
  title: '并发控制：互斥',
  course: '操作系统原理',
  tagline: '一把大锁保平安',
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

export const osMutexDemo: DemoLine[] = [];

export const osMutexSelfTest: SelfTestItem[] = [];
