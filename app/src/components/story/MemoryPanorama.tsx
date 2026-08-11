/**
 * 四层记忆全景 —— 成长册卷五的一张连续「记忆存续登记册」。
 * 数据仍全部来自 engine/recall 的纯派生；本组件只负责把当堂→情景→学问→师徒
 * 排成越往下越长久的档案深度，并用渐进展开收纳较长的保持度与跨课记录。
 */
import { Link } from 'react-router';
import type { MemoryLayer, MemoryLayerKey, RetentionBar } from '../../engine/recall';
import { Icon } from '../ui/Icon';
import paper from '../../styles/paper.module.css';
import s from './memory.module.css';
import d from './memoryDetails.module.css';
import r from './memoryRegistry.module.css';

interface Props {
  layers: MemoryLayer[];
}

interface LayerMeta {
  code: string;
  keep: string;
  emptyLabel: string;
  filledLabel: string;
  className: string;
}

const PREVIEW_LIMIT = 3;

const LAYER_META: Record<MemoryLayerKey, LayerMeta> = {
  working: {
    code: 'WORKING', keep: '留存 · 当堂', emptyLabel: '待开讲', filledLabel: '正在课上', className: s.layerWorking,
  },
  episodic: {
    code: 'EPISODIC', keep: '留存 · 成页', emptyLabel: '待记一页', filledLabel: '已有情景', className: s.layerEpisodic,
  },
  semantic: {
    code: 'SEMANTIC', keep: '留存 · 沉淀', emptyLabel: '待沉一笔', filledLabel: '已有沉淀', className: s.layerSemantic,
  },
  bond: {
    code: 'BOND', keep: '留存 · 长久', emptyLabel: '初识', filledLabel: '渐熟', className: s.layerBond,
  },
};

/** /growth#xxx → 本页卷目的元素 id；其余返回 null，交给路由 Link。 */
function inPageId(to: string): string | null {
  return to.startsWith('/growth#') ? to.slice('/growth#'.length) : null;
}

function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  const focusTarget = element.querySelector<HTMLElement>('h1, h2, h3') ?? element;
  if (!focusTarget.hasAttribute('tabindex')) {
    focusTarget.tabIndex = -1;
    focusTarget.addEventListener('blur', () => focusTarget.removeAttribute('tabindex'), { once: true });
  }
  focusTarget.focus({ preventScroll: true });
}

function LayerAction({ layer }: { layer: MemoryLayer }) {
  // 空档时只给「当堂记忆」一个下一步，避免四个无内容入口争抢注意力。
  if (!layer.anchor || (layer.empty && layer.key !== 'working')) return null;
  const targetId = inPageId(layer.anchor.to);
  const label = `${layer.name}：${layer.anchor.label}`;
  if (targetId !== null) {
    return (
      <button
        type="button"
        className={s.anchorLink}
        aria-label={label}
        onClick={() => scrollToSection(targetId)}
      >
        {layer.anchor.label}<Icon name="arrow-right" size={15} />
      </button>
    );
  }
  return (
    <Link to={layer.anchor.to} className={s.anchorLink} aria-label={label}>
      {layer.anchor.label}<Icon name="arrow-right" size={15} />
    </Link>
  );
}

function retentionNote(item: RetentionBar): string {
  if (item.daysToFog == null) return '暂稳';
  if (item.daysToFog === 0) return '今日起雾';
  return item.fogged
    ? `已起雾 ${Math.abs(item.daysToFog)} 天`
    : `再 ${item.daysToFog} 天起雾`;
}

