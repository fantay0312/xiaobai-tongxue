import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { AppShell } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useAuthStore } from './store/authStore';
import {
  AUTH_EXPIRED_EVENT, EMAIL_BINDING_REQUIRED_EVENT, PHONE_BINDING_REQUIRED_EVENT,
} from './lib/api';
import { subscribeAuthChanges } from './lib/authChannel';

const LandingPage = lazy(() => import('./pages/landing'));
const HomePage = lazy(() => import('./pages/home'));
const PrepPage = lazy(() => import('./pages/prep'));
const ClassroomPage = lazy(() => import('./pages/classroom'));
const ExamPage = lazy(() => import('./pages/exam'));
const ReviewPage = lazy(() => import('./pages/review'));
const GrowthPage = lazy(() => import('./pages/growth'));
const TeacherPage = lazy(() => import('./pages/teacher'));
const LoginPage = lazy(() => import('./pages/login'));

function decodeAnchorId(hash: string): string | null {
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return null;
  }
}

/** HashRouter 不自带锚点/滚动恢复:锚点等懒加载内容挂载后落位,普通前进导航回顶部。 */
function RouteScrollManager() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!hash) {
      if (navType !== 'POP') window.scrollTo({ top: 0, behavior: 'auto' });
      return undefined;
    }

    const targetId = decodeAnchorId(hash);
    if (!targetId) return undefined;
    let finished = false;
    const scrollToTarget = () => {
      const target = document.getElementById(targetId);
      if (!target) return false;
      finished = true;
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      return true;
    };

    const frame = window.requestAnimationFrame(() => {
      if (scrollToTarget()) observer.disconnect();
    });
    const observer = new MutationObserver(() => {
      if (scrollToTarget()) observer.disconnect();
    });
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 10000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      if (!finished) observer.disconnect();
    };
  }, [hash, navType, pathname, reducedMotion]);
  return null;
}

export default function App() {
  const { pathname, search } = useLocation();
  const initAuth = useAuthStore((s) => s.init);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const authStatus = useAuthStore((s) => s.status);
  const phoneBindingRequired = useAuthStore((s) => s.phoneBindingRequired);
  const businessPath = pathname !== '/' && pathname !== '/login';
  const resolvingBusinessAccess = authStatus === 'unknown' && businessPath;
  const forcePhoneBinding = authStatus === 'authed' && phoneBindingRequired && businessPath;

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (pathname === '/') return;
    let active = true;
    void import('./store/sync').then(({ initStateSync }) => {
      if (active) initStateSync();
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    const revalidateNow = () => void refreshSession(true);
    const revalidateOnReturn = () => void refreshSession(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') revalidateOnReturn();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, revalidateNow);
    window.addEventListener(EMAIL_BINDING_REQUIRED_EVENT, revalidateNow);
    window.addEventListener(PHONE_BINDING_REQUIRED_EVENT, revalidateNow);
    window.addEventListener('focus', revalidateOnReturn);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = subscribeAuthChanges(revalidateNow);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, revalidateNow);
      window.removeEventListener(EMAIL_BINDING_REQUIRED_EVENT, revalidateNow);
      window.removeEventListener(PHONE_BINDING_REQUIRED_EVENT, revalidateNow);
      window.removeEventListener('focus', revalidateOnReturn);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [refreshSession]);

  return (
    <AppShell>
      <RouteScrollManager />
      {resolvingBusinessAccess ? (
        <div className="route-loader" role="status" aria-live="polite">正在确认账号安全状态…</div>
      ) : forcePhoneBinding ? (
        <Navigate
          to={`/login?next=${encodeURIComponent(`${pathname}${search}`)}`}
          replace
        />
      ) : <Suspense fallback={<div className="route-loader" role="status">小白翻书中…</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/study" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          {/* 使用类页面(备课/讲解)须登录;查看类页面(赴考/复盘/成长/看板)不设门槛 */}
          <Route path="/prep/:topicId" element={<RequireAuth><PrepPage /></RequireAuth>} />
          <Route path="/teach/:topicId" element={<RequireAuth><ClassroomPage /></RequireAuth>} />
          <Route path="/exam/:sessionId" element={<ExamPage />} />
          <Route path="/review/:sessionId" element={<ReviewPage />} />
          <Route path="/growth" element={<GrowthPage />} />
          <Route path="/teacher" element={<TeacherPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>}
    </AppShell>
  );
}
