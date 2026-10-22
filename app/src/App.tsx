import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { AppShell } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useAuthStore } from './store/authStore';
import {
  AUTH_EXPIRED_EVENT, EMAIL_BINDING_REQUIRED_EVENT, PHONE_BINDING_REQUIRED_EVENT,
} from './lib/api';
import { subscribeAuthChanges } from './lib/authChannel';
import { retryModule, recoverModuleLoad } from './lib/moduleRecovery';
import { PersistentReading } from './pages/reading/PersistentReading';

const LandingPage = lazy(() => retryModule(() => import('./pages/landing')));
const loadLearningPage = () => retryModule(() => import('./pages/learn'));
const LearningPage = lazy(loadLearningPage);
const loadLearningStore = () => retryModule(() => import('./store/appStore'));
const ClassroomPage = lazy(() => retryModule(() => import('./pages/classroom')));
const ExamPage = lazy(() => retryModule(() => import('./pages/exam')));
const ReviewPage = lazy(() => retryModule(() => import('./pages/review')));
const GrowthPage = lazy(() => retryModule(() => import('./pages/growth')));
const TeacherPage = lazy(() => retryModule(() => import('./pages/teacher')));
const LoginPage = lazy(() => retryModule(() => import('./pages/login')));

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
  const authUser = useAuthStore((s) => s.user);
  const emailBindingRequired = useAuthStore((s) => s.emailBindingRequired);
  const phoneBindingRequired = useAuthStore((s) => s.phoneBindingRequired);
  const customTopicUserRef = useRef<string | null>(null);
  // 宣传页与登录页是公开入口，任何时候都不被账号确认挡住
  const businessPath = pathname !== '/' && pathname !== '/about' && pathname !== '/login';
  const readingOnly = (pathname === '/learn' || pathname.startsWith('/prep/')) && new URLSearchParams(search).get('view') === 'reading';
  const resolvingBusinessAccess = authStatus === 'unknown' && businessPath;
  const forcePhoneBinding = authStatus === 'authed' && phoneBindingRequired && businessPath;

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    // Download the known destination while checking auth, without rendering protected content.
    if (!readingOnly && (pathname === '/learn' || pathname.startsWith('/prep/'))) void loadLearningPage().catch(() => {});
  }, [pathname, readingOnly]);

  useEffect(() => {
    if (pathname === '/' || pathname === '/about' || pathname === '/login' || readingOnly) return;
    let active = true;
    void retryModule(() => import('./store/sync')).then(({ initStateSync }) => {
      if (active) initStateSync();
    }).catch((error) => { if (active) recoverModuleLoad(error); });
    return () => {
      active = false;
    };
  }, [pathname, readingOnly]);

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

  useEffect(() => {
    // A signed-in account may still need contact verification. Reading protected
    // topics in that state returns 403 and used to restart auth indefinitely.
    if (authStatus === 'authed' && authUser && !emailBindingRequired && !phoneBindingRequired) {
      if (!businessPath || readingOnly) return;
      const switchedAccount = customTopicUserRef.current !== authUser;
      const previousUser = customTopicUserRef.current;
      customTopicUserRef.current = authUser;
      let active = true;
      void loadLearningStore().then(({ useAppStore }) => {
        if (!active) return;
        if (switchedAccount && previousUser !== null) useAppStore.getState().clearCustomTopics();
        void useAppStore.getState().loadCustomTopics(switchedAccount);
      }).catch(recoverModuleLoad);
      return () => { active = false; };
    }
    if (authStatus !== 'unknown' && customTopicUserRef.current !== null) {
      customTopicUserRef.current = null;
      void loadLearningStore().then(({ useAppStore }) => {
        if (customTopicUserRef.current === null) useAppStore.getState().clearCustomTopics();
      }).catch(recoverModuleLoad);
    }
  }, [authStatus, authUser, emailBindingRequired, phoneBindingRequired, businessPath, readingOnly]);

  return (
    <AppShell persistent={<PersistentReading key={authUser} owner={authUser} active={readingOnly}
      enabled={authStatus === 'authed' && Boolean(authUser) && !emailBindingRequired && !phoneBindingRequired && businessPath} />}>
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
          <Route path="/about" element={<Navigate to="/" replace />} />
          <Route path="/study" element={<Navigate to="/learn" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/custom-content" element={<Navigate to="/learn?view=library" replace />} />
          {/* 站点根是宣传页；进入学习终端、备课与讲解须登录；查看类页面(赴考/复盘/成长/看板)不设门槛 */}
          <Route path="/learn" element={<RequireAuth>{readingOnly ? null : <LearningPage />}</RequireAuth>} />
          <Route path="/prep/:topicId" element={<RequireAuth>{readingOnly ? null : <LearningPage />}</RequireAuth>} />
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
