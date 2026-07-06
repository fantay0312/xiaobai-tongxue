import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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

export default function App() {
  const initAuth = useAuthStore((s) => s.init);
  useEffect(() => { void initAuth(); }, [initAuth]);

  return (
    <AppShell>
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
