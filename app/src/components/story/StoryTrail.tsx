/**
 * 篇章条 —— 吸顶导航下的一线细带。
 * 只落一枚朱文小印 + 当前回目;卷名与旁白均已删(用户定案),不铺整卷回目。
 * 路径不命中任何篇章时整条不渲染;讲解舱路由走 .board 黑板变体。
 */
import styles from './storyTrail.module.css';

interface StoryStage {
  chapter: string;
  label: string;
  aside: string;
  test: RegExp;
}

const STAGES: StoryStage[] = [
  { chapter: '序', label: '收下小白', aside: '今日想讲哪一课？', test: /^\/study\/?$/ },
  { chapter: '壹', label: '灯下温书', aside: '明日开讲，先生且温书', test: /^\/prep\// },
  { chapter: '贰', label: '学堂开讲', aside: '小白端坐，正等先生开讲', test: /^\/teach\// },
  { chapter: '叁', label: '送徒赴考', aside: '考场之内，先生请留步', test: /^\/exam\// },
  { chapter: '肆', label: '灯下批注', aside: '把这一课的得失落成批注', test: /^\/review\// },
  { chapter: '长卷', label: '见证成长', aside: '一路所学，终会亮成灯火', test: /^\/growth\/?$/ },
];

export function StoryTrail({ pathname, board = false }: { pathname: string; board?: boolean }) {
  const active = STAGES.findIndex((stage) => stage.test.test(pathname));
  if (active < 0) return null;

  const current = STAGES[active];

  return (
    <section
      className={`${styles.wrap} ${board ? styles.board : ''}`}
      aria-label={`师徒一课，当前篇章：${current.chapter}，${current.label}`}
    >
      <div className={styles.inner}>
        <p className={styles.current}>
          <span className={styles.chapter} aria-hidden="true">{current.chapter}</span>
          <strong className={styles.label}>{current.label}</strong>
        </p>
      </div>
    </section>
  );
}
