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
      isAdmin: role === "admin",
      isViewer: role === "viewer",
      // Field contractor: maintenance only, nothing else in the app.
      isEngineer: role === "engineer",
      canSeeDashboard: canSeeDashboard(role),
      logout: () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        navigate("/login");
      },
    };
  }, [navigate]);
}

// Roles that may read dashboard data: the dashboard, the overview, and the
// numbers behind them. Mirrors DASHBOARD_ROLES in the backend's auth middleware,
// which is the real boundary — this copy only keeps the SPA from sending someone
// to a page whose every request would be refused.
const DASHBOARD_ROLES = new Set(["admin", "viewer"]);

export function canSeeDashboard(role) {
  return DASHBOARD_ROLES.has(role);
}

// Where an account lands: after sign-in, at "/", and whenever it is bounced
// from a page it may not open. A field engineer has one page, so that is home.
export function homePathFor(role) {
  return canSeeDashboard(role) ? "/dashboard" : "/maintenance";
}

// Standalone helper (no hooks) for use outside React components
export function getAuthRole() {
  const token = localStorage.getItem("token");
  if (!token) return "viewer";
  const payload = decodeTokenPayload(token);
  return payload?.role || "viewer";
}
