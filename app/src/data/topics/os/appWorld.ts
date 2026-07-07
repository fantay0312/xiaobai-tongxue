/**
 * 知识点:构建 Linux 应用世界(《操作系统原理》第 12 讲)—— 脚手架占位(locked)。
 * 作者代理将以全密度内容重写本文件(参照 topics/attention.ts 范本与咬合纪律)。
 * 讲义:https://jyywiki.cn/OS/2026/lect12.md
 * 视频:https://www.bilibili.com/video/BV17JDWBsEMi
 */
import type { DemoLine, Topic } from '../../../types';
import type { SelfTestItem } from '../../selfTest';

export const osAppWorldTopic: Topic = {
  topicId: 'os-app-world',
  title: '构建 Linux 应用世界',
  course: '操作系统原理',
  tagline: '从内核到发行版',
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

export const osAppWorldDemo: DemoLine[] = [];

export const osAppWorldSelfTest: SelfTestItem[] = [];
