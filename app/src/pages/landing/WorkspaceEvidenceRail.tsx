import type { CSSProperties, JSX } from 'react';
import { Icon } from '../../components/ui/Icon';
import type { LearningStage } from './landingData';
import { DEMO } from './landingData';
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

function TeachEvidence() {
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>讲解舱</h3>
        <dl className={s.factList}>
          <div>
            <dt>小白</dt>
            <dd>好奇型 · {DEMO.pupilStage.name} · {DEMO.pupilStage.description}</dd>
          </div>
          <div><dt>心情</dt><dd>有些困惑</dd></div>
          <div><dt>回放</dt><dd>第 2–3 轮 · 共 3 轮</dd></div>
        </dl>
      </section>
      <section className={`${s.evidenceCard} ${s.blindCard}`}>
        <h3>这一幕在看什么</h3>
        <strong>误区试探 → 错误认同 → 理解带偏</strong>
        <p>它不是推荐讲法，而是展示一次讲岔如何被记录，并在后续步骤中纠正。</p>
      </section>
    </>
  );
}

function ExamEvidence() {
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>考场规则</h3>
        <p>先生只能观战，不能追加提示。</p>
      </section>
      <section className={s.evidenceCard}>
        <h3>本场结果</h3>
        <p className={s.largeResult}>{DEMO.examScore} <small>分</small></p>
        <p>1 题答稳，4 题留下墨痕。</p>
      </section>
    </>
  );
}

function ReviewEvidence() {
  return (
    <>
      <section className={s.evidenceCard}>
        <h3>五维讲解画像</h3>
        <div className={s.radarBars}>
          {DEMO.reviewRadar.map(([label, value]) => (
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
      <section className={`${s.evidenceCard} ${s.blindCard}`}>
        <h3>小白还没懂</h3>
        <strong>{DEMO.blindSpot}</strong>
        <p>{DEMO.blindSpotEvidence}</p>
      </section>
    </>
  );
}

function RemedyEvidence() {
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

function ReteachEvidence() {
  return (
    <>
      <section className={`${s.evidenceCard} ${s.passedCard}`}>
        <h3>重讲结果</h3>
        <p><Icon name="circle-check" size={16} />{DEMO.reteachResult}</p>
      </section>
      <section className={s.evidenceCard}>
        <h3>长期记录</h3>
        <p>讲解报告、出师记录和复习事件会写进成长册。</p>
      </section>
    </>
  );
}

const RAIL_CONTENT: Record<LearningStage['id'], () => JSX.Element> = {
  prep: PrepEvidence,
  teach: TeachEvidence,
  exam: ExamEvidence,
  review: ReviewEvidence,
  remedy: RemedyEvidence,
  reteach: ReteachEvidence,
};

export function WorkspaceEvidenceRail({ stageId }: { stageId: LearningStage['id'] }) {
  const Content = RAIL_CONTENT[stageId];
  return (
    <aside className={s.evidenceRail} aria-label="当前步骤的信息">
      <Content />
      <blockquote className={s.evidenceNote}>
        基于 Token 课程数据和引擎结果重构的流程演示。
      </blockquote>
    </aside>
  );
}
