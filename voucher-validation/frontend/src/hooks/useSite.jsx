// src/hooks/useSite.jsx
// Global "current site" (village) context. Each site is a Ruijie project
// (groupId). Management pages operate on the active site; the Dashboard
// shows all sites. The active site persists in localStorage.

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { networkApi } from "../services/api";

const SiteContext = createContext(null);
const STORAGE_KEY = "vv:activeSiteId";

export function SiteProvider({ children }) {
  const [sites, setSites] = useState([]);
  const [activeSiteId, setActiveSiteIdState] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await networkApi.projects();
      const list = data.projects || [];
      setSites(list);
      // Make sure something sensible is selected.
      setActiveSiteIdState((cur) => {
        if (cur && list.some((s) => s.id === cur)) return cur;
        return list[0]?.id ?? null;
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
    setActiveSiteIdState(id);
    if (id != null) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const activeSite = sites.find((s) => s.id === activeSiteId) || null;
  const activeGroupId = activeSite?.ruijieGroupId || null;

  return (
    <SiteContext.Provider
      value={{ sites, activeSite, activeSiteId, activeGroupId, setActiveSiteId, loading, reload: load }}
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
      setActiveSiteId: () => {},
      loading: false,
      reload: () => {},
    };
  }
  return ctx;
}
