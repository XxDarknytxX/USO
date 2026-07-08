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

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const role = getAuthRole();
  return role === "admin" ? children : <Navigate to="/dashboard" replace />;
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
            <Route path="/dashboard" element={<DashboardRouter />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/vouchers/:uuid" element={<VouchersPage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/network" element={<NetworkPage />} />
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
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
