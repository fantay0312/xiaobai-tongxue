import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { useAuthStore } from './store/authStore';
import { initStateSync } from './store/sync';

const LandingPage = lazy(() => import('./pages/landing'));
const HomePage = lazy(() => import('./pages/home'));
const PrepPage = lazy(() => import('./pages/prep'));
const ClassroomPage = lazy(() => import('./pages/classroom'));
const ExamPage = lazy(() => import('./pages/exam'));
const ReviewPage = lazy(() => import('./pages/review'));
const GrowthPage = lazy(() => import('./pages/growth'));
const TeacherPage = lazy(() => import('./pages/teacher'));
const LoginPage = lazy(() => import('./pages/login'));

/** HashRouter 不自带滚动恢复:前进式导航滚回顶部;浏览器后退/前进(POP)交还给原生滚动恢复 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navType]);
  return null;
}

export default function App() {
  const initAuth = useAuthStore((s) => s.init);
  useEffect(() => {
    initStateSync(); // 先装同步订阅,再探会话:authed 一落地就拉服务器档
    void initAuth();
  }, [initAuth]);

  return (
    <AppShell>
      <ScrollToTop />
      <Suspense fallback={<div className="route-loader" role="status">小白翻书中…</div>}>
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
      </Suspense>
    </AppShell>
  );
}
