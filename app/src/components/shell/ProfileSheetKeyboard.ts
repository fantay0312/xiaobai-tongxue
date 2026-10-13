/**
 * 底部面板里的表单与软键盘（设置与个人中心共用）。
 * 手机上键盘是盖在页面上的：面板贴着屏幕底边，下半截会被挡住，而面板内容不够长时又滚不动。
 * 这里按可视视口算出键盘盖住的高度，写进滚动区的 --kb（样式里垫成底部留白），
 * 并把正在输入的那一格挪到键盘上方。桌面端没有键盘遮挡，不做任何事。
 */
import { useEffect, type RefObject } from 'react';

const FIELD_SELECTOR = 'input:not([type="range"]):not([type="color"]):not([type="file"]), textarea';

export function useSheetKeyboardInset(paneRef: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const pane = paneRef.current;
    if (!active || !viewport || !pane) return undefined;

    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !pane.contains(field) || !field.matches(FIELD_SELECTOR)) return;
      const box = field.getBoundingClientRect();
      const paneTop = pane.getBoundingClientRect().top;
      // 可视区域的下沿，留出一枚按钮的余量，输入框下面的主按钮也露得出来
      const visibleBottom = viewport.offsetTop + viewport.height - 72;
      if (box.bottom > visibleBottom) pane.scrollTop += box.bottom - visibleBottom;
      else if (box.top < paneTop) pane.scrollTop -= paneTop - box.top + 12;
    };

    const sync = () => {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      // 双指放大时可视视口也会变小，那不是键盘；小于 80px 的变化是地址栏伸缩，同样不算
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const inset = !zoomed && covered > 80 ? Math.round(covered) : 0;
      pane.style.setProperty('--kb', `${inset}px`);
      if (inset) reveal();
    };

    const onFocus = () => {
      if (pane.style.getPropertyValue('--kb') && pane.style.getPropertyValue('--kb') !== '0px') reveal();
    };

    viewport.addEventListener('resize', sync);
    pane.addEventListener('focusin', onFocus);
    return () => {
      viewport.removeEventListener('resize', sync);
      pane.removeEventListener('focusin', onFocus);
      pane.style.removeProperty('--kb');
    };
  }, [paneRef, active]);
}
