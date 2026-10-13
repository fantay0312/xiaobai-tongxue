/**
 * 记忆 —— 产品里的两份记忆放在同一处，分开讲清楚：
 *   小砚的记忆：你在学习终端提问时，小砚记下的「你」（engine/tutorMemory，存在当前浏览器）；
 *   小白的记忆：你给小白讲课时，小白记住的课和先生（appStore.memory + 事件流）。
 * 导航在终端侧栏里（SidebarPortal）：选哪份记忆、看哪一类，都写进 ?view=memory&tab=…&kind=…。
 * 侧栏收起或手机上没有挂载位时，主区退回两个页签。
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  BadgeCheck, GraduationCap, HeartHandshake, IdCard, LayoutList, MoonStar, NotebookPen, Pin, Plus, Quote, Repeat, SlidersHorizontal,
  Target, TriangleAlert,
} from 'lucide-react';
import { Badge, Segmented, Switch, Tabs, TabPanel } from '../../../components/ui';
import { IconMemory } from '../../../components/ui/icons';
import { XiaoyanPet } from '../../../components/coach/XiaoyanPet';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import { useDreams } from '../../../engine/dreams';
import { TUTOR_MEMORY_KINDS, tutorMemory, useTutorMemory } from '../../../engine/tutorMemory';
import type { TutorMemoryKind } from '../../../engine/tutorMemory';
import { useAppStore } from '../../../store/appStore';
import { SideAction, SideGroup, SideNavItem, SidePanel, SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import { useMediaQuery } from '../shell/views';
import { DreamPanel } from './memory/DreamPanel';
import { TutorMemoryTab } from './memory/TutorMemoryTab';
import type { TutorSlice } from './memory/TutorMemoryTab';
import { XiaobaiMemoryTab } from './memory/XiaobaiMemoryTab';
import { XIAOBAI_SLICES, useXiaobaiMemory } from './memory/useXiaobaiMemory';
import type { XiaobaiSlice } from './memory/useXiaobaiMemory';
import type { TerminalViewProps } from './types';
import s from './memory/memory.module.css';

type MemoryTab = 'xiaoyan' | 'xiaobai';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const KIND_ICON: Record<TutorMemoryKind, ReactNode> = {
  preference: <SlidersHorizontal {...ICON} />,
  goal: <Target {...ICON} />,
  weakness: <TriangleAlert {...ICON} />,
  strength: <BadgeCheck {...ICON} />,
  habit: <Repeat {...ICON} />,
  fact: <IdCard {...ICON} />,
};
const KIND_INTRO: Record<TutorMemoryKind, string> = {
  preference: '你喜欢怎样的讲法。小砚回答时会照着来。',
  goal: '你在为什么而学：考试、升学，或想学会的东西。',
  weakness: '反复问到，或自己说过搞不清的地方。',
  strength: '已经弄懂、不用再从头讲的内容。',
  habit: '你平时怎么学、什么时候学。',
  fact: '专业、年级这类背景。',
};
const XIAOBAI_INTRO: Record<XiaobaiSlice, { title: string; intro: string }> = {
  all: { title: '小白记得的课', intro: '你给小白讲课时，小白记住的课，和他眼里的先生。' },
  lessons: { title: '教过的课', intro: '每门课小白学到多少，隔了几天还记得多少。出师的课不复习会慢慢起雾。' },
  quotes: { title: '金句与心魔', intro: '你打过的比方，和讲课时帮小白清掉的错误想法。' },
  profile: { title: '小白眼里的先生', intro: '小白根据上过的课，对你讲课方式的归纳。' },
  items: { title: '小白记得的事', intro: '上课时一条一条记下的。写得不对可以改，不想让他用可以隐藏。' },
};

const isTutorSlice = (value: string): value is TutorSlice =>
  value === 'all' || value === 'pinned' || TUTOR_MEMORY_KINDS.some((entry) => entry.kind === value);
const isXiaobaiSlice = (value: string): value is XiaobaiSlice => XIAOBAI_SLICES.includes(value as XiaobaiSlice);

export default function MemoryView({ owner, topic, topics, onAsk, onOpenTopic, onView }: TerminalViewProps) {
  const slot = useSidebarSlot();
  // 手机：两份记忆用分段切换，分类是一排横向滑动的签，「添一条」吸在底部
  const phone = useMediaQuery('(max-width: 760px)') && !slot;
  const [params] = useSearchParams();
  const tab: MemoryTab = params.get('tab') === 'xiaobai' ? 'xiaobai' : 'xiaoyan';
  const requested = params.get('kind') ?? 'all';
  // kind=dreams：看这份记忆的梦境（离线整理记录），有没有侧栏都认
  const dreaming = requested === 'dreams';
  // 侧栏收起（桌面）时主区只有两个页签，不分切片；手机上用分类签切片
  const sliced = !!slot || phone;
  const tutorSlice: TutorSlice = sliced && tab === 'xiaoyan' && isTutorSlice(requested) ? requested : 'all';
  const xiaobaiSlice: XiaobaiSlice = sliced && tab === 'xiaobai' && isXiaobaiSlice(requested) ? requested : 'all';
  const [addSignal, setAddSignal] = useState(0);

  const tutorState = useTutorMemory(owner);
  const xiaobai = useXiaobaiMemory(topics);
  const dreams = useDreams(owner);
  const dreamCount = (who: MemoryTab) => dreams.filter((dream) => dream.who === who).length;
  const dreamIntro = tab === 'xiaoyan'
    ? '空闲时，小砚把记着的你重新整理一遍，留下的记录。'
    : '空闲时，小白把你教过的课在梦里回放一遍，留下的记录。';
  const level = useAppStore((st) => st.global.learningLevel);
  const setXiaobaiPaused = useAppStore((st) => st.setMemoryPaused);

  const go = (nextTab: MemoryTab, kind: string = 'all') => onView('memory', { tab: nextTab, ...(kind === 'all' ? {} : { kind }) });
  const countOf = (kind: TutorMemoryKind) => tutorState.items.filter((item) => item.kind === kind).length;
  const pinnedCount = tutorState.items.filter((item) => item.pinned).length;

  // 「添加一条记忆」跟着当前看的那份记忆走：切到有输入框的切片，再把光标放进去
  const startAdd = () => {
    if (dreaming) {
      go(tab, tab === 'xiaobai' ? 'items' : 'all');
    } else if (tab === 'xiaobai') {
      if (xiaobaiSlice !== 'all' && xiaobaiSlice !== 'items') go('xiaobai', 'items');
    } else if (tutorSlice === 'pinned') {
      go('xiaoyan');
    }
    setAddSignal((value) => value + 1);
  };

  const tutorContent = (
    <TutorMemoryTab
      owner={owner}
      topic={topic}
      state={tutorState}
      slice={tutorSlice}
      inlinePause={!slot}
      addSignal={addSignal}
      onAsk={onAsk}
      onOpenTopic={onOpenTopic}
      dock={phone}
    />
  );
  const xiaobaiContent = (
    <XiaobaiMemoryTab
      data={xiaobai}
      slice={xiaobaiSlice}
      topic={topic}
      inlinePause={!slot}
      addSignal={addSignal}
      onOpenTopic={onOpenTopic}
      onView={onView}
      dock={phone}
    />
  );

  const dreamContent = <DreamPanel owner={owner} who={tab} />;

  const sidebar = (
    <SidebarPortal>
      <SidePanel
        title="记忆"
        action={<SideAction icon={<Plus {...ICON} />} onClick={startAdd}>添加一条记忆</SideAction>}
        footer="保存在这个浏览器，按账号分开"
      >
        <SideGroup label="小砚记得的你">
          <SideNavItem
            icon={<IconMemory size={16} />}
            label="全部"
            sub="在学习终端提问时记下的"
            meta={tutorState.items.length || undefined}
            active={tab === 'xiaoyan' && tutorSlice === 'all' && !dreaming}
            onClick={() => go('xiaoyan')}
          />
          {(pinnedCount > 0 || tutorSlice === 'pinned') && (
            <SideNavItem
              icon={<Pin {...ICON} />}
              label="置顶"
              meta={pinnedCount || undefined}
              active={tab === 'xiaoyan' && tutorSlice === 'pinned'}
              onClick={() => go('xiaoyan', 'pinned')}
            />
          )}
          {TUTOR_MEMORY_KINDS.map((entry) => (
            <SideNavItem
              key={entry.kind}
              icon={KIND_ICON[entry.kind]}
              label={entry.label}
              title={entry.hint}
              meta={countOf(entry.kind) || undefined}
              active={tab === 'xiaoyan' && tutorSlice === entry.kind}
              onClick={() => go('xiaoyan', entry.kind)}
            />
          ))}
          <SideNavItem
            icon={<MoonStar {...ICON} />}
            label="小砚的梦"
            title="空闲时把记下的重新整理一遍"
            meta={dreamCount('xiaoyan') || undefined}
            active={tab === 'xiaoyan' && dreaming}
            onClick={() => go('xiaoyan', 'dreams')}
          />
        </SideGroup>
        <SideGroup label="小白记得的课">
          <SideNavItem
            icon={<LayoutList {...ICON} />}
            label="总览"
            sub="给小白讲课时他记住的"
            active={tab === 'xiaobai' && xiaobaiSlice === 'all' && !dreaming}
            onClick={() => go('xiaobai')}
          />
          <SideNavItem
            icon={<GraduationCap {...ICON} />}
            label="教过的课"
            meta={xiaobai.lessons.length || undefined}
            active={tab === 'xiaobai' && xiaobaiSlice === 'lessons'}
            onClick={() => go('xiaobai', 'lessons')}
          />
          <SideNavItem
            icon={<Quote {...ICON} />}
            label="金句与心魔"
            meta={xiaobai.quotes.length + xiaobai.demonCount || undefined}
            active={tab === 'xiaobai' && xiaobaiSlice === 'quotes'}
            onClick={() => go('xiaobai', 'quotes')}
          />
          <SideNavItem
            icon={<HeartHandshake {...ICON} />}
            label="小白眼里的先生"
            active={tab === 'xiaobai' && xiaobaiSlice === 'profile'}
            onClick={() => go('xiaobai', 'profile')}
          />
          <SideNavItem
            icon={<NotebookPen {...ICON} />}
            label="小白记得的事"
            meta={xiaobai.listed || undefined}
            active={tab === 'xiaobai' && xiaobaiSlice === 'items'}
            onClick={() => go('xiaobai', 'items')}
          />
          <SideNavItem
            icon={<MoonStar {...ICON} />}
            label="小白的梦"
            title="梦里回放你教过他的课"
            meta={dreamCount('xiaobai') || undefined}
            active={tab === 'xiaobai' && dreaming}
            onClick={() => go('xiaobai', 'dreams')}
          />
        </SideGroup>
      </SidePanel>
    </SidebarPortal>
  );

  /* ── 有侧栏：主区只放当前切片，页头说明是哪份记忆 ── */
  if (slot) {
    const isTutor = tab === 'xiaoyan';
    const paused = isTutor ? tutorState.paused : xiaobai.paused;
    const heading = dreaming
      ? { title: isTutor ? '小砚的梦' : '小白的梦', intro: dreamIntro }
      : isTutor
      ? tutorSlice === 'all'
        ? { title: '小砚记得的你', intro: '你在学习终端提问时，小砚记下的你：目标、偏好、薄弱点。回答时会参考。' }
        : tutorSlice === 'pinned'
          ? { title: '置顶', intro: '置顶的几条，每次提问都会优先交给小砚。' }
          : { title: TUTOR_MEMORY_KINDS.find((entry) => entry.kind === tutorSlice)?.label ?? '', intro: KIND_INTRO[tutorSlice] }
      : XIAOBAI_INTRO[xiaobaiSlice];
    const pausedNote = isTutor
      ? '记忆已暂停：小砚不再自动记下新内容，回答时也不参考这些记忆。'
      : '记忆已暂停：这段时间上的课，小白不会再记。';

    return (
      <div className={s.root}>
        {sidebar}
        <header className={s.sliceHead}>
          <span className={s.whoFigure}>
            {isTutor ? (
              <XiaoyanPet state="listening" suppressReply title="小砚记得的全部" aria-label="看小砚记得的全部" onClick={() => go('xiaoyan')} />
            ) : (
              <button type="button" className={s.whoAvatar} aria-label="看小白记忆的总览" title="小白记忆的总览" onClick={() => go('xiaobai')}>
                <XiaobaiAvatar mood="happy" level={level} size={52} />
              </button>
            )}
          </span>
          <div className={s.sliceCopy}>
            <p className={s.sliceMark}><IconMemory size={14} />{isTutor ? '小砚的记忆' : '小白的记忆'}</p>
            <h1>{heading.title}{paused && <Badge tone="warn">已暂停</Badge>}</h1>
            <p>{paused ? pausedNote : heading.intro}</p>
          </div>
          <div className={s.sectionSide}>
            <label htmlFor="memory-pause">暂停记忆</label>
            <Switch
              id="memory-pause"
              checked={paused}
              onCheckedChange={(next) => (isTutor ? tutorMemory.setPaused(owner, next) : setXiaobaiPaused(next))}
              label={isTutor ? '暂停小砚的记忆' : '暂停小白的记忆'}
            />
          </div>
        </header>
        <div className={s.slice}>{dreaming ? dreamContent : isTutor ? tutorContent : xiaobaiContent}</div>
      </div>
    );
  }

  /* ── 手机：分段切换 + 分类签 + 当前切片，添加条吸底 ── */
  if (phone) {
    const isTutor = tab === 'xiaoyan';
    const chips: { key: string; label: string; count?: number }[] = isTutor
      ? [
        { key: 'all', label: '全部', count: tutorState.items.length },
        { key: 'dreams', label: '小砚的梦', count: dreamCount('xiaoyan') },
        ...(pinnedCount > 0 || tutorSlice === 'pinned' ? [{ key: 'pinned', label: '置顶', count: pinnedCount }] : []),
        ...TUTOR_MEMORY_KINDS.map((entry) => ({ key: entry.kind, label: entry.label, count: countOf(entry.kind) })),
      ]
      : [
        { key: 'all', label: '总览' },
        { key: 'dreams', label: '小白的梦', count: dreamCount('xiaobai') },
        { key: 'lessons', label: '教过的课', count: xiaobai.lessons.length },
        { key: 'quotes', label: '金句与心魔', count: xiaobai.quotes.length + xiaobai.demonCount },
        { key: 'profile', label: '小白眼里的先生' },
        { key: 'items', label: '小白记得的事', count: xiaobai.listed },
      ];
    const activeKey = dreaming ? 'dreams' : isTutor ? tutorSlice : xiaobaiSlice;
    const intro = dreaming ? dreamIntro : isTutor
      ? tutorSlice === 'all'
        ? '你在学习终端提问时，小砚记下的你：目标、偏好、薄弱点。回答时会参考。'
        : tutorSlice === 'pinned' ? '置顶的几条，每次提问都会优先交给小砚。' : KIND_INTRO[tutorSlice]
      : XIAOBAI_INTRO[xiaobaiSlice].intro;

    return (
      <div className={s.root} data-phone>
        <header className={s.head}>
          <h1>记忆</h1>
          <p>两份记忆分开保存，互不混写。</p>
        </header>
        <Segmented
          block
          label="两份记忆"
          value={tab}
          onChange={(value) => go(value)}
          options={[
            { value: 'xiaoyan', label: '小砚的记忆' },
            { value: 'xiaobai', label: '小白的记忆' },
          ]}
        />
        <nav className={s.kindChips} aria-label={isTutor ? '小砚的记忆分类' : '小白的记忆分类'}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={s.kindChip}
              aria-pressed={chip.key === activeKey}
              onClick={() => go(tab, chip.key)}
            >
              {chip.label}
              {!!chip.count && <span>{chip.count}</span>}
            </button>
          ))}
        </nav>
        <p className={s.sliceNote}>{intro}</p>
        <div className={s.phoneBody}>{dreaming ? dreamContent : isTutor ? tutorContent : xiaobaiContent}</div>
      </div>
    );
  }

  /* ── 没有侧栏（侧栏收起）：两张说明卡 + 两个页签，页签里再分「记忆 / 梦境」 ── */
  const modeSwitch = (
    <div>
      <Segmented
        size="sm"
        label="看记忆还是梦境"
        value={dreaming ? 'dreams' : 'memory'}
        onChange={(value) => go(tab, value === 'dreams' ? 'dreams' : 'all')}
        options={[
          { value: 'memory', label: '记忆' },
          { value: 'dreams', label: tab === 'xiaoyan' ? '小砚的梦' : '小白的梦', icon: <MoonStar size={14} strokeWidth={1.75} /> },
        ]}
      />
    </div>
  );
  return (
    <div className={s.root}>
      {sidebar}
      <header className={s.head}>
        <h1>记忆</h1>
        <p>这里有两份记忆，分开保存，互不混写。</p>
      </header>

      <div className={s.duo}>
        <div className={s.who} data-active={tab === 'xiaoyan' || undefined}>
          <span className={s.whoFigure}>
            <XiaoyanPet
              state={tab === 'xiaoyan' ? 'listening' : 'idle'}
              suppressReply
              title="看小砚的记忆"
              aria-label="看小砚的记忆"
              onClick={() => go('xiaoyan')}
            />
          </span>
          <div className={s.whoCopy}>
            <strong>小砚的记忆</strong>
            <span>你在学习终端提问时，小砚记下的你：目标、偏好、薄弱点。</span>
          </div>
        </div>
        <div className={s.who} data-active={tab === 'xiaobai' || undefined}>
          <span className={s.whoFigure}>
            <button type="button" className={s.whoAvatar} aria-label="看小白的记忆" title="看小白的记忆" onClick={() => go('xiaobai')}>
              <XiaobaiAvatar mood={tab === 'xiaobai' ? 'happy' : 'idle'} level={level} size={52} />
            </button>
          </span>
          <div className={s.whoCopy}>
            <strong>小白的记忆</strong>
            <span>你给小白讲课时，小白记住的课，和他眼里的先生。</span>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => go(value === 'xiaobai' ? 'xiaobai' : 'xiaoyan')}
        variant="pill"
        label="两份记忆"
        items={[
          { value: 'xiaoyan', label: '小砚记得的你', count: tutorState.items.length },
          { value: 'xiaobai', label: '小白记得的课', count: xiaobai.listed },
        ]}
      >
        <TabPanel value="xiaoyan" className={s.panel}>{modeSwitch}{dreaming ? dreamContent : tutorContent}</TabPanel>
        <TabPanel value="xiaobai" className={s.panel}>{modeSwitch}{dreaming ? dreamContent : xiaobaiContent}</TabPanel>
      </Tabs>
    </div>
  );
}
