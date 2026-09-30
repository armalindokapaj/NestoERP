"use client";

import Link from "@/components/navigation/nav-link";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

import type { ClientDetailDTO } from "@/lib/modules/clients/client.types";
import { useClientsTranslations } from "@/components/clients/clients-text";

/**
 * Client record tabs (PRD #12 §58).
 *
 * A tab is rendered only when the reader may open what it leads to: a person
 * without document access sees no Documents tab rather than one that refuses
 * them (PRD #12 §142).
 */
const TABS = [
  { key: "overview", suffix: "" },
  { key: "contacts", suffix: "/contacts" },
  { key: "projects", suffix: "/projects" },
  { key: "finance", suffix: "/finance" },
  { key: "sales", suffix: "/sales" },
  { key: "contracts", suffix: "/contracts" },
  { key: "documents", suffix: "/documents" },
  { key: "activity", suffix: "/activity" },
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

  const t = useClientsTranslations();
  const visible = TABS.filter((tab) => show[tab.key]);

  return (
    <ContextTabsFrame label={t("tabs.label")}>
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link key={tab.key} navSource="tab"
                href={`/clients/${clientId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={contextTabClass(isActive)}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
          );
        })}
      </ContextTabsFrame>
  );
}
