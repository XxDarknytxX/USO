// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppLayout from "./components/layout/AppLayout";
import { getAuthRole, canSeeDashboard, canSeeBilling, homePathFor } from "./hooks/useAuth";

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

// Every bounce goes to the account's OWN home page, never to a fixed one: a
// fixed "/dashboard" would send a field engineer from one refused page straight
// into another.
function Home() {
  return <Navigate to={homePathFor(getAuthRole())} replace />;
}

function AdminRoute({ children }) {
  return getAuthRole() === "admin" ? children : <Home />;
}

// Admins and engineers work in Maintenance, viewers read it; billing accounts
// do not reach it. What each may DO is enforced on the server by HTTP method.
function MaintenanceRoute({ children }) {
  const role = getAuthRole();
  return ["admin", "engineer", "viewer"].includes(role) ? children : <Home />;
}

// The monitoring pages — Dashboard and Overview. Admins, viewers and billing;
// the SERVER decides which villages are in the answer, so a viewer and an admin
// opening the same page get different data from the same call. Field engineers
// are maintenance-only and are sent there; the API refuses them the data anyway
// (requireDashboardAccess), this only spares them a page of errors.
function DashboardRoute({ children }) {
  return canSeeDashboard(getAuthRole()) ? children : <Home />;
}

// Admins and billing accounts. The server enforces the same pair, and keeps
// changing the target to admins.
function BillingRoute({ children }) {
  return canSeeBilling(getAuthRole()) ? children : <Home />;
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
            {/* Admins, viewers and billing. Engineers are sent to Maintenance. */}
            <Route path="/dashboard" element={<DashboardRoute><DashboardRouter /></DashboardRoute>} />
            {/* Profile: every signed-in user (incl. viewers) — not admin-gated. */}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/mpaisa" element={<AdminRoute><MpaisaMappingPage /></AdminRoute>} />
            <Route path="/billing" element={<BillingRoute><BillingPage /></BillingRoute>} />
            {/* Every role: admins and engineers file, viewers read. The server
                enforces the same split by HTTP method. */}
            <Route path="/maintenance" element={<MaintenanceRoute><MaintenancePage /></MaintenanceRoute>} />
            <Route path="/maintenance/village/:projectId" element={<MaintenanceRoute><VillageProfilePage /></MaintenanceRoute>} />
            {/* Viewers and billing accounts see the same page as an admin,
                narrowed to the estate default by attachScope on the server. */}
            <Route path="/overview" element={<DashboardRoute><OverviewPage /></DashboardRoute>} />
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
          {/* Each role starts on its own home page: the dashboard, or for a
              field engineer, maintenance. */}
          <Route path="/" element={<Home />} />
          {/* A signed-in user who mistypes a URL gets their console back, not
              a sign-in form they do not need. */}
          <Route
            path="*"
            element={localStorage.getItem("token") ? <Home /> : <Navigate to="/login" replace />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
