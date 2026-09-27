import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import type { ContractDetailDTO } from "@/lib/modules/contracts/contract.types";
import { englishContracts } from "@/lib/i18n/modules/contracts/labels";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Resolves the contract every page under `/contracts/[id]` needs.
 *
 * Out of scope answers 404 rather than 403, so the page itself cannot confirm
 * that an agreement exists to somebody who may not open it (PRD #18 §288).
 */
export async function contractContext(
  contractId: string,
): Promise<{ context: UserContext; contract: ContractDetailDTO }> {
  const context = await requireModule("contracts");

  try {
    return { context, contract: await contracts.getContract(context, contractId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

/**
 * Breadcrumbs for a contract page.
 *
 * `trailing` names the tab or sub-page, and turns the contract number itself
 * into a link back to the overview (PRD #7 §31).
 */
export function contractBreadcrumbs(
  contract: { id: string; contractNumber: string },
  trailing?: string,
  t: Translate<"contracts"> = englishContracts,
): Crumb[] {
  const crumbs: Crumb[] = [
    { label: t("crumbs.legal"), href: "/contracts" },
    { label: t("crumbs.contracts"), href: "/contracts/all" },
    trailing
      ? { label: contract.contractNumber, href: `/contracts/${contract.id}` }
      : { label: contract.contractNumber },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
