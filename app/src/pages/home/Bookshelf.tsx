/**
 * 知识点书架 —— 分学科书脊式立列(不是卡片网格)。
 * TOPICS 按 topic.course 分组,数组顺序即陈列顺序;每门课一格书架,书立在木色搁板上。
 * mastery 染色:黛绿出师 / 藤黄待复习 / 墨青学习中 / 灰未学;locked 压暗标「未开放」。
 * 点击:locked 不可点;备课完成或有进度 → /teach/:topicId,否则 → /prep/:topicId。
 */
import { useNavigate } from 'react-router-dom';
import { TOPICS } from '../../data';
import { useAppStore } from '../../store/appStore';
import type { Topic, TopicState } from '../../types';
import styles from './shelf.module.css';

type SpineStatus = 'mastered' | 'review' | 'learning' | 'fresh' | 'locked';

const STATUS_LABEL: Record<SpineStatus, string> = {
  mastered: '出师',
  review: '待复习',
  learning: '学习中',
  fresh: '未学',
  locked: '未开放',
};

function spineStatus(topic: Topic, st: TopicState | undefined): SpineStatus {
  if (topic.locked) return 'locked';
  if (!st) return 'fresh';
  if (st.forgotten || (st.reviewDue !== null && Date.parse(st.reviewDue) <= Date.now())) {
    return 'review';
  }
  if (st.knowledgeState === '出师') return 'mastered';
  if (st.prepDone || st.hitChecklist.length > 0 || st.mastery > 0 || st.knowledgeState !== '没懂') {
    return 'learning';
  }
  return 'fresh';
}

function hasProgress(st: TopicState | undefined): boolean {
  return !!st && (st.prepDone || st.hitChecklist.length > 0 || st.mastery > 0);
}

/** 按 course 分组,保持 TOPICS 数组顺序(首次出现的课程排前) */
function groupByCourse(topics: Topic[]): { course: string; topics: Topic[] }[] {
  const groups: { course: string; topics: Topic[] }[] = [];
  for (const t of topics) {
    const g = groups.find((x) => x.course === t.course);
    if (g) g.topics.push(t);
    else groups.push({ course: t.course, topics: [t] });
  }
  return groups;
}

export function Bookshelf() {
  const navigate = useNavigate();
  const topicStates = useAppStore((s) => s.topicStates);

  const openTopic = (topic: Topic) => {
    if (topic.locked) return;
    const st = topicStates[topic.topicId];
    navigate(hasProgress(st) ? `/teach/${topic.topicId}` : `/prep/${topic.topicId}`);
  };

  const courses = groupByCourse(TOPICS);
  let stagger = 0; // 全架统一的入场序号,跨课程连续错落

  return (
    <section id="shelf" className={styles.shelf} aria-label="知识点书架">
      <header className={styles.head}>
        <h2 className={styles.title}>知识点书架</h2>
        <p className={styles.sub}>挑一本,讲给小白听</p>
      </header>

      <div className={styles.shelves}>
        {courses.map(({ course, topics }) => {
          const mastered = topics.filter(
            (t) => spineStatus(t, topicStates[t.topicId]) === 'mastered',
          ).length;
          return (
            <div key={course} className={styles.course}>
              <div className={styles.courseHead}>
                <h3 className={styles.courseName}>《{course}》</h3>
                <span className={styles.courseNote}>出师 {mastered}/{topics.length}</span>
              </div>

              <div className={styles.shelfUnit}>
                <div className={styles.row}>
                  {topics.map((topic) => {
                    const status = spineStatus(topic, topicStates[topic.topicId]);
                    const delay = 320 + stagger++ * 70;
                    return (
                      <button
                        key={topic.topicId}
                        type="button"
                        className={`${styles.spine} ${styles[status]}`}
                        style={{ animationDelay: `${delay}ms` }}
                        disabled={topic.locked}
                        onClick={() => openTopic(topic)}
                        title={topic.locked ? `${topic.title}(未开放)` : topic.tagline}
                      >
                        <span className={styles.band} aria-hidden="true" />
                        <span className={styles.spineTitle}>{topic.title}</span>
                        <span className={styles.status}>{STATUS_LABEL[status]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className={styles.rail} aria-hidden="true" />
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.legend} aria-hidden="true">
        <span className={`${styles.dot} ${styles.dotJade}`} />出师
        <span className={`${styles.dot} ${styles.dotAmber}`} />待复习
        <span className={`${styles.dot} ${styles.dotAzure}`} />学习中
        <span className={`${styles.dot} ${styles.dotDust}`} />未学
      </p>
    </section>
  );
}
