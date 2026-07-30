import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AdminShell } from './components/AdminShell'
import { RequireAnyPermission, RequirePermission, RequireSession } from './components/AuthGate'
import { Feedback } from './components/ui'
import LoginPage from './pages/LoginPage'
import ActivatePage from './pages/ActivatePage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'))
const EntitlementsPage = lazy(() => import('./pages/EntitlementsPage'))
const PointsPage = lazy(() => import('./pages/PointsPage'))
const CdkPage = lazy(() => import('./pages/CdkPage'))
const AccessPage = lazy(() => import('./pages/AccessPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function LazyFallback() {
  return <Feedback kind="loading" detail="正在翻开对应账册。" />
}

export default function App() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivatePage />} />
        <Route element={<RequireSession />}>
          <Route element={<AdminShell />}>
            <Route element={<RequirePermission permission="overview.read" />}>
              <Route index element={<DashboardPage />} />
            </Route>
            <Route element={<RequirePermission permission="users.read" />}>
              <Route path="users" element={<UsersPage />} />
            </Route>
            <Route element={<RequireAnyPermission permissions={['plans.read', 'subscriptions.read']} />}>
              <Route path="subscriptions" element={<SubscriptionsPage />} />
            </Route>
            <Route element={<RequireAnyPermission permissions={['entitlements.read', 'features.read']} />}>
              <Route path="entitlements" element={<EntitlementsPage />} />
            </Route>
            <Route element={<RequirePermission permission="points.read" />}>
              <Route path="points" element={<PointsPage />} />
            </Route>
            <Route element={<RequirePermission permission="cdk.read" />}>
              <Route path="cdk" element={<CdkPage />} />
            </Route>
            <Route element={<RequirePermission permission="team.read" />}>
              <Route path="access" element={<AccessPage />} />
            </Route>
            <Route element={<RequirePermission permission="audit.read" />}>
              <Route path="audit" element={<AuditPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
