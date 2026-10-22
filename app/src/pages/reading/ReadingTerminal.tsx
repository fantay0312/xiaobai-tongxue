import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../store/authStore';
import { TerminalRail } from '../learn/shell/TerminalRail';
import { terminalViewPath } from '../learn/shell/views';
import { useKeyboardViewport } from '../learn/shell/useKeyboardViewport';
import { agentStore } from '../../store/agentStore';
import ReadingView from './index';
import t from '../learn/terminal.module.css';

/** Reading has its own data and sync. Course engines are unnecessary for opening a book. */
export default function ReadingTerminal({ active = true }: { active?: boolean }) {
  const owner = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  useEffect(() => { if (active) document.title = '学习终端 · 阅读 — 小白同学'; }, [active]);
  useKeyboardViewport(active);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let loading = false;
    let stop: (() => void) | undefined;
    const startIfNeeded = () => {
      const data = agentStore.get(owner);
      const needed = data.schedules.some((task) => task.enabled) || data.runs.some((run) => run.status === 'running');
      if (disposed || loading || stop || !needed) return;
      loading = true;
      void import('../../engine/agent/scheduler').then(({ startAgentScheduler }) => {
        if (!disposed) stop = startAgentScheduler(owner);
      }).catch(() => { loading = false; });
    };
    startIfNeeded();
    const unsubscribe = agentStore.subscribe(startIfNeeded);
    return () => { disposed = true; unsubscribe(); stop?.(); };
  }, [owner, active]);
  const onView = (view: string) => navigate(terminalViewPath(view));
  return <div className={t.terminal} data-sidebar="collapsed" data-view="reading">
    <TerminalRail view="reading" onView={onView} />
    <div className={t.workspace}><div className={t.body}><main className={t.main} aria-label="学习工作区">
      <ReadingView owner={owner} active={active} />
    </main></div></div>
  </div>;
}
