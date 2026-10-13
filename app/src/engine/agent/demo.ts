/**
 * 本地演示：没有可用模型时，按课程资料用固定步骤跑一遍同样的工具
 * （检索 → 笔记 → 思维导图 → 闪卡 → 题目 → 待办），成果真实写进工作台。
 * 内容全部摘自资料，不做生成；界面上标为「本地演示」。
 */
import { newId } from '../../store/studyData';
import type { Topic } from '../../types';
import { sleep, type LoopResult } from './loop';
import type { Material } from './retrieval';
import { localDate } from './schedules';
import { laneBoard, lanesOutcome } from './subagents';
import { executeTool, type LaneReporter, type SubAgentTask, type ToolContext, type ToolOutcome } from './tools';
import type { RunOptions } from './types';

type Args = Record<string, unknown>;

interface Fact {
  term: string;
  text: string;
}

export interface DemoPlan {
  subject: string;
  facts: Fact[];
  /** 工具名 → 预先备好的参数 */
  calls: Record<string, Args>;
}

export interface DemoDriver {
  goal: string;
  options: RunOptions;
  plan: DemoPlan;
  signal: AbortSignal;
  think: (text: string) => Promise<void>;
  say: (text: string) => Promise<void>;
  /** 走与模型相同的工具执行路径（会出现在时间线上） */
  call: (name: string, args: Args) => Promise<ToolOutcome>;
}

