/**
 * 一键生成课程：写主题 / 选材料 / 定学习者、长度与幕类型，生成时逐幕显示进度。
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { BookOpen, Check, FileUp, Paperclip, X } from 'lucide-react';
import { Badge, Button, Progress, Segmented, Shimmer, Spinner, cx, toast } from '../../../../components/ui';
import {
  LENGTH_LABELS, LENGTH_SCENES, LEVEL_LABELS, LessonInputError, SCENE_LABELS, SCENE_TYPES, buildLocalLesson, describeModelError, generateLesson,
  type AudienceLevel, type GenerateInput, type GenerateProgress, type Lesson, type LessonLength, type SceneType,
} from '../../../../engine/lessonStudio';
import type { NotebookSource } from '../../../../engine/notebookSources';
import { loadModelCatalog } from '../../../../lib/modelGateway';
import { lessonStore } from '../../../../store/lessonStore';
import { newId } from '../../../../store/studyData';
import type { TerminalViewProps } from '../types';
import { SCENE_ICONS } from './sceneMeta';
import st from './studio.module.css';
import { IconSpark } from '../../../../components/ui/icons';

const SUGGESTIONS = ['用生活例子讲清贝叶斯定理', 'TCP 三次握手为什么是三次', '进程和线程到底差在哪', '梯度下降是怎么找到最低点的'];
const LEVEL_OPTIONS = (Object.keys(LEVEL_LABELS) as AudienceLevel[]).map((value) => ({ value, label: LEVEL_LABELS[value] }));
const LENGTH_OPTIONS = (Object.keys(LENGTH_LABELS) as LessonLength[]).map((value) => ({ value, label: LENGTH_LABELS[value] }));
const MAX_UPLOAD = 400_000;

interface ComposerProps extends Pick<TerminalViewProps, 'owner' | 'topic' | 'selectedSources'> {
  onCreated: (lesson: Lesson) => void;
  /** 生成进度（null = 没在生成），侧栏据此显示每一幕的状态 */
  onProgress?: (progress: GenerateProgress | null) => void;
  /** 手机版式：选项一行一项，分段控件拉满宽度 */
  compact?: boolean;
}

