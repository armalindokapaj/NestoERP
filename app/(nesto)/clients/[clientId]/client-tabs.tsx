"use client";

import Link from "@/components/navigation/nav-link";

import type { ClientDetailDTO } from "@/lib/modules/clients/client.types";
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
  { key: "sales", label: "Sales", suffix: "/sales" },
  { key: "contracts", label: "Contracts", suffix: "/contracts" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type ClientTabKey = (typeof TABS)[number]["key"];

/**
 * Which tabs this reader gets, derived from the record's own capabilities.
 *
 * Computed here rather than restated on each sub-page, so a person does not
 * lose a tab by navigating to one of them — which is what six hand-written
 * copies of this object drifted into.
 */
export function ClientTabs({
  clientId,
  active,
  capabilities,
}: {
  clientId: string;
  active: ClientTabKey;
  capabilities: ClientDetailDTO["capabilities"];
}) {
  const show: Record<ClientTabKey, boolean> = {
    overview: true,
    contacts: capabilities.canViewContacts,
    projects: capabilities.canViewProjects,
    finance: capabilities.canViewFinance,
    sales: capabilities.canViewSales,
    contracts: capabilities.canViewContracts,
    documents: capabilities.canViewDocuments,
    activity: capabilities.canViewActivity,
  };

  const visible = TABS.filter((tab) => show[tab.key]);

  return (
    <nav aria-label="Client sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link navSource="tab"
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
