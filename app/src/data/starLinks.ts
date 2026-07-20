export interface StarLink {
  a: string;
  b: string;
  note: string;
  /** 星官:把语义相近的星链归入同一「星官」(考据感命名);选中成员星时在札记旁标注。
      可选字段,消费方防御式读取——缺省不渲染星官标签。 */
  cluster?: string;
}

/** 盲区星图中经课程内容核对过的知识关联;端点均使用 Topic.topicId。
    cluster 星官(五官):训练星官(规模与训练)/词元星官(token 与注意力)/
    并发星官(并发原语)/引用星官(对象引用语义)/守界星官(隔离·安全·对齐)。 */
export const STAR_LINKS: readonly StarLink[] = [
  { a: 'os-scaling-law', b: 'scaling-laws', note: '同讲 Scaling', cluster: '训练星官' },
  { a: 'os-token-journey', b: 'tokenization', note: '同讲 Token', cluster: '词元星官' },
  { a: 'os-multiprocessor', b: 'gil', note: '并发一脉', cluster: '并发星官' },
  { a: 'os-async', b: 'generator', note: '让出执行权', cluster: '并发星官' },
  { a: 'mutable-default', b: 'shallow-copy', note: '对象引用语义', cluster: '引用星官' },
  { a: 'os-gpu', b: 'pretrain-finetune', note: '训练算力', cluster: '训练星官' },
  { a: 'os-security', b: 'rlhf', note: '安全与对齐', cluster: '守界星官' },
  { a: 'os-token-journey', b: 'attention', note: '上下文计算', cluster: '词元星官' },
  { a: 'os-gpu', b: 'gradient-descent', note: '并行算梯度', cluster: '训练星官' },
  { a: 'os-async', b: 'gil', note: '并发非并行', cluster: '并发星官' },
  { a: 'os-mutex', b: 'mutable-default', note: '共享可变状态', cluster: '并发星官' },
  { a: 'os-concurrency-bugs', b: 'shallow-copy', note: '共享引用风险', cluster: '引用星官' },
  { a: 'os-scaling-law', b: 'pretrain-finetune', note: '规模化预训练', cluster: '训练星官' },
  { a: 'scaling-laws', b: 'gradient-descent', note: '损失与规模', cluster: '训练星官' },
  { a: 'attention', b: 'tokenization', note: '词块相互注意', cluster: '词元星官' },
  { a: 'os-virtualization', b: 'os-security', note: '隔离安全边界', cluster: '守界星官' },
];
