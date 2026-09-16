// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppLayout from "./components/layout/AppLayout";
import { getAuthRole } from "./hooks/useAuth";

const Login = lazy(() => import("./pages/Login"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const DashboardRouter = lazy(() => import("./pages/DashboardRouter"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const VouchersPage = lazy(() => import("./pages/VouchersPage"));
const SyncPage = lazy(() => import("./pages/SyncPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const NetworkPage = lazy(() => import("./pages/NetworkPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SystemHealthPage = lazy(() => import("./pages/SystemHealthPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const PortalConfigPage = lazy(() => import("./pages/PortalConfigPage"));
const PortalAuditLogPage = lazy(() => import("./pages/PortalAuditLogPage"));
const TransactionFlowPage = lazy(() => import("./pages/TransactionFlowPage"));
const ManualAssistancePage = lazy(() => import("./pages/ManualAssistancePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const MpaisaMappingPage = lazy(() => import("./pages/MpaisaMappingPage"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const VillageProfilePage = lazy(() => import("./pages/VillageProfilePage"));

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  return getAuthRole() === "admin" ? children : <Navigate to="/dashboard" replace />;
}

// Every role reaches Maintenance: admins and engineers to work in it, viewers to
// read it. What each may DO is enforced on the server by HTTP method.
function MaintenanceRoute({ children }) {
  const role = getAuthRole();
  return ["admin", "engineer", "viewer"].includes(role) ? children : <Navigate to="/dashboard" replace />;
}

// The monitoring pages: every signed-in role reaches them, and the SERVER
// decides which villages are in the answer. That is the whole point of the
// scope model — the client does not need a role check here, because a viewer
// and an admin opening the same page get different data from the same call.
//
// This exists as a named component rather than a bare route so the intent is
// stated once: "open to all roles, scoped server-side" is a deliberate
// position, not a route somebody forgot to guard.
function ScopedRoute({ children }) {
  return children;
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
          {/* Public: whoever follows an invite link has no account to sign in
              with yet. The token in the URL is the credential. */}
          <Route path="/set-password" element={<SetPassword />} />
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
            <Route path="/billing" element={<AdminRoute><BillingPage /></AdminRoute>} />
            {/* Admins and engineers. The server enforces the same pair. */}
            <Route path="/maintenance" element={<MaintenanceRoute><MaintenancePage /></MaintenanceRoute>} />
            <Route path="/maintenance/village/:projectId" element={<MaintenanceRoute><VillageProfilePage /></MaintenanceRoute>} />
            {/* Viewers and engineers see the same page as an admin, narrowed
                to their villages by attachScope on the server. */}
            <Route path="/overview" element={<ScopedRoute><OverviewPage /></ScopedRoute>} />
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
              path="/system"
              element={
                <AdminRoute>
                  <SystemHealthPage />
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
          {/* Every role has a dashboard now, so every role starts on it. */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {/* A signed-in user who mistypes a URL gets their console back, not
              a sign-in form they do not need. */}
          <Route
            path="*"
            element={<Navigate to={localStorage.getItem("token") ? "/dashboard" : "/login"} replace />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
