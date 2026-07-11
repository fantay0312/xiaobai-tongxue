/**
 * 知识点书架 —— 两级书柜:函套排架(一门课一函) + 翻开的函(该课章节书脊)。
 * 函套按 TOPICS 首现顺序陈列在上层搁板,点函切换下方章节区(默认翻开第一函);
 * 章节区超过一层容量折成多层搁板,层尾一枚木书立,书高书宽按全架位次查错落表。
 * mastery 染色:黛绿出师 / 藤黄待复习 / 靛青学习中;未学素净不标字(图例代言),locked 压暗标「未开放」。
 * 点击章节:locked 不可点;备课完成或有进度 → /teach/:topicId,否则 → /prep/:topicId。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOPICS } from '../../data';
import { useAppStore } from '../../store/appStore';
import type { Topic, TopicState } from '../../types';
import styles from './shelf.module.css';

type SpineStatus = 'mastered' | 'review' | 'learning' | 'fresh' | 'locked';

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

/** 一层搁板最多摆几本;超出按层数均分(30 讲 = 15+15, 层层齐整),窄屏单层横滚兜底 */
const SHELF_CAP = 15;

function chunkEven<T>(list: T[], cap: number): T[][] {
  const rows = Math.ceil(list.length / cap);
  const size = Math.ceil(list.length / rows);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* 装帧错落表(rem):按全架位次取模,8/6 两周期错开,重复周期 24 本——
   多层书柜的相邻两层不会出现同一副"克隆装帧"(nth-child 方案在分层后会逐层复读) */
/* 书高下限 12rem:九字讲名(如「并发控制:条件变量」)在最矮的书上也要单列坐进题签 */
const SPINE_H = [12.5, 12, 12.875, 12.25, 13.25, 12.125, 12.625, 13];
const SPINE_W = [3.5, 3.75, 3.3125, 3.5625, 3.4375, 3.625];

/** 题签有效字数:CJK 记 1,拉丁/数字竖排侧转记 0.55——决定长讲名是否降字级保单列 */
function slipLen(title: string): number {
  return [...title].reduce((n, ch) => n + (/[　-鿿＀-￯]/.test(ch) ? 1 : 0.55), 0);
}

const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1-99 → 汉字讲数(函套书口的传统写法) */
function cnCount(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (tens === 0) return CN_DIGIT[ones];
  return `${tens > 1 ? CN_DIGIT[tens] : ''}十${ones ? CN_DIGIT[ones] : ''}`;
}

export function Bookshelf() {
  const navigate = useNavigate();
  const topicStates = useAppStore((s) => s.topicStates);

  const courses = groupByCourse(TOPICS);
  const [openCourse, setOpenCourse] = useState(courses[0]?.course ?? '');
  const current = courses.find((c) => c.course === openCourse) ?? courses[0];

  const openTopic = (topic: Topic) => {
    if (topic.locked) return;
    const st = topicStates[topic.topicId];
    navigate(hasProgress(st) ? `/teach/${topic.topicId}` : `/prep/${topic.topicId}`);
  };

  const masteredOf = (topics: Topic[]) =>
    topics.filter((t) => spineStatus(t, topicStates[t.topicId]) === 'mastered').length;

  const shelfRows = chunkEven(current.topics, SHELF_CAP);
  let stagger = 0; // 函内统一的入场序号,跨搁板连续错落

  return (
    <section id="shelf" className={styles.shelf} aria-label="知识点书架">
      <header className={styles.head}>
        <h2 className={styles.title}>知识点书架</h2>
        <p className={styles.sub}>取一函,挑一讲,讲给小白听</p>
      </header>

      {/* ── 函套排架:一门课一函,函厚随讲数 ── */}
      <div className={styles.caseUnit}>
        <div className={styles.caseRow}>
          {courses.map(({ course, topics }, i) => {
            const open = course === current.course;
            const mastered = masteredOf(topics);
            return (
              <button
                key={course}
                type="button"
                className={`${styles.vol} ${styles[`volTone${i % 3}`]} ${open ? styles.volOpen : ''}`}
                style={{
                  animationDelay: `${320 + i * 80}ms`,
                  width: `${7.25 + Math.min(topics.length * 0.05, 1.5)}rem`,
                }}
                aria-expanded={open}
                aria-controls="shelf-open"
                onClick={() => setOpenCourse(course)}
              >
                <span className={styles.volMark} aria-hidden="true">读</span>
                <span className={`${styles.volSlip} ${course.length > 6 ? styles.volSlipLong : ''}`}>
                  {course}
                </span>
                <span className={styles.volMeta}>
                  {cnCount(topics.length)} 讲{mastered > 0 ? ` · 出师 ${mastered}` : ''}
                </span>
                {mastered > 0 && (
                  <span
                    className={styles.volGauge}
                    style={{ width: `${(mastered / topics.length) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
          <span className={styles.volGhost} aria-hidden="true">虚位以待</span>
        </div>
        <div className={styles.rail} aria-hidden="true" />
      </div>

      {/* ── 翻开的函:当前课程的章节书脊(key 重挂载,换函重演入场) ── */}
      <div
        id="shelf-open"
        key={current.course}
        className={styles.openCase}
        role="region"
        aria-label={`《${current.course}》章节`}
      >
        <div className={styles.openHead}>
          <h3 className={styles.openName}>《{current.course}》</h3>
          <span className={styles.courseNote}>
            出师 {masteredOf(current.topics)}/{current.topics.length}
          </span>
          <p className={styles.legend} aria-hidden="true">
            <span className={`${styles.dot} ${styles.dotJade}`} />出师
            <span className={`${styles.dot} ${styles.dotAmber}`} />待复习
            <span className={`${styles.dot} ${styles.dotAzure}`} />学习中
            <span className={`${styles.dot} ${styles.dotDust}`} />未学
          </p>
        </div>

        {shelfRows.map((rowTopics, rowIdx) => (
          <div key={rowIdx} className={styles.shelfUnit}>
            <div className={styles.row}>
              {rowTopics.map((topic) => {
                const status = spineStatus(topic, topicStates[topic.topicId]);
                const idx = stagger++;
                // 换函即重演:140ms 接住面板入场,之后 30ms/本,增量封顶 240ms
                const delay = 140 + Math.min(idx * 30, 240);
                // 未学书的布色按全架位次轮换(黛墨/深靛/青灰/茶褐/月白/靛墨);
                // 有状态的书整本染语义布色,布色即状态,书脚不再缀碎字
                const tone = status === 'fresh' ? styles[`tone${idx % 6}`] : '';
                return (
                  <button
                    key={topic.topicId}
                    type="button"
                    className={`${styles.spine} ${styles[status]} ${tone}`}
                    style={{
                      animationDelay: `${delay}ms`,
                      width: `${SPINE_W[idx % SPINE_W.length]}rem`,
                      height: `${SPINE_H[idx % SPINE_H.length]}rem`,
                    }}
                    disabled={topic.locked}
                    onClick={() => openTopic(topic)}
                    title={topic.locked ? `${topic.title}(未开放)` : topic.tagline}
                  >
                    <span className={styles.band} aria-hidden="true" />
                    <span
                      className={`${styles.spineTitle} ${slipLen(topic.title) >= 8 ? styles.spineTitleLong : ''}`}
                    >
                      {topic.title}
                    </span>
                  </button>
                );
              })}
              <span className={styles.bookend} aria-hidden="true" />
            </div>
            <div className={styles.rail} aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  );
}
