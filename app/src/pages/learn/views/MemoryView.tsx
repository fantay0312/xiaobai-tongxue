/**
 * 记忆 —— 两个记忆库的浏览器：
 *   小砚的记忆库：她记得的你。来源是整个学习过程（提问、做题、闪卡、笔记、AI 课堂、资料、任务……），不只是对话；
 *   小白的记忆库：你教过他的课。课堂数据只读对账进来，加上他自己的梦。
 * 每个库是一棵 Markdown 文件树：MEMORY.md 是每次都带上的入口，其余文件按需取用；每次写入都是一次提交，可看差异、可撤销。
 * 导航在终端侧栏里（SidebarPortal）：选哪个库、哪个文件、梦境或变更历史，都写进 ?view=memory&repo=…&file=…。
 * 侧栏收起或手机上没有挂载位时，主区用分段切换 + 一排文件签，完整文件树在底部抽屉里。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Dialog as RDialog } from 'radix-ui';
import {
  Archive, BadgeCheck, Ban, BookOpen, FileText, FolderOpen, HeartHandshake, History, IdCard, Library, ListTree, MessageCircleQuestion, MoonStar,
  Plus, Repeat, SlidersHorizontal, Target, TriangleAlert,
} from 'lucide-react';
import { Badge, Segmented, Switch } from '../../../components/ui';
import { IconMemory } from '../../../components/ui/icons';
import { XiaoyanPet } from '../../../components/coach/XiaoyanPet';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import { useActivities } from '../../../engine/activityLog';
import { useDreams } from '../../../engine/dreams';
import { syncXiaobaiRepo } from '../../../engine/memory-repo/xiaobai';
import { REPO_NAMES, fileInfo, folderLabel, listFiles, repoOps, useRepo } from '../../../engine/memoryRepo';
import type { EntrySource, RepoId, RepoState } from '../../../engine/memoryRepo';
import { syncTutorRepo } from '../../../engine/tutorMemory';
import { useAppStore } from '../../../store/appStore';
import { SideAction, SideGroup, SideNavItem, SidePanel, SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import { useMediaQuery } from '../shell/views';
import { DreamPanel } from './memory/DreamPanel';
import { RepoFileView } from './memory/RepoFileView';
import { RepoHistory } from './memory/RepoHistory';
import { RepoHome } from './memory/RepoHome';
import type { TerminalViewProps } from './types';
import s from './memory/memory.module.css';
import r from './memory/repo.module.css';

const DREAMS = '@dreams';
const HISTORY = '@history';
const ICON = { size: 16, strokeWidth: 1.75 } as const;
const FILE_ICON: Record<string, ReactNode> = {
  'MEMORY.md': <IconMemory size={16} />,
  'preferences.md': <SlidersHorizontal {...ICON} />,
  'goals.md': <Target {...ICON} />,
  'weak-points.md': <TriangleAlert {...ICON} />,
  'mastered.md': <BadgeCheck {...ICON} />,
  'habits.md': <Repeat {...ICON} />,
  'materials.md': <Library {...ICON} />,
  'profile.md': <IdCard {...ICON} />,
  'ruled-out.md': <Ban {...ICON} />,
  'archive.md': <Archive {...ICON} />,
  'teacher.md': <HeartHandshake {...ICON} />,
  'questions.md': <MessageCircleQuestion {...ICON} />,
};
const fileIcon = (path: string, folder?: string) => FILE_ICON[path] ?? (folder === 'courses' || folder === 'lessons' ? <BookOpen {...ICON} /> : <FileText {...ICON} />);
const DREAM_NAME: Record<RepoId, string> = { xiaoyan: '小砚的梦', xiaobai: '小白的梦' };
const DREAM_INTRO: Record<RepoId, string> = {
  xiaoyan: '空闲时，小砚把记忆库重新整理一遍，留下的记录。',
  xiaobai: '空闲时，小白把你教过的课在梦里回放一遍，留下的记录。',
};
/** 工作台里各工具的地址名 */
const WORKBENCH_TOOL: Record<string, string> = { note: 'notes', mindmap: 'mindmap', quiz: 'quiz', flashcards: 'flashcards', todo: 'todos', writing: 'writing' };
const noop = () => undefined;

