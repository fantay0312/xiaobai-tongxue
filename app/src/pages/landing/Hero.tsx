/** 首屏：一句话主张、导语、主次按钮、七个板块的索引，下接会动的迷你学习终端。 */
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui';
import {
  IconAgent, IconChat, IconClassroom, IconMemory, IconResearch, IconTeach, IconWorkbench, type XbIconType,
} from '../../components/ui/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { HeroTerminal } from './HeroTerminal';
import { scrollToSection } from './sections';
import base from './landing.module.css';
import s from './hero.module.css';

/** 终端里的七个板块：名字与图标同终端导轨，事实以 PRODUCT.md 与代码为准 */
const MODULES: { section: string; name: string; fact: [string, string]; icon: XbIconType }[] = [
  { section: 'learn', name: '学习终端', fact: ['回答带出处', '13 种回答卡片'], icon: IconChat },
  { section: 'teach', name: '教小白', fact: ['备课、上课', '赴考、复盘'], icon: IconTeach },
  { section: 'practice', name: '工作台', fact: ['6 件学习工具', 'AI 跟着光标'], icon: IconWorkbench },
  { section: 'delegate', name: 'AI 课堂', fact: ['一键生成', '多角色授课'], icon: IconClassroom },
  { section: 'delegate', name: '助理任务', fact: ['目标模式、子代理', '定时任务'], icon: IconAgent },
  { section: 'research', name: '科研台', fact: ['真实文献检索', 'Python 在浏览器跑'], icon: IconResearch },
  { section: 'memory', name: '记忆库', fact: ['小砚和小白', '各记一份'], icon: IconMemory },
];

export function Hero() {
  const authed = useAuthStore((state) => state.status === 'authed');
  const reducedMotion = useReducedMotion();
  return (
    <section className={s.hero} aria-labelledby="landing-title">
      <div className={`${base.wrap} ${s.head}`}>
        <div>
          <p className={s.kicker}>
            <i aria-hidden="true" />
            一间按费曼学习法搭起来的学习终端
          </p>
          <h1 id="landing-title" className={s.title}>
            <span>讲得明白，</span>
            <span>才算学会。</span>
          </h1>
        </div>
        <div className={s.side}>
          <p className={s.lead}>
            先跟导师<strong>小砚</strong>把资料读懂，再讲给 AI 学生<strong>小白</strong>听。他会追问，也要考试；你讲不清的地方，就是还没懂的地方。
          </p>
          <div className={s.actions}>
            <Button asChild variant="solid" size="lg" pill className={s.cta} iconRight={<ArrowRight size={17} strokeWidth={2} />}>
              <Link to="/learn">进入学习终端</Link>
            </Button>
            {!authed && (
              <Button asChild variant="outline" size="lg" pill className={s.cta}>
                <Link to="/login">登录</Link>
              </Button>
            )}
          </div>
          <p className={s.note}>学习终端需要登录后使用。</p>
        </div>
      </div>

      <div className={base.wrap}>
        <ul className={s.modules} aria-label="终端里的七个板块">
          {MODULES.map(({ section, name, fact, icon: ModuleIcon }) => (
            <li key={name}>
              <button type="button" className={s.module} onClick={() => scrollToSection(section, !reducedMotion)}>
                <ModuleIcon size={20} className={s.moduleIcon} />
                <span className={s.moduleName}>{name}</span>
                <span className={s.moduleFact}>
                  <span>{fact[0]}</span>
                  <span>{fact[1]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${base.wrap} ${s.scene}`}>
        <HeroTerminal />
      </div>
    </section>
  );
}
