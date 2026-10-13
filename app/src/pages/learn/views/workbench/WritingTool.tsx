import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Languages, MessageCircleQuestion, PenLine, RefreshCw, Wand2 } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Badge, Button, Field, Progress, Segmented, Textarea, toast } from '../../../../components/ui';
import { studyData, useStudyData, type WritingDoc } from '../../../../store/studyData';
import { errorText, isAbort } from './actions';
import { diffText, feedbackSection, reviewEssay, reviewTranslation } from './generate';
import { createItem } from './registry';
import { DetailHead, GenRunning, ICON_SM, OriginBadge, ToolFrame, type ToolProps } from './shared';
import { clip, countWords, useAutosave, useWorkbenchNav } from './util';
import s from './workbench.module.css';
import w from './writing.module.css';
import { IconSpark } from '../../../../components/ui/icons';

type Kind = WritingDoc['kind'];
const COPY: Record<Kind, {
  name: string; source: string; sourceHint: string; draft: string; draftHint: string; action: string; stages: string[]; intro: string; compare: string; section: string;
}> = {
  essay: {
    name: '作文',
    source: '题目与要求',
    sourceHint: '作文题目、字数和文体要求',
    draft: '我的作文',
    draftHint: '把作文写在这里，中文或英文都可以',
    action: '开始批改',
    stages: ['正在通读全文', '正在看结构和论证', '正在逐句推敲', '正在写修改稿'],
    intro: '写完后点「开始批改」。会得到总分、亮点、按类别整理的问题、逐句修改建议和一份完整的修改稿。',
    compare: '原文与修改稿',
    section: '修改稿',
  },
  translation: {
    name: '翻译',
    source: '原文',
    sourceHint: '贴上要翻译的原文，中文或英文都可以',
    draft: '我的译文',
    draftHint: '先自己译一遍，再看讲评',
    action: '对照讲评',
    stages: ['正在读原文', '正在对照你的译文', '正在写参考译文', '正在整理讲评'],
    intro: '先自己译，再点「对照讲评」。会得到参考译文、逐句对照的讲评和分数。',
    compare: '我的译文与参考译文',
    section: '参考译文',
  },
};
const SAMPLES: Record<Kind, { title: string; source: string; draft: string }> = {
  essay: {
    title: '示例 · 手机与专注',
    source: '有人认为智能手机让大学生更难专注学习。你是否同意？请给出理由和例子，不少于 300 字。',
    draft: '我同意这个观点,手机让我们很难专注。因为手机上有很多软件,这些软件会一直发通知,我们看到通知就想点开,点开以后就会看很久,然后就忘记了本来要做的事情,等到想起来的时候已经过去了一个小时,这样学习的效率就很低,而且每次被打断以后要重新进入状态也需要时间。\n\n但是手机也有好处,我们可以用手机查资料,可以用手机背单词。所以我觉得关键是怎么用手机。我自己的办法是学习的时候把手机放到书包里,学完一节再拿出来看,这样就不会一直想着手机。',
  },
  translation: {
    title: '示例 · 费曼学习法',
    source: 'The Feynman Technique is a way of learning by teaching. First, pick a concept and explain it in plain words, as if to a 12-year-old. When you get stuck, you have found a gap in your understanding. Go back to the source, fill the gap, and explain again until the explanation is simple and complete.',
    draft: '费曼技术是一种通过教学来学习的方法。首先，选一个概念并用简单的话解释它。当你卡住的时候，你就找到了理解上的一个空白。回到材料，然后再解释一次，直到解释很简单。',
  },
};

