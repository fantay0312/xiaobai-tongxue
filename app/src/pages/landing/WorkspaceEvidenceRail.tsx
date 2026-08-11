import type { CSSProperties, JSX } from 'react';
import { Icon } from '../../components/ui/Icon';
import type { LearningStage } from './landingData';
import { DEMO } from './landingData';
import {
  getTeachJourneySnapshot,
  type TeachDemoSessionSummary,
} from './landingTeachDemo';
import s from './LearningWorkspace.module.css';

function PrepEvidence() {
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>当前自检题</h3>
        <p className={s.largeResult}>
          {DEMO.prepStep} <small>/ {DEMO.prepTotal}</small>
        </p>
        <p>这是第二波自检；错题相关讲义会默认展开。</p>
      </section>
      <section className={s.evidenceCard}>
        <h3>备课材料</h3>
        <ul className={s.simpleList}>
          <li><Icon name="clipboard" size={15} />教学任务卡</li>
          <li><Icon name="route" size={15} />讲课路线图</li>
          <li><Icon name="book-open" size={15} />研读材料包</li>
        </ul>
      </section>
    </>
  );
}

function TeachEvidence({ session }: { session: TeachDemoSessionSummary }) {
  const journey = getTeachJourneySnapshot(session.outcome);
  const outcomeLabel = journey.branch === 'passed'
    ? '误区已纠正'
    : journey.branch === 'failed' ? '误区被带偏' : '等待讲清';
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>讲解舱</h3>
        <dl className={s.factList}>
          <div>
            <dt>小白</dt>
            <dd>好奇型 · {DEMO.pupilStage.name} · {DEMO.pupilStage.description}</dd>
          </div>
          <div><dt>方式</dt><dd>本地三分支 · 仿真实节奏回应</dd></div>
          <div><dt>轮次</dt><dd>第 {session.turn} 轮 · {outcomeLabel}</dd></div>
          <div><dt>留档</dt><dd>本页不写入个人学习记录</dd></div>
        </dl>
      </section>
      <section className={`${s.evidenceCard} ${s.blindCard}`}>
        <h3>{session.teacherLine ? '本轮讲解证据' : '你可以直接试讲'}</h3>
        <strong>{session.teacherLine || '输入 → 小白琢磨 → 分支回应'}</strong>
        <p>{session.teacherLine
          ? journey.review.findingEvidence
          : '自动示范会先走错误分支；也可以接管输入，当场把误区纠正。'}</p>
      </section>
    </>
  );
}

function ExamEvidence({ session }: { session: TeachDemoSessionSummary }) {
  const journey = getTeachJourneySnapshot(session.outcome);
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>考场规则</h3>
        <p>先生只能观战，不能追加提示。</p>
      </section>
      <section className={s.evidenceCard}>
        <h3>{journey.review.resultLabel}</h3>
        <p className={s.largeResult}>
          {journey.review.resultValue}
          {journey.review.resultUnit ? <small> {journey.review.resultUnit}</small> : null}
        </p>
        <p>{journey.review.resultSummary}</p>
      </section>
    </>
  );
}

function ReviewEvidence({ session }: { session: TeachDemoSessionSummary }) {
  const journey = getTeachJourneySnapshot(session.outcome);
  const passed = journey.branch === 'passed';
  if (journey.branch === 'open') {
    return (
      <>
        <section className={s.evidenceCard}>
          <h3>本轮未形成讲解画像</h3>
          <p>小白还在等一个能说清词表切法的对比例子。</p>
        </section>
        <section className={s.evidenceCard}>
          <h3>{journey.review.findingLabel}</h3>
          <strong>{journey.review.findingTitle}</strong>
          <p>{journey.review.findingEvidence}</p>
        </section>
      </>
    );
  }
  const radar = passed ? DEMO.correctedReviewRadar : DEMO.reviewRadar;
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>五维讲解画像</h3>
        <div className={s.radarBars}>
          {radar.map(([label, value]) => (
            <div key={label}>
              <span>{label}<b>{value}</b></span>
              <i aria-hidden="true">
                <em
                  className={s.radarFill}
                  style={{ '--score': value / 100 } as CSSProperties}
                />
              </i>
            </div>
          ))}
        </div>
      </section>
      <section className={`${s.evidenceCard} ${passed ? s.passedCard : s.blindCard}`}>
        <h3>{journey.review.findingLabel}</h3>
        <strong>{journey.review.findingTitle}</strong>
        <p>{journey.review.findingEvidence}</p>
      </section>
    </>
  );
}

function RemedyEvidence({ session }: { session: TeachDemoSessionSummary }) {
  const journey = getTeachJourneySnapshot(session.outcome);
  if (journey.branch === 'passed') {
    return (
      <section className={`${s.evidenceCard} ${s.passedCard}`}>
        <h3>已跳过强制补学</h3>
        <p><Icon name="circle-check" size={16} />这个误区已在赴考中答稳，当前为可选巩固。</p>
      </section>
    );
  }
  return (
    <section className={s.evidenceCard}>
      <h3>补学微路径</h3>
      <ol className={s.remedySteps}>
        <li><span>1</span>读一小段</li>
        <li><span>2</span>做三道预测题</li>
        <li><span>3</span>回讲解舱重讲</li>
      </ol>
    </section>
  );
}

function ReteachEvidence({ session }: { session: TeachDemoSessionSummary }) {
  const journey = getTeachJourneySnapshot(session.outcome);
  const open = journey.branch === 'open';
  return (
    <>
      <section className={`${s.evidenceCard} ${open ? '' : s.passedCard}`}>
        <h3>{journey.branch === 'passed' ? '迁移复述' : open ? '待补完' : '重讲结果'}</h3>
        <p><Icon name={open ? 'circle-help' : 'circle-check'} size={16} />{journey.reteach.result}</p>
      </section>
      <section className={s.evidenceCard}>
        <h3>长期记录</h3>
        <p>讲解报告、出师记录和复习事件会写进成长册。</p>
      </section>
    </>
  );
}

function RailContent({
  stageId,
  teachSession,
}: {
  stageId: LearningStage['id'];
  teachSession: TeachDemoSessionSummary;
}): JSX.Element {
  if (stageId === 'prep') return <PrepEvidence />;
  if (stageId === 'teach') return <TeachEvidence session={teachSession} />;
  if (stageId === 'exam') return <ExamEvidence session={teachSession} />;
  if (stageId === 'review') return <ReviewEvidence session={teachSession} />;
  if (stageId === 'remedy') return <RemedyEvidence session={teachSession} />;
  return <ReteachEvidence session={teachSession} />;
}

export function WorkspaceEvidenceRail({
  stageId,
  teachSession,
}: {
  stageId: LearningStage['id'];
  teachSession: TeachDemoSessionSummary;
}) {
  return (
    <aside className={s.evidenceRail} aria-label="当前步骤的信息">
      <RailContent stageId={stageId} teachSession={teachSession} />
      <blockquote className={s.evidenceNote}>
        基于 Token 真实课程分支制作；完整书斋会继续记录事件、考试与复盘证据。
      </blockquote>
    </aside>
  );
}
