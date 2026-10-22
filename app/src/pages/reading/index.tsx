import { useCallback, useEffect, useRef, useState } from 'react';
import { useShellActions } from '../../components/shell/ShellActions';
import { useModelPrefs } from '../../store/modelPrefs';

/** The original Gloss application has its own document so host styles cannot leak into it. */
export default function ReadingView({ owner, active = true }: { owner: string | null; active?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = `${import.meta.env.BASE_URL}reader/#/library`;
  const { openSettings, openProfile } = useShellActions();
  const sendVisibility = useCallback(() => frame.current?.contentWindow?.postMessage({ source: 'xiaobai-host', action: 'visibility', active }, location.origin), [active]);
  useEffect(sendVisibility, [sendVisibility]);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [ready, attempt]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'xiaobai-gloss') return;
      if (event.data.action === 'settings') openSettings();
      if (event.data.action === 'profile') openProfile();
      if (event.data.action === 'login') location.hash = '/login?next=%2Flearn%3Fview%3Dreading';
      if (event.data.action === 'model-changed') void useModelPrefs.persist.rehydrate();
      if (event.data.action === 'ready') {
        setReady(true);
        frame.current?.contentWindow?.postMessage({ source: 'xiaobai-host', action: 'visibility', active }, location.origin);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [openSettings, openProfile, active]);
  return <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
    <iframe key={`${owner}:${attempt}`} ref={frame} title="阅读" loading="eager" onLoad={sendVisibility} src={source} style={{ width: '100%', height: '100%', minHeight: 0, border: 0, display: 'block', flex: 1 }} allow="autoplay; clipboard-write" />
    {!ready && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', gap: 16, textAlign: 'center', background: 'var(--bg)', color: 'var(--text-2)' }}>
      <p>{slow ? '阅读还没有打开，可以重试或在新标签页继续。' : '正在打开阅读…'}</p>
      {slow && <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
        <button type="button" onClick={() => { setSlow(false); setReady(false); setAttempt((value) => value + 1); }}>重新打开</button>
        <a href={source} target="_blank" rel="noopener noreferrer">在新标签页打开</a>
      </div>}
    </div>}
  </div>;
}
