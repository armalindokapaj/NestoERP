"use client";

import { ContextTabs } from "@/components/navigation/context-tabs";

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
  capabilities,
}: {
  clientId: string;
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
  const tabs = TABS.filter((tab) => show[tab.key]).map((tab) => ({
    key: tab.key,
    label: t(`tabs.${tab.key}`),
    href: `/clients/${clientId}${tab.suffix}`,
  }));

  // The active tab follows the URL, so the tabs can sit in the layout and stay put.
  return <ContextTabs label={t("tabs.label")} tabs={tabs} rootKey="overview" />;
}
