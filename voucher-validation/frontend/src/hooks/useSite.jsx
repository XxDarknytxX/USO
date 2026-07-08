// src/hooks/useSite.jsx
// Global "current site" (village) context. Each site is a Ruijie project
// (groupId). Two independent controls:
//   • activeSiteId — the dashboard/voucher SCOPE. null → global ("All Villages");
//     an id → that village; everything rescopes to it.
//   • visibleSiteIds — a DISPLAY FILTER for the Overview board + Network tab:
//     which villages to show. null → all; an array → that subset.
// Both persist in localStorage.

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { networkApi } from "../services/api";

const SiteContext = createContext(null);
const STORAGE_KEY = "vv:activeSiteId";
const VISIBLE_KEY = "vv:visibleSiteIds";

function readActive() {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v == null || v === "all") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function readVisible() {
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export function SiteProvider({ children }) {
  const [sites, setSites] = useState([]);
  const [activeSiteId, setActiveSiteIdState] = useState(readActive);
  const [visibleSiteIds, setVisibleState] = useState(readVisible); // null = all
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await networkApi.projects();
      const list = data.projects || [];
      setSites(list);
      setActiveSiteIdState((cur) => (cur && list.some((s) => s.id === cur) ? cur : null));
      // Prune the visible set to sites that still exist; empty → treat as all.
      setVisibleState((cur) => {
        if (cur == null) return null;
        const kept = cur.filter((id) => list.some((s) => s.id === id));
        return kept.length && kept.length < list.length ? kept : null;
      });
    } catch {
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setActiveSiteId = useCallback((id) => {
    const next = id == null || id === "all" ? null : Number(id);
    setActiveSiteIdState(next);
    localStorage.setItem(STORAGE_KEY, next == null ? "all" : String(next));
  }, []);

  // Persist visible selection. Passing null (or a full set) means "all".
  const setVisibleSiteIds = useCallback(
    (ids) => {
      const all = sites.map((s) => s.id);
      let next = ids == null ? null : ids.filter((id) => all.includes(id));
      if (next && (next.length === 0 || next.length === all.length)) next = null;
      setVisibleState(next);
      if (next == null) localStorage.removeItem(VISIBLE_KEY);
      else localStorage.setItem(VISIBLE_KEY, JSON.stringify(next));
    },
    [sites]
  );

  const isSiteVisible = useCallback(
    (id) => visibleSiteIds == null || visibleSiteIds.includes(id),
    [visibleSiteIds]
  );

  // Effective scope for the Overview board + Network tab: when a single village
  // is picked in the switcher, only that one; otherwise the configured
  // "All Villages" set (isSiteVisible).
  const isInScope = useCallback(
    (id) => (activeSiteId != null ? id === activeSiteId : isSiteVisible(id)),
    [activeSiteId, isSiteVisible]
  );

  const toggleVisibleSite = useCallback(
    (id) => {
      const all = sites.map((s) => s.id);
      const current = visibleSiteIds == null ? all : visibleSiteIds;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      setVisibleSiteIds(next);
    },
    [sites, visibleSiteIds, setVisibleSiteIds]
  );

  const activeSite = sites.find((s) => s.id === activeSiteId) || null;
  const activeGroupId = activeSite?.ruijieGroupId || null;
  const isGlobal = activeSiteId == null;
  const visibleSites = visibleSiteIds == null ? sites : sites.filter((s) => visibleSiteIds.includes(s.id));
  const allVisible = visibleSiteIds == null;

  return (
    <SiteContext.Provider
      value={{
        sites,
        activeSite,
        activeSiteId,
        activeGroupId,
        isGlobal,
        setActiveSiteId,
        // display filter
        visibleSiteIds,
        visibleSites,
        allVisible,
        isSiteVisible,
        isInScope,
        setVisibleSiteIds,
        toggleVisibleSite,
        loading,
        reload: load,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) {
    return {
      sites: [],
      activeSite: null,
      activeSiteId: null,
      activeGroupId: null,
      isGlobal: true,
      setActiveSiteId: () => {},
      visibleSiteIds: null,
      visibleSites: [],
      allVisible: true,
      isSiteVisible: () => true,
      isInScope: () => true,
      setVisibleSiteIds: () => {},
      toggleVisibleSite: () => {},
      loading: false,
      reload: () => {},
    };
  }
  return ctx;
}