export default function MemoryView({ owner, topic, onOpenTopic, onView }: TerminalViewProps) {
  const slot = useSidebarSlot();
  const phone = useMediaQuery('(max-width: 760px)') && !slot;
  const [params] = useSearchParams();
  // 旧地址 tab=xiaobai / kind=dreams 仍然认
  const repo: RepoId = params.get('repo') === 'xiaobai' || params.get('tab') === 'xiaobai' ? 'xiaobai' : 'xiaoyan';
  const requested = params.get('file') ?? (params.get('kind') === 'dreams' ? DREAMS : 'MEMORY.md');
  const [addSignal, setAddSignal] = useState(0);
  const [treeOpen, setTreeOpen] = useState(false);

  const xiaoyan = useRepo(owner, 'xiaoyan');
  const xiaobai = useRepo(owner, 'xiaobai');
  const state = repo === 'xiaoyan' ? xiaoyan : xiaobai;
  const dreams = useDreams(owner);
  const activities = useActivities(owner);
  const events = useAppStore((st) => st.events);
  const classroom = useAppStore((st) => st.memory);
  const level = useAppStore((st) => st.global.learningLevel);
  const setClassroomPaused = useAppStore((st) => st.setMemoryPaused);

  // 让两个记忆库跟上：读入新的学习行为（不只是对话），对账课堂记录
  useEffect(() => { syncTutorRepo(owner); }, [owner, activities]);
  useEffect(() => { syncXiaobaiRepo(owner); }, [owner, events, classroom]);

  const files = listFiles(state);
  const file = requested === DREAMS || requested === HISTORY || files.some((entry) => entry.path === requested) || (state.files[requested]?.length ?? 0) > 0
    ? requested
    : 'MEMORY.md';
  const go = (nextRepo: RepoId, nextFile: string = 'MEMORY.md') => {
    setTreeOpen(false);
    onView('memory', { repo: nextRepo, ...(nextFile === 'MEMORY.md' ? {} : { file: nextFile }) });
  };
  const paused = repo === 'xiaoyan' ? xiaoyan.paused : classroom.paused;
  const setPaused = (next: boolean) => (repo === 'xiaoyan' ? repoOps.setPaused(owner, 'xiaoyan', next) : setClassroomPaused(next));
  const dreamCount = (who: RepoId) => dreams.filter((dream) => dream.who === who).length;

  // 「添加一条记忆」：梦境和历史页没有输入框，先回到入口文件
  const startAdd = () => {
    if (file === DREAMS || file === HISTORY) go(repo);
    setAddSignal(Date.now());
  };

  /** 出处 → 回到它被记下的地方。我写的、做梦整理的没有可回的地方 */
  const jump = (source: EntrySource): (() => void) | null => {
    const tool = WORKBENCH_TOOL[source.type];
    if (tool) return () => onView('workbench', { tool, ...(source.ref && source.ref.kind !== 'topic' ? { id: source.ref.id } : {}) });
    if (source.type === 'lesson') return () => onView('classroom');
    if (source.type === 'agent') return () => onView('agent');
    if (source.type === 'research') return () => onView('research');
    if (source.type === 'library') return () => onView('library');
    const topicId = source.topicId;
    if (source.type === 'teach' || source.type === 'exam') return topicId ? () => onOpenTopic(topicId) : () => onView('feynman');
    if (topicId) return () => onOpenTopic(topicId);
    if (source.type === 'chat') return () => onView('ask');
    return null;
  };

  const info = file === DREAMS || file === HISTORY ? null : fileInfo(repo, file, state.titles);
  const heading = file === DREAMS
    ? { title: DREAM_NAME[repo], intro: DREAM_INTRO[repo] }
    : file === HISTORY
      ? { title: '变更历史', intro: '记忆库的每一次写入：是自动记下的、你亲手改的，还是做梦整理的，改了哪几行。可以逐次撤销。' }
      : { title: info?.folder ? `${folderLabel(info.folder)} · ${info.title}` : info?.title ?? '', intro: info?.hint ?? '' };
  const pausedNote = repo === 'xiaoyan'
    ? '记忆已暂停：不再记入新的学习行为，回答时也不带记忆。'
    : '记忆已暂停：这段时间上的课，小白不会再记。';

  const content = file === DREAMS ? (
    <DreamPanel owner={owner} who={repo} />
  ) : file === HISTORY ? (
    <RepoHistory owner={owner} repo={repo} state={state} onOpenFile={(path) => go(repo, path)} />
  ) : (
    <>
      {repo === 'xiaobai' && file === 'MEMORY.md' && (
        <section className={s.storyCard} data-story aria-label="小白的话">
          <XiaobaiAvatar mood={files.some((entry) => entry.folder === 'lessons') ? 'happy' : 'curious'} level={level} size={72} />
          <div>
            <p className={s.storyQuote}>
              {files.some((entry) => entry.folder === 'lessons')
                ? '先生教过我的课、打过的比方、我想通和没想通的地方，都记在这个小本子里。'
                : '先生还没给我讲过课。讲完第一课，这个小本子里就有东西了。'}
            </p>
            <p className={s.storySign}>—— 小白</p>
          </div>
        </section>
      )}
      <RepoFileView
        owner={owner}
        repo={repo}
        state={state}
        path={file}
        dock={phone}
        addSignal={addSignal}
        onOpenFile={(path) => go(repo, path)}
        jump={jump}
      />
      {file === 'MEMORY.md' && <RepoHome owner={owner} repo={repo} state={state} paused={paused} topic={topic} />}
    </>
  );

  const figure = repo === 'xiaoyan' ? (
    <XiaoyanPet state="listening" suppressReply title="回到小砚记忆库的入口" aria-label="回到小砚记忆库的入口" onClick={() => go('xiaoyan')} />
  ) : (
    <button type="button" className={s.whoAvatar} aria-label="回到小白记忆库的入口" title="回到小白记忆库的入口" onClick={() => go('xiaobai')}>
      <XiaobaiAvatar mood="happy" level={level} size={52} />
    </button>
  );
  const pauseSwitch = (
    <div className={s.sectionSide}>
      <label htmlFor="memory-pause">暂停记忆</label>
      <Switch id="memory-pause" checked={paused} onCheckedChange={setPaused} label={repo === 'xiaoyan' ? '暂停小砚的记忆' : '暂停小白的记忆'} />
    </div>
  );

  /** 一个库的文件树：顶层文件、文件夹里的文件、梦境、变更历史 */
  const tree = (id: RepoId, repoState: RepoState) => {
    const list = listFiles(repoState);
    const folders = [...new Set(list.flatMap((entry) => (entry.folder ? [entry.folder] : [])))];
    const active = (target: string) => repo === id && file === target;
    return (
      <SideGroup label={REPO_NAMES[id]}>
        {list.filter((entry) => !entry.folder).map((entry) => (
          <SideNavItem
            key={entry.path}
            icon={fileIcon(entry.path)}
            label={entry.title}
            sub={entry.path === 'MEMORY.md' ? (id === 'xiaoyan' ? '每次回答都带上的要点' : '小白心里的先生') : undefined}
            title={entry.path}
            meta={entry.count || undefined}
            active={active(entry.path)}
            onClick={() => go(id, entry.path)}
          />
        ))}
        {folders.map((folder) => [
          <SideNavItem key={folder} icon={<FolderOpen {...ICON} />} label={folderLabel(folder)} disabled onClick={noop} />,
          ...list.filter((entry) => entry.folder === folder).map((entry) => (
            <SideNavItem
              key={entry.path}
              indent={1}
              label={entry.title}
              title={entry.path}
              meta={entry.count || undefined}
              active={active(entry.path)}
              onClick={() => go(id, entry.path)}
            />
          )),
        ])}
        <SideNavItem
          icon={<MoonStar {...ICON} />}
          label={DREAM_NAME[id]}
          title="空闲时把记忆库重新整理一遍"
          meta={dreamCount(id) || undefined}
          active={active(DREAMS)}
          onClick={() => go(id, DREAMS)}
        />
        <SideNavItem
          icon={<History {...ICON} />}
          label="变更历史"
          title="每一次写入：谁写的、改了哪几行"
          meta={repoState.commits.length || undefined}
          active={active(HISTORY)}
          onClick={() => go(id, HISTORY)}
        />
      </SideGroup>
    );
  };

  const sidebar = (
    <SidebarPortal>
      <SidePanel
        title="记忆"
        action={<SideAction icon={<Plus {...ICON} />} onClick={startAdd}>添加一条记忆</SideAction>}
        footer="保存在这个浏览器，按账号分开"
      >
        {tree('xiaoyan', xiaoyan)}
        {tree('xiaobai', xiaobai)}
      </SidePanel>
    </SidebarPortal>
  );

  /* ── 有侧栏：主区只放选中的文件，页头说明是哪个库、哪个文件 ── */
  if (slot) {
    return (
      <div className={s.root}>
        {sidebar}
        <header className={s.sliceHead}>
          <span className={s.whoFigure}>{figure}</span>
          <div className={s.sliceCopy}>
            <p className={s.sliceMark}><IconMemory size={14} />{REPO_NAMES[repo]}</p>
            <h1>{heading.title}{paused && <Badge tone="warn">已暂停</Badge>}</h1>
            <p>{paused ? pausedNote : heading.intro}</p>
          </div>
          {pauseSwitch}
        </header>
        <div className={s.slice}>{content}</div>
      </div>
    );
  }

  /* ── 没有侧栏（手机、侧栏收起）：分段切换两个库 + 一排文件签；完整文件树在底部抽屉里 ── */
  const chips = [
    ...files.filter((entry) => !entry.folder).map((entry) => ({ key: entry.path, label: entry.title, count: entry.count })),
    { key: DREAMS, label: DREAM_NAME[repo], count: dreamCount(repo) },
    { key: HISTORY, label: '变更历史', count: state.commits.length },
  ];
  const inFolder = files.filter((entry) => entry.folder);
  return (
    <div className={s.root} data-phone={phone || undefined}>
      {sidebar}
      <header className={`${s.head} ${s.sectionHead}`}>
        <div>
          <h1>记忆</h1>
          <p>两个记忆库分开保存，互不混写。</p>
        </div>
        {pauseSwitch}
      </header>
      <Segmented
        block
        label="两个记忆库"
        value={repo}
        onChange={(value) => go(value)}
        options={[
          { value: 'xiaoyan', label: REPO_NAMES.xiaoyan },
          { value: 'xiaobai', label: REPO_NAMES.xiaobai },
        ]}
      />
      <nav className={s.kindChips} aria-label={`${REPO_NAMES[repo]}的文件`}>
        {inFolder.length > 0 && (
          <button type="button" className={s.kindChip} aria-pressed={inFolder.some((entry) => entry.path === file)} onClick={() => setTreeOpen(true)}>
            <ListTree size={15} strokeWidth={1.75} />
            全部文件
            <span>{files.length}</span>
          </button>
        )}
        {chips.map((chip) => (
          <button key={chip.key} type="button" className={s.kindChip} aria-pressed={chip.key === file} onClick={() => go(repo, chip.key)}>
            {chip.label}
            {!!chip.count && <span>{chip.count}</span>}
          </button>
        ))}
      </nav>
      <p className={s.sliceNote}>
        {info?.folder ? <strong>{folderLabel(info.folder)} · {info.title}　</strong> : null}
        {paused ? pausedNote : heading.intro}
      </p>
      <div className={s.phoneBody}>{content}</div>

      <RDialog.Root open={treeOpen} onOpenChange={setTreeOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className={r.sheetOverlay} />
          <RDialog.Content className={r.sheet} aria-describedby={undefined}>
            <span className={r.sheetGrip} aria-hidden="true" />
            <RDialog.Title className={r.sheetTitle}>{REPO_NAMES[repo]}</RDialog.Title>
            <div className={r.sheetBody}>
              {files.filter((entry) => !entry.folder).map((entry) => (
                <button key={entry.path} type="button" className={r.sheetItem} aria-current={entry.path === file ? 'page' : undefined} onClick={() => go(repo, entry.path)}>
                  {fileIcon(entry.path)}
                  <span>{entry.title}</span>
                  {!!entry.count && <em>{entry.count}</em>}
                </button>
              ))}
              {[...new Set(inFolder.map((entry) => entry.folder!))].map((folder) => (
                <div key={folder}>
                  <p className={r.sheetFolder}>{folderLabel(folder)}</p>
                  {inFolder.filter((entry) => entry.folder === folder).map((entry) => (
                    <button key={entry.path} type="button" className={r.sheetItem} data-indent aria-current={entry.path === file ? 'page' : undefined} onClick={() => go(repo, entry.path)}>
                      {fileIcon(entry.path, folder)}
                      <span>{entry.title}</span>
                      {!!entry.count && <em>{entry.count}</em>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </div>
  );
}
