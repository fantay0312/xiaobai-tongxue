import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import { useDocTitle } from '../../hooks/useDocTitle';
import {
  createCustomCourse,
  customContentStatus,
  deleteCustomAsset,
  discardTopicDraft,
  findTopicSourceCandidates,
  getCompileJob,
  getCourseCompileJob,
  listCourseAssets,
  listCustomCourses,
  publishCustomTopic,
  reparseCustomAsset,
  saveTopicDraft,
  startTopicCompile,
  uploadCourseAsset,
  CustomContentError,
  type AssetRole,
  type CompileJob,
  type CustomAsset,
  type CustomCourse,
  type CustomTopicPayload,
  type CustomTopicRecord,
  type QualityIssue,
  type SourceCandidate,
} from '../../lib/customContent';
import { useAppStore } from '../../store/appStore';
import type { Misconception, PredictionQuizItem } from '../../types';
import s from './customContent.module.css';

const ACCEPT = '.pdf,.ppt,.pptx,.docx,.md,.txt';
const MAX_BYTES = 80 * 1024 * 1024;
const CUSTOM_BOOTSTRAP_RETRY_MS = [1_000, 2_000] as const;
const ROLE_LABEL: Record<AssetRole, string> = {
  lecture: '讲座课件', lab: '实验材料', syllabus: '课程大纲', reading: '补充读物',
};
const STATUS_LABEL: Record<CustomAsset['parseStatus'], string> = {
  pending: '候解析', processing: '拆页中', finalizing: '编索引', completed: '已入库', failed: '解析失败', cancelled: '已取消',
};
const JOB_LABEL: Record<CompileJob['status'], string> = {
  queued: '已排入编译队列', running: '小砚正在编讲稿', needs_review: '草稿待校订', done: '课题已发布', failed: '编译未完成',
};

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function errorHint(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const hints: Record<string, string> = {
    'custom-content-unavailable': '资料服务尚未启用，请稍后再试。',
    'course-title-invalid': '课程名至少写两个字。',
    'course-create-upstream-failed': '知识库没有建成，请稍后重试。',
    'file-too-large': '单份资料不能超过 80 MB。',
    'file-type-unsupported': '目前支持 PDF、PPT/PPTX、DOCX、Markdown 与 TXT。',
    'file-content-mismatch': '文件内容与扩展名不一致，请确认文件没有损坏。',
    'asset-duplicate': '这份资料已经入过库了。',
    'asset-upload-upstream-failed': '资料没能交给解析服务，请稍后重试。',
    'asset-storage-failed': '原文件没有完整写入私有 COS，本次上传已撤销。',
    'asset-storage-missing': 'COS 原件校验失败，请重新上传这份资料。',
    'asset-storage-delete-failed': 'COS 原件尚未删除，本次删除已停止。',
    'upload-busy': '上一份资料还在上传，请等它交卷。',
    'rate-limited': '今天这类操作已经较多，请按提示稍后再试。',
    'rate-limit-unavailable': '上传用量校验暂不可用，请稍后再试。',
    'assets-not-ready': '请等所选资料全部显示“已入库”再生成课题。',
    'asset-in-use': '这份资料已被课题引用，不能直接删除。',
    'compile-job-active': '这门课程已有一份未完成讲稿，请先校订或发布。',
    'source-query-invalid': '要点名和评估依据再写具体一些，才能查找出处。',
    'topic-quality-gate-failed': '仍有发布前必须修正的条目。',
    'faq-sync-failed': '误区备份没有同步完成，本次没有发布。',
    'compiler-timeout': '课题编译超时，可稍后重新发起。',
    'compiler-no-chunks': '课件没有解析出可用正文，请先重新解析资料。',
  };
  return hints[code] ?? '这一步没有完成，请稍后再试。';
}

function groupsText(groups: string[][]): string {
  return groups.map((group) => group.join('、')).join('\n');
}

function parseGroups(value: string): string[][] {
  return value.split(/\n+/).map((line) => line.split(/[、,，]+/).map((item) => item.trim()).filter(Boolean)).filter((group) => group.length > 0);
}

function lines(value: string): string[] {
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function retryDelay(failures: number): number {
  return Math.min(15_000, 1_000 * (2 ** Math.min(failures, 4)));
}

function starterQuiz(prefix: string, checklistRef: string, mcRef: string | null = null): PredictionQuizItem[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${prefix}-q${index + 1}`,
    question: '',
    options: ['', ''],
    answerIndex: 0,
    explanation: '',
    checklistRef,
    mcRef,
  }));
}

function nextQuiz(prefix: string, checklistRef: string, items: PredictionQuizItem[], mcRef: string | null): PredictionQuizItem {
  let sequence = items.length + 1;
  while (items.some((item) => item.id === `${prefix}-q${sequence}`)) sequence += 1;
  return {
    id: `${prefix}-q${sequence}`,
    question: '',
    options: ['', ''],
    answerIndex: 0,
    explanation: '',
    checklistRef,
    mcRef,
  };
}

function starterMisconception(topicId: string, mcId: string, checklistId: string, quizPrefix: string): Misconception {
  return {
    mcId,
    topicId,
    belief: '',
    triggerLine: '',
    correctionCriteria: [],
    correctionKeywords: [],
    adoptionKeywords: [],
    injectAfterChecklist: [checklistId],
    probe: { statement: '', isTrue: false, explanation: '' },
    remedy: {
      microLesson: { title: '', body: '', askBack: '' },
      predictionQuiz: starterQuiz(quizPrefix, checklistId, mcId),
    },
  };
}

function Issues({ issues }: { issues: QualityIssue[] }) {
  if (issues.length === 0) {
    return <p className={s.gateClear}><Icon name="circle-check" size={16} /> 所有发布闸门已通过</p>;
  }
  return (
    <ol className={s.issueList}>
      {issues.map((item, index) => (
        <li key={`${item.code}-${item.path}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <p><strong>{item.message}</strong><small>{item.path}</small></p>
        </li>
      ))}
    </ol>
  );
}

