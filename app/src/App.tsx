import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { useAuthStore } from './store/authStore';
import LandingPage from './pages/landing';
import HomePage from './pages/home';
import PrepPage from './pages/prep';
import ClassroomPage from './pages/classroom';
import ReviewPage from './pages/review';
import GrowthPage from './pages/growth';
import TeacherPage from './pages/teacher';
import LoginPage from './pages/login';

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
  useEffect(() => { void initAuth(); }, [initAuth]);

  return (
    <AppShell>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/study" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* 使用类页面(备课/讲解)须登录;查看类页面(复盘/成长/看板)不设门槛 */}
        <Route path="/prep/:topicId" element={<RequireAuth><PrepPage /></RequireAuth>} />
        <Route path="/teach/:topicId" element={<RequireAuth><ClassroomPage /></RequireAuth>} />
        <Route path="/review/:sessionId" element={<ReviewPage />} />
        <Route path="/growth" element={<GrowthPage />} />
        <Route path="/teacher" element={<TeacherPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
