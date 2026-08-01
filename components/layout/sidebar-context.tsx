"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const SIDEBAR_STORAGE_KEY = "oc-lens-sidebar-collapsed";

interface SidebarContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Fixed default (expanded) matches SSR exactly; the real persisted value is
  // read back from localStorage immediately after mount — same hydration-safe
  // pattern as components/theme-provider.tsx's ThemeProvider.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    } catch {
      // Storage unavailable — stay expanded for this session.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Storage unavailable — collapse still flips for this session.
      }
      return next;
    });
  }, []);

  return <SidebarContext.Provider value={{ collapsed, toggleCollapsed }}>{children}</SidebarContext.Provider>;
}
