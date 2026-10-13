import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BookOpen, Check, ChevronDown, GraduationCap, Route, Search, Users, type LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui';
import { useAppStore } from '../../store/appStore';
import { nextStep } from '../../engine/journey';
import type { LearningIdentity } from '../../engine/learningIdentity';
import type { Topic } from '../../types';
import s from './welcome.module.css';

/** 拜师帖：纸质物件，data-story 让它回到老学堂的纸墨与楷体 */
export function Apprenticeship({ identity, onAccept }: { identity: LearningIdentity; onAccept: () => void }) {
  const [open, setOpen] = useState(false);
  const accepted = Boolean(identity.acceptedAt);
  return (
    <section className={s.letter} data-story aria-label="小白的拜师帖">
      <div className={s.letterStrip}>
        <span className={s.seal} aria-hidden="true">白</span>
        <div className={s.letterLead}>
          <strong>{accepted ? '师徒约定已收好' : '小白给你留了一封拜师帖'}</strong>
          <p>{accepted ? '你来探索，我来追问；把一知半解，一起变成真正明白。' : '“先生，等你学懂了，可以讲给我听吗？”'}</p>
        </div>
        <button type="button" className={s.letterToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? '收起信笺' : accepted ? '重读拜师帖' : '拆开看看'}
          <ChevronDown size={15} strokeWidth={1.75} data-open={open || undefined} />
        </button>
      </div>
      {open && (
        <div className={s.letterBody}>
          <p className={s.salute}>先生台鉴：</p>
          <p>小生小白，一个什么都想学明白的 AI 学徒。听说，能把一件事讲清楚的人，才算真正懂得它，所以冒昧递上这封拜师帖。</p>
          <p>你可以先跟小砚读书、提问、做练习，慢慢把知识弄懂。不必急着站上讲台。准备好时，再把它讲给我听；我会认真追问，也会说出自己的误解。</p>
          <p>若有一天，我也能把学到的道理讲给别人听，那里面一定有你教给我的那句话。</p>
          <div className={s.letterSignature}>学徒 小白 敬上</div>
          {accepted ? (
            <span className={s.accepted}>
              <Check size={14} strokeWidth={2} />
              已收下 · {new Date(identity.acceptedAt!).toLocaleDateString('zh-CN')}
            </span>
          ) : (
            <button type="button" className={s.acceptButton} onClick={onAccept}>
              <Check size={15} strokeWidth={2} />
              收下拜师帖
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface Stage {
  title: string;
  description: string;
  icon: LucideIcon;
  done: boolean;
  cta: string;
  action?: () => void;
  to?: string | null;
}

export function FeynmanJourney({ topic, topics, onLearn }: { topic?: Topic; topics: Topic[]; onLearn: () => void }) {
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const latest = [...reports].reverse().find((report) => !topic || report.topicId === topic.topicId);
  const scopedEvents = events.filter((event) => !topic || event.topicId === topic.topicId);
  const recommended = nextStep({ events, reports, topicStates, topics });
  const stages: Stage[] = [
    { title: '先学懂', description: '读材料、问问题，搭起自己的理解。', icon: BookOpen, done: scopedEvents.some((event) => event.type === 'prep_completed'), action: onLearn, cta: topic ? '回到讲义' : '选择课程' },
    { title: '讲给小白', description: '用自己的话说，让小白追问到你讲清楚。', icon: Users, done: scopedEvents.some((event) => event.type === 'checklist_hit'), to: topic ? `/teach/${topic.topicId}` : null, cta: '试着讲清楚' },
    { title: '让它独立作答', description: '小白离开你的提示，检验自己学会了什么。', icon: GraduationCap, done: scopedEvents.some((event) => event.type === 'xiaobai_quiz_scored'), to: latest ? `/exam/${latest.sessionId}` : null, cta: '查看小白答卷' },
    { title: '找到理解缺口', description: '对照讲解反馈，找到含糊和遗漏。', icon: Search, done: Boolean(latest), to: latest ? `/review/${latest.sessionId}` : null, cta: '打开学习反馈' },
    { title: '补学，再讲一遍', description: '带着新理解回来，把卡住的地方讲顺。', icon: Route, done: scopedEvents.some((event) => event.type === 'review_passed' || event.type === 'topic_mastered'), to: latest ? `/review/${latest.sessionId}` : null, cta: '继续巩固' },
  ];
  return (
    <section className={s.journey} aria-label="费曼学习旅程">
      <header className={s.journeyHead}>
        <div>
          <h2>把知识讲明白，是更深的一次学习。</h2>
          <p>费曼学习法不是背出答案，而是把道理讲到另一个人真正听懂。</p>
        </div>
        <span className={s.journeyMotto}>教然后知困</span>
      </header>
      <ol className={s.stageList}>
        {stages.map((stage, index) => (
          <li key={stage.title} data-done={stage.done || undefined}>
            <span className={s.stageNumber}>{stage.done ? <Check size={14} strokeWidth={2.25} /> : index + 1}</span>
            <div className={s.stageBody}>
              <h3><stage.icon size={15} strokeWidth={1.75} />{stage.title}</h3>
              <p>{stage.description}</p>
              {stage.action ? (
                <button type="button" className={s.stageLink} onClick={stage.action}>{stage.cta}<ArrowRight size={14} strokeWidth={1.75} /></button>
              ) : stage.to ? (
                <Link className={s.stageLink} to={stage.to}>{stage.cta}<ArrowRight size={14} strokeWidth={1.75} /></Link>
              ) : (
                <span className={s.stageHint}>{index === 1 ? '打开一门课后可以开始' : '完成讲解后，在这里继续'}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {events.length > 0 && (
        <div className={s.nextStep}>
          <Route size={17} strokeWidth={1.75} />
          <p>{recommended.line}</p>
          <Button asChild variant="soft" size="sm" iconRight={<ArrowRight size={14} strokeWidth={1.75} />}>
            <Link to={recommended.to}>{recommended.cta}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

export function StudyJourney({ topic, topics, identity, onAccept, onLearn }: {
  topic?: Topic; topics: Topic[]; identity: LearningIdentity; onAccept: () => void; onLearn: () => void;
}) {
  return (
    <div className={s.journeyPage}>
      <h1>你和小白的学习旅程</h1>
      <p className={s.journeyIntro}>先拥有自己的理解，再把它讲给另一个人听。每一次追问，都是查漏补缺的机会。</p>
      <Apprenticeship identity={identity} onAccept={onAccept} />
      <FeynmanJourney topic={topic} topics={topics} onLearn={onLearn} />
    </div>
  );
}
