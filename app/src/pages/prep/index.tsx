/**
 * 备课流程 /prep/:topicId —— 学习终端里的「备课流程」视图，费曼四步（备课 → 上课 → 赴考 → 复盘）的第一步。
 * 五步，一次只摊开一步：
 *   1 摸底快测（两波：误区判断题 → 多维选择题，逐题即时反馈，可重新摸底，计分合并）
 *   2 教学任务卡  3 讲课路线图（教学大纲 + 小白的追问原话）
 *   4 研读材料包（微课讲义、图解、例题、误区剧本、视频、书单）  5 备课自检（给自己点头，不锁讲解舱）
 * 摸完底就放行：可以去给小白上课，也可以只备课回学习终端。状态只经 store(completePrep)。
 * 学法四选一：通读、跟读复述、例题先行、只补不会的。备课夹只给老师和小砚。
 * 顶部吸顶条 = 五步进度 + 备课度；点已解锁的一步直接跳过去。
 * 右下角常驻备课助教「小砚」(PrepCoach)——只在备课时出现，课堂(/teach)是防作弊红线。
 * 小白坐在课题旁：表情与一句话随摸底、读材料、自检实时变；小砚拿到同一份备课情境。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ClipboardList, Clock, ExternalLink, Flame, Play, RotateCcw, Route, X,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { getTopic } from '../../data';
import { hydrateTeacherRuntimeTopic } from '../../data/runtimeTopics';
import { currentAuthEpoch } from '../../lib/api';
import { getTeacherCustomTopic } from '../../lib/customContent';
// 记忆回执:engine/recall 纯派生(不进 barrel),按路径直连
import { deriveTopicRecall } from '../../engine/recall';
// 学伴记忆:课级长短板与讲课习惯,≤2 行进记忆回执(不进 barrel,按路径直连)
import { retrieveMemories } from '../../engine/learnerMemory';
import type { PrepContext } from '../../engine/coach';
import {
  gapsView, loadDesk, orderExamples, PREP_METHODS, revealedLecture, saveDesk,
  splitLecture, visibleSegmentCount, weakPointNames, walkthroughLocked,
} from '../../engine/prepDesk';
import { getSelfTest } from '../../data/selfTest';
import { getFigures } from '../../components/diagrams';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { PrepCoach } from '../../components/coach/PrepCoach';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Tour, type TourStep } from '../../components/tour/Tour';
import { Badge, Button, IconButton, Progress, Shimmer, cx, toast } from '../../components/ui';
import type { Misconception, QuestionLevel, XiaobaiMood } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAllTopics } from '../../hooks/useAllTopics';
import { codeLanguage, deriveTeachingFlow, lectureMarkdown } from './flow';
import {
  ExampleStudy, GapMarks, GapsHold, MethodBar, PrepFolder, RehearseEntry, RetellLecture,
} from './deskUi';
import {
  Collapse, JourneyBar, PrepExits, RecallCard, StepHead, StepNav, WeakPoints, type StepState,
} from './flowUi';
import s from './prep.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** 追问层级 → 路线图徽章文案(checklist 无 L4;L4 = 误区注入,以途中试探标记呈现) */
const LEVEL_META: Record<QuestionLevel, string> = {
  L1: '澄清',
  L2: '举例',
  L3: '边界',
  L4: '试探',
  L5: '迁移',
};

/** 五步的稳定锚点;顶部进度条据此跳步,引路也指这些 id */
const SECTIONS = [
  { id: 'prep-sec-1', name: '摸底快测' },
  { id: 'prep-sec-2', name: '教学任务卡' },
  { id: 'prep-sec-3', name: '讲课路线图' },
  { id: 'prep-sec-4', name: '研读材料包' },
  { id: 'prep-sec-5', name: '备课自检' },
] as const;

/** 费曼四步:备课是第一步 */
const LOOP = ['备课', '上课', '赴考', '复盘'] as const;

/** 备课引路(称「先生」):只指首访就在场的三处——后四步要摸完底才解锁,不硬指 */
const PREP_TOUR: TourStep[] = [
  {
    target: `#${SECTIONS[0].id}`,
    title: '先摸个底',
    text: '先摸底,看看自己站在哪。摸完就可以读材料、合上这课,也可以去讲给小白听。',
  },
  {
    target: '[data-tour="prep-steps"]',
    title: '备课五步',
    text: '温书按这五步走:摸底、任务卡、路线图、材料包、自检。走到哪儿这里亮到哪儿,亮开的一步点一下就能跳过去。五步走完不必上讲台。',
  },
  {
    target: '[data-tour="coach"]',
    title: '备课助教小砚',
    text: '卡住了就点它。小砚只陪你把这一课读懂,不进讲解舱,问答也不落进课堂记录。',
  },
];

/** 视频出处的人话名(域名 → 平台名;未知域名原样给 hostname) */
function videoHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('bilibili.com') || host === 'b23.tv') return '哔哩哔哩';
    return host;
  } catch {
    return '';
  }
}

/** 例题与错题的相关性:命中该误区的纠正关键词或误区表述即视为相关 */
function relatedToWrong(text: string, wrong: Misconception[]): boolean {
  return wrong.some(
    (mc) =>
      text.includes(mc.belief) ||
      mc.correctionKeywords.flat().some((kw) => kw.length > 1 && text.includes(kw)),
  );
}

/** 小白在页头的状态:表情 + 一句话,全部从备课进度派生(答题瞬间另有 2.4s 的即时反应) */
interface PupilState { mood: XiaobaiMood; line: string }

