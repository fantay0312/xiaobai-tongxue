import { DEMO } from './landingData';

export type TeachDemoOutcome = 'pending' | 'corrected' | 'adopted' | 'needs-example';

export interface TeachDemoSessionSummary {
  readonly outcome: TeachDemoOutcome;
  readonly teacherLine: string;
  readonly turn: number;
}

export const INITIAL_TEACH_DEMO_SESSION: TeachDemoSessionSummary = {
  outcome: 'pending',
  teacherLine: '',
  turn: 1,
};

export interface TeachDemoReply {
  readonly outcome: Exclude<TeachDemoOutcome, 'pending'>;
  readonly text: string;
  readonly mood: 'aha' | 'confused' | 'curious';
  readonly status: string;
  readonly evidence: string;
}

export interface TeachJourneySnapshot {
  readonly branch: 'passed' | 'failed' | 'open';
  readonly exam: {
    readonly mood: 'proud' | 'thinking';
    readonly whisper: string;
    readonly verdict: string;
  };
  readonly review: {
    readonly title: string;
    readonly note: string;
    readonly resultLabel: string;
    readonly resultValue: string;
    readonly resultUnit: string;
    readonly resultSummary: string;
    readonly findingLabel: string;
    readonly findingTitle: string;
    readonly findingEvidence: string;
    readonly action: string;
    readonly events: readonly (readonly [string, string])[];
  };
  readonly remedy: {
    readonly title: string;
    readonly note: string;
    readonly output: string;
  };
  readonly reteach: {
    readonly title: string;
    readonly banner: string;
    readonly result: string;
  };
}

function compact(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s，。？！；：、“”‘’—\-!?,.:;（）()]/gu, '');
}

function explainsVocabularyRule(text: string): boolean {
  return /词表.*(?:决定|切|拆|块)|(?:高频|常见).*(?:合并|整块)|(?:低频|生僻|新词).*(?:拆|碎)/u.test(text);
}

function rejectsOneToOneRule(text: string): boolean {
  const rejects = /(?:不|并非|不是|不能|不一定|≠).{0,10}(?:一一对应|一个字|字数|相等|等于)|(?:字数|一个字).{0,10}(?:不|并非|不是|不能).{0,10}(?:token|块|编号)/u;
  const trailingRejection = /(?:(?:一个字|一字).{0,8}(?:一个token|一块|一个编号)|(?:字数).{0,8}(?:等于|就是).{0,6}(?:token数|块数)).{0,8}(?:是错的|不对|不成立|不一定对|不能成立|不是对的|并非正确|不正确)/u;
  return rejects.test(text) || trailingRejection.test(text);
}

function defendsOneToOneRule(text: string): boolean {
  const mentionsFalseRule = /(?:一个字|一字).{0,8}(?:一个token|一块|一个编号)|(?:字数).{0,8}(?:等于|就是).{0,6}(?:token数|块数)/u;
  const doubleNegative = /(?:不是|并不是|并非)(?:错的|错误|不对|不成立)/u;
  return mentionsFalseRule.test(text) && doubleNegative.test(text);
}

function adoptsOneToOneRule(text: string): boolean {
  const explicitRule = /(?:一个字).{0,8}(?:一个token|一块|一个编号)|(?:字数|数完字).{0,8}(?:token|块|编号)/u;
  const agreesWithRule = /(?:对|是的|没错|就是这样).{0,10}(?:字数|一个字|一块)/u;
  return explicitRule.test(text) || agreesWithRule.test(text);
}

function questionsOneToOneRule(text: string): boolean {
  const mentionsFalseRule = /(?:一个字|一字|字数).{0,10}(?:token|块|编号)/u.test(text);
  return mentionsFalseRule && /(?:难道|是不是|是否|对吗|吗$)/u.test(text);
}

function deniesVocabularyRule(text: string): boolean {
  const deniesVocabulary = /词表.{0,8}(?:不能|不是|不|没法).{0,8}(?:决定|影响|切)|(?:不能|不是|不).{0,8}词表.{0,8}(?:决定|影响|切)/u;
  const deniesChunking = /(?:高频|常见).{0,8}(?:不会|不能|不).{0,8}(?:合并|整块)|(?:低频|生僻|新词).{0,8}(?:不会|不能|不).{0,8}(?:拆|碎)/u;
  return deniesVocabulary.test(text) || deniesChunking.test(text);
}

export function classifyTeachDemoLine(rawText: string): TeachDemoReply['outcome'] {
  const text = compact(rawText);
  if (questionsOneToOneRule(text) || deniesVocabularyRule(text)) return 'needs-example';
  if (defendsOneToOneRule(text)) return 'adopted';
  if (rejectsOneToOneRule(text)) return 'corrected';
  if (adoptsOneToOneRule(text)) return 'adopted';
  if (explainsVocabularyRule(text)) return 'corrected';
  return 'needs-example';
}

