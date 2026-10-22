import { useSyncExternalStore } from 'react';

/** A preloaded embedded reader is dormant until the host displays it. */
export const readerVisible = () => window.parent === window || document.documentElement.dataset.hostActive === 'true';
export function setReaderVisible(active: boolean) {
  if (readerVisible() === active) return;
  document.documentElement.dataset.hostActive = String(active);
  window.dispatchEvent(new Event('gloss:visibility-change'));
}
const subscribe = (notify: () => void) => {
  window.addEventListener('gloss:visibility-change', notify);
  return () => window.removeEventListener('gloss:visibility-change', notify);
};
export const useReaderVisible = () => useSyncExternalStore(subscribe, readerVisible, () => false);
