import { useCallback, useMemo, useState } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { ArrowUpRight, ChevronDown, FileText, LayoutGrid, Library } from 'lucide-react';
import { learningUiText, type LearningInteraction, type LearningUi } from '../../../../server/shared/learning-ui.mjs';
import type { StudySource } from '../../engine/studyWorkspace';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Button } from '../../components/ui';
import { AnswerContext, type AnswerContextValue } from './genui/context';
import { isRenderable, learningUiLibrary, learningUiProgram } from './genui/library';
import styles from './intelligent.module.css';

export function LearningSources({ sources, onSource }: { sources: StudySource[]; onSource: (source: StudySource) => void }) {
  return (
    <details className={styles.sourceList}>
      <summary>
        <Library size={14} strokeWidth={1.75} />
        <span>{sources.length} 处来源</span>
        <ChevronDown size={13} strokeWidth={1.75} className={styles.sourceChevron} />
      </summary>
      <div>
        {sources.map((source, index) => (
          <button key={source.id} type="button" onClick={() => onSource(source)}>
            <span>{index + 1}</span>
            {source.title}
          </button>
        ))}
      </div>
    </details>
  );
}

export function IntelligentAnswer({ ui, sources, interaction, onChange, onAsk, onSource, onSave }: {
  ui: LearningUi;
  sources: StudySource[];
  interaction: LearningInteraction;
  onChange: AnswerContextValue['onChange'];
  onAsk: AnswerContextValue['onAsk'];
  onSource: AnswerContextValue['onSource'];
  onSave: AnswerContextValue['onSave'];
}) {
  const [plain, setPlain] = useState(false);
  const [rendererError, setRendererError] = useState(false);
  const program = useMemo(() => learningUiProgram(ui), [ui]);
  const valid = useMemo(() => isRenderable(program), [program]);
  const onError = useCallback((errors: { severity?: string }[]) => {
    if (errors.some((error) => error.severity !== 'warning')) setRendererError(true);
  }, []);
  const context = useMemo(() => ({ sources, interaction, onChange, onAsk, onSource, onSave }), [sources, interaction, onChange, onAsk, onSource, onSave]);
  const broken = !valid || rendererError;
  const hasBlocks = ui.blocks.length > 0;

  return (
    <AnswerContext.Provider value={context}>
      <div className={styles.answer}>
        <div className={styles.summary}>
          <CoachMarkdown text={plain || (broken && hasBlocks) ? learningUiText(ui) : ui.summary} />
        </div>
        {!plain && !broken && hasBlocks && <Renderer response={program} library={learningUiLibrary} onError={onError} publishObservability={false} />}
        {!plain && broken && hasBlocks && <p className={styles.notice} role="status">互动内容暂时无法显示，上面是完整的文字版本。</p>}
        {hasBlocks && !broken && (
          <div className={styles.answerFooter}>
            <Button
              size="sm"
              variant="ghost"
              icon={plain ? <LayoutGrid size={14} strokeWidth={1.75} /> : <FileText size={14} strokeWidth={1.75} />}
              aria-pressed={plain}
              onClick={() => setPlain(!plain)}
            >
              {plain ? '显示互动内容' : '显示纯文字'}
            </Button>
          </div>
        )}
        {ui.followUps.length > 0 && (
          <div className={styles.followUps} role="group" aria-label="继续探索">
            {ui.followUps.map((question, index) => (
              <button key={index} type="button" className={styles.followUp} onClick={() => onAsk(question)}>
                <span>{question}</span>
                <ArrowUpRight size={14} strokeWidth={1.75} />
              </button>
            ))}
          </div>
        )}
      </div>
    </AnswerContext.Provider>
  );
}
