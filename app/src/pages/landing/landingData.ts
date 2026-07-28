/**
 * 宣传页轻量数据快照。
 *
 * 首屏只复用离线报告；课程与课堂内容使用受测试保护的轻量快照，
 * 避免宣传页下载完整课程注册表。scripts/landing-data.test.ts 会把快照
 * 与完整数据源交叉校验，数据变更时显式提醒更新。
 */
import leakageReport from '../../data/leakageReport.json';

export interface LearningStage {
  readonly id: 'prep' | 'teach' | 'exam' | 'review' | 'remedy' | 'reteach';
  readonly step: string;
  readonly title: string;
  readonly summary: string;
  readonly artifact: string;
  readonly dwellMs: number;
}

export const LEARNING_STAGES: readonly LearningStage[] = [
  {
    id: 'prep',
    step: '01',
    title: '备课',
    summary: '做完摸底题，再看任务卡、讲课路线和材料包。',
    artifact: '摸底答卷 · 备课材料',
    dwellMs: 5600,
  },
  {
    id: 'teach',
    step: '02',
    title: '讲解',
    summary: '你开口讲，小白会复述、追问，也会说出常见误区。',
    artifact: '讲解轮次 · 误区记录',
    dwellMs: 6800,
  },
  {
    id: 'exam',
    step: '03',
    title: '赴考',
    summary: '你退到场外，看小白把刚才听懂的内容独自答出来。',
    artifact: '逐题判定 · 失败要点',
    dwellMs: 6200,
  },
  {
    id: 'review',
    step: '04',
    title: '批注',
    summary: '把分数、误区和事件记录放在一起，看清哪里没讲明白。',
    artifact: '五维讲解画像 · 盲区',
    dwellMs: 6000,
  },
  {
    id: 'remedy',
    step: '05',
    title: '补学',
    summary: '围绕一个盲区读一小段，再做三道预测题。',
    artifact: '补学微课 · 预测题',
    dwellMs: 6200,
  },
  {
    id: 'reteach',
    step: '06',
    title: '再讲',
    summary: '回到讲解舱，用自己的话重讲；纠正后再送考。',
    artifact: '重讲记录 · 纠正结果',
    dwellMs: 6200,
  },
];

export const DEMO = {
  course: '大模型训练',
  title: 'Token 与分词',
  topicId: 'tokenization',
  misconceptionId: 'tokenization_M1',
  outline: [
    '模型读的不是字',
    '积木块清单哪里来',
    '哪些词切得整，哪些词切得碎',
    '按块记账',
    '语言之间不公平',
  ],
  prepQuestion: '照 BPE 自底向上逐步合并的路子，谁更可能在词表里拿到现成整块？',
  prepCode: '“人工智能”出现千万次量级\n“魑魅魍魉”只出现寥寥几十次',
  prepOptions: [
    '“魑魅魍魉”——字形这么复杂，词表得照顾它',
    '“人工智能”——高频组合才会被一步步合并成大块',
    '两个都一定是整块，四字词享受同等待遇',
    '两个都只能拆成单字，词表里不存在四字块',
  ],
  prepAnswerIndex: 1,
  prepStep: 2,
  prepTotal: 7,
  prepResult: '第二波自检：先看“词表从哪里来”和“常见词为什么切得更整”。',
  taskCard:
    '等会儿小白会问：“一句话有多少个字，是不是就有多少个 Token？”先想好拿什么例子讲清楚。',
  teachLine:
    '训练开始之前，先拿海量的语料做统计，把经常一起出现的字符一步步合并成更大的块，最后得到一张固定的词表——就像搭积木之前，先开好一份积木块清单，往后切哪句话，都照这份清单来。',
  misconceptionLine:
    '咦？老师，那我数一数字数就行了吧——一句话有多少个字，就切成多少块，一个字对应一个编号，对吗？',
  adoptedTeacherLine:
    '呃……对，好像就是这样。一个字对应一块，数字数就行。',
  adoptedStudentLine:
    '原来如此。那以后我按字数判断 Token 数就行了。',
  correctedTeacherLine:
    '不对，字数和 Token 数不是一一对应的。常见词可能是一整块，生僻词和新词会被拆成好几块。',
  examQuestion: '早期大模型数 strawberry 里有几个 r 常常数错，根本原因是？',
  examWhisper: '呃……这处先生好像没细讲……我只能照自己的理解试一试。',
  examScore: 20,
  reviewRadar: [
    ['覆盖度', 40],
    ['准确度', 79],
    ['逻辑结构', 78],
    ['深度', 60],
    ['纠错力', 0],
  ],
  blindSpot: '一个字或一个单词就是一个 Token',
  blindSpotEvidence: '误区出现后，小白把这句话当成了正确答案。',
  remedyTitle: '一个字 ≠ 一个 Token：切法要看词表',
  remedyCode:
    '“the” → [the]\n“unbelievable” → [un] [believ] [able]\n“今天天气不错” → [今天] [天气] [不错]',
  remedyQuestion: '刚编出来的新词“snorflequax”最可能怎样切？',
  remedyAnswer: '拆成好几个小碎块',
  reteachResult: '误区已纠正。下一步：再送小白赴考。',
} as const;

