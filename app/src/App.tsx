import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import HomePage from './pages/home';
import PrepPage from './pages/prep';
import ClassroomPage from './pages/classroom';
import ReviewPage from './pages/review';
import GrowthPage from './pages/growth';
import TeacherPage from './pages/teacher';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/prep/:topicId" element={<PrepPage />} />
        <Route path="/teach/:topicId" element={<ClassroomPage />} />
        <Route path="/review/:sessionId" element={<ReviewPage />} />
        <Route path="/growth" element={<GrowthPage />} />
        <Route path="/teacher" element={<TeacherPage />} />
      </Routes>
    </AppShell>
  );
}
