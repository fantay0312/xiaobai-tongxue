/**
 * 「小白同学」全局类型契约 —— FROZEN
 * 所有模块(data / engine / pages / avatar)共享此文件。
 * 子任务实现时不得修改本文件;如接口不满足需求,在自己模块内组合扩展。
 */

// ───────────────────────── 基础枚举 ─────────────────────────

/** 追问梯度,对应 Bloom 认知层级 */
export type QuestionLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** 小白人格皮肤 */
export type Persona = '好奇型' | '严谨型' | '杠精型';

/** 知识点上小白的知识状态 */
export type KnowledgeState = '没懂' | '半懂' | '出师';

/** 误区条目状态机 */
export type McState = '待注入' | '已注入' | '已纠正' | '被带偏';

/** 小白情绪(驱动 3D 形象与台词语气) */
export type XiaobaiMood =
  | 'idle'      // 平静等待
  | 'curious'   // 好奇追问
  | 'confused'  // 困惑
  | 'thinking'  // 思考中(等待渲染)
  | 'aha'       // 开窍瞬间
  | 'happy'     // 开心(被教明白)
  | 'proud'     // 出师/考好了
  | 'shy';      // 被难住/道歉

/** 导演指令卡动作枚举 —— 注意:没有"讲授/总结/纠正"类动作(认知天花板) */
export type DirectorAction =
  | 'ask_clarify'           // L1 澄清定义
  | 'ask_example'           // L2 索要例子
  | 'ask_boundary'          // L3 边界测试
  | 'inject_misconception'  // L4 误区注入
  | 'ask_transfer'          // L5 迁移追问
  | 'express_understanding' // 正确复述式"懂了"(Aha 时刻)
  | 'rescue_hint'           // R1 递台阶
  | 'propose_lookup'        // R2 提议一起查书
  | 'stay_confused'         // 白名单外/偏题,保持困惑
  | 'trigger_review';       // 战术性遗忘,发起复习

/** 会话模式 */
export type SessionMode =
  | 'teach'    // 常规讲解
  | 'reteach'  // 补学后重讲验证(重放被带偏的误区)
  | 'review';  // 小白"忘了",间隔复习

// ───────────────────────── 数据层:知识点与误区库 ─────────────────────────

/** 预测输出题(补学"加工"段 / 考小白题库) */
export interface PredictionQuizItem {
  id: string;
  code?: string;            // 代码片段(可空,纯概念题)
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  checklistRef: string;     // 关联的 checklist 项 id
  /** 关联误区:该误区"被带偏"或未纠正时,小白此题必错 */
  mcRef?: string | null;
}

/** 补学微路径(三段式,①输入 ②加工 ③输出=回讲解舱) */
export interface RemedyPack {
  microLesson: {
    title: string;
    body: string;           // markdown,内存模型图解等,结尾必带 askBack
    askBack: string;        // "下次小白再这么问,你该怎么答?"
  };
  predictionQuiz: PredictionQuizItem[];  // 3 题
}

/** 误区库条目 —— 全系统唯一标尺 */
export interface Misconception {
  mcId: string;                 // e.g. "shallow_copy_M1"
  topicId: string;
  belief: string;               // 错误认知的一句话描述
  triggerLine: string;          // 注入台词(小白说出口的话)
  correctionCriteria: string[]; // 纠正标准(人读,复盘页展示)
  /** 纠正判定关键词:任一组内全部命中 → 判定纠正成功 */
  correctionKeywords: string[][];
  /** 被带偏判定关键词:学生认同了错误说法(任一组全命中) */
  adoptionKeywords: string[][];
  /** 注入前置条件:这些 checklist 项已命中才可注入 */
  injectAfterChecklist: string[];
  /** 摸底快测判断题(复用误区库出题) */
  probe: { statement: string; isTrue: false; explanation: string };
  remedy: RemedyPack;
}

