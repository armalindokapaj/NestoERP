import { ContextTabs } from "@/components/navigation/context-tabs";

import type { ContractDetailDTO } from "@/lib/modules/contracts/contract.types";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Contract record tabs (PRD #18 §101).
 *
 * A tab renders only when the reader may open what it leads to: somebody
 * without amendment access sees no Amendments tab rather than one that refuses
 * them (PRD #18 §353).
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "parties", label: "Parties", suffix: "/parties" },
  { key: "obligations", label: "Obligations", suffix: "/obligations" },
  { key: "amendments", label: "Amendments", suffix: "/amendments" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type ContractTabKey = (typeof TABS)[number]["key"];

export async function ContractTabs({
  contractId,
  capabilities,
}: {
  contractId: string;
  capabilities: ContractDetailDTO["capabilities"];
}) {
  const t = await getTranslations("contracts");
  const show: Record<ContractTabKey, boolean> = {
    overview: true,
    parties: capabilities.canViewParties,
    obligations: capabilities.canViewObligations,
    amendments: capabilities.canViewAmendments,
    documents: capabilities.canViewDocuments,
    activity: capabilities.canViewActivity,
  };

  const tabs = TABS.filter((tab) => show[tab.key]).map((tab) => ({
    key: tab.key,
    label: t(`tabs.${tab.key}`),
    href: `/contracts/${contractId}${tab.suffix}`,
  }));

  // The active tab follows the URL, so the tabs can sit in the layout and stay put.
  return <ContextTabs label={t("tabs.label")} tabs={tabs} rootKey="overview" />;
}
