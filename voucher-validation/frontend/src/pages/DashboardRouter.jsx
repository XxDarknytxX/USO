// src/pages/DashboardRouter.jsx
// The /dashboard route is one route, two modes — driven by the site switcher:
//   • All Villages (activeGroupId === null) → the global Dashboard (all sites).
//   • A village selected                    → that village's SiteDashboard.
//
// Both modes are the same page with the same building blocks, so the fallback
// is the shape they share — header, KPI rail, primary chart row — rather than a
// spinner on an empty canvas. Switching scope then reads as the page filling
// in, not as a navigation.

import { lazy, Suspense } from "react";
import { useSite } from "../hooks/useSite";
import { PageShell, SkeletonKpis, SkeletonCard } from "../components/ui";

const GlobalDashboard = lazy(() => import("./Dashboard"));
const SiteDashboard = lazy(() => import("./dashboards/SiteDashboard"));

function Loading() {
  return (
    <PageShell>
      <SkeletonCard height="h-[104px]" />
      <SkeletonKpis count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        <SkeletonCard height="h-[400px]" />
        <SkeletonCard height="h-[400px]" />
      </div>
    </PageShell>
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
