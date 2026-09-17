// src/hooks/useAuth.js
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

function decodeTokenPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function useAuth() {
  const navigate = useNavigate();

  return useMemo(() => {
    const token = localStorage.getItem("token");
    const payload = token ? decodeTokenPayload(token) : null;
    const role = payload?.role || localStorage.getItem("role") || "viewer";

    return {
      token,
      role,
      email: payload?.email || "",
      name: payload?.name || "",
      // Both administrator roles. isSuperadmin marks the one that also owns
      // the estate default, credentials, schedules and security policy.
      isAdmin: role === "admin" || role === "superadmin",
      isSuperadmin: role === "superadmin",
      isViewer: role === "viewer",
      // Field contractor: maintenance only, nothing else in the app.
      isEngineer: role === "engineer",
      // The monthly bill, and the dashboard and overview behind it.
      isBilling: role === "billing",
      canSeeDashboard: canSeeDashboard(role),
      canSeeBilling: canSeeBilling(role),
      logout: () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        clearSiteCache();
        navigate("/login");
      },
    };
  }, [navigate]);
}

// Roles that may read dashboard data: the dashboard, the overview, and the
// numbers behind them. Mirrors DASHBOARD_ROLES in the backend's auth middleware,
// which is the real boundary — this copy only keeps the SPA from sending someone
// to a page whose every request would be refused.
const DASHBOARD_ROLES = new Set(["superadmin", "admin", "viewer", "billing"]);

export function canSeeDashboard(role) {
  return DASHBOARD_ROLES.has(role);
}

// Who may open the Billing page. Mirrors BILLING_READERS in the backend; only
// admins may change the target.
const BILLING_ROLES = new Set(["superadmin", "admin", "billing"]);

export function canSeeBilling(role) {
  return BILLING_ROLES.has(role);
}

// Where an account lands: after sign-in, at "/", and whenever it is bounced
// from a page it may not open. A field engineer has one page, so that is home.
//
// TOTAL on purpose. Any role not named here lands on /profile, which every
// signed-in account may open. Sending an unrecognised role to /maintenance
// bounced it straight back here — an endless redirect with no way to sign out.
export function homePathFor(role) {
  if (canSeeDashboard(role)) return "/dashboard";
  if (role === "engineer") return "/maintenance";
  return "/profile";
}

// The village scope cache (hooks/useSite.jsx) is one account's choice. Cleared
// whenever the signed-in account ends or changes, so the next person on this
// browser never opens on — or saves into their own preferences — someone
// else's villages when their preferences are slow to load.
export function clearSiteCache() {
  try {
    localStorage.removeItem("vv:activeSiteId");
    localStorage.removeItem("vv:visibleSiteIds");
  } catch {
    /* storage unavailable: nothing cached to leak */
  }
}

export const isAdminRole = (role) => role === "admin" || role === "superadmin";

// Standalone helper (no hooks) for use outside React components
export function getAuthRole() {
  const token = localStorage.getItem("token");
  if (!token) return "viewer";
  const payload = decodeTokenPayload(token);
  return payload?.role || "viewer";
}
