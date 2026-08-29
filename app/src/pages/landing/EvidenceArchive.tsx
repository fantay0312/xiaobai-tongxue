import { Icon } from '../../components/ui/Icon';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { DEMO, EVIDENCE_STEPS } from './landingData';
import landing from './landing.module.css';
import s from './EvidenceArchive.module.css';

const FIVE_DIMENSIONS = ['覆盖度', '准确度', '逻辑结构', '深度', '纠错力'] as const;

/** 课后记录：三段「画面 + 一句话」，全部内容来自同一堂 Token 课的真实数据快照。 */
export function EvidenceArchive() {
  return (
    <section className={s.section} aria-labelledby="evidence-archive-title">
      <header className={landing.sectionHead} data-landing-reveal>
        <h2 id="evidence-archive-title" className={landing.sectionTitle}>
          一堂课上完，留下什么
        </h2>
        <ul className={s.steps} aria-label="课后记录的五个部分">
          {EVIDENCE_STEPS.map((step) => (
            <li key={step.id}>{step.title}</li>
          ))}
        </ul>
      </header>

      <div className={s.rows}>
        {/* 讲解记录 */}
        <article className={s.row} data-landing-reveal>
          <div className={s.stage}>
            <div className={s.window}>
              <header className={s.windowBar}>
                <span>课堂记录</span>
                <strong>{DEMO.title}</strong>
              </header>
              <div className={s.windowBody}>
                <p className={s.label}>关键原话 · 你</p>
                <blockquote className={s.quote}>{DEMO.teachLine}</blockquote>
                <p className={s.event}>
                  <Icon name="circle-check" size={15} />
                  命中“模型读的不是字”和“积木块清单哪里来”两个要点
                </p>
                <div className={s.pupilLine}>
                  <XiaobaiAvatar variant="paper" mood="confused" level={1} size={44} />
                  <p>{DEMO.misconceptionLine}</p>
                </div>
                <p className={`${s.event} ${s.eventWarn}`}>
                  <Icon name="swords" size={15} />
                  老师认同了这句话 · 结果：被带偏
                </p>
              </div>
            </div>
          </div>
          <div className={s.copy}>
            <h3>每句关键的话都留下来</h3>
            <p>
              你的原话、命中的要点、课堂里冒出来的误区，以及你当时是纠正了还是认同了。
            </p>
          </div>
        </article>

        {/* 随堂测验 */}
        <article className={`${s.row} ${s.rowFlip}`} data-landing-reveal>
          <div className={s.stage}>
            <div className={s.window}>
              <header className={s.windowBar}>
                <span>随堂测验</span>
                <strong>小白独立作答 · {DEMO.examScore} 分</strong>
              </header>
              <div className={s.windowBody}>
                <p className={s.label}>第 3 题</p>
                <p className={s.question}>{DEMO.examQuestion}</p>
                <p className={s.whisper}>{DEMO.examWhisper}</p>
                <p className={`${s.event} ${s.eventWarn}`}>
                  <Icon name="circle-x" size={15} />
                  还没答稳 · 对应“哪些词切得整，哪些词切得碎”
                </p>
              </div>
            </div>
          </div>
          <div className={s.copy}>
            <h3>小白独自作答</h3>
            <p>考试时不再接收提示。逐题显示答稳或没答稳，每道题都对应回讲解要点。</p>
          </div>
        </article>

        {/* 五维批注 */}
        <article className={s.row} data-landing-reveal>
          <div className={s.stage}>
            <div className={s.window}>
              <header className={s.windowBar}>
                <span>课后批注</span>
                <strong>先补一个盲区</strong>
              </header>
              <div className={s.windowBody}>
                <ul className={s.dimensions} aria-label="五维讲解画像">
                  {DEMO.reviewRadar.map(([dimension, score]) => (
                    <li key={dimension}>
                      <span>{dimension}</span>
                      <span className={s.bar} aria-hidden="true">
                        <i style={{ width: `${score}%` }} />
                      </span>
                      <strong>{score}</strong>
                    </li>
                  ))}
                </ul>
                <p className={s.label}>盲区</p>
                <p className={s.blindSpot}>{DEMO.blindSpot}</p>
                <p className={s.next}>
                  <Icon name="sprout" size={15} />
                  补学：{DEMO.remedyTitle}
                </p>
              </div>
            </div>
          </div>
          <div className={s.copy}>
            <h3>哪里没讲明白，一眼看清</h3>
            <p>
              {FIVE_DIMENSIONS.join('、')}。先补一个盲区，再回讲台重讲；纠正后的结果继续写进成长册。
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

export default EvidenceArchive;
