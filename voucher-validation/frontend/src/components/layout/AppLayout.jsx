// src/components/layout/AppLayout.jsx
// Top-level shell — Service Desk style. Sidebar + scrolling outlet, a live
// Vodafone-red accent line along the top, and a tokenized toast theme.

import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Sidebar from "./Sidebar";
import { SiteProvider } from "../../hooks/useSite";

export default function AppLayout() {
  return (
    <SiteProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--fg-primary)]">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Live accent line — subtle "the chrome is alive" pulse */}
          <div
            className="h-[2px] w-full shrink-0 animate-header-wave"
            style={{
              background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
              backgroundSize: "200% 100%",
              opacity: 0.7,
            }}
          />
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <Outlet />
          </div>
        </main>

        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: "var(--bg-elevated)",
              color: "var(--fg-primary)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-elevated)",
              borderRadius: "12px",
              fontSize: "13px",
              padding: "10px 14px",
              fontFamily: "var(--font-sans)",
            },
            success: { iconTheme: { primary: "var(--success)", secondary: "var(--bg-elevated)" } },
            error: { iconTheme: { primary: "var(--accent)", secondary: "var(--bg-elevated)" } },
          }}
        />
      </div>
    </SiteProvider>
  );
}