export default function WritingTool(props: ToolProps) {
  const { owner, onAsk } = props;
  const { go } = useWorkbenchNav();
  const { writings } = useStudyData(owner);
  const create = (kind: Kind) => go('writing', createItem('writing', owner, undefined, kind));

  return (
    <ToolFrame
      tool="writing"
      view={props}
      empty={{
        title: '写完就能看到讲评',
        description: '作文批改给出分数、分类问题和修改稿；翻译练习给出参考译文和逐句对照。每一篇都会留在这里，方便回看。',
      }}
      actions={{
        head: (
          <>
            <Button variant="outline" icon={<PenLine {...ICON_SM} />} onClick={() => create('essay')}>作文批改</Button>
            <Button variant="outline" icon={<Languages {...ICON_SM} />} onClick={() => create('translation')}>翻译练习</Button>
          </>
        ),
        empty: (
          <>
            <Button variant="solid" icon={<PenLine {...ICON_SM} />} onClick={() => create('essay')}>批改一篇作文</Button>
            <Button variant="soft" icon={<Languages {...ICON_SM} />} onClick={() => create('translation')}>做翻译练习</Button>
          </>
        ),
      }}
    >
      {(id) => {
        const doc = writings.find((item) => item.id === id);
        return doc ? <WritingEditor key={doc.id} doc={doc} owner={owner} onAsk={onAsk} /> : null;
      }}
    </ToolFrame>
  );
}

