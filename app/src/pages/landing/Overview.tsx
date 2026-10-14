/**
 * 产品全景：首屏之后、第一章之前。
 * 上半是一条学习闭环（读懂 → 练熟 → 讲给小白 → 记住 → 回到读懂），每一步写明用到哪些板块；
 * 下半是全部板块的索引，点一项滚到讲它的那一章。
 * 桌面四步横排、底部一条回环线；窄屏改成竖向时间线。只是静态陈列，不引入任何运行时模块。
 */
import type { ComponentType } from 'react';
import { ArrowDown, ArrowRight, MoonStar, Mic, Palette, RotateCcw, Smartphone, Telescope } from 'lucide-react';
import {
  IconAgent, IconChat, IconClassroom, IconGrowth, IconGuide, IconLibrary, IconMemory, IconRead, IconResearch, IconTeach, IconWorkbench,
} from '../../components/ui/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { scrollToSection, sectionById } from './sections';
import base from './landing.module.css';
import o from './overview.module.css';

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

interface Stage {
  name: string;
  text: string;
  modules: readonly string[];
  /** 模块按先后走（教小白的四站），中间画箭头 */
  flow?: boolean;
  detail?: string;
}

const STAGES: readonly Stage[] = [
  {
    name: '读懂',
    text: '问小砚、跟着带我学、读讲义；选了资料，回答只依据资料。',
    modules: ['对话', '互动回答', '带我学', '读讲义', '资料库', '深入答疑'],
  },
  {
    name: '练熟',
    text: '整理成笔记、导图、题目和闪卡反复练，也能交给助理或 AI 课堂。',
    modules: ['工作台', 'AI 课堂', '助理任务'],
    detail: '工作台：笔记 · 思维导图 · 题目集 · 闪卡 · 待办 · 作文与翻译',
  },
  {
    name: '讲给小白',
    text: '讲给只问不教的小白听，卡住的地方就是还没懂的地方。',
    modules: ['备课', '上课', '赴考', '批注复盘'],
    flow: true,
  },
  {
    name: '记住',
    text: '小砚记住你，小白记住你教过的课；做梦整理记忆，成长册记下每一课。',
    modules: ['记忆库', '做梦', '成长册'],
  },
];

interface Module {
  name: string;
  text: string;
  /** 讲它的那一章，对应 sections.ts 的 id */
  chapter: string;
  icon: IconType;
}

const MODULES: readonly Module[] = [
  { name: '对话', text: '问小砚；回答可变成小测、对比表或翻面卡。', chapter: 'learn', icon: IconChat },
  { name: '带我学', text: '按概念、例子、自测、反思一步步走，可随时插问。', chapter: 'learn', icon: IconGuide },
  { name: '读讲义', text: '读排好版的讲义，看不懂的例子请小砚细讲。', chapter: 'learn', icon: IconRead },
  { name: '资料库', text: '文件上传一次、解析一次，课程和对话都能直接用。', chapter: 'learn', icon: IconLibrary },
  { name: '深入答疑', text: 'DeepTutor 多轮核对所选资料再作答，耗时更长。', chapter: 'learn', icon: Telescope },
  { name: '教小白', text: '备课、上课、赴考、批注复盘，四站讲给小白听。', chapter: 'teach', icon: IconTeach },
  { name: '成长册', text: '科名五阶、成就印章和教学编年史。', chapter: 'teach', icon: IconGrowth },
  { name: '工作台', text: '笔记、思维导图、题目集、闪卡、待办、作文与翻译。', chapter: 'practice', icon: IconWorkbench },
  { name: 'AI 课堂', text: '一键生成一堂课，多角色授课，可导出 PPTX。', chapter: 'delegate', icon: IconClassroom },
  { name: '助理任务', text: '交给小砚去办；定时任务只在应用打开时运行。', chapter: 'delegate', icon: IconAgent },
  { name: '科研台', text: '检索真实文献，在浏览器里跑 Python，写成报告。', chapter: 'research', icon: IconResearch },
  { name: '记忆库', text: '小砚和小白各一棵记忆树，每条带出处和日期。', chapter: 'memory', icon: IconMemory },
  { name: '做梦', text: '把记忆重新过一遍：合并重复、归档过时，可撤销。', chapter: 'memory', icon: MoonStar },
  { name: '实时语音', text: '听写边说边出字，回答也可以朗读。', chapter: 'anywhere', icon: Mic },
  { name: '皮肤与个性化', text: '八套皮肤，强调色、圆角、字体、壁纸都可调。', chapter: 'anywhere', icon: Palette },
  { name: '手机上的终端', text: '侧栏收进抽屉，常用板块放在底栏。', chapter: 'anywhere', icon: Smartphone },
];

