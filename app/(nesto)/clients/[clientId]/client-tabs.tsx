"use client";

import Link from "next/link";

import { cn } from "@/lib/utils/cn";

/**
 * Client record tabs (PRD #12 §58).
 *
 * A tab is rendered only when the reader may open what it leads to: a person
 * without document access sees no Documents tab rather than one that refuses
 * them (PRD #12 §142).
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "contacts", label: "Contacts", suffix: "/contacts" },
  { key: "projects", label: "Projects", suffix: "/projects" },
  { key: "finance", label: "Finance", suffix: "/finance" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type ClientTabKey = (typeof TABS)[number]["key"];

export function ClientTabs({
  clientId,
  active,
  show,
}: {
  clientId: string;
  active: ClientTabKey;
  show: Partial<Record<ClientTabKey, boolean>>;
}) {
  const visible = TABS.filter((tab) => tab.key === "overview" || show[tab.key]);

  return (
    <nav aria-label="Client sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={`/clients/${clientId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
