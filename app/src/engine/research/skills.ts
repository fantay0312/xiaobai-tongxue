/**
 * 技能 = 斜杠指令。每个技能是一段写好的任务书模板，把用户的一句话展开成可执行的研究流程。
 * /plan、/goal 改变这一轮的运行方式；/clear 由界面直接处理，不发给模型。
 */
import type { TurnMode } from './types';

export interface ResearchSkill {
  /** 指令名，不带斜杠 */
  name: string;
  label: string;
  hint: string;
  /** 拼音与别名，输入法没上屏时也能筛到 */
  keys: string[];
  mode: TurnMode | 'clear';
  /** 指令后面要跟的内容提示 */
  argHint: string;
  /** 没给参数时能不能直接发 */
  needsArg: boolean;
  build?: (arg: string) => string;
}

const topic = (arg: string, fallback: string) => (arg.trim() ? arg.trim() : fallback);

export const SKILLS: ResearchSkill[] = [
  {
    name: 'plan', label: '先出计划', hint: '只做计划，你批准或修改后再执行', keys: ['jihua', 'jh'], mode: 'plan', argHint: '要做的研究任务', needsArg: true,
    build: (arg) => arg.trim(),
  },
  {
    name: 'goal', label: '设定课题目标', hint: '写下目标与验收标准，之后每轮都对照它', keys: ['mubiao', 'mb'], mode: 'goal', argHint: '课题目标，可以带上验收标准', needsArg: true,
    build: (arg) => arg.trim(),
  },
  {
    name: 'survey', label: '文献综述', hint: '检索 → 筛选 → 精读 → 对比表 → survey.md', keys: ['zongshu', 'zs', 'wenxian'], mode: 'normal', argHint: '综述主题', needsArg: true,
    build: (arg) => `【技能：文献综述】主题：${arg.trim()}

按下面的流程做，每一步的产物都写进课题文件：
1. 用 update_plan 列出步骤。把主题拆成 2–4 个检索式（中英文关键词、同义词），分别 search_papers；主题较宽时可以用 spawn_workers 并行检索不同子方向。
2. 筛选：按相关性、发表年份、被引量和是否有开放全文，留下 6–12 篇；说明筛选标准，以及有多少篇被排除、为什么。
3. 精读：对留下的文献逐篇 read_paper（拿不到全文就只依据摘要，并在表里注明「仅摘要」），值得保留的用 save_paper 存入文献列表。
4. 写 notes/screening.md（检索式、命中数、筛选标准）。
5. 写 survey.md：研究背景与问题界定；一张对比表（文献 / 年份 / 问题 / 方法 / 数据 / 主要结论 / 局限 / 证据来自全文还是摘要）；按主题归纳的综述正文，每个论断后标引用 [作者 年份]；研究空白与可做的方向；局限与未覆盖的范围。
6. 引用只能来自本次检索到并读过的文献，带 DOI 或 arXiv 号；references.bib 由 save_paper 维护。
7. finish：列出产出文件与实际使用的文献。`,
  },
  {
    name: 'idea', label: '选题探索', hint: '选题矩阵 + 思维导图，比较可行性与新意', keys: ['xuanti', 'xt'], mode: 'normal', argHint: '感兴趣的方向', needsArg: true,
    build: (arg) => `【技能：选题探索】方向：${arg.trim()}

1. 用 update_plan 列步骤。先 search_papers 看这个方向近三到五年在做什么（至少两个检索式），读 3–5 篇代表性文献的摘要或全文。
2. 提出 5–8 个候选选题。每个写清：要回答的问题、为什么值得做、需要的数据与方法、一个本科生或研究生在一学期内能否完成。
3. 写 notes/topics.md：
   - 一张选题矩阵（选题 / 新意 / 可行性 / 数据可得性 / 工作量 / 风险 / 相关文献），新意和可行性用 高 / 中 / 低，并各写一句理由；
   - 一张 mermaid 思维导图（\`\`\`mermaid 代码块，mindmap 语法），从方向出发展开到子问题与选题；
   - 推荐 1–2 个选题和下一步的最小可行动作。
4. 区分哪些判断来自文献（标引用），哪些是你的推断（写明「推断」）。
5. finish。`,
  },
  {
    name: 'analyze', label: '数据分析', hint: '读取课题里的 CSV，描述、画图、写报告', keys: ['fenxi', 'fx', 'shuju'], mode: 'normal', argHint: '数据文件与想回答的问题，可用 @ 附上文件', needsArg: false,
    build: (arg) => `【技能：数据分析】${topic(arg, '分析课题 data/ 目录下的数据文件。')}

1. 用 update_plan 列步骤。先 list_files 找到数据文件；没有数据文件就用 ask_user 问用户要分析哪份数据，不要自己编造数据。
2. 用 run_python 读入数据（pandas）：行列数、字段类型、缺失值、基本统计量。先看数据再下结论。
3. 针对问题做分析：分组比较、相关性、必要时做简单的统计检验（说明用了什么检验、前提是否满足）。每次只跑一小段可验证的代码。
4. 用 matplotlib 画 2–4 张图（坐标轴和图题用英文，避免中文字体缺失），图会自动存进 figures/。
5. 把最终可复现的脚本存为 code/analysis.py（run_python 的 save_as），关键结果表存为 data/ 或 notes/ 下的 CSV / Markdown。
6. 写 report.md：数据概况、方法、结果（引用图的路径，如 ![](figures/xxx.png)，和具体数字）、结论、局限。报告里的每个数字都必须来自真实的运行输出。
7. finish。`,
  },
  {
    name: 'reproduce', label: '复现实验', hint: '最小可复现的 Python 实验 + 结果表', keys: ['fuxian', 'shiyan', 'sy'], mode: 'normal', argHint: '要复现的结论或方法', needsArg: true,
    build: (arg) => `【技能：复现实验】目标：${arg.trim()}

1. 用 update_plan 列步骤。先弄清原结论：必要时 search_papers / read_paper 找到出处，记录原文报告的设置与数字（带引用）。
2. 设计一个能在浏览器里的 Python 环境中跑完的最小实验（只能用 numpy、pandas、scipy、matplotlib，不能联网下载数据，单次运行控制在一分钟内）。原实验做不了的部分要缩小规模或用合成数据，并明确写出与原文的差别。
3. 固定随机种子，用 run_python 运行，脚本存为 code/reproduce.py。
4. 产出：data/results.csv（结果表），至少一张图，notes/reproduce.md（实验设置、与原文的差别、结果表、是否复现了原结论的定性趋势、不能下的结论）。
5. 数字只能来自运行输出。跑不通就如实写失败原因，不要补一个「看起来合理」的结果。
6. finish。`,
  },
  {
    name: 'review', label: '完整性审查', hint: '核对草稿里的论断、数字、图与引用', keys: ['shencha', 'sc', 'jiancha'], mode: 'normal', argHint: '要审查的文件，默认 report.md 或 survey.md', needsArg: false,
    build: (arg) => `【技能：完整性审查】对象：${topic(arg, '课题里的 report.md 或 survey.md（都有就先审 report.md）。')}

逐项核对，不改原文，结果写进 notes/review.md：
1. read_file 读草稿，列出其中的事实性论断、数字、图表引用和文献引用。
2. 文献：每条引用是否在课题的文献列表 / references.bib 里；对存疑的引用用 read_paper 核对原文是否支持该论断。
3. 数字：能否在 data/、notes/ 或代码输出里找到来源；必要时用 run_python 重算。
4. 图：引用的图文件是否存在，图题与正文描述是否一致。
5. 输出一张审查表（论断 / 类型 / 依据 / 结论：有依据、部分支持、无依据、无法核实），再给出修改建议清单，按严重程度排序。
6. 无法核实的就写「无法核实」，不要替作者圆。finish。`,
  },
  {
    name: 'write', label: '写作', hint: '依据课题文件写方法或相关工作一节', keys: ['xiezuo', 'xz'], mode: 'normal', argHint: '要写哪一节，如「相关工作」「方法」', needsArg: true,
    build: (arg) => `【技能：写作】要写的部分：${arg.trim()}

1. list_files 并读相关的笔记、结果和文献列表；材料不够时先说明缺什么，必要时 ask_user。
2. 只依据课题里已有的材料写：相关工作引用已保存的文献（[作者 年份]，文末列出 DOI 或 arXiv 号）；方法部分对照 code/ 里的实际脚本和 data/ 里的实际结果。
3. 学术中文，平实、准确，不夸大；每段一个要点；区分已有工作、本工作做了什么、没有做什么。
4. 写进 notes/draft-<小节名>.md；若 report.md 已存在，不要直接覆盖它，除非用户明确要求。
5. finish，并在最后列出仍需作者本人补充或核实的地方。`,
  },
  {
    name: 'clear', label: '清空会话', hint: '开始一段新的会话，课题文件保留', keys: ['qingkong', 'qk', 'new'], mode: 'clear', argHint: '', needsArg: false,
  },
];

