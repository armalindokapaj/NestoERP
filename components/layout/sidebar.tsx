import Link from "next/link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { brand } from "@/config/brand";
import type { NavigationGroup } from "@/config/navigation";

/**
 * Persistent navigation (design spec §11, §12, §14, §44).
 *
 * Width is driven entirely by --nesto-nav-width, so the rail, the full
 * sidebar and the content offset can never disagree. Hidden below 1024px,
 * where navigation moves into the drawer.
 *
 * Header and foot swap assemblies with the width: full wordmark and brand
 * signoff when expanded, the mark alone once the rail takes over.
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
            <NestoLogo showMark={false} size="lg" tagline={brand.descriptor} />
          </span>
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav navigation={navigation} />
      </div>

      <div className="nesto-sidebar-footer shrink-0 items-end justify-center gap-2 px-5 pb-5 pt-4">
        <div className="nesto-nav-label min-w-0 flex-1">
          <div aria-hidden="true" className="mb-3 h-px w-6 bg-line-strong" />
          {brand.signoff.map((word) => (
            <p key={word} className="nesto-eyebrow truncate text-fg-subtle">
              {word}
            </p>
          ))}
        </div>
        <SidebarToggle />
      </div>
    </aside>
  );
}
