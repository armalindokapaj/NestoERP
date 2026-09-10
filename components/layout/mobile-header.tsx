import Link from "next/link";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NestoLogo } from "@/components/layout/nesto-logo";
import type { RoleKey } from "@/config/roles";

/**
 * Mobile and tablet-portrait header cluster (design spec §37, §45).
 *
 * `☰ NESTO` — the drawer trigger and the wordmark. Composed by Topbar rather
 * than being a second header, so there is still exactly one app shell.
 */
export function MobileHeader({
  role,
  companyName,
}: {
  role: RoleKey;
  companyName: string;
}) {
  return (
    <div className="flex items-center gap-1 lg:hidden">
      <MobileNav role={role} companyName={companyName} />
      <Link href="/dashboard" aria-label="NESTO dashboard">
        <NestoLogo />
      </Link>
    </div>
  );
}
