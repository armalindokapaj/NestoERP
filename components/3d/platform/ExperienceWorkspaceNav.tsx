"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, GitBranch, Home, Layers3, PackageCheck } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/utils/cn";

/**
 * The Experience's management tabs. Authoring is not one of them: the
 * Experience Editor opens in its own browser tab from the header (3D Editor
 * PRD §19-§21, §171).
 */
const items = [
  { segment: "", key: "overview", icon: Home },
  { segment: "structure", key: "structure", icon: Layers3 },
  { segment: "models", key: "models", icon: Box },
  { segment: "bindings", key: "bindings", icon: GitBranch },
  { segment: "releases", key: "releases", icon: PackageCheck },
] as const;

export function ExperienceWorkspaceNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const t = useTranslations("adminPlatform");
  const base = `/admin/3d/projects/${projectId}`;
  return <nav aria-label={t("threeDAdmin.nav.label")} className="overflow-x-auto border-b border-line">
    <div className="flex min-w-max gap-1 px-2">
      {items.map((item) => {
        const href = item.segment ? `${base}/${item.segment}` : base;
        const active = item.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
        return <Link key={item.key} href={href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2 border-b-2 px-3 py-3 text-table font-medium transition", active ? "border-accent text-accent-strong" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}><item.icon className="size-4" />{t(`threeDAdmin.nav.${item.key}`)}</Link>;
      })}
    </div>
  </nav>;
}
