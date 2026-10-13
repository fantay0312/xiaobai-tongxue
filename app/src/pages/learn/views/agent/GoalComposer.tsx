import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp, BookOpen, CalendarClock, CalendarDays, ChevronDown, Files, Layers, ListChecks, NotebookPen, Search, type LucideIcon } from 'lucide-react';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Segmented, Switch, Tip } from '../../../../components/ui';
import { STEP_BUDGETS, type RunOptions } from '../../../../engine/agent';
import s from './agent.module.css';

interface Template {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 这类任务适合分轮推进 */
  goalMode?: boolean;
  build: (subject: string) => string;
}

const TEMPLATES: Template[] = [
  { id: 'research', label: '调研', icon: Search, goalMode: true, build: (subject) => `调研「${subject}」：梳理核心概念、关键机制和常见误区，写成一篇结构清晰的笔记，再配一张思维导图。` },
  { id: 'notes', label: '整理笔记', icon: NotebookPen, build: (subject) => `把「${subject}」的资料整理成一篇可以直接复习的笔记：分小节列要点，配必要的例子，结尾留 3 个自测问题。` },
  { id: 'quiz', label: '出一套题', icon: ListChecks, build: (subject) => `围绕「${subject}」出一套 8 道练习题：单选、判断、填空和简答都要有，难度由浅入深，每题附解析。` },
  { id: 'cards', label: '做闪卡', icon: Layers, build: (subject) => `把「${subject}」里需要记住的概念和结论做成 12 张左右的闪卡，一卡一问。` },
  { id: 'plan', label: '复习计划', icon: CalendarDays, goalMode: true, build: (subject) => `为「${subject}」排一份 7 天复习计划：每天的任务写进待办并标上日期，同时准备配套的闪卡和一套自测题。` },
];

const BUDGET_OPTIONS = STEP_BUDGETS.map((budget) => ({ value: String(budget), label: `${budget} 步` }));

interface Props {
  draft: string;
  onDraft: (text: string) => void;
  options: RunOptions;
  onOptions: (patch: Partial<RunOptions>) => void;
  /** 当前打开的课程标题 */
  topicTitle?: string;
  /** 已勾选资料的标题 */
  sourceTitles: string[];
  onStart: () => void;
  /** 把输入框里的指令设成定时任务 */
  onSchedule: () => void;
  /** 手机版式：选项收成一行，「开始」通栏，模板横向滑动 */
  compact?: boolean;
}

/** 目标输入：一段目标 + 当前上下文 + 运行选项 + 模板 */
export function GoalComposer({ draft, onDraft, options, onOptions, topicTitle, sourceTitles, onStart, onSchedule, compact = false }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 输入框随内容长高
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(280, input.scrollHeight)}px`;
  }, [draft]);

  const subject = topicTitle ?? (sourceTitles.length ? '已选资料' : '我想学的主题');

  const start = () => {
    if (draft.trim()) onStart();
    else inputRef.current?.focus();
  };

  const applyTemplate = (template: Template) => {
    onDraft(template.build(subject));
    if (template.goalMode && !options.goalMode) onOptions({ goalMode: true });
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      start();
    }
  };

  return (
    <>
      <section className={s.composer} data-compact={compact || undefined} aria-label="新任务">
        <textarea
          ref={inputRef}
          className={s.composerInput}
          value={draft}
          rows={2}
          maxLength={6000}
          placeholder="写下想交给助理的事，比如：把这一讲整理成笔记，再出 8 道题…"
          aria-label="任务目标"
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={s.contextRow}>
          <span className={s.contextChip} data-muted={topicTitle ? undefined : 'true'}>
            <BookOpen size={13} strokeWidth={1.75} />
            <span>{topicTitle ?? '未打开课程'}</span>
          </span>
          {sourceTitles.length > 0 && (
            <Tip label={sourceTitles.slice(0, 8).join('、')}>
              <span className={s.contextChip}><Files size={13} strokeWidth={1.75} /><span>{sourceTitles.length} 份已选资料</span></span>
            </Tip>
          )}
          {!topicTitle && sourceTitles.length === 0 && <span className={s.contextHint}>没有资料时助理只能用通用知识，建议先打开一门课。</span>}
        </div>
        <div className={s.composerBar}>
          <div className={s.options}>
            <Tip label="列出清单逐项推进，步数用完可以跨轮续跑">
              <label className={s.option}>
                <Switch checked={options.goalMode} onCheckedChange={(goalMode) => onOptions({ goalMode })} label="目标模式" />
                <span>目标模式</span>
              </label>
            </Tip>
            {options.goalMode && (
              <Tip label={`步数用完后自动续跑，最多 ${options.maxRounds} 轮`}>
                <label className={s.option}>
                  <Switch checked={options.autoContinue} onCheckedChange={(autoContinue) => onOptions({ autoContinue })} label="自动续跑" />
                  <span>自动续跑</span>
                </label>
              </Tip>
            )}
            <Tip label="把互不依赖的子任务交给子代理并行处理">
              <label className={s.option}>
                <Switch checked={options.subagents} onCheckedChange={(subagents) => onOptions({ subagents })} label="允许子代理" />
                <span>{compact ? '子代理' : '允许子代理'}</span>
              </label>
            </Tip>
            {compact ? (
              <Menu>
                <MenuTrigger asChild>
                  <button type="button" className={s.budget} aria-label={`每轮 ${options.stepBudget} 步，点按修改`}>
                    每轮 {options.stepBudget} 步
                    <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>每轮最多走几步</MenuLabel>
                  {BUDGET_OPTIONS.map((option) => (
                    <MenuItem key={option.value} checked={String(options.stepBudget) === option.value} onSelect={() => onOptions({ stepBudget: Number(option.value) })}>
                      {option.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : (
              <div className={s.option}>
                <span>每轮</span>
                <Segmented
                  size="sm"
                  label="每轮步数"
                  value={String(options.stepBudget)}
                  onChange={(value) => onOptions({ stepBudget: Number(value) })}
                  options={BUDGET_OPTIONS}
                />
              </div>
            )}
          </div>
          <div className={s.composerActions}>
            {compact ? (
              <IconButton label="设成定时任务" variant="outline" size="lg" tip={false} onClick={onSchedule}>
                <CalendarClock size={18} strokeWidth={1.75} />
              </IconButton>
            ) : (
              <Button variant="ghost" icon={<CalendarClock size={15} strokeWidth={1.75} />} onClick={onSchedule}>定时</Button>
            )}
            <Button variant="solid" size={compact ? 'lg' : 'md'} block={compact} icon={<ArrowUp size={compact ? 17 : 15} strokeWidth={2} />} disabled={!draft.trim()} onClick={start}>开始</Button>
          </div>
        </div>
      </section>

      <div className={s.templates} data-compact={compact || undefined} role="group" aria-label="任务模板">
        {TEMPLATES.map((template) => (
          <button key={template.id} type="button" className={s.template} onClick={() => applyTemplate(template)}>
            <template.icon size={14} strokeWidth={1.75} />
            {template.label}
          </button>
        ))}
      </div>
    </>
  );
}