/** 知识点 checklist 项(ground truth 仅评估引擎使用) */
export interface ChecklistItem {
  id: string;               // "c1"
  point: string;            // 知识要点名(可进白名单)
  groundTruth: string;      // 标准表述,仅评估用
  /** 命中规则:任一组内关键词全部出现 → 命中 */
  keywords: string[][];
  /** 该项涉及的专业术语(泄漏检测的 banned terms 来源) */
  terms: string[];
  level: QuestionLevel;     // 归属追问层级
  /** R2 一起查书时给学生看的知识卡片(markdown) */
  lookupCard: string;
  /**
   * 小白追问这个要点时的话术底稿(mock 渲染用)。
   * 铁律:只能用生活词汇/老师大概率已说出口的词,不得含未解锁的专业术语(须过泄漏检测)。
   */
  probeLine: string;
}

/** 备课材料包 */
export interface PrepPack {
  microLecture: { title: string; body: string };  // 500字微课讲义 markdown
  examples: { title: string; code: string; walkthrough: string }[];
  selfCheck: string[];       // 备课自检清单
  taskCard: string;          // 教学任务卡文案(关键设计)
}

/** 知识点(课程知识库单元) */
export interface Topic {
  topicId: string;
  title: string;             // "浅拷贝与深拷贝"
  course: string;            // "Python 程序设计"
  tagline: string;           // 一句话描述
  locked?: boolean;          // 占位知识点(图谱展示用,不可进入)
  checklist: ChecklistItem[];
  misconceptions: Misconception[];
  quizBank: PredictionQuizItem[];   // 考小白的随堂小测题
  prep: PrepPack;
  /** L5 迁移追问的目标场景,如"字典的拷贝" */
  transferHint: string;
}

// ───────────────────────── 小白 profile(双层成长模型) ─────────────────────────

export interface GoldenAnalogy {
  id: string;
  topicId: string;
  text: string;              // 金句原文
  t: string;                 // ISO 时间
}

/** 全局层:永不重置 */
export interface XiaobaiGlobal {
  persona: Persona;
  learningLevel: 1 | 2 | 3 | 4 | 5;
  relationshipMemory: string[];       // 3-5 条
  goldenAnalogies: GoldenAnalogy[];
  topicsMastered: number;
  bestRecord: string | null;          // 如 "2 轮出师"
}

/** 知识点层:每个知识点独立,从零开始 */
export interface TopicState {
  topicId: string;
  knowledgeState: KnowledgeState;
  level: QuestionLevel;               // 当前追问梯度位置
  hitChecklist: string[];             // 已讲明白的 checklist 项 id(= 认知白名单来源)
  mcStates: Record<string, McState>;
  accuracyFlags: string[];            // 有争议表述记录
  stuckStreak: number;                // 连续卡壳轮数
  rescueLevel: 0 | 1 | 2 | 3 | 4;     // 已升到的救援级别
  prepDone: boolean;
  lastVerified: string | null;        // ISO
  reviewDue: string | null;           // ISO
  forgotten: boolean;                 // 战术性遗忘已触发,待复习
  mastery: number;                    // 0-1,事件流派生 + 衰减
}

// ───────────────────────── 事件溯源 ─────────────────────────

export type LearnEventType =
  | 'session_started'
  | 'checklist_hit'
  | 'accuracy_flag'
  | 'misconception_injected'
  | 'misconception_corrected'
  | 'misconception_adopted'
  | 'golden_analogy_saved'
  | 'stuck_rescued'
  | 'prep_completed'
  | 'remedy_completed'
  | 'topic_mastered'
  | 'review_triggered'
  | 'review_passed'
  | 'xiaobai_quiz_scored'
  | 'session_ended';

export interface LearnEvent {
  id: string;
  t: string;                   // ISO 时间
  type: LearnEventType;
  topicId: string;
  sessionId: string | null;
  /** 结构化载荷,如 { checklistId: 'c2' } / { mcId, score } */
  payload: Record<string, unknown>;
  /** 证据链文本:评委问"0.72 怎么来的"时展开 */
  evidence: string;
}

// ───────────────────────── 讲解舱运行时 ─────────────────────────

export interface ChatMessage {
  id: string;
  role: 'teacher' | 'xiaobai' | 'system';
  text: string;
  action?: DirectorAction;
  mood?: XiaobaiMood;
  t: string;
}

