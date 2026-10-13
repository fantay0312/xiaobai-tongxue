import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAllTopics } from '../../hooks/useAllTopics';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { hydrateTeacherRuntimeTopic, topicCourseKey } from '../../data/runtimeTopics';
import { isCurrentAccount } from '../../lib/api';
import { saveBlob } from '../../lib/notebookMedia';
import { LibraryPicker } from '../library/LibraryPicker';
import { prepareLibrarySources, readLibrarySources, downloadLibraryFile } from '../../lib/fileLibrary';
import { getTeacherCustomTopic, listStudyMaterials } from '../../lib/customContent';
import { Icon, type IconName } from '../../components/ui/Icon';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { RequireAuth } from '../../components/shell/RequireAuth';
import { loadLearningIdentity, saveLearningIdentity, type LearningIdentity } from '../../engine/learningIdentity';
import { askStudyTutor, downloadStudyFile, loadWorkspace, prepareStudySources, saveWorkspace, studyId, type StudyMode, type StudySource, type StudyWorkspace } from '../../engine/studyWorkspace';
import type { Topic } from '../../types';
import { CardsPanel, PracticePanel, ReadingPanel } from './StudyPanels';
import { StudyWelcome, StudyJourney } from './StudyWelcome';
import { StudyCompanion } from './StudyCompanion';
import { Seal } from '../../components/shell/Seal';
import { useShellActions } from '../../components/shell/ShellActions';
import { StudyComposer } from './StudyComposer';
import { GuidedStudyPanel } from './GuidedStudyPanel';
import { restoreGuidedProgress, sceneQuestionContext, studyScenes } from '../../engine/guidedStudy';
import { askDeepStudyTutor, getStudyTutorStatus } from '../../lib/studyTutor';
import { courseSources, notebookScopeKey, selectNotebookSources, sourceEvidence, sourceScopedTopic, type NotebookSource } from '../../engine/notebookSources';
import { createStudyArtifact, enrichStudyArtifact, type StudioKind, type StudyArtifact } from '../../engine/studyStudio';
import { SourcesPanel, StudioPanel } from './NotebookPanels';
import { ArtifactPanel } from './ArtifactPanel';
import { IntelligentAnswer, LearningSources } from './IntelligentAnswer';
import { LearningActivity } from './LearningActivity';
import { learningAnswerAvailable, streamLearningAnswer, type LearningRun } from '../../lib/learningAnswer';
import type { LearningInteraction } from '../../../../server/shared/learning-ui.mjs';
import s from './learn.module.css';
import n from './notebook.module.css';
import t from './terminal.module.css';

const PrepPage = lazy(() => import('../prep'));
const LibraryPage = lazy(() => import('../library/LibraryPage'));
type View = 'ask' | 'guided' | 'read' | 'practice' | 'cards' | 'prepare' | 'library' | 'journey' | 'studio' | 'source' | 'notes';
const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'ask', label: '问小砚', icon: 'sparkles' },
  { id: 'guided', label: '带我学', icon: 'route' },
  { id: 'read', label: '读讲义', icon: 'book-open' },
  { id: 'practice', label: '练一练', icon: 'clipboard' },
  { id: 'cards', label: '闪卡复习', icon: 'library' },
  { id: 'prepare', label: '备课流程', icon: 'route' },
];

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

export default function LearningPage() {
  const { topicId = '' } = useParams();
  const owner = useAuthStore((state) => state.user);
  return <LearningSession key={owner ?? 'local'} topicId={topicId} owner={owner} />;
}

function LearningSession({ topicId, owner }: { topicId: string; owner: string | null }) {
  const [identity, setIdentity] = useState(() => loadLearningIdentity(owner));
  const identityRef = useRef(identity);
  const updateIdentity = (patch: Partial<LearningIdentity>) => {
    const next = { ...identityRef.current, ...patch };
    identityRef.current = next;
    saveLearningIdentity(owner, next);
    setIdentity(next);
  };
  return <TopicWorkspace key={topicId} topicId={topicId} owner={owner} identity={identity} onIdentity={updateIdentity} />;
}

