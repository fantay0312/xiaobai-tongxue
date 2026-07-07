/**
 * 知识点:CPU、GPU 和 SIMT(《操作系统原理》第 20 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect20.md
 * 视频:https://www.bilibili.com/video/BV1df536aEMk
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osGpuTopic: Topic = {
  topicId: 'os-gpu',
  title: 'CPU、GPU 和 SIMT',
  course: '操作系统原理',
  tagline: '算力的形状',
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

export const osGpuDemo: DemoLine[] = [];

export const osGpuSelfTest: SelfTestItem[] = [];
