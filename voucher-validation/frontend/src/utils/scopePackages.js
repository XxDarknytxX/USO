// src/utils/scopePackages.js
// Collapse the per-(village, plan) rollup (packageSiteStats from /vouchers/stats)
// into per-plan totals for ONLY the in-scope villages, so the global dashboard's
// package charts/tables respect the "All Villages" scope set in Settings.
//
//   scopePackages(packageSiteStats, inScopeGroupIds, allVisible)
//
// - Returns null when there's no per-site rollup (e.g. single-village response),
//   so callers can fall back to the server-scoped packageStats.
// - allVisible → include EVERY row (ignore group_id matching) so vouchers whose
//   group isn't mapped to a known site ("unassigned") still count — matching the
//   perSite scoping rule used elsewhere.
// - avg_duration_minutes is re-weighted by voucher count so classifyPackage()
//   (Daily/Weekly/Monthly tabs) still works on the merged rows.
export function scopePackages(packageSiteStats, inScopeGroupIds, allVisible) {
  if (!Array.isArray(packageSiteStats)) return null;

  const inSet = new Set((inScopeGroupIds || []).filter((g) => g != null && g !== "").map(String));
  const byName = new Map();

  for (const r of packageSiteStats) {
    if (!allVisible && !inSet.has(String(r.group_id))) continue;
    const name = r.package_name || "Unknown";
    const acc = byName.get(name) || {
      package_name: name,
      total: 0, unused: 0, active: 0, inactive: 0, expired: 0,
      total_quota_mb: 0, total_used_quota_mb: 0, currently_in_use: 0,
      _durNum: 0, _durDen: 0,
    };
    const t = Number(r.total || 0);
    acc.total += t;
    acc.unused += Number(r.unused || 0);
    acc.active += Number(r.active || 0);
    acc.inactive += Number(r.inactive || 0);
    acc.expired += Number(r.expired || 0);
    acc.total_quota_mb += Number(r.total_quota_mb || 0);
    acc.total_used_quota_mb += Number(r.total_used_quota_mb || 0);
    acc.currently_in_use += Number(r.currently_in_use || 0);
    acc._durNum += Number(r.avg_duration_minutes || 0) * t;
    acc._durDen += t;
    byName.set(name, acc);
  }

  return Array.from(byName.values())
    .map(({ _durNum, _durDen, ...a }) => ({
      ...a,
      avg_duration_minutes: _durDen ? _durNum / _durDen : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
