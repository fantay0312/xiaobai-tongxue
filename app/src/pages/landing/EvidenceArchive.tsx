import { Icon, type IconName } from '../../components/ui/Icon';
import { DEMO, EVIDENCE_STEPS, LANDING_METRICS } from './landingData';
import s from './EvidenceArchive.module.css';

const EVIDENCE_ICONS: readonly IconName[] = [
  'book-open',
  'swords',
  'route',
  'lamp',
  'notebook',
];

const FIVE_DIMENSIONS = ['覆盖度', '准确度', '逻辑结构', '深度', '纠错力'] as const;

type EvidenceStep = (typeof EVIDENCE_STEPS)[number];
type LandingMetric = (typeof LANDING_METRICS)[number];

function EvidenceDetail({
  step,
  label = '查看详情',
}: {
  step: EvidenceStep | undefined;
  label?: string;
}) {
  if (!step) return null;

  return (
    <details className={s.details}>
      <summary>
        <span>{label}</span>
        <Icon name="chevron-down" size={15} />
      </summary>
      <div className={s.detailBody}>
        <p className={s.detailStep}>
          {step.step} · {step.title}
        </p>
        <p>{step.evidence}</p>
      </div>
    </details>
  );
}

function MetricValue({ metric }: { metric: LandingMetric }) {
  if (metric.from && metric.to) {
    return (
      <p className={`${s.metricValue} ${s.metricPair}`}>
        <s>{metric.from}</s>
        <Icon name="arrow-right" size={18} />
        <strong>{metric.to}</strong>
      </p>
    );
  }

  return (
    <p className={s.metricValue}>
      <strong>{metric.value}</strong>
      {metric.unit ? <em>{metric.unit}</em> : null}
    </p>
  );
}

