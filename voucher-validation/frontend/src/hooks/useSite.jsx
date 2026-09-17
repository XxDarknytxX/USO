// src/hooks/useSite.jsx
// Global "current site" (village) context. Each site is a Ruijie project
// (groupId). Two independent controls:
//   • activeSiteId — the dashboard/voucher SCOPE. null → global ("All Villages");
//     an id → that village; everything rescopes to it.
//   • visibleSiteIds — a DISPLAY FILTER for the Overview board + Network tab:
//     which villages to show. null → all; an array → that subset.
//
// The display filter comes in two layers:
//   • globalVisibleSiteIds — the ESTATE DEFAULT, set once by an admin under
//     Settings and applied to everyone who has not chosen otherwise. This is
//     where a test village is taken out of the console for the whole team.
//   • visibleSiteIds — the PERSONAL override, this account's own choice. An
//     admin can tick a test village back on to look at it for an afternoon
//     without putting it in front of anybody else.
// Personal wins when it is set; otherwise the estate default applies; if
// neither is set, every village shows.
//
// For a viewer, engineer or billing account the estate default is also what the
// SERVER answers with, so their personal layer can only ever narrow what they
// already get — ticking a village the default leaves out shows them an empty
// row, not somebody else's data. The Billing page follows the same precedence
// as the dashboards (switcher village, then personal, then estate default).
//
// activeSiteId and the personal filter are saved as PER-USER server
// preferences (synced across the user's devices). localStorage is only a
// fallback for when the preferences cannot be fetched — it is NEVER copied up
// into an account's preferences. It used to be, as a one-time migration, and on
// a shared browser that handed one person's village filter to whoever signed
// in next. The estate default is an app setting, not a preference, and is
// read-only here.

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
  const [visibleSiteIds, setVisibleState] = useState(readVisible); // null = follow the estate default
  const [globalVisibleSiteIds, setGlobalVisible] = useState(null);  // null = all
  const [estateDefault, setEstateDefault] = useState(null);           // how the default came to be
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
      userApi
        .preferences()
        .then((p) => ({
          ok: true,
          prefs: p?.prefs || {},
          global: p?.globalVisibleSiteIds ?? null,
          estate: p?.estateDefault ?? null,
        }))
        .catch(() => ({ ok: false })),
    ]);
    if (seq !== loadSeq.current) return; // a newer load superseded this one

    if (!projRes.ok) {
      setSites([]);
      // Bailing out here used to leave a stale single-village selection in
      // force. isInScope then collapses to `id === activeSiteId`, and pages
      // fed by OTHER endpoints — Maintenance reads its own schedule — filter
      // every row away and render as if the account had nothing, with no error
      // to explain it. Drop back to "all villages" so a failed fetch degrades
      // to showing too much rather than to showing nothing.
      //
      // Deliberately NOT written to localStorage: the selection is the user's
      // and should come back on the next load that actually succeeds.
      setActiveSiteIdState(null);
      setLoading(false);
      return;
    }
    const list = projRes.d.projects || [];
    setSites(list);

    // Pruned to villages that still exist, so a default naming a deleted
    // village does not quietly shrink what everyone sees.
    const rawGlobal = prefsRes.ok ? prefsRes.global : null;
    setEstateDefault(prefsRes.ok ? prefsRes.estate : null);
    setGlobalVisible(
      Array.isArray(rawGlobal)
        ? rawGlobal.map(Number).filter((id) => list.some((x) => String(x.id) === String(id)))
        : null
    );

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

    // The server is the record. The local cache is read ONLY when the
    // preferences could not be fetched; when they were fetched and hold no such
    // key, this account has made no choice, whatever this browser remembers
    // from someone else. Compare as strings so a number-vs-string id can never
    // be silently dropped.
    if (!activePending) {
      const rawActive = hasServerActive ? serverPrefs.activeSiteId : prefsOk ? null : readActive();
      const nextActive =
        rawActive != null && list.some((s) => String(s.id) === String(rawActive)) ? Number(rawActive) : null;
      setActiveSiteIdState(nextActive);
      localStorage.setItem(STORAGE_KEY, nextActive == null ? "all" : String(nextActive));
    }

    // Visible filter: same precedence; prune to existing sites; empty/full → all.
    if (!visiblePending) {
      const rawVisible = hasServerVisible ? serverPrefs.visibleSiteIds : prefsOk ? null : readVisible();
      let nextVisible = null;
      if (Array.isArray(rawVisible)) {
        const kept = rawVisible.map(Number).filter((id) => list.some((s) => String(s.id) === String(id)));
        nextVisible = kept.length && kept.length < list.length ? kept : null;
      }
      setVisibleState(nextVisible);
      if (nextVisible == null) localStorage.removeItem(VISIBLE_KEY);
      else localStorage.setItem(VISIBLE_KEY, JSON.stringify(nextVisible));
    }

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

  // The set actually in force: the personal choice when there is one, the
  // estate default otherwise, and everything if neither is set. Resolved in one
  // place so no caller has to remember the precedence.
  const effectiveVisibleSiteIds =
    visibleSiteIds != null ? visibleSiteIds : globalVisibleSiteIds;

  const isSiteVisible = useCallback(
    (id) => effectiveVisibleSiteIds == null || effectiveVisibleSiteIds.includes(id),
    [effectiveVisibleSiteIds]
  );

  /** True when this account is showing the estate default rather than its own. */
  const followingEstateDefault = visibleSiteIds == null;

  // Effective scope for the Overview board + Network tab: when a single village
  // is picked in the switcher, only that one; otherwise the configured
  // "All Villages" set (isSiteVisible).
  const isInScope = useCallback(
    (id) => (activeSiteId != null ? id === activeSiteId : isSiteVisible(id)),
    [activeSiteId, isSiteVisible]
  );

  // Toggling starts from the set CURRENTLY IN FORCE, not from "all". Someone
  // following an estate default of four villages who unticks one expects three
  // — not every village bar one.
  const toggleVisibleSite = useCallback(
    (id) => {
      const current = effectiveVisibleSiteIds == null ? sites.map((s) => s.id) : effectiveVisibleSiteIds;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      setVisibleSiteIds(next);
    },
    [sites, effectiveVisibleSiteIds, setVisibleSiteIds]
  );

  /** Drops this account's own choice and goes back to the estate default. */
  const followEstateDefault = useCallback(() => setVisibleSiteIds(null), [setVisibleSiteIds]);

  const activeSite = sites.find((s) => s.id === activeSiteId) || null;
  const activeGroupId = activeSite?.ruijieGroupId || null;
  const isGlobal = activeSiteId == null;
  // Derived from the EFFECTIVE set, not the personal one — an account following
  // an estate default of four villages is not showing all of them.
  const visibleSites =
    effectiveVisibleSiteIds == null ? sites : sites.filter((s) => effectiveVisibleSiteIds.includes(s.id));
  const allVisible = effectiveVisibleSiteIds == null;

  return (
    <SiteContext.Provider
      value={{
        sites,
        activeSite,
        activeSiteId,
        activeGroupId,
        isGlobal,
        setActiveSiteId,
        // display filter — `visibleSiteIds` is this account's own choice (null =
        // following the estate default); `effectiveVisibleSiteIds` is what is
        // actually in force and is what callers almost always want.
        visibleSiteIds,
        globalVisibleSiteIds,
        // How the estate default came to be: { mode: unset|all|list|none|
        // unreadable, updatedAt, updatedByName (admins only) }, or null if the
        // preferences could not be fetched.
        estateDefault,
        effectiveVisibleSiteIds,
        followingEstateDefault,
        followEstateDefault,
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
