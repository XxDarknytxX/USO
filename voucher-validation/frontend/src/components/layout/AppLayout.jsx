// src/components/layout/AppLayout.jsx
// Top-level shell. Sidebar + main outlet, with a tokenized toast theme.

import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Sidebar from "./Sidebar";
import { SiteProvider } from "../../hooks/useSite";

export default function AppLayout() {
  return (
    <SiteProvider>
    <div className="flex h-screen bg-[var(--surface)] text-[var(--text-primary)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-[var(--surface)]">
        <Outlet />
      </main>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--elev-2)",
            borderRadius: "8px",
            fontSize: "13px",
            padding: "10px 14px",
            fontFamily: "var(--font-sans)",
          },
          success: {
            iconTheme: {
              primary: "var(--success-fg)",
              secondary: "var(--surface-raised)",
            },
          },
          error: {
            iconTheme: {
              primary: "var(--brand)",
              secondary: "var(--surface-raised)",
            },
          },
        }}
      />
    </div>
    </SiteProvider>
  );
}
