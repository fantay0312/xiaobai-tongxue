import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import { COURSE_COVERS } from '../../data/courseCovers';
import { COURSE_SUMMARIES, LANDING_METRICS } from './landingData';
import landing from './landing.module.css';
import s from './CourseArchive.module.css';

const courseCount = LANDING_METRICS.find((metric) => metric.id === 'courses')?.value ?? '';
const topicCount =
  LANDING_METRICS.find((metric) => metric.id === 'teachable-topics')?.value ?? '';

function availability(course: (typeof COURSE_SUMMARIES)[number]): string {
  if (course.teachableCount === course.topicCount) return `${course.topicCount} 个知识点`;
  return `${course.teachableCount} / ${course.topicCount} 个知识点已开放`;
}

/** 课程：三张封面卡，整卡可点进书架。 */
export function CourseArchive() {
  return (
    <section className={s.section} aria-labelledby="course-archive-title">
      <header className={`${landing.sectionHead} ${s.heading}`} data-landing-reveal>
        <h2 id="course-archive-title" className={landing.sectionTitle}>
          {courseCount} 门课程，{topicCount} 个知识点
        </h2>
        <Link className={s.textLink} to="/study">
          去课程书架
          <Icon name="arrow-right" size={16} />
        </Link>
      </header>

      <ul className={s.grid}>
        {COURSE_SUMMARIES.map((course, index) => (
          <li key={course.id} data-landing-reveal data-reveal-order={index}>
            <Link
              className={s.card}
              to="/study"
              aria-label={`进入《${course.course}》，${availability(course)}`}
            >
              <span className={s.cover}>
                <img
                  src={COURSE_COVERS[course.course].src}
                  alt=""
                  width={512}
                  height={768}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </span>
              <span className={s.body}>
                <strong>{course.course}</strong>
                <span className={s.meta}>{availability(course)}</span>
                <span className={s.topics}>{course.sampleTopics.join(' · ')}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default CourseArchive;