function TopicWorkspace({ topicId, owner, identity, onIdentity }: { topicId: string; owner: string | null; identity: LearningIdentity; onIdentity: (patch: Partial<LearningIdentity>) => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const view: View = ['guided', 'read', 'practice', 'cards', 'prepare', 'library', 'journey', 'studio', 'source', 'notes'].includes(requestedView ?? '') ? requestedView as View : 'ask';
  const { topic, loading, error, retry } = useStudyTopic(topicId, owner);
  const topics = useAllTopics();
  const settings = useAppStore((state) => state.settings);
  const level = useAppStore((state) => state.global.learningLevel);
  const [workspace, setWorkspace] = useState<StudyWorkspace>(() => loadWorkspace(owner, topicId || 'library-chat'));
  const [saveFailed, setSaveFailed] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [inspectorPanel, setInspectorPanel] = useState<'sources' | 'tools' | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'sources' | 'main' | 'studio'>('main');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [librarySources, setLibrarySources] = useState<NotebookSource[]>([]);
  const materialsRequest = useRef<AbortController | null>(null);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [materialsRetry, setMaterialsRetry] = useState(0);
  const [remoteSources, setRemoteSources] = useState<NotebookSource[]>([]);
  const shellActions = useShellActions();
  const authStatus = useAuthStore((state) => state.status);
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<StudyMode>('ask');
  const [deepAvailable, setDeepAvailable] = useState(false);
  const [intelligentAvailable, setIntelligentAvailable] = useState(false);
  const activeStream = useRef<{chatId:string;messageId:string;startedAt:number} | null>(null);
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
  const endRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const conversation = workspace.conversations.find((chat) => chat.id === workspace.activeId) ?? workspace.conversations[0];
  const attachmentKey = (conversation.libraryFileIds ?? []).join(',');
  const studyTopic: Topic = topic ?? { topicId: 'library', title: '资料对话', course: '资料库', tagline: '', transferHint: '', checklist: [], misconceptions: [], quizBank: [], prep: { microLecture: { title: '所选文件', body: '' }, examples: [], selfCheck: [], taskCard: '' } };
  const sources = useMemo(() => [...(topic ? courseSources(topic) : []), ...remoteSources, ...(workspace.textSources ?? []), ...librarySources.filter((source) => (conversation.libraryFileIds ?? []).includes(source.libraryFileId ?? ''))], [topic, remoteSources, workspace.textSources, librarySources, conversation.libraryFileIds]);
  const selectedSources = useMemo(() => selectNotebookSources(sources, conversation.selectedSourceIds ?? workspace.selectedSourceIds), [sources, conversation.selectedSourceIds, workspace.selectedSourceIds]);
  const scopeKey = notebookScopeKey(selectedSources);
  const scopedTopic = sourceScopedTopic(studyTopic, selectedSources);
  const includesLecture = selectedSources.some((source) => source.id === `lecture:${topicId}`);
  const scenes = scopedTopic ? studyScenes(scopedTopic, includesLecture) : [];
  const guided = restoreGuidedProgress(scenes, workspace.guided);
  const artifacts = (workspace.artifacts ?? []).filter((item) => !item.conversationId || item.conversationId === conversation.id);
  const artifact = artifacts.find((item) => item.id === params.get('artifact'));
  const customCards = includesLecture ? undefined : sourceEvidence(selectedSources).map((source) => ({ id: `${scopeKey}:${source.id}`, front: `请用自己的话解释：${source.title}`, back: source.excerpt }));
  useEffect(() => {
    const controller = new AbortController(); materialsRequest.current = controller;
    setLibrarySources([]); setMaterialsError('');
    if (!attachmentKey) { setMaterialsBusy(false); return () => controller.abort(); }
    setMaterialsBusy(true);
    void prepareLibrarySources(attachmentKey.split(','), controller.signal, (message) => { if (!controller.signal.aborted) setPhase(message); }, materialsRetry > 0).then((result) => {
      if (!controller.signal.aborted && isCurrentAccount(owner, useAuthStore.getState())) setLibrarySources(result.sources);
    }).catch((error) => { if (!controller.signal.aborted) setMaterialsError(error.message || '资料读取失败，请重试。'); }).finally(() => { if (!controller.signal.aborted) { setMaterialsBusy(false); setPhase(''); } });
    return () => controller.abort();
  }, [attachmentKey, conversation.id, owner, materialsRetry]);
  useEffect(() => {
    if (!topicId.startsWith('custom-') || !owner || view === 'library') return;
    const controller = new AbortController();
    void listStudyMaterials(topicId, controller.signal).then((items) => { if (!controller.signal.aborted) setRemoteSources(items.filter((item) => item.content.trim())); }).catch(() => { if (!controller.signal.aborted) setNotice('原文件摘录暂不可用，可以继续选择已发布讲义，稍后刷新重试。'); });
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
  useDocTitle(view === 'library' ? '学习终端 · 资料库' : view === 'journey' ? '学习终端 · 师徒旅程' : topic ? `学习终端 · ${view === 'studio' ? artifact?.title ?? '学习产物' : view === 'notes' ? '学习便笺' : view === 'source' ? '资料原文' : VIEWS.find((item) => item.id === view)?.label ?? '问小砚'} · ${topic.title}` : '学习终端');
  useEffect(() => {
    if (topic && topicId && identity.lastTopicId !== topicId) onIdentity({ lastTopicId: topicId });
  }, [topic, topicId, identity.lastTopicId, onIdentity]);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Commit before returning from an input event, including an immediate reload.
  const updateWorkspace = (update: (current: StudyWorkspace) => StudyWorkspace) => {
    const next = update(workspaceRef.current);
    workspaceRef.current = next;
    setWorkspace(next);
    setSaveFailed(!saveWorkspace(owner, topicId || 'library-chat', next));
  };
  useEffect(() => {
    const flush = () => { saveWorkspace(owner, topicId || 'library-chat', workspaceRef.current); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      requestSerial.current += 1;
      requestRef.current?.abort();
      flush();
    };
  }, [owner, topicId]);
  const latestMessageText = conversation.messages.at(-1)?.text;
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, [conversation.messages.length, latestMessageText, busy]);
  useEffect(() => { setSourcePreview(null); }, [workspace.activeId]);

  const groups = useMemo(() => {
    const result = new Map<string, { title: string; items: Topic[] }>();
    topics.filter((item) => !item.locked && `${item.course} ${item.title}`.toLowerCase().includes(query.toLowerCase())).forEach((item) => {
      const key = topicCourseKey(item);
      if (!result.has(key)) result.set(key, { title: item.course, items: [] });
      result.get(key)!.items.push(item);
    });
    return [...result.entries()];
  }, [topics, query]);

  const switchView = (next: View) => {
    if (libraryBlocked && next !== 'library') { setNotice('资料中有未保存的校订或正在提交的任务，请先完成后再切换。'); return; }
    setParams(next === 'ask' ? {} : { view: next });
    setMobilePanel('main');
    if (next === 'library' || next === 'prepare') setInspectorPanel(null);
    setNotice('');
  };
  const openTopic = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存校订或等待当前提交完成，再打开另一门课。'); return; }
    navigate(`/prep/${encodeURIComponent(id)}`); setMobilePanel('main');
  };
  const chooseCourse = (id?: string) => {
    if (id) { openTopic(id); return; }
    setSourcesOpen(true); setMobilePanel('sources');
    window.requestAnimationFrame(() => document.getElementById('learning-course-search')?.focus());
  };
  const newChat = () => {
    if (busy) stop();
    const id = studyId();
    updateWorkspace((current) => ({ ...current, conversations: [...current.conversations.slice(-23), { id, title: '新的学习对话', messages: [], libraryFileIds: [], selectedSourceIds: sources.filter((source) => source.kind !== 'library').map((source) => source.id) }], activeId: id }));
    setInput(''); switchView('ask'); composerRef.current?.focus();
  };
  const askAbout = (text: string) => { setInput(text); switchView('ask'); window.requestAnimationFrame(() => composerRef.current?.focus()); };
  const saveNote = (text: string, sources: StudySource[] = []) => {
    const attribution = sources.length ? `\n\n资料来源：\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n> ${source.excerpt.replace(/\n/g, '\n> ')}`).join('\n\n')}` : '';
    updateWorkspace((current) => ({ ...current, note: `${current.note}${current.note ? '\n\n' : ''}${text}${attribution}`.slice(0, 20000) }));
    switchView('notes'); setNotice('已收进学习便笺。');
  };
  const updateInteraction = (messageId:string,id:string,state:LearningInteraction[string]) => updateWorkspace((current)=>({
    ...current,conversations:current.conversations.map((chat)=>chat.id===conversation.id?{
      ...chat,messages:chat.messages.map((message)=>message.id===messageId?{...message,interaction:{...message.interaction,[id]:state}}:message),
    }:chat),
  }));
  const stop = () => {
    if (materialsBusy) { materialsRequest.current?.abort(); setMaterialsBusy(false); setMaterialsError('已停止读取资料，可重新连接。'); }
    requestSerial.current += 1; requestRef.current?.abort();
    const stream = activeStream.current;
    if (stream) updateWorkspace((current) => ({...current,conversations:current.conversations.map((chat)=>chat.id===stream.chatId?{...chat,messages:chat.messages.map((message)=>message.id===stream.messageId&&message.run?{...message,run:{...message.run,status:'stopped',elapsedMs:Date.now()-stream.startedAt,steps:message.run.steps.map((step)=>step.status==='running'?{...step,status:'stopped'}:step)}}:message)}:chat)}));
    activeStream.current=null;setBusy(false); setPhase(''); setNotice('已停止处理，已有内容已保留。');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || materialsBusy || !input.trim()) return;
    if (materialsError) { setNotice('所选文件尚未准备好，请先重新连接资料。'); return; }
    if (!selectedSources.length) { setNotice('请先勾选至少一份学习资料。'); return; }
    if (mode === 'deep' && !deepAvailable) { setNotice('深入答疑暂不可用，请选择直接答疑或引导思考。'); return; }
    const activeScene = view === 'guided' ? scenes.find((scene) => scene.id === guided.activeId) : undefined;
    if (activeScene) updateWorkspace((current) => ({ ...current, guided: { ...guided, returnId: activeScene.id } }));
    if (view !== 'ask') switchView('ask');
    const question = `${input.trim()}${activeScene ? `\n\n${sceneQuestionContext(activeScene)}` : ''}`.slice(0, 3000);
    const chatId = conversation.id;
    const serial = ++requestSerial.current;
    const controller = new AbortController(); requestRef.current = controller;
    const currentRequest = () => serial === requestSerial.current && !controller.signal.aborted && isCurrentAccount(owner, useAuthStore.getState());
    const history = conversation.messages.filter((message) => message.scopeKey === scopeKey);
    updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => chat.id === chatId ? { ...chat, title: chat.messages.length ? chat.title : question.slice(0, 28), messages: [...chat.messages, { id: studyId(), role: 'user', text: question, sources: [], scopeKey }] } : chat) }));
    setInput(''); setNotice(''); setBusy(true); pinnedRef.current = true;
    let evidence = prepareStudySources(sourceEvidence(selectedSources, question));
    try {
      if (intelligentAvailable && settings.mode==='proxy' && mode!=='deep') {
        const messageId=studyId(),startedAt=Date.now();
        activeStream.current={chatId,messageId,startedAt};
        const run:LearningRun={status:'running',startedAt,elapsedMs:0,steps:[]};
        updateWorkspace((current)=>({...current,conversations:current.conversations.map((chat)=>chat.id===chatId?{...chat,messages:[...chat.messages,{id:messageId,role:'assistant',text:'',sources:[],scopeKey,run}]}:chat)}));
        await streamLearningAnswer({question,topicId:topicId||'library',sources:selectedSources,history,mode,format:workspace.answerFormat??'auto',signal:controller.signal,onEvent:(event)=>{
          if(!currentRequest())return;
          updateWorkspace((current)=>({...current,conversations:current.conversations.map((chat)=>chat.id===chatId?{...chat,messages:chat.messages.map((message)=>{
            if(message.id!==messageId)return message;
            if(event.type==='stage'){
              const step={id:event.id,label:event.label,status:event.status,at:Date.now()};
              const steps=message.run?.steps??[];
              return {...message,run:{...run,steps:steps.some((item)=>item.id===event.id)?steps.map((item)=>item.id===event.id?step:item):[...steps,step],elapsedMs:Date.now()-startedAt}};
            }
            if(event.type==='sources')return {...message,sources:prepareStudySources(event.sources,900,8)};
            if(event.type==='text')return {...message,text:event.text};
            return {...message,text:event.text,ui:event.ui,interaction:{},sources:prepareStudySources(event.sources,900,8),run:{...message.run!,status:'complete',elapsedMs:Date.now()-startedAt}};
          })}:chat)}));
        }});
        activeStream.current=null;
        return;
      }
      const fileIds = selectedSources.filter((source) => source.libraryFileId).map((source) => source.libraryFileId!);
      if (fileIds.length) {
        const verified = await readLibrarySources(fileIds, question, controller.signal);
        evidence = prepareStudySources([...verified.evidence, ...sourceEvidence(selectedSources.filter((source) => !source.libraryFileId), question)]);
      }
      if (!currentRequest()) return;
      if (mode === 'deep') {
        setPhase('小砚正在通过 DeepTutor 核对资料并组织解释…');
        const reply = await askDeepStudyTutor({ topic: studyTopic, question, note: '', history, signal: controller.signal, selectedSources });
        if (!currentRequest()) return;
        updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => chat.id === chatId ? { ...chat, messages: [...chat.messages, { id: studyId(), role: 'assistant', text: reply.content, sources: prepareStudySources(reply.sources), engine: 'deeptutor', rounds: reply.rounds, scopeKey }] } : chat) }));
        if (reply.sourceNote) setNotice(reply.sourceNote);
        return;
      }
      setPhase('小砚正在整理解释…');
      const local = settings.mode === 'mock';
      const reply = local ? `当前为本地演示，以下是所选资料的摘录，供你对照阅读。\n\n${evidence.map((source, i) => `${source.excerpt} [${i + 1}]`).join('\n\n')}` : await askStudyTutor({ topic: studyTopic, mode, note: '', sources: evidence, history, question, settings, signal: controller.signal, selectedOnly: true });
      if (!currentRequest()) return;
      updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => chat.id === chatId ? { ...chat, messages: [...chat.messages, { id: studyId(), role: 'assistant', text: reply, sources: evidence, local, scopeKey }] } : chat) }));
    } catch {
      if (currentRequest()) {
        const stream=activeStream.current;
        if(stream)updateWorkspace((current)=>({...current,conversations:current.conversations.map((chat)=>chat.id===chatId?{...chat,messages:chat.messages.map((message)=>message.id===stream.messageId&&message.run?{...message,run:{...message.run,status:'failed',elapsedMs:Date.now()-stream.startedAt,steps:message.run.steps.map((step)=>step.status==='running'?{...step,status:'error'}:step)}}:message)}:chat)}));
        activeStream.current=null;setInput(question); setNotice('本次回答未完成，问题已放回输入框。请重试；已经显示的内容已保留。');
      }
    } finally { if (currentRequest()) { setBusy(false); setPhase(''); } }
  };

  const openSource = (source: StudySource) => { const fileId = source.fileId ?? (source.id.startsWith('library:') ? source.id.split(':')[1] : undefined); setSourcePreview({ ...source, fileId }); switchView('source'); };
  const selectSources = (ids: string[]) => {
    if (busy) stop();
    updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => chat.id === conversation.id ? { ...chat, selectedSourceIds: ids } : chat), readSections: [] }));
  };
  const attachFiles = (ids: string[]) => {
    if (busy) stop();
    const unique = [...new Set(ids)].slice(0,12);
    updateWorkspace((current) => ({ ...current, conversations: current.conversations.map((chat) => chat.id === conversation.id ? { ...chat, libraryFileIds: unique, selectedSourceIds: [...selectedSources.filter((source) => !source.libraryFileId).map((source) => source.id), ...unique.map((id) => `library:${id}`)] } : chat) }));
    setPickerOpen(false); switchView('ask');
  };
  const addFiles = (ids: string[]) => {
    const merged = [...new Set([...(conversation.libraryFileIds ?? []), ...ids])];
    if (merged.length > 12) { setNotice('当前对话最多使用 12 份文件，请先移除不需要的文件。'); return; }
    attachFiles(merged);
  };
  const openArtifact = (id: string) => {
    if (libraryBlocked) { setNotice('请先保存资料校订。'); return; }
    setParams({ view: 'studio', artifact: id }); setMobilePanel('main'); setNotice('');
  };
  const verifiedSelection = async (signal: AbortSignal) => {
    const fileIds = selectedSources.filter((source) => source.libraryFileId).map((source) => source.libraryFileId!);
    if (!fileIds.length) return selectedSources;
    const verified = await readLibrarySources(fileIds, '', signal);
    return [...selectedSources.filter((source) => !source.libraryFileId), ...verified.sources];
  };
  const createItem = async (kind: StudioKind | 'guided' | 'read' | 'practice' | 'cards') => {
    if (materialsBusy || materialsError || !selectedSources.length) { setNotice('请先选择并准备好学习资料。'); return; }
    if (['guided', 'read', 'practice', 'cards'].includes(kind)) { switchView(kind as View); return; }
    if (libraryBlocked || busy) return;
    const controller = new AbortController(); requestRef.current = controller;
    const serial = ++requestSerial.current;
    setBusy(true); setPhase('正在核对资料来源…');
    try {
      const verified = await verifiedSelection(controller.signal);
      if (serial !== requestSerial.current || controller.signal.aborted || !isCurrentAccount(owner, useAuthStore.getState())) return;
      const existing = artifacts.find((item) => item.kind === kind && item.scopeKey === notebookScopeKey(verified));
      if (existing) { openArtifact(existing.id); return; }
      const created = { ...createStudyArtifact(kind as StudioKind, studyTopic.title, verified), conversationId: conversation.id };
      updateWorkspace((current) => ({ ...current, artifacts: [...(current.artifacts ?? []).slice(-23), created] }));
      openArtifact(created.id);
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '无法读取所选资料。'); }
    finally { if (serial === requestSerial.current) { setBusy(false); setPhase(''); } }
  };
  const updateArtifact = (updated: StudyArtifact) => updateWorkspace((current) => ({ ...current, artifacts: (current.artifacts ?? []).map((item) => item.id === updated.id ? updated : item) }));
  const removeArtifact = (id: string) => {
    const removed = artifacts.find((item) => item.id === id); if (!removed) return;
    updateWorkspace((current) => ({ ...current, artifacts: (current.artifacts ?? []).filter((item) => item.id !== id) }));
    if (artifact?.id === id) switchView('ask');
    undoRef.current = () => updateWorkspace((current) => ({ ...current, artifacts: [...(current.artifacts ?? []).filter((item) => item.id !== id), removed] }));
    setNotice('产物已从当前学习工坊移除。'); setUndoLabel('撤销移除');
  };
  const removeSource = (id: string) => {
    const removed = workspace.textSources?.find((item) => item.id === id); if (!removed) return;
    if (busy) stop();
    updateWorkspace((current) => ({ ...current, textSources: (current.textSources ?? []).filter((item) => item.id !== id), selectedSourceIds: selectedSources.filter((item) => item.id !== id).map((item) => item.id) }));
    undoRef.current = () => updateWorkspace((current) => ({ ...current, textSources: [...(current.textSources ?? []).filter((item) => item.id !== id), removed], selectedSourceIds: [...(current.selectedSourceIds ?? sources.map((source) => source.id)), id] }));
    setNotice('补充文本已从本课移除。'); setUndoLabel('撤销移除');
  };
  const enhanceArtifact = async () => {
    if (!artifact || busy) return;
    const serial = ++requestSerial.current; const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setPhase('小砚正在根据所选资料整理内容…'); setNotice('');
    try {
      const verified = await verifiedSelection(controller.signal);
      const updated = await enrichStudyArtifact(artifact, verified, settings, controller.signal);
      if (serial === requestSerial.current && isCurrentAccount(owner, useAuthStore.getState()) && !controller.signal.aborted) updateArtifact(updated);
    } catch (error) {
      if (serial === requestSerial.current && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : '整理未完成，原稿已保留。');
    } finally { if (serial === requestSerial.current) { setBusy(false); setPhase(''); } }
  };
  const workspaceTitle = view === 'library' ? '资料库' : view === 'studio' ? artifact?.title ?? '学习产物' : view === 'notes' ? '学习便笺' : view === 'source' ? sourcePreview?.title ?? '资料原文' : VIEWS.find((item) => item.id === view)?.label ?? '与资料对话';
  const showComposer = Boolean(owner || topic) && !['library', 'prepare', 'journey', 'notes'].includes(view);
  const toggleInspector = (panel: 'sources' | 'tools') => {
    const next = inspectorPanel === panel ? null : panel;
    setInspectorPanel(next); setMobilePanel(next ? 'studio' : 'main');
  };
  return <div className={t.terminal} data-library={view === 'library' || undefined} data-navigation-hidden={!sourcesOpen || undefined} data-mobile-panel={mobilePanel}>
    <nav className={t.appRail} aria-label="终端导航">
      <button aria-label="学习终端" title="学习终端" aria-current={view !== 'library' ? 'page' : undefined} onClick={() => switchView('ask')}><Icon name="home" size={21} /></button>
      <button aria-label="统一资料库" title="资料库" aria-current={view === 'library' ? 'page' : undefined} onClick={() => switchView('library')}><Icon name="files" size={21} /></button>
      <button aria-label="师徒旅程" title="师徒旅程" onClick={() => switchView('journey')}><Icon name="route" size={21} /></button>
      <Link aria-label="学习记录" title="学习记录" to="/growth"><Icon name="notebook" size={20} /></Link>
      <div className={t.railSpacer} />
      <button aria-label="终端设置" title="设置" onClick={shellActions.openSettings}><Icon name="settings" size={20} /></button>
      {authStatus === 'authed' ? <button aria-label="个人中心" title="个人中心" onClick={shellActions.openProfile}><Icon name="user" size={20} /></button> : <Link aria-label="登录" title="登录" to="/login"><Icon name="user" size={20} /></Link>}
    </nav>
    <aside className={t.sidebar} aria-label="课程项目与会话">
      <div className={t.sidebarBrand}><Link to="/learn" aria-label="小白同学"><Seal /><span>小白同学</span></Link><button aria-label="收起项目栏" onClick={() => { setSourcesOpen(false); setMobilePanel('main'); }}><Icon name="panel-left" size={17} /></button></div>
      <button className={t.newConversation} onClick={newChat} disabled={libraryBlocked}><Icon name="message" size={18} />新建学习对话<Icon name="plus" size={15} /></button>
      <button className={t.sidebarAction} onClick={() => toggleInspector('sources')}><Icon name="library" size={17} />本课资料<span>{sources.length}</span></button>
      <button className={t.sidebarAction} onClick={() => switchView('journey')}><Icon name="route" size={17} />师徒旅程</button>
      <div className={t.projectHeading}><span>课程项目</span><button aria-label="添加课程项目" onClick={() => switchView('library')}><Icon name="plus" size={15} /></button></div>
      <input className={t.projectSearch} id="learning-course-search" aria-label="搜索课程或知识点" placeholder="搜索项目或知识点" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className={t.sidebarScroll}>
        {groups.map(([key, group]) => <details key={key} className={t.projectGroup} open={query ? true : group.items.some((item) => item.topicId === topicId) || undefined}><summary><Icon name="book-open" size={15} /><span>{group.title}</span><small>{group.items.length}</small></summary>{group.items.map((item) => <button key={item.topicId} aria-current={item.topicId === topicId ? 'page' : undefined} disabled={libraryBlocked} onClick={() => openTopic(item.topicId)}><span>{item.title}</span>{item.topicId === topicId && <Icon name="chevron-right" size={12} />}</button>)}</details>)}
        {<div className={t.conversationHistory}><h3>{topic ? '本课对话' : '资料对话'}</h3>{[...workspace.conversations].reverse().map((chat) => <button key={chat.id} disabled={libraryBlocked} aria-current={chat.id === workspace.activeId ? 'true' : undefined} onClick={() => { if (busy) stop(); updateWorkspace((current) => ({ ...current, activeId: chat.id })); switchView('ask'); }}><Icon name="message" size={13} /><span>{chat.title}</span></button>)}</div>}
      </div>
      <footer className={t.sidebarFooter}><Link to="/growth"><Icon name="notebook" size={16} />学习记录</Link><Link to="/teacher"><Icon name="clipboard" size={16} />教师看板</Link><button onClick={shellActions.openSettings}><Icon name="settings" size={16} />设置</button>{authStatus === 'authed' ? <button onClick={shellActions.openProfile}><Icon name="user" size={16} />个人中心</button> : <Link to="/login">登录</Link>}</footer>
    </aside>
    <div className={t.workspace}>
      <header className={t.header}>
        <button className={t.revealProjects} aria-label="展开项目栏" onClick={() => { setSourcesOpen(true); setMobilePanel('sources'); }}><Icon name="panel-left" size={18} /></button>
        <div className={t.breadcrumb}><span>{view === 'library' ? '学习终端' : topic?.course ?? '学习终端'}</span>{(topic || view === 'library') && <><Icon name="chevron-right" size={13} /><strong>{view === 'library' ? '资料库' : topic?.title}</strong></>}</div>
        <div className={t.headerActions}>
          {topic && view !== 'library' && <><button aria-label="本课资料" aria-pressed={inspectorPanel === 'sources'} onClick={() => toggleInspector('sources')}><Icon name="library" size={16} /><span>资料</span><small>{selectedSources.length}</small></button><button aria-label="工具与产物" aria-pressed={inspectorPanel === 'tools'} onClick={() => toggleInspector('tools')}><Icon name="sparkles" size={16} /><span>工具与产物</span></button><Link aria-label="教小白" to={`/teach/${topicId}`}><Icon name="graduation" size={16} /><span>教小白</span></Link></>}
        </div>
      </header>
      {materialsError && <div className={t.persistWarning} role="alert"><span>{materialsError}</span><button onClick={() => setMaterialsRetry((value) => value + 1)}>重新连接资料</button></div>}
      {saveFailed && <div className={t.persistWarning} role="alert"><span>本机保存失败，当前改动仅留在页面中。请先导出备份，再处理浏览器存储空间。</span><button onClick={() => downloadStudyFile(`${topic?.title ?? '学习终端'}-备份.json`, JSON.stringify(workspace, null, 2), 'application/json')}>导出当前工作区</button></div>}
      <div className={t.contentBody} data-inspector-open={inspectorPanel !== null || undefined}>
        <section className={t.main} aria-label="学习工作区">
          <div className={t.viewTabs}><button aria-current={view === 'ask' ? 'page' : undefined} onClick={() => switchView('ask')}><Icon name="message" size={14} />对话</button>{view !== 'ask' && <button aria-current="page"><Icon name={view === 'studio' ? 'file' : 'book-open'} size={14} /><span>{workspaceTitle}</span></button>}<button className={t.openTools} onClick={() => toggleInspector('tools')}><Icon name="plus" size={14} />添加内容</button></div>
      {(notice || undoLabel) && <div className={s.notice} role="status"><Icon name="circle-help" size={15} /><span>{notice}</span>{undoLabel && <button onClick={() => { undoRef.current?.(); undoRef.current = null; setUndoLabel(''); setNotice('已恢复。'); }}>{undoLabel}</button>}<button aria-label="关闭提示" onClick={() => { setNotice(''); setUndoLabel(''); undoRef.current = null; }}><Icon name="x" size={14} /></button></div>}
      {view === 'library' ? <div className={t.libraryArea}><Suspense fallback={<p>正在打开资料库…</p>}><RequireAuth><LibraryPage onLeaveGuardChange={setLibraryBlocked} onUseInConversation={async (ids) => { addFiles(ids); }} /></RequireAuth></Suspense></div> : view === 'journey' ? <div className={n.mainScroll}><StudyJourney topic={topic} topics={topics} identity={identity} onAccept={() => onIdentity({ acceptedAt: new Date().toISOString() })} onLearn={() => topic ? switchView('guided') : chooseCourse(identity.lastTopicId ?? undefined)} /></div> : loading || error || (topicId && !topic) ? <div className={n.mainScroll}><h2>{loading ? '正在取回你的课程…' : '暂时无法打开这门课'}</h2><p>{loading ? '课程与资料正在准备。' : '课程可能尚未发布，或连接暂时中断。'}</p>{error && <button className={s.primaryButton} onClick={retry}>重新连接</button>}</div> : !topic && !attachmentKey && !conversation.messages.length && view === 'ask' ? <div className={n.mainScroll}><StudyWelcome topics={topics} identity={identity} onAccept={() => onIdentity({ acceptedAt: new Date().toISOString() })} onSelectCourse={chooseCourse} onLibrary={() => setPickerOpen(true)} onJourney={() => switchView('journey')} /></div> : view === 'ask' ? <>
        {guided.returnId && <div className={s.returnToChat}><button onClick={() => { updateWorkspace((current) => ({ ...current, guided: { ...guided, activeId: guided.returnId!, returnId: undefined } })); switchView('guided'); }}><Icon name="arrow-left" size={15} />返回刚才的学习步骤</button></div>}
        {attachmentKey && <div className={t.attachments}>{(conversation.libraryFileIds ?? []).map((id) => <span key={id}><Icon name="file" size={14} />{librarySources.find((source) => source.libraryFileId === id)?.title ?? '资料文件'}<button aria-label={`移除对话文件 ${librarySources.find((source) => source.libraryFileId === id)?.title ?? id}`} onClick={() => attachFiles((conversation.libraryFileIds ?? []).filter((fileId) => fileId !== id))}><Icon name="x" size={12} /></button></span>)}<button onClick={() => setPickerOpen(true)}>选择文件</button></div>}
        <div className={n.chatScroll} ref={feedRef} onScroll={() => { const node = feedRef.current; if (node) pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
          {conversation.messages.length ? <div className={s.messages}>{conversation.messages.map((message) => <article key={message.id} className={message.role === 'user' ? s.userMessage : s.assistantMessage} aria-label={message.role === 'user' ? '我的提问' : '小砚的回答'}>{message.role === 'assistant' && <div className={s.messageByline}><Icon name="lamp" size={18} /><strong>小砚</strong><span>{message.local ? '资料摘编' : '学习助教'}</span></div>}{message.run&&<LearningActivity run={message.run}/>}{message.ui?<IntelligentAnswer ui={message.ui} sources={message.sources} interaction={message.interaction??{}} onChange={(id,state)=>updateInteraction(message.id,id,state)} onAsk={askAbout} onSource={openSource} onSave={(text)=>saveNote(text,message.sources)}/>:<CoachMarkdown text={message.text}/>}{message.role === 'assistant' && message.run?.status!=='running' && <footer className={s.messageTools}>{message.engine === 'deeptutor' && <span>DeepTutor · {message.rounds} 轮核对</span>}<button disabled={!message.text} onClick={() => saveNote(message.text, message.sources)}><Icon name="notebook" size={14} />存入便笺</button>{message.run ? <LearningSources sources={message.sources} onSource={openSource}/> : message.sources.map((source, index) => <button key={source.id} onClick={() => openSource(source)}><Icon name="file" size={13} />[{index + 1}] {source.title}</button>)}</footer>}</article>)}</div> : <div className={n.chatWelcome}><h1>今天，想把什么学明白？</h1><p>我是小砚。打开一个课程项目，读资料、提问题，或把你的理解讲给小白听。</p><div className={n.suggestions}><button onClick={() => setInput('帮我概括所选资料的核心内容，并标注来源。')}>概括核心内容</button><button onClick={() => createItem('mindmap')}>整理思维导图</button><button onClick={() => createItem('guided')}>带我一步步学</button></div></div>}
          {(busy || materialsBusy) && !activeStream.current && <div className={s.thinking} role="status"><span /><span>{phase}</span></div>}<div ref={endRef} />
        </div>
      </> : <div className={n.mainScroll}>
        {view === 'source' && sourcePreview && <article className={n.sourceDocument}><h1>{sourcePreview.title}</h1><p>当前查看的是资料正文或本轮保存的引用片段。</p><CoachMarkdown text={sourcePreview.excerpt} />{sourcePreview.fileId && <button className={s.textButton} onClick={async () => { try { const blob = await downloadLibraryFile(sourcePreview.fileId!); if (isCurrentAccount(owner, useAuthStore.getState())) saveBlob(sourcePreview.title, blob); } catch { setNotice('原件暂不可用，请检查文件是否已移入回收站。'); } }}><Icon name="download" size={14} />下载原件</button>}<button className={s.textButton} onClick={() => askAbout(`请解释这份资料中的关键概念：${sourcePreview.title}`)}>带着这份资料提问<Icon name="arrow-right" size={14} /></button></article>}
        {view === 'notes' && <div className={n.notesEditor}><h1>学习便笺</h1><textarea aria-label="学习便笺" value={workspace.note} maxLength={20000} placeholder="记下你自己的理解，也可以从回答中保存内容…" onChange={(event) => updateWorkspace((current) => ({ ...current, note: event.target.value }))} /><p className={n.quiet}>{saveFailed ? '本机保存失败，请立即导出内容。' : '自动保存在当前浏览器，按账号和课程分开。'}</p><button disabled={!workspace.note.trim()} onClick={() => downloadStudyFile(`${studyTopic.title}-学习便笺.md`, workspace.note)}><Icon name="download" size={15} />导出便笺</button></div>}
        {view === 'studio' && (artifact ? <ArtifactPanel key={artifact.id + artifact.kind} artifact={artifact} onUpdate={updateArtifact} onEnhance={() => void enhanceArtifact()} busy={busy} saveFailed={saveFailed} onSource={openSource} /> : <p>在学习工坊创建一份内容，或打开已保存的产物。</p>)}
        {!selectedSources.length && ['read', 'practice', 'cards', 'guided'].includes(view) ? <div className={s.panelEmpty}><h2>先选择学习资料</h2><p>在资料栏勾选想学习的内容，再继续。</p></div> : scopedTopic && <>
          {view === 'read' && <ReadingPanel key={scopeKey} topic={scopedTopic} readSections={workspace.readSections} onRead={(index) => updateWorkspace((current) => ({ ...current, readSections: [...new Set([...current.readSections, index])] }))} onAsk={askAbout} />}
          {view === 'guided' && <GuidedStudyPanel key={scopeKey} topic={scopedTopic} includeSelfTests={includesLecture} saved={workspace.guided} onSave={(guided) => updateWorkspace((current) => ({ ...current, guided }))} onAsk={askAbout} />}
          {view === 'practice' && <PracticePanel key={scopeKey} topic={scopedTopic} selfChecks={customCards} answers={workspace.practiceAnswers} onAnswers={(practiceAnswers) => updateWorkspace((current) => ({ ...current, practiceAnswers }))} onAsk={askAbout} />}
          {view === 'cards' && <CardsPanel key={scopeKey} topic={scopedTopic} sourceCards={customCards} ratings={workspace.ratings} onRate={(id, value) => updateWorkspace((current) => ({ ...current, ratings: { ...current.ratings, [id]: value } }))} />}
        </>}
        {view === 'prepare' && <Suspense fallback={<p>正在打开备课流程…</p>}><PrepPage /></Suspense>}
        {busy && view === 'studio' && <div className={s.thinking} role="status"><span /><span>{phase}</span><button onClick={stop}>停止整理</button></div>}
      </div>}
      {showComposer && <div className={n.composerWrap}><StudyComposer input={input} onInput={setInput} mode={mode} onMode={setMode} busy={busy || materialsBusy} onStop={stop} onSubmit={(event) => void submit(event)} inputRef={composerRef} custom={topicId.startsWith('custom-')} demo={settings.mode === 'mock'} deepAvailable={deepAvailable} sourceCount={selectedSources.length} onAttach={() => setPickerOpen(true)} answerFormat={workspace.answerFormat??'auto'} onAnswerFormat={(answerFormat)=>updateWorkspace((current)=>({...current,answerFormat}))} intelligentAvailable={intelligentAvailable}/></div>}
        </section>
        {inspectorPanel && <aside className={t.inspector} aria-label={inspectorPanel === 'sources' ? '本课资料' : '学习工具与产物'}>
          <div className={n.panelHeading}><h2>{inspectorPanel === 'sources' ? '本课资料' : '工具与产物'}</h2><button aria-label="关闭侧面板" onClick={() => { setInspectorPanel(null); setMobilePanel('main'); }}><Icon name="x" size={17} /></button></div>
          {inspectorPanel === 'sources' ? <>
      {<SourcesPanel sources={sources} selected={selectedSources} onSelect={selectSources} onPreview={(source) => openSource({ id: source.id, title: source.title, excerpt: source.content })} onAdd={(title, content) => {
        if ((workspace.textSources?.length ?? 0) >= 16) { setNotice('每课最多保存 16 份补充文本，请先整理已有资料。'); return; }
        const source: NotebookSource = { id: `text:${studyId()}`, title, content, kind: 'text' };
        updateWorkspace((current) => ({ ...current, textSources: [...(current.textSources ?? []), source], conversations: current.conversations.map((chat) => chat.id === conversation.id ? { ...chat, selectedSourceIds: [...selectedSources.map((item) => item.id), source.id] } : chat) }));
      }} onDelete={removeSource} onPickLibrary={() => setPickerOpen(true)} onLibrary={() => switchView('library')} />}
          </> : <StudioPanel artifacts={artifacts} sourceCount={selectedSources.length} busy={busy} activeView={view === 'studio' ? artifact?.kind ?? '' : view} onCreate={createItem} onOpen={openArtifact} onDelete={removeArtifact} onNote={() => switchView('notes')} onRead={() => switchView('read')} onPrepare={() => switchView('prepare')} canPrepare={Boolean(topic)} />}
        </aside>}
      </div>
    </div>
    {pickerOpen && <LibraryPicker selected={conversation.libraryFileIds ?? []} onClose={() => setPickerOpen(false)} onConfirm={attachFiles} onManage={() => { setPickerOpen(false); switchView('library'); }} />}
    {view !== 'prepare' && mobilePanel === 'main' && <StudyCompanion identity={identity} onChange={onIdentity} topic={topic} busy={busy} reading={view === 'read'} withComposer={showComposer} level={level} onAsk={() => { if (topic) { switchView('ask'); window.requestAnimationFrame(() => composerRef.current?.focus()); } else chooseCourse(identity.lastTopicId ?? undefined); }} onJourney={() => switchView('journey')} onTeach={() => { if (topic && !libraryBlocked) navigate(`/teach/${topic.topicId}`); }} />}
  </div>;
}
