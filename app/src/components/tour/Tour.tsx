/**
 * 「小白引路」新手引导 —— 聚光灯分步引路(门厅/备课桌/讲解舱各一条线)。
 * 形制:淡墨罩上挖一扇亮窗照住真实界面,窗边递一张纸笺,小白口吻讲这一处是做什么的。
 * 首访自动开、每处只一次(tourState 落盘);「跳过引路」与走完都算看过。
 * 礼让拜师帖:听 letter-open/letter-closed 广播,帖开着不上前,帖收了再引路。
 * 挖窗位置走 rAF 逐帧量测:滚动/折叠动画/抽屉开合引发的位移全部自动跟上,
 * 位置不做 CSS 过渡(动效纪律:只 transition transform/opacity)。
 * 开步子时按「元素是否在场」过滤:条件渲染的目标(如已下课的送考钮)自动让位。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LETTER_CLOSED_EVENT,
  LETTER_OPEN_EVENT,
  isTourDone,
  markTourDone,
  subscribeTours,
  type TourKey,
} from './tourState';
import s from './tour.module.css';

export interface TourStep {
  /** CSS 选择器:data-tour 锚点或页面既有 id */
  target: string;
  /** 楷体短题 */
  title: string;
  /** 小白口吻一两句(门厅/备课称「先生」,课堂称「老师」——称呼纪律) */
  text: string;
}

const CN_STEP = ['一', '二', '三', '四', '五', '六'] as const;
const SPOT_PAD = 6; // 挖窗外扩
const EDGE = 8; // 挖窗对视口的钳制内边距
const SLIP_GAP = 14; // 纸笺与挖窗的间距

interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 场上是否还开着别的对话框(设置抽屉常驻 DOM,关着时挂 aria-hidden,须排除) */
const anyDialogVisible = () =>
  [...document.querySelectorAll('[role="dialog"]')].some(
    (d) => d.getAttribute('aria-hidden') !== 'true',
  );

