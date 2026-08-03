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
      logout: () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        navigate("/login");
      },
    };
  }, [navigate]);
}

// Standalone helper (no hooks) for use outside React components
export function getAuthRole() {
  const token = localStorage.getItem("token");
  if (!token) return "viewer";
  const payload = decodeTokenPayload(token);
  return payload?.role || "viewer";
}
