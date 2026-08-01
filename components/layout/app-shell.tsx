"use client";

import { SidebarProvider } from "@/components/layout/sidebar-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { GlobalSearch } from "@/components/global-search";
import { KeyboardNavProvider } from "@/components/keyboard-nav-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform focus:translate-y-0">Skip to main content</a>
      <div className="flex min-h-full bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main-content" className="app-main-surface flex-1 pb-14 md:pb-0">{children}</main>
        </div>
        <MobileNav />
      </div>
      <GlobalSearch />
      <KeyboardNavProvider />
    </SidebarProvider>
  );
}
