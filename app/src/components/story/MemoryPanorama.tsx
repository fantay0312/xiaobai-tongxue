/**
 * 四层记忆全景 —— 成长册卷五的「一摞记忆匣」(答辩 money-shot)。
 * 组件只是壳:层名/统计/文案全部来自 engine/recall 的 deriveMemoryPanorama 真实派生,
 * 自己不发明任何数字或知识内容;空档层(如不在课上的当堂层)由派生层给出诚实空态,原样呈示。
 * 锚点两态:/growth#id 是本页卷目——HashRouter 下 href 锚点会污染路由,
 * 改为按钮 scrollIntoView(减动效偏好下不平滑);其余(/teach、/study)是跨页路由,走 Link。
 */
import { Link } from 'react-router-dom';
import type { MemoryLayer } from '../../engine/recall';
import { Icon } from '../ui/Icon';
import s from './memory.module.css';

interface Props {
  layers: MemoryLayer[];
}

/** /growth#xxx → 本页卷目的元素 id;其余返回 null,交给路由 Link */
function inPageId(to: string): string | null {
  return to.startsWith('/growth#') ? to.slice('/growth#'.length) : null;
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export function MemoryPanorama({ layers }: Props) {
  return (
    <div>
      <div className={s.stack}>
        {layers.map((layer) => {
          const targetId = layer.anchor ? inPageId(layer.anchor.to) : null;
          return (
            <article key={layer.key} className={s.box}>
              <header className={s.head}>
                <span className={s.no} aria-hidden="true">{layer.no}</span>
                <h3 className={s.name}>{layer.name}</h3>
                <p className={s.caption}>{layer.caption}</p>
              </header>
              {layer.stats.length > 0 && (
                <ul className={s.statRow}>
                  {layer.stats.map((st) => (
                    <li key={st.label} className={s.stat}>
                      <span className={s.statLabel}>{st.label}</span>
                      <span className={s.statValue}>{st.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              <ul className={s.lines}>
                {/* 情景句是内容模板,同日同门同结局的两堂课会生成一字不差的句子——
                    不能拿内容当 key;列表为派生快照、顺序恒定不重排,索引即稳定身份 */}
                {layer.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {/* 遗忘曲线显形:每门出师课的保持度迷你条(芦苇绿=尚清晰,藤黄=已衰减) */}
              {layer.retentions && layer.retentions.length > 0 && (
                <ul className={s.retList}>
                  {layer.retentions.map((r, i) => {
                    const pct = Math.round(r.retention * 100);
                    return (
                      <li key={i} className={s.retItem}>
                        <div className={s.retHead}>
                          <span className={s.retTitle}>《{r.title}》</span>
                          <span className={s.retNote}>
                            掌握度 {pct}% ·{' '}
                            {r.daysToFog == null
                              ? '暂稳'
                              : r.daysToFog === 0
                                ? '今日起雾'
                                : r.fogged
                                  ? `已起雾 ${Math.abs(r.daysToFog)} 天`
                                  : `再 ${r.daysToFog} 天起雾`}
                          </span>
                        </div>
                        <div className={s.retTrack} aria-hidden="true">
                          <span
                            className={`${s.retFill} ${r.fogged ? s.retFillFog : ''}`}
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* 跨课记忆线:小白自己把两门课连起来的关联 */}
              {layer.crossLinks && layer.crossLinks.length > 0 && (
                <div className={s.crossBlock}>
                  <p className={s.crossHead}>小白自己连起来的</p>
                  <ul className={s.crossList}>
                    {layer.crossLinks.map((c, i) => (
                      <li key={i}>{c.line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {layer.anchor && (
                targetId !== null ? (
                  <button
                    type="button"
                    className={s.anchorLink}
                    onClick={() => scrollToSection(targetId)}
                  >
                    {layer.anchor.label} <Icon name="arrow-right" size={15} />
                  </button>
                ) : (
                  <Link to={layer.anchor.to} className={s.anchorLink}>
                    {layer.anchor.label} <Icon name="arrow-right" size={15} />
                  </Link>
                )
              )}
            </article>
          );
        })}
      </div>
      {/* 摞底注脚:点题——四层皆是事件流的切面,零新状态 */}
      <p className={s.footNote}>四层记忆没有一层是新造的状态——每一层都是事件流的另一种切面。</p>
    </div>
  );
}