function RetentionRows({ items }: { items: RetentionBar[] }) {
  return (
    <ul className={d.retList}>
      {items.map((item) => {
        const percentage = Math.round(item.retention * 100);
        const note = retentionNote(item);
        return (
          <li key={item.title} className={d.retItem}>
            <div className={d.retHead}>
              <span className={d.retTitle}>《{item.title}》</span>
              <span className={d.retNote}>掌握度 {percentage}% · {note}</span>
            </div>
            <div
              className={d.retTrack}
              role="progressbar"
              aria-label={`《${item.title}》记忆保持度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              aria-valuetext={`${percentage}%，${note}`}
            >
              <span
                className={`${d.retFill} ${item.fogged ? d.retFillFog : ''}`}
                style={{ width: `${Math.max(4, percentage)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RetentionArchive({ items }: { items: RetentionBar[] }) {
  const preview = items.slice(0, PREVIEW_LIMIT);
  const remainder = items.slice(PREVIEW_LIMIT);
  return (
    <section className={d.supplement} aria-labelledby="memory-retention-title">
      <header className={d.supplementHead}>
        <h4 id="memory-retention-title">记忆清晰度</h4>
        <span>{items.length} 门在册</span>
      </header>
      <RetentionRows items={preview} />
      {remainder.length > 0 && (
        <details className={d.moreDetails}>
          <summary>查看其余 {remainder.length} 门</summary>
          <RetentionRows items={remainder} />
        </details>
      )}
    </section>
  );
}

function CrossLinkArchive({ links }: { links: NonNullable<MemoryLayer['crossLinks']> }) {
  const preview = links.slice(0, PREVIEW_LIMIT);
  const remainder = links.slice(PREVIEW_LIMIT);
  const rows = (items: typeof links) => (
    <ul className={d.crossList}>
      {items.map((item) => <li key={item.line}>{item.line}</li>)}
    </ul>
  );
  return (
    <section className={d.supplement} aria-labelledby="memory-cross-title">
      <header className={d.supplementHead}>
        <h4 id="memory-cross-title">小白自己连起来的</h4>
        <span>{links.length} 条星线</span>
      </header>
      {rows(preview)}
      {remainder.length > 0 && (
        <details className={d.moreDetails}>
          <summary>查看其余 {remainder.length} 条</summary>
          {rows(remainder)}
        </details>
      )}
    </section>
  );
}

export function MemoryPanorama({ layers }: Props) {
  return (
    <div
      className={`${r.panorama} ${paper.texture}`}
      role="group"
      aria-label="小白的四层记忆存续登记册"
    >
      <header className={r.registryHead}>
        <div className={r.registryCopy}>
          <p className={`${r.eyebrow} ${paper.typeLabel}`}>MEMORY REGISTER · VOLUME 05</p>
          <p className={r.registryLead}>越往下，记得越久。</p>
        </div>
        <div className={r.depthLegend} aria-hidden="true">
          <span>此刻</span><i /><span>长久</span>
        </div>
        <p className={r.registryCount} aria-label="共四层">
          <strong>04</strong><span>LAYERS</span>
        </p>
      </header>

      <ol className={s.layers}>
        {layers.map((layer) => {
          const meta = LAYER_META[layer.key];
          const titleId = `memory-layer-${layer.key}`;
          return (
            <li key={layer.key} className={s.layerItem}>
              <article className={`${s.layer} ${meta.className}`} aria-labelledby={titleId}>
                <div className={s.layerRail} aria-hidden="true">
                  <span className={s.layerNo}>{layer.no}</span>
                  <span className={s.layerCode}>{meta.code}</span>
                  <span className={s.layerKeep}>{meta.keep}</span>
                </div>

                <div className={s.layerBody}>
                  <header className={s.layerHead}>
                    <div className={s.layerTitleGroup}>
                      <p className={s.layerState}>
                        <i aria-hidden="true" />{layer.empty ? meta.emptyLabel : meta.filledLabel}
                      </p>
                      <h3 id={titleId} className={s.layerName}>{layer.name}</h3>
                      <p className={s.caption}>{layer.caption}</p>
                    </div>
                    <LayerAction layer={layer} />
                  </header>

                  <div className={`${s.layerContent} ${layer.stats.length === 0 ? s.contentEmpty : ''}`}>
                    {layer.stats.length > 0 && (
                      <dl className={s.statLedger}>
                        {layer.stats.map((stat) => (
                          <div key={stat.label} className={s.stat}>
                            <dt>{stat.label}</dt>
                            <dd>{stat.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <ul className={s.lines}>
                      {layer.lines.map((line, index) => <li key={index}>{line}</li>)}
                    </ul>
                  </div>

                  {((layer.retentions?.length ?? 0) > 0 || (layer.crossLinks?.length ?? 0) > 0) && (
                    <div className={d.supplementGrid}>
                      {layer.retentions && layer.retentions.length > 0 && (
                        <RetentionArchive items={layer.retentions} />
                      )}
                      {layer.crossLinks && layer.crossLinks.length > 0 && (
                        <CrossLinkArchive links={layer.crossLinks} />
                      )}
                    </div>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>

      <footer className={r.registryFoot}>
        <p>每一次开讲、纠错与复习，都会在这里留下可回查的一笔。</p>
        <span className={paper.typeLabel}>EVENT-DERIVED · TRACEABLE</span>
      </footer>
    </div>
  );
}
