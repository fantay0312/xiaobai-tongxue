import { Icon } from '../../components/ui/Icon';
import { DEMO, LEARNING_STAGES } from './landingData';
import s from './LearningWorkspace.module.css';

interface WorkspaceCourseRailProps {
  activeIndex: number;
  onStageSelect: (index: number) => void;
}

function CourseOutline({ activeIndex }: { activeIndex: number }) {
  const coveredCount = activeIndex === 0 ? 0 : 2;
  return (
    <section className={s.railSection}>
      <h3>本课要讲清的五点</h3>
      <ul className={s.outline}>
        {DEMO.outline.map((title, index) => {
          const done = index < coveredCount;
          return (
            <li className={done ? s.outlineDone : ''} key={title}>
              <span><small>{index + 1}</small>{title}</span>
              <Icon name={done ? 'check' : 'circle-help'} size={15} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StageProgress({ activeIndex, onStageSelect }: WorkspaceCourseRailProps) {
  return (
    <section className={s.railSection}>
      <h3>这堂课走到哪儿</h3>
      <ol className={s.progressList}>
        {LEARNING_STAGES.map((stage, index) => (
          <li key={stage.id}>
            <button
              className={index === activeIndex ? s.progressActive : ''}
              type="button"
              aria-current={index === activeIndex ? 'step' : undefined}
              onClick={() => onStageSelect(index)}
            >
              <span className={s.progressDot}>{stage.step}</span>
              <span>
                {stage.title}
                <small>{index < activeIndex ? '已看' : index === activeIndex ? '当前' : '未到'}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkspaceCourseRail(props: WorkspaceCourseRailProps) {
  return (
    <aside className={s.courseRail} aria-label="课程和步骤">
      <div className={s.courseTicket}>
        <span>演示课程</span>
        <strong>{DEMO.course}</strong>
        <small>{DEMO.title}</small>
      </div>
      <CourseOutline activeIndex={props.activeIndex} />
      <StageProgress {...props} />
    </aside>
  );
}
