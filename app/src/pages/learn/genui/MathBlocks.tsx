import { useState } from 'react';
import { Check, ChevronDown, Copy, Footprints, Sigma } from 'lucide-react';
import { Button, IconButton, cx } from '../../../components/ui';
import type { LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { useBlockState } from './context';
import { BlockCard, Md, ScrollX, Tex, copyText } from './parts';
import styles from './genui.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** 分步推导：一次只展开一步，先自己想下一步再看。 */
export function StepsBlock({ item }: { item: LearningUiBlockOf<'steps'> }) {
  const [state, setState] = useBlockState(item.id);
  const total = item.steps.length;
  const shown = Math.min(total, Math.max(1, state.step ?? 1));
  const finished = shown >= total;
  return (
    <BlockCard item={item} icon={<Footprints {...ICON} />} meta={`第 ${shown}/${total} 步`}>
      <ol className={styles.stepList}>
        {item.steps.map((step, index) => {
          const open = index < shown;
          return (
            <li key={index} className={styles.step} data-open={open} data-current={index === shown - 1 && !finished}>
              <span className={styles.stepIndex} aria-hidden="true">{index + 1}</span>
              <div className={styles.stepBody}>
                {open ? (
                  <>
                    <strong className={styles.stepTitle}>{step.title}</strong>
                    <Md text={step.body} />
                    {step.latex ? (
                      <ScrollX label={`第 ${index + 1} 步的式子`} className={styles.stepMath}>
                        <Tex latex={step.latex} display />
                      </ScrollX>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className={styles.stepLocked} onClick={() => setState({ step: index + 1 })}>
                    <span>{step.title}</span>
                    <ChevronDown size={14} strokeWidth={1.75} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {finished && item.result ? (
        <div className={styles.result}>
          <span className={styles.resultLabel}><Check size={13} strokeWidth={2.5} />结论</span>
          <Md text={item.result} />
        </div>
      ) : null}
      <div className={styles.actions}>
        {finished ? (
          <Button size="sm" variant="ghost" onClick={() => setState({ step: 1 })}>收起，自己再推一遍</Button>
        ) : (
          <>
            <Button size="sm" variant="solid" onClick={() => setState({ step: shown + 1 })}>下一步</Button>
            <Button size="sm" variant="ghost" onClick={() => setState({ step: total })}>全部展开</Button>
            <span className={styles.hint}>先想想下一步该做什么</span>
          </>
        )}
      </div>
    </BlockCard>
  );
}

export function FormulaBlock({ item }: { item: LearningUiBlockOf<'formula'> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(item.latex))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <BlockCard
      item={item}
      icon={<Sigma {...ICON} />}
      actions={
        <IconButton label={copied ? '已复制' : '复制 LaTeX'} tip size="sm" onClick={copy}>
          {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}
        </IconButton>
      }
    >
      <ScrollX label={`${item.title}公式`} className={styles.formula}>
        <Tex latex={item.latex} display />
      </ScrollX>
      {item.symbols.length ? (
        <dl className={styles.legend}>
          {item.symbols.map((entry, index) => (
            <div key={index} className={styles.legendRow}>
              <dt><Tex latex={entry.symbol} /></dt>
              <dd><Md text={entry.meaning} tight /></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.usage ? (
        <div className={cx(styles.usage)}>
          <span className={styles.usageLabel}>什么时候用</span>
          <Md text={item.usage} tight />
        </div>
      ) : null}
    </BlockCard>
  );
}
