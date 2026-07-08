// src/pages/DashboardRouter.jsx
// The /dashboard route is one route, two modes — driven by the site switcher:
//   • All Villages (activeGroupId === null) → the global Dashboard (all sites).
//   • A village selected                    → that village's SiteDashboard.

import { lazy, Suspense } from "react";
import { useSite } from "../hooks/useSite";

const GlobalDashboard = lazy(() => import("./Dashboard"));
const SiteDashboard = lazy(() => import("./dashboards/SiteDashboard"));

function Loading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-8 h-8 rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent)] animate-spin" />
    </div>
  );
}

export default function DashboardRouter() {
  const { activeGroupId, activeSite } = useSite();
  return (
    <Suspense fallback={<Loading />}>
      {activeGroupId ? (
        <SiteDashboard groupId={activeGroupId} site={activeSite} />
      ) : (
        <GlobalDashboard />
      )}
    </Suspense>
  );
}