function QuizEditor({
  title,
  items,
  checklist,
  idPrefix,
  misconceptions,
  fixedMcRef,
  exactCount,
  onChange,
}: {
  title: string;
  items: PredictionQuizItem[];
  checklist: CustomTopicPayload['checklist'];
  idPrefix: string;
  misconceptions: Misconception[];
  fixedMcRef?: string;
  exactCount?: number;
  onChange: (next: PredictionQuizItem[]) => void;
}) {
  const patchItem = (index: number, patch: Partial<PredictionQuizItem>) => {
    onChange(items.map((item, at) => at === index ? { ...item, ...patch } : item));
  };
  const addItem = () => onChange([
    ...items,
    nextQuiz(idPrefix, checklist[0]?.id ?? 'c1', items, fixedMcRef ?? null),
  ]);
  const renumberItems = () => onChange(items.map((item, index) => ({
    ...item,
    id: `${idPrefix}-q${index + 1}`,
  })));
  const maximum = exactCount ?? 8;
  const minimum = exactCount ?? 3;
  return (
    <section className={s.quizGroup}>
      <header>
        <div><span>QUIZ</span><h4>{title}</h4><small>{exactCount ? `须恰好 ${exactCount} 题` : '可编 3–8 题'}；正确答案按选项顺序选择</small></div>
        <div className={s.quizActions}>
          <button type="button" onClick={renumberItems}>重编题号</button>
          <button type="button" onClick={addItem} disabled={items.length >= maximum}>＋ 添一题</button>
        </div>
      </header>
      <div className={s.quizList}>
        {items.map((item, index) => (
          <article className={s.quizCard} key={`${item.id}-${index}`}>
            <span className={s.quizNo}>Q{String(index + 1).padStart(2, '0')}</span>
            <div className={s.quizBody}>
              <label>题干<input value={item.question} placeholder="写一道能检验理解的题" onChange={(event) => patchItem(index, { question: event.target.value })} /></label>
              <div className={s.inlineFields}>
                <label>选项<small>一行一个选项</small><textarea rows={3} value={item.options.join('\n')} onChange={(event) => {
                  // 保留正在输入的空行，否则受控 textarea 会吞掉 Enter，无法补第二个选项。
                  const options = event.target.value.replace(/\r/g, '').split('\n').slice(0, 6);
                  patchItem(index, {
                    options,
                    answerIndex: item.answerIndex >= 0 && item.answerIndex < options.length ? item.answerIndex : 0,
                  });
                }} /></label>
                <label>正确答案<select value={item.answerIndex} onChange={(event) => patchItem(index, { answerIndex: Number(event.target.value) })}>
                  {item.options.map((option, optionIndex) => <option key={`${option}-${optionIndex}`} value={optionIndex}>{optionIndex + 1} · {option || '空选项'}</option>)}
                </select></label>
              </div>
              <div className={s.inlineFields}>
                <label>关联要点<select value={item.checklistRef} onChange={(event) => patchItem(index, { checklistRef: event.target.value })}>{checklist.map((check) => <option key={check.id} value={check.id}>{check.id} · {check.point}</option>)}</select></label>
                <label>课件依据<input value={item.explanation} placeholder="解释正确答案为什么成立" onChange={(event) => patchItem(index, { explanation: event.target.value })} /></label>
              </div>
              <label>关联误区<select value={item.mcRef ?? ''} onChange={(event) => patchItem(index, { mcRef: event.target.value || null })}><option value="">不关联误区</option>{(fixedMcRef ? misconceptions.filter((mc) => mc.mcId === fixedMcRef) : misconceptions).map((mc) => <option key={mc.mcId} value={mc.mcId}>{mc.mcId} · {mc.belief || '未命名误区'}</option>)}</select></label>
              <button className={s.removeLine} type="button" onClick={() => onChange(items.filter((_, at) => at !== index))} disabled={items.length <= minimum}>删去此题</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DraftEditor({
  record,
  onChange,
  onError,
}: {
  record: CustomTopicRecord;
  onChange: (next: CustomTopicPayload) => void;
  onError: (error: unknown) => void;
}) {
  const draft = record.payload;
  const [sourceChoices, setSourceChoices] = useState<Record<string, SourceCandidate[]>>({});
  const [findingSourceId, setFindingSourceId] = useState<string | null>(null);
  const patchTop = (patch: Partial<CustomTopicPayload>) => onChange({ ...draft, ...patch });
  const patchChecklist = (index: number, patch: Partial<CustomTopicPayload['checklist'][number]>) => {
    const checklist = draft.checklist.map((item, at) => at === index ? { ...item, ...patch } : item);
    patchTop({ checklist });
  };
  const checklistReferenced = (id: string) => (
    draft.misconceptions.some((item) => item.injectAfterChecklist.includes(id)
      || item.remedy.predictionQuiz.some((quiz) => quiz.checklistRef === id))
    || draft.quizBank.some((quiz) => quiz.checklistRef === id)
  );
  const removeChecklist = (index: number) => {
    const item = draft.checklist[index];
    if (!item || checklistReferenced(item.id)) return;
    patchTop({ checklist: draft.checklist.filter((_, at) => at !== index) });
  };
  const addChecklist = () => {
    let sequence = 1;
    while (draft.checklist.some((item) => item.id === `c${sequence}`)) sequence += 1;
    patchTop({
      checklist: [...draft.checklist, {
        id: `c${sequence}`,
        point: '',
        groundTruth: '',
        keywords: [],
        terms: [],
        level: 'L5',
        lookupCard: '',
        probeLine: '',
        sourceChunkIds: [],
        sourceExcerpt: '',
      }],
    });
  };
  const patchMc = (index: number, patch: Partial<Misconception>) => {
    const misconceptions = draft.misconceptions.map((item, at) => at === index ? { ...item, ...patch } : item);
    patchTop({ misconceptions });
  };
  const addMc = () => {
    const firstChecklist = draft.checklist[0]?.id ?? 'c1';
    let sequence = 1;
    while (draft.misconceptions.some((item) => item.mcId === `${draft.topicId}_M${sequence}`)) sequence += 1;
    const mcId = `${draft.topicId}_M${sequence}`;
    patchTop({
      misconceptions: [
        ...draft.misconceptions,
        starterMisconception(draft.topicId, mcId, firstChecklist, `remedy-${sequence}`),
      ],
    });
  };
  const findSources = async (item: CustomTopicPayload['checklist'][number]) => {
    if (findingSourceId) return;
    setFindingSourceId(item.id);
    try {
      const candidates = await findTopicSourceCandidates(record.id, item.point, item.groundTruth);
      setSourceChoices((current) => ({ ...current, [item.id]: candidates }));
    } catch (error) {
      onError(error);
    } finally {
      setFindingSourceId(null);
    }
  };

  return (
    <div className={s.draftEditor}>
      <fieldset className={s.identityFields}>
        <legend>课题题签</legend>
        <label>课题名<input value={draft.title} maxLength={160} onChange={(event) => patchTop({ title: event.target.value })} /></label>
        <label>一句引子<input value={draft.tagline} maxLength={240} onChange={(event) => patchTop({ tagline: event.target.value })} /></label>
        <label>迁移场景<input value={draft.transferHint} maxLength={240} onChange={(event) => patchTop({ transferHint: event.target.value })} /></label>
      </fieldset>

      <section className={s.editorSection}>
        <header><div><span>CHECKLIST</span><h3>讲解要点</h3></div><button type="button" onClick={addChecklist}>＋ 添一条</button></header>
        <div className={s.ledgerRows}>
          {draft.checklist.map((item, index) => (
            <article className={s.ledgerRow} key={`${item.id}-${index}`}>
              <div className={s.rowIndex}>C{String(index + 1).padStart(2, '0')}</div>
              <div className={s.rowBody}>
                <div className={s.inlineFields}>
                  <label>要点名<input value={item.point} placeholder="例如：递归终止条件" onChange={(event) => patchChecklist(index, { point: event.target.value })} /></label>
                  <label>追问层级<select value={item.level} onChange={(event) => patchChecklist(index, { level: event.target.value as typeof item.level })}><option>L1</option><option>L2</option><option>L3</option><option>L5</option></select></label>
                </div>
                <label>评估依据<textarea rows={2} value={item.groundTruth} placeholder="写下课件明确支持的判断依据" onChange={(event) => patchChecklist(index, { groundTruth: event.target.value })} /></label>
                <div className={s.inlineFields}>
                  <label>命中词组<small>每行一组，组内用顿号</small><textarea rows={3} value={groupsText(item.keywords)} onChange={(event) => patchChecklist(index, { keywords: parseGroups(event.target.value) })} /></label>
                  <label>术语<small>用顿号分开</small><textarea rows={3} value={item.terms.join('、')} onChange={(event) => patchChecklist(index, { terms: event.target.value.split(/[、,，]+/).map((term) => term.trim()).filter(Boolean) })} /></label>
                </div>
                <label>小白追问<input value={item.probeLine} onChange={(event) => patchChecklist(index, { probeLine: event.target.value })} /></label>
                <label>一起查书卡<textarea rows={2} value={item.lookupCard} onChange={(event) => patchChecklist(index, { lookupCard: event.target.value })} /></label>
                <blockquote className={s.sourceProof}>{item.sourceExcerpt || '保存时将重新核验课件出处'}</blockquote>
                <button className={s.sourceButton} type="button" onClick={() => void findSources(item)} disabled={findingSourceId !== null || item.point.trim().length < 2 || item.groundTruth.trim().length < 4}>{findingSourceId === item.id ? '正在翻检课件…' : item.sourceChunkIds.length > 0 ? '更换课件出处' : '查找课件出处'}</button>
                {Object.hasOwn(sourceChoices, item.id) ? (
                  sourceChoices[item.id].length > 0 ? <div className={s.sourceCandidates} role="radiogroup" aria-label={`${item.point || item.id}的课件出处`}>
                    {sourceChoices[item.id].map((candidate) => <label key={candidate.chunkId}><input type="radio" name={`source-${item.id}`} checked={item.sourceChunkIds[0] === candidate.chunkId} onChange={() => patchChecklist(index, { sourceChunkIds: [candidate.chunkId], sourceExcerpt: candidate.excerpt })} /><span><strong>{candidate.filename}</strong>{candidate.excerpt}</span></label>)}
                  </div> : <p className={s.sourceEmpty}>没有找到足够相关的片段，请把要点名和评估依据写得更贴近课件原文。</p>
                ) : null}
                <button className={s.removeLine} type="button" title={checklistReferenced(item.id) ? '请先改掉误区或题目中的关联' : undefined} onClick={() => removeChecklist(index)} disabled={draft.checklist.length <= 3 || checklistReferenced(item.id)}>删去此条</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={s.editorSection}>
        <header><div><span>MISCONCEPTION</span><h3>小白会想岔的地方</h3></div><button type="button" onClick={addMc}>＋ 添一处</button></header>
        <div className={s.ledgerRows}>
          {draft.misconceptions.map((item, index) => (
            <article className={s.ledgerRow} key={`${item.mcId}-${index}`}>
              <div className={`${s.rowIndex} ${s.mcIndex}`}>M{String(index + 1).padStart(2, '0')}</div>
              <div className={s.rowBody}>
                <label>错误认知<input value={item.belief} placeholder="写出一个真实常见的误解" onChange={(event) => patchMc(index, { belief: event.target.value })} /></label>
                <label>小白注入台词<input value={item.triggerLine} placeholder="用学生口吻写成问句" onChange={(event) => patchMc(index, { triggerLine: event.target.value })} /></label>
                <div className={s.inlineFields}>
                  <label>纠正标准<small>一行一条</small><textarea rows={3} value={item.correctionCriteria.join('\n')} onChange={(event) => patchMc(index, { correctionCriteria: lines(event.target.value) })} /></label>
                  <label>挂在哪个要点之后<select value={item.injectAfterChecklist[0] ?? ''} onChange={(event) => patchMc(index, { injectAfterChecklist: [event.target.value] })}>{draft.checklist.map((check) => <option key={check.id} value={check.id}>{check.id} · {check.point}</option>)}</select></label>
                </div>
                <div className={s.inlineFields}>
                  <label>纠正命中词<textarea rows={2} value={groupsText(item.correctionKeywords)} onChange={(event) => patchMc(index, { correctionKeywords: parseGroups(event.target.value) })} /></label>
                  <label>认同错误词<textarea rows={2} value={groupsText(item.adoptionKeywords)} onChange={(event) => patchMc(index, { adoptionKeywords: parseGroups(event.target.value) })} /></label>
                </div>
                <div className={s.inlineFields}>
                  <label>摸底判断题<input value={item.probe.statement} placeholder="写一条判断题" onChange={(event) => patchMc(index, { probe: { ...item.probe, statement: event.target.value } })} /></label>
                  <label>错误解释<input value={item.probe.explanation} placeholder="依据课件解释为什么错" onChange={(event) => patchMc(index, { probe: { ...item.probe, explanation: event.target.value } })} /></label>
                </div>
                <div className={s.inlineFields}>
                  <label>补学小笺标题<input value={item.remedy.microLesson.title} placeholder="给补学内容起个短标题" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, title: event.target.value } } })} /></label>
                  <label>回问一句<input value={item.remedy.microLesson.askBack} placeholder="下次再遇到时该怎么解释？" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, askBack: event.target.value } } })} /></label>
                </div>
                <label>补学正文<textarea rows={4} value={item.remedy.microLesson.body} placeholder="写清输入、加工与回到讲解舱的路径" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, body: event.target.value } } })} /></label>
                <QuizEditor
                  title="补学后的预测题"
                  items={item.remedy.predictionQuiz}
                  checklist={draft.checklist}
                  idPrefix={`remedy-${index + 1}`}
                  misconceptions={draft.misconceptions}
                  fixedMcRef={item.mcId}
                  exactCount={3}
                  onChange={(predictionQuiz) => patchMc(index, {
                    remedy: { ...item.remedy, predictionQuiz },
                  })}
                />
                <button className={s.removeLine} type="button" onClick={() => patchTop({ misconceptions: draft.misconceptions.filter((_, at) => at !== index) })} disabled={draft.misconceptions.length <= 2}>删去此条</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={s.editorSection}>
        <header><div><span>QUIZ BANK</span><h3>考小白的随堂题</h3></div></header>
        <QuizEditor
          title="课题总题库"
          items={draft.quizBank}
          checklist={draft.checklist}
          idPrefix="main"
          misconceptions={draft.misconceptions}
          onChange={(quizBank) => patchTop({ quizBank })}
        />
      </section>

      <section className={s.editorSection}>
        <header><div><span>PREP PACK</span><h3>备课材料包</h3></div></header>
        <div className={s.prepFields}>
          <label>教学任务卡<textarea rows={2} value={draft.prep.taskCard} onChange={(event) => patchTop({ prep: { ...draft.prep, taskCard: event.target.value } })} /></label>
          <label>微课正文<textarea rows={7} value={draft.prep.microLecture.body} onChange={(event) => patchTop({ prep: { ...draft.prep, microLecture: { ...draft.prep.microLecture, body: event.target.value } } })} /></label>
          <label>备课自检<small>一行一条</small><textarea rows={4} value={draft.prep.selfCheck.join('\n')} onChange={(event) => patchTop({ prep: { ...draft.prep, selfCheck: lines(event.target.value) } })} /></label>
        </div>
      </section>
    </div>
  );
}