function derivePupil(input: {
  title: string;
  started: boolean;
  quizDone: boolean;
  allCorrect: boolean;
  wrongCount: number;
  studyOpen: boolean;
  method: 'read' | 'retell' | 'examples' | 'gaps';
  weakMarkCount: number;
  section: string;
  allChecked: boolean;
  checkedCount: number;
}): PupilState {
  const { title, started, quizDone, allCorrect, wrongCount, studyOpen, method, weakMarkCount, section, allChecked, checkedCount } = input;
  if (allChecked) return { mood: 'happy', line: '这课可以合上了。想讲的话,我在讲解舱等你。' };
  if (!started) return { mood: 'curious', line: `先生先温「${title}」。讲不讲,等你自己定。` };
  if (!quizDone) return { mood: 'curious', line: '先生慢慢答,我就在旁边看着——这些说法我有一半也分不清。' };
  if (allCorrect && !studyOpen) return { mood: 'happy', line: '先生全对。材料再翻一翻也值,不翻也可以先合上。' };
  if (section === '讲课路线图' && method === 'gaps') {
    return {
      mood: 'curious',
      line: weakMarkCount > 0
        ? '先生标不会的地方，我课上会从那儿问起。'
        : '先生在路线图上标一会、模糊、不会。全标会也可以先合上。',
    };
  }
  if (section === '研读材料包' && method === 'retell') {
    return { mood: 'thinking', line: '先生先用自己的话说一句，我再跟下一段。' };
  }
  if (section === '备课自检') {
    return {
      mood: checkedCount > 0 ? 'aha' : 'thinking',
      line: checkedCount > 0 ? '先生点一次头,我就在旁边把这一课记牢一点。' : '清单是给先生自己点的,不点也能合上。',
    };
  }
  if (section === '研读材料包') return { mood: 'thinking', line: '先生慢慢读。这段读通了,比赶去讲台要紧。' };
  if (section === '讲课路线图') return { mood: 'curious', line: '这些是这一课的骨头。先生顺着看,不用赶。' };
  if (section === '教学任务卡') return { mood: 'curious', line: '这张卡写的是这一课的靶心,先生先自己对准。' };
  if (wrongCount > 0) {
    return { mood: 'confused', line: `有 ${wrongCount} 处我也是这么想的……先生翻翻材料,别让咱俩一起绕进去。` };
  }
  return { mood: 'thinking', line: '判断都稳,选择题露了点怯——先生把材料翻一翻,我课上会从那儿问起。' };
}

/** 答题瞬间的即时反应(2.4s 后回到状态句) */
const REACT_GOOD: PupilState[] = [
  { mood: 'happy', line: '先生这题稳。' },
  { mood: 'aha', line: '哦——原来是这样,我记下了。' },
  { mood: 'happy', line: '先生一答,我就更放心了。' },
];
const REACT_BAD: PupilState[] = [
  { mood: 'confused', line: '咦,这条我也这么想的……先生要不再看看?' },
  { mood: 'shy', line: '先生别急,这个坑我课上八成也会掉。' },
  { mood: 'confused', line: '那……到底是哪儿不对呀?' },
];
const TEACHER_TOPIC_RETRY_MS = [750, 1_500] as const;

export default function PrepPage() {
  const { topicId = '' } = useParams();
  // 按知识点重挂载:路由参数变化时 React Router 复用同一元素,摸底作答/自检勾选/
  // submittedRef 会带着上一个知识点的状态给新知识点判分——key 强制全部归零
  return <PrepRoom key={topicId} topicId={topicId} />;
}

