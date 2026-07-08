// src/services/networkHealthStore.js
// In-memory latest-good health snapshots (devices + topology + summary),
// written by the background collector every ~5 min and read by the on-demand
// /projects/:id/health endpoint. This keeps opening the Network diagram OFF
// the live Ruijie Cloud path — Ruijie rate-limits hard, so we serve the last
// gently-collected snapshot instead of bursting on every page open/refresh.

const _snapshots = new Map(); // projectId(str) -> { ts, health }

export function setHealthSnapshot(id, health) {
  _snapshots.set(String(id), { ts: Date.now(), health });
}

export function getHealthSnapshot(id) {
  return _snapshots.get(String(id)) || null;
}
