import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContractRequestQueue } from "@/components/contracts/unit-contract/contract-request-queue";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { legalCapabilities } from "@/lib/modules/contracts/units/sale-contract";
import { parseContractRequestQuery } from "@/lib/modules/contracts/units/unit-contract.schema";
import { listContractRequests } from "@/lib/modules/contracts/units/unit-contract.service";

export const metadata: Metadata = { title: "Unit contract requests" };

/** Sales' requests for a unit's contract, waiting for Legal (E-05F §12). */
export default async function ContractRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("contracts");
  const caps = legalCapabilities(context);
  if (!caps.canView || !(caps.canCreate || caps.canReview)) redirect("/access-denied");
  const query = parseContractRequestQuery(await searchParams);
  const list = await listContractRequests(context, query);
  return (
    <ModulePage experience={resolveModuleExperience(context, "contracts")} activeSection="requests">
      <ContractRequestQueue items={list.items} view={query.view} canCreate={caps.canCreate} canDecline={caps.canReview} />
    </ModulePage>
  );
}