/** 目标矩形 → 视口内钳制过的挖窗(超高分节只照进视口的部分;滚动途中允许退化成边缘细条) */
function clampRect(r: DOMRect): SpotRect {
  const top = Math.max(r.top - SPOT_PAD, EDGE);
  const left = Math.max(r.left - SPOT_PAD, EDGE);
  const bottom = Math.min(r.bottom + SPOT_PAD, window.innerHeight - EDGE);
  const right = Math.min(r.right + SPOT_PAD, window.innerWidth - EDGE);
  return {
    top: Math.min(top, window.innerHeight - EDGE),
    left: Math.min(left, window.innerWidth - EDGE),
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

export function Tour({ tourKey, steps }: { tourKey: TourKey; steps: TourStep[] }) {
  /** 开着时 = 按「元素在场」过滤后的步子;null = 收着 */
  const [live, setLive] = useState<TourStep[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<SpotRect | null>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const open = live !== null && live.length > 0;
  const step = open ? live[idx] : null;

  const openTour = useCallback(() => {
    const present = stepsRef.current.filter((st) => document.querySelector(st.target));
    if (present.length === 0) return;
    prevFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIdx(0);
    setRect(null);
    setLive(present);
  }, []);

  /** 走完与跳过都算看过:不再自动上前,想重看走设置抽屉「重新引路」 */
  const close = useCallback(() => {
    markTourDone(tourKey);
    setLive(null);
    setRect(null);
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }, [tourKey]);

  const next = useCallback(() => {
    if (!live) return;
    if (idx >= live.length - 1) close();
    else setIdx(idx + 1);
  }, [live, idx, close]);

  const prev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  /* 首访自动开:等页面入场动画铺完(~700ms)再上前;
     期间若拜师帖先开了(letter-open),便让帖,帖收了(letter-closed)再引路 */
  useEffect(() => {
    if (isTourDone(tourKey)) return;
    let holdByLetter = false;
    let timer = 0;
    const fire = () => {
      if (holdByLetter || isTourDone(tourKey)) return;
      // 保险丝:场上还有别的可见弹层(拜师帖/设置抽屉)就再等等——
      // 事件礼让之外的兜底,防任何时序下引路压到别的对话框上
      if (anyDialogVisible()) {
        schedule(500);
        return;
      }
      openTour();
    };
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, ms);
    };
    const onLetterOpen = () => {
      holdByLetter = true;
      window.clearTimeout(timer);
    };
    const onLetterClosed = () => {
      holdByLetter = false;
      schedule(350);
    };
    window.addEventListener(LETTER_OPEN_EVENT, onLetterOpen);
    window.addEventListener(LETTER_CLOSED_EVENT, onLetterClosed);
    schedule(700);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(LETTER_OPEN_EVENT, onLetterOpen);
      window.removeEventListener(LETTER_CLOSED_EVENT, onLetterClosed);
    };
  }, [tourKey, openTour]);

  /* 设置抽屉「重新引路」清痕广播:当前页的引路稍等抽屉滑走再重开;
     抽屉若还开着(或有别的弹层)就每半秒探一次,关了再上前 */
  useEffect(
    () =>
      subscribeTours(() => {
        if (isTourDone(tourKey)) return;
        const attempt = () => {
          if (isTourDone(tourKey)) return;
          if (anyDialogVisible()) {
            window.setTimeout(attempt, 500);
            return;
          }
          openTour();
        };
        window.setTimeout(attempt, 450);
      }),
    [tourKey, openTour],
  );

  /* 换步:把目标滚进视口(高个分节对齐顶端,免得题头滚出屏外) */
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) return;
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7;
    el.scrollIntoView({
      block: tall ? 'start' : 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [step]);

  /* 逐帧量测:平滑滚动/折叠动画/视口变化全跟上;目标从 DOM 消失则收工 */
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(step.target);
      if (!el) {
        close();
        return;
      }
      const nextRect = clampRect(el.getBoundingClientRect());
      setRect((prevRect) =>
        prevRect &&
        Math.abs(prevRect.top - nextRect.top) < 0.5 &&
        Math.abs(prevRect.left - nextRect.left) < 0.5 &&
        Math.abs(prevRect.width - nextRect.width) < 0.5 &&
        Math.abs(prevRect.height - nextRect.height) < 0.5
          ? prevRect
          : nextRect,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, close]);

  /* 纸笺落位:优先落挖窗下方,放不下换上方;高个目标塞不下就贴视口下缘(仍在亮区内,可读) */
  useLayoutEffect(() => {
    const slip = slipRef.current;
    if (!slip || !rect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = slip.offsetWidth;
    const h = slip.offsetHeight;
    let top = rect.top + rect.height + SLIP_GAP;
    if (top + h > vh - EDGE) top = rect.top - h - SLIP_GAP;
    if (top < EDGE) top = vh - h - EDGE * 3;
    const left = Math.min(Math.max(rect.left, EDGE), Math.max(vw - w - EDGE, EDGE));
    slip.style.top = `${Math.max(top, EDGE)}px`;
    slip.style.left = `${left}px`;
  }, [rect, idx]);

  /* 焦点进笺(容器 tabIndex=-1):键盘/读屏用户不落在墨罩背后;换步重挂载后重新收焦 */
  const hasRect = rect !== null;
  useEffect(() => {
    if (open && hasRect) slipRef.current?.focus();
  }, [open, hasRect, idx]);

  /* Esc 收工 + 左右方向键翻步 + 最小 Tab 焦点圈(笺里只有按钮)。
     围栏:输入法合成期间不动;焦点若溜出笺外(极端路径),按键先把焦点收回笺而不是隔空执行 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const slip = slipRef.current;
      if (!slip) return;
      const inside = slip.contains(document.activeElement);
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!inside) {
          slip.focus();
          return;
        }
        if (e.key === 'ArrowRight') next();
        else prev();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = slip.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!inside) {
        e.preventDefault();
        first.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === slip) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, next, prev]);

  if (!open || !step || !live) return null;

  return createPortal(
    <div className={s.root}>
      {/* 透明接客层:引路期间页面本体不可点(淡墨罩由挖窗的外阴影铺满);
          onMouseDown preventDefault 吞掉罩面点击的焦点转移,焦点不离笺 */}
      <div className={s.shade} aria-hidden="true" onMouseDown={(e) => e.preventDefault()} />
      {rect && (
        <div
          className={s.spot}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      )}
      {rect && (
        <div
          key={idx}
          ref={slipRef}
          className={s.slip}
          role="dialog"
          aria-modal="true"
          aria-label={`小白引路 第${idx + 1}步 共${live.length}步 · ${step.title}`}
          aria-describedby="xiaobai-tour-step-text"
          tabIndex={-1}
        >
          <p className={s.kicker}>
            <span className={s.kickSeal} aria-hidden="true">白</span>
            小白引路
            <span className={s.kickStep}>其{CN_STEP[idx] ?? idx + 1} · 共 {live.length} 处</span>
          </p>
          <h3 className={s.title}>{step.title}</h3>
          <p id="xiaobai-tour-step-text" className={s.text}>{step.text}</p>
          <div className={s.row}>
            <button type="button" className={s.ghostBtn} onClick={close}>
              跳过引路
            </button>
            <span className={s.spacer} aria-hidden="true" />
            {idx > 0 && (
              <button type="button" className={s.ghostBtn} onClick={prev}>
                上一步
              </button>
            )}
            <button type="button" className={s.solidBtn} onClick={next}>
              {idx === live.length - 1 ? '知道了' : '下一步'}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
