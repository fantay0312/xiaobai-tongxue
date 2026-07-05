/**
 * 知识点书架 —— 书脊式立列(不是卡片网格)。
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

export function Bookshelf() {
  const navigate = useNavigate();
  const topicStates = useAppStore((s) => s.topicStates);

  const openTopic = (topic: Topic) => {
    if (topic.locked) return;
    const st = topicStates[topic.topicId];
    navigate(hasProgress(st) ? `/teach/${topic.topicId}` : `/prep/${topic.topicId}`);
  };

  return (
    <section id="shelf" className={styles.shelf} aria-label="知识点书架">
      <header className={styles.head}>
        <h2 className={styles.title}>知识点书架</h2>
        <p className={styles.sub}>《Python 程序设计》 · 挑一本,讲给小白听</p>
      </header>

      <div className={styles.row}>
        {TOPICS.map((topic, i) => {
          const status = spineStatus(topic, topicStates[topic.topicId]);
          return (
            <button
              key={topic.topicId}
              type="button"
              className={`${styles.spine} ${styles[status]}`}
              style={{ animationDelay: `${320 + i * 70}ms` }}
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

      <p className={styles.legend} aria-hidden="true">
        <span className={`${styles.dot} ${styles.dotJade}`} />出师
        <span className={`${styles.dot} ${styles.dotAmber}`} />待复习
        <span className={`${styles.dot} ${styles.dotAzure}`} />学习中
        <span className={`${styles.dot} ${styles.dotDust}`} />未学
      </p>
    </section>
  );
}
