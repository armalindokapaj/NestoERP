import Link from "@/components/navigation/nav-link";

import type { ContractDetailDTO } from "@/lib/modules/contracts/contract.types";
import { cn } from "@/lib/utils/cn";
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
  active,
  capabilities,
}: {
  contractId: string;
  active: ContractTabKey;
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

  const visible = TABS.filter((tab) => show[tab.key]);

  return (
    <nav aria-label={t("tabs.label")} className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link navSource="tab"
                href={`/contracts/${contractId}${tab.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
