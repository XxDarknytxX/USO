// src/hooks/useSite.jsx
// Global "current site" (village) context. Each site is a Ruijie project
// (groupId). The switcher drives the whole app's scope:
//   • activeSiteId === null  → GLOBAL scope ("All Villages"); dashboards
//     aggregate and voucher endpoints omit groupId (backend = all sites).
//   • activeSiteId === <id>  → one village; everything rescopes to it.
// The choice persists in localStorage ("all" or the numeric id).

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { networkApi } from "../services/api";

const SiteContext = createContext(null);
const STORAGE_KEY = "vv:activeSiteId";

function readStored() {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v == null || v === "all") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function SiteProvider({ children }) {
  const [sites, setSites] = useState([]);
  const [activeSiteId, setActiveSiteIdState] = useState(readStored);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await networkApi.projects();
      const list = data.projects || [];
      setSites(list);
      // Keep the chosen village if it still exists; otherwise fall back to
      // global (All Villages). Never auto-pin the first site.
      setActiveSiteIdState((cur) => (cur && list.some((s) => s.id === cur) ? cur : null));
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

  const activeSite = sites.find((s) => s.id === activeSiteId) || null;
  const activeGroupId = activeSite?.ruijieGroupId || null;
  const isGlobal = activeSiteId == null;

  return (
    <SiteContext.Provider
      value={{
        sites,
        activeSite,
        activeSiteId,
        activeGroupId,
        isGlobal,
        setActiveSiteId,
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
      loading: false,
      reload: () => {},
    };
  }
  return ctx;
}
