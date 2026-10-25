/**
 * 学习终端 —— 导轨 · 侧栏 · 主区域 · 按需侧面板。
 * 这里保存终端的全部状态与流程（工作区存取、资料选择、答疑管线、产物、撤销、资料库守卫）；
 * 版面拆在 shell/ 下，对话流与输入框在 chat/，各功能视图在 views/。
 */
import {
  lazy, Suspense, useEffect, useMemo, useRef, useState,
  type ComponentType, type FormEvent, type LazyExoticComponent, type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Download, FileText, Forward, Info, Library, TriangleAlert, X } from 'lucide-react';
import { useAllTopics } from '../../hooks/useAllTopics';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { useModelPrefs } from '../../store/modelPrefs';
import { useSkinStore } from '../../store/skinStore';
import { getTopic } from '../../data';
import { hydrateTeacherRuntimeTopic, topicCourseKey } from '../../data/runtimeTopics';
import { isCurrentAccount } from '../../lib/api';
import { saveBlob } from '../../lib/notebookMedia';
import { prepareLibrarySources, readLibrarySources, downloadLibraryFile } from '../../lib/fileLibrary';
import { getTeacherCustomTopic, listStudyMaterials } from '../../lib/customContent';
import { askDeepStudyTutor, getStudyTutorStatus } from '../../lib/studyTutor';
import { learningAnswerAvailable, streamLearningAnswer, type LearningEvent, type LearningRun } from '../../lib/learningAnswer';
import { ModelUnavailableError, streamModel } from '../../lib/modelGateway';
import { Button, Empty, IconButton, Sheet, Spinner, Tabs, Textarea } from '../../components/ui';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { AttachPicker, type AttachTab } from '../../components/handoff/AttachPicker';
import { artifactSourceId, artifactSources, isArtifactSourceId, type AttachSelection } from '../../components/handoff/materials';
import { SendTo } from '../../components/handoff/SendTo';
import { targetPath, useOpenTarget } from '../../components/handoff/useOpenTarget';
import { RequireAuth } from '../../components/shell/RequireAuth';
import { useShellActions } from '../../components/shell/ShellActions';
import { loadLearningIdentity, saveLearningIdentity, type LearningIdentity } from '../../engine/learningIdentity';
import { logActivity } from '../../engine/activityLog';
import {
  askStudyTutor, downloadStudyFile, lectureSections, loadWorkspace, prepareStudySources, saveWorkspace, studyId,
  type StudyConversation, type StudyMessage, type StudyMode, type StudySource, type StudyWorkspace,
} from '../../engine/studyWorkspace';
import { restoreGuidedProgress, sceneQuestionContext, studyScenes, type GuidedProgress } from '../../engine/guidedStudy';
import { courseSources, notebookScopeKey, selectNotebookSources, sourceEvidence, sourceScopedTopic, type NotebookSource } from '../../engine/notebookSources';
import { artifactMarkdown, createStudyArtifact, enrichStudyArtifact, type StudioKind, type StudyArtifact } from '../../engine/studyStudio';
import { recordTutorTurn, tutorMemoryHints } from '../../engine/tutorMemory';
import { startAgentScheduler } from '../../engine/agent/scheduler';
import { useArtifacts, type Artifact } from '../../lib/artifacts';
// 各板块的成果在终端加载时登记：对话产物、AI 课、助理成果
import { chatWorkspaceChanged, listConversations, touchConversation, type ConversationBrief } from '../../lib/artifactProviders/chat';
import '../../lib/artifactProviders/lesson';
import '../../lib/artifactProviders/agent';
import '../../lib/artifactProviders/studyData';
import type { LearningInteraction } from '../../../../server/shared/learning-ui.mjs';
import type { Topic } from '../../types';
import { StudyJourney } from './StudyWelcome';
import { StudyCompanion } from './StudyCompanion';
import { GuidedStudyPanel } from './GuidedStudyPanel';
import { SourcesPanel, StudioPanel, type StudioToolId } from './NotebookPanels';
import { ArtifactPanel } from './ArtifactPanel';
import { ChatFeed } from './chat/ChatFeed';
import { Composer } from './chat/Composer';
import type { ChatHandoff } from './chat/types';
import type { TerminalViewProps } from './views/types';
import { CommandPalette } from './shell/CommandPalette';
import { Inspector } from './shell/Inspector';
import { TerminalHeader, type InspectorPanel } from './shell/TerminalHeader';
import { TerminalRail } from './shell/TerminalRail';
import { TerminalSidebar, type CourseGroup } from './shell/TerminalSidebar';
import { SidebarSlotProvider } from './shell/sidebarSlot';
import { maybeDream } from '../../engine/dreams';
import { TerminalWelcome } from './shell/TerminalWelcome';
import { STUDY_TABS, VIEW_LABELS, isToolView, isView, railKey, useMediaQuery, type ToolView, type View } from './shell/views';
import { useKeyboardViewport } from './shell/useKeyboardViewport';
import t from './terminal.module.css';
import { IconSpark } from '../../components/ui/icons';

// 科研台的文件登记放在后面慢慢加载；加载不成不影响终端
void import('../../lib/artifactProviders/research').catch(() => { /* 科研台没准备好时不登记 */ });

const PrepPage = lazy(() => import('../prep'));
const CardsPanel = lazy(() => import('./StudyPanels').then((module) => ({ default: module.CardsPanel })));
const PracticePanel = lazy(() => import('./StudyPanels').then((module) => ({ default: module.PracticePanel })));
const ReadingPanel = lazy(() => import('./StudyPanels').then((module) => ({ default: module.ReadingPanel })));
const LibraryPage = lazy(() => import('../library/LibraryPage'));
const TOOL_COMPONENTS: Record<ToolView, LazyExoticComponent<ComponentType<TerminalViewProps>>> = {
  workbench: lazy(() => import('./views/WorkbenchView')),
  feynman: lazy(() => import('./views/FeynmanView')),
  classroom: lazy(() => import('./views/CourseStudioView')),
  agent: lazy(() => import('./views/AgentView')),
  memory: lazy(() => import('./views/MemoryView')),
  research: lazy(() => import('./views/ResearchView')),
  reading: lazy(() => import('../reading')),
};

/** 这些视图下方保留输入框，随时可以向小砚提问 */
const COMPOSER_VIEWS: View[] = ['ask', 'guided', 'read', 'practice', 'cards', 'studio', 'source'];
const STUDY_VIEW_IDS: View[] = ['guided', 'read', 'practice', 'cards'];
const SIDEBAR_KEY = 'xiaobai-terminal-sidebar';

interface StageEvent { id: string; label: string; status: 'running' | 'done' }
/** 另一侧正在给流式答疑加上思考过程事件；这里先按约定的形状接住 */
type StreamEvent = LearningEvent | { type: 'reasoning'; text: string };

const NO_COURSE_TOPIC: Topic = {
  topicId: 'library', title: '资料对话', course: '资料库', tagline: '', transferHint: '', checklist: [], misconceptions: [], quizBank: [],
  prep: { microLecture: { title: '所选文件', body: '' }, examples: [], selfCheck: [], taskCard: '' },
};

function useStudyTopic(topicId: string, owner: string | null) {
  const [state, setState] = useState<{ topic?: Topic; error?: boolean }>({});
  const [retry, setRetry] = useState(0);
  const custom = topicId.startsWith('custom-');
  useEffect(() => {
    if (!custom) return;
    const controller = new AbortController();
    setState({});
    void getTeacherCustomTopic(topicId, controller.signal).then((record) => {
      if (controller.signal.aborted || !isCurrentAccount(owner, useAuthStore.getState())) return;
      const topic = record.topicId === topicId ? hydrateTeacherRuntimeTopic(record.payload) : null;
      setState(topic?.topicId === topicId ? { topic } : { error: true });
    }).catch(() => { if (!controller.signal.aborted && isCurrentAccount(owner, useAuthStore.getState())) setState({ error: true }); });
    return () => controller.abort();
  }, [custom, topicId, owner, retry]);
  return { topic: custom ? state.topic : getTopic(topicId), loading: custom && !state.topic && !state.error, error: state.error, retry: () => setRetry((value) => value + 1) };
}

/** 学习者在说「我卡住了」的说法 */
const STUCK = /没懂|不懂|看不懂|听不懂|不明白|没明白|没理解|不理解|还是不|不会做|卡住|卡在|搞不清|分不清|弄不清|糊涂|太难|再讲一遍|再解释|再说一遍|confus|stuck|don'?t understand/i;
const bigrams = (text: string) => {
  const clean = text.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const set = new Set<string>();
  for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
  return set;
};
/** 这句提问和之前问过的某一句是不是在问同一件事（二字片段重合过半） */
function askedBefore(question: string, earlier: string[]): boolean {
  const current = bigrams(question);
  if (current.size < 4) return false;
  return earlier.some((text) => {
    const other = bigrams(text);
    if (other.size < 4) return false;
    let shared = 0;
    current.forEach((piece) => { if (other.has(piece)) shared += 1; });
    return shared / Math.min(current.size, other.size) >= 0.6;
  });
}

