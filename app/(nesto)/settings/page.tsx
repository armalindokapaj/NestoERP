import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { getIcon } from "@/components/layout/nav-icon";
import { requireUserContext } from "@/lib/context/current-user";
import { visibleSettingsSections } from "./settings-access";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings landing page (PRD #5 §39).
 * Sections the role cannot open are absent, not disabled.
 */
export default async function SettingsPage() {
  const context = await requireUserContext();
  const sections = visibleSettingsSections(context);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-body text-fg-muted">Your profile and company configuration.</p>
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
                <span className="mt-1 block text-table text-fg-muted">{section.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
