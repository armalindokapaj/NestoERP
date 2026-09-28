"use client";

import { Building2, FolderKanban, Network, Plus } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The one global Create (Admin IA §19, §20). Each entry opens the directory
 * that owns the workflow with `?create=`, where the page's own create dialog
 * opens: one form per thing, reached from here or from the page header.
 */
export const QUICK_CREATE = [
  { key: "company", label: "Company", href: "/admin/organizations?create=company", icon: Building2, permission: "platform.company.create" },
  { key: "group", label: "Group", href: "/admin/organizations?create=group", icon: Network, permission: "platform.group.create" },
  { key: "project", label: "Project", href: "/admin/projects?create=project", icon: FolderKanban, permission: "platform.project.manage" },
] as const;

export function PlatformQuickCreate({ permissions }: { permissions: readonly string[] }) {
  const items = QUICK_CREATE.filter((item) => permissions.includes(item.permission));
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" data-testid="admin-quick-create"><Plus aria-hidden="true" /><span className="max-sm:sr-only">Create</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href} className="cursor-pointer"><item.icon aria-hidden="true" className="size-4" />{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
