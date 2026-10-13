import { useEffect } from 'react';

/** 可视区比布局视口矮这么多，就认为软键盘弹出来了 */
const KEYBOARD_MIN = 120;

/**
 * 手机软键盘：iOS 与新版 Android 弹出键盘时不改布局视口，只缩小可视区，
 * 锁高的终端会被整体顶上去、输入框落到键盘后面。
 * 这里把可视区高度写到 <html> 的 --app-vh，并标记 data-keyboard='open'，
 * 版面据此把终端收到键盘上方、收起底栏。只改 DOM，不触发重渲染。
 */
export function useKeyboardViewport(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      // 双指放大时可视区也会变小，那不是键盘
      const open = viewport.scale < 1.02 && window.innerHeight - viewport.height > KEYBOARD_MIN;
      if (open) {
        root.style.setProperty('--app-vh', `${Math.round(viewport.height)}px`);
        root.dataset.keyboard = 'open';
        // 浏览器为了露出输入框会滚动整页，终端已经自己让位，滚回去
        if (viewport.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
      } else {
        root.style.removeProperty('--app-vh');
        delete root.dataset.keyboard;
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty('--app-vh');
      delete root.dataset.keyboard;
    };
  }, [enabled]);
}
