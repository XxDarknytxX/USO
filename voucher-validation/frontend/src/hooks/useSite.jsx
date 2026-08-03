// src/hooks/useSite.jsx
// Global "current site" (village) context. Each site is a Ruijie project
// (groupId). Two independent controls:
//   • activeSiteId — the dashboard/voucher SCOPE. null → global ("All Villages");
//     an id → that village; everything rescopes to it.
//   • visibleSiteIds — a DISPLAY FILTER for the Overview board + Network tab:
//     which villages to show. null → all; an array → that subset.
// Both are saved as a PER-USER server preference (synced across the user's
// devices), with localStorage kept as an instant cache/fallback.

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { networkApi, userApi } from "../services/api";

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

  // Debounced server sync — batches rapid village toggles into one PUT. The
  // backend merges atomically, so sending one key never clobbers the others.
  const pendingPrefs = useRef({});
  const saveTimer = useRef(null);
  const loadSeq = useRef(0);
  const schedulePrefSave = useCallback((partial) => {
    pendingPrefs.current = { ...pendingPrefs.current, ...partial };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const toSave = pendingPrefs.current;
      pendingPrefs.current = {};
      saveTimer.current = null;
      userApi.savePreferences(toSave).catch((e) => console.warn("pref sync failed:", e.message));
    }, 400);
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current; // guards overlapping loads (StrictMode / reload)
    setLoading(true);

    // Fetch projects + prefs independently so we can tell "no server pref" apart
    // from "the prefs fetch FAILED" — conflating them would let a transient error
    // migrate this device's stale localStorage over real, synced server prefs.
    const [projRes, prefsRes] = await Promise.all([
      networkApi.projects().then((d) => ({ ok: true, d })).catch(() => ({ ok: false })),
      userApi.preferences().then((p) => ({ ok: true, prefs: p?.prefs || {} })).catch(() => ({ ok: false })),
    ]);
    if (seq !== loadSeq.current) return; // a newer load superseded this one

    if (!projRes.ok) {
      setSites([]);
      setLoading(false);
      return;
    }
    const list = projRes.d.projects || [];
    setSites(list);

    const prefsOk = prefsRes.ok;
    const serverPrefs = prefsRes.prefs || {};
    const hasServerActive = prefsOk && serverPrefs.activeSiteId !== undefined;
    const hasServerVisible = prefsOk && serverPrefs.visibleSiteIds !== undefined;

    // Don't clobber a choice the user made WHILE this load was in flight — a
    // key that's queued for save wins over whatever the server returned. Use
    // hasOwnProperty (not truthiness): null is a valid pending value ("all").
    const pending = pendingPrefs.current || {};
    const activePending = Object.prototype.hasOwnProperty.call(pending, "activeSiteId");
    const visiblePending = Object.prototype.hasOwnProperty.call(pending, "visibleSiteIds");

    const migrate = {};

    // Active scope: server pref wins (synced), else the local cache. Compare as
    // strings so a number-vs-string id can never be silently dropped.
    if (!activePending) {
      const rawActive = hasServerActive ? serverPrefs.activeSiteId : readActive();
      const nextActive =
        rawActive != null && list.some((s) => String(s.id) === String(rawActive)) ? Number(rawActive) : null;
      setActiveSiteIdState(nextActive);
      localStorage.setItem(STORAGE_KEY, nextActive == null ? "all" : String(nextActive));
      // Migrate local→server ONLY when we KNOW the server has no such pref.
      if (prefsOk && !hasServerActive && nextActive != null) migrate.activeSiteId = nextActive;
    }

    // Visible filter: same precedence; prune to existing sites; empty/full → all.
    if (!visiblePending) {
      const rawVisible = hasServerVisible ? serverPrefs.visibleSiteIds : readVisible();
      let nextVisible = null;
      if (Array.isArray(rawVisible)) {
        const kept = rawVisible.map(Number).filter((id) => list.some((s) => String(s.id) === String(id)));
        nextVisible = kept.length && kept.length < list.length ? kept : null;
      }
      setVisibleState(nextVisible);
      if (nextVisible == null) localStorage.removeItem(VISIBLE_KEY);
      else localStorage.setItem(VISIBLE_KEY, JSON.stringify(nextVisible));
      if (prefsOk && !hasServerVisible && nextVisible != null) migrate.visibleSiteIds = nextVisible;
    }

    // One-time migration for existing users (server empty, localStorage set).
    if (Object.keys(migrate).length) schedulePrefSave(migrate);

    setLoading(false);
  }, [schedulePrefSave]);

  useEffect(() => {
    load();
  }, [load]);

  const setActiveSiteId = useCallback((id) => {
    const next = id == null || id === "all" ? null : Number(id);
    setActiveSiteIdState(next);
    localStorage.setItem(STORAGE_KEY, next == null ? "all" : String(next));
    schedulePrefSave({ activeSiteId: next });
  }, [schedulePrefSave]);

  // Persist visible selection. Passing null (or a full set) means "all".
  const setVisibleSiteIds = useCallback(
    (ids) => {
      const all = sites.map((s) => s.id);
      let next = ids == null ? null : ids.filter((id) => all.includes(id));
      if (next && (next.length === 0 || next.length === all.length)) next = null;
      setVisibleState(next);
      if (next == null) localStorage.removeItem(VISIBLE_KEY);
      else localStorage.setItem(VISIBLE_KEY, JSON.stringify(next));
      schedulePrefSave({ visibleSiteIds: next });
    },
    [sites, schedulePrefSave]
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
