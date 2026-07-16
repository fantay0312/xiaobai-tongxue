export interface StarLink {
  a: string;
  b: string;
  note: string;
}

/** 盲区星图中经课程内容核对过的知识关联；端点均使用 Topic.topicId。 */
export const STAR_LINKS: readonly StarLink[] = [
  { a: 'os-scaling-law', b: 'scaling-laws', note: '同讲 Scaling' },
  { a: 'os-token-journey', b: 'tokenization', note: '同讲 Token' },
  { a: 'os-multiprocessor', b: 'gil', note: '并发一脉' },
  { a: 'os-async', b: 'generator', note: '让出执行权' },
  { a: 'mutable-default', b: 'shallow-copy', note: '对象引用语义' },
  { a: 'os-gpu', b: 'pretrain-finetune', note: '训练算力' },
  { a: 'os-security', b: 'rlhf', note: '安全与对齐' },
  { a: 'os-token-journey', b: 'attention', note: '上下文计算' },
  { a: 'os-gpu', b: 'gradient-descent', note: '并行算梯度' },
  { a: 'os-async', b: 'gil', note: '并发非并行' },
  { a: 'os-mutex', b: 'mutable-default', note: '共享可变状态' },
  { a: 'os-concurrency-bugs', b: 'shallow-copy', note: '共享引用风险' },
  { a: 'os-scaling-law', b: 'pretrain-finetune', note: '规模化预训练' },
  { a: 'scaling-laws', b: 'gradient-descent', note: '损失与规模' },
  { a: 'attention', b: 'tokenization', note: '词块相互注意' },
  { a: 'os-virtualization', b: 'os-security', note: '隔离安全边界' },
];
