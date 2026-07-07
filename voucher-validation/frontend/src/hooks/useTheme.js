// src/hooks/useTheme.js
// Theme management — light/dark via [data-theme] on <html>.
// Persists to localStorage; respects OS preference on first visit.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "vv:theme";

function getInitialTheme() {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Dark-first (Service Desk look). The toggle + saved preference still win.
  return "dark";
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  // Also set the standard color-scheme so form controls + scrollbars match
  document.documentElement.style.colorScheme = theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}

// Bootstrap before React mounts — prevents flash of wrong theme on first load.
export function bootstrapTheme() {
  applyTheme(getInitialTheme());
}
