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
import { useAuthStore } from '../../store/authStore';
import type { Misconception, PredictionQuizItem } from '../../types';
import sec from '../../styles/section.module.css';
import s from './customContent.module.css';

const ACCEPT = '.pdf,.ppt,.pptx,.docx,.md,.txt';
const CUSTOM_BOOTSTRAP_RETRY_MS = [1_000, 2_000] as const;
const DELETE_POLL_TIMEOUT_MS = 120_000;
const ROLE_LABEL: Record<AssetRole, string> = {
  lecture: '讲座课件', lab: '实验材料', syllabus: '课程大纲', reading: '补充读物',
};
const STATUS_LABEL: Record<CustomAsset['parseStatus'], string> = {
  pending: '候解析', processing: '拆页中', finalizing: '编索引', completed: '已入库', failed: '解析失败', deleting: '删除中', cancelled: '已取消',
};
const JOB_LABEL: Record<CompileJob['status'], string> = {
  queued: '已排入编译队列', running: '小砚正在编讲稿', needs_review: '草稿待校订', done: '课题已发布', failed: '编译未完成',
};

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function errorHint(error: unknown, maximumBytes = 0): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'file-too-large') {
    return maximumBytes > 0
      ? `单份资料不能超过 ${fileSize(maximumBytes)}。`
      : '资料超过了服务器允许的单文件上限。';
  }
  const hints: Record<string, string> = {
    'custom-content-unavailable': '资料服务尚未启用，请稍后再试。',
    'course-title-invalid': '课程名至少写两个字。',
    'course-create-upstream-failed': '知识库没有建成，请稍后重试。',
    'body-timeout': '上传连接长时间没有新数据，请检查网络后重试。',
    'file-type-unsupported': '目前支持 PDF、PPT/PPTX、DOCX、Markdown 与 TXT。',
    'file-content-mismatch': '文件内容与扩展名不一致，请确认文件没有损坏。',
    'asset-duplicate': '这份资料已经入过库了。',
    'asset-upload-upstream-failed': '资料没能交给解析服务，请稍后重试。',
    'asset-storage-failed': '原文件没有完整写入私有 COS，本次上传已撤销。',
    'asset-storage-missing': 'COS 原件校验失败，请重新上传这份资料。',
    'asset-storage-delete-failed': 'COS 原件尚未删除，本次删除已停止。',
    'asset-delete-finalize-failed': '资料删除登记尚未收尾，请再次点击删除重试。',
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
    'compiler-empty': '小砚这次没有写出讲稿正文，请重新生成一次。',
    'compiler-invalid-json': '小砚写出的草稿格式不完整，请重新生成一次。',
    'compiler-truncated': '这次讲稿写到一半被截断了，请重新生成一次。',
    'compiler-rate-limited': '编译服务当前请求过多，请稍等一两分钟再生成。',
    'compiler-upstream-failed': '编译服务暂时没有响应，请稍后重新生成。',
    'compile-failed': '课题编译中途出错，请重新生成一次；若反复出现请联系我们。',
    'weknora-timeout': '读取课件分块超时，请稍后重新生成。',
    'weknora-unreachable': '课件解析服务暂时联系不上，请稍后重新生成。',
    'weknora-upstream-failed': '课件解析服务返回了错误，请稍后重新生成。',
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

/** 校验项的位置说明:把 `misconceptions.0.remedy.microLesson` 这类路径翻成老师看得懂的「误区 1「…」· 补学小笺」 */
const TOP_FIELD: Record<string, string> = {
  title: '课题名', tagline: '一句引子', transferHint: '迁移场景',
  checklist: '讲解要点', misconceptions: '小白会想岔的地方', quizBank: '课题总题库', prep: '备课材料包',
};
const CHECK_FIELD: Record<string, string> = {
  id: '要点编号', point: '要点名', groundTruth: '评估依据', keywords: '命中词组', terms: '术语',
  level: '追问层级', lookupCard: '一起查书卡', probeLine: '小白追问', sourceChunkIds: '课件出处',
};
const MC_FIELD: Record<string, string> = {
  mcId: '误区编号', belief: '错误认知', triggerLine: '小白注入台词', correctionCriteria: '纠正标准',
  correctionKeywords: '纠正命中词', adoptionKeywords: '认同错误词', injectAfterChecklist: '挂在哪个要点之后',
  probe: '摸底判断题', remedy: '补学小笺',
};
const QUIZ_FIELD: Record<string, string> = {
  id: '题号', question: '题干', options: '选项', answerIndex: '正确答案', explanation: '课件依据',
  checklistRef: '关联要点', mcRef: '关联误区',
};
const PREP_FIELD: Record<string, string> = { microLecture: '微课正文', examples: '例子', selfCheck: '备课自检', taskCard: '教学任务卡' };

function shortName(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function quizWhere(segments: string[], label: string): string {
  const index = Number(segments[0]);
  if (!Number.isInteger(index)) return label;
  const field = segments[1] ? QUIZ_FIELD[segments[1]] ?? segments[1] : '';
  return `${label} 第 ${index + 1} 题${field ? ` · ${field}` : ''}`;
}

function describeIssue(issue: QualityIssue, draft: CustomTopicPayload): string {
  const segments = issue.path.split('.');
  const [head] = segments;
  if (head === 'checklist') {
    const index = Number(segments[1]);
    if (!Number.isInteger(index)) return TOP_FIELD.checklist;
    const item = draft.checklist[index];
    const field = segments[2] ? CHECK_FIELD[segments[2]] ?? segments[2] : '';
    return `要点 ${index + 1}「${shortName(item?.point || item?.id || `第 ${index + 1} 条`)}」${field ? ` · ${field}` : ''}`;
  }
  if (head === 'misconceptions') {
    const index = Number(segments[1]);
    if (!Number.isInteger(index)) return TOP_FIELD.misconceptions;
    const item = draft.misconceptions[index];
    const base = `误区 ${index + 1}「${shortName(item?.belief || item?.mcId || `第 ${index + 1} 处`)}」`;
    if (segments[2] === 'remedy') {
      if (segments[3] === 'predictionQuiz') return `${base} · ${quizWhere(segments.slice(4), '补学预测题')}`;
      return `${base} · 补学小笺`;
    }
    const field = segments[2] ? MC_FIELD[segments[2]] ?? segments[2] : '';
    return `${base}${field ? ` · ${field}` : ''}`;
  }
  if (head === 'quizBank') return segments.length > 1 ? quizWhere(segments.slice(1), '随堂题') : TOP_FIELD.quizBank;
  if (head === 'prep') return `${TOP_FIELD.prep}${segments[1] ? ` · ${PREP_FIELD[segments[1]] ?? segments[1]}` : ''}`;
  return TOP_FIELD[head] ?? issue.path;
}

/** 把元素滚到视口中央:近处平滑滚动;隔得超过两屏半直接跳(长距离平滑滚动只会晕);
 *  后台页签/部分浏览器不执行平滑动画,700ms 后仍不在视口内就改瞬时滚动 */
function revealElement(el: HTMLElement) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const rect = el.getBoundingClientRect();
  const distance = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
  const behavior = reduced || distance > window.innerHeight * 2.5 ? 'auto' : 'smooth';
  el.scrollIntoView({ block: 'center', behavior });
  if (behavior === 'auto') return;
  window.setTimeout(() => {
    const after = el.getBoundingClientRect();
    if (!(after.top >= 0 && after.bottom <= window.innerHeight)) el.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, 700);
}

/** 按校验路径跳到编辑区对应字段:精确到字段找 data-path,找不到就逐级退到所在条目/区块;滚到眼前、聚焦、闪一下 */
function jumpToDraftPath(path: string) {
  const segments = path.split('.');
  let target: HTMLElement | null = null;
  while (segments.length > 0 && !target) {
    target = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(segments.join('.'))}"]`);
    if (!target) segments.pop();
  }
  if (!target) return;
  revealElement(target);
  const field = target.matches('input, textarea, select') ? target : target.querySelector<HTMLElement>('input, textarea, select');
  field?.focus({ preventScroll: true });
  target.classList.add(s.flash);
  window.setTimeout(() => target?.classList.remove(s.flash), 1600);
}

function Issues({ issues, draft, onJump }: { issues: QualityIssue[]; draft: CustomTopicPayload; onJump: (path: string) => void }) {
  if (issues.length === 0) {
    return <p className={s.gateClear}><Icon name="circle-check" size={16} /> 校验已全部通过，可以发布</p>;
  }
  return (
    <ol className={s.issueList}>
      {issues.map((item, index) => (
        <li key={`${item.code}-${item.path}-${index}`}>
          <span>{index + 1}</span>
          <button className={s.issueJump} type="button" title="跳到这一处去改" onClick={() => onJump(item.path)}>
            <strong>{describeIssue(item, draft)}{item.level === 'warning' ? <em className={s.issueWarn}>提醒</em> : null}</strong>
            <small>{item.message}</small>
          </button>
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
  pathBase,
  onChange,
}: {
  title: string;
  items: PredictionQuizItem[];
  checklist: CustomTopicPayload['checklist'];
  idPrefix: string;
  misconceptions: Misconception[];
  fixedMcRef?: string;
  exactCount?: number;
  /** 校验路径前缀(quizBank / misconceptions.i.remedy.predictionQuiz),供校验条一键跳转 */
  pathBase: string;
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
    <section className={s.quiz} data-path={pathBase}>
      <header className={s.quizHead}>
        <div><h4>{title}</h4><small>{exactCount ? `恰好 ${exactCount} 题` : '3 到 8 题'}，正确答案按选项顺序选</small></div>
        <div className={s.quizActions}>
          <button className={`${s.btnText} ${s.btnQuiet}`} type="button" onClick={renumberItems}>重编题号</button>
          <button className={s.btnText} type="button" onClick={addItem} disabled={items.length >= maximum}>添一题</button>
        </div>
      </header>
      <div className={s.quizList}>
        {items.map((item, index) => (
          <article className={s.quizCard} key={`${item.id}-${index}`} data-path={`${pathBase}.${index}`}>
            <span className={s.quizNo}>{index + 1}</span>
            <div className={s.quizBody}>
              <label data-path={`${pathBase}.${index}.question`}>题干<input value={item.question} placeholder="写一道能检验理解的题" onChange={(event) => patchItem(index, { question: event.target.value })} /></label>
              <div className={s.inline}>
                <label data-path={`${pathBase}.${index}.options`}>选项<small>一行一个选项</small><textarea rows={3} value={item.options.join('\n')} onChange={(event) => {
                  // 保留正在输入的空行，否则受控 textarea 会吞掉 Enter，无法补第二个选项。
                  const options = event.target.value.replace(/\r/g, '').split('\n').slice(0, 6);
                  patchItem(index, {
                    options,
                    answerIndex: item.answerIndex >= 0 && item.answerIndex < options.length ? item.answerIndex : 0,
                  });
                }} /></label>
                <label data-path={`${pathBase}.${index}.answerIndex`}>正确答案<select value={item.answerIndex} onChange={(event) => patchItem(index, { answerIndex: Number(event.target.value) })}>
                  {item.options.map((option, optionIndex) => <option key={`${option}-${optionIndex}`} value={optionIndex}>{optionIndex + 1} · {option || '空选项'}</option>)}
                </select></label>
              </div>
              <div className={s.inline}>
                <label data-path={`${pathBase}.${index}.checklistRef`}>关联要点<select value={item.checklistRef} onChange={(event) => patchItem(index, { checklistRef: event.target.value })}>{checklist.map((check) => <option key={check.id} value={check.id}>{check.id} · {check.point}</option>)}</select></label>
                <label data-path={`${pathBase}.${index}.explanation`}>课件依据<input value={item.explanation} placeholder="解释正确答案为什么成立" onChange={(event) => patchItem(index, { explanation: event.target.value })} /></label>
              </div>
              <label data-path={`${pathBase}.${index}.mcRef`}>关联误区<select value={item.mcRef ?? ''} onChange={(event) => patchItem(index, { mcRef: event.target.value || null })}><option value="">不关联误区</option>{(fixedMcRef ? misconceptions.filter((mc) => mc.mcId === fixedMcRef) : misconceptions).map((mc) => <option key={mc.mcId} value={mc.mcId}>{mc.mcId} · {mc.belief || '未命名误区'}</option>)}</select></label>
              <button className={`${s.btnText} ${s.btnDanger}`} style={{ justifySelf: 'end' }} type="button" onClick={() => onChange(items.filter((_, at) => at !== index))} disabled={items.length <= minimum}>删去此题</button>
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
  disabled,
}: {
  record: CustomTopicRecord;
  onChange: (next: CustomTopicPayload) => void;
  onError: (error: unknown) => void;
  disabled: boolean;
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
  const renumberChecklist = () => {
    const idMap = new Map<string, string>();
    draft.checklist.forEach((item, index) => {
      if (!idMap.has(item.id)) idMap.set(item.id, `c${index + 1}`);
    });
    const fallback = 'c1';
    const remap = (id: string) => idMap.get(id) ?? fallback;
    patchTop({
      checklist: draft.checklist.map((item, index) => ({ ...item, id: `c${index + 1}` })),
      misconceptions: draft.misconceptions.map((item) => ({
        ...item,
        injectAfterChecklist: [...new Set(item.injectAfterChecklist.map(remap))],
        remedy: {
          ...item.remedy,
          predictionQuiz: item.remedy.predictionQuiz.map((quiz) => ({ ...quiz, checklistRef: remap(quiz.checklistRef) })),
        },
      })),
      quizBank: draft.quizBank.map((quiz) => ({ ...quiz, checklistRef: remap(quiz.checklistRef) })),
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
  const renumberMisconceptions = () => {
    const idMap = new Map<string, string>();
    draft.misconceptions.forEach((item, index) => {
      if (!idMap.has(item.mcId)) idMap.set(item.mcId, `${draft.topicId}_M${index + 1}`);
    });
    patchTop({
      misconceptions: draft.misconceptions.map((item, index) => {
        const mcId = `${draft.topicId}_M${index + 1}`;
        return {
          ...item,
          mcId,
          topicId: draft.topicId,
          remedy: {
            ...item.remedy,
            predictionQuiz: item.remedy.predictionQuiz.map((quiz) => ({ ...quiz, mcRef: mcId })),
          },
        };
      }),
      quizBank: draft.quizBank.map((quiz) => ({
        ...quiz,
        mcRef: quiz.mcRef ? idMap.get(quiz.mcRef) ?? quiz.mcRef : null,
      })),
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
    <div className={`${s.draft}${disabled ? ` ${s.draftBusy}` : ''}`} inert={disabled} aria-busy={disabled}>
      <fieldset className={s.identity} data-path="identity">
        <legend>题名与引子</legend>
        <label data-path="title">课题名<input value={draft.title} maxLength={160} onChange={(event) => patchTop({ title: event.target.value })} /></label>
        <label data-path="tagline">一句引子<input value={draft.tagline} maxLength={240} onChange={(event) => patchTop({ tagline: event.target.value })} /></label>
        <label data-path="transferHint">迁移场景<input value={draft.transferHint} maxLength={240} onChange={(event) => patchTop({ transferHint: event.target.value })} /></label>
      </fieldset>

      <section className={s.block}>
        <header className={s.blockHead}>
          <div><h3>讲解要点</h3><small>{draft.checklist.length} 条，3 到 7 条为宜；每条都要能指回课件</small></div>
          <div className={s.blockActions}><button className={`${s.btnText} ${s.btnQuiet}`} type="button" onClick={renumberChecklist}>重编要点编号</button><button className={s.btnText} type="button" onClick={addChecklist} disabled={draft.checklist.length >= 7}>添一条</button></div>
        </header>
        <div className={s.rows}>
          {draft.checklist.map((item, index) => (
            <article className={s.row} key={`${item.id}-${index}`} data-path={`checklist.${index}`} style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
              <div className={s.rowNo}>{index + 1}</div>
              <div className={s.rowBody}>
                <div className={s.inline}>
                  <label data-path={`checklist.${index}.point`}>要点名<input value={item.point} placeholder="例如：递归终止条件" onChange={(event) => patchChecklist(index, { point: event.target.value })} /></label>
                  <label data-path={`checklist.${index}.level`}>追问层级<select value={item.level} onChange={(event) => patchChecklist(index, { level: event.target.value as typeof item.level })}><option>L1</option><option>L2</option><option>L3</option><option>L5</option></select></label>
                </div>
                <label data-path={`checklist.${index}.groundTruth`}>评估依据<textarea rows={2} value={item.groundTruth} placeholder="写下课件明确支持的判断依据" onChange={(event) => patchChecklist(index, { groundTruth: event.target.value })} /></label>
                <div className={s.inline}>
                  <label data-path={`checklist.${index}.keywords`}>命中词组<small>每行一组，组内用顿号</small><textarea rows={3} value={groupsText(item.keywords)} onChange={(event) => patchChecklist(index, { keywords: parseGroups(event.target.value) })} /></label>
                  <label data-path={`checklist.${index}.terms`}>术语<small>用顿号分开</small><textarea rows={3} value={item.terms.join('、')} onChange={(event) => patchChecklist(index, { terms: event.target.value.split(/[、,，]+/).map((term) => term.trim()).filter(Boolean) })} /></label>
                </div>
                <label data-path={`checklist.${index}.probeLine`}>小白追问<input value={item.probeLine} onChange={(event) => patchChecklist(index, { probeLine: event.target.value })} /></label>
                <label data-path={`checklist.${index}.lookupCard`}>一起查书卡<textarea rows={2} value={item.lookupCard} onChange={(event) => patchChecklist(index, { lookupCard: event.target.value })} /></label>
                <blockquote className={s.proof} data-path={`checklist.${index}.sourceChunkIds`}>{item.sourceExcerpt || '保存时会重新核对这一条的课件出处。'}</blockquote>
                {Object.hasOwn(sourceChoices, item.id) ? (
                  sourceChoices[item.id].length > 0 ? <div className={s.candidates} role="radiogroup" aria-label={`${item.point || item.id}的课件出处`}>
                    {sourceChoices[item.id].map((candidate) => <label key={candidate.chunkId}><input type="radio" name={`source-${item.id}`} checked={item.sourceChunkIds[0] === candidate.chunkId} onChange={() => patchChecklist(index, { sourceChunkIds: [candidate.chunkId], sourceExcerpt: candidate.excerpt })} /><span><strong>{candidate.filename}</strong>{candidate.excerpt}</span></label>)}
                  </div> : <p className={s.candidateEmpty}>没有找到足够相关的片段，把要点名和评估依据写得更贴近课件原文再试。</p>
                ) : null}
                <div className={s.rowFoot}>
                  <button className={s.btnText} type="button" onClick={() => void findSources(item)} disabled={findingSourceId !== null || item.point.trim().length < 2 || item.groundTruth.trim().length < 4}>{findingSourceId === item.id ? '正在查找…' : item.sourceChunkIds.length > 0 ? '更换课件出处' : '查找课件出处'}</button>
                  <button className={`${s.btnText} ${s.btnDanger}`} type="button" title={checklistReferenced(item.id) ? '请先改掉误区或题目中的关联' : undefined} onClick={() => removeChecklist(index)} disabled={draft.checklist.length <= 3 || checklistReferenced(item.id)}>删去此条</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={s.block}>
        <header className={s.blockHead}>
          <div><h3>小白会想岔的地方</h3><small>{draft.misconceptions.length} 处，2 到 5 处；每处配一段补学与三道预测题</small></div>
          <div className={s.blockActions}><button className={`${s.btnText} ${s.btnQuiet}`} type="button" onClick={renumberMisconceptions}>重编误区编号</button><button className={s.btnText} type="button" onClick={addMc} disabled={draft.misconceptions.length >= 5}>添一处</button></div>
        </header>
        <div className={s.rows}>
          {draft.misconceptions.map((item, index) => (
            <article className={s.row} key={`${item.mcId}-${index}`} data-path={`misconceptions.${index}`} style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
              <div className={`${s.rowNo} ${s.rowNoWarn}`}>{index + 1}</div>
              <div className={s.rowBody}>
                <label data-path={`misconceptions.${index}.belief`}>错误认知<input value={item.belief} placeholder="写出一个真实常见的误解" onChange={(event) => patchMc(index, { belief: event.target.value })} /></label>
                <label data-path={`misconceptions.${index}.triggerLine`}>小白注入台词<input value={item.triggerLine} placeholder="用学生口吻写成问句" onChange={(event) => patchMc(index, { triggerLine: event.target.value })} /></label>
                <div className={s.inline}>
                  <label data-path={`misconceptions.${index}.correctionCriteria`}>纠正标准<small>一行一条</small><textarea rows={3} value={item.correctionCriteria.join('\n')} onChange={(event) => patchMc(index, { correctionCriteria: lines(event.target.value) })} /></label>
                  <label data-path={`misconceptions.${index}.injectAfterChecklist`}>挂在哪个要点之后<select value={item.injectAfterChecklist[0] ?? ''} onChange={(event) => patchMc(index, { injectAfterChecklist: [event.target.value] })}>{draft.checklist.map((check) => <option key={check.id} value={check.id}>{check.id} · {check.point}</option>)}</select></label>
                </div>
                <div className={s.inline}>
                  <label data-path={`misconceptions.${index}.correctionKeywords`}>纠正命中词<textarea rows={2} value={groupsText(item.correctionKeywords)} onChange={(event) => patchMc(index, { correctionKeywords: parseGroups(event.target.value) })} /></label>
                  <label data-path={`misconceptions.${index}.adoptionKeywords`}>认同错误词<textarea rows={2} value={groupsText(item.adoptionKeywords)} onChange={(event) => patchMc(index, { adoptionKeywords: parseGroups(event.target.value) })} /></label>
                </div>
                <div className={s.inline}>
                  <label data-path={`misconceptions.${index}.probe`}>摸底判断题<input value={item.probe.statement} placeholder="写一条判断题" onChange={(event) => patchMc(index, { probe: { ...item.probe, statement: event.target.value } })} /></label>
                  <label data-path={`misconceptions.${index}.probe.explanation`}>错误解释<input value={item.probe.explanation} placeholder="依据课件解释为什么错" onChange={(event) => patchMc(index, { probe: { ...item.probe, explanation: event.target.value } })} /></label>
                </div>
                <div className={s.inline}>
                  <label data-path={`misconceptions.${index}.remedy.microLesson`}>补学小笺标题<input value={item.remedy.microLesson.title} placeholder="给补学内容起个短标题" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, title: event.target.value } } })} /></label>
                  <label data-path={`misconceptions.${index}.remedy.microLesson.askBack`}>回问一句<input value={item.remedy.microLesson.askBack} placeholder="下次再遇到时该怎么解释？" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, askBack: event.target.value } } })} /></label>
                </div>
                <label data-path={`misconceptions.${index}.remedy.microLesson.body`}>补学正文<textarea rows={4} value={item.remedy.microLesson.body} placeholder="写清输入、加工与回到讲解舱的路径" onChange={(event) => patchMc(index, { remedy: { ...item.remedy, microLesson: { ...item.remedy.microLesson, body: event.target.value } } })} /></label>
                <QuizEditor
                  title="补学后的预测题"
                  items={item.remedy.predictionQuiz}
                  checklist={draft.checklist}
                  idPrefix={`remedy-${index + 1}`}
                  misconceptions={draft.misconceptions}
                  fixedMcRef={item.mcId}
                  exactCount={3}
                  pathBase={`misconceptions.${index}.remedy.predictionQuiz`}
                  onChange={(predictionQuiz) => patchMc(index, {
                    remedy: { ...item.remedy, predictionQuiz },
                  })}
                />
                <button className={`${s.btnText} ${s.btnDanger}`} style={{ justifySelf: 'end' }} type="button" onClick={() => patchTop({ misconceptions: draft.misconceptions.filter((_, at) => at !== index) })} disabled={draft.misconceptions.length <= 2}>删去此条</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={s.block}>
        <header className={s.blockHead}><div><h3>考小白的随堂题</h3><small>下课后小白要答的题，考的是小白有没有听懂</small></div></header>
        <QuizEditor
          title="课题总题库"
          items={draft.quizBank}
          checklist={draft.checklist}
          idPrefix="main"
          misconceptions={draft.misconceptions}
          pathBase="quizBank"
          onChange={(quizBank) => patchTop({ quizBank })}
        />
      </section>

      <section className={s.block}>
        <header className={s.blockHead}><div><h3>备课材料包</h3><small>开讲前给老师看的：任务卡、微课与自检</small></div></header>
        <div className={s.prepFields} data-path="prep">
          <label data-path="prep.taskCard">教学任务卡<textarea rows={2} value={draft.prep.taskCard} onChange={(event) => patchTop({ prep: { ...draft.prep, taskCard: event.target.value } })} /></label>
          <label data-path="prep.microLecture">微课正文<textarea rows={7} value={draft.prep.microLecture.body} onChange={(event) => patchTop({ prep: { ...draft.prep, microLecture: { ...draft.prep.microLecture, body: event.target.value } } })} /></label>
          <label data-path="prep.selfCheck">备课自检<small>一行一条</small><textarea rows={4} value={draft.prep.selfCheck.join('\n')} onChange={(event) => patchTop({ prep: { ...draft.prep, selfCheck: lines(event.target.value) } })} /></label>
        </div>
      </section>
    </div>
  );
}

export default function CustomContentPage() {
  useDocTitle('自选讲义');
  const authUser = useAuthStore((state) => state.user);
  const refreshRuntimeTopics = useAppStore((state) => state.loadCustomTopics);
  const [service, setService] = useState<'checking' | 'ready' | 'unhealthy' | 'unavailable'>('checking');
  const [maxFileBytes, setMaxFileBytes] = useState(0);
  const [workspaceOwner, setWorkspaceOwner] = useState<string | null>(null);
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
  const courseIdRef = useRef(courseId);
  const authUserRef = useRef(authUser);
  const workspaceGenerationRef = useRef(0);
  courseIdRef.current = courseId;
  authUserRef.current = authUser;

  const workspaceIsCurrent = (owner: string | null, generation: number, expectedCourse?: string) => (
    workspaceGenerationRef.current === generation
    && authUserRef.current === owner
    && (expectedCourse === undefined || courseIdRef.current === expectedCourse)
  );

  const selectedCourse = courses.find((course) => course.id === courseId) ?? null;
  const activeJobId = job?.id ?? null;
  const activeJobStatus = job?.status ?? null;
  const selectedReadyAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.id) && asset.parseStatus === 'completed'),
    [assets, selectedAssetIds],
  );

  const refreshCourses = useCallback(async (preferredId?: string) => {
    const ownerAtRequest = authUserRef.current;
    const generationAtRequest = workspaceGenerationRef.current;
    const next = await listCustomCourses();
    if (authUserRef.current !== ownerAtRequest || workspaceGenerationRef.current !== generationAtRequest) return;
    setCourses(next);
    setCourseId((current) => (
      preferredId && next.some((course) => course.id === preferredId)
        ? preferredId
        : next.some((course) => course.id === current) ? current : next[0]?.id ?? ''
    ));
  }, []);

  useEffect(() => {
    let active = true;
    setWorkspaceOwner(null);
    setMaxFileBytes(0);
    setCourses([]);
    setCourseId('');
    setAssets([]);
    setSelectedAssetIds(new Set());
    setJob(null);
    setDraftRecord(null);
    setPublishedTopicId(null);
    setNewCourseTitle('');
    setTopicTitle('');
    setNotice('');
    setUploading(null);
    setDragging(false);
    setCreatingCourse(false);
    setSaving(false);
    setPublishing(false);
    setDiscarding(false);
    setDeleteArmedId(null);
    setDiscardArmed(false);
    setService('checking');
    void (async () => {
      let finalState: 'unhealthy' | 'unavailable' = 'unhealthy';
      for (let attempt = 0; attempt <= CUSTOM_BOOTSTRAP_RETRY_MS.length; attempt += 1) {
        try {
          const [status, nextCourses] = await Promise.all([customContentStatus(), listCustomCourses()]);
          if (!active || authUserRef.current !== authUser) return;
          if (status.healthy) {
            setService('ready');
            setMaxFileBytes(status.maxFileBytes);
            setCourses(nextCourses);
            setCourseId(nextCourses[0]?.id ?? '');
            setWorkspaceOwner(authUser);
            return;
          }
          finalState = 'unhealthy';
        } catch (error) {
          if (!active || authUserRef.current !== authUser) return;
          finalState = error instanceof CustomContentError && error.status === 503 ? 'unavailable' : 'unhealthy';
          setNotice(errorHint(error));
        }
        const delay = CUSTOM_BOOTSTRAP_RETRY_MS[attempt];
        if (delay === undefined) break;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      if (active && authUserRef.current === authUser) {
        setWorkspaceOwner(authUser);
        setService(finalState);
      }
    })();
    return () => { active = false; };
  }, [authUser, bootstrapToken]);

  useEffect(() => {
    if (!courseId) {
      setAssets([]);
      return undefined;
    }
    let active = true;
    let timer = 0;
    let failures = 0;
    let deletingSince = 0;
    let deletingPolls = 0;
    const refresh = async () => {
      try {
        const next = await listCourseAssets(courseId);
        if (!active) return;
        failures = 0;
        setAssets(next);
        setSelectedAssetIds((current) => new Set([...current].filter((id) => next.some((asset) => asset.id === id && asset.parseStatus === 'completed'))));
        const parsing = next.some((asset) => (
          asset.parseStatus === 'pending'
          || asset.parseStatus === 'processing'
          || asset.parseStatus === 'finalizing'
        ));
        const deleting = next.some((asset) => asset.parseStatus === 'deleting');
        if (deleting) {
          deletingSince ||= Date.now();
          deletingPolls += 1;
        } else {
          deletingSince = 0;
          deletingPolls = 0;
        }
        if (parsing) {
          timer = window.setTimeout(() => void refresh(), 2_000);
        } else if (deleting && Date.now() - deletingSince < DELETE_POLL_TIMEOUT_MS) {
          timer = window.setTimeout(() => void refresh(), retryDelay(deletingPolls));
        } else if (deleting) {
          setNotice('资料删除收尾超过预期，请稍后点击删除图标重试。');
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
  }, [authUser, courseId, assetRefreshToken]);

  useEffect(() => {
    workspaceGenerationRef.current += 1;
    setUploading(null);
    setCreatingCourse(false);
    setSaving(false);
    setPublishing(false);
    setDiscarding(false);
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
  }, [authUser, courseId]);

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
  }, [activeJobId, activeJobStatus, authUser]);

  const makeCourse = async () => {
    if (creatingCourse || !newCourseTitle.trim()) return;
    setCreatingCourse(true);
    setNotice('');
    const ownerAtRequest = authUser;
    const generationAtRequest = workspaceGenerationRef.current;
    try {
      const course = await createCustomCourse(newCourseTitle);
      if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest)) return;
      setNewCourseTitle('');
      setAssets([]);
      setSelectedAssetIds(new Set());
      await refreshCourses(course.id);
    } catch (error) {
      if (workspaceIsCurrent(ownerAtRequest, generationAtRequest)) setNotice(errorHint(error));
    } finally {
      if (workspaceIsCurrent(ownerAtRequest, generationAtRequest)) setCreatingCourse(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!courseId || maxFileBytes < 1 || files.length === 0 || uploading) return;
    const usable = files.filter((file) => file.size > 0 && file.size <= maxFileBytes);
    const ownerAtRequest = authUser;
    const generationAtRequest = workspaceGenerationRef.current;
    const courseAtRequest = courseId;
    if (usable.length !== files.length) {
      setNotice(`已跳过空文件或超过 ${fileSize(maxFileBytes)} 的资料。`);
    }
    for (const [index, file] of usable.entries()) {
      setUploading({ name: file.name, index: index + 1, total: usable.length });
      try {
        const asset = await uploadCourseAsset(courseAtRequest, file, assetRole);
        if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) break;
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      } catch (error) {
        if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) break;
        setNotice(`${file.name}：${errorHint(error, maxFileBytes)}`);
      }
    }
    if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) return;
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

  const reparseAsset = async (assetId: string) => {
    const ownerAtRequest = authUser;
    const generationAtRequest = workspaceGenerationRef.current;
    const courseAtRequest = courseId;
    try {
      const next = await reparseCustomAsset(assetId);
      if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) return;
      setAssets((current) => current.map((item) => item.id === next.id ? next : item));
      setAssetRefreshToken((value) => value + 1);
    } catch (error) {
      if (workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) setNotice(errorHint(error));
    }
  };

  const removeAsset = async (assetId: string) => {
    const ownerAtRequest = authUser;
    const generationAtRequest = workspaceGenerationRef.current;
    const courseAtRequest = courseId;
    try {
      await deleteCustomAsset(assetId);
      if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) return;
      setAssets((current) => current.filter((item) => item.id !== assetId));
      setDeleteArmedId(null);
    } catch (error) {
      if (!workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) return;
      setNotice(errorHint(error));
      setDeleteArmedId(null);
    }
  };

  const beginCompile = async () => {
    if (!courseId || recoveringJob || selectedReadyAssets.length === 0 || job?.status === 'queued' || job?.status === 'running' || job?.status === 'needs_review') return;
    setNotice('');
    setDraftRecord(null);
    setPublishedTopicId(null);
    setDiscardArmed(false);
    const ownerAtRequest = authUser;
    const generationAtRequest = workspaceGenerationRef.current;
    const courseAtRequest = courseId;
    try {
      const nextJob = await startTopicCompile({
        courseId,
        assetIds: selectedReadyAssets.map((asset) => asset.id),
        ...(topicTitle.trim() ? { title: topicTitle.trim() } : {}),
      });
      if (workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) setJob(nextJob);
    } catch (error) {
      if (workspaceIsCurrent(ownerAtRequest, generationAtRequest, courseAtRequest)) setNotice(errorHint(error));
    }
  };

  const saveDraft = async (): Promise<CustomTopicRecord | null> => {
    if (!draftRecord || saving) return null;
    const draftId = draftRecord.id;
    const courseAtSave = courseId;
    const ownerAtSave = authUser;
    const generationAtSave = workspaceGenerationRef.current;
    setSaving(true);
    setNotice('');
    try {
      const saved = await saveTopicDraft(draftRecord.id, draftRecord.payload);
      if (!workspaceIsCurrent(ownerAtSave, generationAtSave, courseAtSave)) return null;
      setDraftRecord((current) => current?.id === draftId ? saved : current);
      return saved;
    } catch (error) {
      if (workspaceIsCurrent(ownerAtSave, generationAtSave, courseAtSave)) setNotice(errorHint(error));
      return null;
    } finally {
      if (workspaceIsCurrent(ownerAtSave, generationAtSave, courseAtSave)) setSaving(false);
    }
  };

  const publish = async () => {
    if (!draftRecord || publishing) return;
    const courseAtPublish = courseId;
    const ownerAtPublish = authUser;
    const generationAtPublish = workspaceGenerationRef.current;
    setPublishing(true);
    setNotice('');
    try {
      const saved = await saveTopicDraft(draftRecord.id, draftRecord.payload);
      if (!workspaceIsCurrent(ownerAtPublish, generationAtPublish, courseAtPublish)) return;
      setDraftRecord(saved);
      if (announceBlocking(saved)) return;
      const published = await publishCustomTopic(saved.id);
      if (!workspaceIsCurrent(ownerAtPublish, generationAtPublish, courseAtPublish)) return;
      setPublishedTopicId(published.topicId);
      setDraftRecord({ ...published, payload: published.payload });
      setJob((current) => current ? { ...current, status: 'done' } : current);
      await Promise.all([refreshRuntimeTopics(true), refreshCourses(courseId)]);
    } catch (error) {
      if (!workspaceIsCurrent(ownerAtPublish, generationAtPublish, courseAtPublish)) return;
      if (error instanceof Error && error.message === 'topic-quality-gate-failed') {
        // 服务端发布前会重新找出处再校验一遍,可能拦下浏览器里没看到的条目:再存一次取回清单,跳到第一处
        try {
          const refreshed = await saveTopicDraft(draftRecord.id, draftRecord.payload);
          if (!workspaceIsCurrent(ownerAtPublish, generationAtPublish, courseAtPublish)) return;
          setDraftRecord(refreshed);
          if (announceBlocking(refreshed)) return;
        } catch {
          // 取回失败就退回通用提示
        }
      }
      setNotice(errorHint(error));
    } finally {
      if (workspaceIsCurrent(ownerAtPublish, generationAtPublish, courseAtPublish)) setPublishing(false);
    }
  };

  /** 没过闸:把「还有几处、第一处在哪」写进提示,并跳到第一处让老师直接改。返回是否被拦下。 */
  const announceBlocking = (record: CustomTopicRecord): boolean => {
    const blocking = record.qualityIssues.filter((issue) => issue.level === 'error');
    if (blocking.length === 0) return false;
    const [first] = blocking;
    skipNoticeScrollRef.current = true;
    setNotice(`草稿已保存，但还有 ${blocking.length} 处要改才能发布。已跳到第一处：${describeIssue(first, record.payload)}——${first.message}${blocking.length > 1 ? '；其余见「发布前校验」清单，点任一条即可跳过去。' : '。'}`);
    // 等发布态解除、编辑区脱离 inert 后再聚焦
    window.setTimeout(() => jumpToDraftPath(first.path), 60);
    return true;
  };

  const discardDraft = async () => {
    if (!draftRecord || !discardArmed || discarding || draftRecord.status !== 'draft') return;
    const draftId = draftRecord.id;
    const courseAtDiscard = courseId;
    const ownerAtDiscard = authUser;
    const generationAtDiscard = workspaceGenerationRef.current;
    setDiscarding(true);
    setNotice('');
    try {
      await discardTopicDraft(draftId);
      if (!workspaceIsCurrent(ownerAtDiscard, generationAtDiscard, courseAtDiscard)) return;
      setDraftRecord((current) => current?.id === draftId ? null : current);
      setJob((current) => current?.topicId === draftId || current?.topic?.id === draftId ? null : current);
      setPublishedTopicId(null);
      setDiscardArmed(false);
      setNotice('这份草稿已放回废稿篓，可以重新选择资料生成。');
    } catch (error) {
      if (workspaceIsCurrent(ownerAtDiscard, generationAtDiscard, courseAtDiscard)) setNotice(errorHint(error));
    } finally {
      if (workspaceIsCurrent(ownerAtDiscard, generationAtDiscard, courseAtDiscard)) setDiscarding(false);
    }
  };

  const workspaceMatchesOwner = workspaceOwner === authUser;
  const visibleService = workspaceMatchesOwner ? service : 'checking';
  const visibleNotice = workspaceMatchesOwner ? notice : '';
  // 提示条在页首、发布钮在页尾:失败提示若落在视口外,老师只看到按钮「没反应」——不在视口内就滚到眼前
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const skipNoticeScrollRef = useRef(false);
  useEffect(() => {
    const el = noticeRef.current;
    if (!visibleNotice || !el) return;
    // 已经跳到具体字段的场景(没过闸)不再把视口拉回页首
    if (skipNoticeScrollRef.current) {
      skipNoticeScrollRef.current = false;
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    revealElement(el);
  }, [visibleNotice]);
  const focusNewCourse = () => document.getElementById('new-course')?.focus();

  // 三步流程票签的活态:资料入库 → 编成课题 → 校订发布,按当前工作台状态点亮
  const hasReadyAssets = assets.some((asset) => asset.parseStatus === 'completed');
  const step1: 'done' | 'now' | 'todo' = hasReadyAssets ? 'done' : 'now';
  const compiledOnce = Boolean(draftRecord) || job?.status === 'done' || job?.status === 'needs_review';
  const step2: 'done' | 'now' | 'todo' = compiledOnce ? 'done' : hasReadyAssets ? 'now' : 'todo';
  const step3: 'done' | 'now' | 'todo' = publishedTopicId ? 'done' : draftRecord ? 'now' : 'todo';

  return (
    <div className={s.page}>
      <header id="custom-overview" className={`${s.head} ${s.rise}`}>
        <h1 className={sec.titleLg}>自选课</h1>
        <p className={sec.note}>把自己的讲义交给小白：上传课件，编出要点、误区与备课包，校订后就能在书斋里开讲。课件只用来拆页、分块与找出处，小白照旧按备课、追问、误区与赴考的流程上课。</p>
        <ol className={s.steps} aria-label="自定义课程三步流程">
          <li data-state={step1}>资料入库<small>PDF、PPT 或 Markdown</small></li>
          <li data-state={step2}>编成课题<small>要点、误区、备课包</small></li>
          <li data-state={step3}>校订发布<small>回到书斋开讲</small></li>
        </ol>
      </header>

      {visibleNotice ? <p ref={noticeRef} className={s.notice} role="status"><Icon name="circle-help" size={16} />{visibleNotice}</p> : null}
      {visibleService !== 'ready' ? (
        <section className={`${s.unavailable} ${s.rise}`} role="status" style={{ animationDelay: '90ms' }}>
          <h2>{visibleService === 'checking' ? '正在连接资料服务…' : '资料服务暂时没有应答'}</h2>
          <p>{visibleService === 'unavailable' ? '服务器还没有启用自定义课程服务。现有课程与学习记录不受影响。' : '可以稍后再试；现有课程仍可照常学习。'}</p>
          {visibleService !== 'checking' ? <button className={s.btnGhost} type="button" onClick={() => setBootstrapToken((value) => value + 1)}>重新连接资料服务</button> : null}
        </section>
      ) : (
        <div className={`${s.workspace} ${s.rise}`} style={{ animationDelay: '90ms' }}>
          <aside className={s.aside} aria-label="自定义课程">
            <h2 className={s.asideTitle}>课程</h2>
            <div className={s.courseList}>
              {courses.map((course) => (
                <button key={course.id} type="button" className={`${s.courseRow}${course.id === courseId ? ` ${s.courseActive}` : ''}`} aria-current={course.id === courseId ? 'true' : undefined} disabled={Boolean(uploading) || creatingCourse || saving || publishing || discarding} onClick={() => { setCourseId(course.id); setAssets([]); setSelectedAssetIds(new Set()); setDeleteArmedId(null); setJob(null); setDraftRecord(null); setPublishedTopicId(null); setDiscardArmed(false); }}>
                  <p><strong>{course.title}</strong><small>{course.assetCount} 份资料 · {course.topicCount} 个课题</small></p>
                  <Icon name="chevron-right" size={15} />
                </button>
              ))}
              {courses.length === 0 ? <p className={s.emptyIndex}>还没有课程，先在下面写一个课程名。</p> : null}
            </div>
            <form className={s.newCourse} onSubmit={(event) => { event.preventDefault(); void makeCourse(); }}>
              <label htmlFor="new-course">新课程</label>
              <input id="new-course" className={s.field} value={newCourseTitle} maxLength={120} onChange={(event) => setNewCourseTitle(event.target.value)} placeholder="课程名，例如：数据结构" />
              <button className={s.btnGhost} type="submit" disabled={creatingCourse || newCourseTitle.trim().length < 2}>{creatingCourse ? '新建中…' : '新建课程'}</button>
            </form>
          </aside>

          <main className={s.main}>
            <section id="custom-assets" className={s.section}>
              <header className={sec.head}>
                <h2 className={sec.title}>{selectedCourse ? `《${selectedCourse.title}》的资料` : '资料'}</h2>
                <p className={sec.note}>{selectedCourse ? `讲义、课件、大纲都收在这门课里；单份不超过 ${fileSize(maxFileBytes)}，原文件加密保存。` : '每门课有自己的资料库，讲义、课件与大纲都收在一起。'}</p>
              </header>
              {selectedCourse ? (
                <>
                  <div
                    className={`${s.stage} ${s.drop}${dragging ? ` ${s.dropActive}` : ''}`}
                    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
                    onDrop={onDrop}
                  >
                    <div>
                      <strong>{uploading ? `正在上传 ${uploading.name}（${uploading.index}/${uploading.total}）` : '把讲义拖到这里，或选择文件'}</strong>
                      <span>支持 PDF、PPT、DOCX、Markdown 与 TXT，一次可以选多份。</span>
                    </div>
                    <div className={s.dropActions}>
                      <label className={s.roleSelect}>作为<select value={assetRole} onChange={(event) => setAssetRole(event.target.value as AssetRole)}>{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <button className={s.btn} type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading) || maxFileBytes < 1}>选择文件</button>
                    </div>
                    <input ref={fileInputRef} type="file" accept={ACCEPT} multiple onChange={onFiles} tabIndex={-1} aria-hidden="true" />
                  </div>

                  {assets.length > 0 ? (
                    <div className={s.assetList} aria-live="polite">
                      {assets.map((asset, index) => {
                        const ready = asset.parseStatus === 'completed';
                        const lockedByJob = Boolean(
                          job
                          && (job.status === 'queued' || job.status === 'running' || job.status === 'needs_review')
                          && job.assetIds.includes(asset.id),
                        );
                        return (
                          <article key={asset.id} className={s.assetRow} style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
                            <label className={s.assetPick}>
                              <input type="checkbox" checked={selectedAssetIds.has(asset.id)} disabled={!ready} onChange={() => toggleAsset(asset.id)} aria-label={`选用 ${asset.filename}`} />
                              <span aria-hidden="true">{selectedAssetIds.has(asset.id) ? <Icon name="check" size={13} /> : null}</span>
                            </label>
                            <div className={s.assetName}><strong>{asset.filename}</strong><small>{ROLE_LABEL[asset.assetRole]} · {fileSize(asset.byteSize)}</small></div>
                            <span className={s.assetStatus} data-state={asset.parseStatus}>{STATUS_LABEL[asset.parseStatus]}</span>
                            <span className={s.assetActions}>
                              {asset.parseStatus === 'failed' || asset.parseStatus === 'cancelled' ? <button className={s.btnText} type="button" onClick={() => void reparseAsset(asset.id)}>重新解析</button> : null}
                              {deleteArmedId === asset.id && !lockedByJob ? (
                                <span className={s.confirmPair}>
                                  <button className={`${s.btnText} ${s.btnDanger}`} type="button" onClick={() => void removeAsset(asset.id)}>确认删除</button>
                                  <button className={`${s.btnText} ${s.btnQuiet}`} type="button" onClick={() => setDeleteArmedId(null)}>保留</button>
                                </span>
                              ) : (
                                <button className={`${s.btnText} ${s.btnQuiet}`} type="button" title={lockedByJob ? '这份资料正在被未完成的草稿使用' : undefined} disabled={lockedByJob} onClick={() => setDeleteArmedId(asset.id)}>删除</button>
                              )}
                            </span>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={s.emptyText}>资料还是空的。先放一份讲义，小白才知道这门课要讲什么。</p>
                  )}
                </>
              ) : (
                <div className={s.noCourse}>
                  <strong>书架上还没有自选课</strong>
                  <p>先在左侧写下课程名，讲义、课件与大纲都会收进同一门课里。</p>
                  <button className={s.btnGhost} type="button" onClick={focusNewCourse}>去写课程名</button>
                </div>
              )}
            </section>

            <section id="custom-compiler" className={s.section}>
              <header className={sec.head}>
                <h2 className={sec.title}>课题</h2>
                <p className={sec.note}>小砚会从勾选的资料里编出讲解要点、小白会想岔的地方、随堂题与备课包，每一条都指回课件出处；编好的草稿要经你校订才发布。</p>
              </header>
              {selectedCourse ? (
                <div className={s.compileRow}>
                  <label><span>课题名<small>　可留空，由小砚拟题</small></span><input className={s.field} value={topicTitle} maxLength={160} onChange={(event) => setTopicTitle(event.target.value)} placeholder="例如：栈与函数调用" /></label>
                  <button className={s.btn} type="button" onClick={() => void beginCompile()} disabled={!courseId || recoveringJob || selectedReadyAssets.length === 0 || job?.status === 'queued' || job?.status === 'running' || job?.status === 'needs_review'}>{recoveringJob ? '正在找回草稿…' : '生成课题草稿'}</button>
                  <p className={s.compileMeta}>已选 <strong>{selectedReadyAssets.length}</strong> 份已入库的资料{!hasReadyAssets ? '，先在上面勾选已入库的讲义' : ''}</p>
                </div>
              ) : (
                <p className={s.emptyLine}>先建一门课程、放一份讲义，这里才会亮起来。</p>
              )}

              {job ? (
                <div className={`${s.jobRow}${job.status === 'failed' ? ` ${s.jobFailed}` : ''}`} role="status">
                  <span>{job.status === 'running' || job.status === 'queued' ? <span className={s.jobDot} /> : <Icon name={job.status === 'failed' ? 'circle-x' : 'circle-check'} size={17} />}</span>
                  <p><strong>{JOB_LABEL[job.status]}</strong><small>{job.status === 'running' ? '正在读取分块、生成要点并逐条核对出处。' : job.status === 'failed' ? errorHint(new Error(job.errorCode ?? '')) : '草稿不会自动发布，要经你校订。'}</small></p>
                </div>
              ) : null}

              {draftRecord ? (
                <div className={s.review}>
                  <aside className={s.gate} aria-label="发布前校验">
                    <div className={s.gateHead}><h3>发布前校验</h3><p className={s.gateNote}>保存时会重新读取课件分块核对出处，不能在浏览器里伪造。点任一条可跳到那一处修改。</p></div>
                    <Issues issues={draftRecord.qualityIssues} draft={draftRecord.payload} onJump={jumpToDraftPath} />
                  </aside>
                  <div className={s.reviewMain}>
                    <DraftEditor disabled={saving || publishing || discarding} record={draftRecord} onError={(error) => setNotice(errorHint(error))} onChange={(payload) => setDraftRecord((current) => current ? { ...current, payload } : current)} />
                    <footer className={s.actions}>
                      {draftRecord.status === 'draft' ? discardArmed ? (
                        <span className={s.actionsLead}>
                          <button className={`${s.btnText} ${s.btnDanger}`} type="button" onClick={() => void discardDraft()} disabled={saving || publishing || discarding}>{discarding ? '正在放弃…' : '确认放弃'}</button>
                          <button className={`${s.btnText} ${s.btnQuiet}`} type="button" onClick={() => setDiscardArmed(false)} disabled={discarding}>保留草稿</button>
                        </span>
                      ) : <span className={s.actionsLead}><button className={`${s.btnText} ${s.btnDanger}`} type="button" onClick={() => setDiscardArmed(true)} disabled={saving || publishing}>放弃这份草稿</button></span> : null}
                      <button className={s.btnGhost} type="button" onClick={() => void saveDraft()} disabled={saving || publishing || draftRecord.status !== 'draft'}>{saving ? '正在核对出处…' : '保存校订'}</button>
                      <button className={s.btn} type="button" onClick={() => void publish()} disabled={saving || publishing || draftRecord.status !== 'draft'}>{publishing ? '发布中…' : '发布到书架'} <Icon name="arrow-right" size={16} /></button>
                    </footer>
                    {publishedTopicId ? <p className={s.published}><Icon name="circle-check" size={17} />课题已经上架。<Link to={`/prep/${publishedTopicId}`}>去备这门新课 <Icon name="arrow-right" size={15} /></Link></p> : null}
                  </div>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      )}
    </div>
  );
}
