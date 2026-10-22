import { useCallback, useEffect, useRef } from 'react';
import { useShellActions } from '../../components/shell/ShellActions';
import { useModelPrefs } from '../../store/modelPrefs';

/** The original Gloss application has its own document so host styles cannot leak into it. */
export default function ReadingView({ owner, active = true }: { owner: string | null; active?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { openSettings, openProfile } = useShellActions();
  const sendVisibility = useCallback(() => frame.current?.contentWindow?.postMessage({ source: 'xiaobai-host', action: 'visibility', active }, location.origin), [active]);
  useEffect(sendVisibility, [sendVisibility]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'xiaobai-gloss') return;
      if (event.data.action === 'settings') openSettings();
      if (event.data.action === 'profile') openProfile();
      if (event.data.action === 'login') location.hash = '/login?next=%2Flearn%3Fview%3Dreading';
      if (event.data.action === 'model-changed') void useModelPrefs.persist.rehydrate();
      if (event.data.action === 'ready') frame.current?.contentWindow?.postMessage({ source: 'xiaobai-host', action: 'visibility', active }, location.origin);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [openSettings, openProfile, active]);
  return <iframe key={owner} ref={frame} title="阅读" loading="eager" onLoad={sendVisibility} src={`${import.meta.env.BASE_URL}reader/#/library`} style={{ width: '100%', height: '100%', minHeight: 0, border: 0, display: 'block', flex: 1 }} allow="autoplay; clipboard-write" />;
}