/** 给一条助手消息的进度追加或更新一步 */
function withStage(message: StudyMessage, stage: StageEvent, startedAt: number): StudyMessage {
  const step = { id: stage.id, label: stage.label, status: stage.status, at: Date.now() };
  const steps = message.run?.steps ?? [];
  return {
    ...message,
    run: {
      status: 'running', startedAt,
      steps: steps.some((item) => item.id === step.id) ? steps.map((item) => (item.id === step.id ? step : item)) : [...steps, step],
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/** 结束一次进度：还在转的步骤跟着收尾 */
function closeRun(run: LearningRun, status: 'complete' | 'stopped' | 'failed', startedAt: number): LearningRun {
  const settled = status === 'complete' ? 'done' : status === 'failed' ? 'error' : 'stopped';
  return { ...run, status, elapsedMs: Date.now() - startedAt, steps: run.steps.map((step) => (step.status === 'running' ? { ...step, status: settled } : step)) };
}

export default function LearningPage() {
  const { topicId = '' } = useParams();
  const owner = useAuthStore((state) => state.user);
  return <LearningSession key={owner ?? 'local'} topicId={topicId} owner={owner} />;
}

function LearningSession({ topicId, owner }: { topicId: string; owner: string | null }) {
  const [identity, setIdentity] = useState(() => loadLearningIdentity(owner));
  const identityRef = useRef(identity);
  const updateIdentity = (patch: Partial<LearningIdentity>) => {
    // 教小白页的故事匣也会写这份记录（收下拜师帖），合并前先取最新落盘值，避免用旧值盖掉
    const next = { ...identityRef.current, ...loadLearningIdentity(owner), ...patch };
    identityRef.current = next;
    saveLearningIdentity(owner, next);
    setIdentity(next);
  };
  // 终端开着的时候，到点的助理任务照常执行
  useEffect(() => {
    const stop = startAgentScheduler(owner);
    return stop;
  }, [owner]);
  return <TopicWorkspace key={topicId} topicId={topicId} owner={owner} identity={identity} onIdentity={updateIdentity} />;
}

function TopicWorkspace({ topicId, owner, identity, onIdentity }: {
  topicId: string; owner: string | null; identity: LearningIdentity; onIdentity: (patch: Partial<LearningIdentity>) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const view: View = isView(requestedView) ? requestedView : 'ask';
  const { topic, loading, error, retry } = useStudyTopic(topicId, owner);
  const topics = useAllTopics();
  const settings = useAppStore((state) => state.settings);
  const level = useAppStore((state) => state.global.learningLevel);
  const companionOn = useSkinStore((state) => state.companion);
  const shellActions = useShellActions();
  const isMobile = useMediaQuery('(max-width: 760px)');
  // 进入终端时给两套记忆一次「做梦」整理的机会；是否真的做由引擎按间隔和新材料决定
  useEffect(() => {
    maybeDream(owner);
    const onReturn=()=>{ if(document.visibilityState==='visible') maybeDream(owner); };
    const timer=window.setInterval(onReturn,5*60_000);
    document.addEventListener('visibilitychange',onReturn);
    return ()=>{ window.clearInterval(timer);document.removeEventListener('visibilitychange',onReturn); };
  }, [owner]);
  // 非对话板块的侧栏挂载位；侧栏收起或手机上不存在，板块会改在主区自带导航
  const [sectionSlot, setSectionSlot] = useState<HTMLDivElement | null>(null);
  const workspaceKeyId = topicId || 'library-chat';

  const [workspace, setWorkspace] = useState<StudyWorkspace>(() => loadWorkspace(owner, workspaceKeyId));
  const [saveFailed, setSaveFailed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== 'closed'; } catch { return true; }
  });
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel | null>(null);
  /** 附加选择器：打开在哪个页签；null 为关闭 */
  const [picker, setPicker] = useState<AttachTab | null>(null);
  const allArtifacts = useArtifacts(owner);
  const openTarget = useOpenTarget();
  const [librarySources, setLibrarySources] = useState<NotebookSource[]>([]);
  const materialsRequest = useRef<AbortController | null>(null);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [materialsRetry, setMaterialsRetry] = useState(0);
  const [remoteSources, setRemoteSources] = useState<NotebookSource[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<StudyMode>('ask');
  const [deepAvailable, setDeepAvailable] = useState(false);
  const [intelligentAvailable, setIntelligentAvailable] = useState(false);
  const activeStream = useRef<{ chatId: string; messageId: string; startedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [notice, setNotice] = useState('');
  const [undoLabel, setUndoLabel] = useState('');
  const undoRef = useRef<(() => void) | null>(null);
  const [libraryBlocked, setLibraryBlocked] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<StudySource | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestSerial = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const conversation = workspace.conversations.find((chat) => chat.id === workspace.activeId) ?? workspace.conversations[0];
  const attachmentKey = (conversation.libraryFileIds ?? []).join(',');
  const studyTopic: Topic = topic ?? NO_COURSE_TOPIC;
  const sources = useMemo(() => [
    ...(topic ? courseSources(topic) : []),
    ...remoteSources,
    ...(workspace.textSources ?? []).filter((source) => !isArtifactSourceId(source.id) || (conversation.selectedSourceIds ?? []).includes(source.id)),
    ...librarySources.filter((source) => (conversation.libraryFileIds ?? []).includes(source.libraryFileId ?? '')),
  ], [topic, remoteSources, workspace.textSources, librarySources, conversation.libraryFileIds]);
  const selectedSources = useMemo(
    () => selectNotebookSources(sources, conversation.selectedSourceIds ?? workspace.selectedSourceIds),
    [sources, conversation.selectedSourceIds, workspace.selectedSourceIds],
  );
  const scopeKey = notebookScopeKey(selectedSources);
  /** 从「我的内容」带进这段对话的成果（以文本来源的形式存在工作区里） */
  const attachedArtifactSources = useMemo(() => sources.filter((source) => isArtifactSourceId(source.id)), [sources]);
  const attachedArtifactKeys = useMemo(() => {
    const ids = new Set(attachedArtifactSources.map((source) => source.id));
    return ids.size ? allArtifacts.filter((item) => ids.has(artifactSourceId(item.key))).map((item) => item.key) : [];
  }, [attachedArtifactSources, allArtifacts]);
  const scopedTopic = sourceScopedTopic(studyTopic, selectedSources);
  const includesLecture = selectedSources.some((source) => source.id === `lecture:${topicId}`);
  const scenes = scopedTopic ? studyScenes(scopedTopic, includesLecture, !includesLecture) : [];
  const guided = restoreGuidedProgress(scenes, workspace.guided);
  const artifacts = (workspace.artifacts ?? []).filter((item) => !item.conversationId || item.conversationId === conversation.id);
  const artifact = artifacts.find((item) => item.id === params.get('artifact'));
  const customCards = includesLecture ? undefined : sourceEvidence(selectedSources).map((source) => ({
    id: `${scopeKey}:${source.id}`, front: `请用自己的话解释：${source.title}`, back: source.excerpt,
  }));
  const topicUnavailable = loading || Boolean(error) || Boolean(topicId && !topic);

  /* ── 资料与可用能力 ── */
  useEffect(() => {
    const controller = new AbortController();
    materialsRequest.current = controller;
    setLibrarySources([]);
    setMaterialsError('');
    if (!attachmentKey) { setMaterialsBusy(false); return () => controller.abort(); }
    setMaterialsBusy(true);
    void prepareLibrarySources(attachmentKey.split(','), controller.signal, (message) => { if (!controller.signal.aborted) setPhase(message); }, materialsRetry > 0)
      .then((result) => { if (!controller.signal.aborted && isCurrentAccount(owner, useAuthStore.getState())) setLibrarySources(result.sources); })
      .catch((reason) => { if (!controller.signal.aborted) setMaterialsError(reason.message || '资料读取失败，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) { setMaterialsBusy(false); setPhase(''); } });
    return () => controller.abort();
  }, [attachmentKey, conversation.id, owner, materialsRetry]);
  useEffect(() => {
    if (!topicId.startsWith('custom-') || !owner || view === 'library') return;
    const controller = new AbortController();
    void listStudyMaterials(topicId, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setRemoteSources(items.filter((item) => item.content.trim())); })
      .catch(() => { if (!controller.signal.aborted) setNotice('原文件摘录暂不可用，可以继续选择已发布讲义，稍后刷新重试。'); });
    return () => controller.abort();
  }, [topicId, owner, view]);
  useEffect(() => {
    const controller = new AbortController();
    setDeepAvailable(false);
    if (settings.mode === 'proxy' && owner) void getStudyTutorStatus(controller.signal).then((available) => { if (!controller.signal.aborted) setDeepAvailable(available); });
    return () => controller.abort();
  }, [settings.mode, owner]);
  useEffect(() => {
    const controller = new AbortController();
    setIntelligentAvailable(false);
    if (settings.mode === 'proxy' && owner) void learningAnswerAvailable(controller.signal).then((available) => { if (!controller.signal.aborted) setIntelligentAvailable(available); });
    return () => controller.abort();
  }, [settings.mode, owner]);

  const viewTitle = view === 'studio' ? artifact?.title ?? VIEW_LABELS.studio : view === 'source' ? sourcePreview?.title ?? VIEW_LABELS.source : VIEW_LABELS[view];
  useDocTitle(topic && !isToolView(view) && view !== 'library' && view !== 'journey' ? `学习终端 · ${viewTitle} · ${topic.title}` : view === 'ask' ? '学习终端' : `学习终端 · ${viewTitle}`);
  useEffect(() => {
    if (topic && topicId && identity.lastTopicId !== topicId) onIdentity({ lastTopicId: topicId });
  }, [topic, topicId, identity.lastTopicId, onIdentity]);

  /* ── 工作区存取 ── */
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Commit before returning from an input event, including an immediate reload.
  const updateWorkspace = (update: (current: StudyWorkspace) => StudyWorkspace) => {
    const next = update(workspaceRef.current);
    workspaceRef.current = next;
    setWorkspace(next);
    setSaveFailed(!saveWorkspace(owner, workspaceKeyId, next));
  };
  const mapChat = (chatId: string, update: (chat: StudyConversation) => StudyConversation) => updateWorkspace((current) => ({
    ...current, conversations: current.conversations.map((chat) => (chat.id === chatId ? update(chat) : chat)),
  }));
  const appendMessage = (chatId: string, message: StudyMessage) => mapChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message] }));
  const patchMessage = (chatId: string, messageId: string, patch: (message: StudyMessage) => StudyMessage) => mapChat(chatId, (chat) => ({
    ...chat, messages: chat.messages.map((message) => (message.id === messageId ? patch(message) : message)),
  }));
  useEffect(() => {
    const flush = () => { saveWorkspace(owner, workspaceKeyId, workspaceRef.current); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      requestSerial.current += 1;
      requestRef.current?.abort();
      flush();
    };
  }, [owner, workspaceKeyId]);
  const latestMessageText = conversation.messages.at(-1)?.text;
  useEffect(() => {
    // 对话流自己不滚动时，由外层容器跟到最新一条
    const node = feedRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [conversation.messages.length, latestMessageText, busy]);
  useEffect(() => { setSourcePreview(null); }, [workspace.activeId]);
  // 产物、对话名单变了：让成果登记处和「全部对话」目录重新读
  const conversationIndex = workspace.conversations.map((chat) => `${chat.id}:${chat.title}:${chat.messages.length ? 1 : 0}`).join('|');
  useEffect(() => { chatWorkspaceChanged(); }, [workspace.artifacts, conversationIndex]);
  // 从别处跳回来：?chat=<对话> 直接打开那段对话；?artifact=<产物> 属于另一段对话时先切过去
  const chatParam = params.get('chat');
  const artifactParam = params.get('artifact');
  useEffect(() => {
    const current = workspaceRef.current;
    const owning = artifactParam ? (current.artifacts ?? []).find((item) => item.id === artifactParam)?.conversationId : undefined;
    const wanted = chatParam ?? owning;
    if (wanted && wanted !== current.activeId && current.conversations.some((chat) => chat.id === wanted)) {
      updateWorkspace((state) => ({ ...state, activeId: wanted }));
    }
    if (chatParam) {
      const next = new URLSearchParams(params);
      next.delete('chat');
      setParams(next, { replace: true });
    }
  }, [chatParam, artifactParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo<CourseGroup[]>(() => {
    const result = new Map<string, { title: string; items: Topic[] }>();
    topics.filter((item) => !item.locked).forEach((item) => {
      const key = topicCourseKey(item);
      if (!result.has(key)) result.set(key, { title: item.course, items: [] });
      result.get(key)!.items.push(item);
    });
    for (const [key, group] of result) if (key.startsWith('custom:')) group.items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
    return [...result.entries()];
  }, [topics]);
  const openTopics = useMemo(() => topics.filter((item) => !item.locked), [topics]);

  /* ── 导航 ── */
  const switchView = (next: View, extra?: Record<string, string>) => {
    if (libraryBlocked && next !== 'library') { setNotice('资料中有未保存的校订或正在提交的任务，请先完成后再切换。'); return; }
    if (next === 'reading') { navigate('/learn?view=reading'); return; }
    setParams({ ...(next === 'ask' ? {} : { view: next }), ...extra });
    setNavSheetOpen(false);
    // 手机上侧面板是整屏的，换了视图就得让开
    if (isMobile || next === 'library' || next === 'prepare') setInspectorPanel(null);
    setNotice('');
  };
  const openTopic = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再打开另一门课。'); return; }
    setNavSheetOpen(false);
    navigate(`/prep/${encodeURIComponent(id)}`);
  };
  const chooseCourse = (id?: string) => {
    if (id) openTopic(id);
    else setPaletteOpen(true);
  };
  const setSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try { localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed'); } catch { /* 记不住也不影响使用 */ }
  };
  const toggleInspector = (panel: InspectorPanel) => setInspectorPanel((current) => (current === panel ? null : panel));
  const focusComposer = () => window.requestAnimationFrame(() => composerRef.current?.focus());

  /* ── 对话 ── */
  const stop = () => {
    if (materialsBusy) { materialsRequest.current?.abort(); setMaterialsBusy(false); setMaterialsError('已停止读取资料，可重新连接。'); }
    requestSerial.current += 1;
    requestRef.current?.abort();
    const stream = activeStream.current;
    if (stream) patchMessage(stream.chatId, stream.messageId, (message) => (message.run ? { ...message, run: closeRun(message.run, 'stopped', stream.startedAt) } : message));
    activeStream.current = null;
    setBusy(false);
    setPhase('');
    setNotice('已停止处理，已有内容已保留。');
  };
  const newChat = () => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再新建对话。'); return; }
    if (busy) stop();
    const id = studyId();
    updateWorkspace((current) => ({
      ...current,
      conversations: [...current.conversations.slice(-23), { id, title: '新的学习对话', messages: [], libraryFileIds: [], selectedSourceIds: sources.filter((source) => source.kind !== 'library' && !isArtifactSourceId(source.id)).map((source) => source.id) }],
      activeId: id,
    }));
    setInput('');
    switchView('ask');
    focusComposer();
  };
  const selectChat = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再切换对话。'); return; }
    if (busy) stop();
    updateWorkspace((current) => ({ ...current, activeId: id }));
    switchView('ask');
  };
  const renameChat = (id: string, title: string) => mapChat(id, (chat) => ({ ...chat, title: title.slice(0, 80) }));
  const deleteChat = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再删除对话。'); return; }
    const removed = workspace.conversations.find((chat) => chat.id === id);
    if (!removed) return;
    const removedArtifacts = (workspace.artifacts ?? []).filter((item) => item.conversationId === id);
    if (busy && id === conversation.id) stop();
    updateWorkspace((current) => {
      const rest = current.conversations.filter((chat) => chat.id !== id);
      const conversations = rest.length ? rest : [{ id: studyId(), title: '新的学习对话', messages: [], libraryFileIds: [] }];
      return {
        ...current, conversations,
        activeId: current.activeId === id ? conversations[conversations.length - 1].id : current.activeId,
        artifacts: (current.artifacts ?? []).filter((item) => item.conversationId !== id),
      };
    });
    undoRef.current = () => updateWorkspace((current) => ({
      ...current,
      conversations: [...current.conversations.filter((chat) => chat.id !== id), removed].slice(-24),
      activeId: removed.id,
      artifacts: [...(current.artifacts ?? []), ...removedArtifacts].slice(-24),
    }));
    setNotice('对话已删除。');
    setUndoLabel('撤销删除');
  };
  const askAbout = (text: string) => { setInput(text); switchView('ask'); focusComposer(); };
  const saveNote = (text: string, cited: StudySource[] = []) => {
    const attribution = cited.length ? `\n\n资料来源：\n${cited.map((source, index) => `[${index + 1}] ${source.title}\n> ${source.excerpt.replace(/\n/g, '\n> ')}`).join('\n\n')}` : '';
    updateWorkspace((current) => ({ ...current, note: `${current.note}${current.note ? '\n\n' : ''}${text}${attribution}`.slice(0, 20000) }));
    switchView('notes');
    setNotice('已收进学习便笺。');
  };
  const updateInteraction = (messageId: string, id: string, state: LearningInteraction[string]) => patchMessage(
    conversation.id, messageId, (message) => ({ ...message, interaction: { ...message.interaction, [id]: state } }),
  );
  /** 一次提问完成：记进学习行为日志。说自己卡住了，或又问了一遍同一件事，记为「卡住」 */
  const logQuestion = (question: string, earlier: string[]) => {
    const asked = question.split('\n\n')[0].trim();
    const struggling = STUCK.test(asked) || askedBefore(asked, earlier.map((text) => text.split('\n\n')[0]));
    logActivity(owner, {
      source: 'chat', summary: asked.replace(/\s+/g, ' ').slice(0, 120), signal: struggling ? 'struggle' : 'neutral',
      ...(topic ? { topicId: topic.topicId, topicTitle: topic.title } : {}),
      ...(struggling || asked.length > 120 ? { detail: asked } : {}),
      ref: { kind: 'conversation', id: conversation.id, title: conversation.title },
    });
  };
  const remember = (question: string, answer: string) => {
    try { recordTutorTurn(owner, { topicId: topicId || undefined, topicTitle: topic?.title, question, answer }); } catch { /* 记忆提炼失败不影响答疑 */ }
  };

  /** 发送前的检查；不满足时给出提示并带用户到该去的地方 */
  const canSend = () => {
    if (busy || materialsBusy) return false;
    if (materialsError) { setNotice('所选文件尚未准备好，请先重新连接资料。'); return false; }
    if (sources.length && !selectedSources.length) { setNotice('请先勾选至少一份学习资料。'); setInspectorPanel('sources'); return false; }
    if (sources.length && mode === 'deep' && !deepAvailable) { setNotice('深入答疑暂不可用，请选择直接答疑或引导思考。'); return false; }
    return true;
  };

  /**
   * 答疑管线。dropFrom 用于「重新生成」：从这条用户提问起替换掉原来的一轮。
   * 四条路：没有任何资料时凭模型自身知识作答；有资料时依次是流式生成式答疑、DeepTutor 深入答疑、普通答疑。
   */
  const send = async (question: string, dropFrom?: number) => {
    const chatId = conversation.id;
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const currentRequest = () => serial === requestSerial.current && !controller.signal.aborted && isCurrentAccount(owner, useAuthStore.getState());
    const kept = dropFrom === undefined ? conversation.messages : conversation.messages.slice(0, dropFrom);
    const history = kept.filter((message) => message.scopeKey === scopeKey);
    // 只算得到过回答的提问：上一次没答成、原样重试的不算「又问了一遍」
    const askedEarlier = kept.filter((message, index) => message.role === 'user' && kept[index + 1]?.role === 'assistant').slice(-12).map((message) => message.text);
    let answered = false;
    touchConversation(owner, workspaceKeyId, chatId);
    const prefs = useModelPrefs.getState();
    const stamp = { ...(prefs.model ? { model: prefs.model } : {}), effort: prefs.effort };
    mapChat(chatId, (chat) => ({
      ...chat,
      title: chat.messages.length ? chat.title : question.slice(0, 28),
      messages: [...(dropFrom === undefined ? chat.messages : chat.messages.slice(0, dropFrom)), { id: studyId(), role: 'user', text: question, sources: [], scopeKey }],
    }));
    setNotice('');
    setBusy(true);
    pinnedRef.current = true;

    /** 先放一条带进度的空回答，后面的事件往里填 */
    const openAnswer = (extra: Partial<StudyMessage> = {}, steps: LearningRun['steps'] = []) => {
      const messageId = studyId();
      const startedAt = Date.now();
      activeStream.current = { chatId, messageId, startedAt };
      appendMessage(chatId, { id: messageId, role: 'assistant', text: '', sources: [], scopeKey, run: { status: 'running', startedAt, elapsedMs: 0, steps }, ...extra });
      return { messageId, startedAt };
    };

    try {
      if (!sources.length && !(intelligentAvailable && settings.mode === 'proxy' && mode !== 'deep')) {
        if (settings.mode === 'mock') {
          appendMessage(chatId, { id: studyId(), role: 'assistant', local: true, sources: [], scopeKey, text: '当前是本地演示，没有连接模型。打开一门课或添加资料后再问我，我会把相关原文找出来给你对照。' });
          answered = true;
          return;
        }
        const { messageId, startedAt } = openAnswer(stamp, [{ id: 'model', label: '小砚正在思考', status: 'running', at: Date.now() }]);
        const hints = tutorMemoryHints(owner, undefined, 3, question);
        try {
          const result = await streamModel({
            messages: [
              { role: 'system', content: [
                '你是小砚，帮助大学生自主学习的助教。学生还没有打开课程，也没有提供资料：凭可靠的知识回答，不确定就直说，不要编造出处或声称看过某份资料。',
                mode === 'socratic' ? '使用苏格拉底引导：先抓住学生的具体疑点，给一个必要提示，再一次只问一个能帮助推理的问题。' : '先讲清核心想法，再给一个简洁例子和一个自检问题。',
                hints.length ? `可选背景（可能已过时，当前问题优先，不要强行提及）：${hints.join('；')}` : '',
                '用中文 Markdown 回答，公式用 LaTeX，不用“小砚：”前缀。',
              ].filter(Boolean).join('\n') },
              ...history.slice(-8).map((message) => (message.role === 'user'
                ? { role: 'user' as const, content: message.text.slice(0, 1500) }
                : { role: 'assistant' as const, content: message.text.slice(0, 1500) })),
              { role: 'user', content: question },
            ],
            model: prefs.model, effort: prefs.effort, signal: controller.signal,
            onText: (text) => { if (currentRequest()) patchMessage(chatId, messageId, (message) => ({ ...message, text: text.slice(0, 16000) })); },
            onReasoning: (reasoning) => { if (currentRequest()) patchMessage(chatId, messageId, (message) => ({ ...message, reasoning: reasoning.slice(0, 12000), thinkingMs: Date.now() - startedAt })); },
          });
          if (!currentRequest()) return;
          if (!result.text.trim()) throw new Error('empty-study-reply');
          patchMessage(chatId, messageId, (message) => ({
            ...message, text: result.text.slice(0, 16000), model: result.model || message.model,
            ...(result.reasoning ? { reasoning: result.reasoning.slice(0, 12000) } : {}),
            run: closeRun(message.run!, 'complete', startedAt),
          }));
          activeStream.current = null;
          remember(question, result.text);
          answered = true;
        } catch (reason) {
          if (!(reason instanceof ModelUnavailableError) || !currentRequest()) throw reason;
          // 没有可用模型：明确说明，而不是留下一条失败的空回答
          activeStream.current = null;
          patchMessage(chatId, messageId, ({ run: _run, model: _model, effort: _effort, ...message }) => ({
            ...message, local: true, text: '现在没有可用的模型。打开一门课或添加资料后，我可以先把相关原文摘出来给你对照。',
          }));
          answered = true;
        }
        return;
      }

      if (intelligentAvailable && settings.mode === 'proxy' && mode !== 'deep') {
        const { messageId, startedAt } = openAnswer(stamp);
        const onEvent = (event: StreamEvent) => {
          if (!currentRequest()) return;
          patchMessage(chatId, messageId, (message) => {
            if (event.type === 'stage') return withStage(message, event, startedAt);
            if (event.type === 'sources') return { ...message, sources: prepareStudySources(event.sources, 900, 8) };
            if (event.type === 'reasoning') return { ...message, reasoning: event.text.slice(0, 12000), thinkingMs: Date.now() - startedAt };
            if (event.type === 'text') return { ...message, text: event.text };
            return { ...message, text: event.text, ui: event.ui, interaction: {}, sources: prepareStudySources(event.sources, 900, 8), run: { ...message.run!, status: 'complete', elapsedMs: Date.now() - startedAt } };
          });
          if (event.type === 'done') { remember(question, event.text); answered = true; }
        };
        const request = {
          question, topicId: topicId || 'library', sources: selectedSources, history, mode, format: workspace.answerFormat ?? 'auto',
          signal: controller.signal, model: prefs.model ?? undefined, effort: prefs.effort, owner, onEvent,
        };
        await streamLearningAnswer(request as Parameters<typeof streamLearningAnswer>[0]);
        activeStream.current = null;
        return;
      }

      let evidence = prepareStudySources(sourceEvidence(selectedSources, question));
      const fileIds = selectedSources.filter((source) => source.libraryFileId).map((source) => source.libraryFileId!);

      if (mode === 'deep') {
        const { messageId, startedAt } = openAnswer({ engine: 'deeptutor', ...stamp });
        const report = (stage: StageEvent) => { if (currentRequest()) patchMessage(chatId, messageId, (message) => withStage(message, stage, startedAt)); };
        if (fileIds.length) {
          report({ id: 'files', label: '核对所选文件', status: 'running' });
          await readLibrarySources(fileIds, question, controller.signal);
          report({ id: 'files', label: '核对所选文件', status: 'done' });
        }
        if (!currentRequest()) return;
        // 先挂一步「已提交」，DeepTutor 开始回报自己的阶段后就让位
        report({ id: 'handoff', label: 'DeepTutor 正在核对资料并组织解释', status: 'running' });
        let reported = false;
        const onStage = (stage: StageEvent) => {
          if (!reported) { reported = true; report({ id: 'handoff', label: '已交给 DeepTutor', status: 'done' }); }
          report(stage);
        };
        const request = { topic: studyTopic, question, note: '', history, signal: controller.signal, selectedSources, onStage };
        const reply = await askDeepStudyTutor(request as Parameters<typeof askDeepStudyTutor>[0]);
        if (!currentRequest()) return;
        patchMessage(chatId, messageId, (message) => ({
          ...message, text: reply.content, sources: prepareStudySources(reply.sources), engine: 'deeptutor', rounds: reply.rounds,
          run: closeRun(message.run!, 'complete', startedAt),
        }));
        activeStream.current = null;
        if (reply.sourceNote) setNotice(reply.sourceNote);
        remember(question, reply.content);
        answered = true;
        return;
      }

      if (fileIds.length) {
        const verified = await readLibrarySources(fileIds, question, controller.signal);
        evidence = prepareStudySources([...verified.evidence, ...sourceEvidence(selectedSources.filter((source) => !source.libraryFileId), question)]);
      }
      if (!currentRequest()) return;
      setPhase('小砚正在整理解释…');
      const local = settings.mode === 'mock';
      const reply = local
        ? `当前为本地演示，以下是所选资料的摘录，供你对照阅读。\n\n${evidence.map((source, index) => `${source.excerpt} [${index + 1}]`).join('\n\n')}`
        : await askStudyTutor({ topic: studyTopic, mode, note: '', sources: evidence, history, question, settings, signal: controller.signal, selectedOnly: true });
      if (!currentRequest()) return;
      appendMessage(chatId, { id: studyId(), role: 'assistant', text: reply, sources: evidence, local, scopeKey });
      remember(question, reply);
      answered = true;
    } catch {
      if (currentRequest()) {
        const stream = activeStream.current;
        if (stream) patchMessage(chatId, stream.messageId, (message) => (message.run ? { ...message, run: closeRun(message.run, 'failed', stream.startedAt) } : message));
        activeStream.current = null;
        setInput(question);
        setNotice('本次回答未完成，问题已放回输入框。请重试；已经显示的内容已保留。');
      }
    } finally {
      if (answered) logQuestion(question, askedEarlier);
      if (currentRequest()) { setBusy(false); setPhase(''); }
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!input.trim() || !canSend()) return;
    const activeScene = view === 'guided' ? scenes.find((scene) => scene.id === guided.activeId) : undefined;
    if (activeScene) updateWorkspace((current) => ({ ...current, guided: { ...guided, returnId: activeScene.id } }));
    if (view !== 'ask') switchView('ask');
    const question = `${input.trim()}${activeScene ? `\n\n${sceneQuestionContext(activeScene)}` : ''}`.slice(0, 3000);
    setInput('');
    void send(question);
  };
  /** 重新生成：把这条回答前面的那个提问再问一次 */
  const regenerate = (messageId: string) => {
    const messages = conversation.messages;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || !canSend()) return;
    let asked = index - 1;
    while (asked >= 0 && messages[asked].role !== 'user') asked -= 1;
    if (asked < 0) return;
    // 最后一轮直接替换；更早的回答保持原样，在末尾重新问一次
    const lastTurn = !messages.slice(index + 1).some((message) => message.role === 'user');
    void send(messages[asked].text, lastTurn ? asked : undefined);
  };

  /* ── 资料与产物 ── */
  const openSource = (source: StudySource) => {
    const fileId = source.fileId ?? (source.id.startsWith('library:') ? source.id.split(':')[1] : undefined);
    setSourcePreview({ ...source, fileId });
    switchView('source');
  };
  const selectSources = (ids: string[]) => {
    if (busy) stop();
    updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => (chat.id === conversation.id ? { ...chat, selectedSourceIds: ids } : chat)), readSections: [] }));
  };
  const attachFiles = (ids: string[]) => {
    if (busy) stop();
    const unique = [...new Set(ids)].slice(0, 12);
    mapChat(conversation.id, (chat) => ({
      ...chat, libraryFileIds: unique,
      selectedSourceIds: [...selectedSources.filter((source) => !source.libraryFileId).map((source) => source.id), ...unique.map((id) => `library:${id}`)],
    }));
    setPicker(null);
    switchView('ask');
  };
  const addFiles = (ids: string[]) => {
    const merged = [...new Set([...(conversation.libraryFileIds ?? []), ...ids])];
    if (merged.length > 12) { setNotice('当前对话最多使用 12 份文件，请先移除不需要的文件。'); return; }
    attachFiles(merged);
  };
  /**
   * 把「我的内容」里的成果设为这段对话的来源：正文取一份快照，作为文本来源存进工作区，
   * 只在附加了它的对话里生效。keys 是这段对话要带的全部成果。
   */
  const setConversationArtifacts = async (keys: string[]) => {
    const chatId = conversation.id;
    const wanted = [...new Set(keys)].slice(0, 8);
    const { sources: found, missing } = await artifactSources(owner, wanted);
    if (!isCurrentAccount(owner, useAuthStore.getState())) return;
    if (busy) stop();
    let dropped = 0;
    updateWorkspace((current) => {
      const chat = current.conversations.find((item) => item.id === chatId);
      if (!chat) return current;
      // 别的对话还在用的成果来源留着，其余没人用的顺手清掉
      const usedElsewhere = new Set(current.conversations.filter((item) => item.id !== chatId).flatMap((item) => (item.selectedSourceIds ?? []).filter(isArtifactSourceId)));
      const others = (current.textSources ?? []).filter((source) => (!isArtifactSourceId(source.id) || usedElsewhere.has(source.id)) && !found.some((item) => item.id === source.id));
      const room = Math.max(0, 16 - others.length);
      dropped = Math.max(0, found.length - room);
      const added = found.slice(0, room);
      const base = chat.selectedSourceIds ?? selectedSources.map((source) => source.id);
      return {
        ...current,
        textSources: [...others, ...added],
        conversations: current.conversations.map((item) => (item.id === chatId
          ? { ...item, selectedSourceIds: [...base.filter((id) => !isArtifactSourceId(id)), ...added.map((source) => source.id)] }
          : item)),
      };
    });
    if (dropped) setNotice('每课最多保存 16 份补充文本，有几份内容没能带进来，请先整理已有资料。');
    else if (missing) setNotice(`有 ${missing} 份内容已经找不到了，其余已带进这段对话。`);
    else if (found.length) setNotice(`已把 ${found.length} 份内容带进这段对话，小砚会依据它们回答。`);
  };
  /** 在已带的成果之外再加几份（资料库「用于对话」走这里） */
  const addArtifacts = async (keys: string[]) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再把内容带进对话。'); return; }
    switchView('ask');
    await setConversationArtifacts([...attachedArtifactKeys, ...keys]);
    focusComposer();
  };
  const detachArtifactSource = (id: string) => {
    if (busy) stop();
    updateWorkspace((current) => {
      const usedElsewhere = current.conversations.some((chat) => chat.id !== conversation.id && (chat.selectedSourceIds ?? []).includes(id));
      return {
        ...current,
        textSources: usedElsewhere ? current.textSources : (current.textSources ?? []).filter((source) => source.id !== id),
        conversations: current.conversations.map((chat) => (chat.id === conversation.id
          ? { ...chat, selectedSourceIds: (chat.selectedSourceIds ?? selectedSources.map((source) => source.id)).filter((sourceId) => sourceId !== id) }
          : chat)),
      };
    });
  };
  /** 附加选择器确认：文件和成果各自只在变了的时候更新 */
  const confirmAttach = (selection: AttachSelection) => {
    const sameFiles = selection.fileIds.join(',') === (conversation.libraryFileIds ?? []).join(',');
    const sameArtifacts = [...selection.artifactKeys].sort().join(',') === [...attachedArtifactKeys].sort().join(',');
    if (!sameFiles) attachFiles(selection.fileIds);
    else { setPicker(null); switchView('ask'); }
    if (!sameArtifacts) void setConversationArtifacts(selection.artifactKeys);
  };
  const addTextSource = (title: string, content: string) => {
    if ((workspace.textSources?.length ?? 0) >= 16) { setNotice('每课最多保存 16 份补充文本，请先整理已有资料。'); return; }
    const source: NotebookSource = { id: `text:${studyId()}`, title, content, kind: 'text' };
    updateWorkspace((current) => ({
      ...current, textSources: [...(current.textSources ?? []), source],
      conversations: current.conversations.map((chat) => (chat.id === conversation.id ? { ...chat, selectedSourceIds: [...selectedSources.map((item) => item.id), source.id] } : chat)),
    }));
  };
  const removeSource = (id: string) => {
    const removed = workspace.textSources?.find((item) => item.id === id);
    if (!removed) return;
    if (busy) stop();
    updateWorkspace((current) => ({ ...current, textSources: (current.textSources ?? []).filter((item) => item.id !== id), selectedSourceIds: selectedSources.filter((item) => item.id !== id).map((item) => item.id) }));
    undoRef.current = () => updateWorkspace((current) => ({
      ...current, textSources: [...(current.textSources ?? []).filter((item) => item.id !== id), removed],
      selectedSourceIds: [...(current.selectedSourceIds ?? sources.map((source) => source.id)), id],
    }));
    setNotice('补充文本已从本课移除。');
    setUndoLabel('撤销移除');
  };
  const openArtifact = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存资料校订。'); return; }
    setParams({ view: 'studio', artifact: id });
    setNavSheetOpen(false);
    if (isMobile) setInspectorPanel(null);
    setNotice('');
  };
  const verifiedSelection = async (signal: AbortSignal) => {
    const fileIds = selectedSources.filter((source) => source.libraryFileId).map((source) => source.libraryFileId!);
    if (!fileIds.length) return selectedSources;
    const verified = await readLibrarySources(fileIds, '', signal);
    return [...selectedSources.filter((source) => !source.libraryFileId), ...verified.sources];
  };
  const createItem = async (kind: StudioToolId) => {
    if (materialsBusy || materialsError || !selectedSources.length) { setNotice('请先选择并准备好学习资料。'); setInspectorPanel('sources'); return; }
    if (kind === 'guided' || kind === 'read' || kind === 'practice' || kind === 'cards') { switchView(kind); return; }
    if (libraryBlocked || busy) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const serial = ++requestSerial.current;
    setBusy(true);
    setPhase('正在核对资料来源…');
    try {
      const verified = await verifiedSelection(controller.signal);
      if (serial !== requestSerial.current || controller.signal.aborted || !isCurrentAccount(owner, useAuthStore.getState())) return;
      const existing = artifacts.find((item) => item.kind === kind && item.scopeKey === notebookScopeKey(verified));
      if (existing) { openArtifact(existing.id); return; }
      const created = { ...createStudyArtifact(kind as StudioKind, studyTopic.title, verified), conversationId: conversation.id };
      updateWorkspace((current) => ({ ...current, artifacts: [...(current.artifacts ?? []).slice(-23), created] }));
      openArtifact(created.id);
    } catch (reason) {
      if (!controller.signal.aborted) setNotice(reason instanceof Error ? reason.message : '无法读取所选资料。');
    } finally {
      if (serial === requestSerial.current) { setBusy(false); setPhase(''); }
    }
  };
  const updateArtifact = (updated: StudyArtifact) => updateWorkspace((current) => ({ ...current, artifacts: (current.artifacts ?? []).map((item) => (item.id === updated.id ? updated : item)) }));
  const removeArtifact = (id: string) => {
    const removed = artifacts.find((item) => item.id === id);
    if (!removed) return;
    updateWorkspace((current) => ({ ...current, artifacts: (current.artifacts ?? []).filter((item) => item.id !== id) }));
    if (artifact?.id === id) switchView('ask');
    undoRef.current = () => updateWorkspace((current) => ({ ...current, artifacts: [...(current.artifacts ?? []).filter((item) => item.id !== id), removed] }));
    setNotice('产物已移除。');
    setUndoLabel('撤销移除');
  };
  const enhanceArtifact = async () => {
    if (!artifact || busy) return;
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setPhase('小砚正在根据所选资料整理内容…');
    setNotice('');
    try {
      const verified = await verifiedSelection(controller.signal);
      const updated = await enrichStudyArtifact(artifact, verified, settings, controller.signal);
      if (serial === requestSerial.current && isCurrentAccount(owner, useAuthStore.getState()) && !controller.signal.aborted) updateArtifact(updated);
    } catch (reason) {
      if (serial === requestSerial.current && !controller.signal.aborted) setNotice(reason instanceof Error ? reason.message : '整理未完成，原稿已保留。');
    } finally {
      if (serial === requestSerial.current) { setBusy(false); setPhase(''); }
    }
  };
  const downloadSource = async () => {
    if (!sourcePreview?.fileId) return;
    try {
      const blob = await downloadLibraryFile(sourcePreview.fileId);
      if (isCurrentAccount(owner, useAuthStore.getState())) saveBlob(sourcePreview.title, blob);
    } catch {
      setNotice('原件暂不可用，请检查文件是否已移入回收站。');
    }
  };
  const dismissNotice = () => { setNotice(''); setUndoLabel(''); undoRef.current = null; };
  const undo = () => { undoRef.current?.(); undoRef.current = null; setUndoLabel(''); setNotice('已恢复。'); };

  /* ── 版面 ── */
  const welcomeState = !topic && !topicUnavailable && !attachmentKey && !attachedArtifactSources.length && !conversation.messages.length && view === 'ask';
  const showComposer = Boolean(owner || topic) && COMPOSER_VIEWS.includes(view) && !topicUnavailable;
  const showPanels = view !== 'library' && view !== 'prepare';
  const showTabs = Boolean(topic) && !isToolView(view) && view !== 'library' && view !== 'journey';
  const showBack = !showTabs && !isToolView(view) && view !== 'ask' && view !== 'library';
  const needsSources = STUDY_VIEW_IDS.includes(view) && !selectedSources.length;
  const readLetter = () => onIdentity({ letterReadAt: identity.letterReadAt ?? new Date().toISOString() });
  const acceptLetter = () => onIdentity({ acceptedAt: new Date().toISOString(), letterReadAt: identity.letterReadAt ?? new Date().toISOString() });
  const viewProps: TerminalViewProps = {
    owner, topic, topics, selectedSources,
    onAsk: askAbout,
    onOpenTopic: openTopic,
    onView: (next, extra) => switchView(isView(next) ? next : 'ask', extra),
    onNotice: setNotice,
  };
  const chatHandoff = useMemo<ChatHandoff>(() => ({
    owner,
    ...(topic ? { topicId: topic.topicId, topicTitle: topic.title, teachTopicId: topic.topicId } : {}),
  }), [owner, topic]);
  /** 当前账号在所有课程里的对话；开始页的「最近」和命令面板用 */
  const allConversations = useMemo(
    () => (welcomeState || paletteOpen ? listConversations(owner) : []),
    [welcomeState, paletteOpen, owner, conversationIndex], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const openConversation = (chat: ConversationBrief) => {
    if (chat.workspace === workspaceKeyId) { selectChat(chat.id); return; }
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再打开别的对话。'); return; }
    navigate(targetPath({ view: 'ask', params: { chat: chat.id }, ...(chat.topicId ? { topicId: chat.topicId } : {}) }, '/learn'));
  };
  const openArtifactItem = (item: Artifact) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再打开别的内容。'); return; }
    setNavSheetOpen(false);
    setNotice('');
    openTarget(item.open);
  };
  /* ── 学习行为日志：读讲义、带我学、练一练、闪卡 ── */
  const topicRef = topic ? { topicId: topic.topicId, topicTitle: topic.title } : {};
  const logGuided = (next: GuidedProgress) => {
    const before = guided;
    for (const scene of scenes) {
      if (scene.kind === 'quiz' && next.answers[scene.id] !== undefined && before.answers[scene.id] === undefined) {
        const correct = next.answers[scene.id] === scene.answer;
        logActivity(owner, {
          source: 'guided', signal: correct ? 'success' : 'struggle', ...topicRef,
          summary: `带我学「${studyTopic.title}」自检题${correct ? '答对' : '答错'}：${scene.title}`.slice(0, 150),
          detail: `${scene.body}\n选了：${scene.options[next.answers[scene.id]] ?? ''}；正确：${scene.options[scene.answer] ?? ''}`,
        });
      } else if (next.completed.includes(scene.id) && !before.completed.includes(scene.id)) {
        logActivity(owner, {
          source: 'guided', ...topicRef,
          summary: scene.kind === 'reflect' ? `带我学「${studyTopic.title}」写下了自己的解释` : `带我学「${studyTopic.title}」完成一步：${scene.title}`.slice(0, 150),
          ...(scene.kind === 'reflect' && next.reflection.trim() ? { detail: next.reflection.trim() } : {}),
        });
      }
    }
  };
  const sidebarProps = {
    view, topicId, hasTopic: Boolean(topic), groups, conversations: workspace.conversations, activeChatId: workspace.activeId,
    onNewChat: newChat, onSearch: () => { setNavSheetOpen(false); setPaletteOpen(true); }, onOpenTopic: openTopic,
    onAddCourse: () => switchView('library'), onSelectChat: selectChat, onRenameChat: renameChat, onDeleteChat: deleteChat,
    onView: (next: View) => switchView(next),
    onCourseChanged: async (key: string, deleted: boolean) => {
      await useAppStore.getState().loadCustomTopics(true);
      if (deleted && topic && topicCourseKey(topic) === key) navigate('/learn');
    },
  };

  const chatEmpty = (
    <div className={t.chatEmpty}>
      <h2>{topic ? `「${topic.title}」，想先弄懂哪一处？` : '资料已经备好，想先弄懂哪一处？'}</h2>
      <p>我是小砚。可以直接提问，也可以让我先帮你把资料理一遍。</p>
      <div className={t.chips}>
        <button type="button" onClick={() => { setInput('帮我概括所选资料的核心内容，并标注来源。'); focusComposer(); }}>概括核心内容</button>
        <button type="button" onClick={() => void createItem('mindmap')}>整理思维导图</button>
        <button type="button" onClick={() => void createItem('guided')}>带我一步步学</button>
        <button type="button" onClick={() => { setInput('围绕所选资料，一次问我一道自检问题，等我回答再反馈。'); focusComposer(); }}>出题考考我</button>
      </div>
    </div>
  );

  let content: ReactNode;
  if (view === 'library') {
    content = (
      <div className={t.fill}>
        <Suspense fallback={<ViewLoading label="正在打开资料库…" />}>
          <RequireAuth>
            <LibraryPage
              onLeaveGuardChange={setLibraryBlocked}
              onUseInConversation={async (ids) => { addFiles(ids); }}
              onUseArtifacts={(keys) => { void addArtifacts(keys); }}
              onView={(next, extra) => switchView(isView(next) ? next : 'ask', extra)}
            />
          </RequireAuth>
        </Suspense>
      </div>
    );
  } else if (isToolView(view)) {
    const ToolView = TOOL_COMPONENTS[view];
    content = (
      <div className={t.scroll}>
        <Suspense fallback={<ViewLoading label={`正在打开${VIEW_LABELS[view]}…`} />}>
          <ToolView {...viewProps} />
        </Suspense>
      </div>
    );
  } else if (view === 'journey') {
    content = (
      <div className={t.scroll}>
        <StudyJourney topic={topic} topics={topics} identity={identity} onAccept={acceptLetter} onLearn={() => (topic ? switchView('guided') : chooseCourse(identity.lastTopicId ?? undefined))} />
      </div>
    );
  } else if (topicUnavailable) {
    content = (
      <div className={t.scroll}>
        {loading ? (
          <Empty icon={<Spinner size={20} />} title="正在取回你的课程…" description="课程与资料正在准备。" />
        ) : (
          <Empty
            icon={<TriangleAlert size={22} strokeWidth={1.75} />}
            title="暂时无法打开这门课"
            description="课程可能尚未发布，或连接暂时中断。"
            action={<>
              {error && <Button variant="solid" onClick={retry}>重新连接</Button>}
              <Button variant="soft" onClick={() => navigate('/learn')}>回到学习终端</Button>
            </>}
          />
        )}
      </div>
    );
  } else if (welcomeState) {
    content = (
      <div className={t.scroll}>
        <TerminalWelcome
          topics={topics}
          identity={identity}
          onAccept={acceptLetter}
          onReadLetter={readLetter}
          onSelectCourse={chooseCourse}
          onUpload={() => setPicker('files')}
          owner={owner}
          conversations={allConversations}
          onOpenConversation={openConversation}
          onOpenArtifact={openArtifactItem}
          onSearchAll={() => setPaletteOpen(true)}
          onJourney={() => switchView('journey')}
        />
      </div>
    );
  } else if (view === 'ask') {
    content = (
      <>
        {guided.returnId && (
          <div className={t.returnBar}>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={15} strokeWidth={1.75} />}
              onClick={() => { updateWorkspace((current) => ({ ...current, guided: { ...guided, activeId: guided.returnId!, returnId: undefined } })); switchView('guided'); }}
            >
              返回刚才的学习步骤
            </Button>
          </div>
        )}
        <div
          className={t.chatArea}
          ref={feedRef}
          onScroll={() => { const node = feedRef.current; if (node) pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}
        >
          <ChatFeed
            conversation={conversation}
            busy={busy || materialsBusy}
            phase={phase}
            streamingId={busy ? activeStream.current?.messageId ?? null : null}
            empty={chatEmpty}
            onAsk={askAbout}
            onSource={openSource}
            onSaveNote={saveNote}
            onInteraction={updateInteraction}
            onRegenerate={regenerate}
            handoff={chatHandoff}
          />
        </div>
      </>
    );
  } else {
    content = (
      <div className={t.scroll}>
        {view === 'source' && (sourcePreview ? (
          <article className={t.document}>
            <p className={t.documentKicker}>资料原文</p>
            <h1>{sourcePreview.title}</h1>
            <p className={t.documentHint}>当前查看的是资料正文，或本轮回答保存的引用片段。</p>
            <CoachMarkdown text={sourcePreview.excerpt} />
            <div className={t.documentActions}>
              <Button variant="solid" iconRight={<ArrowRight size={15} strokeWidth={1.75} />} onClick={() => askAbout(`请解释这份资料中的关键概念：${sourcePreview.title}`)}>带着这份资料提问</Button>
              {sourcePreview.fileId && <Button variant="soft" icon={<Download size={15} strokeWidth={1.75} />} onClick={() => void downloadSource()}>下载原件</Button>}
            </div>
          </article>
        ) : (
          <Empty
            icon={<FileText size={22} strokeWidth={1.75} />}
            title="选一份资料查看原文"
            description="在资料面板点标题，或点回答里的引用编号。"
            action={<Button variant="solid" onClick={() => setInspectorPanel('sources')}>打开资料</Button>}
          />
        ))}
        {view === 'notes' && (
          <div className={t.document}>
            <h1>学习便笺</h1>
            <p className={t.documentHint}>{saveFailed ? '本机保存失败，请立即导出内容。' : '自动保存在当前浏览器，按账号和课程分开。'}</p>
            <Textarea
              className={t.notes}
              aria-label="学习便笺"
              value={workspace.note}
              maxLength={20000}
              placeholder="记下你自己的理解，也可以从回答中保存内容…"
              onChange={(event) => updateWorkspace((current) => ({ ...current, note: event.target.value }))}
            />
            {workspace.note.trim() && (
              <div className={t.documentActions}>
                <Button variant="soft" icon={<Download size={15} strokeWidth={1.75} />} onClick={() => downloadStudyFile(`${studyTopic.title}-学习便笺.md`, workspace.note)}>导出便笺</Button>
              </div>
            )}
          </div>
        )}
        {view === 'studio' && (artifact ? (
          <ArtifactPanel
            key={artifact.id + artifact.kind}
            artifact={artifact}
            onUpdate={updateArtifact}
            onEnhance={() => void enhanceArtifact()}
            busy={busy}
            saveFailed={saveFailed}
            onSource={openSource}
            sendTo={(
              <SendTo
                owner={owner}
                text={() => artifactMarkdown(artifact)}
                title={artifact.title}
                topicId={chatHandoff.topicId}
                topicTitle={chatHandoff.topicTitle}
                teachTopicId={chatHandoff.teachTopicId}
                routes={['agent', 'lesson', 'teach']}
                origin={{ section: 'chat', label: `对话产物：${artifact.title}`, open: { view: 'studio', params: { artifact: artifact.id }, ...(chatHandoff.topicId ? { topicId: chatHandoff.topicId } : {}) } }}
              >
                <button type="button"><Forward size={15} strokeWidth={1.75} />发送到</button>
              </SendTo>
            )}
          />
        ) : (
          <Empty
            icon={<IconSpark size={22} />}
            title="还没有打开产物"
            description="用所选资料创建导图、报告或课件，或打开已保存的产物。"
            action={<Button variant="solid" onClick={() => setInspectorPanel('tools')}>打开工具与产物</Button>}
          />
        ))}
        {needsSources ? (
          <Empty
            icon={<Library size={22} strokeWidth={1.75} />}
            title="先选择学习资料"
            description="勾选想学的内容，再继续。"
            action={<Button variant="solid" onClick={() => setInspectorPanel('sources')}>选择资料</Button>}
          />
        ) : scopedTopic && (
          <Suspense fallback={<ViewLoading label="正在打开学习内容…" />}>
            {view === 'read' && <ReadingPanel key={scopeKey} topic={scopedTopic} readSections={workspace.readSections} onRead={(index) => {
              updateWorkspace((current) => ({ ...current, readSections: [...new Set([...current.readSections, index])] }));
              const sections = lectureSections(scopedTopic);
              logActivity(owner, { source: 'reading', ...topicRef, summary: `读讲义「${studyTopic.title}」第 ${index + 1}/${sections.length} 段：${sections[index]?.title ?? ''}`.slice(0, 150) });
            }} onAsk={askAbout} />}
            {view === 'guided' && <GuidedStudyPanel key={scopeKey} topic={scopedTopic} includeSelfTests={includesLecture} originalOnly={!includesLecture} saved={workspace.guided} onSave={(next) => { logGuided(next); updateWorkspace((current) => ({ ...current, guided: next })); }} onAsk={askAbout} />}
            {view === 'practice' && <PracticePanel key={scopeKey} topic={scopedTopic} selfChecks={customCards} answers={workspace.practiceAnswers} onAnswers={(practiceAnswers) => updateWorkspace((current) => ({ ...current, practiceAnswers }))}
              onResult={(result) => logActivity(owner, {
                source: 'practice', signal: result.correct ? 'success' : 'struggle', ...topicRef,
                summary: `练一练「${studyTopic.title}」${result.selfRated ? (result.correct ? '自评能解释' : '自评还要复习') : (result.correct ? '答对' : '答错')}：${result.stem.replace(/\s+/g, ' ').slice(0, 60)}`,
                detail: result.stem,
              })}
              onAsk={askAbout} />}
            {view === 'cards' && <CardsPanel key={scopeKey} topic={scopedTopic} sourceCards={customCards} ratings={workspace.ratings} onRate={(id, value, front) => {
              updateWorkspace((current) => ({ ...current, ratings: { ...current.ratings, [id]: value } }));
              logActivity(owner, {
                source: 'flashcards', signal: value === 'know' ? 'success' : 'struggle', ...topicRef,
                summary: `闪卡「${studyTopic.title}」${value === 'know' ? '记住了' : '还要复习'}：${(front ?? '').replace(/\s+/g, ' ').slice(0, 60)}`,
                ...(front ? { detail: front } : {}),
              });
            }} />}
          </Suspense>
        )}
        {view === 'prepare' && (topic ? (
          <Suspense fallback={<ViewLoading label="正在打开备课流程…" />}><PrepPage /></Suspense>
        ) : (
          <Empty
            icon={<Library size={22} strokeWidth={1.75} />}
            title="备课流程从一门课开始"
            description="先选一个知识点，再按步骤备课、回讲。"
            action={<Button variant="solid" onClick={() => setPaletteOpen(true)}>选一门课</Button>}
          />
        ))}
        {busy && view === 'studio' && (
          <div className={t.working} role="status">
            <Spinner size={15} />
            <span>{phase}</span>
            <Button variant="ghost" size="sm" onClick={stop}>停止整理</Button>
          </div>
        )}
      </div>
    );
  }

  const chatSection = railKey(view) === 'ask';
  // 手机上常驻伙伴只在对话页出现，站在输入框上沿；阅读与练习页不挡内容
  const companionVisible = companionOn && view !== 'prepare' && view !== 'library' && !isToolView(view)
    && !(isMobile && (view !== 'ask' || welcomeState || navSheetOpen || Boolean(inspectorPanel)));

  /* ── 手机版面：键盘让位、标签条跟随、伙伴避开输入框 ── */
  useKeyboardViewport(isMobile);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 当前学习方式的标签滑到可见处（闪卡、备课流程在窄屏上排在屏外）
    const list = tabsRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const active = list?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const box = list.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    list.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
  }, [view, showTabs, isMobile]);
  useEffect(() => {
    // 输入框会长高（多行、附件）：把停靠区高度交给常驻伙伴，让它始终站在输入框上沿
    const root = rootRef.current;
    const dock = dockRef.current;
    if (!root || !dock || !isMobile || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => root.style.setProperty('--dock-h', `${dock.offsetHeight}px`));
    observer.observe(dock);
    return () => { observer.disconnect(); root.style.removeProperty('--dock-h'); };
  }, [showComposer, isMobile]);

  return (
    <SidebarSlotProvider value={chatSection || !sidebarOpen || isMobile ? null : sectionSlot}>
    <div ref={rootRef} className={t.terminal} data-sidebar={sidebarOpen ? 'open' : 'collapsed'} data-inspector={inspectorPanel && showPanels ? 'open' : undefined} data-view={view} data-companion={companionVisible || undefined}>
      <TerminalRail view={view} onView={(next) => switchView(next)} onMore={() => setNavSheetOpen(true)} />

      <aside className={t.sidebar} aria-label={chatSection ? '课程项目与对话' : `${VIEW_LABELS[view]}导航`}>
        <TerminalSidebar {...sidebarProps} sectionSlot={setSectionSlot} onCollapse={() => setSidebar(false)} />
      </aside>

      <div className={t.workspace}>
        {view !== 'reading' && <TerminalHeader
          topic={chatSection ? topic : undefined}
          viewLabel={view === 'ask' ? undefined : viewTitle}
          sidebarOpen={sidebarOpen}
          onShowSidebar={() => (isMobile ? setNavSheetOpen(true) : setSidebar(true))}
          showPanels={showPanels}
          inspector={inspectorPanel}
          sourceCount={selectedSources.length}
          onInspector={toggleInspector}
          onCourse={() => setPaletteOpen(true)}
          onTopic={() => switchView('ask')}
        />}

        {materialsError && (
          <div className={t.banner} role="alert">
            <TriangleAlert size={16} strokeWidth={1.75} />
            <span>{materialsError}</span>
            <Button variant="outline" size="sm" onClick={() => setMaterialsRetry((value) => value + 1)}>重新连接资料</Button>
          </div>
        )}
        {saveFailed && (
          <div className={t.banner} role="alert">
            <TriangleAlert size={16} strokeWidth={1.75} />
            <span>本机保存失败，当前改动仅留在页面中。请先导出备份，再处理浏览器存储空间。</span>
            <Button variant="outline" size="sm" onClick={() => downloadStudyFile(`${topic?.title ?? '学习终端'}-备份.json`, JSON.stringify(workspace, null, 2), 'application/json')}>导出当前工作区</Button>
          </div>
        )}

        <div className={t.body}>
          <section className={t.main} aria-label="学习工作区">
            {showTabs && (
              <div className={t.tabs} ref={tabsRef}>
                <Tabs
                  label="学习方式"
                  value={view}
                  onValueChange={(next) => { if (isView(next)) switchView(next); }}
                  items={STUDY_TABS.map(({ id, label, icon: TabIcon }) => ({ value: id, label, icon: <TabIcon size={15} strokeWidth={1.75} /> }))}
                />
              </div>
            )}
            {showBack && (
              <div className={t.returnBar}>
                <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} strokeWidth={1.75} />} onClick={() => switchView('ask')}>返回对话</Button>
              </div>
            )}
            {(notice || undoLabel) && (
              <div className={t.notice} role="status">
                <Info size={16} strokeWidth={1.75} />
                <span>{notice}</span>
                {undoLabel && <Button variant="soft" size="sm" onClick={undo}>{undoLabel}</Button>}
                <IconButton label="关闭提示" size="sm" tip={false} onClick={dismissNotice}><X size={15} strokeWidth={1.75} /></IconButton>
              </div>
            )}
            {content}
            {showComposer && (
              <div className={t.composerDock} ref={dockRef} data-composer={view === 'ask' ? undefined : 'compact'}>
                <Composer
                  input={input}
                  onInput={setInput}
                  mode={mode}
                  onMode={setMode}
                  answerFormat={workspace.answerFormat ?? 'auto'}
                  onAnswerFormat={(answerFormat) => updateWorkspace((current) => ({ ...current, answerFormat }))}
                  busy={busy || materialsBusy}
                  onStop={stop}
                  onSubmit={submit}
                  inputRef={composerRef}
                  deepAvailable={deepAvailable}
                  intelligentAvailable={intelligentAvailable && settings.mode === 'proxy' && mode !== 'deep'}
                  demo={settings.mode === 'mock'}
                  sourceCount={selectedSources.length}
                  freeChat={sources.length === 0}
                  attachments={[
                    ...attachedArtifactSources.map((source) => ({ id: source.id, title: source.title, kind: 'artifact' as const })),
                    ...(conversation.libraryFileIds ?? []).map((id) => ({ id, title: librarySources.find((source) => source.libraryFileId === id)?.title ?? '资料文件', kind: 'file' as const })),
                  ]}
                  onRemoveAttachment={(id) => (isArtifactSourceId(id) ? detachArtifactSource(id) : attachFiles((conversation.libraryFileIds ?? []).filter((fileId) => fileId !== id)))}
                  onAttach={() => setPicker('files')}
                  onAttachContent={() => setPicker('artifacts')}
                  onOpenSources={() => setInspectorPanel('sources')}
                  placeholder={isMobile && view !== 'ask' ? '哪里没懂，问小砚…' : topic ? `向小砚提问「${topic.title}」…` : sources.length ? '依据所选资料向小砚提问…' : '想学什么，直接问小砚…'}
                />
              </div>
            )}
          </section>

          {inspectorPanel && showPanels && (
            <Inspector panel={inspectorPanel} sourceCount={selectedSources.length} onPanel={setInspectorPanel} onClose={() => setInspectorPanel(null)}>
              {inspectorPanel === 'sources' ? (
                <SourcesPanel
                  sources={sources}
                  selected={selectedSources}
                  onSelect={selectSources}
                  onPreview={(source) => openSource({ id: source.id, title: source.title, excerpt: source.content })}
                  onAdd={addTextSource}
                  onDelete={removeSource}
                  onPickLibrary={() => setPicker('files')}
                  onLibrary={() => switchView('library')}
                />
              ) : (
                <StudioPanel
                  artifacts={artifacts}
                  sourceCount={selectedSources.length}
                  busy={busy}
                  activeView={view === 'studio' ? artifact?.kind ?? '' : view}
                  onCreate={(kind) => void createItem(kind)}
                  onOpen={openArtifact}
                  onDelete={removeArtifact}
                  onNote={() => switchView('notes')}
                  onRead={() => switchView('read')}
                  onPrepare={() => switchView('prepare')}
                  onSources={() => setInspectorPanel('sources')}
                  canPrepare={Boolean(topic)}
                />
              )}
            </Inspector>
          )}
        </div>
      </div>

      <Sheet open={isMobile && navSheetOpen} onOpenChange={setNavSheetOpen} title="小白同学" side="left" width={320} className={t.navSheet}>
        <TerminalSidebar {...sidebarProps} mobile onDismiss={() => setNavSheetOpen(false)} />
      </Sheet>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        topics={openTopics}
        topic={topic}
        conversations={workspace.conversations}
        onOpenTopic={openTopic}
        onSelectChat={selectChat}
        onView={(next) => switchView(next)}
        onNewChat={newChat}
        onAttach={() => setPicker('files')}
        onTeach={() => { if (topic && !libraryBlocked) navigate(`/teach/${encodeURIComponent(topic.topicId)}`); }}
        onSettings={shellActions.openSettings}
        onNavigate={(to) => navigate(to)}
        owner={owner}
        workspace={workspaceKeyId}
        allConversations={allConversations}
        onOpenConversation={openConversation}
        onOpenArtifact={openArtifactItem}
      />

      <AttachPicker
        open={picker !== null}
        onOpenChange={(open) => { if (!open) setPicker(null); }}
        owner={owner}
        initialTab={picker ?? 'files'}
        selected={{ fileIds: conversation.libraryFileIds ?? [], artifactKeys: attachedArtifactKeys }}
        title="带进这段对话"
        description="资料库里的文件，和你做出来的笔记、导图、题目、AI 课、助理成果，都可以作为小砚回答的依据。"
        confirmLabel="用于当前对话"
        onConfirm={confirmAttach}
        onManage={() => { setPicker(null); switchView('library'); }}
      />

      {companionVisible && (
        <StudyCompanion
          identity={identity}
          onChange={onIdentity}
          topic={topic}
          busy={busy}
          reading={view === 'read'}
          withComposer={showComposer}
          level={level}
          onAsk={() => { switchView('ask'); focusComposer(); }}
          onJourney={() => switchView('journey')}
          onTeach={() => { if (topic && !libraryBlocked) navigate(`/teach/${encodeURIComponent(topic.topicId)}`); }}
        />
      )}
    </div>
    </SidebarSlotProvider>
  );
}

function ViewLoading({ label }: { label: string }) {
  return (
    <div className={t.loading} role="status">
      <Spinner size={16} />
      <span>{label}</span>
    </div>
  );
}