/** 评估结果(单轮) */
export interface EvalResult {
  checklistHits: string[];                       // 本轮新命中项 id
  accuracyFlags: { checklistId: string; note: string }[];
  mcEvent: { mcId: string; result: 'corrected' | 'adopted' | 'pending' } | null;
  stuckSignal: boolean;
  offTopic: boolean;
  goldenAnalogy: string | null;                  // 检测到的高质量类比原句
  reasoning: string;                             // 一句话决策依据(证据链展示)
}

/** 导演指令卡 */
export interface InstructionCard {
  action: DirectorAction;
  mcId: string | null;
  mcBelief: string | null;
  targetChecklistId: string | null;    // 追问指向的 checklist 项
  knownWhitelist: string[];            // 白名单(checklist point 名)
  recentTeacherTerms: string[];
  style: {
    persona: Persona;
    learningLevel: number;
    maxSentences: number;
    mustEndWithQuestion: boolean;
  };
  /** 复述素材:express_understanding 时用学生刚讲对的要点做正确复述 */
  paraphraseSource: string | null;
}

/** 单轮决策全记录(证据链) */
export interface TurnTrace {
  turn: number;
  teacherText: string;
  evalResult: EvalResult;
  card: InstructionCard;
  xiaobaiText: string;
  leakageRetries: number;
  t: string;
}

/** 五维雷达 */
export interface RadarScores {
  覆盖度: number;
  准确度: number;
  逻辑结构: number;
  深度: number;
  纠错力: number;
}

export interface BlindSpot {
  knowledgePoint: string;
  evidence: string;
  severity: 'high' | 'medium' | 'low';
  mcId: string | null;
  checklistId: string | null;
}

/** 考小白结果 */
export interface XiaobaiQuizResult {
  score: number;                        // 0-100
  answers: { quizId: string; correct: boolean; checklistRef: string }[];
  failedChecklist: string[];            // 挂掉的 checklist 项
}

/** 会话复盘报告 */
export interface SessionReport {
  sessionId: string;
  topicId: string;
  mode: SessionMode;
  startedAt: string;
  endedAt: string;
  radar: RadarScores;
  radarDelta: Partial<RadarScores> | null;   // 相对上一次的增量
  highlights: string[];                       // 高光优先
  goldenAnalogies: string[];
  blindSpots: BlindSpot[];
  quiz: XiaobaiQuizResult | null;
  turnCount: number;
  masteredNow: boolean;                       // 本次出师
}

/** 讲解舱活动会话 */
export interface LiveSession {
  sessionId: string;
  topicId: string;
  mode: SessionMode;
  startedAt: string;
  messages: ChatMessage[];
  traces: TurnTrace[];
  mood: XiaobaiMood;
  pendingMcId: string | null;      // 已注入待判定的误区
  lookupChecklistId: string | null; // R2 查书面板当前卡片
  ended: boolean;
  busy: boolean;                   // 等待小白回应
}

// ───────────────────────── LLM 配置 ─────────────────────────

export interface LlmSettings {
  /** mock=本地模板 api=浏览器直连自配端点 proxy=服务器网关代管密钥(部署形态默认) */
  mode: 'mock' | 'api' | 'proxy';
  baseUrl: string;        // OpenAI 兼容端点,如 https://api.deepseek.com/v1(仅 api 模式)
  apiKey: string;         // 仅 api 模式;proxy 模式密钥永不下发到浏览器
  model: string;
  temperature: number;    // 评估固定 0,此项只作用于小白台词
}

// ───────────────────────── 台词模板库契约(mock 渲染用) ─────────────────────────

/**
 * data/xiaobaiLines.ts 导出此结构。
 * 占位符:{point} 追问目标要点名 {term} 老师最近术语 {belief} 误区观点
 *        {paraphrase} 复述素材 {transfer} 迁移场景 {analogy} 金句原文
 */
export type LineTemplates = Record<
  Persona,
  Record<DirectorAction, string[]>
>;

/** 演示脚本条目(预埋话术) */
export interface DemoLine {
  label: string;        // 按钮短标签,如 "讲:赋值 vs 拷贝"
  text: string;         // 填入输入框的完整讲解
  note: string;         // 预期效果说明,如 "命中 c1,小白将追问例子"
}
