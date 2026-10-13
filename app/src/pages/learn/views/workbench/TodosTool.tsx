import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button, Empty, IconButton, Input, Popover, PopoverContent, PopoverTrigger, Progress, Segmented, toast } from '../../../../components/ui';
import { studyData, useStudyData, type Todo } from '../../../../store/studyData';
import { GenerateDialog, ICON_SM, OriginBadge, TOOLS, ToolHead, type ToolProps } from './shared';
import { addDays, clip, dayDiff, dayKey, dayLabel, dueDay, matches } from './util';
import s from './workbench.module.css';
import t from './todos.module.css';

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

/** 日期选择：几个常用日子 + 一张月历 */
function DuePicker({ value, onChange, children }: { value: string | null; onChange: (value: string | null) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const today = dayKey();
  const pick = (next: string | null) => { onChange(next); setOpen(false); };
  const first = new Date(cursor.year, cursor.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: count }, (_, index) => dayKey(new Date(cursor.year, cursor.month, index + 1))),
  ];
  const shift = (step: number) => setCursor((current) => {
    const next = new Date(current.year, current.month + step, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  const weekend = dayKey(addDays((6 - new Date().getDay() + 7) % 7 || 7));
  const quick: { label: string; value: string | null }[] = [
    { label: '今天', value: today },
    { label: '明天', value: dayKey(addDays(1)) },
    { label: '本周六', value: weekend },
    { label: '下周', value: dayKey(addDays(7)) },
    { label: '不定', value: null },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent size="sm" align="end" className={t.picker}>
        <div className={s.chips}>
          {quick.map((item) => (
            <button key={item.label} type="button" className={s.chip} aria-pressed={item.value === value} onClick={() => pick(item.value)}>{item.label}</button>
          ))}
        </div>
        <div className={t.calHead}>
          <IconButton label="上个月" size="sm" tip={false} onClick={() => shift(-1)}><ChevronLeft {...ICON_SM} /></IconButton>
          <span>{cursor.year} 年 {cursor.month + 1} 月</span>
          <IconButton label="下个月" size="sm" tip={false} onClick={() => shift(1)}><ChevronRight {...ICON_SM} /></IconButton>
        </div>
        <div className={t.cal}>
          {WEEK_HEAD.map((name) => <span key={name} className={t.calWeek}>{name}</span>)}
          {cells.map((key, index) => (key ? (
            <button
              key={key}
              type="button"
              className={t.calDay}
              data-today={key === today}
              data-past={key < today}
              aria-pressed={key === value}
              aria-label={key}
              onClick={() => pick(key)}
            >
              {Number(key.slice(8))}
            </button>
          ) : <span key={`blank-${index}`} />))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DueChip({ value, done, onChange }: { value: string | null; done?: boolean; onChange: (value: string | null) => void }) {
  const overdue = Boolean(value) && !done && dayDiff(value as string) < 0;
  return (
    <DuePicker value={value} onChange={onChange}>
      <button type="button" className={t.due} data-set={Boolean(value)} data-overdue={overdue} aria-label={value ? `日期 ${dayLabel(value)}，点击修改` : '设置日期'}>
        <CalendarDays size={14} strokeWidth={1.75} />
        {value ? (overdue ? `逾期 ${-dayDiff(value)} 天` : dayLabel(value)) : '日期'}
      </button>
    </DuePicker>
  );
}

export default function TodosTool(props: ToolProps) {
  const { owner, topic, topics, onOpenTopic } = props;
  const { todos } = useStudyData(owner);
  const [text, setText] = useState('');
  const [due, setDue] = useState<string | null>(() => dayKey());
  const [linked, setLinked] = useState(true);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'course'>('all');
  const [showDone, setShowDone] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [closing, setClosing] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const today = dayKey();

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach((timer) => clearTimeout(timer)); };
  }, []);

  const groups = useMemo(() => {
    const visible = todos.filter((todo) => (scope === 'all' || !topic || todo.topicId === topic.topicId) && matches(query, todo.text));
    const open = visible.filter((todo) => !todo.done);
    const key = (todo: Todo) => dueDay(todo.due);
    const byDue = (a: Todo, b: Todo) => (key(a) ?? '9999').localeCompare(key(b) ?? '9999');
    return {
      today: open.filter((todo) => { const day = key(todo); return day !== null && day <= today; }).sort(byDue),
      upcoming: open.filter((todo) => { const day = key(todo); return day === null || day > today; }).sort(byDue),
      done: visible.filter((todo) => todo.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    };
  }, [todos, scope, topic, query, today]);

  const doneToday = todos.filter((todo) => todo.done && todo.doneAt && dayKey(todo.doneAt) === today).length;
  const openToday = todos.filter((todo) => { const day = dueDay(todo.due); return !todo.done && day !== null && day <= today; }).length;
  const dayTotal = doneToday + openToday;

  const add = (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value) { inputRef.current?.focus(); return; }
    studyData.addTodo(owner, { text: value.slice(0, 200), ...(due ? { due } : {}), ...(topic && linked ? { topicId: topic.topicId } : {}) });
    setText('');
    inputRef.current?.focus();
  };

  const toggle = (todo: Todo) => {
    if (todo.done) { studyData.updateTodo(owner, todo.id, { done: false }); return; }
    if (closing.includes(todo.id)) return;
    // 先播放勾选和划线，再挪到「已完成」
    setClosing((current) => [...current, todo.id]);
    timers.current.set(todo.id, setTimeout(() => {
      studyData.updateTodo(owner, todo.id, { done: true });
      setClosing((current) => current.filter((id) => id !== todo.id));
      timers.current.delete(todo.id);
    }, 460));
  };

  const remove = (todo: Todo) => {
    studyData.removeTodo(owner, todo.id);
    toast(`已删除「${clip(todo.text, 16)}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          const restored = studyData.addTodo(owner, { text: todo.text, due: todo.due, topicId: todo.topicId, origin: todo.origin });
          if (todo.done) studyData.updateTodo(owner, restored.id, { done: true });
        },
      },
    });
  };

  const row = (todo: Todo) => {
    const course = todo.topicId ? topics.find((item) => item.topicId === todo.topicId) : undefined;
    const checked = todo.done || closing.includes(todo.id);
    return (
      <li key={todo.id} className={t.row} data-done={checked} data-closing={closing.includes(todo.id)}>
        <button type="button" className={t.check} role="checkbox" aria-checked={checked} aria-label={checked ? '标为未完成' : '标为完成'} onClick={() => toggle(todo)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" /></svg>
        </button>
        <div className={t.main}>
          <TodoText key={todo.text} text={todo.text} onChange={(value) => studyData.updateTodo(owner, todo.id, { text: value })} />
          {(course || todo.origin !== 'user') && (
            <div className={t.tags}>
              {course && (
                <button type="button" className={t.course} onClick={() => onOpenTopic(course.topicId)} title="打开这门课">
                  <BookOpen size={12} strokeWidth={1.75} />{clip(course.title, 14)}
                </button>
              )}
              <OriginBadge origin={todo.origin} />
            </div>
          )}
        </div>
        <DueChip value={dueDay(todo.due)} done={todo.done} onChange={(value) => studyData.updateTodo(owner, todo.id, { due: value ?? undefined })} />
        <span className={t.del}>
          <IconButton label="删除" size="sm" tip={false} onClick={() => remove(todo)}><Trash2 {...ICON_SM} /></IconButton>
        </span>
      </li>
    );
  };

  const Icon = TOOLS.todos.icon;
  const nothing = todos.length === 0;
  const filteredOut = !nothing && !groups.today.length && !groups.upcoming.length && !groups.done.length;

  return (
    <>
      <ToolHead tool="todos">
        <Button variant="soft" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>AI 生成</Button>
      </ToolHead>

      <div className={t.wrap}>
        <form className={t.add} onSubmit={add}>
          <Plus size={18} strokeWidth={1.75} className={t.addIcon} />
          <input
            ref={inputRef}
            className={t.addInput}
            value={text}
            maxLength={200}
            placeholder="添加一件要学的事，回车确认"
            aria-label="添加待办"
            onChange={(event) => setText(event.target.value)}
          />
          <div className={t.addTools}>
            {topic && (
              <button type="button" className={t.due} data-set={linked} aria-pressed={linked} onClick={() => setLinked((value) => !value)} title={linked ? `关联本课：${topic.title}` : '不关联课程'}>
                <BookOpen size={14} strokeWidth={1.75} />{linked ? clip(topic.title, 8) : '不关联'}
              </button>
            )}
            <DueChip value={due} onChange={setDue} />
            <Button type="submit" variant="solid" disabled={!text.trim()}>添加</Button>
          </div>
        </form>

        {nothing ? (
          <div className={s.emptyCard}>
            <Empty
              icon={<Icon size={22} strokeWidth={1.75} />}
              title="今天打算学点什么"
              description="把要做的事写成一条条小任务：读哪一节、做哪组题、给小白讲哪一课。也可以让小砚按本课排好。"
              action={(
                <>
                  <Button variant="solid" icon={<Plus {...ICON_SM} />} onClick={() => inputRef.current?.focus()}>写第一条待办</Button>
                  <Button variant="soft" icon={<Sparkles {...ICON_SM} />} onClick={() => setGenOpen(true)}>让小砚排计划</Button>
                </>
              )}
            />
          </div>
        ) : (
          <>
            <div className={t.bar}>
              <div className={t.dayProgress}>
                <span>今天 <b>{doneToday}</b> / {dayTotal} 项完成</span>
                <Progress value={doneToday} max={Math.max(1, dayTotal)} tone={dayTotal > 0 && doneToday === dayTotal ? 'ok' : 'accent'} label="今天的完成进度" />
              </div>
              <div className={t.filters}>
                {topic && <Segmented size="sm" label="按课程筛选" value={scope} onChange={setScope} options={[{ value: 'all', label: '全部' }, { value: 'course', label: '本课' }]} />}
                <Input size="sm" wrapClassName={t.search} leading={<Search {...ICON_SM} />} placeholder="搜索待办" aria-label="搜索待办" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>

            {filteredOut && <p className={t.none}>没有符合条件的待办。</p>}

            {groups.today.length > 0 && (
              <section className={t.group}>
                <h3>今天<span>{groups.today.length}</span></h3>
                <ul className={t.list}>{groups.today.map(row)}</ul>
              </section>
            )}
            {!groups.today.length && !filteredOut && dayTotal > 0 && doneToday === dayTotal && (
              <p className={t.clear}>今天的事都做完了。</p>
            )}
            {groups.upcoming.length > 0 && (
              <section className={t.group}>
                <h3>接下来<span>{groups.upcoming.length}</span></h3>
                <ul className={t.list}>{groups.upcoming.map(row)}</ul>
              </section>
            )}
            {groups.done.length > 0 && (
              <section className={t.group}>
                <h3>
                  <button type="button" className={t.fold} aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}>
                    <ChevronRight size={14} strokeWidth={2} />已完成<span>{groups.done.length}</span>
                  </button>
                </h3>
                {showDone && <ul className={t.list}>{groups.done.map(row)}</ul>}
              </section>
            )}
          </>
        )}
      </div>

      <GenerateDialog kind="todos" open={genOpen} onOpenChange={setGenOpen} view={props} />
    </>
  );
}

/** 待办文字：点一下就地修改 */
function TodoText({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  if (!editing) {
    return <button type="button" className={t.text} onClick={() => setEditing(true)} title="点击修改">{text}</button>;
  }
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== text) onChange(next.slice(0, 200));
    else setValue(text);
  };
  return (
    <input
      className={t.textInput}
      value={value}
      autoFocus
      aria-label="修改待办"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit();
        if (event.key === 'Escape') { setValue(text); setEditing(false); }
      }}
    />
  );
}