export function createTeachDemoReply(rawText: string): TeachDemoReply {
  const outcome = classifyTeachDemoLine(rawText);
  if (outcome === 'corrected') {
    return {
      outcome,
      text: DEMO.correctedStudentLine,
      mood: 'aha',
      status: '误区已纠正',
      evidence: '老师明确否定“一字一块”，并把判断依据拉回词表。',
    };
  }
  if (outcome === 'adopted') {
    return {
      outcome,
      text: DEMO.adoptedStudentLine,
      mood: 'confused',
      status: '误区被带偏',
      evidence: '小白把“一字一块”当成了结论，后续会在赴考中暴露。',
    };
  }
  return {
    outcome,
    text: DEMO.needsExampleStudentLine,
    mood: 'curious',
    status: '小白继续追问',
    evidence: '这一轮还没有说清决定 Token 切法的依据。',
  };
}

export function getTeachJourneySnapshot(outcome: TeachDemoOutcome): TeachJourneySnapshot {
  if (outcome === 'corrected') {
    return {
      branch: 'passed',
      exam: {
        mood: 'proud',
        whisper: '我刚才已经转过来了：模型看到的是词表切出的 Token，不是一个个字母。所以得先看 strawberry 被切成了什么块。',
        verdict: '答稳了 · 能把表面字母和模型实际看到的 Token 区分开',
      },
      review: {
        title: '纠正后的讲法，在考场通过了检验',
        note: '纠正分支回放',
        resultLabel: '本题判定',
        resultValue: '答稳',
        resultUnit: '',
        resultSummary: 'Token 题已能独立说明原因。',
        findingLabel: '已纠正误区',
        findingTitle: '一个字或单词不等于一个 Token',
        findingEvidence: '老师当场否定“一字一块”，小白赴考时能把判断依据拉回词表。',
        action: '无需进入这个盲区的补学路径',
        events: [
          ['讲解', '小白追问“是不是一字一块”'],
          ['纠错', '老师否定一一对应，并用常见词与生僻词对比'],
          ['赴考', '小白独立用词表与 Token 解释了失败原因'],
        ],
      },
      remedy: {
        title: '已经讲明白：这里变成巩固加练',
        note: '可选加练',
        output: '这个盲区已纠正。再做一道迁移题，确认不是只记住了原句。',
      },
      reteach: {
        title: '无需返工，改做一次迁移复述',
        banner: '刚才的误区已在赴考中验证纠正，这一轮用新例子巩固。',
        result: '纠错结果已沿用到后续阶段',
      },
    };
  }
  if (outcome === 'adopted') {
    return {
      branch: 'failed',
      exam: { mood: 'thinking', whisper: DEMO.examWhisper, verdict: '还没答稳 · 对应要点：哪些词切得整，哪些词切得碎' },
      review: {
        title: '小白没答稳的地方，回到这里看', note: '带偏分支回放',
        resultLabel: '随堂测验', resultValue: String(DEMO.examScore), resultUnit: '分',
        resultSummary: '1 题答稳 · 4 题留下墨痕', findingLabel: '高风险盲区',
        findingTitle: DEMO.blindSpot, findingEvidence: DEMO.blindSpotEvidence,
        action: '需要补学后重讲',
        events: [
          ['讲解', '积木块清单讲清了两个要点'],
          ['误区', '小白把“一个字一块”当成了正确答案'],
          ['赴考', '随堂测验 20 分，四个要点未答稳'],
        ],
      },
      remedy: { title: DEMO.remedyTitle, note: '三步走完，再回讲解舱', output: '三题做完了。现在回讲解舱，用自己的话把这里重讲一遍。' },
      reteach: { title: '回到刚才讲岔的地方', banner: '上次被带偏的地方，这次要把它讲明白。', result: '误区已纠正' },
    };
  }
  return {
    branch: 'open',
    exam: { mood: 'thinking', whisper: '我还缺一个对比例子，暂时说不稳为什么不能按字母数来判断。', verdict: '暂未判定 · 先回讲解舱补齐“词表决定切法”的依据' },
    review: {
      title: '这一轮还没有形成可检验的结论', note: '待讲清分支',
      resultLabel: '本题判定', resultValue: '待定', resultUnit: '',
      resultSummary: '不把未完成的试讲冒充成正式成绩。', findingLabel: '还缺的证据',
      findingTitle: '什么决定 Token 切成几块', findingEvidence: '小白已要求用常见搭配与生僻内容做对比。',
      action: '先补一个对比例子',
      events: [['讲解', '小白提出了“一字一块”的追问'], ['追问', '当前回答还没有说清切分依据'], ['赴考', '暂不形成正式判定']],
    },
    remedy: { title: '先补一个对比例子', note: '补齐讲解依据', output: '看完常见搭配和生僻新词的对比，再回讲解舱把判断依据补完。' },
    reteach: { title: '把还没说清的依据补完', banner: '上一轮不算讲错，但缺了让小白独立判断的对比例子。', result: '等你补完这一轮' },
  };
}
