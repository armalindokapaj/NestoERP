import Link from "next/link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { brand } from "@/config/brand";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Persistent navigation (design spec §11, §12, §14, §44).
 *
 * Width is driven entirely by --nesto-nav-width, so the rail, the full
 * sidebar and the content offset can never disagree. Hidden below 1024px,
 * where navigation moves into the drawer.
 *
 * Header and foot swap assemblies with the width: wordmark and brand signoff
 * when expanded, the mark alone once the rail takes over. Both are links home
 * and nothing else — the collapse control sits in the top bar, where it does
 * not have to share the one slot the rail header has. Which assembly shows is
 * decided in CSS, so the server renders the right one and nothing swaps after
 * hydration.
 */
export function Sidebar({ navigation }: { navigation: NavigationGroup[] }) {
  return (
    <aside className="nesto-rail fixed inset-y-0 left-0 z-40 hidden w-[var(--nesto-nav-width)] flex-col border-r border-line bg-sidebar transition-[width] lg:flex">
      <div className="flex h-16 shrink-0 items-center justify-center px-3 xl:justify-start xl:px-5">
        <Link href="/dashboard" aria-label="NESTO dashboard" className="min-w-0">
          <span className="nesto-rail-only">
            <NestoLogo showWordmark={false} />
          </span>
          <span className="nesto-nav-label">
            <NestoLogo showMark={false} size="lg" />
          </span>
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav navigation={navigation} />
      </div>

      <div className="nesto-sidebar-footer shrink-0 px-5 pb-5 pt-4">
        <div aria-hidden="true" className="mb-3 h-px w-6 bg-line-strong" />
        {brand.signoff.map((word) => (
          <p key={word} className="nesto-eyebrow truncate text-fg-subtle">
            {word}
          </p>
        ))}
      </div>
    </aside>
  );
}
