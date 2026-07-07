/**
 * 知识点:并发 Bug 和应对(《操作系统原理》第 17 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect17.md
 * 视频:https://www.bilibili.com/video/BV1Jg96BjE68
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osConcurrencyBugsTopic: Topic = {
  topicId: 'os-concurrency-bugs',
  title: '并发 Bug 和应对',
  course: '操作系统原理',
  tagline: '死锁与数据竞争',
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

export const osConcurrencyBugsDemo: DemoLine[] = [];

export const osConcurrencyBugsSelfTest: SelfTestItem[] = [];