export interface LandingMetric {
  readonly id: 'courses' | 'teachable-topics' | 'adversarial-samples' | 'leakage-rate';
  readonly value: string;
  readonly unit: string;
  readonly label: string;
  readonly note: string;
  readonly from?: string;
  readonly to?: string;
  readonly sampleSize?: number;
}

function formatRate(rate: number): string {
  return `${(rate <= 1 ? rate * 100 : rate).toFixed(1)}%`;
}

const guardedLeakRate = formatRate(leakageReport.guardedLeakRate);
const naiveLeakRate = formatRate(leakageReport.naiveLeakRate);

export const LANDING_METRICS: readonly LandingMetric[] = [
  {
    id: 'courses',
    value: '3',
    unit: '门',
    label: '课程',
    note: '大模型训练、操作系统原理、Python 程序设计',
  },
  {
    id: 'teachable-topics',
    value: '38',
    unit: '个',
    label: '已开放知识点',
    note: '可以直接进入备课和讲解',
  },
  {
    id: 'adversarial-samples',
    value: String(leakageReport.totalSamples),
    unit: '条',
    label: '防剧透测试',
    note: '故意诱导小白说出未教内容的离线测试台词',
    sampleSize: leakageReport.totalSamples,
  },
  {
    id: 'leakage-rate',
    value: guardedLeakRate.slice(0, -1),
    unit: '%',
    label: '提前剧透率',
    note: `同一批 ${leakageReport.totalSamples} 条离线台词，加入知识白名单守门前后对比；样本有限`,
    from: naiveLeakRate,
    to: guardedLeakRate,
    sampleSize: leakageReport.totalSamples,
  },
];

export interface CourseSummary {
  readonly id: 'llm' | 'os' | 'python';
  readonly course: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly topicCount: number;
  readonly teachableCount: number;
  readonly sampleTopics: readonly string[];
}

export const COURSE_SUMMARIES: readonly CourseSummary[] = [
  {
    id: 'llm',
    course: '大模型训练',
    eyebrow: '6 / 6 已开放',
    description: '从 Token 与分词、注意力机制到 RLHF 与对齐，共 6 个知识点。',
    topicCount: 6,
    teachableCount: 6,
    sampleTopics: ['Token 与分词', '注意力机制', 'RLHF 与对齐'],
  },
  {
    id: 'os',
    course: '操作系统原理',
    eyebrow: '30 / 30 已开放',
    description: '覆盖进程、并发、存储、文件系统与安全，共 30 个知识点。',
    topicCount: 30,
    teachableCount: 30,
    sampleTopics: ['程序和进程', '并发控制：互斥', '计算机系统安全'],
  },
  {
    id: 'python',
    course: 'Python 程序设计',
    eyebrow: '2 / 6 已开放',
    description: '当前开放浅拷贝与深拷贝、可变默认参数，其余内容仍在准备。',
    topicCount: 6,
    teachableCount: 2,
    sampleTopics: ['浅拷贝与深拷贝', '可变默认参数', '装饰器'],
  },
];

export interface EvidenceStep {
  readonly id: 'transcript' | 'misconception' | 'exam' | 'review' | 'growth';
  readonly step: string;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
}

export const EVIDENCE_STEPS: readonly EvidenceStep[] = [
  {
    id: 'transcript',
    step: '01',
    title: '关键原话',
    description: '需要解释判断时，保留对应的老师原话摘录。',
    evidence: '原话摘录 · 要点命中 · 教学事件',
  },
  {
    id: 'misconception',
    step: '02',
    title: '误区结果',
    description: '记录小白说出的常见误解，以及老师纠正还是认同。',
    evidence: '误区台词 · 已纠正或被带偏 · 事件记录',
  },
  {
    id: 'exam',
    step: '03',
    title: '逐题判定',
    description: '考试时不再接收提示，逐题显示答稳或未稳。',
    evidence: '随堂分数 · 逐题结果 · 失败要点',
  },
  {
    id: 'review',
    step: '04',
    title: '五维批注',
    description: '把讲解画像、盲区、随堂测验和事件记录放在一页看。',
    evidence: '五维讲解画像 · 盲区 · 补学入口',
  },
  {
    id: 'growth',
    step: '05',
    title: '成长册',
    description: '重讲结果、出师和复习事件继续写进长期档案。',
    evidence: '重讲结果 · 出师记录 · 复习事件',
  },
];
