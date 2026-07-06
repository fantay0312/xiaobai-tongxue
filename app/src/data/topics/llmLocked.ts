/** 《大模型训练》图谱占位知识点(不可进入,展示课程版图用) */
import type { Topic } from '../../types';

const stub = (topicId: string, title: string, tagline: string): Topic => ({
  topicId,
  title,
  course: '大模型训练',
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

export const llmLockedTopics: Topic[] = [
  stub('attention', '注意力机制', '每个词都在偷看别的词'),
  stub('pretrain-finetune', '预训练与微调', '先博览群书,再学规矩说话'),
  stub('rlhf', 'RLHF 与对齐', '用人类的喜好当指南针'),
  stub('scaling-laws', 'Scaling Laws', '大力真的能出奇迹吗'),
];