const plain = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
const sentences = (value: string) => value.split(/(?<=[。！？!?；;])\s*|\n+/).map((part) => part.trim()).filter(Boolean);
const brief = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** 从课程的知识卡片取要点；自建课程没有卡片时，从资料正文按小标题或句子摘 */
function collectFacts(topic: Topic | undefined, materials: Material[]): Fact[] {
  const fromChecklist = (topic?.checklist ?? []).flatMap((item): Fact[] => {
    const card = item.lookupCard?.trim() ?? '';
    // 卡片第一行是加粗标题，正文从第二段开始
    const body = plain(card.replace(/^\*\*[^\n]*\*\*\s*/, '')) || plain(item.groundTruth ?? '');
    return item.point && body ? [{ term: item.point, text: body }] : [];
  });
  if (fromChecklist.length >= 2) return fromChecklist.slice(0, 8);

  const facts: Fact[] = [];
  for (const material of materials) {
    const sections = material.content.split(/\n(?=#{1,4}\s)/);
    for (const section of sections) {
      const heading = /^#{1,4}\s+(.+)$/m.exec(section)?.[1]?.replace(/[*_`]/g, '').trim();
      const body = sentences(plain(section.replace(/^#{1,4}\s+.+$/m, ''))).filter((line) => line.length >= 12);
      if (heading && body.length) facts.push({ term: brief(heading, 20), text: body.slice(0, 2).join('') });
    }
    if (facts.length >= 8) break;
  }
  if (facts.length >= 2) return facts.slice(0, 8);

  // 没有小标题：直接挑信息量够的句子
  for (const material of materials) {
    for (const line of sentences(plain(material.content))) {
      if (line.length < 16 || line.length > 140) continue;
      const term = line.split(/[，,：:（(]|是|指/)[0].trim();
      if (term.length >= 2 && term.length <= 16 && !facts.some((fact) => fact.term === term)) facts.push({ term, text: line });
      if (facts.length >= 8) return facts;
    }
  }
  return facts;
}

function buildQuestions(topic: Topic | undefined, facts: Fact[]): Args[] {
  const bank = (topic?.quizBank ?? []).filter((item) => item.options.length >= 2).slice(0, 6);
  if (bank.length >= 2) {
    return bank.map((item, index) => ({
      type: 'single',
      stem: item.code ? `${item.question}\n\n\`\`\`\n${item.code}\n\`\`\`` : item.question,
      options: item.options,
      answer: String.fromCharCode(65 + item.answerIndex),
      explanation: item.explanation,
      difficulty: index < 2 ? 1 : index < 4 ? 2 : 3,
    }));
  }
  return facts.slice(0, 6).map((fact, index) => (fact.text.includes(fact.term)
    ? { type: 'blank', stem: `填空：${fact.text.replace(fact.term, '____')}`, answer: fact.term, explanation: `资料原文：${fact.text}`, difficulty: 1 }
    : { type: 'short', stem: `不看资料，用自己的话讲清楚「${fact.term}」。`, answer: fact.text, explanation: '对照参考答案，看看自己漏了哪一步。', difficulty: index < 3 ? 2 : 3 }));
}

export function buildDemoPlan(goal: string, topic: Topic | undefined, materials: Material[]): DemoPlan {
  const subject = topic?.title ?? materials[0]?.title ?? brief(goal.replace(/\s+/g, ' '), 18);
  const facts = collectFacts(topic, materials);
  const today = new Date();
  const dayAfter = (days: number) => localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  const traps = (topic?.misconceptions ?? []).slice(0, 3);
  const selfCheck = topic?.prep.selfCheck?.slice(0, 3) ?? [];

  if (!facts.length) {
    // 没有任何资料：只搭一个提纲和几项待办，不编内容
    return {
      subject,
      facts,
      calls: {
        save_note: {
          title: `${subject} · 任务提纲`,
          body: [
            '> 本地演示：当前没有可用模型，也没有打开课程或勾选资料，所以这里只按你的目标搭好提纲，没有填入内容。',
            `## 目标\n${goal}`,
            '## 建议的做法\n1. 打开一门课，或在资料栏勾选要用的资料。\n2. 回到助理任务，重新运行这个目标。\n3. 成果会写进笔记、题目集和闪卡。',
          ].join('\n\n'),
          tags: ['本地演示'],
        },
        add_todos: { items: [{ text: '打开一门课或勾选资料，再重新运行这个助理任务', due: dayAfter(0) }] },
      },
    };
  }

  const note = [
    '> 本地演示：当前没有可用模型，以下内容直接摘自课程资料，没有经过改写。',
    '## 核心要点',
    ...facts.map((fact, index) => `### ${index + 1}. ${fact.term}\n${fact.text}`),
    ...(traps.length ? ['## 容易想错的地方', traps.map((trap) => `- **误区**：${trap.belief}${trap.correctionCriteria[0] ? `\n  **应该是**：${trap.correctionCriteria[0]}` : ''}`).join('\n')] : []),
    '## 自测',
    (selfCheck.length ? selfCheck : facts.slice(0, 3).map((fact) => `不看资料，讲一遍「${fact.term}」。`)).map((line) => `- ${line}`).join('\n'),
  ].join('\n\n');

  const outline = [
    ...facts.map((fact) => ({
      text: brief(fact.term, 14),
      children: sentences(fact.text).slice(0, 2).map((line) => ({ text: brief(line.replace(/[。；;！!？?]$/, ''), 18) })),
    })),
    ...(traps.length ? [{ text: '容易想错', children: traps.map((trap) => ({ text: brief(trap.belief, 18) })) }] : []),
  ];

  const deckTitle = `${subject} · 闪卡`;
  const quizTitle = `${subject} · 练习`;
  return {
    subject,
    facts,
    calls: {
      save_note: { title: `${subject} · 要点整理`, body: note, tags: ['本地演示'] },
      create_mindmap: { title: subject, outline },
      create_flashcards: { title: deckTitle, cards: facts.map((fact) => ({ front: `讲一讲：${fact.term}`, back: brief(sentences(fact.text).slice(0, 2).join(''), 160) })) },
      create_quiz_set: { title: quizTitle, questions: buildQuestions(topic, facts) },
      add_todos: {
        items: [
          { text: `读一遍笔记《${subject} · 要点整理》`, due: dayAfter(0) },
          { text: `做完《${quizTitle}》并订正错题`, due: dayAfter(0) },
          { text: `复习闪卡《${deckTitle}》`, due: dayAfter(1) },
          { text: `把「${subject}」讲给小白听`, due: dayAfter(1) },
        ],
      },
    },
  };
}

/** 本地演示的子代理：两条泳道各自执行备好的写入工具，走真实的工具执行路径 */
export async function runDemoSubAgents(tasks: SubAgentTask[], ctx: ToolContext, report: LaneReporter, plan: DemoPlan): Promise<ToolOutcome> {
  const board = laneBoard(tasks, report);
  const subCtx: ToolContext = { owner: ctx.owner, topic: ctx.topic, materials: ctx.materials, signal: ctx.signal };
  await Promise.all(tasks.map(async (task, index) => {
    await sleep(260 + index * 340, ctx.signal);
    board.update(index, () => ({ status: 'running' }));
    const titles: string[] = [];
    for (const name of task.tools) {
      const args = plan.calls[name];
      if (!args) continue;
      board.update(index, (lane) => ({ trail: [...lane.trail, name], steps: lane.steps + 1 }));
      await sleep(620 + index * 180, ctx.signal);
      const outcome = await executeTool({ id: newId(), name, arguments: JSON.stringify(args) }, subCtx, new Set(task.tools));
      if (outcome.produced?.length) {
        titles.push(...outcome.produced.map((item) => `《${item.title}》`));
        board.update(index, (lane) => ({ produced: [...lane.produced, ...(outcome.produced ?? [])] }));
      }
    }
    board.update(index, () => ({ status: 'done', result: titles.length ? `已写入 ${titles.join('、')}。` : '没有可写入的内容。' }));
  }));
  return lanesOutcome(board.all());
}

export async function runDemo(driver: DemoDriver): Promise<LoopResult> {
  const { plan, options, signal } = driver;
  const { calls } = plan;
  const hasContent = plan.facts.length > 0;
  const stages = hasContent
    ? ['检索课程资料', '整理要点笔记与思维导图', '准备闪卡和练习题', '安排后续待办']
    : ['检查可用资料', '搭好任务提纲', '安排后续待办'];
  let done = 0;
  const checkpoint = async (count: number) => {
    done = count;
    if (options.goalMode) await driver.call('update_goal', { items: stages.map((text, index) => ({ text, done: index < done })) });
  };
  let steps = 0;
  const call = async (name: string) => {
    if (!calls[name]) return;
    steps += 1;
    await driver.call(name, calls[name]);
  };

  await driver.think(hasContent
    ? `没有接入模型，这次按固定步骤做本地演示：先检索「${plan.subject}」的资料，把要点整理成笔记和思维导图，再从资料里摘出闪卡和练习题，最后排几项待办。内容全部来自课程资料。`
    : '没有接入模型，也没有找到可用的资料。这次只把目标整理成提纲和待办，不编造内容。');
  await checkpoint(0);

  await driver.call('search_materials', { query: plan.subject });
  await checkpoint(1);

  if (hasContent && options.subagents) {
    await driver.say('要点笔记和练习互不依赖，交给两个子代理并行处理。');
    steps += 1;
    await driver.call('spawn_subagents', {
      tasks: [
        { title: '梳理要点', brief: `把「${plan.subject}」的核心要点整理成一篇笔记，并画一张思维导图。`, tools: ['save_note', 'create_mindmap'] },
        { title: '准备练习', brief: `围绕「${plan.subject}」做一组闪卡和一套练习题。`, tools: ['create_flashcards', 'create_quiz_set'] },
      ],
    });
    await checkpoint(3);
  } else {
    await call('save_note');
    await call('create_mindmap');
    await checkpoint(2);
    await call('create_flashcards');
    await call('create_quiz_set');
    if (hasContent) await checkpoint(3);
  }

  await call('add_todos');
  await checkpoint(stages.length);
  await sleep(240, signal);

  const summary = hasContent
    ? `本地演示完成：已把「${plan.subject}」的资料整理成一篇笔记、一张思维导图、${plan.facts.length} 张闪卡和一套练习题，并排了几项待办，都写进了学习工作台。内容直接摘自课程资料；接入模型后，助理会按你的目标检索、改写并逐步推进。`
    : '本地演示完成：没有可用的模型和资料，只把目标整理成了一份提纲和一项待办。打开一门课或勾选资料后再运行，会得到完整的笔记、闪卡和练习。';
  await driver.call('finish', { summary });
  return { stop: 'finished', steps: steps + 2, summary };
}
