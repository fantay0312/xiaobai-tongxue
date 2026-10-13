import { useState } from 'react';
import { Link } from 'react-router';
import { useAppStore } from '../../store/appStore';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { XiaoyanPet } from '../../components/coach/XiaoyanPet';
import { Icon } from '../../components/ui/Icon';
import { nextStep } from '../../engine/journey';
import type { LearningIdentity } from '../../engine/learningIdentity';
import type { Topic } from '../../types';
import s from './welcome.module.css';

export function Apprenticeship({ identity, onAccept }: { identity: LearningIdentity; onAccept: () => void }) {
  const [open, setOpen] = useState(false);
  return <section className={s.apprenticeship} aria-label="小白的拜师帖">
    <div className={s.letterStrip}><span className={s.seal} aria-hidden="true">白</span><div><strong>{identity.acceptedAt ? '师徒约定已收好' : '小白给你留了一封拜师帖'}</strong><p>{identity.acceptedAt ? '你来探索，我来追问；把一知半解，一起变成真正明白。' : '“先生，等你学懂了，可以讲给我听吗？”'}</p></div><button className={s.textButton} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '收起信笺' : identity.acceptedAt ? '重读拜师帖' : '拆开看看'}<Icon name="chevron-down" size={15} /></button></div>
    {open && <div className={s.letterBody}>
      <p className={s.salute}>先生台鉴：</p><p>小生小白，一个什么都想学明白的 AI 学徒。听说，能把一件事讲清楚的人，才算真正懂得它，所以冒昧递上这封拜师帖。</p><p>你可以先跟小砚读书、提问、做练习，慢慢把知识弄懂。不必急着站上讲台。准备好时，再把它讲给我听；我会认真追问，也会说出自己的误解。</p><p>若有一天，我也能把学到的道理讲给别人听，那里面一定有你教给我的那句话。</p><div className={s.letterSignature}>学徒 小白 敬上</div>{!identity.acceptedAt && <button className={s.primary} onClick={onAccept}><Icon name="check" size={15} />收下拜师帖</button>}{identity.acceptedAt && <span className={s.accepted}><Icon name="check" size={14} />已收下 · {new Date(identity.acceptedAt).toLocaleDateString('zh-CN')}</span>}
    </div>}
  </section>;
}

export function FeynmanJourney({ topic, topics, onLearn, compact = false }: { topic?: Topic; topics: Topic[]; onLearn: () => void; compact?: boolean }) {
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const latest = [...reports].reverse().find((report) => !topic || report.topicId === topic.topicId);
  const scopedEvents = events.filter((event) => !topic || event.topicId === topic.topicId);
  const recommended = nextStep({ events, reports, topicStates, topics });
  const stages = [
    { title: '先学懂', description: '读材料、问问题，搭起自己的理解。', icon: 'book-open', done: scopedEvents.some((event) => event.type === 'prep_completed'), action: onLearn, cta: topic ? '回到讲义' : '选择课程' },
    { title: '讲给小白', description: '用自己的话说，让小白追问到你讲清楚。', icon: 'users-round', done: scopedEvents.some((event) => event.type === 'checklist_hit'), to: topic ? `/teach/${topic.topicId}` : null, cta: '试着讲清楚' },
    { title: '让它独立作答', description: '小白离开你的提示，检验自己学会了什么。', icon: 'graduation', done: scopedEvents.some((event) => event.type === 'xiaobai_quiz_scored'), to: latest ? `/exam/${latest.sessionId}` : null, cta: '查看小白答卷' },
    { title: '找到理解缺口', description: '对照讲解反馈，找到含糊和遗漏。', icon: 'search', done: Boolean(latest), to: latest ? `/review/${latest.sessionId}` : null, cta: '打开学习反馈' },
    { title: '补学，再讲一遍', description: '带着新理解回来，把卡住的地方讲顺。', icon: 'route', done: scopedEvents.some((event) => event.type === 'review_passed' || event.type === 'topic_mastered'), to: latest ? `/review/${latest.sessionId}` : null, cta: '继续巩固' },
  ] as const;
  return <section className={`${s.journey} ${compact ? s.compactJourney : ''}`} aria-label="费曼学习旅程">
    <header><div><h2>{compact ? '学懂之后，还有更深的一步。' : '把知识讲明白，是更深的一次学习。'}</h2><p>费曼学习法不是背出答案，而是把道理讲到另一个人真正听懂。</p></div><span className={s.journeyMotto}>教然后知困</span></header>
    <ol className={s.stageList}>{stages.map((stage, i) => <li key={stage.title} data-done={stage.done || undefined}><span className={s.stageNumber}>{stage.done ? <Icon name="check" size={14} /> : String(i + 1).padStart(2, '0')}</span><div><h3>{stage.title}</h3><p>{stage.description}</p>{!compact && ('action' in stage ? <button className={s.textButton} onClick={stage.action}>{stage.cta}<Icon name="arrow-right" size={14} /></button> : stage.to ? <Link className={s.textButton} to={stage.to}>{stage.cta}<Icon name="arrow-right" size={14} /></Link> : <span className={s.stageHint}>{i === 1 ? '选择课程后可以开始' : '完成讲解后，在这里继续'}</span>)}</div></li>)}</ol>
    {!compact && events.length > 0 && <div className={s.nextStep}><Icon name="route" size={17} /><p>{recommended.line}</p><Link to={recommended.to} className={s.textButton}>{recommended.cta}<Icon name="arrow-right" size={14} /></Link></div>}
  </section>;
}

