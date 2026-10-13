/** 模型选择与思考强度：输入框里的胶囊触发器 + 两页弹层（强度页 / 模型列表页）。 */
import { useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { IconModel } from './icons';
import { Popover, PopoverContent, PopoverTrigger } from './kit';
import { EffortSlider } from './EffortSlider';
import { EFFORT_HINTS, EFFORT_LABELS, type Effort } from '../../store/modelPrefs';
import s from './modelPicker.module.css';

export interface ModelOption {
  id: string;
  label: string;
  provider?: string;
  description?: string;
  /** 这个模型支持的思考强度，按从低到高排列；只有一项时不显示滑杆 */
  efforts: Effort[];
  defaultEffort?: Effort;
  badge?: string;
}

export function ModelPicker({ models, model, effort, onModel, onEffort, onReset, disabled, side = 'top', align = 'end', emptyLabel = '本地演示' }: {
  models: ModelOption[];
  /** 当前模型 id；null 或未命中时取第一项 */
  model: string | null;
  effort: Effort;
  onModel: (id: string) => void;
  onEffort: (effort: Effort) => void;
  onReset?: () => void;
  disabled?: boolean;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  /** 没有可用模型时胶囊上显示的文字 */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'effort' | 'models'>('effort');
  const current = models.find((item) => item.id === model) ?? models[0];
  if (!current) {
    return <span className={s.trigger} data-disabled><IconModel size={15} className={s.triggerIcon} /><span className={s.triggerModel}>{emptyLabel}</span></span>;
  }
  const efforts: Effort[] = current.efforts.length ? current.efforts : ['none'];
  // 当前模型不支持已存的强度时，落到它的默认档
  const stored = efforts.indexOf(effort);
  const index = stored >= 0 ? stored : Math.max(0, efforts.indexOf(current.defaultEffort ?? efforts[0]));
  const active = efforts[index];
  const adjustable = efforts.length > 1;
  const chooseModel = (item: ModelOption) => {
    onModel(item.id);
    if (!item.efforts.includes(effort)) onEffort(item.defaultEffort ?? item.efforts[0] ?? 'none');
    setPage('effort');
  };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setPage('effort'); }}>
      <PopoverTrigger asChild>
        <button type="button" className={s.trigger} disabled={disabled} aria-label={`模型 ${current.label}${adjustable ? `，思考强度 ${EFFORT_LABELS[active]}` : ''}`}>
          <IconModel size={15} className={s.triggerIcon} />
          <span className={s.triggerModel}>{current.label}</span>
          {adjustable && <span className={s.triggerEffort}>{EFFORT_LABELS[active]}</span>}
          <ChevronDown size={14} className={s.triggerChevron} />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className={s.panel}>
        {page === 'effort' ? (
          <>
            <div className={s.head}>
              <span className={s.headIcon}><IconModel size={20} active /></span>
              <div className={s.headCenter}>
                <strong>{adjustable ? EFFORT_LABELS[active] : '标准'}</strong>
                <button type="button" className={s.modelLink} onClick={() => setPage('models')}>
                  <span>{current.label}</span><ChevronRight size={14} />
                </button>
              </div>
              {onReset ? <button type="button" className={s.reset} aria-label="恢复默认" title="恢复默认" onClick={onReset}><RotateCcw size={16} /></button> : <span />}
            </div>
            {adjustable && <EffortSlider value={index} onChange={(next) => onEffort(efforts[next])} labels={efforts.map((item) => EFFORT_LABELS[item])} />}
            <p className={s.hint}>{adjustable ? EFFORT_HINTS[active] : '这个模型不支持调节思考强度。'}</p>
          </>
        ) : (
          <>
            <button type="button" className={s.back} onClick={() => setPage('effort')}><ChevronLeft size={15} />选择模型</button>
            <div className={s.list} role="listbox" aria-label="选择模型">
              {models.map((item) => (
                <button key={item.id} type="button" role="option" aria-selected={item.id === current.id} className={s.option} onClick={() => chooseModel(item)}>
                  <span><strong>{item.label}</strong>{(item.description || item.provider) && <small>{item.description ?? item.provider}</small>}</span>
                  {item.badge && <em>{item.badge}</em>}
                  {item.id === current.id && <Check size={16} />}
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
