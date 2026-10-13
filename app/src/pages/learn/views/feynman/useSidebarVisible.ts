/**
 * 侧栏挂载位此刻是否真的看得见。
 * 外壳在侧栏收起、或手机上把侧栏藏起来时，挂载位元素可能还留在页面里（只是不显示）；
 * 只看「有没有挂载位」会把选课和课堂记录一起藏没。这里再确认一步它有没有实际版面。
 */
import { useLayoutEffect, useState } from 'react';
import { useSidebarSlot } from '../../shell/sidebarSlot';

const isRendered = (element: HTMLElement | null) => !!element && element.getClientRects().length > 0;

export function useSidebarVisible(): boolean {
  const slot = useSidebarSlot();
  const [visible, setVisible] = useState(() => isRendered(slot));

  useLayoutEffect(() => {
    if (!slot) {
      setVisible(false);
      return undefined;
    }
    const update = () => setVisible(isRendered(slot));
    update();
    // 侧栏收起（display: none）与展开都会改变挂载位的尺寸
    const observer = new ResizeObserver(update);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);

  return visible;
}