export function StudyJourney({ topic, topics, identity, onAccept, onLearn }: { topic?: Topic; topics: Topic[]; identity: LearningIdentity; onAccept: () => void; onLearn: () => void }) {
  return <div className={s.journeyPage}><h1>你和小白的学习旅程</h1><p>先拥有自己的理解，再把它讲给另一个人听。每一次追问，都是查漏补缺的机会。</p><Apprenticeship identity={identity} onAccept={onAccept} /><FeynmanJourney topic={topic} topics={topics} onLearn={onLearn} /></div>;
}

export function StudyWelcome({ topics, identity, onAccept, onSelectCourse, onLibrary, onJourney }: {
  topics: Topic[]; identity: LearningIdentity; onAccept: () => void; onSelectCourse: (id?: string) => void; onLibrary: () => void; onJourney: () => void;
}) {
  const level = useAppStore((state) => state.global.learningLevel);
  const lastTopic = topics.find((topic) => topic.topicId === identity.lastTopicId && !topic.locked);
  return <div className={s.welcome}>
    <section className={s.hero}>
      <div className={s.heroText}><h1>今天，学懂一件事。</h1><p>课程在左手边，两位学习伙伴在身旁。<br />先和小砚把知识弄懂，再试着讲给小白听。</p><div className={s.heroActions}><button className={s.primary} onClick={() => onSelectCourse(lastTopic?.topicId)}>{lastTopic ? '接着上次学' : '选一门课开始'}<Icon name="arrow-right" size={16} /></button><button className={s.textButton} onClick={onLibrary}><Icon name="plus" size={15} />导入我的资料</button></div>{lastTopic && <button className={s.continueTopic} onClick={() => onSelectCourse(lastTopic.topicId)}><Icon name="book-open" size={15} /><span>{lastTopic.course} · {lastTopic.title}</span></button>}</div>
      <div className={s.partnerScene} aria-label="小白和小砚陪你学习"><div className={s.student}><div className={s.dialogue}>你先慢慢学，<br />我等你讲给我听。</div><XiaobaiAvatar mood={identity.acceptedAt ? 'happy' : 'curious'} level={level} size={180} variant="paper" /><span>小白 · 你的 AI 学生</span></div><div className={s.assistant}><XiaoyanPet state="idle" suppressReply className={s.welcomeAssistant} onClick={onLibrary} aria-label="小砚帮你整理学习资料" /><span>小砚 · 你的学习助理</span></div><div className={s.deskLine} aria-hidden="true" /></div>
    </section>
    <Apprenticeship identity={identity} onAccept={onAccept} />
    <FeynmanJourney topics={topics} onLearn={() => onSelectCourse(lastTopic?.topicId)} compact />
    <button className={s.textButton} onClick={onJourney}>看看完整学习旅程<Icon name="arrow-right" size={15} /></button>
  </div>;
}
