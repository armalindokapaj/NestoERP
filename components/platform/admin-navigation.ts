import type { ComponentType } from "react";
import { Boxes, Building2, FolderKanban, History, LayoutDashboard, Orbit, Settings2, Users } from "lucide-react";

import type { PlatformPermission } from "@/config/platform";

/**
 * The Platform Admin's whole sidebar (Admin IA §5): eight destinations, each
 * opening useful content at once. Secondary pages live as tabs inside a
 * destination (§9, §23), never as nested sidebar rows.
 */
export type AdminTab = { label: string; href: string; permission?: PlatformPermission };
export type AdminDestination = {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  permission: PlatformPermission;
  /** Below the separator (§5). */
  utility?: boolean;
  /** Pages shown as tabs across the top of this destination's directory pages. */
  tabs?: AdminTab[];
};

export const ADMIN_HOME = "/admin";

export const adminDestinations: AdminDestination[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: LayoutDashboard, permission: "platform.dashboard.view" },
  {
    key: "organizations", label: "Organizations", href: "/admin/organizations", icon: Building2, permission: "platform.group.view",
    // Its own All / Groups / Companies / Standalone tabs live in the page (Organizations PRD §6).
  },
  { key: "projects", label: "Projects", href: "/admin/projects", icon: FolderKanban, permission: "platform.project.view" },
  {
    key: "modules", label: "Modules", href: "/admin/modules", icon: Boxes, permission: "platform.module.view",
    tabs: [
      { label: "Entitlements", href: "/admin/modules" },
      { label: "Plans", href: "/admin/modules/plans" },
      { label: "Catalog", href: "/admin/modules/catalog" },
      { label: "Templates", href: "/admin/modules/templates" },
      { label: "Pricing", href: "/admin/modules/pricing", permission: "platform.pricing.view" },
    ],
  },
  {
    key: "users", label: "Users", href: "/admin/users", icon: Users, permission: "platform.user.view",
    tabs: [
      { label: "Accounts", href: "/admin/users" },
      { label: "People", href: "/admin/users/people", permission: "platform.people.view" },
      { label: "Memberships", href: "/admin/users/memberships", permission: "platform.membership.view" },
      { label: "Roles", href: "/admin/users/roles" },
      { label: "Permissions", href: "/admin/users/permissions" },
      { label: "Access grants", href: "/admin/users/grants", permission: "platform.membership.view" },
      { label: "Access inspector", href: "/admin/users/inspector", permission: "platform.access.inspect" },
      { label: "Sessions", href: "/admin/users/sessions", permission: "platform.session.view" },
      { label: "Mobile devices", href: "/admin/users/devices", permission: "platform.device.view" },
    ],
  },
  {
    key: "3d", label: "3D / Rozaris", href: "/admin/3d", icon: Orbit, permission: "platform.3d.view",
    tabs: [
      { label: "Experiences", href: "/admin/3d" },
      { label: "Model library", href: "/admin/3d/models" },
      { label: "Publishing", href: "/admin/3d/publishing" },
      { label: "Diagnostics", href: "/admin/3d/diagnostics" },
    ],
  },
  {
    key: "audit", label: "Audit Log", href: "/admin/audit", icon: History, permission: "platform.audit.view", utility: true,
    tabs: [
      { label: "All events", href: "/admin/audit" },
      { label: "Security", href: "/admin/audit/security", permission: "platform.security.view" },
      { label: "Access changes", href: "/admin/audit/access-changes", permission: "platform.security.view" },
      { label: "Failed sign-ins", href: "/admin/audit/failed-logins", permission: "platform.security.view" },
    ],
  },
  {
    key: "system", label: "System", href: "/admin/system", icon: Settings2, permission: "platform.settings.view", utility: true,
    tabs: [
      { label: "General", href: "/admin/system" },
      { label: "Authentication", href: "/admin/system/authentication" },
      { label: "Email", href: "/admin/system/email" },
      { label: "Notifications", href: "/admin/system/notifications", permission: "platform.operations.view" },
      { label: "Integrations", href: "/admin/system/integrations" },
      { label: "Security", href: "/admin/system/security", permission: "platform.security.view" },
      { label: "Mobile policy", href: "/admin/system/mobile-policy", permission: "platform.security.view" },
      { label: "Feature flags", href: "/admin/system/feature-flags", permission: "platform.feature_flag.view" },
      { label: "Maintenance", href: "/admin/system/maintenance", permission: "platform.maintenance.manage" },
      { label: "Health", href: "/admin/system/health", permission: "platform.operations.view" },
      { label: "Jobs", href: "/admin/system/jobs", permission: "platform.operations.view" },
      { label: "Storage", href: "/admin/system/storage", permission: "platform.operations.view" },
      { label: "Recovery", href: "/admin/system/recovery", permission: "platform.recovery.view" },
      { label: "Data diagnostics", href: "/admin/system/diagnostics", permission: "platform.operations.view" },
      { label: "Support", href: "/admin/system/support", permission: "platform.support.view" },
      { label: "Demo", href: "/admin/system/demo" },
    ],
  },
];

/** The one destination a path belongs to, by hierarchy rather than equality (§12). */
export function activeDestination(pathname: string): AdminDestination | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: AdminDestination | undefined;
  for (const destination of adminDestinations) {
    const hit = destination.href === ADMIN_HOME ? path === ADMIN_HOME : path === destination.href || path.startsWith(`${destination.href}/`);
    if (hit && (!best || destination.href.length > best.href.length)) best = destination;
  }
  return best;
}

/** A tab is current only on its own page; a detail page under it shows no tabs. */
export function activeTab(pathname: string): { destination: AdminDestination; tab: AdminTab } | undefined {
  const path = pathname.replace(/\/+$/, "");
  const destination = activeDestination(path);
  const tab = destination?.tabs?.find((item) => item.href === path);
  return destination && tab ? { destination, tab } : undefined;
}

export function visibleTo<T extends { permission?: PlatformPermission }>(items: readonly T[], permissions: readonly string[]): T[] {
  return items.filter((item) => !item.permission || permissions.includes(item.permission));
}

/** Sidebar width, per browser; read by the layout so a refresh renders it at once (§13). */
export const SIDEBAR_COOKIE = "platformAdmin.sidebar.collapsed";
