import * as React from "react";
import { cookies } from "next/headers";

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-provider";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SIDEBAR_COOKIE, readSidebarState } from "@/lib/layout/sidebar-state";
import type { CurrentUser } from "@/lib/auth/types";

/**
 * The one NESTO application shell (design spec §11, §105).
 *
 * Every authenticated route renders inside this. The structure never changes
 * between roles — only the configuration passed to the sidebar and dashboard.
 *
 * Content is capped at 1600px (§50) and padded 16 / 24 / 32px across mobile,
 * tablet and desktop (§8).
 */
export async function AppShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarState = readSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value);

  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <SidebarProvider initial={sidebarState} className="min-h-dvh bg-canvas">
          <Sidebar user={user} />

          <div className="pl-[var(--nesto-nav-width)] transition-[padding]">
            <Topbar user={user} />
            <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
              {children}
            </main>
          </div>
        </SidebarProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}
