import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { getIcon } from "@/components/layout/nav-icon";
import { can } from "@/config/permissions";
import { settingsSections } from "@/config/settings";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Settings",
};

/** Settings landing page (spec §46). Sections the role cannot open are hidden. */
export default async function SettingsPage() {
  const user = await requirePermission("settings.view");

  const sections = settingsSections.filter((section) => can(user, section.permission));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-body text-fg-muted">
          Your profile and company configuration.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const Icon = getIcon(section.icon);
          return (
            <Link
              key={section.slug}
              href={`/settings/${section.slug}`}
              className="nesto-card group flex items-start gap-3 p-5 transition-colors hover:border-line-strong hover:bg-surface-muted"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-card font-semibold text-fg">{section.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-1 block text-table leading-relaxed text-fg-muted">
                  {section.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
