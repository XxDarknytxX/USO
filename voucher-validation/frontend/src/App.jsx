// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppLayout from "./components/layout/AppLayout";
import { getAuthRole } from "./hooks/useAuth";

const Login = lazy(() => import("./pages/Login"));
const DashboardRouter = lazy(() => import("./pages/DashboardRouter"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const VouchersPage = lazy(() => import("./pages/VouchersPage"));
const SyncPage = lazy(() => import("./pages/SyncPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const NetworkPage = lazy(() => import("./pages/NetworkPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const PortalConfigPage = lazy(() => import("./pages/PortalConfigPage"));
const PortalAuditLogPage = lazy(() => import("./pages/PortalAuditLogPage"));
const TransactionFlowPage = lazy(() => import("./pages/TransactionFlowPage"));
const ManualAssistancePage = lazy(() => import("./pages/ManualAssistancePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const MpaisaMappingPage = lazy(() => import("./pages/MpaisaMappingPage"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const role = getAuthRole();
  // An engineer bounced off an admin page must not land on the dashboard —
  // that is not their app. Send them where they belong.
  if (role === "engineer") return <Navigate to="/maintenance" replace />;
  return role === "admin" ? children : <Navigate to="/dashboard" replace />;
}

function MaintenanceRoute({ children }) {
  const role = getAuthRole();
  return role === "admin" || role === "engineer" ? children : <Navigate to="/dashboard" replace />;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            {/* The only tab a read-only viewer may reach is the Dashboard.
                Everything else is AdminRoute-wrapped (with two roles,
                AdminRoute == "block viewers", redirecting them to /dashboard). */}
            <Route path="/dashboard" element={<DashboardRouter />} />
            {/* Profile: every signed-in user (incl. viewers) — not admin-gated. */}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/mpaisa" element={<AdminRoute><MpaisaMappingPage /></AdminRoute>} />
            {/* Admins and engineers. The server enforces the same pair. */}
            <Route path="/maintenance" element={<MaintenanceRoute><MaintenancePage /></MaintenanceRoute>} />
            <Route path="/overview" element={<AdminRoute><OverviewPage /></AdminRoute>} />
            <Route path="/vouchers" element={<AdminRoute><VouchersPage /></AdminRoute>} />
            <Route path="/vouchers/:uuid" element={<AdminRoute><VouchersPage /></AdminRoute>} />
            <Route path="/activity" element={<AdminRoute><ActivityLogPage /></AdminRoute>} />
            <Route path="/network" element={<AdminRoute><NetworkPage /></AdminRoute>} />
            <Route
              path="/sync"
              element={
                <AdminRoute>
                  <SyncPage />
                </AdminRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <AdminRoute>
                  <SettingsPage />
                </AdminRoute>
              }
            />
            <Route
              path="/users"
              element={
                <AdminRoute>
                  <UsersPage />
                </AdminRoute>
              }
            />
            <Route
              path="/portal-config"
              element={
                <AdminRoute>
                  <PortalConfigPage />
                </AdminRoute>
              }
            />
            <Route
              path="/portal-audit"
              element={
                <AdminRoute>
                  <PortalAuditLogPage />
                </AdminRoute>
              }
            />
            <Route
              path="/portal-flows"
              element={
                <AdminRoute>
                  <TransactionFlowPage />
                </AdminRoute>
              }
            />
            <Route
              path="/manual-assistance"
              element={
                <AdminRoute>
                  <ManualAssistancePage />
                </AdminRoute>
              }
            />
          </Route>
          <Route path="/" element={<Navigate to={getAuthRole() === "engineer" ? "/maintenance" : "/dashboard"} replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
