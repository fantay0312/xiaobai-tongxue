import { Link } from 'react-router';
import { Icon, type IconName } from '../../components/ui/Icon';
import { COURSE_COVERS } from '../../data/courseCovers';
import { COURSE_SUMMARIES, DEMO } from './landingData';
import s from './CourseArchive.module.css';

const TIMELINE: readonly {
  id: string;
  stage: string;
  title: string;
  note: string;
  icon: IconName;
}[] = [
  {
    id: '01',
    stage: '开始讲解',
    title: `开讲「${DEMO.title}」`,
    note: '教学事件记录这次命中了哪些要点。',
    icon: 'book-open',
  },
  {
    id: '02',
    stage: '随堂测验',
    title: '小白独自完成五道题',
    note: '分数和每题稳、未稳的结果一起留下。',
    icon: 'route',
  },
  {
    id: '03',
    stage: '课后批注',
    title: '找出小白还没懂的地方',
    note: '五维讲解画像、盲区和教学事件放在一页看。',
    icon: 'pen',
  },
  {
    id: '04',
    stage: '补学重讲',
    title: '补一小段，再回讲台验证',
    note: '纠正、出师和之后的复习会继续写进成长册。',
    icon: 'sprout',
  },
];

/** 宣传页课程档案：一侧是课程书脊，一侧是从一堂课开始的成长时间线。 */
export function CourseArchive() {
  return (
    <section className={s.section} aria-labelledby="course-archive-title">
      <div className={s.shelfPane}>
        <header className={s.heading}>
          <div>
            <p className={s.kicker}>课程书架</p>
            <h2 id="course-archive-title">3 门课程，38 个知识点已经开放</h2>
          </div>
          <Link className={s.textLink} to="/study">
            去课程书架
            <Icon name="arrow-right" size={16} />
          </Link>
        </header>

        <div className={s.shelf} aria-label="课程书架">
          <div className={s.volumes}>
            {COURSE_SUMMARIES.map((course, index) => (
              <Link
                className={`${s.volume} ${s[`volumeTone${index % 4}`]}`}
                key={course.id}
                to="/study"
                aria-label={`进入《${course.course}》课程，共 ${course.topicCount} 个知识点`}
              >
                <img
                  className={s.volumeArt}
                  src={COURSE_COVERS[course.course].src}
                  alt=""
                  width={512}
                  height={768}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  aria-hidden="true"
                />
                <span className={s.volumeEyebrow}>{course.eyebrow}</span>
                <strong>{course.course}</strong>
                <span className={s.volumeMeta}>共 {course.topicCount} 个知识点</span>
                <span className={s.volumeFoot}>
                  {course.teachableCount} 个已开放
                </span>
              </Link>
            ))}
          </div>
          <span className={s.woodRail} aria-hidden="true" />
        </div>

        <div className={s.catalog}>
          {COURSE_SUMMARIES.map((course) => (
            <article className={s.catalogRow} key={course.id}>
              <div>
                <p className={s.catalogTitle}>《{course.course}》</p>
                <p className={s.catalogDesc}>{course.description}</p>
              </div>
              <p className={s.catalogTopics}>
                {course.sampleTopics.slice(0, 3).join(' · ')}
              </p>
            </article>
          ))}
        </div>
      </div>

      <aside className={s.timelinePane} aria-labelledby="growth-timeline-title">
        <header className={s.timelineHead}>
          <p className={s.kicker}>成长册</p>
          <h3 id="growth-timeline-title">讲完一课，后来都记在哪儿</h3>
        </header>
        <ol className={s.timeline}>
          {TIMELINE.map((item) => (
            <li key={item.id}>
              <span className={s.timelineMark} aria-hidden="true">
                <Icon name={item.icon} size={16} />
              </span>
              <div className={s.timelineCopy}>
                <p className={s.timelineStage}>{item.id} · {item.stage}</p>
                <h4>{item.title}</h4>
                <p>{item.note}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link className={s.primaryLink} to="/study">
          去课程书架，选一个知识点
          <Icon name="arrow-right" size={17} />
        </Link>
      </aside>
    </section>
  );
}

export default CourseArchive;