function PrepRoom({ topicId }: { topicId: string }) {
  const navigate = useNavigate();
  const studentTopic = getTopic(topicId);
  const customTopic = topicId.startsWith('custom-');
  const authUser = useAuthStore((state) => state.user);
  const teacherRequestKey = `${authUser ?? ''}:${topicId}`;
  const [teacherTopicState, setTeacherTopicState] = useState<{
    key: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
    topic: typeof studentTopic;
  }>({ key: '', status: 'idle', topic: undefined });
  useEffect(() => {
    if (!customTopic) {
      setTeacherTopicState({ key: '', status: 'idle', topic: undefined });
      return undefined;
    }
    if (!authUser) {
      setTeacherTopicState({ key: teacherRequestKey, status: 'loading', topic: undefined });
      return undefined;
    }
    const controller = new AbortController();
    const requestEpoch = currentAuthEpoch();
    setTeacherTopicState({ key: teacherRequestKey, status: 'loading', topic: undefined });
    void (async () => {
      for (let attempt = 0; attempt <= TEACHER_TOPIC_RETRY_MS.length; attempt += 1) {
        try {
          const record = await getTeacherCustomTopic(topicId, controller.signal);
          if (controller.signal.aborted || requestEpoch !== currentAuthEpoch()) return;
          const hydrated = record.topicId === topicId && record.payload?.topicId === topicId
            ? hydrateTeacherRuntimeTopic(record.payload)
            : null;
          if (!hydrated || hydrated.topicId !== topicId) throw new Error('teacher-topic-invalid');
          setTeacherTopicState({ key: teacherRequestKey, status: 'ready', topic: hydrated });
          return;
        } catch {
          if (controller.signal.aborted || requestEpoch !== currentAuthEpoch()) return;
          const delay = TEACHER_TOPIC_RETRY_MS[attempt];
          if (delay === undefined) break;
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }
      }
      if (!controller.signal.aborted && requestEpoch === currentAuthEpoch()) {
        setTeacherTopicState({ key: teacherRequestKey, status: 'error', topic: undefined });
      }
    })();
    return () => controller.abort();
  }, [authUser, customTopic, teacherRequestKey, topicId]);
  const currentTeacherTopicState = teacherTopicState.key === teacherRequestKey
    ? teacherTopicState
    : { key: teacherRequestKey, status: 'loading' as const, topic: undefined };
  const topic = customTopic ? currentTeacherTopicState.topic : studentTopic;
  useDocTitle(topic ? `灯下温书 · ${topic.title}` : undefined);
  const usable = !!topic && !topic.locked;
  const completePrep = useAppStore((st) => st.completePrep);
  const prepDone = useAppStore((st) => st.topicStates[topicId]?.prepDone ?? false);
  const level = useAppStore((st) => st.global.learningLevel);
  const customTopicsStatus = useAppStore((st) => st.customTopicsStatus);
  // 记忆回执数据源:事件流 / 报告 / 主题状态(备课页原本不订阅,此处按需取,不改 store)
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);
  const memory = useAppStore((st) => st.memory);
  const allTopics = useAllTopics();

  /** 摸底第一波(判断题):已作答的选择(true=判"对",false=判"错") */
  const [answers, setAnswers] = useState<boolean[]>([]);
  /** 摸底第二波(多维选择题):已选项的下标,逐题追加 */
  const [mcAnswers, setMcAnswers] = useState<number[]>([]);
  /** 读屏播报:最近一次判分结果(常驻 aria-live 区,答题瞬间按钮禁用不卸载,焦点不丢) */
  const [liveMsg, setLiveMsg] = useState('');
  /** 全对时用户仍选择过一遍材料 */
  const [wantMaterials, setWantMaterials] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([]);
  /** 当前摊开的一步(一次只摊开一步) */
  const [currentId, setCurrentId] = useState<string>(SECTIONS[0].id);
  /** 走到过的最远一步:只读不答的两步(任务卡、路线图)走过了才算完成 */
  const [reached, setReached] = useState(0);
  /** 跳步后把新的一步滚到进度条下方,并把焦点交给它的标题 */
  const [scrollTick, setScrollTick] = useState(0);
  const scrollTarget = useRef<string | null>(null);
  /** 材料包里翻开过的册子(标题去重) */
  const [opened, setOpened] = useState<string[]>([]);
  /** 小白的即时反应(答题瞬间),2.4s 后清空 */
  const [reaction, setReaction] = useState<PupilState | null>(null);
  /** 连对计数(本轮摸底) */
  const [streak, setStreak] = useState(0);
  /** 案头计时:坐下多少分钟 */
  const [minutesOnDesk, setMinutesOnDesk] = useState(0);
  const [desk, setDesk] = useState(() => loadDesk(topicId));
  const [coachAsk, setCoachAsk] = useState<{ mode: 'rehearse'; nonce: number } | null>(null);
  const submittedRef = useRef(false);
  /** 右下角的小砚会压住内容右缘:量出重叠宽度,给内容让出一条道(窄屏不让,靠底部留白) */
  const pageRef = useRef<HTMLDivElement>(null);
  const [petGutter, setPetGutter] = useState(0);
  const lectureBody = topic?.prep.microLecture.body ?? '';
  const lectureSegments = useMemo(() => splitLecture(lectureBody), [lectureBody]);
  useEffect(() => {
    saveDesk(topicId, desk);
  }, [desk, topicId]);

  /* 派生态提前算(hooks 必须在提前 return 之前):不可用主题一律给空 */
  // 记忆回执:首学该课(零事件)deriveTopicRecall 返回 null → 顶部纸条完全不渲染
  const recall = useMemo(
    () => (usable ? deriveTopicRecall({ topicId, events, reports, topicStates, topics: allTopics }) : null),
    [usable, topicId, events, reports, topicStates, allTopics],
  );
  // 小白记得:本课长短板与讲课习惯 ≤2 行;暂停记忆或没记下什么时不露面
  const memoryLines = useMemo(
    () => (usable && !memory.paused
      ? retrieveMemories({
        items: memory.items, topicId, kinds: ['weakness', 'strength', 'habit'], limit: 2,
        now: new Date().toISOString(),
      }).map((it) => it.text)
      : []),
    [usable, topicId, memory],
  );
  const probes = usable ? topic!.misconceptions.slice(0, 3) : [];
  const selfTest = usable ? getSelfTest(topicId) : [];
  const probesDone = usable && answers.length >= probes.length;
  /** 两波都答完才算摸完底;第二波题库为空(如 Python 主题)时与旧行为完全一致 */
  const quizDone = probesDone && mcAnswers.length >= selfTest.length;
  const quizTotal = probes.length + selfTest.length;
  const quizAnswered = answers.length + mcAnswers.length;
  const correctCount =
    answers.filter((c, i) => c === probes[i]?.probe.isTrue).length +
    mcAnswers.filter((c, i) => c === selfTest[i]?.answerIndex).length;
  const allCorrect = quizDone && correctCount === quizTotal;
  /** 第二波答错的题(驱动侧栏薄弱点条目与 verdict 维度小结) */
  const wrongSelfTests = selfTest.filter(
    (q, i) => i < mcAnswers.length && mcAnswers[i] !== q.answerIndex,
  );
  /** 暴露的误区 = 判断题答错的 + 选择题答错且挂了 mcRef 的(按 mcId 去重) */
  const wrongMcs = (() => {
    const list = probes.filter((mc, i) => i < answers.length && answers[i] !== mc.probe.isTrue);
    const seen = new Set(list.map((mc) => mc.mcId));
    wrongSelfTests.forEach((q) => {
      if (!q.mcRef || seen.has(q.mcRef)) return;
      const mc = topic!.misconceptions.find((m) => m.mcId === q.mcRef);
      if (mc) {
        list.push(mc);
        seen.add(mc.mcId);
      }
    });
    return list;
  })();
  const packRequested = quizDone && (!allCorrect || wantMaterials);
  const studyOpen = packRequested || (quizDone && desk.method !== 'read');

  /* 跳步:整块内容换了,直接跳到新的一步(不做平滑滚动),焦点落到标题上,读屏从这里读起 */
  useEffect(() => {
    const id = scrollTarget.current;
    scrollTarget.current = null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [scrollTick]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;
    const measure = () => {
      const pet = document.querySelector<HTMLElement>('[data-tour="coach"]');
      const overlap = pet ? page.getBoundingClientRect().right - pet.getBoundingClientRect().left : 0;
      setPetGutter(overlap > 0 && window.innerWidth >= 900 ? Math.round(overlap) + 8 : 0);
      /* 手机:量出滚动区下方被底栏占掉的高度,小砚站到底栏上面(coach.module.css 读 --prep-floor) */
      let scroller: HTMLElement | null = page.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const floor = scroller && window.innerWidth <= 760
        ? Math.max(0, Math.round(window.innerHeight - scroller.getBoundingClientRect().bottom))
        : 0;
      if (floor > 0) document.documentElement.style.setProperty('--prep-floor', `${floor}px`);
      else document.documentElement.style.removeProperty('--prep-floor');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty('--prep-floor');
    };
  }, [usable]);

  /* 小白的即时反应 2.4s 后收回 */
  useEffect(() => {
    if (!reaction) return;
    const id = window.setTimeout(() => setReaction(null), 2400);
    return () => window.clearTimeout(id);
  }, [reaction]);

  /* 案头计时(整分钟,页面隐藏时也照走——离开桌子不算) */
  useEffect(() => {
    const id = window.setInterval(() => setMinutesOnDesk((m) => m + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!topic || topic.locked) {
    const teacherLoadFailed = customTopic && currentTeacherTopicState.status === 'error';
    const loadingCustom = customTopic && !teacherLoadFailed && (
      currentTeacherTopicState.status === 'idle'
      || currentTeacherTopicState.status === 'loading'
      || customTopicsStatus === 'idle'
      || customTopicsStatus === 'loading'
    );
    return (
      <div className={s.page}>
        <div className={s.notFound}>
          <h1 className={s.notFoundTitle}>{loadingCustom ? '正在从自选课架取讲义' : teacherLoadFailed ? '完整备课稿没有取回' : '这个知识点还没有开放'}</h1>
          <p className={s.notFoundText}>
            {loadingCustom
              ? '稍等片刻，备课材料正在归案。'
              : teacherLoadFailed
                ? '为避免用到缺少评估依据的学生稿，本次没有打开备课台；请稍后重试。'
              : '书架上还有已开放的课在等你,先回学习终端挑一本,回头再来看它。'}
          </p>
          {loadingCustom ? (
            <Shimmer>正在取讲义…</Shimmer>
          ) : (
            <Button asChild variant="solid"><Link to="/learn">回学习终端</Link></Button>
          )}
        </div>
      </div>
    );
  }

  /** 保留错题相关提示，材料一律由先生主动翻开。 */
  const exampleRelated = topic.prep.examples.map((ex) =>
    relatedToWrong(ex.title + ex.code + ex.walkthrough, wrongMcs),
  );
  const lectureSeen = visibleSegmentCount(desk.method, lectureSegments.length, desk.retells);
  const gapState = gapsView({
    method: desk.method,
    checklistIds: topic.checklist.map((item) => item.id),
    marks: desk.marks,
    wrongCount: wrongMcs.length,
    peek: desk.peek,
  });
  const orderedExamples = orderExamples(topic.prep.examples, exampleRelated, desk.method);
  const weakMarkCount = topic.checklist.filter((item) => desk.marks[item.id] === 'gap' || desk.marks[item.id] === 'fuzzy').length;
  const seenLecture = desk.method === 'retell' ? revealedLecture(lectureSegments, lectureSeen) : '';
  const methodLabel = PREP_METHODS.find((item) => item.id === desk.method)?.label;

  const checkedCount = checks.filter(Boolean).length;
  const allChecked =
    topic.prep.selfCheck.length > 0 && topic.prep.selfCheck.every((_, i) => checks[i]);

  /** 路线图途中试探标记插在大纲中段(L4 误区注入没有固定位置,只提示"路上会来") */
  const ambushAfter = Math.max(0, Math.floor((topic.checklist.length - 1) / 2));

  /** 示意图(图解 Collapse):上游按主题给图,空数组则整区不渲染 */
  const figures = getFigures(topic.topicId);

  /** 错题维度小结:「边界题栽了 1 道」——verdict 顺带汇报第二波哪些角度没站稳 */
  const dimReport = (['概念', '推演', '边界', '应用', '辨析'] as const)
    .map((d) => ({ d, n: wrongSelfTests.filter((q) => q.dimension === d).length }))
    .filter((e) => e.n > 0)
    .map((e) => `${e.d}题栽了 ${e.n} 道`)
    .join('、');

  /** 阅读量估算:讲义 + 例题总字数 ÷ 400 字/分钟,向上取整(图不计入,看图不算读) */
  const readChars =
    topic.prep.microLecture.title.length +
    topic.prep.microLecture.body.length +
    topic.prep.examples.reduce(
      (n, ex) => n + ex.title.length + ex.code.length + ex.walkthrough.length,
      0,
    );
  const readMinutes = Math.max(1, Math.ceil(readChars / 400));

  /** 延伸资料(防御式渲染):视频拆出独立「视频参考」区,其余走书单 */
  const references = topic.prep.references ?? [];
  const videoRefs = references.filter((r) => r.kind === '视频');
  const readRefs = references.filter((r) => r.kind !== '视频');
  /** 材料包册数(与下方 Collapse 渲染一一对应,进度用) */
  const materialCount =
    1 + (figures.length > 0 ? 1 : 0) + topic.prep.examples.length + 1 +
    (videoRefs.length > 0 ? 1 : 0) + (readRefs.length > 0 ? 1 : 0);

  /** 后四步要摸完底才解锁;没解锁时一律停在第一步 */
  const activeId = studyOpen ? currentId : SECTIONS[0].id;
  const stepIndex = Math.max(0, SECTIONS.findIndex((sec) => sec.id === activeId));
  /** 五步的进度态:做完打勾;任务卡与路线图是只读的两步,走过了才算完成 */
  const stepStates: StepState[] = [
    { done: quizDone, reachable: true },
    { done: studyOpen && reached > 1, reachable: studyOpen },
    { done: studyOpen && reached > 2, reachable: studyOpen },
    { done: studyOpen && (reached > 3 || allChecked), reachable: studyOpen },
    { done: allChecked, reachable: studyOpen },
  ];
  const currentSection = SECTIONS[stepIndex].name;

  /** 备课进度:摸底 40 · 翻材料 20 · 自检 40。百分数只记真做过的,摸完就能合上。 */
  const readPart = studyOpen ? Math.min(1, opened.length / Math.max(1, materialCount)) : 0;
  const checkPart = topic.prep.selfCheck.length > 0 ? checkedCount / topic.prep.selfCheck.length : 0;
  const progress = Math.round(
    (quizTotal > 0 ? quizAnswered / quizTotal : 1) * 40 + readPart * 20 + checkPart * 40,
  );
  const canLeave = quizDone;

  /** 小白此刻的表情与一句话 */
  const pupil: PupilState = reaction ?? derivePupil({
    title: topic.title,
    started: quizAnswered > 0,
    quizDone,
    allCorrect,
    wrongCount: wrongMcs.length,
    studyOpen,
    method: desk.method,
    weakMarkCount,
    section: currentSection,
    allChecked,
    checkedCount,
  });

  /** 交给小砚的备课情境(全部是页面本来就展示的信息) */
  const coachCtx: PrepContext = {
    quiz: { answered: quizAnswered, total: quizTotal, correct: correctCount, done: quizDone },
    weakBeliefs: wrongMcs.map((mc) => mc.belief),
    weakDims: wrongSelfTests.map((q) => ({
      dimension: q.dimension,
      point: topic.checklist.find((c) => c.id === q.checklistRef)?.point ?? '这个角度',
    })),
    section: currentSection,
    materialsOpen: studyOpen,
    selfCheck: { done: checkedCount, total: topic.prep.selfCheck.length },
    openedMaterials: opened,
    methodLabel,
    seenLecture: seenLecture || undefined,
    retells: desk.method === 'retell' ? desk.retells : undefined,
    ownNote: desk.folder.note || undefined,
    ownExample: desk.folder.example || undefined,
    ownLink: desk.folder.link || undefined,
    weakPoints: desk.method === 'gaps' ? weakPointNames(topic.checklist, desk.marks) : undefined,
  };

  const react = (good: boolean) => {
    const pool = good ? REACT_GOOD : REACT_BAD;
    setReaction(pool[Math.floor(Math.random() * pool.length)]);
    setStreak((n) => (good ? n + 1 : 0));
  };

  /** 摸完底的一声回执(步骤完成反馈;判分与放行逻辑不在这里) */
  const cheerQuiz = (correct: number) => {
    toast.success(
      correct === quizTotal
        ? `摸底 ${correct}/${quizTotal}，全对。可以去给小白上课了`
        : `摸底 ${correct}/${quizTotal}，后面四步已解锁`,
    );
  };

  const answer = (choice: boolean) => {
    if (answers.length >= probes.length) return;
    const mc = probes[answers.length];
    const good = choice === mc.probe.isTrue;
    setLiveMsg(
      `${good ? `答对了——这句话是${mc.probe.isTrue ? '对' : '错'}的。` : '答错了——这正是一个高频误区。'}${mc.probe.explanation}`,
    );
    setAnswers((a) => (a.length >= probes.length ? a : [...a, choice]));
    react(good);
    if (answers.length + 1 >= probes.length && selfTest.length === 0) cheerQuiz(correctCount + (good ? 1 : 0));
  };

  const answerMc = (choice: number) => {
    if (mcAnswers.length >= selfTest.length) return;
    const q = selfTest[mcAnswers.length];
    const good = choice === q.answerIndex;
    setLiveMsg(
      `${good ? '答对了。' : `答错了——该选「${q.options[q.answerIndex]}」。`}${q.explanation}`,
    );
    setMcAnswers((a) => (a.length >= selfTest.length ? a : [...a, choice]));
    react(good);
    if (mcAnswers.length + 1 >= selfTest.length) cheerQuiz(correctCount + (good ? 1 : 0));
  };

  const markOpened = (title: string) => {
    setOpened((list) => (list.includes(title) ? list : [...list, title]));
  };

  /** 跳到某一步:换步、记下走到过的最远一步,再交给上面的 effect 去滚动与聚焦 */
  const jumpTo = (id: string) => {
    const index = SECTIONS.findIndex((sec) => sec.id === id);
    if (index < 0) return;
    setCurrentId(id);
    setReached((value) => Math.max(value, index));
    scrollTarget.current = id;
    setScrollTick((value) => value + 1);
  };

  /** 自检点头;全部点完给一声回执 */
  const toggleCheck = (index: number) => {
    const next = [...checks];
    next[index] = !next[index];
    setChecks(next);
    if (next[index] && topic.prep.selfCheck.every((_, i) => next[i])) {
      toast.success('自检全部点头，可以去给小白上课了');
    }
  };

  /** 重新摸底:两波作答与"过一遍材料"的选择一并清空;completePrep 仍只在合上或进讲解舱时按当次成绩提交 */
  const retakeQuiz = () => {
    setAnswers([]);
    setMcAnswers([]);
    setLiveMsg('');
    setWantMaterials(false);
    setStreak(0);
    setReaction(null);
    jumpTo(SECTIONS[0].id);
    setReached(0);
  };

  const markPrep = () => {
    if (submittedRef.current || prepDone) return;
    submittedRef.current = true;
    completePrep(topic.topicId, correctCount, quizTotal);
  };

  const finishPrep = () => {
    if (!canLeave) return;
    markPrep();
    navigate('/learn');
  };

  const enterClassroom = () => {
    if (!canLeave) return;
    markPrep();
    navigate(`/teach/${topic.topicId}`);
  };

  const deskLabel = minutesOnDesk === 0 ? '刚坐下' : `案头 ${minutesOnDesk} 分钟`;
  const progressNote = !quizDone
    ? '先把摸底做完'
    : allChecked || prepDone || (allCorrect && !studyOpen)
      ? '这课可以合上'
      : '材料随你翻';
  /** 流程走到头:最后一步,或摸底全对且没打算翻材料——此时出口升为实心主按钮 */
  const flowEnd = stepIndex === SECTIONS.length - 1 || (quizDone && !studyOpen);
  const prevLink = stepIndex > 0
    ? { label: '上一步', onClick: () => jumpTo(SECTIONS[stepIndex - 1].id) }
    : undefined;
  const nextLink = studyOpen && stepIndex < SECTIONS.length - 1
    ? { label: `下一步：${SECTIONS[stepIndex + 1].name}`, onClick: () => jumpTo(SECTIONS[stepIndex + 1].id) }
    : undefined;
  /** 手机底部的吸底主动作:有下一步就是下一步;流程走到头就是去上课 */
  const dockAction = nextLink ?? (flowEnd && canLeave ? { label: '去给小白上课', onClick: enterClassroom } : undefined);
  const weakBeliefItems = wrongMcs.map((mc) => ({ id: mc.mcId, text: mc.belief }));
  const weakDimItems = wrongSelfTests.map((q) => ({
    id: q.id,
    dimension: q.dimension,
    point: topic.checklist.find((c) => c.id === q.checklistRef)?.point ?? '这个角度还没答稳',
  }));
  const exampleLanguage = codeLanguage(topic.course);

  return (
    <div ref={pageRef} className={s.page} style={petGutter ? { paddingRight: petGutter } : undefined}>
      <div className={s.shell} data-dock={dockAction ? '' : undefined}>
        {/* ── 课题 + 小白候教 ── */}
        <header className={s.hero}>
          <div>
            <div className={s.heroMeta}>
              <ol className={s.loop} aria-label="费曼四步">
                {LOOP.map((name, i) => (
                  <li key={name} aria-current={i === 0 ? 'step' : undefined}>{name}</li>
                ))}
              </ol>
              <Badge tone="outline">{topic.course}</Badge>
              <Badge><Clock size={11} strokeWidth={2} aria-hidden="true" />{deskLabel}</Badge>
            </div>
            <h1 className={s.title}>{topic.title}</h1>
            <p className={s.tagline}>{topic.tagline}</p>
          </div>
          {/* 小白陪读:表情与一句话随备课进度实时变 */}
          <aside className={s.pupil} aria-label="小白在书桌旁">
            <div className={s.pupilFigure}>
              <XiaobaiAvatar mood={pupil.mood} level={level} variant="paper" size={84} />
            </div>
            <div className={s.pupilSay}>
              <span className={s.pupilName}>小白 · 在书桌旁</span>
              <p
                key={pupil.line}
                className={cx(s.pupilBubble, reaction && s.pupilBubbleReact)}
                aria-live="polite"
              >
                {pupil.line}
              </p>
            </div>
          </aside>
        </header>

        <JourneyBar
          steps={SECTIONS}
          states={stepStates}
          currentId={activeId}
          onJump={jumpTo}
          progress={progress}
          note={progressNote}
          ready={canLeave}
        />

        <MethodBar method={desk.method} onChange={(method) => setDesk((prev) => ({ ...prev, method }))} />
        {/* ── 记忆回执:接着上次讲(首学该课不渲染) ── */}
        {recall && <RecallCard recall={recall} memoryLines={memoryLines} />}

        <main className={s.main}>
          {/* ── 1 · 摸底快测 ── */}
          {stepIndex === 0 && (
            <section id={SECTIONS[0].id} className={s.section} aria-labelledby="prep-h-1">
              <StepHead
                index={0}
                total={SECTIONS.length}
                headingId="prep-h-1"
                title="摸底快测"
                hint="先看看你现在站在哪。判断下面的说法对不对。"
                aside={!quizDone ? (
                  <>
                    {streak >= 2 && (
                      <Badge tone="warn">
                        <Flame size={11} strokeWidth={2} aria-hidden="true" />
                        <em className={s.streak}>连对 {streak}</em>
                      </Badge>
                    )}
                    <span>已答 {quizAnswered} / {quizTotal}</span>
                  </>
                ) : undefined}
              />
              {!quizDone && <Progress value={quizAnswered} max={Math.max(1, quizTotal)} label="摸底进度" />}
              {/* 常驻 live region:读屏用户答题后在此听到判分(节点须先于反馈存在,否则首条丢播) */}
              <p className={s.srOnly} aria-live="polite">{liveMsg}</p>
              <ol className={s.probeList}>
                {probes.map((mc, i) => {
                  if (i > answers.length) return null;
                  const answered = i < answers.length;
                  const choice = answers[i];
                  const good = answered && choice === mc.probe.isTrue;
                  return (
                    <li
                      key={mc.mcId}
                      className={s.probe}
                      data-result={answered ? (good ? 'good' : 'bad') : undefined}
                    >
                      <div className={s.probeTop}>
                        <p className={s.probeNo}>第 {i + 1} / {probes.length} 题 · 判断</p>
                        {answered && (
                          <Badge tone={good ? 'ok' : 'bad'} className={s.probeMark} aria-hidden="true">
                            {good ? '对' : '错'}
                          </Badge>
                        )}
                      </div>
                      <p className={s.probeStatement}>「{mc.probe.statement}」</p>
                      {/* 答后按钮禁用而不卸载:卸载会把键盘焦点甩回 body,读屏用户直接迷航 */}
                      <div className={s.probeBtns}>
                        <button
                          type="button"
                          disabled={answered}
                          className={cx(s.choice, answered && choice === true && s.choicePicked)}
                          onClick={() => answer(true)}
                        >
                          <Check {...ICON} aria-hidden="true" />
                          对
                        </button>
                        <button
                          type="button"
                          disabled={answered}
                          className={cx(s.choice, answered && choice === false && s.choicePicked)}
                          onClick={() => answer(false)}
                        >
                          <X {...ICON} aria-hidden="true" />
                          错
                        </button>
                      </div>
                      {answered && (
                        <div className={s.probeFb}>
                          <p className={good ? s.fbGood : s.fbBad}>
                            {good
                              ? `答对了——这句话是${mc.probe.isTrue ? '对' : '错'}的。`
                              : '答错了——这正是一个高频误区。'}
                          </p>
                          <p className={s.fbExplain}>{mc.probe.explanation}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {/* ── 第二波 · 多方位摸底:判断题答完才登场;题库为空的主题走不到这里 ── */}
              {probesDone && selfTest.length > 0 && (
                <div className={s.mcWave}>
                  <p className={s.mcWaveTitle}>第二波 · 多方位摸底</p>
                  <p className={s.mcWaveHint}>
                    判断只是热身——下面换几个角度出选择题,看你的理解经不经得起转弯。
                  </p>
                  <ol className={s.probeList}>
                    {selfTest.map((q, i) => {
                      if (i > mcAnswers.length) return null;
                      const answered = i < mcAnswers.length;
                      const pick = mcAnswers[i];
                      const good = answered && pick === q.answerIndex;
                      return (
                        <li
                          key={q.id}
                          className={s.probe}
                          data-result={answered ? (good ? 'good' : 'bad') : undefined}
                        >
                          <div className={s.probeTop}>
                            <p className={s.probeNo}>第 {i + 1} / {selfTest.length} 题 · {q.dimension}</p>
                            {answered && (
                              <Badge tone={good ? 'ok' : 'bad'} className={s.probeMark} aria-hidden="true">
                                {good ? '对' : '错'}
                              </Badge>
                            )}
                          </div>
                          <p className={s.probeStatement}>{q.question}</p>
                          {q.code ? (
                            <pre className={s.code}><code>{q.code}</code></pre>
                          ) : null}
                          <div className={s.mcOptions}>
                            {q.options.map((opt, oi) => (
                              <button
                                key={opt}
                                type="button"
                                disabled={answered}
                                className={cx(s.choice, answered && pick === oi && s.choicePicked)}
                                data-answer={(answered && oi === q.answerIndex) || undefined}
                                onClick={() => answerMc(oi)}
                              >
                                <span className={s.mcOptNo} aria-hidden="true">
                                  {String.fromCharCode(65 + oi)}
                                </span>
                                {opt}
                              </button>
                            ))}
                          </div>
                          {answered && (
                            <div className={s.probeFb}>
                              <p className={good ? s.fbGood : s.fbBad}>
                                {good
                                  ? '答对了。'
                                  : `答错了——该选「${q.options[q.answerIndex]}」。`}
                              </p>
                              <p className={s.fbExplain}>{q.explanation}</p>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              {quizDone && (
                <div className={s.verdict} data-tone={allCorrect ? 'good' : 'bad'}>
                  <div className={s.verdictScore} aria-hidden="true">
                    <b>{correctCount}/{quizTotal}</b>
                    摸底
                  </div>
                  <div className={s.verdictBody}>
                    {allCorrect ? (
                      <>
                        <p>
                          摸底 {correctCount}/{quizTotal}，这一课的底你已经摸清了。材料可以再过一遍，也可以先合上。
                        </p>
                        {studyOpen ? (
                          <p className={s.unlockHint}>材料已经摊开。读完可以合上，想讲再进讲解舱。</p>
                        ) : null}
                      </>
                    ) : (
                      <p>
                        摸底 {correctCount}/{quizTotal}——
                        {wrongMcs.length > 0
                          ? `有 ${wrongMcs.length} 个误区还没吃透`
                          : '判断都稳,选择题露了怯'}
                        {dimReport ? `,${dimReport}` : ''}。
                        别慌,后面几步的材料是给你自己读的。读完可以合上，不必进讲解舱。
                      </p>
                    )}
                    <div className={s.verdictBtns}>
                      {allCorrect && !studyOpen && (
                        <Button
                          variant="outline"
                          icon={<BookOpen {...ICON} />}
                          onClick={() => {
                            setWantMaterials(true);
                            jumpTo(SECTIONS[1].id);
                          }}
                        >
                          继续把材料过一遍
                        </Button>
                      )}
                      <Button variant="ghost" icon={<RotateCcw {...ICON} />} onClick={retakeQuiz}>
                        重新测一遍
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {quizDone && <WeakPoints beliefs={weakBeliefItems} dims={weakDimItems} />}
            </section>
          )}

          {/* ── 2 · 教学任务卡 ── */}
          {stepIndex === 1 && (
            <section id={SECTIONS[1].id} className={s.section} aria-labelledby="prep-h-2">
              <StepHead
                index={1}
                total={SECTIONS.length}
                headingId="prep-h-2"
                title="教学任务卡"
                hint="这一课的靶心。先自己对准，再往下读。"
              />
              <div className={s.taskCard} data-story>
                <span className={s.taskPin} aria-hidden="true" />
                <span className={s.taskLabel}>
                  <ClipboardList size={15} strokeWidth={1.75} aria-hidden="true" />
                  教学任务
                </span>
                <p className={s.taskText}>{topic.prep.taskCard.replace(/^[📋🧾]\s*/u, '')}</p>
              </div>
            </section>
          )}

          {/* ── 3 · 讲课路线图 ── */}
          {stepIndex === 2 && (
            <section id={SECTIONS[2].id} className={s.section} aria-labelledby="prep-h-3">
              <StepHead
                index={2}
                total={SECTIONS.length}
                headingId="prep-h-3"
                title="讲课路线图"
                hint={(
                  <>
                    这一课要站稳的 {topic.checklist.length} 件事。若去讲给小白听，他大概会这么问。
                    {desk.method === 'gaps' ? ' 标上会、模糊、不会。不会的地方，开讲时他会先从那儿问起。' : ''}
                  </>
                )}
              />
              <div className={s.flowNote}>
                <Route {...ICON} aria-hidden="true" />
                <span className={s.flowLabel}>讲课节奏</span>
                <p className={s.flowText}>{deriveTeachingFlow(topic)}</p>
              </div>
              <ol className={s.roadmap}>
                {topic.checklist.map((item, i) => (
                  <Fragment key={item.id}>
                    {/* stagger 70ms,同屏最长 delay 封顶 280ms,后排不留白 */}
                    <li className={s.roadStep} style={{ animationDelay: `${Math.min(i * 70, 280)}ms` }}>
                      <span className={s.roadBadge}>
                        <b>{item.level}</b>
                        {LEVEL_META[item.level]}
                      </span>
                      <div className={s.roadBody}>
                        <p className={s.roadPoint}>{item.point}</p>
                        <p className={s.roadProbe}>
                          「{item.probeLine}」
                          <span className={s.roadWho}>—— 小白</span>
                        </p>
                        {desk.method === 'gaps' && (
                          <GapMarks
                            value={desk.marks[item.id]}
                            onChange={(mark) => setDesk((prev) => ({
                              ...prev,
                              marks: { ...prev.marks, [item.id]: mark },
                            }))}
                          />
                        )}
                      </div>
                    </li>
                    {i === ambushAfter && topic.misconceptions.length > 0 && (
                      <li
                        className={s.roadAmbush}
                        style={{ animationDelay: `${Math.min((i + 1) * 70, 280)}ms` }}
                      >
                        <span className={s.roadBadgeWarn}>
                          <b>L4</b>
                          试探
                        </span>
                        <p className={s.roadAmbushText}>
                          途中它还会用错误直觉试探你 ×{topic.misconceptions.length}
                          ——剧本在「研读材料包」的「误区剧本」里,也可以叫小砚扮小白先练一遍。
                        </p>
                      </li>
                    )}
                  </Fragment>
                ))}
              </ol>
            </section>
          )}

          {/* ── 4 · 研读材料包 ── */}
          {stepIndex === 3 && (
            <section id={SECTIONS[3].id} className={s.section} aria-labelledby="prep-h-4">
              <StepHead
                index={3}
                total={SECTIONS.length}
                headingId="prep-h-4"
                title="研读材料包"
                hint={desk.method === 'retell'
                  ? '微课一段一段来。先用自己的话说一句，下一段才打开。'
                  : desk.method === 'examples'
                    ? '先看题目和代码。写下判断，或点「先看讲解」，走查才打开。'
                    : desk.method === 'gaps'
                      ? '材料跟着你标的模糊和不会走。和错题相关的例题排在前面。'
                      : '材料默认收起，点标题翻开，再点一下收起。带着任务卡上的问题读。'}
                aside={(
                  <span>
                    全读约 {readMinutes} 分钟 · 已翻 {Math.min(opened.length, materialCount)}/{materialCount} 册
                  </span>
                )}
              />
              <WeakPoints beliefs={weakBeliefItems} dims={weakDimItems} />
              {desk.method === 'gaps' && !gapState.showCore ? (
                <GapsHold
                  view={gapState}
                  onPeek={() => setDesk((prev) => ({ ...prev, peek: true }))}
                  onRoadmap={() => jumpTo(SECTIONS[2].id)}
                />
              ) : (
                <div className={s.materials}>
                  {desk.method === 'retell' ? (
                    <div className={s.retellCard}>
                      <p className={s.retellTitle}>{topic.prep.microLecture.title}</p>
                      <RetellLecture
                        segments={lectureSegments}
                        visible={lectureSeen}
                        retells={desk.retells}
                        className={s.lecture}
                        onShow={() => markOpened(topic.prep.microLecture.title)}
                        onRetell={(index, text) => setDesk((prev) => {
                          const retells = prev.retells.slice();
                          retells[index] = text.slice(0, 400);
                          return { ...prev, retells };
                        })}
                      />
                    </div>
                  ) : (
                    <Collapse
                      title={topic.prep.microLecture.title}
                      tag="微课讲义"
                      tagTone="plain"
                      onOpen={markOpened}
                    >
                      <div className={s.lecture}>
                        <CoachMarkdown text={lectureMarkdown(topic.prep.microLecture.body)} />
                      </div>
                    </Collapse>
                  )}
                  {figures.length > 0 && (
                    <Collapse
                      title="一张图看懂"
                      tag="图解"
                      tagTone="plain"
                      onOpen={markOpened}
                    >
                      {figures.map((fig) => (
                        <figure key={fig.title} className={s.figItem}>
                          <p className={s.figTitle}>{fig.title}</p>
                          {/* 横滚壳可聚焦:键盘用户才能滚动看全图(SVG 有 min-width) */}
                          <div className={s.figScroll} tabIndex={0} role="group" aria-label={fig.title}>
                            <fig.Svg className={s.figSvg} />
                          </div>
                          <figcaption className={s.figCaption}>{fig.caption}</figcaption>
                        </figure>
                      ))}
                    </Collapse>
                  )}
                  {orderedExamples.map((row) => (
                    <Collapse
                      key={`${row.index}-${row.item.title}`}
                      title={row.item.title}
                      tag={wrongMcs.length > 0 && row.related ? '与错题相关' : undefined}
                      tagTone="warn"
                      onOpen={markOpened}
                    >
                      <ExampleStudy
                        title={row.item.title}
                        code={row.item.code}
                        language={exampleLanguage}
                        walkthrough={row.item.walkthrough}
                        locked={walkthroughLocked(
                          desk.method,
                          desk.exampleNotes[row.item.title] ?? '',
                          desk.exampleRevealed[row.item.title] === true,
                        )}
                        note={desk.exampleNotes[row.item.title] ?? ''}
                        onNote={(text) => setDesk((prev) => ({
                          ...prev,
                          exampleNotes: { ...prev.exampleNotes, [row.item.title]: text.slice(0, 800) },
                        }))}
                        onReveal={() => setDesk((prev) => ({
                          ...prev,
                          exampleRevealed: { ...prev.exampleRevealed, [row.item.title]: true },
                        }))}
                      />
                    </Collapse>
                  ))}
                  <Collapse
                    title="预演:小白会怎么为难你"
                    tag="误区剧本"
                    tagTone="warn"
                    onOpen={markOpened}
                  >
                    <p className={s.drillLead}>
                      纠不动它,它就真的学错——复盘时会现形。想真刀真枪练,右下角小砚的「试讲」能扮它。
                    </p>
                    <ul className={s.drillList}>
                      {topic.misconceptions.map((mc) => {
                        const stumbled = wrongMcs.some((w) => w.mcId === mc.mcId);
                        return (
                          <li key={mc.mcId} className={cx(s.drill, stumbled && s.drillStumbled)}>
                            <p className={s.drillBelief}>
                              它会坚信:{mc.belief}
                              {stumbled && <Badge tone="bad">你刚栽在这里</Badge>}
                            </p>
                            <p className={s.drillLine}>
                              「{mc.triggerLine}」
                              <span className={s.roadWho}>—— 小白,开口大概是这样</span>
                            </p>
                            <p className={s.drillCritTitle}>纠正到位的标准</p>
                            <ul className={s.drillCrits}>
                              {mc.correctionCriteria.map((c) => (
                                <li key={c}>
                                  <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </Collapse>
                  {videoRefs.length > 0 && (
                    <Collapse
                      title="视频参考"
                      tag={`选看 · ${videoRefs.length} 部`}
                      tagTone="plain"
                      onOpen={markOpened}
                    >
                      <p className={s.refLead}>
                        读不进去的时候换只耳朵——挑一部当预习就够,别当追剧。
                      </p>
                      <ul className={s.videoList}>
                        {videoRefs.map((ref) => (
                          <li key={ref.url}>
                            <a
                              className={s.videoCard}
                              href={ref.url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              <span className={s.videoPlay} aria-hidden="true"><Play {...ICON} /></span>
                              <span className={s.videoBody}>
                                <span className={s.videoTitle}>{ref.title}</span>
                                <span className={s.videoNote}>{ref.note}</span>
                                {videoHost(ref.url) && (
                                  <span className={s.videoHost}>{videoHost(ref.url)}</span>
                                )}
                              </span>
                              <ExternalLink className={s.refArrow} size={15} strokeWidth={1.75} aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </Collapse>
                  )}
                  {readRefs.length > 0 && (
                    <Collapse title="延伸书单" tag="选读" tagTone="plain" onOpen={markOpened}>
                      <p className={s.refLead}>想再深挖时再翻，不急。</p>
                      <ul className={s.refList}>
                        {readRefs.map((ref) => (
                          <li key={ref.url}>
                            <a
                              className={s.refItem}
                              href={ref.url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              <span className={s.refIcon} aria-hidden="true"><BookOpen {...ICON} /></span>
                              <span className={s.refBody}>
                                <span className={s.refTitle}>
                                  {ref.title}
                                  <Badge tone="outline">{ref.kind}</Badge>
                                </span>
                                <span className={s.refNote}>{ref.note}</span>
                              </span>
                              <ExternalLink className={s.refArrow} size={15} strokeWidth={1.75} aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </Collapse>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── 5 · 备课自检 ── */}
          {stepIndex === 4 && (
            <section id={SECTIONS[4].id} className={s.section} aria-labelledby="prep-h-5">
              <StepHead
                index={4}
                total={SECTIONS.length}
                headingId="prep-h-5"
                title="备课自检"
                hint="对着清单问自己。点头是给自己看的，不点也能合上这课。"
                aside={<span>已点头 {checkedCount} / {topic.prep.selfCheck.length}</span>}
              />
              <Progress
                value={checkedCount}
                max={Math.max(1, topic.prep.selfCheck.length)}
                tone="ok"
                label="自检进度"
              />
              <ul className={s.checkList}>
                {topic.prep.selfCheck.map((item, i) => {
                  const on = !!checks[i];
                  return (
                    <li key={item}>
                      <label className={cx(s.checkLabel, on && s.checkOn)}>
                        <input type="checkbox" checked={on} onChange={() => toggleCheck(i)} />
                        <span className={s.checkBox} aria-hidden="true">
                          {on ? <Check size={15} strokeWidth={2.6} /> : null}
                        </span>
                        <span className={s.checkText}>{item}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {allChecked ? (
                <p className={s.unlockHint}>{deskLabel}，这课可以合上了。</p>
              ) : null}
            </section>
          )}

          <StepNav prev={prevLink} next={nextLink} />
          <PrepExits
            canLeave={canLeave}
            prepDone={prepDone}
            ready={allChecked}
            strong={flowEnd}
            onStay={finishPrep}
            onTeach={enterClassroom}
          />
        </main>

        {quizDone && (
          <div className={s.tools}>
            <h2 className={s.toolsTitle}>案头工具</h2>
            <PrepFolder
              topicId={topic.topicId}
              folder={desk.folder}
              onChange={(folder) => setDesk((prev) => ({ ...prev, folder }))}
            />
            <RehearseEntry onOpen={() => setCoachAsk({ mode: 'rehearse', nonce: Date.now() })} />
          </div>
        )}

        <p className={s.motto}>「教然后知困。」带着小白的问题去读，比通读三遍记得牢。</p>

        {/* ── 手机:吸底主动作(桌面隐藏,用步骤面板下方的按钮) ── */}
        {dockAction && (
          <div className={s.dock}>
            {prevLink && (
              <IconButton label={prevLink.label} variant="outline" size="lg" tip={false} onClick={prevLink.onClick}>
                <ArrowLeft {...ICON} />
              </IconButton>
            )}
            <Button
              variant="solid"
              size="lg"
              block
              className={s.dockMain}
              iconRight={<ArrowRight {...ICON} />}
              onClick={dockAction.onClick}
            >
              {dockAction.label}
            </Button>
          </div>
        )}
      </div>

      <PrepCoach topic={topic} ctx={coachCtx} openRequest={coachAsk} />

      {/* ── 新手引路(首访自动开一次) ── */}
      <Tour tourKey="prep" steps={PREP_TOUR} />
    </div>
  );
}