function LoopStage({ stage, index }: { stage: Stage; index: number }) {
  const last = index === STAGES.length - 1;
  return (
    <li className={o.step}>
      <span className={o.stepNo} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div className={o.card}>
        <h3 className={o.stepName}>
          <span className={o.srOnly}>第 {index + 1} 步：</span>
          {stage.name}
        </h3>
        <p className={o.stepText}>{stage.text}</p>
        <div className={o.foot}>
          <ul className={o.mods} aria-label={`${stage.name}用到的板块`} data-flow={stage.flow || undefined}>
            {stage.modules.map((name, i) => (
              <li key={name}>
                {stage.flow && i > 0 && <ArrowRight size={12} strokeWidth={2} className={o.modArrow} aria-hidden="true" />}
                <span className={o.mod}>{name}</span>
              </li>
            ))}
          </ul>
          {stage.detail && <p className={o.detail}>{stage.detail}</p>}
        </div>
      </div>
      {!last && (
        <span className={o.next} aria-hidden="true">
          <ArrowRight size={14} strokeWidth={2} />
        </span>
      )}
    </li>
  );
}

function ModuleItem({ item, smooth }: { item: Module; smooth: boolean }) {
  const chapter = sectionById(item.chapter);
  const Icon = item.icon;
  return (
    <li>
      <button type="button" className={o.entry} onClick={() => scrollToSection(chapter.id, smooth)}>
        <Icon size={20} strokeWidth={1.75} className={o.entryIcon} />
        <span className={o.entryName}>{item.name}</span>
        <span className={o.entryNo}>
          <span className={o.srOnly}>，见第</span>
          {chapter.no}
          <span className={o.srOnly}>章「{chapter.label}」</span>
          <ArrowDown size={13} strokeWidth={2} className={o.entryArrow} aria-hidden="true" />
        </span>
        <span className={o.entryText}>{item.text}</span>
      </button>
    </li>
  );
}

export function Overview() {
  const meta = sectionById('overview');
  const reducedMotion = useReducedMotion();
  const title = '从读懂到讲会，都在一个终端里';

  return (
    <section id={meta.id} className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="overview-title">
      <div className={base.wrap}>
        <header data-reveal>
          <div className={base.chapterMark}>
            <span className={o.eyebrow}>{meta.label}</span>
            <span className={base.chapterRule} aria-hidden="true" />
          </div>
          <h2 id="overview-title" className={base.chapterTitle}>
            {title.split('，').map((clause, index, all) => (
              <span key={clause} className={base.chapterClause}>
                {index < all.length - 1 ? `${clause}，` : clause}
              </span>
            ))}
          </h2>
          <p className={base.chapterLead}>
            学习按读懂、练熟、讲给小白、记住四步走成一圈；下面每个板块都能点，直接跳到讲它的那一章。
          </p>
        </header>

        <div className={o.loop} data-reveal>
          <ol className={o.steps} aria-label="学习闭环">
            {STAGES.map((stage, index) => <LoopStage key={stage.name} stage={stage} index={index} />)}
          </ol>
          <div className={o.back}>
            <span className={o.backRail} aria-hidden="true" />
            <p className={o.backLabel}>
              <span className={o.backIcon} aria-hidden="true"><RotateCcw size={14} strokeWidth={2} /></span>
              <span>回到读懂：下一轮对话，小砚带着这些记忆作答</span>
            </p>
          </div>
        </div>

        <div className={o.dir}>
          <div className={o.dirHead} data-reveal>
            <h3 id="overview-modules" className={o.dirTitle}>全部板块</h3>
            <p className={o.dirHint}>右侧数字是讲它的章节，点一项直接跳过去。</p>
          </div>
          <ul className={o.entries} aria-labelledby="overview-modules" data-reveal>
            {MODULES.map((item) => <ModuleItem key={item.name} item={item} smooth={!reducedMotion} />)}
          </ul>
        </div>
      </div>
    </section>
  );
}