export default function CustomContentPage() {
  useDocTitle('自选讲义');
  const refreshRuntimeTopics = useAppStore((state) => state.loadCustomTopics);
  const [service, setService] = useState<'checking' | 'ready' | 'unhealthy' | 'unavailable'>('checking');
  const [bootstrapToken, setBootstrapToken] = useState(0);
  const [courses, setCourses] = useState<CustomCourse[]>([]);
  const [courseId, setCourseId] = useState('');
  const [assets, setAssets] = useState<CustomAsset[]>([]);
  const [assetRefreshToken, setAssetRefreshToken] = useState(0);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [assetRole, setAssetRole] = useState<AssetRole>('lecture');
  const [uploading, setUploading] = useState<{ name: string; index: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [job, setJob] = useState<CompileJob | null>(null);
  const [recoveringJob, setRecoveringJob] = useState(false);
  const [draftRecord, setDraftRecord] = useState<CustomTopicRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [publishedTopicId, setPublishedTopicId] = useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCourse = courses.find((course) => course.id === courseId) ?? null;
  const activeJobId = job?.id ?? null;
  const activeJobStatus = job?.status ?? null;
  const selectedReadyAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.id) && asset.parseStatus === 'completed'),
    [assets, selectedAssetIds],
  );

  const refreshCourses = useCallback(async (preferredId?: string) => {
    const next = await listCustomCourses();
    setCourses(next);
    setCourseId((current) => preferredId ?? (next.some((course) => course.id === current) ? current : next[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    let active = true;
    setService('checking');
    void (async () => {
      let finalState: 'unhealthy' | 'unavailable' = 'unhealthy';
      for (let attempt = 0; attempt <= CUSTOM_BOOTSTRAP_RETRY_MS.length; attempt += 1) {
        try {
          const [status, nextCourses] = await Promise.all([customContentStatus(), listCustomCourses()]);
          if (!active) return;
          if (status.healthy) {
            setService('ready');
            setCourses(nextCourses);
            setCourseId(nextCourses[0]?.id ?? '');
            return;
          }
          finalState = 'unhealthy';
        } catch (error) {
          if (!active) return;
          finalState = error instanceof CustomContentError && error.status === 503 ? 'unavailable' : 'unhealthy';
          setNotice(errorHint(error));
        }
        const delay = CUSTOM_BOOTSTRAP_RETRY_MS[attempt];
        if (delay === undefined) break;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      if (active) setService(finalState);
    })();
    return () => { active = false; };
  }, [bootstrapToken]);

  useEffect(() => {
    if (!courseId) {
      setAssets([]);
      return undefined;
    }
    let active = true;
    let timer = 0;
    let failures = 0;
    const refresh = async () => {
      try {
        const next = await listCourseAssets(courseId);
        if (!active) return;
        failures = 0;
        setAssets(next);
        setSelectedAssetIds((current) => new Set([...current].filter((id) => next.some((asset) => asset.id === id && asset.parseStatus === 'completed'))));
        if (next.some((asset) => asset.parseStatus === 'pending' || asset.parseStatus === 'processing' || asset.parseStatus === 'finalizing')) {
          timer = window.setTimeout(() => void refresh(), 2_000);
        }
      } catch (error) {
        if (active) {
          setNotice(errorHint(error));
          failures += 1;
          timer = window.setTimeout(() => void refresh(), retryDelay(failures));
        }
      }
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [courseId, assetRefreshToken]);

  useEffect(() => {
    if (!courseId) {
      setJob(null);
      setDraftRecord(null);
      setRecoveringJob(false);
      return undefined;
    }
    let active = true;
    setJob(null);
    setDraftRecord(null);
    setPublishedTopicId(null);
    setDiscardArmed(false);
    setRecoveringJob(true);
    let timer = 0;
    let failures = 0;
    const recover = async () => {
      try {
        const next = await getCourseCompileJob(courseId);
        if (!active) return;
        setJob(next);
        setDraftRecord(next?.status === 'needs_review' && next.topic ? next.topic : null);
        if (next) setSelectedAssetIds(new Set(next.assetIds));
        setRecoveringJob(false);
      } catch (error) {
        if (!active) return;
        setNotice(errorHint(error));
        failures += 1;
        timer = window.setTimeout(() => void recover(), retryDelay(failures));
      }
    };
    void recover();
    return () => { active = false; window.clearTimeout(timer); };
  }, [courseId]);

  useEffect(() => {
    if (!activeJobId || (activeJobStatus !== 'queued' && activeJobStatus !== 'running')) return undefined;
    let active = true;
    let timer = 0;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await getCompileJob(activeJobId);
        if (!active) return;
        failures = 0;
        setJob(next);
        if (next.topic && next.status === 'needs_review') setDraftRecord(next.topic);
        else if (next.status === 'queued' || next.status === 'running') timer = window.setTimeout(() => void poll(), 2_000);
      } catch (error) {
        if (active) {
          setNotice(errorHint(error));
          failures += 1;
          timer = window.setTimeout(() => void poll(), retryDelay(failures));
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 700);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeJobId, activeJobStatus]);

  const makeCourse = async () => {
    if (creatingCourse || !newCourseTitle.trim()) return;
    setCreatingCourse(true);
    setNotice('');
    try {
      const course = await createCustomCourse(newCourseTitle);
      setNewCourseTitle('');
      setAssets([]);
      setSelectedAssetIds(new Set());
      await refreshCourses(course.id);
    } catch (error) {
      setNotice(errorHint(error));
    } finally {
      setCreatingCourse(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!courseId || files.length === 0 || uploading) return;
    const usable = files.filter((file) => file.size > 0 && file.size <= MAX_BYTES);
    if (usable.length !== files.length) setNotice('已跳过空文件或超过 80 MB 的资料。');
    for (const [index, file] of usable.entries()) {
      setUploading({ name: file.name, index: index + 1, total: usable.length });
      try {
        const asset = await uploadCourseAsset(courseId, file, assetRole);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      } catch (error) {
        setNotice(`${file.name}：${errorHint(error)}`);
      }
    }
    setUploading(null);
    setAssetRefreshToken((value) => value + 1);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await refreshCourses(courseId).catch(() => {});
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(Array.from(event.target.files ?? []));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const toggleAsset = (assetId: string) => setSelectedAssetIds((current) => {
    const next = new Set(current);
    if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
    return next;
  });

  const beginCompile = async () => {
    if (!courseId || recoveringJob || selectedReadyAssets.length === 0 || job?.status === 'queued' || job?.status === 'running' || job?.status === 'needs_review') return;
    setNotice('');
    setDraftRecord(null);
    setPublishedTopicId(null);
    setDiscardArmed(false);
    try {
      setJob(await startTopicCompile({
        courseId,
        assetIds: selectedReadyAssets.map((asset) => asset.id),
        ...(topicTitle.trim() ? { title: topicTitle.trim() } : {}),
      }));
    } catch (error) {
      setNotice(errorHint(error));
    }
  };

  const saveDraft = async (): Promise<CustomTopicRecord | null> => {
    if (!draftRecord || saving) return null;
    setSaving(true);
    setNotice('');
    try {
      const saved = await saveTopicDraft(draftRecord.id, draftRecord.payload);
      setDraftRecord(saved);
      return saved;
    } catch (error) {
      setNotice(errorHint(error));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!draftRecord || publishing) return;
    setPublishing(true);
    setNotice('');
    try {
      const saved = await saveTopicDraft(draftRecord.id, draftRecord.payload);
      setDraftRecord(saved);
      if (saved.qualityIssues.some((issue) => issue.level === 'error')) {
        setNotice('质量闸门仍有未通过项，草稿已保存但没有发布。');
        return;
      }
      const published = await publishCustomTopic(saved.id);
      setPublishedTopicId(published.topicId);
      setDraftRecord({ ...published, payload: published.payload });
      setJob((current) => current ? { ...current, status: 'done' } : current);
      await Promise.all([refreshRuntimeTopics(true), refreshCourses(courseId)]);
    } catch (error) {
      setNotice(errorHint(error));
    } finally {
      setPublishing(false);
    }
  };

  const discardDraft = async () => {
    if (!draftRecord || !discardArmed || discarding || draftRecord.status !== 'draft') return;
    const draftId = draftRecord.id;
    setDiscarding(true);
    setNotice('');
    try {
      await discardTopicDraft(draftId);
      setDraftRecord((current) => current?.id === draftId ? null : current);
      setJob((current) => current?.topicId === draftId || current?.topic?.id === draftId ? null : current);
      setPublishedTopicId(null);
      setDiscardArmed(false);
      setNotice('这份草稿已放回废稿篓，可以重新选择资料生成。');
    } catch (error) {
      setNotice(errorHint(error));
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div className={s.page}>
      <section id="custom-overview" className={s.hero}>
        <div className={s.heroCopy}>
          <p className={s.eyebrow}>PERSONAL SYLLABUS · 自选课</p>
          <h1>把自己的讲义，<br />装进小白的书架</h1>
          <p>上传课件后，WeKnora 只负责拆页、分块与找出处；小白仍按原来的备课、追问、误区与赴考流程上课。</p>
        </div>
        <ol className={s.routeTicket} aria-label="自定义课程三步流程">
          <li><span>壹</span><p><strong>资料入库</strong>PDF · PPT · Markdown</p></li>
          <li><span>贰</span><p><strong>编成课题</strong>要点 · 误区 · 备课包</p></li>
          <li><span>叁</span><p><strong>校订发布</strong>回到原书斋开讲</p></li>
        </ol>
      </section>

      {notice ? <p className={s.notice} role="status"><Icon name="circle-help" size={16} />{notice}</p> : null}
      {service !== 'ready' ? (
        <section className={s.unavailable} role="status">
          <span>{service === 'checking' ? 'CHECKING' : 'SIDE-CAR'}</span>
          <h2>{service === 'checking' ? '正在翻检资料服务…' : '资料服务暂时没有应答'}</h2>
          <p>{service === 'unavailable' ? '服务器尚未启用自定义课程 sidecar。现有课程与学习记录不受影响。' : '可以稍后重试；现有课程仍可照常学习。'}</p>
          {service !== 'checking' ? <button type="button" onClick={() => setBootstrapToken((value) => value + 1)}>重新连接资料服务</button> : null}
        </section>
      ) : (
        <div className={s.workspace}>
          <aside className={s.courseIndex} aria-label="自定义课程">
            <header><span>COURSE FILE</span><h2>自选课程</h2></header>
            <div className={s.courseList}>
              {courses.map((course, index) => (
                <button key={course.id} type="button" className={course.id === courseId ? s.courseActive : ''} onClick={() => { setCourseId(course.id); setAssets([]); setSelectedAssetIds(new Set()); setDeleteArmedId(null); setJob(null); setDraftRecord(null); setPublishedTopicId(null); setDiscardArmed(false); }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p><strong>{course.title}</strong><small>{course.assetCount} 份资料 · {course.topicCount} 个课题</small></p>
                  <Icon name="chevron-right" size={15} />
                </button>
              ))}
              {courses.length === 0 ? <p className={s.emptyIndex}>先在下面写下一门课程。</p> : null}
            </div>
            <form className={s.newCourse} onSubmit={(event) => { event.preventDefault(); void makeCourse(); }}>
              <label htmlFor="new-course">新课程题签</label>
              <input id="new-course" value={newCourseTitle} maxLength={120} onChange={(event) => setNewCourseTitle(event.target.value)} placeholder="例如：数据结构" />
              <button type="submit" disabled={creatingCourse || newCourseTitle.trim().length < 2}>{creatingCourse ? '建函中…' : '新建一函'}</button>
            </form>
          </aside>

          <main className={s.mainDesk}>
            <section id="custom-assets" className={s.deskSection}>
              <header className={s.sectionHead}>
                <div><span>MATERIAL DESK</span><h2>{selectedCourse ? `《${selectedCourse.title}》资料桌` : '先新建一门课程'}</h2></div>
                <p>单份不超过 80 MB · 原文件加密存入私有 COS</p>
              </header>
              {selectedCourse ? (
                <>
                  <div className={s.uploadControls}>
                    <label>资料角色<select value={assetRole} onChange={(event) => setAssetRole(event.target.value as AssetRole)}>{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </div>
                  <div
                    className={`${s.dropZone}${dragging ? ` ${s.dropZoneActive}` : ''}`}
                    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
                    onDrop={onDrop}
                  >
                    <Icon name="upload" size={24} />
                    <div><strong>{uploading ? `${uploading.index}/${uploading.total} 正在上传 ${uploading.name}` : '把讲义放到这里'}</strong><span>支持 PDF、PPT/PPTX、DOCX、MD、TXT；也可以一次选多份</span></div>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)}>选择资料</button>
                    <input ref={fileInputRef} type="file" accept={ACCEPT} multiple onChange={onFiles} tabIndex={-1} aria-hidden="true" />
                  </div>

                  <div className={s.assetLedger} aria-live="polite">
                    {assets.map((asset) => {
                      const ready = asset.parseStatus === 'completed';
                      const lockedByJob = Boolean(
                        job
                        && (job.status === 'queued' || job.status === 'running' || job.status === 'needs_review')
                        && job.assetIds.includes(asset.id),
                      );
                      return (
                        <article key={asset.id} className={s.assetRow}>
                          <label className={s.assetPick}>
                            <input type="checkbox" checked={selectedAssetIds.has(asset.id)} disabled={!ready} onChange={() => toggleAsset(asset.id)} />
                            <span aria-hidden="true">{selectedAssetIds.has(asset.id) ? <Icon name="check" size={14} /> : null}</span>
                          </label>
                          <Icon name="file" size={18} />
                          <div className={s.assetName}><strong>{asset.filename}</strong><small>{ROLE_LABEL[asset.assetRole]} · {fileSize(asset.byteSize)}</small></div>
                          <span className={`${s.assetStatus} ${s[`status_${asset.parseStatus}`]}`}>{STATUS_LABEL[asset.parseStatus]}</span>
                          {asset.parseStatus === 'failed' || asset.parseStatus === 'cancelled' ? <button type="button" onClick={() => void reparseCustomAsset(asset.id).then((next) => { setAssets((current) => current.map((item) => item.id === next.id ? next : item)); setAssetRefreshToken((value) => value + 1); }).catch((error) => setNotice(errorHint(error)))}>重新解析</button> : null}
                          {deleteArmedId === asset.id && !lockedByJob ? (
                            <span className={s.deleteConfirm}>
                              <button type="button" onClick={() => void deleteCustomAsset(asset.id).then(() => { setAssets((current) => current.filter((item) => item.id !== asset.id)); setDeleteArmedId(null); }).catch((error) => { setNotice(errorHint(error)); setDeleteArmedId(null); })}>确认删除</button>
                              <button type="button" onClick={() => setDeleteArmedId(null)}>保留</button>
                            </span>
                          ) : (
                            <button className={s.iconButton} type="button" aria-label={`准备删除 ${asset.filename}`} title={lockedByJob ? '这份资料正在被未完成讲稿使用' : undefined} disabled={lockedByJob} onClick={() => setDeleteArmedId(asset.id)}><Icon name="trash" size={15} /></button>
                          )}
                        </article>
                      );
                    })}
                    {assets.length === 0 ? <div className={s.emptyAssets}><Icon name="library" size={22} /><p><strong>资料桌还是空的</strong>先放一份讲义，小白才知道这门课要讲什么。</p></div> : null}
                  </div>
                </>
              ) : <p className={s.emptyDesk}>在左侧写下课程名，系统会为它建一函独立资料库。</p>}
            </section>

            <section id="custom-compiler" className={s.deskSection}>
              <header className={s.sectionHead}>
                <div><span>TOPIC COMPILER</span><h2>课题编译台</h2></div>
                <p>每条要点都必须能指回本课资料</p>
              </header>
              <div className={s.compileStarter}>
                <label>课题名（可留空让小砚拟题）<input value={topicTitle} maxLength={160} onChange={(event) => setTopicTitle(event.target.value)} placeholder="例如：栈与函数调用" /></label>
                <p>已选 <strong>{selectedReadyAssets.length}</strong> 份已入库资料</p>
                <button type="button" onClick={() => void beginCompile()} disabled={!courseId || recoveringJob || selectedReadyAssets.length === 0 || job?.status === 'queued' || job?.status === 'running' || job?.status === 'needs_review'}><Icon name="presentation" size={17} />{recoveringJob ? '正在找回草稿…' : '生成课题草稿'}</button>
              </div>

              {job ? (
                <div className={`${s.jobStrip} ${job.status === 'failed' ? s.jobFailed : ''}`} role="status">
                  <span>{job.status === 'running' || job.status === 'queued' ? <span className={s.workingDot} /> : <Icon name={job.status === 'failed' ? 'circle-x' : 'circle-check'} size={17} />}</span>
                  <p><strong>{JOB_LABEL[job.status]}</strong><small>{job.status === 'running' ? '正在读取分块、生成要点并逐条核对出处' : job.status === 'failed' ? errorHint(new Error(job.errorCode ?? '')) : '编译产物不会自动发布，须由你校订'}</small></p>
                </div>
              ) : null}

              {draftRecord ? (
                <div className={s.reviewLayout}>
                  <div className={s.reviewMain}>
                    <DraftEditor record={draftRecord} onError={(error) => setNotice(errorHint(error))} onChange={(payload) => setDraftRecord((current) => current ? { ...current, payload } : current)} />
                    <footer className={s.reviewActions}>
                      {draftRecord.status === 'draft' ? discardArmed ? (
                        <span className={s.discardConfirm}>
                          <button type="button" onClick={() => void discardDraft()} disabled={saving || publishing || discarding}>{discarding ? '正在放弃…' : '确认放弃'}</button>
                          <button type="button" onClick={() => setDiscardArmed(false)} disabled={discarding}>保留草稿</button>
                        </span>
                      ) : <button type="button" className={s.discardButton} onClick={() => setDiscardArmed(true)} disabled={saving || publishing}>放弃这份草稿</button> : null}
                      <button type="button" className={s.saveButton} onClick={() => void saveDraft()} disabled={saving || publishing || draftRecord.status !== 'draft'}>{saving ? '正在核验出处…' : '保存校订'}</button>
                      <button type="button" className={s.publishButton} onClick={() => void publish()} disabled={saving || publishing || draftRecord.status !== 'draft'}>{publishing ? '盖印发布中…' : '发布到书架'} <Icon name="arrow-right" size={16} /></button>
                    </footer>
                    {publishedTopicId ? <p className={s.published}><Icon name="circle-check" size={17} />课题已经归架。<Link to={`/prep/${publishedTopicId}`}>去备这门新课 <Icon name="arrow-right" size={15} /></Link></p> : null}
                  </div>
                  <aside className={s.gatePanel}>
                    <span>QUALITY GATE</span>
                    <h3>发布前校验</h3>
                    <Issues issues={draftRecord.qualityIssues} />
                    <p className={s.gateNote}>保存时会重新读取 WeKnora 分块，客户端不能伪造出处。</p>
                  </aside>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      )}
    </div>
  );
}
