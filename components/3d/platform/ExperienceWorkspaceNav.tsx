"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Boxes, GitBranch, Home, Layers3, PackageCheck } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const items = [
  { segment: "", label: "Overview", icon: Home },
  { segment: "structure", label: "Project Structure", icon: Layers3 },
  { segment: "models", label: "Models", icon: Box },
  { segment: "editor", label: "Experience Editor", icon: Boxes },
  { segment: "bindings", label: "Unit Binding", icon: GitBranch },
  { segment: "releases", label: "Releases", icon: PackageCheck },
] as const;

export function ExperienceWorkspaceNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/platform-admin/3d/projects/${projectId}`;
  return <nav aria-label="3D Experience workspace" className="overflow-x-auto border-b border-line">
    <div className="flex min-w-max gap-1 px-2">
      {items.map((item) => {
        const href = item.segment ? `${base}/${item.segment}` : base;
        const active = item.segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
        return <Link key={item.label} href={href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2 border-b-2 px-3 py-3 text-table font-medium transition", active ? "border-accent text-accent-strong" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}><item.icon className="size-4" />{item.label}</Link>;
      })}
    </div>
  </nav>;
}
