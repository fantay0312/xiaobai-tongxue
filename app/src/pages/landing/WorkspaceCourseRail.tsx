import { Icon } from '../../components/ui/Icon';
import { DEMO, LEARNING_STAGES } from './landingData';
import s from './LearningWorkspace.module.css';

interface WorkspaceCourseRailProps {
  activeIndex: number;
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

function StageArtifact({ activeIndex }: WorkspaceCourseRailProps) {
  const stage = LEARNING_STAGES[activeIndex] ?? LEARNING_STAGES[0];
  return (
    <section className={s.railSection}>
      <h3>本轮会留下什么</h3>
      <div className={s.artifactTicket}>
        <span>{stage.step} · {stage.title}</span>
        <strong>{stage.artifact}</strong>
      </div>
    </section>
  );
}

export function WorkspaceCourseRail(props: WorkspaceCourseRailProps) {
  return (
    <aside className={s.courseRail} aria-label="课程和步骤">
      <div className={s.courseTicket}>
        <span>课程</span>
        <strong>{DEMO.course}</strong>
        <small>{DEMO.title}</small>
      </div>
      <CourseOutline activeIndex={props.activeIndex} />
      <StageArtifact activeIndex={props.activeIndex} />
    </aside>
  );
}