export interface ParsedInput {
  skill: ResearchSkill | null;
  arg: string;
}

/** 解析输入开头的斜杠指令；不是已知指令时按普通内容处理 */
export function parseInput(input: string): ParsedInput {
  const match = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return { skill: null, arg: input.trim() };
  const skill = SKILLS.find((item) => item.name === match[1].toLowerCase()) ?? null;
  return skill ? { skill, arg: (match[2] ?? '').trim() } : { skill: null, arg: input.trim() };
}

/** 输入只有「/xxx」时取出筛选词，用来开斜杠菜单 */
export function slashQuery(input: string): string | null {
  const match = /^\/(\S*)$/.exec(input);
  return match ? match[1].toLowerCase() : null;
}

export function matchSkills(query: string): ResearchSkill[] {
  if (!query) return SKILLS;
  return SKILLS.filter((skill) => skill.name.startsWith(query) || skill.label.includes(query) || skill.keys.some((key) => key.startsWith(query)));
}

/** 首次使用的四个起步任务 */
export const STARTERS: { title: string; hint: string; fill: string }[] = [
  { title: '文献综述', hint: '检索、筛选、精读，写成带引用的 survey.md', fill: '/survey 大语言模型在教育测评中的应用' },
  { title: '选题探索', hint: '列出候选选题，比较新意与可行性', fill: '/idea 图神经网络在交通流量预测中的应用' },
  { title: '数据分析', hint: '读入 CSV，描述、画图、写报告', fill: '/analyze 分析 data/ 里的数据：各组均值有没有显著差异' },
  { title: '复现一个结果', hint: '写一个最小可复现的 Python 实验', fill: '/reproduce 用蒙特卡洛模拟验证中心极限定理：样本量增大时样本均值的分布趋于正态' },
];
