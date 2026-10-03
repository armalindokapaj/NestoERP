import { Building2, FolderKanban, Network } from "lucide-react";

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
