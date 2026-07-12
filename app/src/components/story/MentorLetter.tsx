/**
 * 拜师帖 —— 首页零履历时的开场书信(events 为空才由 home 挂载)。
 * 一封信讲清世界观:小白是个什么都想学明白的 AI 学徒,聘你为师;
 * 教明白 = 你真懂(费曼),教到出师 = 你毕业。
 * 形态:门厅位只留一条「案头信封条」,信本体做成自动展开的弹层——
 * 每次页面加载自动展帖一次(模块级标志,同 PrepCoach 的 revealedIds 纪律,不进 localStorage),
 * 之后由条上的「展帖重读」再唤起。CTA 不自作主张:走 journey.nextStep,与旅程带同一条路由逻辑。
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
import { nextStep } from '../../engine/journey';
import { Icon } from '../ui/Icon';
import { LETTER_CLOSED_EVENT, LETTER_OPEN_EVENT } from '../tour/tourState';
import s from './story.module.css';

/** 每次页面加载只自动展帖一次(刷新即重置;演示场景要能重复看,故不落盘) */
let autoOpenedThisLoad = false;

/** 弹层内可聚焦元素(Tab 循环用;弹层里只有链接和按钮) */
const FOCUSABLE = 'a[href], button:not([disabled])';

export function MentorLetter() {
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);

  const step = useMemo(
    () => nextStep({ events, reports, topicStates, topics: TOPICS }),
    [events, reports, topicStates],
  );

  const [open, setOpen] = useState(false);
  const stripBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /** 开合必须同步广播给「小白引路」(不能走 [open] effect):
      主线程被 three 懒加载卡住时,帖的 450ms 定时器与引路的 700ms 定时器会挤进同一批
      宏任务 flush——帖 due 更早、规范保证先跑,同步派发才来得及把引路的定时器 clear 掉;
      经 React effect 异步派发则总在引路开火之后才到(实测 2052ms vs 2063ms)。 */
  const setOpenAndBroadcast = useCallback((next: boolean) => {
    setOpen(next);
    window.dispatchEvent(new CustomEvent(next ? LETTER_OPEN_EVENT : LETTER_CLOSED_EVENT));
  }, []);

  /* 自动展帖:等 hero 先画完(~450ms)再弹。
     StrictMode 会「装载→清理→再装载」跑两遍:首跑若还没弹出就被清理,必须把名额还回去,
     否则第二跑(真正存活的那次)会误判"已弹过"而永不自动展开 */
  useEffect(() => {
    if (autoOpenedThisLoad) return;
    autoOpenedThisLoad = true;
    let fired = false;
    const id = window.setTimeout(() => {
      fired = true;
      setOpenAndBroadcast(true);
    }, 450);
    return () => {
      window.clearTimeout(id);
      if (!fired) autoOpenedThisLoad = false;
    };
  }, [setOpenAndBroadcast]);

  /* 弹层期间锁背后页面滚动;补上滚动条宽度,经典滚动条系统(Windows)不横跳。
     依赖 [open] 的清理函数同时覆盖「关帖」与「组件卸载」两条退出路径 */
  useEffect(() => {
    if (!open) return;
    const docStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    // 别人(设置抽屉)已持锁就不抢:否则本效应把「hidden」记成原值,
    // 两层先后关闭会把 hidden 还原回去,页面永久锁死(首访 450ms 内点开抽屉可复现)
    if (docStyle.overflow === 'hidden' || bodyStyle.overflow === 'hidden') return;
    const prev = { doc: docStyle.overflow, body: bodyStyle.overflow, pad: bodyStyle.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    docStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    if (gutter > 0) bodyStyle.paddingRight = `${gutter}px`;
    return () => {
      docStyle.overflow = prev.doc;
      bodyStyle.overflow = prev.body;
      bodyStyle.paddingRight = prev.pad;
    };
  }, [open]);

  /* 打开即把焦点收进信里(容器 tabIndex=-1),键盘/读屏用户不落在弹层背后 */
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  /** 关帖并把焦点还给案头的「展帖重读」(dialog 焦点归还契约) */
  const close = useCallback(() => {
    setOpenAndBroadcast(false);
    stripBtnRef.current?.focus();
  }, [setOpenAndBroadcast]);

  /** 点淡墨罩关帖:只认罩本身,信纸内的点击不算 */
  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  /* Esc 关帖 + 最小 Tab 焦点圈:首尾相接,焦点出不了信 */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === root) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* 案头信封条:门厅位的常驻痕迹,与旅程带同一高度族 */}
      <section className={s.letterStrip} aria-label="案头的拜师帖" data-tour="story">
        <span className={s.stripSeal} aria-hidden="true">白</span>
        <p className={s.stripLine}>小白递来一封拜师帖,收在案头</p>
        <button
          ref={stripBtnRef}
          type="button"
          className={s.stripBtn}
          aria-haspopup="dialog"
          onClick={() => setOpenAndBroadcast(true)}
        >
          展帖重读
        </button>
      </section>

      {open && (
        <div className={s.overlay} onClick={onBackdrop} onKeyDown={onKeyDown}>
          <div
            ref={dialogRef}
            className={s.letterCard}
            role="dialog"
            aria-modal="true"
            aria-label="小白的拜师帖"
            tabIndex={-1}
          >
            <button type="button" className={s.modalClose} onClick={close} aria-label="关上拜师帖">
              <Icon name="x" size={19} />
            </button>

            <p className={s.letterHead} aria-hidden="true">拜师帖</p>

            <div className={s.letterBody}>
              <p className={s.salute}>先生台鉴:</p>
              <p className={s.letterText}>
                小生「小白」,一个什么都想学明白的 AI 学徒。都说<em>讲得出,才是真的懂</em>——故冒昧投帖,聘先生为师。
              </p>
              <p className={s.letterText}>
                往后先生备一课,便讲一课与小生听;小生愚钝,不懂必问,问到先生讲清为止。先生能把小生教明白的学问,才算真正落进先生自己手里。
              </p>
              <p className={s.letterText}>
                小生还有一个愿望:有一天,也能像先生一样,把听懂的道理讲给别人听。若真有那天,我一定会用先生教我的那句话。
              </p>
              <p className={s.letterText}>
                教到小生出师那日,便是先生功成之时。
              </p>

              <div className={s.letterFoot}>
                <span className={s.signature}>学徒 小白 敬上</span>
                <span className={s.sealMark} aria-hidden="true">白</span>
              </div>

              <div className={s.letterActions}>
                <Link className={s.letterCta} to={step.to} onClick={() => setOpenAndBroadcast(false)}>
                  {step.cta}
                </Link>
                <button type="button" className={s.dismissBtn} onClick={close}>
                  先收着
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