function WritingEditor({ doc, owner, onAsk }: { doc: WritingDoc; owner: string | null; onAsk: (text: string) => void }) {
  const kind: Kind = doc.kind === 'translation' ? 'translation' : 'essay';
  const copy = COPY[kind];
  const [title, setTitle] = useState(doc.title);
  const [source, setSource] = useState(doc.source ?? '');
  const [draft, setDraft] = useState(doc.draft ?? '');
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'feedback' | 'compare'>('feedback');
  const abort = useRef<AbortController | null>(null);
  const value = useMemo(() => ({ title, source, draft }), [title, source, draft]);

  const exists = useCallback(() => studyData.get(owner).writings.some((item) => item.id === doc.id), [owner, doc.id]);
  const save = useCallback((next: typeof value) => {
    if (!exists()) return;
    studyData.saveWriting(owner, { id: doc.id, kind, ...next });
    setDirty(false);
  }, [owner, doc.id, kind, exists]);
  useAutosave(value, dirty, save);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (dirty) return;
    setTitle(doc.title);
    setSource(doc.source ?? '');
    setDraft(doc.draft ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.updatedAt]);

  const touch = <T,>(setter: (next: T) => void) => (next: T) => { setter(next); setDirty(true); };
  const ready = draft.trim().length >= 10 && (kind === 'essay' || source.trim().length >= 4);
  const reference = feedbackSection(doc.feedback, copy.section);
  const parts = useMemo(() => (tab === 'compare' && reference ? diffText(doc.draft ?? '', reference) : null), [tab, reference, doc.draft]);

  const review = async (local = false) => {
    if (!ready) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setState('running');
    setError('');
    const name = title.trim() || clip((kind === 'essay' ? source || draft : source).replace(/\s+/g, ' ').trim(), 18) || `未命名${copy.name}`;
    try {
      const result = kind === 'essay'
        ? await reviewEssay({ prompt: source, essay: draft, local, signal: controller.signal })
        : await reviewTranslation({ source, draft, local, signal: controller.signal });
      if (controller.signal.aborted || !exists()) return;
      studyData.saveWriting(owner, { id: doc.id, kind, title: name, source, draft, feedback: result.data.feedback, score: result.data.score });
      setTitle(name);
      setDirty(false);
      setTab('feedback');
      setState('idle');
      if (result.local) toast('已完成规则检查（本地演示）', { description: '当前没有可用模型，讲评按规则给出。' });
      else toast.success(kind === 'essay' ? '批改完成' : '讲评完成');
    } catch (reason) {
      if (controller.signal.aborted || isAbort(reason)) return;
      setError(errorText(reason));
      setState('error');
    }
  };

  const fillSample = () => {
    const sample = SAMPLES[kind];
    setTitle(sample.title);
    setSource(sample.source);
    setDraft(sample.draft);
    setDirty(true);
  };
  const ask = () => onAsk(
    `${kind === 'essay' ? '这是我的作文和批改意见' : '这是我的译文和讲评'}，请挑最要紧的一个问题，带我一步步改：\n\n【${copy.source}】\n${clip(source, 600)}\n\n【${copy.draft}】\n${clip(draft, 1200)}${doc.feedback ? `\n\n【讲评摘要】\n${clip(feedbackSection(doc.feedback, '总评') || doc.feedback, 500)}` : ''}`,
  );

  const score = typeof doc.score === 'number' ? Math.round(doc.score) : null;
  const blank = !source.trim() && !draft.trim();

  return (
    <div className={s.card}>
      <DetailHead
        title={title}
        onTitle={touch(setTitle)}
        badges={<><Badge tone="accent">{copy.name}</Badge><OriginBadge origin={doc.origin} /></>}
      >
        {blank && <Button variant="ghost" size="sm" icon={<Wand2 {...ICON_SM} />} onClick={fillSample}>填入示例</Button>}
        <span className={s.saved}>{dirty ? '正在保存…' : '已保存'}</span>
      </DetailHead>

      <div className={w.body}>
        <div className={w.inputs}>
          <Field label={copy.source}>
            <Textarea className={w.source} rows={kind === 'essay' ? 3 : 7} value={source} placeholder={copy.sourceHint} onChange={(event) => touch(setSource)(event.target.value)} />
          </Field>
          <Field label={copy.draft} action={<span className={w.count}>{countWords(draft)} 字</span>}>
            <Textarea className={w.draft} rows={kind === 'essay' ? 14 : 9} value={draft} placeholder={copy.draftHint} onChange={(event) => touch(setDraft)(event.target.value)} />
          </Field>
          <div className={w.run}>
            <Button variant="solid" size="lg" icon={<IconSpark />} loading={state === 'running'} disabled={!ready} onClick={() => void review()}>
              {doc.feedback ? `重新${kind === 'essay' ? '批改' : '讲评'}` : copy.action}
            </Button>
            {state === 'running' && <Button variant="ghost" size="lg" onClick={() => { abort.current?.abort(); setState('idle'); }}>取消</Button>}
            {!ready && <span className={s.muted}>{kind === 'translation' && source.trim().length < 4 ? '先贴上原文' : '再多写一点就可以提交'}</span>}
          </div>
        </div>

        <div className={w.pane}>
          {state === 'running' ? (
            <GenRunning stages={copy.stages} />
          ) : state === 'error' ? (
            <div className={w.intro}>
              <p className={s.genError} role="alert">{error}</p>
              <div className={w.run}>
                <Button variant="soft" icon={<RefreshCw {...ICON_SM} />} onClick={() => void review()}>重试</Button>
                <Button variant="ghost" onClick={() => void review(true)}>用本地演示</Button>
              </div>
            </div>
          ) : doc.feedback ? (
            <>
              <div className={w.score}>
                {score !== null && (
                  <div className={w.scoreNum} data-tone={score >= 85 ? 'ok' : score >= 70 ? 'accent' : 'warn'}>
                    <b>{score}</b><span>/ 100</span>
                    <Progress value={score} tone={score >= 85 ? 'ok' : score >= 70 ? 'accent' : 'warn'} label="得分" />
                  </div>
                )}
                <div className={w.scoreTools}>
                  {reference && (
                    <Segmented
                      size="sm"
                      label="讲评视图"
                      value={tab}
                      onChange={setTab}
                      options={[{ value: 'feedback', label: '讲评' }, { value: 'compare', label: '对照' }]}
                    />
                  )}
                  <Button variant="ghost" size="sm" icon={<MessageCircleQuestion {...ICON_SM} />} onClick={ask}>问小砚</Button>
                </div>
              </div>
              {tab === 'compare' && reference ? (
                <div className={w.compare}>
                  <p className={w.legend}>{copy.compare}<span><del>删去</del><ins>改为</ins></span></p>
                  <div className={w.diff}>
                    {parts
                      ? parts.map((part, index) => (part.kind === 'same' ? <span key={index}>{part.text}</span> : part.kind === 'del' ? <del key={index}>{part.text}</del> : <ins key={index}>{part.text}</ins>))
                      : reference}
                  </div>
                </div>
              ) : (
                <div className={`${w.feedback} ${s.prose}`}><CoachMarkdown text={doc.feedback} /></div>
              )}
            </>
          ) : (
            <div className={w.intro}>
              <span className={w.introIcon}>{kind === 'essay' ? <PenLine size={20} strokeWidth={1.75} /> : <Languages size={20} strokeWidth={1.75} />}</span>
              <p>{copy.intro}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