/** 宣传页的课后记录段：只写当前产品会长期保留的内容。 */
export function EvidenceArchive() {
  return (
    <section className={s.section} aria-labelledby="evidence-archive-title">
      <header className={s.heading}>
        <div data-landing-reveal data-reveal-order="0">
          <p className={s.kicker}>课后批注</p>
          <h2 id="evidence-archive-title">教过什么，哪里讲岔，课后都能看清</h2>
        </div>
        <p className={s.lede} data-landing-reveal data-reveal-order="1">
          课堂结束后，关键原话摘录、误区事件、逐题判定和五维讲解画像会放在同一份批注里。
        </p>
      </header>

      <div className={s.bridge} aria-label="一堂课的五类课后记录">
        {EVIDENCE_STEPS.map((item, index) => (
          <div
            className={s.bridgeItem}
            key={item.id}
            data-landing-reveal
            data-reveal-order={index}
          >
            <div className={s.bridgeEvidence}>
              <span className={s.bridgeIcon} aria-hidden="true">
                <Icon name={EVIDENCE_ICONS[index] ?? 'file'} size={23} />
              </span>
              <p className={s.bridgeTitle}>{item.title}</p>
              <p className={s.bridgeDesc}>{item.description}</p>
            </div>
            {index < EVIDENCE_STEPS.length - 1 ? (
              <Icon className={s.bridgeArrow} name="arrow-right" size={19} />
            ) : null}
          </div>
        ))}
      </div>

      <ol className={s.archives}>
        <li className={s.archive} data-landing-reveal>
          <header className={s.archiveStub}>
            <span className={s.archiveNo}>01</span>
            <h3>讲解摘录<br />与误区记录</h3>
            <span className={s.fileTag}>Token 与分词 · 课堂记录</span>
          </header>
          <div className={s.archiveContent}>
            <article className={s.transcript}>
              <p className={s.recordLabel}>关键原话摘录 · 你</p>
              <blockquote>{DEMO.teachLine}</blockquote>
              <p className={s.response}>
                <span>长期保留的教学事件</span>
                命中“模型读的不是字”和“积木块清单哪里来”两个要点。
              </p>
              <EvidenceDetail step={EVIDENCE_STEPS[0]} label="这条记录会保留什么" />
            </article>
            <article className={s.misconception}>
              <p className={s.recordLabel}>课堂中出现的常见误区</p>
              <p className={s.triggerLine}>{DEMO.misconceptionLine}</p>
              <p className={s.warning}>
                <Icon name="swords" size={16} />
                老师认同后，结果：被带偏
              </p>
              <EvidenceDetail step={EVIDENCE_STEPS[1]} label="这条误区怎样落档" />
            </article>
          </div>
        </li>

        <li className={s.archive} data-landing-reveal>
          <header className={s.archiveStub}>
            <span className={s.archiveNo}>02</span>
            <h3>逐题判定<br />与对应要点</h3>
            <span className={s.fileTag}>随堂测验 · 带偏分支 20 分</span>
          </header>
          <div className={s.archiveContent}>
            <article className={s.exam}>
              <p className={s.recordLabel}>第 3 题 · 小白独立作答</p>
              <p className={s.question}>{DEMO.examQuestion}</p>
              <p className={s.examRule}>
                <Icon name="route" size={16} />
                还没答稳 · 对应“哪些词切得整，哪些词切得碎”
              </p>
              <EvidenceDetail step={EVIDENCE_STEPS[2]} label="逐题判定会保留什么" />
            </article>
            <article className={s.sources}>
              <p className={s.recordLabel}>课后会长期保留</p>
              <ul>
                <li>结构化教学事件</li>
                <li>误区纠正或被带偏的结果</li>
                <li>逐题稳、未稳与失败要点</li>
              </ul>
              <p className={s.sourceNote}>逐轮判语随讲解舱关闭释放，不冒充永久录像。</p>
              <EvidenceDetail step={EVIDENCE_STEPS[3]} label="五维批注怎样计算" />
            </article>
          </div>
        </li>

        <li className={s.archive} data-landing-reveal>
          <header className={s.archiveStub}>
            <span className={s.archiveNo}>03</span>
            <h3>五维批注<br />与补学入口</h3>
            <span className={s.fileTag}>灯下批注 · 下一步该补哪里</span>
          </header>
          <div className={s.archiveContent}>
            <article className={s.annotation}>
              <p className={s.recordLabel}>这次先补一个盲区</p>
              <blockquote>
                小白把“一个字就是一个 Token”当成了正确答案。先补这一点，再回讲解舱重讲。
              </blockquote>
              <p className={s.signature}>—— Token 与分词 · 带偏分支</p>
              <EvidenceDetail step={EVIDENCE_STEPS[4]} label="补学完成后去哪里" />
            </article>
            <article className={s.dimensions}>
              <p className={s.recordLabel}>五维讲解画像 · 产品真实口径</p>
              <ul aria-label="五维反馈维度">
                {FIVE_DIMENSIONS.map((dimension) => (
                  <li key={dimension}>
                    <Icon name="circle-check" size={16} />
                    <span>{dimension}</span>
                  </li>
                ))}
              </ul>
              <p>覆盖度看要点命中，准确度结合表述标记和测验，纠错力看误区是否被纠正。</p>
            </article>
          </div>
        </li>
      </ol>

      <aside className={s.metrics} aria-labelledby="offline-metrics-title">
        <header className={s.metricsHeading} data-landing-reveal data-reveal-order="0">
          <p className={s.kicker}>当前版本</p>
          <h3 id="offline-metrics-title">现在收录了什么，离线测了什么</h3>
          <p>课程数来自当前课程库；防剧透结果来自 24 条离线测试，不是用户规模。</p>
        </header>
        <dl className={s.metricList}>
          {LANDING_METRICS.map((metric, index) => (
            <div
              className={s.metric}
              key={metric.id}
              data-landing-reveal
              data-reveal-order={index + 1}
            >
              <dt>{metric.label}</dt>
              <dd>
                <MetricValue metric={metric} />
                <p className={s.metricNote}>{metric.note}</p>
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </section>
  );
}

export default EvidenceArchive;
