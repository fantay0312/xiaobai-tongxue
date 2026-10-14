/**
 * 课堂播放器：大舞台 + 讲台圆桌（老师与两位同学）+ 课堂记录与举手提问 + 播放控制与幕导航。
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, ArrowUp, Download, FileCode2, Forward, GraduationCap, Hand, MoreHorizontal, Pause, Play,
  Presentation, RefreshCw, RotateCcw, SkipBack, SkipForward, Square, Trash2, Volume2, VolumeX,
} from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { SendTo } from '../../../../components/handoff/SendTo';
import { XiaoyanPet, type XiaoyanPetState } from '../../../../components/coach/XiaoyanPet';
import {
  Badge, Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, ThinkingDots, Tip, cx, toast,
} from '../../../../components/ui';
import { XiaobaiAvatar } from '../../../../components/xiaobai/XiaobaiAvatar';
import { logActivity } from '../../../../engine/activityLog';
import {
  AGENTS, SCENE_LABELS, askTeacher, describeModelError, estimateMinutes, lessonMarkdown, regenerateScene, sceneMarkdown, splitSentences,
  type Lesson, type SpeakerId,
} from '../../../../engine/lessonStudio';
import type { ArtifactOrigin } from '../../../../lib/artifacts';
import type { CrossAction } from '../../../../lib/crossActions';
import { recordTutorTurn, tutorMemoryHints } from '../../../../engine/tutorMemory';
import { ModelUnavailableError } from '../../../../lib/modelGateway';
import { useAppStore } from '../../../../store/appStore';
import { lessonStore } from '../../../../store/lessonStore';
import { newId } from '../../../../store/studyData';
import { useMediaQuery } from '../../shell/views';
import type { TerminalViewProps } from '../types';
import { LessonSidebar, useSidebarNavVisible, type LessonSidebarProps } from './LessonSidebar';
import { SCENE_ICONS, runExport } from './sceneMeta';
import { SceneStage } from './SceneStage';
import { RATES, speechSupported, useLessonPlayback, type AdhocLine, type TranscriptLine } from './usePlayback';
import s from './player.module.css';

/** 最近的可滚动祖先：只滚它，不用 scrollIntoView（那会把所有祖先连同外层页面一起带动） */
function scrollHost(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** 举手时说自己没听懂的说法 */
const STUCK = /没懂|不懂|听不懂|看不懂|不明白|没明白|不理解|没理解|还是不|卡住|搞不清|分不清|糊涂|太难|再讲一遍|再解释/;
/** 一幕能就地变成什么：讲解类 → 笔记、闪卡、题目、导图；测验 → 笔记、闪卡；项目 → 笔记、待办 */
const SCENE_ACTIONS: Record<string, CrossAction[]> = {
  slide: ['save-note', 'make-flashcards', 'make-quiz', 'make-mindmap'],
  whiteboard: ['save-note', 'make-flashcards', 'make-quiz', 'make-mindmap'],
  interactive: ['save-note', 'make-flashcards', 'make-quiz'],
  quiz: ['save-note', 'make-flashcards'],
  pbl: ['save-note', 'add-todos'],
};

/** 字幕与记录里的小头像 */
function Face({ speaker, size = 24 }: { speaker: SpeakerId; size?: number }) {
  return (
    <span className={s.face} data-speaker={speaker} style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden="true">
      {{ teacher: '砚', xiaobai: '白', acheng: '澄', user: '我' }[speaker]}
    </span>
  );
}

interface PlayerProps extends Pick<TerminalViewProps, 'owner' | 'topic' | 'topics' | 'selectedSources' | 'onView'> {
  lesson: Lesson;
  /** 侧栏里的课程列表与新建入口；场景列表由播放器自己补上 */
  sidebar: Omit<LessonSidebarProps, 'scenes'>;
  onExit: () => void;
  onDelete: () => void;
}

export function ClassroomPlayer({ lesson, sidebar, owner, topic, topics, selectedSources, onView, onExit, onDelete }: PlayerProps) {
  const navigate = useNavigate();
  // 侧栏看得见时，幕导航在侧栏里；看不见（手机、侧栏收起）时留在主区
  const sidebarSlot = useSidebarNavVisible();
  // 手机：舞台定高在上，字幕紧贴其下，播放控制吸在底部，幕导航是一条横向编号带
  const phone = useMediaQuery('(max-width: 760px)');
  const pb = useLessonPlayback(lesson);
  const { scene, sceneIndex, status } = pb;
  const xiaobaiLevel = useAppStore((state) => state.global.learningLevel);
  const [question, setQuestion] = useState('');
  const [handUp, setHandUp] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** 手机上「把整堂课发送到」收在右上角更多里，点了再升起面板 */
  const [sendLessonOpen, setSendLessonOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);

  // 「给小白讲这一节」只在这堂课对应的课程还在时提供
  const teachTopicId = [lesson.topicId, topic?.topicId].find((id) => id && topics.some((item) => item.topicId === id && !item.locked));
  const goTeach = teachTopicId ? () => navigate(`/teach/${teachTopicId}`) : undefined;
  const playing = status === 'playing';
  const SceneIcon = scene ? SCENE_ICONS[scene.type] : Presentation;
  /** 从这堂课交出去的内容，来源都指回这堂课 */
  const lessonOrigin = (label: string): ArtifactOrigin => ({ section: 'lesson', label, open: { view: 'classroom', params: { lesson: lesson.id } } });
  const lessonTopic = { ...(lesson.topicId ? { topicId: lesson.topicId } : {}), ...(lesson.topicTitle ? { topicTitle: lesson.topicTitle } : {}) };

  useEffect(() => {
    // 从课程库进来时页面可能已经滚到下面，回到舞台顶部
    const root = rootRef.current;
    const host = scrollHost(root);
    if (root && host) host.scrollTop += root.getBoundingClientRect().top - host.getBoundingClientRect().top;
    return () => abortRef.current?.abort();
  }, []);

  // 新的一句滚到底；当前幕的缩略卡滚进视野
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [pb.lines]);
  useEffect(() => {
    // 只横向滚动幕导航自己：scrollIntoView 会连带把整页竖向拉走
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!rail || !current) return;
    const offset = current.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
    rail.scrollTo({ left: Math.max(0, offset - (rail.clientWidth - current.offsetWidth) / 2) });
  }, [sceneIndex, phone]);

  // 空格播放 / 暂停，左右方向键换幕；在输入框和按钮上不拦截
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || !target) return;
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      if (event.key === ' ') { event.preventDefault(); pb.toggle(); }
      else if (event.key === 'ArrowRight') pb.goScene(sceneIndex + 1);
      else if (event.key === 'ArrowLeft') pb.goScene(sceneIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pb.toggle, pb.goScene, sceneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // 页面不在前台时平滑滚动不会走完，直接到位
  const smooth = (): ScrollBehavior => (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  /** 手机上提问区在舞台下方：举手时带到提问区，继续上课时回到舞台 */
  const showAsk = () => {
    const side = sideRef.current;
    const host = scrollHost(side);
    if (!side || !host) return;
    // 提问区底边停在吸底控制条上方
    const dock = rootRef.current?.querySelector<HTMLElement>('[data-dock]')?.offsetHeight ?? 0;
    const delta = side.getBoundingClientRect().bottom - (host.getBoundingClientRect().bottom - dock - 8);
    host.scrollTo({ top: host.scrollTop + delta, behavior: smooth() });
  };
  const showStage = () => {
    const root = rootRef.current;
    const host = scrollHost(root);
    if (!root || !host) return;
    host.scrollTo({ top: host.scrollTop + root.getBoundingClientRect().top - host.getBoundingClientRect().top, behavior: smooth() });
  };

  const raiseHand = () => {
    pb.pause();
    pb.stopAdhoc();
    setHandUp(true);
    if (phone) {
      // 触屏键盘只在点按当下的同步 focus 里弹出
      inputRef.current?.focus({ preventScroll: true });
      showAsk();
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const resumeClass = () => {
    abortRef.current?.abort();
    setHandUp(false);
    pb.stopAdhoc();
    pb.play();
    if (phone) showStage();
  };

  const submitQuestion = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (!text || answering || !scene) return;
    pb.pause();
    pb.stopAdhoc();
    setHandUp(true);
    setQuestion('');
    const id = newId();
    const answerLine: TranscriptLine = { key: `answer-${id}`, speaker: 'teacher', text: '', sceneIndex, kind: 'answer', markdown: true, streaming: true };
    const recent = pb.lines.slice(-8).map((line) => ({ speaker: line.speaker, text: line.text }));
    pb.pushLine({ key: `ask-${id}`, speaker: 'user', text, sceneIndex, kind: 'ask' });
    pb.pushLine(answerLine);
    setAnswering(true);
    logActivity(owner, {
      source: 'lesson', signal: STUCK.test(text) ? 'struggle' : 'interest',
      summary: `AI 课《${lesson.title}》举手提问：${text.replace(/\s+/g, ' ')}`.slice(0, 150),
      detail: `第 ${sceneIndex + 1} 幕「${scene.title}」`,
      ...(lesson.topicId ? { topicId: lesson.topicId } : {}),
      ...(lesson.topicTitle ? { topicTitle: lesson.topicTitle } : {}),
      ref: { kind: 'lesson', id: lesson.id, title: lesson.title },
    });
    if (phone) showAsk();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await askTeacher({
        lesson, scene, question: text, recent,
        hints: tutorMemoryHints(owner, lesson.topicId, 3, text),
        signal: controller.signal,
        onText: (answer) => pb.pushLine({ ...answerLine, text: answer }),
      });
      pb.pushLine({ ...answerLine, text: result.answer, streaming: false, local: result.local });
      if (!result.local) recordTutorTurn(owner, { topicId: lesson.topicId, topicTitle: lesson.title, question: text, answer: result.answer });
      // 回答已经以文字显示：朗读时不重复记录；之后同学补一句
      const followUp: AdhocLine[] = [
        ...(result.local ? [] : splitSentences(result.answer).map((sentence): AdhocLine => ({ speaker: 'teacher', text: sentence, silent: true }))),
        ...(result.remark ? [{ speaker: result.remark.speaker, text: result.remark.text, kind: 'interject' as const }] : []),
      ];
      pb.say(followUp);
    } catch (error) {
      pb.pushLine({
        ...answerLine, streaming: false, markdown: false,
        text: controller.signal.aborted ? '已停止回答。' : `这次没答上来：${describeModelError(error, '可能是网络或模型出了问题，再问一次试试。')}`,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAnswering(false);
    }
  };

  const onAskKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitQuestion();
    }
  };

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    pb.pause();
    try {
      const next = await regenerateScene(lesson, sceneIndex, { topic, sources: selectedSources });
      lessonStore.replaceScene(owner, lesson.id, sceneIndex, next);
      pb.goScene(sceneIndex);
      toast.success('这一幕已重新生成');
    } catch (error) {
      toast.error(error instanceof ModelUnavailableError ? '重新生成需要可用的模型，现在没有接通。' : `这一幕没生成出来：${describeModelError(error, '请再试一次。')}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (!scene) return null;

  const petState: XiaoyanPetState = answering ? 'thinking' : pb.speaking === 'teacher' ? 'explaining' : pb.speaking || handUp ? 'listening' : 'idle';
  const bubble = answering
    ? { speaker: 'teacher' as SpeakerId, text: '让我想想怎么讲清楚…' }
    : pb.caption ?? (handUp ? { speaker: 'user' as SpeakerId, text: '你举手了。把问题写进提问框，老师会结合这一幕回答。' } : null);
  const holdAction = status !== 'hold' ? null : scene.type === 'interactive'
    ? <Button variant="solid" size="sm" icon={<Play size={14} strokeWidth={1.75} />} onClick={pb.continueHold}>继续上课</Button>
    : <Button variant="ghost" size="sm" onClick={pb.continueHold}>先跳过</Button>;
  const avatarSize = phone ? 30 : 44;
  const idleHint = status === 'idle' ? '点播放开始上课。' : status === 'paused' ? '课堂已暂停。' : status === 'hold' ? (scene.type === 'quiz' ? '老师在等你作答。' : '动手试一试，试完继续。') : status === 'ended' ? '这堂课上完了。' : '';

  const transport = (
    <div className={s.transport} data-dock={phone || undefined}>
      <div className={s.transportKeys}>
        <IconButton label="上一幕" shortcut="←" disabled={sceneIndex === 0} onClick={() => pb.goScene(sceneIndex - 1)}><SkipBack size={17} strokeWidth={1.75} /></IconButton>
        <Tip label={playing ? '暂停' : status === 'hold' ? '继续上课' : status === 'ended' ? '再上一遍' : '播放'} shortcut="空格">
          <button type="button" className={s.playBtn} aria-label={playing ? '暂停' : '播放'} onClick={() => { if (phone && handUp) showStage(); setHandUp(false); pb.toggle(); }}>
            {playing ? <Pause size={18} strokeWidth={2} /> : <Play size={18} strokeWidth={2} />}
          </button>
        </Tip>
        <IconButton label="下一幕" shortcut="→" disabled={sceneIndex >= pb.total - 1} onClick={() => pb.goScene(sceneIndex + 1)}><SkipForward size={17} strokeWidth={1.75} /></IconButton>
      </div>
      <ol className={s.timeline} aria-label="课堂进度">
        {lesson.scenes.map((item, index) => (
          <li key={item.id}>
            <Tip label={`${index + 1}. ${item.title}`}>
              <button type="button" aria-label={`第 ${index + 1} 幕：${item.title}`} aria-current={index === sceneIndex} data-done={index < sceneIndex || undefined} onClick={() => pb.goScene(index)}>
                <i style={index === sceneIndex ? { transform: `scaleX(${Math.max(0.06, pb.sceneProgress)})` } : undefined} />
              </button>
            </Tip>
          </li>
        ))}
      </ol>
      <div className={s.transportOpts}>
        {/* 手机上语速收进右上角「更多」，底栏只留最常用的四个键 */}
        {!phone && (
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="sm" className={s.rateBtn} aria-label={`语速 ${pb.rate} 倍`}>{pb.rate}×</Button></MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>语速</MenuLabel>
              {RATES.map((value) => <MenuItem key={value} checked={pb.rate === value} onSelect={() => pb.setRate(value)}>{value}×</MenuItem>)}
            </MenuContent>
          </Menu>
        )}
        <IconButton
          label={!speechSupported() ? '这个浏览器不支持朗读，按字数自动翻句' : pb.voice ? '朗读已开（浏览器自带语音）' : '朗读已关，按字数自动翻句'}
          active={pb.voice}
          disabled={!speechSupported()}
          onClick={() => pb.setVoice(!pb.voice)}
        >
          {pb.voice ? <Volume2 size={17} strokeWidth={1.75} /> : <VolumeX size={17} strokeWidth={1.75} />}
        </IconButton>
        <Button variant={handUp ? 'accent' : 'soft'} icon={<Hand size={15} strokeWidth={1.75} />} onClick={raiseHand}>举手提问</Button>
      </div>
    </div>
  );

  return (
    <div className={s.root} ref={rootRef} data-phone={phone || undefined}>
      <LessonSidebar {...sidebar} scenes={{ lesson, sceneIndex, busyIndex: regenerating ? sceneIndex : null, onJump: pb.goScene }} />
      <header className={s.header}>
        <IconButton label={sidebarSlot ? '关闭课堂，回到新建' : '返回课程库'} onClick={onExit}><ArrowLeft size={18} strokeWidth={1.75} /></IconButton>
        <div className={s.headerTitle}>
          <h1>{lesson.title}</h1>
          <p>
            {lesson.scenes.length} 幕 · 约 {estimateMinutes(lesson)} 分钟
            {lesson.topicTitle && lesson.topicTitle !== lesson.title ? ` · ${lesson.topicTitle}` : ''}
          </p>
        </div>
        {lesson.origin === 'local' && <Tip label="没有接通模型，这堂课由课程讲义、例题和题库拼成"><Badge tone="warn">本地演示</Badge></Tip>}
        <SendTo
          owner={owner}
          text={() => lessonMarkdown(lesson)}
          title={lesson.title}
          {...lessonTopic}
          teachTopicId={teachTopicId}
          routes={['agent', 'teach']}
          origin={lessonOrigin(`AI 课：${lesson.title}`)}
          label="把整堂课发送到"
          align="end"
          open={phone ? sendLessonOpen : undefined}
          onOpenChange={setSendLessonOpen}
        >
          {/* 手机顶栏位置紧，入口收进「更多」 */}
          {phone ? null : <Button variant="ghost" icon={<Forward size={15} strokeWidth={1.75} />} aria-label="把整堂课发送到"><span className={s.hideNarrow}>发送到</span></Button>}
        </SendTo>
        <Menu>
          <MenuTrigger asChild><Button variant="outline" icon={<Download size={15} strokeWidth={1.75} />}><span className={s.hideNarrow}>导出</span></Button></MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<Presentation size={16} strokeWidth={1.75} />} hint="可在 PowerPoint、WPS 里继续编辑" onSelect={() => runExport('pptx', lesson)}>导出 PPTX</MenuItem>
            <MenuItem icon={<FileCode2 size={16} strokeWidth={1.75} />} hint="单个文件，测验和互动都能用" onSelect={() => runExport('html', lesson)}>导出交互式 HTML</MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild><IconButton label="更多" tip={false}><MoreHorizontal size={18} strokeWidth={1.75} /></IconButton></MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<RefreshCw size={16} strokeWidth={1.75} />} disabled={regenerating} onSelect={() => void regenerate()}>重新生成这一幕</MenuItem>
            <MenuItem icon={<RotateCcw size={16} strokeWidth={1.75} />} onSelect={() => pb.goScene(0, true)}>从头上课</MenuItem>
            {phone && <MenuItem icon={<Forward size={16} strokeWidth={1.75} />} onSelect={() => setSendLessonOpen(true)}>把整堂课发送到…</MenuItem>}
            {phone && (
              <>
                <MenuSeparator />
                <MenuLabel>语速</MenuLabel>
                {RATES.map((value) => <MenuItem key={value} checked={pb.rate === value} onSelect={() => pb.setRate(value)}>{value}×</MenuItem>)}
              </>
            )}
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 size={16} strokeWidth={1.75} />} onSelect={onDelete}>删除这堂课</MenuItem>
          </MenuContent>
        </Menu>
      </header>

      <div className={s.layout}>
        <div className={s.main}>
          <section className={s.stage} data-type={scene.type} aria-label={`第 ${sceneIndex + 1} 幕：${scene.title}`}>
            <i className={s.stageProgress} style={{ transform: `scaleX(${pb.sceneProgress})` }} aria-hidden="true" />
            <header className={s.stageHead}>
              <span className={s.sceneChip}><SceneIcon size={14} strokeWidth={1.75} />{SCENE_LABELS[scene.type]}</span>
              <h2>{scene.title}</h2>
              {scene.origin === 'local' && lesson.origin !== 'local' && <Badge tone="warn">本地演示</Badge>}
              <span className={s.sceneCount}>{String(sceneIndex + 1).padStart(2, '0')} / {String(pb.total).padStart(2, '0')}</span>
              <SendTo
                owner={owner}
                text={() => sceneMarkdown(scene, sceneIndex)}
                title={scene.title}
                {...lessonTopic}
                actions={SCENE_ACTIONS[scene.type]}
                routes={['agent']}
                origin={lessonOrigin(`AI 课：${lesson.title} · 第 ${sceneIndex + 1} 幕`)}
                label="把这一幕发送到"
                align="end"
              >
                <IconButton size="sm" label="把这一幕发送到：笔记、闪卡、题目…"><Forward size={15} strokeWidth={1.75} /></IconButton>
              </SendTo>
            </header>
            <div className={s.stageBody} key={scene.id} data-stage-body data-loading={regenerating || undefined}>
              <SceneStage
                scene={scene}
                reveal={pb.reveal}
                owner={owner}
                topicId={lesson.topicId}
                lessonId={lesson.id}
                lessonTitle={lesson.title}
                xiaobaiLevel={xiaobaiLevel}
                say={pb.say}
                onQuizDone={pb.completeHold}
                onTeach={goTeach}
                onOpenTodos={() => onView('workbench', { tool: 'todos' })}
              />
            </div>
            {!phone && status === 'hold' && scene.type === 'interactive' && (
              <div className={s.stageNote}>
                <span>动手试一试，试完再继续。</span>
                <Button variant="solid" size="sm" icon={<Play size={14} strokeWidth={1.75} />} onClick={pb.continueHold}>继续上课</Button>
              </div>
            )}
            {!phone && status === 'hold' && scene.type === 'quiz' && (
              <div className={s.stageNote}>
                <span>老师在等你作答，也可以让小白先来。</span>
                <Button variant="ghost" size="sm" onClick={pb.continueHold}>先跳过</Button>
              </div>
            )}
            {status === 'ended' && (
              <div className={s.stageNote} data-tone="end">
                <span>{goTeach ? '这堂课上完了。听懂不算数，把它讲给小白听才算。' : '这堂课上完了。'}</span>
                <Button variant="ghost" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => pb.goScene(0, true)}>再上一遍</Button>
                {goTeach && <Button variant="solid" size="sm" icon={<GraduationCap size={15} strokeWidth={1.75} />} onClick={goTeach}>给小白讲这一节</Button>}
              </div>
            )}
          </section>

          {/* 讲台圆桌：老师、当前这句话、两位同学和我 */}
          <section className={s.table} aria-label="课堂成员">
            <div className={s.teacher} data-speaking={pb.speaking === 'teacher' || undefined}>
              <XiaoyanPet state={petState} suppressReply title="小砚 · 主讲。点一下举手提问" aria-label="小砚，主讲老师。点一下举手提问" className={s.pet} style={{ width: 'var(--pet-w)' }} onClick={raiseHand} />
              <span className={s.mateName}>小砚<small>主讲</small></span>
            </div>
            <div className={s.bubble} data-speaker={bubble?.speaker ?? 'none'} aria-live="polite">
              {bubble ? (
                <>
                  <span className={s.bubbleWho}><Face speaker={bubble.speaker} size={20} />{AGENTS[bubble.speaker].name}</span>
                  <p>{bubble.text}</p>
                </>
              ) : (
                <div className={s.bubbleHold}>
                  <p className={s.bubbleIdle}>{idleHint}</p>
                  {phone && holdAction}
                </div>
              )}
            </div>
            <ul className={s.mates}>
              <li data-speaking={pb.speaking === 'xiaobai' || undefined}>
                <span className={s.mateAvatar}><XiaobaiAvatar mood={pb.speaking === 'xiaobai' ? 'curious' : 'idle'} level={xiaobaiLevel} speaking={pb.speaking === 'xiaobai'} size={avatarSize} /></span>
                <span className={s.mateName}>小白<small>爱问为什么</small></span>
              </li>
              <li data-speaking={pb.speaking === 'acheng' || undefined}>
                <span className={s.mateAvatar}><Face speaker="acheng" size={avatarSize} /></span>
                <span className={s.mateName}>阿澄<small>抢答快</small></span>
              </li>
              <li data-speaking={handUp || undefined}>
                <span className={s.mateAvatar}><Face speaker="user" size={avatarSize} />{handUp && <i className={s.handBadge}><Hand size={11} strokeWidth={2} /></i>}</span>
                <span className={s.mateName}>我<small>{handUp ? '举手中' : '在听'}</small></span>
              </li>
            </ul>
          </section>

          {!phone && transport}

          {!sidebarSlot && (
          <nav className={s.rail} ref={railRef} aria-label="幕导航">
            {lesson.scenes.map((item, index) => {
              const Icon = SCENE_ICONS[item.type];
              return (
                <button key={item.id} type="button" className={s.thumb} aria-current={index === sceneIndex} data-done={index < sceneIndex || undefined} onClick={() => pb.goScene(index)}>
                  <span className={s.thumbTop}><Icon size={14} strokeWidth={1.75} />{SCENE_LABELS[item.type]}<b>{index + 1}</b></span>
                  <span className={s.thumbTitle}>{item.title}</span>
                </button>
              );
            })}
          </nav>
          )}
        </div>

        <aside className={s.side} ref={sideRef} aria-label="课堂记录与提问">
          <div className={s.sideInner}>
            <header className={s.sideHead}>
              <h3>课堂记录</h3>
              <span>{pb.voice ? '浏览器朗读 · 字幕同步' : '字幕模式'}</span>
            </header>
            <div className={s.log} ref={logRef} role="log" aria-label="课堂字幕与讨论">
              {pb.lines.length === 0 && <p className={s.logEmpty}>点播放开始上课。老师的讲解、同学的插话和你的提问都会记在这里。</p>}
              {pb.lines.map((line, index) => {
                const previous = pb.lines[index - 1];
                const grouped = previous && previous.speaker === line.speaker && previous.sceneIndex === line.sceneIndex && line.kind !== 'ask' && line.kind !== 'answer' && previous.kind !== 'answer';
                const newScene = !previous || previous.sceneIndex !== line.sceneIndex;
                return (
                  <div key={line.key} className={s.logItem}>
                    {newScene && <div className={s.logScene}><span>{line.sceneIndex + 1}. {lesson.scenes[line.sceneIndex]?.title}</span></div>}
                    <div className={cx(s.line, grouped && s.lineGrouped)} data-speaker={line.speaker} data-kind={line.kind}>
                      {!grouped && <span className={s.lineWho}><Face speaker={line.speaker} size={20} />{AGENTS[line.speaker].name}{line.kind === 'answer' && line.local && <Badge tone="warn">本地演示</Badge>}</span>}
                      <div className={s.lineText}>
                        {line.streaming && !line.text ? <ThinkingDots label="小砚正在想" /> : line.markdown ? <CoachMarkdown text={line.text} compact /> : line.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {handUp && !answering && (
              <div className={s.resume}>
                <span>课堂已暂停</span>
                <Button variant="solid" size="sm" icon={<Play size={14} strokeWidth={1.75} />} onClick={resumeClass}>继续上课</Button>
              </div>
            )}
            <form className={s.ask} onSubmit={submitQuestion}>
              <textarea
                ref={inputRef}
                rows={1}
                value={question}
                placeholder="举手提问：哪里没听懂？"
                aria-label="向老师提问"
                maxLength={400}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={onAskKey}
              />
              {answering
                ? <IconButton label="停止回答" variant="soft" round onClick={() => abortRef.current?.abort()}><Square size={14} strokeWidth={2} /></IconButton>
                : <IconButton label="发送问题" variant="solid" round type="submit" disabled={!question.trim()}><ArrowUp size={17} strokeWidth={2} /></IconButton>}
            </form>
          </div>
        </aside>
      </div>

      {phone && transport}
    </div>
  );
}
