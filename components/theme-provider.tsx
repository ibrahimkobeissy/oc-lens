"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "oc-lens-theme";

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  /** False until the post-mount sync has run — consumers that render a theme-dependent icon should wait for this before showing it, to avoid a one-frame mismatch (see ThemeProvider's comment below). */
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from a fixed value identical to what the server rendered, so the
  // first client render matches SSR exactly (no hydration mismatch on any
  // consumer that reads `theme`). ThemeScript has already set the real class
  // on <html> before this component mounts — the effect below reads that back
  // immediately after mount, which is the one point a resync is safe.
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Deliberate one-time sync from the DOM after mount: starting from a fixed
    // "dark" keeps the first client render identical to SSR (no hydration
    // mismatch for any consumer that reads `theme`), then we adopt whatever
    // ThemeScript already set on <html>. This is an external-store read, not a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, blocked cookies) — theme still flips for this session.
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, mounted }}>{children}</ThemeContext.Provider>;
}

/**
 * Blocking script that prevents a flash of the wrong theme. Must be rendered
 * as the very first child inside `<body>`, before `ThemeProvider`/children —
 * a synchronous inline `<script>` there runs during HTML parsing, before the
 * browser paints anything after it, so the `dark` class lands on `<html>`
 * before first paint rather than after React hydrates.
 *
 * The consuming root layout's `<html>` element needs `suppressHydrationWarning`,
 * since this script changes its class attribute between the server-rendered
 * markup and the live DOM before React hydrates.
 */
export function ThemeScript() {
  const script = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
