import Link from "next/link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { roleLabel } from "@/config/roles";
import type { CurrentUser } from "@/lib/auth/types";

/**
 * Persistent navigation (design spec §11, §12, §14, §44).
 *
 * Width is driven entirely by --nesto-nav-width, so the rail, the full
 * sidebar and the content offset can never disagree. Hidden below 1024px,
 * where navigation moves into the drawer.
 */
export function Sidebar({ user }: { user: CurrentUser }) {
  return (
    <aside className="nesto-rail fixed inset-y-0 left-0 z-40 hidden w-[var(--nesto-nav-width)] flex-col border-r border-line bg-sidebar transition-[width] lg:flex">
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-line px-3 xl:justify-start xl:px-4">
        <Link href="/dashboard" aria-label="NESTO dashboard">
          <NestoLogo wordmarkClassName="nesto-nav-label" />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav role={user.role} />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-3 xl:px-4">
        <div className="nesto-nav-label min-w-0 flex-1">
          <p className="truncate text-micro font-medium text-fg">{user.companyName}</p>
          <p className="truncate text-micro text-fg-subtle">
            {roleLabel(user.role)} workspace
          </p>
        </div>
        <SidebarToggle />
      </div>
    </aside>
  );
}
