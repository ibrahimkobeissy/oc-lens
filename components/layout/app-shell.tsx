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
      <div className="flex min-h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 pb-14 md:pb-0">{children}</main>
        </div>
        <MobileNav />
      </div>
      <GlobalSearch />
      <KeyboardNavProvider />
    </SidebarProvider>
  );
}