export function LessonComposer({ owner, topic, selectedSources, onCreated, onProgress, compact = false }: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [useTopic, setUseTopic] = useState(true);
  const [useSources, setUseSources] = useState(true);
  const [uploads, setUploads] = useState<NotebookSource[]>([]);
  const [level, setLevel] = useState<AudienceLevel>('intro');
  const [length, setLength] = useState<LessonLength>('standard');
  const [types, setTypes] = useState<SceneType[]>(SCENE_TYPES);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [error, setError] = useState<{ message: string; canLocal: boolean } | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadModelCatalog().then((catalog) => { if (alive) setModelReady(catalog.available); }).catch(() => { if (alive) setModelReady(false); });
    return () => { alive = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    onProgress?.(progress);
  }, [progress, onProgress]);

  const material: NotebookSource[] = [...(useSources ? selectedSources : []), ...uploads];
  const activeTopic = useTopic ? topic : undefined;
  const canSubmit = !!prompt.trim() || !!activeTopic || material.length > 0;
  const generating = progress !== null;
  const input: GenerateInput = { prompt, topic: activeTopic, sources: material, level, length, types };
  const hasLocalMaterial = !!activeTopic || material.some((source) => source.content.trim().length > 40);

  const finish = (lesson: Lesson) => {
    lessonStore.save(owner, lesson);
    setPrompt('');
    setError(null);
    onCreated(lesson);
  };

  const toggleType = (type: SceneType) => {
    setTypes((current) => {
      const next = current.includes(type) ? current.filter((item) => item !== type) : [...current, type];
      // 至少保留一种
      return next.length ? SCENE_TYPES.filter((item) => next.includes(item)) : current;
    });
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, 4);
    event.target.value = '';
    for (const file of files) {
      if (file.size > MAX_UPLOAD) {
        toast.error(`「${file.name}」太大了，请控制在 400KB 以内的文本文件。`);
        continue;
      }
      try {
        const content = (await file.text()).trim();
        if (content.length < 20 || content.includes('\u0000')) {
          toast.error(`「${file.name}」读不出文字内容，请换成 txt 或 md。`);
          continue;
        }
        setUploads((current) => [...current, { id: `text:${newId()}`, title: file.name.replace(/\.[^.]+$/, '').slice(0, 60), content: content.slice(0, 16_000), kind: 'text' as const }].slice(-4));
      } catch {
        toast.error(`「${file.name}」没读出来，请重试。`);
      }
    }
  };

  const run = async () => {
    if (!canSubmit || generating) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: 'outline', scenes: [] });
    try {
      const lesson = await generateLesson(input, { signal: controller.signal, onProgress: setProgress });
      const patched = lesson.scenes.filter((scene) => scene.origin === 'local').length;
      if (lesson.origin === 'local') toast('没有接通模型，这堂课由课程讲义、例题和题库拼成，标为「本地演示」。');
      else if (patched) toast(`有 ${patched} 幕没生成出来，先用课程内容补上了，可以在课堂里重新生成。`);
      finish(lesson);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof LessonInputError
        ? { message: cause.message, canLocal: false }
        : { message: `课程没生成出来：${describeModelError(cause)}`, canLocal: hasLocalMaterial });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
    }
  };

  /** 模型出问题时的退路：直接用课程讲义、例题和题库拼一堂本地演示课 */
  const runLocal = () => {
    try {
      finish(buildLocalLesson(input));
    } catch (cause) {
      setError({ message: cause instanceof LessonInputError ? cause.message : '本地演示也没拼出来，请换一门课试试。', canLocal: false });
    }
  };

  const done = progress?.scenes.filter((scene) => scene.status === 'done' || scene.status === 'fallback').length ?? 0;
  const planned = progress?.scenes.length || LENGTH_SCENES[length];

  return (
    <section data-compact={compact || undefined} className={st.composer} aria-label="生成课程" aria-busy={generating}>
      <textarea
        className={st.prompt}
        value={prompt}
        rows={3}
        maxLength={600}
        disabled={generating}
        placeholder={topic ? `想把「${topic.title}」上成什么样的课？留空就按这门课的内容来。` : '想学什么？写一个主题，例如：用生活例子讲清贝叶斯定理'}
        aria-label="课程主题"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void run();
        }}
      />

      <div className={st.chips}>
        {topic && (
          <button type="button" className={st.chip} aria-pressed={useTopic} disabled={generating} onClick={() => setUseTopic((value) => !value)}>
            {useTopic ? <Check size={14} strokeWidth={2} /> : <BookOpen size={14} strokeWidth={1.75} />}
            <span>课程 · {topic.title}</span>
          </button>
        )}
        {selectedSources.length > 0 && (
          <button type="button" className={st.chip} aria-pressed={useSources} disabled={generating} onClick={() => setUseSources((value) => !value)}>
            {useSources ? <Check size={14} strokeWidth={2} /> : <Paperclip size={14} strokeWidth={1.75} />}
            <span>已勾选资料 {selectedSources.length} 份</span>
          </button>
        )}
        {uploads.map((source) => (
          <span key={source.id} className={cx(st.chip, st.chipFile)}>
            <Paperclip size={14} strokeWidth={1.75} />
            <span>{source.title}</span>
            <button type="button" aria-label={`移除 ${source.title}`} disabled={generating} onClick={() => setUploads((current) => current.filter((item) => item.id !== source.id))}><X size={13} strokeWidth={2} /></button>
          </span>
        ))}
        <button type="button" className={cx(st.chip, st.chipGhost)} disabled={generating || uploads.length >= 4} onClick={() => fileRef.current?.click()}>
          <FileUp size={14} strokeWidth={1.75} />
          <span>上传资料</span>
        </button>
        <input ref={fileRef} type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,.tex,text/*" onChange={onFiles} />
        {!topic && !prompt && !generating && SUGGESTIONS.map((text) => (
          <button key={text} type="button" className={cx(st.chip, st.chipGhost)} onClick={() => setPrompt(text)}>{text}</button>
        ))}
      </div>

      {generating && progress ? (
        <div className={st.progress} role="status">
          <header>
            <Shimmer>{progress.stage === 'outline' ? '正在设计课程大纲…' : `正在生成「${progress.title ?? '课程'}」`}</Shimmer>
            <span className={st.progressCount}>{progress.stage === 'outline' ? `共 ${planned} 幕` : `${done} / ${planned} 幕`}</span>
            <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>取消</Button>
          </header>
          <Progress value={progress.stage === 'outline' ? 0.4 : done + 0.6} max={planned + 0.6} label="生成进度" />
          {progress.scenes.length > 0 && (
            <ol className={st.progressList}>
              {progress.scenes.map((scene, index) => {
                const Icon = SCENE_ICONS[scene.type];
                return (
                  <li key={index} data-status={scene.status}>
                    <span className={st.progressIcon}><Icon size={14} strokeWidth={1.75} /></span>
                    <span className={st.progressTitle}>{scene.title}</span>
                    <span className={st.progressState}>
                      {scene.status === 'running' && <Spinner size={14} />}
                      {scene.status === 'done' && <Check size={15} strokeWidth={2} />}
                      {scene.status === 'fallback' && '本地补位'}
                      {scene.status === 'pending' && '排队中'}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : (
        <>
          <div className={st.options}>
            <div className={st.option}>
              <span className={st.optionLabel}>学习者</span>
              <Segmented size={compact ? 'md' : 'sm'} block={compact} label="学习者水平" value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
            </div>
            <div className={st.option}>
              <span className={st.optionLabel}>长度</span>
              <Segmented size={compact ? 'md' : 'sm'} block={compact} label="课程长度" value={length} onChange={setLength} options={LENGTH_OPTIONS} />
            </div>
            <div className={cx(st.option, st.optionWide)}>
              <span className={st.optionLabel}>包含</span>
              <div className={st.typeRow} role="group" aria-label="幕类型">
                {SCENE_TYPES.map((type) => {
                  const Icon = SCENE_ICONS[type];
                  return (
                    <button key={type} type="button" className={st.typeChip} aria-pressed={types.includes(type)} onClick={() => toggleType(type)}>
                      <Icon size={14} strokeWidth={1.75} />{SCENE_LABELS[type]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {error && (
            <div className={st.error} role="alert">
              <span>{error.message}</span>
              {error.canLocal && <Button variant="outline" size="sm" onClick={runLocal}>先用课程内容生成本地演示</Button>}
            </div>
          )}
          <footer className={st.composerFoot}>
            <p className={st.hint}>
              {modelReady === false
                ? <><Badge tone="warn">本地演示</Badge>现在没有接通模型：{topic || material.length ? '会用课程讲义、例题和题库拼一堂课。' : '需要先打开一门课或上传资料。'}</>
                : '先出大纲，再逐幕生成，通常一两分钟。'}
            </p>
            <Button variant="solid" size="lg" icon={<IconSpark size={17} />} disabled={!canSubmit} onClick={() => void run()}>生成课程</Button>
          </footer>
        </>
      )}
    </section>
  );
}
