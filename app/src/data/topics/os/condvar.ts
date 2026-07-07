/**
 * 知识点:并发控制：条件变量(《操作系统原理》第 15 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect15.md
 * 视频:https://www.bilibili.com/video/BV1t3dQBAEzd
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osCondvarTopic: Topic = {
  topicId: 'os-condvar',
  title: '并发控制：条件变量',
  course: '操作系统原理',
  tagline: '万能同步方法',
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

export const osCondvarDemo: DemoLine[] = [];

export const osCondvarSelfTest: SelfTestItem[] = [];
