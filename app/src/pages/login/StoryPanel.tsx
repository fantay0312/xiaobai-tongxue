/**
 * 登录页的故事栏：左上角品牌回首页，中间一张拜师帖（data-story 纸质物件）。
 * 窄屏时只留品牌行和帖子的头一行（小白 + 校训 + 一句话）。
 */
import { Link } from 'react-router';
import { Seal } from '../../components/shell/Seal';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { XiaobaiMood } from '../../types';
import s from './login.module.css';

const STEPS = [
  { tag: '学', text: '跟小砚把一节课学明白' },
  { tag: '教', text: '讲给小白听，接住它的追问' },
  { tag: '考', text: '小白替你上考场' },
  { tag: '复盘', text: '对着批注，看哪里没讲透' },
] as const;

interface StoryPanelProps {
  mood: XiaobaiMood;
  /** 小白此刻说的一句话，随登录 / 注册 / 找回 / 绑定切换 */
  voice: string;
}

export function StoryPanel({ mood, voice }: StoryPanelProps) {
  return (
    <aside className={s.story}>
      <Link to="/" className={s.brand} aria-label="小白同学，回到首页">
        <Seal className={s.brandMark} plate="paper" />
        <span>小白同学</span>
      </Link>

      <div className={s.storyBody}>
        <div className={s.pitch}>
          <p className={s.pitchTitle}>把学会的，讲给小白听</p>
          <p className={s.pitchText}>小白是会追问的 AI 学生。给它讲明白，才算真学会。</p>
        </div>

        <article className={s.card} data-story aria-label="拜师帖">
          <header className={s.cardHead}>
            <span className={s.cardKind}>拜师帖</span>
            <span className={s.cardSerial}>学伴书斋 · 听课证</span>
          </header>

          <div className={s.lead}>
            <span className={s.portrait} aria-hidden="true">
              <XiaobaiAvatar mood={mood} level={1} variant="paper" size={104} />
            </span>
            <div className={s.leadText}>
              <p className={s.motto} lang="zh">教然后知困</p>
              <p className={s.voice}>「{voice}」</p>
            </div>
          </div>

          <p className={s.gloss}>语出《礼记·学记》：讲不清的地方，就是还没学会。</p>

          <div className={s.perf} aria-hidden="true" />

          <p className={s.stepsTitle}>登录之后</p>
          <ol className={s.steps}>
            {STEPS.map((step) => (
              <li key={step.tag}>
                <b>{step.tag}</b>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>

          <span className={s.stamp} aria-hidden="true">拜师</span>
        </article>
      </div>
    </aside>
  );
}
